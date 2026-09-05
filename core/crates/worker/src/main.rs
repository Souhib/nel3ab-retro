//! The session worker binary.
//!
//! # Architectural rule (mirrors "NO logic in routes")
//!
//! **This binary contains orchestration ONLY.** Every behaviour lives in a
//! library crate, so it can be tested without spawning a process, a GPU or a
//! network. If a function here does more than wire two crates together, it
//! belongs in a crate instead.
//!
//! What it wires, as of M3:
//!
//! ```text
//! emulator ──frame──▶ encoder::vulkan ──NV12──▶ encoder::av ──H.264──▶ transport ──▶ browser
//!    ▲                                                                                  │
//!    └────────────────────────── InputFrame ────────────────────────────────────────────┘
//! ```

#![forbid(unsafe_code)]

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use nel3ab_emulator::nap::{self, Nap, tell_docker};
use nel3ab_emulator::rumble::RumbleTap;
use nel3ab_emulator::saves;
use nel3ab_emulator::{
    CHUNK_BYTES, DolphinConfig, Rom, Session, SlotSet, SoundTap, VideoBackend, catalogue_json,
    scan_libraries,
};
use nel3ab_encoder::av::Encoder;
use nel3ab_encoder::frame_source::{FrameListener, FrameSource};
use nel3ab_encoder::protocol::FrameDescriptor;
use nel3ab_encoder::va::DEFAULT_RENDER_NODE;
use nel3ab_encoder::vulkan::Context;
use nel3ab_encoder::vulkan::convert::{Converter, Ownership, Source};
use nel3ab_encoder::vulkan::image::{ImportedFrame, Nv12Target};
use nel3ab_protocol::PlayerSlot;
use nel3ab_telemetry::Timings;
use nel3ab_transport::{BrowserServer, OwnerSeat, Packet};
use tracing_subscriber::EnvFilter;

/// The page served at `/`. Compiled in rather than read at run time: a worker
/// that could not find its own UI at start-up is a worker that fails in a way
/// nobody sees until a player opens a tab.
///
/// Built by `just front` from `front/`, which writes this file directly and
/// inlines the script and the styles into it. The file is committed so a build
/// of the worker never needs node, and `just front-check` fails when it no
/// longer matches the sources beside it.
const PAGE: &str = include_str!("page/index.html");

/// Constant quantiser. Fixed for now — rate control is a later decision, and one
/// that wants a real network to react to before it is written.
const QP: u32 = 26;

/// A wait past which the emulator is not merely late but stopped.
///
/// Fifteen frames. A busy frame overruns its 16.7 ms budget often enough that a
/// tighter threshold would name every hiccup; a quarter of a second is a hole
/// nobody can miss on screen.
const STALL: Duration = Duration::from_millis(250);

fn main() -> Result<()> {
    init_tracing();
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        "nel3ab worker starting"
    );

    let settings = Settings::from_environment()?;
    run(&settings)
}

/// Everything the worker needs, and where each piece comes from.
struct Settings {
    rom: PathBuf,
    /// Where this machine keeps its games.
    /// Les dossiers où sont les jeux, dans l'ordre où on les balaie.
    ///
    /// Plusieurs, séparés par `:` comme un `PATH`, parce qu'une console par
    /// dossier est la façon dont ces collections se rangent. Un dossier qui
    /// n'existe pas est un dossier vide, pas une erreur: la salle démarre avec
    /// ce qu'elle trouve.
    rom_dirs: Vec<PathBuf>,
    dolphin: PathBuf,
    /// Où trouver `dolphin-tool`, qui sait ouvrir un disque compressé.
    ///
    /// Séparé de `dolphin` parce que ce n'est pas le même programme et qu'il ne
    /// se lance pas pareil: l'émulateur monte un répertoire de session et une
    /// carte graphique, l'outil ne veut qu'un fichier et un dossier de sortie.
    dolphin_tool: PathBuf,
    /// Où les jaquettes déjà lues sont gardées.
    ///
    /// Hors du répertoire de session, qui est effacé au redémarrage: ce cache
    /// n'a d'intérêt que s'il survit, puisque changer de jeu redémarre le worker.
    art_dir: PathBuf,
    session_dir: PathBuf,
    bind: SocketAddr,
    render_node: PathBuf,
    /// Où le plan de contrôle dit qui décide du jeu.
    ///
    /// Un autre port que celui des pages, et ce n'est pas un détail: le proxy
    /// envoie `/` au serveur de pages, donc tout chemin qu'il sert est joignable
    /// depuis un navigateur. Celui-ci n'est relayé par rien, donc seul un
    /// processus de la machine peut l'atteindre.
    control_bind: SocketAddr,
    /// How many ports this room serves.
    ///
    /// Fixed for the session because Dolphin reads which ports hold a controller
    /// when it boots. It is not four by default, and that is deliberate: an
    /// unserved port holding a phantom pad changes what the GAME does — a
    /// four-player title can open four split-screen viewports for one player.
    /// A room for friends says so; a room for one should look like one console
    /// with one controller in it.
    players: PlayerSlot,
}

impl Settings {
    /// Read from the environment, with the values lgf actually uses as
    /// defaults. A config file belongs with the control plane in M4; inventing
    /// one now would be a format to migrate later for no gain today.
    fn from_environment() -> Result<Self> {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_owned());
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
        Ok(Self {
            rom: env_path("NEL3AB_ROM")
                .unwrap_or_else(|| PathBuf::from(&home).join("roms/gc/Super Smash Bros Melee.rvz")),
            rom_dirs: env_dirs("NEL3AB_ROM_DIR").unwrap_or_else(|| {
                vec![
                    PathBuf::from(&home).join("roms/gc"),
                    PathBuf::from(&home).join("roms/wii"),
                ]
            }),
            dolphin: env_path("NEL3AB_DOLPHIN")
                .unwrap_or_else(|| repo.join("docker/dolphin-in-docker.sh")),
            dolphin_tool: env_path("NEL3AB_DOLPHIN_TOOL")
                .unwrap_or_else(|| repo.join("docker/dolphin-tool-in-docker.sh")),
            art_dir: env_path("NEL3AB_ART_DIR").unwrap_or_else(|| {
                env_path("XDG_CACHE_HOME")
                    .unwrap_or_else(|| PathBuf::from(&home).join(".cache"))
                    .join("nel3ab/banners")
            }),
            // PAS dans /tmp, et c'est le constat le plus grave de l'audit du
            // 18 août 2026.
            //
            // Dolphin écrit ses CARTES MÉMOIRE ici. La règle de ménage de cette
            // machine commence par un `D` majuscule, ce qui veut dire « vider le
            // contenu au démarrage »: chaque redémarrage effaçait les coupes
            // débloquées et les records de tout le monde, sans que rien ne le
            // dise. On l'aurait découvert à la partie suivante, sans pouvoir le
            // relier à un redémarrage de la veille.
            //
            // Le dossier d'état est le même que celui des pseudos et du journal
            // des séances, pour la même raison: ce qui appartient aux joueurs
            // doit leur survivre.
            session_dir: env_path("NEL3AB_SESSION_DIR").unwrap_or_else(|| {
                env_path("HOME")
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join(".local/state/nel3ab/session")
            }),
            // Loopback, not every interface, and this is a security decision
            // rather than a default left in place.
            //
            // On `0.0.0.0` the room was reachable three ways: through the
            // Tailscale proxy, directly from any tailnet peer, and directly from
            // the whole home network — the firewall carries `ALLOW IN from
            // 192.168.1.0/24`, so a guest's phone on the Wi-Fi could watch and
            // take a controller. Bound here, the proxy is the only way in.
            //
            // It costs nothing anybody was using: the direct port is plain HTTP,
            // and without TLS the browser refuses the Gamepad API, so nobody
            // could play through it. Local tests and the benchmark reach
            // `localhost` and are unaffected.
            //
            // What it BUYS is worth more than what it closes. Tailscale's proxy
            // hands the worker `Tailscale-User-Login`, the authenticated identity
            // of the peer — measured, not assumed. That header is only evidence
            // if nothing else can write it, which is exactly what binding here
            // guarantees. M4's accounts start from a name we already have.
            //
            // Measured before choosing this: the proxy costs 0.10 ms per frame
            // at the median (0.23 at p99, noise floor 0.014, paired comparison
            // of the same frame on both paths), and both play machines reach the
            // tailnet directly over the LAN rather than through a relay —
            // sub-millisecond on Ethernet, and on Wi-Fi inside the link's own
            // 5-to-64 ms variance. The proxy is not what anybody is feeling.
            bind: std::env::var("NEL3AB_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8100".to_owned())
                .parse()
                .context("NEL3AB_BIND is not a socket address")?,
            render_node: env_path("NEL3AB_RENDER_NODE")
                .unwrap_or_else(|| PathBuf::from(DEFAULT_RENDER_NODE)),
            control_bind: std::env::var("NEL3AB_CONTROL_BIND")
                .unwrap_or_else(|_| "127.0.0.1:8101".to_owned())
                .parse()
                .context("NEL3AB_CONTROL_BIND is not a socket address")?,
            players: players_from_environment()?,
        })
    }
}

/// Reads `NEL3AB_PLAYERS`, refusing anything a room cannot be.
///
/// A bad value stops the worker rather than being rounded into range: a room
/// silently serving one port when four were asked for is a bug discovered by
/// three people who cannot play.
fn players_from_environment() -> Result<PlayerSlot> {
    let Some(raw) = std::env::var_os("NEL3AB_PLAYERS") else {
        // Four, which is what "a room" means here. It was one for a while, on
        // the theory that an unserved port holding a phantom pad changes what
        // the game does — and the cost of that caution was a player locked out
        // of his own room by the single seat, twice over: once by his second
        // machine, once by a ghost the proxy was holding open. A phantom pad is
        // a game that behaves oddly; a full room is a game nobody can play.
        return PlayerSlot::new(4).map_err(|error| anyhow::anyhow!("{error}"));
    };
    let text = raw.to_string_lossy();
    let count: u8 = text
        .trim()
        .parse()
        .with_context(|| format!("NEL3AB_PLAYERS is not a number: {text}"))?;
    PlayerSlot::new(count).map_err(|error| anyhow::anyhow!("NEL3AB_PLAYERS: {error}"))
}

/// Where the room remembers which game it was told to boot.
///
/// Dans le dossier de session. Ce commentaire disait que le choix était oublié
/// au redémarrage de la machine, et que c'était la bonne façon de faire: une
/// salle qui revient repart sur son jeu par défaut. **La décision est
/// inversée**, parce que le dossier de session a quitté `/tmp` le 18 août 2026
/// pour que les cartes mémoire survivent, et que le choix vit dedans.
///
/// Ce qu'on perd: une machine qui redémarre revient sur le dernier jeu joué
/// plutôt que sur celui d'origine. Ce qu'on gagne: personne ne perd sa
/// progression. Le second vaut largement le premier, et revenir sur le dernier
/// jeu est en réalité ce qu'une salle devrait faire.
const CHOICE: &str = "chosen-rom";

/// Et l'emplacement de sauvegarde choisi, à côté, pour la même raison.
const SAVE_CHOICE: &str = "chosen-save";
/// La manette retenue, écrite à côté du jeu et de la sauvegarde.
const PAD_CHOICE: &str = "chosen-pad";

/// Où vivent les deux sauvegardes de chaque jeu.
///
/// À côté de la session et pas dedans: le répertoire de session porte la
/// configuration de Dolphin, ses tubes nommés et ses caches, c'est-à-dire des
/// choses qu'on peut effacer sans rien perdre. Une sauvegarde ne l'est pas.
const SAVES: &str = "saves";

/// Which game to boot: what a player last asked for, or the default.
///
/// Remembered by FILE NAME rather than position, because a position only means
/// something while the directory is unchanged. Dropping a new game in would
/// otherwise silently boot a different one after a restart.
///
/// By file name and not by the name on screen: that one is cleaned of the
/// cataloguing dumps carry, and those rules are allowed to improve. A room must
/// not forget what it was playing because a title lost a parenthesis.
///
/// A name that no longer matches anything falls back to the default instead of
/// stopping the worker. The disk is not ours to depend on, and a room that
/// refuses to start because a file was renamed is worse than one that starts
/// with the usual game.
fn chosen_rom(settings: &Settings, library: &[Rom]) -> PathBuf {
    let Ok(remembered) = std::fs::read_to_string(settings.session_dir.join(CHOICE)) else {
        return settings.rom.clone();
    };
    let remembered = remembered.trim();
    library
        .iter()
        .find(|rom| rom.file == remembered)
        .map_or_else(
            || {
                tracing::warn!(
                    remembered,
                    "the remembered game is gone; booting the usual one"
                );
                settings.rom.clone()
            },
            |rom| rom.path.clone(),
        )
}

/// L'emplacement de sauvegarde retenu, ou une partie neuve.
///
/// Comme pour le jeu: ce qui n'est pas lisible retombe sur le défaut plutôt que
/// d'arrêter la salle. Le pire cas est de démarrer sur une partie neuve, ce qui
/// n'efface rien.
/// Quelle manette la salle présente, pour un disque donné.
///
/// Un jeu GameCube garde la sienne quoi qu'on ait demandé: il n'a pas de
/// Wiimote, et la question ne se pose pas. Pour un jeu Wii, c'est le choix
/// retenu, et il faut en choisir UNE: un jeu qui voit les deux compte deux
/// manettes pour une personne, et le deuxième joueur n'entre jamais.
fn chosen_pad(session_dir: &Path, disc: &nel3ab_emulator::Disc) -> nel3ab_emulator::PadKind {
    if disc.console != nel3ab_emulator::Console::Wii {
        return nel3ab_emulator::PadKind::GameCube;
    }
    let code = std::fs::read_to_string(session_dir.join(PAD_CHOICE))
        .ok()
        .and_then(|kept| kept.trim().parse::<u8>().ok())
        .unwrap_or(0);
    nel3ab_emulator::PadKind::from_code(code)
}

fn chosen_slot(session_dir: &Path) -> saves::Slot {
    std::fs::read_to_string(session_dir.join(SAVE_CHOICE))
        .ok()
        .and_then(|kept| kept.trim().parse::<u8>().ok())
        .map_or(saves::Slot::Fresh, saves::Slot::from_code)
}

/// Prépare les sauvegardes du jeu qu'on s'apprête à lancer.
///
/// Fait pointer les dossiers de carte de Dolphin vers l'emplacement choisi, de
/// sorte que tout ce que le jeu écrit y atterrisse directement. Voir
/// [`nel3ab_emulator::saves`].
///
/// Un échec est tracé et n'arrête pas la salle: on jouera alors sur ce que
/// Dolphin trouve, ce qui est moins bien mais reste une salle qui marche.
fn prepare_saves(session_dir: &Path, rom: &Path, disc: &nel3ab_emulator::Disc, slot: saves::Slot) {
    let file = rom
        .file_name()
        .map_or_else(String::new, |name| name.to_string_lossy().into_owned());
    // Sous le dossier de session, et c'est structurel plutôt que rangé par
    // goût. Le conteneur ne monte que ce dossier: un emplacement posé à côté
    // donnait un lien qui pointait, depuis le conteneur, vers rien. Dolphin
    // suit un lien mort sans le dire, n'annonce aucune erreur, et le jeu
    // repart sur « Data has been created » à chaque démarrage. Trouvé le 30
    // août 2026, après avoir soupçonné le nom du fichier puis le code
    // d'éditeur. Ici, le lien ne PEUT plus sortir du montage.
    let dir = saves::slot_dir(&session_dir.join(SAVES), &file, slot);
    // Deux consoles, deux endroits. Une GameCube écrit dans une carte mémoire,
    // une Wii dans sa propre mémoire, sous l'identifiant du titre. Le disque dit
    // lequel, et un disque muet retombe sur la carte: c'est ce qu'on faisait
    // avant de savoir poser la question, et ça ne casse rien pour un jeu Wii
    // dont la partie ira simplement dans la console sans passer par nous.
    let posed = match (disc.console, disc.title.as_deref()) {
        (nel3ab_emulator::Console::Wii, Some(title)) => {
            saves::point_nand_at(session_dir, title, &dir)
        }
        _ => saves::point_card_at(session_dir, &dir),
    };
    match posed {
        Ok(()) => tracing::info!(
            slot = slot.folder(),
            path = %dir.display(),
            "les sauvegardes de ce jeu sont en place"
        ),
        Err(error) => tracing::warn!(%error, "les sauvegardes n'ont pas pu être préparées"),
    }
}

/// What a byte count over a period is worth on a link, in megabits per second.
fn megabits(bytes: u64, over: Duration) -> f64 {
    let seconds = over.as_secs_f64();
    if seconds <= 0.0 {
        return 0.0;
    }
    #[expect(
        clippy::cast_precision_loss,
        reason = "a session would have to send an exabyte before an f64 loses a \
                  whole byte here, and the value is a rate for a human to read"
    )]
    let bits = (bytes * 8) as f64;
    bits / seconds / 1_000_000.0
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Une LISTE de dossiers, séparés par `:` comme un `PATH`.
///
/// Le même séparateur que le shell, parce que c'est celui que quelqu'un qui
/// écrit une unité systemd a déjà dans les doigts. Une valeur sans deux-points
/// reste donc un seul dossier, et l'ancien réglage continue de marcher.
fn env_dirs(name: &str) -> Option<Vec<PathBuf>> {
    let raw = std::env::var_os(name)?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&raw)
        .filter(|part| !part.as_os_str().is_empty())
        .collect();
    (!dirs.is_empty()).then_some(dirs)
}

/// Wires the four crates together and runs until the emulator stops.
#[allow(
    clippy::too_many_lines,
    reason = "this IS the wiring, and the ORDER is the content: the ring must be \
              imported before the first frame is taken, and the frame released \
              only after the conversion has been waited on. Splitting it into \
              helpers would hide the one thing worth reading."
)]
fn run(settings: &Settings) -> Result<()> {
    std::fs::create_dir_all(&settings.session_dir)
        .with_context(|| format!("creating {}", settings.session_dir.display()))?;
    let socket = settings.session_dir.join("frames.sock");
    // A stale socket from a previous run would make `bind` fail with EADDRINUSE
    // on a path nothing is listening on, which reads as a mystery.
    let _ = std::fs::remove_file(&socket);

    // Scanned once, at start-up. A library that changed under a running room
    // would move the positions a page is holding, and a player would boot a
    // different game from the one they clicked. It is rescanned on the restart
    // that a switch causes anyway, which is the moment it can change safely.
    let library = scan_libraries(&settings.rom_dirs);
    // Ce que chaque disque est, lu sur le disque et gardé en cache. Calculé ICI
    // et pas plus bas, parce que les sauvegardes en dépendent et qu'elles
    // doivent être en place avant que Dolphin ne démarre.
    let discs = nel3ab_emulator::discs(&library, &settings.dolphin_tool, &settings.art_dir);
    let rom = chosen_rom(settings, &library);
    // Les sauvegardes AVANT que Dolphin ne démarre: il ouvre son dossier de
    // carte au lancement, et le déplacer après coup ne serait plus vu.
    let slot = chosen_slot(&settings.session_dir);
    let current = library.iter().position(|game| game.path == rom);
    let disc = current
        .and_then(|at| discs.get(at))
        .cloned()
        .unwrap_or(nel3ab_emulator::Disc {
            console: nel3ab_emulator::Console::Unknown,
            title: None,
        });
    let pads = chosen_pad(&settings.session_dir, &disc);
    prepare_saves(&settings.session_dir, &rom, &disc, slot);
    tracing::info!(
        games = library.len(),
        booting = %rom.display(),
        save = slot.folder(),
        "the room's library"
    );
    // Qui décide du jeu. Vide au démarrage, donc la salle applique sa règle
    // d'avant — tenir une manette suffit — jusqu'à ce que le plan de contrôle
    // dise autre chose. Une salle qui refuserait tout en attendant serait une
    // salle bloquée par un service qui n'est peut-être même pas installé.
    // Les jaquettes, avant d'ouvrir le serveur pour que la première page les ait.
    //
    // Synchrone, et c'est le cache qui l'autorise: lire les huit disques de lgf
    // coûte 3,7 s la toute première fois et rien ensuite (2026-08-16). Le prix
    // est payé une fois sur la machine, pas à chaque changement de jeu.
    let art = nel3ab_emulator::banner::gather(
        &library,
        &settings.dolphin_tool,
        &settings.art_dir,
        &discs,
        &settings.session_dir.join(SAVES),
    );
    tracing::info!(
        with = art.iter().filter(|found| found.is_some()).count(),
        of = art.len(),
        "les jeux qui ont une jaquette"
    );

    let consoles: Vec<_> = discs.iter().map(|disc| disc.console).collect();
    tracing::info!(
        wii = consoles
            .iter()
            .filter(|found| **found == nel3ab_emulator::Console::Wii)
            .count(),
        of = consoles.len(),
        "les jeux qui sont des jeux Wii"
    );

    let owner: OwnerSeat = Arc::new(Mutex::new(None));

    let server = Arc::new(BrowserServer::start(
        settings.bind,
        PAGE,
        catalogue_json(&library, &art, &consoles, current, settings.players.get()).into(),
        art.iter()
            .map(|found| found.as_ref().map(|art| Arc::from(art.png.as_slice())))
            .collect(),
        settings.players,
        &owner,
    )?);
    tracing::info!(address = %server.address(), "open this in a browser");

    // APRÈS le serveur, et c'est le point: le plan de contrôle demande sur ce
    // port si une place a le droit de changer de jeu, et seul le serveur connaît
    // la réponse. Ouvrir le port plus tôt donnerait quelques millisecondes
    // pendant lesquelles il faudrait répondre sans savoir.
    let asked = Arc::clone(&server);
    nel3ab_transport::control::serve(
        settings.control_bind,
        Arc::clone(&owner),
        Box::new(move |seat| asked.may_decide(seat)),
    )?;

    // La NAND est balayée AVANT de démarrer l'émulateur.
    //
    // Un disque qui quitte la bibliothèque laisse son entrée de NAND: un lien
    // qui ne mène nulle part. Dolphin parcourt la NAND au démarrage et lève une
    // exception dessus, qu'il ne rattrape pas — le processus meurt, aucune image
    // n'arrive, et la page reste noire. Ça a tué chaque démarrage pendant deux
    // jours, y compris pour des jeux GameCube, qui n'ont rien à faire de la NAND.
    //
    // Ici et pas au moment de poser un lien: ce qu'on retire est ce que le jeu
    // qu'on lance ne mentionne PAS, donc l'endroit qui pose un lien ne peut pas
    // le voir.
    for title in nel3ab_emulator::saves::sweep_nand(&settings.session_dir) {
        tracing::warn!(
            title = %title,
            "une sauvegarde de la NAND ne pointait sur rien: entrée retirée"
        );
    }

    let listener = FrameListener::bind(&socket)?;

    // A string because the override is one; parsed first so a typo stops the
    // worker instead of being handed to Dolphin, which would ignore it in
    // silence and leave us wondering why the picture never changed size.
    // Ce jeu a-t-il déjà montré qu'il change de taille en route ? Lu AVANT le
    // réglage d'environnement, parce que le marqueur décrit le jeu et le réglage
    // décrit la machine: le premier gagne, sinon on retomberait en boucle.
    let internal_resolution = match std::env::var("NEL3AB_INTERNAL_RES") {
        Ok(text) => {
            let scale: u8 = text
                .trim()
                .parse()
                .with_context(|| format!("NEL3AB_INTERNAL_RES is not a number: {text}"))?;
            if !(1..=8).contains(&scale) {
                bail!("NEL3AB_INTERNAL_RES must be 1..=8, got {scale}");
            }
            scale.to_string()
        }
        // Two, not one, and measured on this machine over a minute each with a
        // browser watching:
        //
        //   ×1  640×480    encode 0.98 ms median, 1.98 max ·  2.0 Mbit/s · 59.9 fps
        //   ×2  1280×960   encode 1.96 ms median, 3.41 max ·  5.5 Mbit/s · 59.9 fps
        //   ×3  1920×1440  encode 6.62 ms median, 7.04 max · 10.3 Mbit/s · 54.3 fps
        //
        // Four times the pixels for one millisecond and three megabits, with the
        // frame rate untouched — nothing about ×1 was worth keeping. At ×3 the
        // server still holds (7 ms of a 16.7 ms budget, nothing dropped) but the
        // browser on THIS machine did not: its end-to-end latency p95 went from
        // 28 ms to 5.7 SECONDS. A client that cannot decode in time is a stall
        // however healthy the server is, so ×3 is available and not the default.
        Err(_) => "2".to_owned(),
    };

    // Every port the room serves gets a pipe and a `SIDevice`, and no other
    // does. The transport hands each browser one of these and only these.
    let mut ports = SlotSet::EMPTY;
    for raw in 1..=settings.players.get() {
        let slot = PlayerSlot::new(raw).map_err(|error| anyhow::anyhow!("{error}"))?;
        ports = ports.with(slot);
    }
    tracing::info!(players = settings.players.get(), "the room's size");
    let mut config = DolphinConfig::new(
        settings.dolphin.clone(),
        rom,
        settings.session_dir.clone(),
        ports,
    );
    // Une seule manette à la fois. Un jeu qui voit une manette GameCube ET une
    // Wiimote compte deux manettes pour une personne: à deux joueurs, le premier
    // occupe deux places et le second n'entre jamais. Mesuré sur Mario Kart Wii.
    config.pads = pads;
    tracing::info!(pads = pads.name(), "la manette que la salle présente");
    config.video_backend = VideoBackend::Vulkan;
    // Dolphin compiles a specialised shader the first time it meets a new
    // material, and stops the world while it does. Measured on this machine:
    // the pipeline waited 1.4 s, 1.7 s, 2.5 s and 2.7 s for a frame in separate
    // ten-second windows, with nothing dropped anywhere else — the emulator
    // itself was the stall, and it matches the 2.2 s gap a browser reported.
    //
    // Asynchronous ubershaders draw with a general-purpose shader while the
    // specialised one compiles in the background. It costs some fidelity for the
    // frames in between and a little GPU; it buys a stream that does not freeze
    // for two seconds, which is not a trade worth thinking about for a game.
    for (section, key, value) in [
        ("Settings", "ShaderCompilationMode", "2"),
        // And do not stall at boot waiting for the whole cache either.
        ("Settings", "WaitForShadersBeforeStarting", "False"),
        // The one that made the stream go quiet. Dolphin skips PRESENTING a
        // frame whose XFB is unchanged, and our export hook lives inside that
        // `if` (VideoCommon/Present.cpp: `if (!is_duplicate ||
        // !bSkipPresentingDuplicateXFBs) { Present(); ProcessFrameDumping(); }`).
        // So a game showing a still picture — a menu, a load, a pause — sends us
        // NOTHING, and measured on this machine that reached 2.1 s.
        //
        // For a console that is a saving. For a stream it is a catastrophe: the
        // viewer cannot tell a still picture from a dead link, its buffer
        // starves, and past two seconds the page tears the connection down and
        // reconnects — the "it freezes and loops on two or three images" that
        // sent me looking at the browser for hours.
        //
        // Presenting duplicates costs a re-encode of an identical frame, which
        // is a handful of bytes on a P-frame. A silent stream costs the session.
        ("Hacks", "SkipDuplicateXFBs", "False"),
        // How many times native the emulator renders. The frame ring, the
        // shader, the encoder and the page all take their size from what the
        // emulator announces, so this is the one number that changes the
        // resolution of the whole chain.
        ("Settings", "InternalResolution", &internal_resolution),
    ] {
        match nel3ab_emulator::ConfigOverride::new("Graphics", section, key, value) {
            Ok(over) => config.overrides.push(over),
            Err(error) => tracing::warn!(%error, key, "a graphics override was refused"),
        }
    }
    // La carte mémoire, et sans elle rien ne se sauvegarde.
    //
    // C'est le défaut qui a coûté le plus cher à trouver. Dolphin sans réglage
    // n'a AUCUNE carte: chaque jeu annonce « Data has been created » à chaque
    // démarrage, ne trouve jamais sa progression, et n'écrit rien à l'arrêt.
    // Aucune erreur nulle part, ni côté Dolphin ni côté worker. Vu le 30 août
    // 2026 en essayant de poser des sauvegardes toutes faites: elles étaient
    // ignorées, et j'ai cherché du côté du nom de fichier et du code d'éditeur
    // avant de comprendre qu'il n'y avait pas de carte du tout.
    //
    // Huit est `EXIDeviceType::MemoryCardFolder`, lu dans le code de Dolphin au
    // commit qu'on épingle plutôt que deviné. Le dossier plutôt qu'une image de
    // carte, parce que c'est ce qui donne un fichier par jeu, et c'est ce sur
    // quoi reposent les deux emplacements de sauvegarde.
    for (section, key, value) in [("Core", "SlotA", "8")] {
        match nel3ab_emulator::ConfigOverride::new("Dolphin", section, key, value) {
            Ok(over) => config.overrides.push(over),
            Err(error) => tracing::warn!(%error, key, "un réglage de carte a été refusé"),
        }
    }
    config.frame_socket = Some(socket);
    config.startup_timeout = Duration::from_mins(2);

    // The pipe has to exist, and be open for reading, before Dolphin looks for
    // it: ALSA's file plugin would otherwise create a plain file and the sound
    // would go quietly to disk.
    let mut sound = SoundTap::open(&settings.session_dir)?;
    tracing::info!(pipe = %sound.path().display(), "sound will come out here");

    // Personne d'autre ne doit écrire dans ce tuyau. On refuse de démarrer
    // plutôt que de servir un son haché à toute la salle.
    //
    // Le 2026-08-17, un Dolphin oublié d'une mesure de la veille tournait encore
    // sur ce même répertoire de session. Les deux écrivaient leur PCM dans le
    // même fichier, le worker lisait un mélange de deux parties, et le son a été
    // haché pendant une soirée. Rien n'a échoué: `sound_starved` est resté à
    // zéro, l'image restait regardable, et il a fallu chercher.
    //
    // Un quart de seconde d'écoute. Un émulateur qui tourne produit du son en
    // permanence, donc c'est mille fois plus qu'il n'en faut, et c'est payé une
    // fois au démarrage.
    //
    // Le refus est net, et systemd va donc redémarrer en boucle. C'est voulu:
    // la machine est dans un état que personne n'a demandé, et une boucle qui
    // dit pourquoi vaut mieux que douze heures de son cassé qui ne dit rien.
    if sound.intruder(Duration::from_millis(250)) {
        bail!(
            "somebody else is already writing sound into {}. Another emulator is \
             running on this session directory: `docker ps` will show it, and \
             stopping it is what fixes this. Two emulators on one pipe give a \
             room a chopped-up sound and nothing else to go on.",
            sound.path().display()
        );
    }

    // Le tube de vibration, créé AVANT que Dolphin ne démarre: sinon son propre
    // `open` créerait un fichier ordinaire et les secousses partiraient sur le
    // disque. Même ordre et même raison que pour le son.
    let mut rumble = RumbleTap::open(&settings.session_dir)?;
    config.rumble_pipe = Some(rumble.path().to_path_buf());
    tracing::info!(pipe = %rumble.path().display(), "la vibration remonte par ici");

    let session = Session::start(&config)?;
    let mut frames = listener.accept(Duration::from_mins(2))?;
    let descriptor = *frames.descriptor();
    tracing::info!(
        slots = frames.slot_count(),
        width = descriptor.width,
        height = descriptor.height,
        modifier = format!("{:#018x}", descriptor.modifier),
        "the emulator announced its frame ring"
    );

    let context = Context::open(&settings.render_node)?;
    let mut pipeline = Pipeline::build(&context, &settings.render_node, &frames)?;
    // La salle DIT ce qu'elle sait produire, dès qu'elle le sait.
    //
    // Sans cette ligne le serveur acceptait des spectateurs en demi-format qu'il
    // ne pouvait pas servir: zéro image, le son qui continue, et un écran noir
    // que ni le rechargement ni le vidage du cache ne réparent, puisque le choix
    // du format vit dans le navigateur. Trouvé le 30 août 2026 sur Mario Kart
    // Wii, dont l'anneau fait 1216x912: la moitié de 912 n'est pas un nombre
    // entier de macroblocs de seize, donc le petit encodeur n'ouvre pas.
    server.half_offered(pipeline.half.is_some());

    // Input runs on its own thread, writing the moment a frame lands rather than
    // once per picture. Measured before: a full frame period of avoidable lag,
    // p50 15.55 ms, because a write locked to the frame notification always
    // landed just after the emulator polled its pipe.
    let pad = session.pad_writer();
    // Un SECOND écrivain pour la boucle principale: le premier part vivre dans
    // le fil des entrées. Les deux partagent le même verrou par-dessous, donc ce
    // n'est pas un second chemin vers l'émulateur, c'est la même porte.
    let hotplug = session.pad_writer();

    // Ce qui est branché au bout de chaque Wiimote, affirmé une fois au démarrage.
    //
    // # Pourquoi ça ne peut pas rester dans le fichier
    //
    // Le fichier de correspondances n'écrit plus de nom d'extension: il écrit un
    // calcul qui lit le tuyau de contrôle, pour que l'extension puisse changer
    // sans relancer le jeu. Personne ne tenant rien, ce calcul rend le Nunchuk.
    // Une salle réglée sur la guitare obtiendrait donc un Nunchuk si cette
    // boucle n'existait pas — et Guitar Hero III n'obéit alors qu'au bouton A.
    //
    // L'état vit ici, chez le worker, et il est réaffirmé à chaque démarrage:
    // c'est ce qui rend le tuyau de contrôle sans mémoire, et donc réparable.
    let extension = if pads == nel3ab_emulator::PadKind::Guitar {
        nel3ab_emulator::Extension::Guitare
    } else {
        nel3ab_emulator::Extension::Nunchuk
    };
    for slot in config.slots.iter() {
        if let Err(error) = pad.set_extension(slot, extension) {
            // Un avertissement et pas un arrêt: la partie tourne, et une
            // extension qui n'a pas pu être demandée laisse le Nunchuk, qui est
            // jouable pour presque tout. Mourir ici serait pire que le défaut.
            tracing::warn!(%error, slot = slot.get(), "l'extension n'a pas pu être branchée");
        } else {
            tracing::info!(
                slot = slot.get(),
                extension = extension.name(),
                "extension branchée"
            );
        }
    }
    // Why a flag rather than "am I the last one holding the server": the loops
    // below used to break on `Arc::strong_count(&server) == 1`, which was CORRECT
    // when the pad thread was the only extra holder and became unsatisfiable the
    // day the sound thread added a second. Two holders each waiting for the count
    // to reach one wait for each other, so neither leaves, `join` never returns,
    // and `session.shutdown()` below is never reached — the worker hangs with
    // Dolphin still running, and systemd sees a live process and never restarts
    // it. A count that means "how many of us are there" cannot express "we are
    // done"; this can, and adding a third thread cannot break it.
    let stopping = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let applied = Arc::new(std::sync::atomic::AtomicU64::new(0));
    // Le fil qui endort le jeu quand la salle se vide.
    //
    // Un fil à part et pas la boucle principale, parce que la boucle BLOQUE sur
    // l'image suivante: une fois le jeu gelé, plus aucune image n'arrive, donc
    // elle ne pourrait jamais s'apercevoir que quelqu'un est revenu.
    //
    // Un demi-seconde entre deux regards. Le gel attend une minute de salle
    // vide, le réveil ne doit rien attendre du tout: quelqu'un qui arrive
    // regarde une image figée pendant ce délai-là.
    let container =
        std::env::var("NEL3AB_CONTAINER").unwrap_or_else(|_| "nel3ab-dolphin".to_owned());
    // Combien de temps la salle a passé en pause, en microsecondes, depuis le
    // démarrage.
    //
    // Sans ce compteur, une sieste était indiscernable d'une panne. Le worker
    // attend son image prochaine aussi longtemps que dure la pause, et
    // `waiting_max_ms` enregistrait cette attente: `just sessions` annonçait
    // « l'émulateur a fait attendre 6 310 436 ms » pour une salle qui dormait
    // une heure quarante-cinq. Sur les 63 tranches signalées en trois jours de
    // journal, 7 étaient des siestes.
    //
    // Retranché de l'attente là où l'attente est mesurée, et publié à part pour
    // que la sieste reste visible plutôt que gommée.
    let slept_micros = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let nap_thread = {
        let server = Arc::clone(&server);
        let stopping = Arc::clone(&stopping);
        let container = container.clone();
        let slept_micros = Arc::clone(&slept_micros);
        std::thread::Builder::new()
            .name("nap".to_owned())
            .spawn(move || {
                let mut nap = Nap::new();
                // Rempli quand le gel a RÉUSSI, vidé au réveil. Poser l'instant
                // avant de savoir si docker a suivi compterait comme dormie une
                // salle qui ne s'est jamais endormie.
                let mut asleep_since: Option<Instant> = None;
                while !stopping.load(std::sync::atomic::Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(500));
                    // Tout ce qui a besoin que la salle tourne, et pas seulement
                    // les spectateurs du grand format. Voir `nap::Busy`.
                    let busy = nap::Busy {
                        watching: server.watchers() + server.half_watchers(),
                        holding: server.pads_held(),
                        wanted: server.rom_wanted(),
                    };
                    let Some(what) = nap.saw(busy, Instant::now(), nap::GRACE) else {
                        continue;
                    };
                    // Le temps dormi est crédité AVANT de dégeler, et l'ordre
                    // est tout le sujet.
                    //
                    // Posé après, il arrivait trop tard: `docker unpause` rend
                    // la main, Dolphin repart et pousse une image dans la
                    // milliseconde, et la boucle d'images lisait le compteur
                    // avant que le fil de sieste ait fini d'y ajouter. Observé
                    // le 29 août 2026 sur la vraie salle, à la seconde près:
                    //
                    //   23:51:17  avertissement, attente 319 811 ms
                    //   23:51:17  tranche: dormi 0 ms, attente max 319 811 ms
                    //   23:51:17  Wake
                    //   23:51:27  tranche: dormi 319 795 ms, attente max 15 ms
                    //
                    // La sieste tombait donc dans la tranche SUIVANTE, et celle
                    // du réveil gardait l'attente entière: exactement le défaut
                    // que ce compteur existe pour supprimer.
                    //
                    // Crédité d'abord, il ne peut plus arriver en retard: rien
                    // ne peut produire une image tant que le dégel n'a pas été
                    // demandé. Le prix est de quelques millisecondes de sieste
                    // non comptées, celles de l'appel lui-même, et c'est le bon
                    // côté sur lequel se tromper.
                    if what == nap::Move::Wake
                        && let Some(since) = asleep_since.take()
                    {
                        let micros = u64::try_from(since.elapsed().as_micros()).unwrap_or(u64::MAX);
                        slept_micros.fetch_add(micros, std::sync::atomic::Ordering::Relaxed);
                    }
                    match tell_docker(&container, what) {
                        Ok(()) => {
                            if what == nap::Move::Sleep {
                                asleep_since = Some(Instant::now());
                            }
                            tracing::info!(?what, "le jeu a été gelé ou réveillé");
                        }
                        // Jamais fatal: une salle qui refuserait de servir parce
                        // qu'elle n'a pas su s'endormir serait cassée par une
                        // économie.
                        Err(error) => tracing::warn!(%error, ?what, "docker n'a pas suivi"),
                    }
                }
            })
    }?;

    let last_input = Arc::new(Mutex::new(None::<Instant>));
    let input_thread = {
        let applied = Arc::clone(&applied);
        let last_input = Arc::clone(&last_input);
        let server = Arc::clone(&server);
        let stopping = Arc::clone(&stopping);
        std::thread::Builder::new()
            .name("pad".to_owned())
            .spawn(move || {
                loop {
                    // A deadline rather than a wait forever, so this notices the
                    // session ending instead of outliving it.
                    let frames = server.wait_input(Duration::from_millis(250));
                    if stopping.load(std::sync::atomic::Ordering::Relaxed) {
                        break;
                    }
                    if frames.is_empty() {
                        continue;
                    }
                    for frame in &frames {
                        if let Err(error) = pad.send(frame) {
                            tracing::warn!(%error, "an input frame could not be delivered");
                        }
                    }
                    applied.fetch_add(
                        u64::try_from(frames.len()).unwrap_or(0),
                        std::sync::atomic::Ordering::Relaxed,
                    );
                    if let Ok(mut at) = last_input.lock() {
                        *at = Some(Instant::now());
                    }
                }
            })
            .context("starting the pad thread")?
    };

    // One clock for both streams, so a chunk of sound and a picture taken at the
    // same moment carry the same number.
    let started = Instant::now();

    // Sound rides its own thread because it has its own pace: the tap takes
    // 48000 frames a second, and a picture that takes 20 ms to encode must not
    // hold a chunk of sound back by 20 ms.
    // Chunks the tap had to invent because nothing was in the pipe. Reported
    // alongside everything else because it is what says the pipe is now too
    // small: it was shrunk from 64 KiB to 8 to cut 341 ms of standing delay, and
    // this is the counter that would show the cut going too far.
    let sound_starved = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let sound_thread = {
        let server = Arc::clone(&server);
        let stopping = Arc::clone(&stopping);
        let sound_starved = Arc::clone(&sound_starved);
        std::thread::Builder::new()
            .name("sound".to_owned())
            .spawn(move || {
                let mut sound = sound;
                let standing = sound.standing_delay();
                let mut chunk = [0_u8; CHUNK_BYTES];
                loop {
                    sound.next_chunk(&mut chunk);
                    if stopping.load(std::sync::atomic::Ordering::Relaxed) {
                        break;
                    }
                    // Dated back by what the pipe was holding, so the stamp
                    // names when this sound was PRODUCED rather than when we got
                    // round to reading it. Saturating, because the first chunks
                    // of a session are younger than the pipe is deep.
                    let captured = started.elapsed().saturating_sub(standing);
                    sound_starved.store(sound.starved(), std::sync::atomic::Ordering::Relaxed);
                    let _delivered = server.send_sound(
                        u64::try_from(captured.as_micros()).unwrap_or(u64::MAX),
                        &chunk,
                    );
                }
                tracing::info!(starved = sound.starved(), "the sound thread stood down");
            })
            .context("starting the sound thread")?
    };

    let mut produced = 0_u64;
    let mut coded_bytes = 0_u64;
    let mut reported_bytes = 0_u64;
    // Les pertes déjà rapportées, pour n'annoncer que celles de la tranche.
    // Ce que chaque spectateur avait perdu à la fenêtre précédente, par numéro.
    // Un spectateur qui part disparaît de la relève suivante, donc la table se
    // remplace en entier plutôt que de se mettre à jour: sinon elle grandirait
    // d'un souvenir par reconnexion, toute la soirée.
    let mut health_before: std::collections::HashMap<u64, (u64, u64, u64)> =
        std::collections::HashMap::new();
    let mut reported_dropped = 0_u64;
    let mut reported_half_dropped = 0_u64;
    let mut reported_slept = 0_u64;
    let mut reported = Instant::now();
    // When a pad state was last handed to the emulator, so the wait until the
    // next picture can be measured. This is the plumbing's share of input
    // latency and nothing more: the game's own logic adds frames on top, and
    // that part is the game's to spend.
    // Par `Timings` comme les quatre autres distributions, et pas par un
    // tableau et une fonction locale.
    //
    // Le défaut que ça corrige: la fonction locale rendait zéro sur un ensemble
    // vide, donc une tranche où personne n'avait appuyé annonçait « 0.0 ms »
    // comme s'il s'agissait d'un résultat exceptionnel. Sur trente heures de
    // journal, 5 936 tranches sur 10 694 disaient ça, soit 56 % de chiffres qui
    // n'en étaient pas. `Summary` porte le nombre d'échantillons dont il est
    // tiré, précisément parce qu'un percentile sans ce nombre ne se pèse pas.
    let mut input_to_frame = Timings::new(2048);
    // Where the time goes, per window. A stutter has to be attributable before
    // it can be fixed, and "the pipeline slowed down" names nothing.
    // One window per stage, drained on every report. A ten-second window holds
    // 600 frames; the cap is two thousand, which only a runaway loop could reach.
    let mut wait_times = Timings::new(2048);
    // Bytes per access unit. The tail of THIS is the key frame: one a second at
    // a one-second GOP, and what a network has to absorb in one burst.
    let mut frame_bytes = Timings::new(2048);
    let mut convert_times = Timings::new(2048);
    let mut encode_times = Timings::new(2048);

    loop {
        // Input first. A pad frame that arrived while the last picture was
        // encoding should reach the emulator before it renders the next one —
        // half a frame of latency, free, for putting this line above the wait.
        //
        // The transport hands back at most one state per port, because a pad is
        // a level and only the newest can ever be applied. The coalescing used
        // to live here over a 64-deep queue; it belongs where the states are
        // written, which is also where a queue could overflow and did.
        let iteration = Instant::now();
        let slept_before = slept_micros.load(std::sync::atomic::Ordering::Relaxed);
        // L'emprunt est rendu AVANT de toucher à `frames`.
        //
        // `next_frame` rend une image qui emprunte la source, donc le
        // vérificateur garde l'emprunt vivant sur tout un `match`, y compris
        // dans la branche d'erreur qui n'emprunte rien. Séparer la décision de
        // la prise est ce qui permet de reconstruire la chaîne ici plutôt que de
        // s'arrêter.
        let taken = frames.next_frame();
        if matches!(taken, Err(nel3ab_encoder::EncoderError::RingChanged { .. })) {
            drop(taken);
            // Un changement de taille n'est pas une panne, et le traiter comme
            // telle faisait tourner la salle en boucle sur deux jeux. Super
            // Mario Strikers présente ses menus à la taille native, et Mario
            // Power Tennis passe de 50 à 60 Hz, donc de 528 lignes à 448.
            //
            // La source a DÉJÀ adopté le nouvel anneau: il ne reste qu'à refaire
            // la chaîne, par le même chemin qu'au démarrage. Les anciennes
            // images importées sont détruites en étant remplacées, ce qui est
            // légal après la fermeture de leurs dma-buf, l'import ayant pris sa
            // propre référence sur l'objet.
            //
            // Le flux change alors de taille sous les yeux du navigateur. Il
            // sait faire: le nouvel encodeur commence par une image clé avec ses
            // en-têtes, et la page traverse déjà ça à chaque changement de jeu.
            pipeline = Pipeline::build(&context, &settings.render_node, &frames)?;
            // La taille a pu changer avec le jeu: on le redit.
            server.half_offered(pipeline.half.is_some());
            let now = *frames.descriptor();
            tracing::info!(
                width = now.width,
                height = now.height,
                slots = frames.slot_count(),
                "le jeu a changé la taille de son image; la chaîne a été refaite"
            );
            continue;
        }
        let frame = match taken {
            Ok(frame) => frame,
            Err(error) => {
                tracing::info!(%error, "the emulator stopped producing frames");
                break;
            }
        };
        let Some(source) = pipeline.sources.get(frame.slot() as usize) else {
            bail!(
                "the emulator announced slot {} outside its own ring",
                frame.slot()
            );
        };

        // The modulo first, so the value cast is always small:
        // grows without bound over a long session and the pool has three slots.
        let index = usize::try_from(produced % pipeline.targets.len() as u64).unwrap_or(0);
        let Some(target) = pipeline.targets.get(index) else {
            bail!("the encode pool shrank underneath us");
        };
        // The first frame after an input: how long the plumbing made it wait.
        if let Ok(mut slot) = last_input.lock()
            && let Some(at) = slot.take()
        {
            input_to_frame.observe(at.elapsed());
        }
        // L'attente, moins ce que la salle a passé en pause pendant cette
        // attente-là. Une salle qui dort n'est pas un émulateur qui hoquette, et
        // les confondre envoyait chercher une panne là où il n'y en avait pas.
        let napped = Duration::from_micros(
            slept_micros
                .load(std::sync::atomic::Ordering::Relaxed)
                .saturating_sub(slept_before),
        );
        let waited = nap::awake_wait(iteration.elapsed(), napped);
        // A ten-second summary says a stall HAPPENED; it cannot say WHEN, and
        // "when" is the only thing that lets a profile of the emulator be
        // aligned with it. Named at the instant, so a sampler running alongside
        // has something to line up against.
        if waited >= STALL {
            tracing::warn!(
                waited_ms = waited.as_secs_f64() * 1000.0,
                produced,
                "the emulator went quiet"
            );
        }
        // Le demi-format n'est encodé que si quelqu'un le regarde. Relu à chaque
        // image parce qu'on peut basculer en pleine partie, et ça ne coûte
        // qu'un verrou sur une liste de zéro à quatre éléments. Une salle où
        // tout le monde a une bonne connexion ne paie donc rien pour lui.
        let wanted_half = pipeline.half.is_some() && server.half_watchers() > 0;
        // Et la pleine taille aussi, ce qui manquait.
        //
        // Le demi-format se taisait déjà quand personne ne le regardait; la
        // pleine taille tournait toujours. Une salle vide faisait donc convertir
        // et encoder soixante images par seconde pour personne, mesuré à environ
        // six watts en continu le 18 août 2026 (trois paires alternées, étendue
        // de 4,0 à 6,6 W).
        //
        // Relu à chaque image, comme pour le demi-format: on peut arriver en
        // pleine partie, et ça ne coûte qu'un verrou sur une liste de zéro à
        // quatre éléments.
        let wanted_full = server.watchers() > 0;
        let shading = Instant::now();
        let plane = source.plane();
        let picture = Source {
            image: plane.image(),
            view: plane.view(),
            width: pipeline.descriptor.width,
            height: pipeline.descriptor.height,
            ownership: Ownership::Foreign,
        };
        if wanted_full {
            pipeline.converter.convert(picture, target)?;
        }
        // Ici et pas plus bas: la source appartient encore à l'émulateur jusqu'au
        // `drop(frame)` d'en dessous, et lire ses pixels après l'avoir rendue est
        // exactement la course que ce projet a déjà payée une fois.
        if wanted_half && let Some(small) = &pipeline.half {
            small.convert(picture, index)?;
        }
        let shader_took = shading.elapsed();
        // Released only now: the conversion has been waited on, so the emulator
        // cannot overwrite pixels the shader has not read.
        drop(frame);
        // Somebody just opened the page. Without this they see nothing until the
        // next scheduled IDR — up to a second with a one-second GOP.
        // Somebody just opened the page, or a page that already had one asked
        // for a new starting point: a decoder that died, a tab that came back.
        // Both want the same thing and one key frame answers both.
        if server.take_joined() || server.take_key_frame_request() {
            pipeline.encoder.force_key_frame();
        }
        // Quelqu'un veut autre chose au bout de sa Wiimote, et ça se fait SANS
        // rien arrêter — contrairement au changement de jeu juste en dessous,
        // qui stoppe le worker. Une extension n'est pas un appareil: Dolphin
        // l'échange en cours de partie, comme on débranche un Nunchuk pour
        // brancher une guitare sans éteindre la console.
        for (seat, code) in server.take_extension_requests() {
            let asked = nel3ab_emulator::Extension::from_code(code);
            if let Err(error) = hotplug.set_extension(seat, asked) {
                tracing::warn!(%error, slot = seat.get(), "l'extension n'a pas pu être branchée");
            } else {
                tracing::info!(
                    slot = seat.get(),
                    extension = asked.name(),
                    "extension branchée en cours de partie"
                );
            }
        }
        // Somebody chose another game. Dolphin takes its disc as a start-up
        // argument and has no way to be handed a different one, so switching
        // means a new emulator — a new frame ring, a new descriptor, a new
        // encoder. Rebuilding all that in place would be a second start-up path
        // living beside the real one and tested by nobody, and M4's control
        // plane will be starting and stopping workers anyway.
        //
        // So the worker writes the choice down and STOPS. systemd brings it back
        // within a couple of seconds on the new game, and the page reconnects on
        // its own because it already survives a worker restart. Worth noting
        // what this rests on: the exit path was broken until this week, and a
        // worker that cannot stop cannot have this feature at all.
        if let Some(index) = server.take_rom_request()
            && remember_choice(
                &library,
                index,
                saves::Slot::from_code(server.save_wanted()),
                nel3ab_emulator::PadKind::from_code(server.pad_wanted()),
                &settings.session_dir,
            )
        {
            break;
        }
        let encoding = Instant::now();

        let captured = started.elapsed();
        let slot_index = u32::try_from(index).unwrap_or(0);
        // L'image est TOUJOURS reprise et rendue à l'anneau, même sans public:
        // la garder bloquerait l'émulateur au bout de trois images. Ce qu'on
        // saute est le travail du GPU, pas la lecture.
        if let Some(coded) = wanted_full
            .then(|| pipeline.encoder.encode(slot_index))
            .transpose()?
            .flatten()
        {
            // What the stream actually costs a network. Latency says whether the
            // machine keeps up; this says whether the link can carry it, and
            // they are different questions with different answers.
            coded_bytes += coded.len() as u64;
            #[expect(
                clippy::cast_precision_loss,
                reason = "an access unit is tens of kilobytes; f64 is exact for \
                          every value this can hold"
            )]
            frame_bytes.record(coded.len() as f64);
            // The return value says whether a watcher was behind. Counted by
            // the server itself and reported below, so it is deliberately
            // discarded here rather than branched on.
            let _delivered = server.send(&Packet {
                captured_micros: u64::try_from(captured.as_micros()).unwrap_or(u64::MAX),
                annex_b: coded,
            });
        }
        if wanted_half && let Some(small) = &mut pipeline.half {
            small.encode_and_send(&server, slot_index, captured)?;
        }

        // La vibration que l'émulateur vient de demander, rendue à la page qui
        // tient cette manette. Une lecture non bloquante par image: le tube est
        // vide la plupart du temps, puisque seuls les CHANGEMENTS y passent.
        for shake in rumble.drain() {
            if let Ok(port) = PlayerSlot::new(shake.port) {
                server.rumble(port, shake.level);
            }
        }

        produced += 1;
        wait_times.observe(waited);
        convert_times.observe(shader_took);
        encode_times.observe(encoding.elapsed());

        if reported.elapsed() >= Duration::from_secs(10) {
            // Distributions, with the count they were drawn from. This used to
            // be four maxima, and a maximum cannot answer "did that change
            // help": it moves with the length of the run and describes exactly
            // one frame. `max` is still here, as a diagnostic and not as the
            // number to compare.
            let (wait, convert, encode) = (
                wait_times.summary(),
                convert_times.summary(),
                encode_times.summary(),
            );
            let bytes = frame_bytes.summary();
            let pressed = input_to_frame.summary();
            tracing::info!(
                produced,
                // Les deux flux séparément, et QUI les regarde.
                //
                // Sans ces quatre nombres, une ligne de ce journal ne peut pas
                // répondre à la seule question qu'on lui pose après coup: « son
                // image a sauté à telle seconde, est-ce que ça venait d'ici ? »
                // Zéro image jetée avec deux spectateurs répond non, et c'est
                // une réponse. Le même zéro sans savoir si quelqu'un regardait
                // n'en est pas une.
                watchers = server.watchers(),
                half_watchers = server.half_watchers(),
                // Une salle qui change de règle toute seule doit le dire: sans
                // cette ligne, personne ne comprend pourquoi quelqu'un a pu
                // lancer un jeu alors qu'il n'est pas propriétaire.
                owner_away = server.owner_away(),
                dropped = server.dropped(),
                half_dropped = server.half_dropped(),
                // Et les mêmes sur CETTE tranche de dix secondes.
                //
                // Les totaux seuls se lisent mal: après une mauvaise minute,
                // « 439 jetées » se répète sur toutes les lignes suivantes et
                // une soirée entière a l'air cassée. Un lecteur peut soustraire
                // deux lignes, mais pas quand le worker a redémarré entre les
                // deux, et c'est justement là qu'on regarde.
                dropped_now = server.dropped() - reported_dropped,
                half_dropped_now = server.half_dropped() - reported_half_dropped,
                inputs_received = server.inputs_received(),
                inputs_applied = applied.load(std::sync::atomic::Ordering::Relaxed),
                sound_starved = sound_starved.load(std::sync::atomic::Ordering::Relaxed),
                // Le temps passé en pause pendant cette tranche. Zéro veut
                // dire « la salle est restée éveillée », ce qui est une mesure
                // et pas une absence: le champ est écrit à chaque tranche.
                // En millisecondes entières, par `Duration` plutôt que par une
                // division: une sieste se compte en minutes, et un flottant y
                // ajouterait une précision dont personne n'a l'usage.
                slept_ms = u64::try_from(
                    Duration::from_micros(
                        slept_micros
                            .load(std::sync::atomic::Ordering::Relaxed)
                            .saturating_sub(reported_slept),
                    )
                    .as_millis(),
                )
                .unwrap_or(u64::MAX),
                frames = wait.samples,
                waiting_p50_ms = wait.p50,
                waiting_p95_ms = wait.p95,
                waiting_p99_ms = wait.p99,
                waiting_max_ms = wait.max,
                converting_p50_ms = convert.p50,
                converting_p95_ms = convert.p95,
                converting_max_ms = convert.max,
                encoding_p50_ms = encode.p50,
                encoding_p95_ms = encode.p95,
                encoding_p99_ms = encode.p99,
                encoding_max_ms = encode.max,
                frame_bytes_p50 = bytes.p50,
                frame_bytes_p95 = bytes.p95,
                frame_bytes_p99 = bytes.p99,
                frame_bytes_max = bytes.max,
                megabits_per_second = megabits(coded_bytes - reported_bytes, reported.elapsed()),
                // Le NOMBRE avant les percentiles: zéro échantillon veut dire
                // « personne n'a appuyé », pas « zéro milliseconde ».
                input_to_frame_samples = pressed.samples,
                input_to_frame_p50_ms = pressed.p50,
                input_to_frame_p95_ms = pressed.p95,
                "streaming"
            );

            // Chaque spectateur, un par un, et seulement ceux qui souffrent.
            //
            // # Pourquoi une ligne par personne
            //
            // La ligne du dessus est une somme, et une somme dit « la salle va
            // bien » tant que la MOYENNE va bien. Le 2026-09-04 quelqu'un a
            // rapporté un ami qui ramait pendant qu'elle affichait zéro image
            // jetée: c'était vrai, et ça ne parlait pas de lui.
            //
            // # Pourquoi un ÉCART et pas un cumul
            //
            // Un cumul ne dit jamais si ça se passe maintenant. Celui qui a
            // souffert une fois il y a une heure garderait son nombre pour la
            // soirée, et on chercherait une panne éteinte.
            //
            // # Pourquoi seulement ceux qui souffrent
            //
            // Une ligne par spectateur toutes les dix secondes noierait le
            // journal d'un « tout va bien » que la ligne du dessus dit déjà.
            // Les DEUX flux. Le demi-format est celui des liaisons les plus
            // étroites, donc de ceux qui ont le plus de chances de souffrir; ne
            // relever que le grand format laissait justement ceux-là invisibles.
            let everyone = server
                .viewer_health()
                .into_iter()
                .map(|one| ("plein", one))
                .chain(
                    server
                        .half_viewer_health()
                        .into_iter()
                        .map(|one| ("demi", one)),
                );
            for (stream, one) in everyone {
                let before = health_before.get(&one.tag).copied().unwrap_or((0, 0, 0));
                let lost = one.dropped.saturating_sub(before.0);
                let breaks = one.breaks.saturating_sub(before.1);
                let missed = one.starved.saturating_sub(before.2);
                if lost > 0 || breaks > 0 || missed > 0 || one.resyncing {
                    tracing::warn!(
                        viewer = one.tag,
                        stream,
                        dropped_now = lost,
                        breaks_now = breaks,
                        // Ce qu'il a vraiment manqué: `dropped` ne compte que le
                        // refus initial, et un gel d'une seconde à soixante
                        // images se lirait « une image jetée » sans celui-ci.
                        missed_now = missed,
                        // Les cumuls aussi: « il en a perdu trois » se lit
                        // autrement selon qu'il est là depuis dix secondes ou
                        // depuis deux heures.
                        dropped = one.dropped,
                        missed = one.starved,
                        delivered = one.delivered,
                        waiting_for_key = one.resyncing,
                        "ce spectateur ne suit pas"
                    );
                }
            }
            health_before = server
                .viewer_health()
                .into_iter()
                .chain(server.half_viewer_health())
                .map(|one| (one.tag, (one.dropped, one.breaks, one.starved)))
                .collect();

            reported = Instant::now();
            reported_bytes = coded_bytes;
            reported_dropped = server.dropped();
            reported_half_dropped = server.half_dropped();
            reported_slept = slept_micros.load(std::sync::atomic::Ordering::Relaxed);
            wait_times.clear();
            frame_bytes.clear();
            convert_times.clear();
            encode_times.clear();
            input_to_frame.clear();
        }
    }

    // Said once, to everybody. Both threads check it within their own wait —
    // 250 ms for the pad, 10 ms for the sound — so this returns promptly.
    stopping.store(true, std::sync::atomic::Ordering::Relaxed);
    drop(server);
    let _ = input_thread.join();
    let _ = sound_thread.join();
    let _ = nap_thread.join();
    // TOUJOURS réveiller avant d'arrêter, même si on ne pense pas dormir.
    //
    // Un conteneur en pause ne reçoit aucun signal: le `SIGTERM` de `shutdown`
    // n'atteindrait rien, l'escalade en `SIGKILL` tuerait le client docker, et
    // le jeu resterait gelé pour toujours pendant que le worker suivant en
    // lancerait un second à côté. C'est exactement l'émulateur orphelin qui a
    // volé les entrées pendant douze heures en août.
    //
    // Sans condition, parce que la condition serait un état à croire. Dégeler ce
    // qui n'est pas gelé rend une erreur qu'on ignore; oublier de dégeler coûte
    // une soirée.
    let _ = tell_docker(&container, nap::Move::Wake);
    session.shutdown()?;
    Ok(())
}

/// Writes down which game to boot next. `true` means the worker should stop.
///
/// A position the library does not have is refused rather than clamped: a page
/// asking for a game that is not there is a page holding a list somebody has
/// changed, and booting its neighbour instead is a surprise nobody asked for.
///
/// A choice that cannot be written down does NOT stop the worker either, and
/// that ordering is the point: stopping first and failing to record afterwards
/// would restart the room on the same game with no explanation.
fn remember_choice(
    library: &[Rom],
    index: u8,
    slot: saves::Slot,
    pads: nel3ab_emulator::PadKind,
    session_dir: &std::path::Path,
) -> bool {
    let Some(game) = library.get(index as usize) else {
        tracing::warn!(index, games = library.len(), "no such game");
        return false;
    };
    if let Err(error) = std::fs::write(session_dir.join(CHOICE), &game.file) {
        tracing::error!(%error, "the choice could not be written down");
        return false;
    }
    // L'emplacement de sauvegarde voyage avec le jeu, dans son propre fichier.
    // Un échec ici n'annule pas le changement de jeu: on repartira sur une
    // partie neuve, ce qui n'efface rien et se corrige d'un clic.
    // La manette voyage avec le reste. Un échec ici repart sur la manette
    // GameCube, ce qui est l'état d'avant et se corrige d'un clic.
    if let Err(error) = std::fs::write(session_dir.join(PAD_CHOICE), pads.code().to_string()) {
        tracing::warn!(%error, "la manette n'a pas pu être retenue");
    }
    if let Err(error) = std::fs::write(session_dir.join(SAVE_CHOICE), slot.code().to_string()) {
        tracing::warn!(%error, "l'emplacement de sauvegarde n'a pas pu être retenu");
    }
    tracing::info!(game = game.name, "booting another game; stopping for it");
    true
}

/// Structured JSON logs, level driven by `RUST_LOG`.
///
/// JSON because these lines are consumed by a log store, not read by a human on
/// a terminal — the same reason the Python side sets `serialize=True` outside dev.
fn init_tracing() {
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
}

/// Le second flux vidéo, en demi-format.
///
/// Une salle encode la même image deux fois: en pleine taille pour qui a le
/// débit, et deux fois plus petite de chaque côté pour qui ne l'a pas. Chacun
/// choisit sur la page, et personne ne subit le choix d'un autre — c'est ce que
/// « ne rien changer pour une bonne connexion » veut dire, et c'est pour ça que
/// tout ici est séparé plutôt que réglé.
///
/// Mesuré le 2026-08-17 sur lgf: en course, 14,3 Mbit/s en 1216x896 contre
/// 5,6 Mbit/s en 608x448, soit 2,6 fois moins.
///
/// Il est construit au démarrage et n'est ENCODÉ que si quelqu'un le regarde:
/// ouvrir un encodeur au milieu d'une partie coûte des dizaines de
/// millisecondes, et les surfaces ne coûtent qu'un peu de mémoire graphique.
/// Tout ce qui dépend de la TAILLE de l'anneau, rassemblé.
///
/// # Pourquoi c'est un bloc et pas cinq variables
///
/// Parce qu'un jeu peut changer de taille en cours de route, et qu'il faut alors
/// tout refaire d'un coup: les images importées viennent des nouveaux dma-buf,
/// le convertisseur est dimensionné pour la source, et l'encodeur pour la
/// sortie. Reconstruire à la main au milieu de la boucle donnerait une seconde
/// voie de démarrage à côté de la vraie, testée par personne.
///
/// Ici il n'y a qu'une voie, appelée deux fois. C'est la différence entre
/// dupliquer un chemin et le nommer.
struct Pipeline<'a> {
    /// La taille pour laquelle tout le reste a été construit.
    ///
    /// Rangée ICI et pas à côté, parce que la garder dehors est précisément le
    /// défaut qui a coûté la première tentative: la chaîne était refaite pour un
    /// anneau de 640x448 pendant qu'une variable du démarrage annonçait encore
    /// 1280x896 à chaque image. Le convertisseur refusait, à juste titre, et le
    /// worker sortait.
    ///
    /// Une grandeur qui décrit un objet vit dans cet objet. C'est la troisième
    /// fois que ce projet paie pour l'avoir laissée dehors, après la toile qui
    /// oscillait et la file qui ne suivait pas l'horaire.
    descriptor: FrameDescriptor,
    encoder: Encoder,
    sources: Vec<ImportedFrame<'a>>,
    targets: Vec<Nv12Target<'a>>,
    converter: Converter<'a>,
    half: Option<HalfStream<'a>>,
}

impl<'a> Pipeline<'a> {
    /// Construit la chaîne pour l'anneau que la source décrit EN CE MOMENT.
    ///
    /// Les deux anneaux sont importés une fois. Les emplacements sont stables
    /// tant que la taille ne bouge pas, et réimporter à chaque image
    /// réintroduirait le coût que toute cette architecture existe pour retirer.
    fn build(
        context: &'a Context,
        node: &std::path::Path,
        frames: &FrameSource,
    ) -> anyhow::Result<Self> {
        let descriptor = *frames.descriptor();
        let mut encoder = Encoder::open(node, descriptor.width, descriptor.height, QP, 60, 3)?;

        let mut sources = Vec::with_capacity(frames.slot_count());
        for index in 0..frames.slot_count() {
            let Some(buffer) = frames.slot(index) else {
                bail!("the ring announced slot {index} without a descriptor");
            };
            sources.push(ImportedFrame::import(context, &descriptor, buffer)?);
        }
        let mut targets = Vec::with_capacity(encoder.slots() as usize);
        for index in 0..encoder.slots() {
            let surface = encoder.export(index)?;
            targets.push(Nv12Target::import(context, &surface)?);
        }
        let converter = Converter::new(context)?;

        // Le second flux, en demi-format, pour qui n'a pas le débit du premier.
        //
        // Il est CONSTRUIT ici et n'est ENCODÉ que si quelqu'un le regarde: une
        // salle où tout le monde a une bonne connexion ne paie donc ni temps de
        // carte graphique ni octets pour qu'il existe. Construire les surfaces
        // au démarrage plutôt qu'à la demande évite d'ouvrir un encodeur au
        // milieu d'une partie, ce qui prend des dizaines de millisecondes.
        //
        // Une taille moitié ne convient pas toujours: l'encodeur veut un nombre
        // entier de macroblocs de 16, et 1216x896 le donne (608x448) là où une
        // résolution interne exotique pourrait ne pas. On le dit et on continue
        // sans, plutôt que de refuser de démarrer: le grand format, lui, marche.
        let half = HalfStream::open(context, node, descriptor.width, descriptor.height);

        Ok(Self {
            descriptor,
            encoder,
            sources,
            targets,
            converter,
            half,
        })
    }
}

struct HalfStream<'a> {
    encoder: Encoder,
    converter: Converter<'a>,
    targets: Vec<Nv12Target<'a>>,
}

impl<'a> HalfStream<'a> {
    /// Ouvre le flux, ou dit non sans empêcher la salle de démarrer.
    ///
    /// L'encodeur veut un nombre entier de macroblocs de seize, donc la moitié
    /// de l'image doit en être un multiple: c'est le cas de 1216x896, qui donne
    /// 608x448. Une résolution interne exotique pourrait ne pas convenir, et
    /// alors le grand format marche quand même. Refuser de démarrer pour ça
    /// serait une salle en panne pour une option.
    fn open(context: &'a Context, node: &Path, width: u32, height: u32) -> Option<Self> {
        if !width.is_multiple_of(32) || !height.is_multiple_of(32) {
            tracing::info!(
                width,
                height,
                "pas de demi-format: la moitié ne tombe pas juste"
            );
            return None;
        }
        let (half_width, half_height) = (width.div_euclid(2), height.div_euclid(2));
        let mut encoder = match Encoder::open(node, half_width, half_height, QP, 60, 3) {
            Ok(encoder) => encoder,
            Err(error) => {
                tracing::warn!(%error, "pas de demi-format: l'encodeur a refusé");
                return None;
            }
        };
        let converter = match Converter::halving(context) {
            Ok(converter) => converter,
            Err(error) => {
                tracing::warn!(%error, "pas de demi-format: le passage de réduction a refusé");
                return None;
            }
        };
        let mut targets = Vec::with_capacity(encoder.slots() as usize);
        for index in 0..encoder.slots() {
            let imported = encoder
                .export(index)
                .map_err(|error| tracing::warn!(%error, "pas de demi-format: export refusé"))
                .ok()
                .and_then(|surface| {
                    Nv12Target::import(context, &surface)
                        .map_err(
                            |error| tracing::warn!(%error, "pas de demi-format: import refusé"),
                        )
                        .ok()
                });
            targets.push(imported?);
        }
        tracing::info!(
            width = half_width,
            height = half_height,
            "le demi-format est disponible"
        );
        Some(Self {
            encoder,
            converter,
            targets,
        })
    }

    /// Réduit l'image du jeu dans la surface du petit encodeur.
    fn convert(&self, picture: Source, slot: usize) -> Result<()> {
        let Some(target) = self.targets.get(slot) else {
            bail!("the half-size encode pool shrank underneath us");
        };
        self.converter.convert(picture, target)?;
        Ok(())
    }

    /// Encode et envoie, à ceux qui regardent ce flux-là.
    ///
    /// L'image-clé est demandée ici et pas dans la boucle principale, parce
    /// qu'elle est propre à ce flux: celle du grand format ne répare pas
    /// celui-ci, et quelqu'un qui vient de basculer n'a rien demandé à l'autre.
    fn encode_and_send(
        &mut self,
        server: &BrowserServer,
        slot: u32,
        captured: Duration,
    ) -> Result<()> {
        if server.take_half_joined() || server.take_half_key_frame_request() {
            self.encoder.force_key_frame();
        }
        if let Some(coded) = self.encoder.encode(slot)? {
            let _delivered = server.send_half(&Packet {
                captured_micros: u64::try_from(captured.as_micros()).unwrap_or(u64::MAX),
                annex_b: coded,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    /// Two background threads must BOTH stop when the session ends.
    ///
    /// Red-first: replace the flag below with `Arc::strong_count(&held) != 1` —
    /// the shape this file carried until the sound thread appeared — and this
    /// fails. Two holders each waiting for the count to reach one wait for each
    /// other, so neither ever leaves. The `held` clone is here to make that
    /// substitution possible; the fix does not need it.
    ///
    /// It reports through a channel with a DEADLINE rather than joining, because
    /// a `join` on a thread that never exits does not fail, it hangs, and a test
    /// that hangs says nothing.
    #[test]
    fn both_background_threads_stop_when_the_session_does() {
        let server = Arc::new(());
        let stopping = Arc::new(AtomicBool::new(false));
        let (done, stopped) = std::sync::mpsc::channel::<&'static str>();

        for name in ["pad", "sound"] {
            let held = Arc::clone(&server);
            let stopping = Arc::clone(&stopping);
            let done = done.clone();
            std::thread::spawn(move || {
                while !stopping.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(5));
                }
                drop(held);
                let _ = done.send(name);
            });
        }
        drop(done);

        stopping.store(true, Ordering::Relaxed);
        drop(server);
        let mut left: Vec<&str> = Vec::new();
        for _ in 0..2 {
            left.push(
                stopped
                    .recv_timeout(Duration::from_secs(2))
                    .expect("a background thread never stopped"),
            );
        }
        left.sort_unstable();
        assert_eq!(left, ["pad", "sound"]);
    }
}
