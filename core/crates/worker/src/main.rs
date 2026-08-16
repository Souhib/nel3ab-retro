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
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, bail};
use nel3ab_emulator::{
    CHUNK_BYTES, DolphinConfig, Rom, Session, SlotSet, SoundTap, VideoBackend, catalogue_json,
    scan_roms,
};
use nel3ab_encoder::av::Encoder;
use nel3ab_encoder::frame_source::FrameListener;
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
    rom_dir: PathBuf,
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
            rom_dir: env_path("NEL3AB_ROM_DIR")
                .unwrap_or_else(|| PathBuf::from(&home).join("roms/gc")),
            dolphin: env_path("NEL3AB_DOLPHIN")
                .unwrap_or_else(|| repo.join("docker/dolphin-in-docker.sh")),
            dolphin_tool: env_path("NEL3AB_DOLPHIN_TOOL")
                .unwrap_or_else(|| repo.join("docker/dolphin-tool-in-docker.sh")),
            art_dir: env_path("NEL3AB_ART_DIR").unwrap_or_else(|| {
                env_path("XDG_CACHE_HOME")
                    .unwrap_or_else(|| PathBuf::from(&home).join(".cache"))
                    .join("nel3ab/banners")
            }),
            session_dir: env_path("NEL3AB_SESSION_DIR")
                .unwrap_or_else(|| PathBuf::from("/tmp/nel3ab-session")),
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
/// In the session directory, so it is forgotten on a reboot along with
/// everything else there. That is the behaviour worth having: a machine that
/// comes back up returns to its default game rather than to whatever somebody
/// picked before it went down.
const CHOICE: &str = "chosen-rom";

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
    let library = scan_roms(&settings.rom_dir);
    let rom = chosen_rom(settings, &library);
    let current = library.iter().position(|game| game.path == rom);
    tracing::info!(
        games = library.len(),
        booting = %rom.display(),
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
    let art = nel3ab_emulator::banner::gather(&library, &settings.dolphin_tool, &settings.art_dir);
    tracing::info!(
        with = art.iter().filter(|found| found.is_some()).count(),
        of = art.len(),
        "les jeux qui ont une jaquette"
    );

    let owner: OwnerSeat = Arc::new(Mutex::new(None));
    nel3ab_transport::control::serve(settings.control_bind, Arc::clone(&owner))?;

    let server = Arc::new(BrowserServer::start(
        settings.bind,
        PAGE,
        catalogue_json(&library, &art, current, settings.players.get()).into(),
        art.iter()
            .map(|found| found.as_ref().map(|art| Arc::from(art.png.as_slice())))
            .collect(),
        settings.players,
        &owner,
    )?);
    tracing::info!(address = %server.address(), "open this in a browser");

    let listener = FrameListener::bind(&socket)?;

    // A string because the override is one; parsed first so a typo stops the
    // worker instead of being handed to Dolphin, which would ignore it in
    // silence and leave us wondering why the picture never changed size.
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
    config.frame_socket = Some(socket);
    config.startup_timeout = Duration::from_mins(2);

    // The pipe has to exist, and be open for reading, before Dolphin looks for
    // it: ALSA's file plugin would otherwise create a plain file and the sound
    // would go quietly to disk.
    let sound = SoundTap::open(&settings.session_dir)?;
    tracing::info!(pipe = %sound.path().display(), "sound will come out here");

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
    let mut encoder = Encoder::open(
        &settings.render_node,
        descriptor.width,
        descriptor.height,
        QP,
        60,
        3,
    )?;

    // Both rings are imported ONCE. The slots are stable for the life of the
    // session, and re-importing per frame would reintroduce the per-frame cost
    // this whole architecture exists to remove.
    let mut sources = Vec::with_capacity(frames.slot_count());
    for index in 0..frames.slot_count() {
        let Some(buffer) = frames.slot(index) else {
            bail!("the ring announced slot {index} without a descriptor");
        };
        sources.push(ImportedFrame::import(&context, &descriptor, buffer)?);
    }
    let mut targets = Vec::with_capacity(encoder.slots() as usize);
    for index in 0..encoder.slots() {
        let surface = encoder.export(index)?;
        targets.push(Nv12Target::import(&context, &surface)?);
    }
    let converter = Converter::new(&context)?;

    // Input runs on its own thread, writing the moment a frame lands rather than
    // once per picture. Measured before: a full frame period of avoidable lag,
    // p50 15.55 ms, because a write locked to the frame notification always
    // landed just after the emulator polled its pipe.
    let pad = session.pad_writer();
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
    let mut reported = Instant::now();
    // When a pad state was last handed to the emulator, so the wait until the
    // next picture can be measured. This is the plumbing's share of input
    // latency and nothing more: the game's own logic adds frames on top, and
    // that part is the game's to spend.
    let mut input_to_frame: Vec<f64> = Vec::new();
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
        let frame = match frames.next_frame() {
            Ok(frame) => frame,
            Err(error) => {
                tracing::info!(%error, "the emulator stopped producing frames");
                break;
            }
        };
        let Some(source) = sources.get(frame.slot() as usize) else {
            bail!(
                "the emulator announced slot {} outside its own ring",
                frame.slot()
            );
        };

        // The modulo first, so the value cast is always small:
        // grows without bound over a long session and the pool has three slots.
        let index = usize::try_from(produced % targets.len() as u64).unwrap_or(0);
        let Some(target) = targets.get(index) else {
            bail!("the encode pool shrank underneath us");
        };
        // The first frame after an input: how long the plumbing made it wait.
        if let Ok(mut slot) = last_input.lock()
            && let Some(at) = slot.take()
        {
            input_to_frame.push(at.elapsed().as_secs_f64() * 1000.0);
        }
        let waited = iteration.elapsed();
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
        let shading = Instant::now();
        let plane = source.plane();
        converter.convert(
            Source {
                image: plane.image(),
                view: plane.view(),
                width: descriptor.width,
                height: descriptor.height,
                ownership: Ownership::Foreign,
            },
            target,
        )?;
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
            encoder.force_key_frame();
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
            && remember_choice(&library, index, &settings.session_dir)
        {
            break;
        }
        let encoding = Instant::now();

        let captured = started.elapsed();
        let slot_index = u32::try_from(index).unwrap_or(0);
        if let Some(coded) = encoder.encode(slot_index)? {
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
            tracing::info!(
                produced,
                dropped = server.dropped(),
                inputs_received = server.inputs_received(),
                inputs_applied = applied.load(std::sync::atomic::Ordering::Relaxed),
                sound_starved = sound_starved.load(std::sync::atomic::Ordering::Relaxed),
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
                input_to_frame_p50_ms = percentile(&mut input_to_frame, 0.50),
                input_to_frame_p95_ms = percentile(&mut input_to_frame, 0.95),
                "streaming"
            );
            reported = Instant::now();
            reported_bytes = coded_bytes;
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
fn remember_choice(library: &[Rom], index: u8, session_dir: &std::path::Path) -> bool {
    let Some(game) = library.get(index as usize) else {
        tracing::warn!(index, games = library.len(), "no such game");
        return false;
    };
    if let Err(error) = std::fs::write(session_dir.join(CHOICE), &game.file) {
        tracing::error!(%error, "the choice could not be written down");
        return false;
    }
    tracing::info!(game = game.name, "booting another game; stopping for it");
    true
}

/// A percentile of a sample set, in the units the samples carry.
///
/// Sorts in place: the caller clears the set each window and has no use for the
/// order it collected them in. Zero for an empty set, which reads as "nobody
/// pressed anything" rather than as a suspiciously good number.
fn percentile(samples: &mut [f64], quantile: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    samples.sort_by(f64::total_cmp);
    #[allow(
        clippy::cast_precision_loss,
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "an index into a few hundred samples; nothing here is near a limit"
    )]
    let index = ((samples.len() - 1) as f64 * quantile) as usize;
    samples[index]
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
