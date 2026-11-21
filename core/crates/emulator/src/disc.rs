//! Quelle console un disque demande, lue sur le disque.
//!
//! # Pourquoi le demander plutôt que le déduire
//!
//! La tentation était de ranger les jeux Wii dans `roms/wii` et d'en conclure la
//! console. Ça marche jusqu'au jour où quelqu'un déplace un fichier, et alors ça
//! échoue en silence: la salle proposerait des sauvegardes de carte mémoire à un
//! jeu Wii, qui n'en a pas. Un nom de dossier est une convention; le disque, lui,
//! est l'autorité.
//!
//! `dolphin-tool header` répond sur les deux, et la différence est franche: un
//! disque Wii porte un **Title ID**, un disque `GameCube` n'en a pas. C'est
//! l'outil de Dolphin qui le dit, donc le même code qui bootera le jeu.
//!
//! # Trois réponses et pas deux
//!
//! On ne sait pas toujours. Un outil qui n'a pas pu démarrer ne prouve rien, et
//! répondre « GameCube » par défaut ferait exactement le mensonge qu'on cherche
//! à éviter. [`Console::Unknown`] existe pour ça, et ce qui en dépend choisit la
//! prudence plutôt que le confort.

use std::path::{Path, PathBuf};
use std::process::Command;

use crate::library::Rom;

/// Ce qu'un disque est, et où il rangera sa partie.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Disc {
    /// La console qui le demande.
    pub console: Console,
    /// L'identifiant de titre, seize chiffres hexadécimaux, pour un disque Wii.
    ///
    /// C'est lui qui donne le chemin de la sauvegarde dans la console:
    /// `Wii/title/00010004/524d4350/data` pour Mario Kart Wii en PAL. Il vient
    /// de l'outil, jamais d'un calcul sur le code de jeu: la moitié haute change
    /// selon le type de titre, et la deviner marcherait sur les disques essayés
    /// puis se tromperait sur le premier qui sort du lot.
    pub title: Option<String>,
}

/// Ce qu'un disque demande.
///
/// Chaque variante, sauf [`Console::Unknown`], a exactement une entrée dans
/// `consoles/consoles.json` à la racine du dépôt (ADR D22), et chaque capacité
/// ci-dessous y est écrite aussi. Le test `the_manifest_and_the_enum_agree` relit
/// le fichier et refuse le moindre écart, dans les deux sens. Les capacités
/// restent des `const fn` plutôt qu'une lecture du fichier au démarrage: un
/// manifeste illisible ne peut alors pas arrêter une salle, il arrête la porte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Console {
    /// Une carte mémoire, donc deux emplacements de sauvegarde possibles.
    GameCube,
    /// La NAND de la console, donc une seule partie et pas de choix à proposer.
    Wii,
    /// Registered Switch application, launched by the separate Ryubing adapter.
    Switch,
    /// Registered Switch 2 application, launched by its experimental adapter.
    Switch2,
    /// Décrite et pas jouable: aucun adaptateur Xenia n'existe encore, et rien
    /// n'inscrit un jeu sous cette console. Voir [`Console::playable`].
    Xbox360,
    /// Le disque n'a pas répondu. Voir le module: ce n'est pas « GameCube ».
    Unknown,
}

/// Comment l'état d'une manette traverse le fil pour cette console.
///
/// C'était le premier des cinq sens de l'ancien `is_switch()`. Il décide du
/// format que la socket de manette accepte, et de l'appareil annoncé à la page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputFrame {
    /// La trame GameCube de treize octets, écrite dans les tubes de Dolphin.
    Dolphin,
    /// La trame de manette Pro, relayée aux manettes virtuelles d'un adaptateur.
    Pro,
}

impl InputFrame {
    /// Le nom écrit dans le manifeste.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Dolphin => "dolphin",
            Self::Pro => "pro",
        }
    }

    /// L'appareil présenté à chaque place, quand ce format n'en connaît qu'un.
    ///
    /// Le code 4 est la manette Pro, pour les quatre places. Une console Dolphin
    /// présente l'appareil choisi par la préparation, donc rien d'imposé ici.
    #[must_use]
    pub const fn device(self) -> Option<u8> {
        match self {
            Self::Dolphin => None,
            Self::Pro => Some(4),
        }
    }
}

/// L'adaptateur externe qui fait tourner une console hors du worker.
///
/// Le deuxième sens de l'ancien `is_switch()`: le chemin `External` plutôt que
/// Dolphin dans le processus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Adapter {
    /// Le script par défaut, relatif à la racine du dépôt.
    pub script: &'static str,
    /// La variable d'environnement qui remplace ce script.
    pub script_env: &'static str,
    /// La variable qui nomme la configuration privée de l'adaptateur, d'où
    /// vient la racine de ses sauvegardes.
    pub config_env: &'static str,
}

/// Le verrou de machine qu'une console partage avec d'autres.
///
/// Le troisième sens de l'ancien `is_switch()`. Séparé exprès: une console
/// rétro servie par un adaptateur ne doit pas passer sous le verrou Switch
/// parce qu'elle parle la même trame de manette.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockGroup {
    /// « Une seule Switch sur la machine », décidé le 12 septembre 2026.
    Switch,
}

impl LockGroup {
    /// Le nom écrit dans le manifeste.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Switch => "switch",
        }
    }
}

/// Où se trouve l'image d'un jeu. Le quatrième sens de l'ancien `is_switch()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtSource {
    /// La bannière du disque, extraite par `dolphin-tool`.
    Banner,
    /// L'image posée à plat dans la sauvegarde d'un jeu Wii.
    WiiSave,
    /// Le PNG posé à côté du jeu, `<fichier>.nel3ab.png`.
    Sidecar,
}

impl ArtSource {
    /// Le nom écrit dans le manifeste.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::Banner => "banner",
            Self::WiiSave => "wii-save",
            Self::Sidecar => "sidecar",
        }
    }
}

/// Comment un fichier devient un jeu de cette console.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Registration {
    /// Son extension Dolphin, puis `dolphin-tool header`. Voir le module.
    DolphinHeader,
    /// Une fiche `<fichier>.nel3ab.json` à côté du jeu, écrite à la main ou par
    /// l'import du salon. Voir [`crate::switch`].
    Sidecar,
    /// Aucune: le balayage n'inscrit rien sous cette console.
    None,
}

impl Registration {
    /// Le nom écrit dans le manifeste.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::DolphinHeader => "dolphin-header",
            Self::Sidecar => "sidecar",
            Self::None => "none",
        }
    }
}

impl Console {
    /// Les consoles du manifeste, dans son ordre. [`Console::Unknown`] n'y est
    /// pas: c'est une réponse de l'outil, pas une console.
    pub const KNOWN: [Self; 5] = [
        Self::GameCube,
        Self::Wii,
        Self::Switch,
        Self::Switch2,
        Self::Xbox360,
    ];

    /// Ce qu'on en écrit sur le fil et dans le cache.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::GameCube => "gc",
            Self::Wii => "wii",
            Self::Switch => "switch",
            Self::Switch2 => "switch2",
            Self::Xbox360 => "x360",
            Self::Unknown => "?",
        }
    }

    /// La console qu'un code du manifeste nomme. `?` n'en nomme aucune.
    #[must_use]
    pub fn from_code(code: &str) -> Option<Self> {
        Self::KNOWN
            .into_iter()
            .find(|console| console.code() == code)
    }

    /// Le format des trames de manette de cette console.
    ///
    /// Un disque inconnu garde la trame Dolphin, puisque c'est Dolphin qui le
    /// lancera: c'était le comportement d'avant la séparation.
    #[must_use]
    pub const fn input_frame(self) -> InputFrame {
        match self {
            Self::Switch | Self::Switch2 | Self::Xbox360 => InputFrame::Pro,
            Self::GameCube | Self::Wii | Self::Unknown => InputFrame::Dolphin,
        }
    }

    /// L'adaptateur externe, ou rien quand Dolphin tourne dans le worker.
    #[must_use]
    pub const fn adapter(self) -> Option<Adapter> {
        match self {
            Self::Switch => Some(Adapter {
                script: "docker/switch-room.py",
                script_env: "NEL3AB_SWITCH_ADAPTER",
                config_env: "NEL3AB_SWITCH_CONFIG",
            }),
            Self::Switch2 => Some(Adapter {
                script: "docker/switch2-room.py",
                script_env: "NEL3AB_SWITCH2_ADAPTER",
                config_env: "NEL3AB_SWITCH2_CONFIG",
            }),
            // Réservé et lu par personne: `playable` arrête la salle avant.
            Self::Xbox360 => Some(Adapter {
                script: "docker/xbox360-room.py",
                script_env: "NEL3AB_XBOX360_ADAPTER",
                config_env: "NEL3AB_XBOX360_CONFIG",
            }),
            Self::GameCube | Self::Wii | Self::Unknown => None,
        }
    }

    /// Le verrou de machine que cette console prend avant de démarrer.
    #[must_use]
    pub const fn lock_group(self) -> Option<LockGroup> {
        match self {
            Self::Switch | Self::Switch2 => Some(LockGroup::Switch),
            Self::GameCube | Self::Wii | Self::Xbox360 | Self::Unknown => None,
        }
    }

    /// Où trouver l'image d'un jeu de cette console.
    #[must_use]
    pub const fn art_source(self) -> ArtSource {
        match self {
            Self::Switch | Self::Switch2 | Self::Xbox360 => ArtSource::Sidecar,
            Self::Wii => ArtSource::WiiSave,
            Self::GameCube | Self::Unknown => ArtSource::Banner,
        }
    }

    /// Comment un fichier devient un jeu de cette console.
    #[must_use]
    pub const fn registration(self) -> Registration {
        match self {
            Self::GameCube | Self::Wii => Registration::DolphinHeader,
            Self::Switch | Self::Switch2 => Registration::Sidecar,
            Self::Xbox360 | Self::Unknown => Registration::None,
        }
    }

    /// Les extensions qu'un fichier de cette console peut porter.
    #[must_use]
    pub const fn extensions(self) -> &'static [&'static str] {
        match self {
            Self::GameCube | Self::Wii => &crate::library::PLAYABLE,
            Self::Switch => &["xci", "nsp"],
            Self::Switch2 => &["nup"],
            Self::Xbox360 => &["iso", "xex"],
            Self::Unknown => &[],
        }
    }

    /// Le dossier de `~/roms` où cette console range ses jeux, par convention.
    ///
    /// Une convention et pas une preuve: le disque reste l'autorité (voir le
    /// module). Il sert aux dossiers par défaut quand `NEL3AB_ROM_DIR` manque.
    #[must_use]
    pub const fn folder(self) -> Option<&'static str> {
        match self {
            Self::GameCube => Some("gc"),
            Self::Wii => Some("wii"),
            Self::Switch => Some("switch"),
            Self::Switch2 => Some("switch2"),
            Self::Xbox360 => Some("xbox360"),
            Self::Unknown => None,
        }
    }

    /// Faux quand la salle doit refuser de lancer un jeu de cette console.
    ///
    /// Un disque inconnu reste jouable: Dolphin le lance depuis toujours, par le
    /// chemin en deux pressions de la page.
    #[must_use]
    pub const fn playable(self) -> bool {
        !matches!(self, Self::Xbox360)
    }

    /// Vrai pour une console que la page doit dire expérimentale.
    #[must_use]
    pub const fn experimental(self) -> bool {
        matches!(self, Self::Switch2 | Self::Xbox360)
    }

    /// The validated room limit, bounded again by the operator's configuration.
    ///
    /// The initial Switch 2 integration validates one player and spectators.
    /// This is a limit of our adapter, not a claim about the physical console.
    #[must_use]
    pub const fn player_limit(self) -> u8 {
        if matches!(self, Self::Switch2) { 1 } else { 4 }
    }

    /// Ce que le disque a répondu, tel que `dolphin-tool header` l'écrit.
    ///
    /// La ligne `Title ID` n'existe que pour un volume Wii. Chercher CETTE ligne
    /// plutôt que compter les autres: une version de l'outil qui ajouterait un
    /// champ ne doit pas changer la réponse.
    #[must_use]
    pub fn from_header(said: &str) -> Self {
        Disc::from_header(said).console
    }
}

impl Disc {
    /// Ce que le disque a répondu, avec le titre quand il en a un.
    #[must_use]
    pub fn from_header(said: &str) -> Self {
        let field = |name: &str| {
            said.lines()
                .find_map(|line| line.trim().strip_prefix(name))
                .map(|rest| rest.trim().to_owned())
                .filter(|found| !found.is_empty())
        };
        if let Some(title) = field("Title ID:") {
            return Self {
                console: Console::Wii,
                title: Some(title),
            };
        }
        Self {
            console: if field("Game ID:").is_some() {
                Console::GameCube
            } else {
                Console::Unknown
            },
            title: None,
        }
    }

    /// Ce qu'on garde en cache, et qu'on relira au démarrage suivant.
    #[must_use]
    fn code(&self) -> String {
        match (self.console, &self.title) {
            (Console::Wii, Some(title)) => format!("wii:{title}"),
            (console, _) => console.code().to_owned(),
        }
    }

    /// Ce que le cache dit, ou RIEN quand on ne sait pas le lire.
    ///
    /// Rien plutôt qu'« inconnu », et la différence a mordu tout de suite: une
    /// version précédente écrivait `wii` sans l'identifiant du titre. Relire ça
    /// comme « console inconnue » faisait ranger la partie d'un jeu Wii dans une
    /// carte mémoire, en silence, et le cache gardait l'erreur pour toujours.
    /// Une entrée qu'on ne sait pas lire est une entrée à redemander.
    fn from_code(kept: &str) -> Option<Self> {
        let kept = kept.trim();
        if let Some(title) = kept.strip_prefix("wii:") {
            return (!title.is_empty()).then(|| Self {
                console: Console::Wii,
                title: Some(title.to_owned()),
            });
        }
        (kept == "gc").then_some(Self {
            console: Console::GameCube,
            title: None,
        })
    }
}

/// La console de chaque jeu, dans le même ordre que la bibliothèque.
///
/// Gardée en cache à côté des jaquettes, et pour la même raison: c'est un
/// conteneur par disque, et une salle qui redémarre trois fois par soirée les
/// paierait trois fois.
#[must_use]
pub fn discs(roms: &[Rom], tool: &Path, cache: &Path) -> Vec<Disc> {
    roms.iter().map(|rom| disc_of(rom, tool, cache)).collect()
}

/// Les consoles seules, quand le titre n'intéresse pas l'appelant.
#[must_use]
pub fn consoles(roms: &[Rom], tool: &Path, cache: &Path) -> Vec<Console> {
    discs(roms, tool, cache)
        .into_iter()
        .map(|disc| disc.console)
        .collect()
}

fn disc_of(rom: &Rom, tool: &Path, cache: &Path) -> Disc {
    if let Some(game) = crate::switch::registered(&rom.path) {
        return Disc {
            console: game.console,
            title: Some(game.title),
        };
    }
    let kept = cache_file(rom, cache);
    if let Ok(said) = std::fs::read_to_string(&kept)
        && let Some(found) = Disc::from_code(&said)
    {
        return found;
    }
    let Ok(output) = Command::new(tool)
        .arg("header")
        .arg("-i")
        .arg(&rom.path)
        .output()
    else {
        tracing::info!(rom = %rom.name, "la console de ce disque reste inconnue");
        return Disc {
            console: Console::Unknown,
            title: None,
        };
    };
    let found = Disc::from_header(&String::from_utf8_lossy(&output.stdout));
    // On ne garde que ce qui est SU. Écrire « inconnu » figerait un échec
    // passager de Docker pour toutes les soirées suivantes.
    if found.console != Console::Unknown
        && let Err(error) = std::fs::write(&kept, found.code())
    {
        tracing::warn!(?kept, %error, "la console a été lue mais pas gardée");
    }
    found
}

/// Le fichier de cache d'un jeu: son nom et sa taille, comme pour les jaquettes.
fn cache_file(rom: &Rom, cache: &Path) -> PathBuf {
    let size = std::fs::metadata(&rom.path).map_or(0, |found| found.len());
    let stem: String = rom
        .file
        .chars()
        .map(|letter| {
            if letter.is_alphanumeric() {
                letter
            } else {
                '-'
            }
        })
        .collect();
    cache.join(format!("{stem}-{size}.console"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ce que l'outil écrit vraiment, relevé le 30 août 2026 sur les deux
    /// disques de cette collection.
    const WII: &str = "Block Size: 131072\nInternal Name: MarioKartWii\nRevision: 0\nGame ID: RMCP01\nTitle ID: 00010004524d4350\nRegion: PAL\n";
    const GAMECUBE: &str = "Block Size: 131072\nInternal Name: MarioParty4\nRevision: 2\nGame ID: GMPP01\nRegion: PAL\n";

    #[test]
    fn the_title_travels_with_the_console() {
        // C'est lui qui donne le chemin de la sauvegarde dans la console. Le
        // déduire du code de jeu marcherait sur les disques essayés puis se
        // tromperait: la moitié haute change selon le type de titre.
        let read = Disc::from_header(WII);

        assert_eq!(read.console, Console::Wii);
        assert_eq!(read.title.as_deref(), Some("00010004524d4350"));
    }

    #[test]
    fn a_gamecube_disc_has_no_title_to_carry() {
        // Le jumeau: un lecteur qui rendrait toujours un titre ferait chercher un
        // dossier de console à un jeu qui n'en a pas.
        assert_eq!(Disc::from_header(GAMECUBE).title, None);
    }

    #[test]
    fn what_is_cached_is_what_comes_back() {
        // Le cache est relu au démarrage suivant. S'il perdait le titre, la
        // sauvegarde d'un jeu Wii repartirait au mauvais endroit après un simple
        // redémarrage, et rien ne le dirait.
        for said in [WII, GAMECUBE] {
            let read = Disc::from_header(said);
            assert_eq!(
                Disc::from_code(&read.code()),
                Some(read.clone()),
                "pour {said:?}"
            );
        }
    }

    #[test]
    fn a_cache_entry_we_cannot_read_is_one_to_ask_again() {
        // Le défaut du 30 août 2026: une version précédente écrivait `wii` sans
        // l'identifiant du titre. Le relire comme « console inconnue » faisait
        // ranger la partie d'un jeu Wii dans une carte mémoire, en silence, et le
        // cache gardait l'erreur pour toujours.
        for stale in ["", "wii", "wii:", "n'importe quoi"] {
            assert_eq!(
                Disc::from_code(stale),
                None,
                "« {stale} » doit être redemandé"
            );
        }
    }

    #[test]
    fn a_title_id_means_wii() {
        assert_eq!(Console::from_header(WII), Console::Wii);
    }

    #[test]
    fn no_title_id_means_gamecube() {
        // Le jumeau, et il porte la règle: c'est l'ABSENCE de cette ligne qui
        // distingue, donc un lecteur qui répondrait toujours « Wii » passerait le
        // test au-dessus sans rien distinguer.
        assert_eq!(Console::from_header(GAMECUBE), Console::GameCube);
    }

    #[test]
    fn silence_is_not_a_gamecube() {
        // Un outil qui n'a pas pu démarrer ne prouve rien. Répondre « GameCube »
        // ferait proposer des sauvegardes de carte mémoire à un jeu Wii, qui n'en
        // a pas: exactement le mensonge que ce module existe pour éviter.
        assert_eq!(Console::from_header(""), Console::Unknown);
        assert_eq!(
            Console::from_header("docker: cannot connect to the daemon"),
            Console::Unknown
        );
    }

    #[test]
    fn a_field_added_later_changes_nothing() {
        // La règle cherche UNE ligne nommée, elle ne compte pas les autres: une
        // version de l'outil qui en ajoute ne doit pas changer le verdict.
        let richer = format!("{GAMECUBE}Disc Number: 0\nApploader Date: 2004/03/03\n");
        assert_eq!(Console::from_header(&richer), Console::GameCube);
    }

    /// Le manifeste que le dépôt porte, relu à chaque compilation des tests.
    const MANIFEST: &str = include_str!("../../../../consoles/consoles.json");

    /// Tout ce qui sépare le manifeste de ce que ce crate décide, nommé.
    ///
    /// Une liste plutôt qu'un `assert` par champ: le jumeau négatif ci-dessous
    /// doit pouvoir exiger QUELLE divergence a été vue, et un test qui s'arrête
    /// au premier écart ne dirait rien des suivants.
    fn disagreements(manifest: &serde_json::Value) -> Vec<String> {
        let mut found = Vec::new();
        let Some(entries) = manifest["consoles"].as_array() else {
            return vec!["le manifeste n'a pas de liste « consoles »".into()];
        };
        let codes: Vec<&str> = entries.iter().filter_map(|e| e["code"].as_str()).collect();
        let known: Vec<&str> = Console::KNOWN.iter().map(|c| c.code()).collect();
        if codes != known {
            found.push(format!(
                "consoles du manifeste {codes:?}, du crate {known:?}"
            ));
        }
        for entry in entries {
            let code = entry["code"].as_str().unwrap_or("");
            let Some(console) = Console::from_code(code) else {
                found.push(format!("{code}: aucune variante de Console"));
                continue;
            };
            for (what, manifest, crate_says) in compared(console, entry) {
                if manifest != crate_says {
                    found.push(format!(
                        "{code}.{what}: manifeste {manifest}, crate {crate_says}"
                    ));
                }
            }
        }
        found
    }

    /// Chaque champ du manifeste, à côté de ce que le crate décide, écrits tous
    /// deux en JSON pour que la comparaison ne dépende d'aucun format choisi ici.
    fn compared(console: Console, entry: &serde_json::Value) -> Vec<(String, String, String)> {
        let json = |value: serde_json::Value| value.to_string();
        let adapter = console.adapter();
        let form = &entry["form"];
        let mut pairs = vec![
            (
                "players",
                json(entry["players"].clone()),
                json(console.player_limit().into()),
            ),
            (
                "input",
                json(entry["input"].clone()),
                json(console.input_frame().code().into()),
            ),
            (
                "form.kind",
                json(form["kind"].clone()),
                json(
                    if adapter.is_some() {
                        "external"
                    } else {
                        "internal"
                    }
                    .into(),
                ),
            ),
            (
                "form.script",
                json(form["script"].clone()),
                json(adapter.map(|a| a.script).into()),
            ),
            (
                "form.script_env",
                json(form["script_env"].clone()),
                json(adapter.map(|a| a.script_env).into()),
            ),
            (
                "form.config_env",
                json(form["config_env"].clone()),
                json(adapter.map(|a| a.config_env).into()),
            ),
            (
                "lock",
                json(entry["lock"].clone()),
                json(console.lock_group().map(LockGroup::code).into()),
            ),
            (
                "art",
                json(entry["art"].clone()),
                json(console.art_source().code().into()),
            ),
            (
                "registration",
                json(entry["registration"].clone()),
                json(console.registration().code().into()),
            ),
            (
                "extensions",
                json(entry["extensions"].clone()),
                json(console.extensions().into()),
            ),
            (
                "folder",
                json(entry["folder"].clone()),
                json(console.folder().into()),
            ),
            (
                "playable",
                json(entry["playable"].clone()),
                json(console.playable().into()),
            ),
            (
                "experimental",
                json(entry["experimental"].clone()),
                json(console.experimental().into()),
            ),
        ];
        // L'appareil imposé par la trame Pro est la liste entière du manifeste.
        if let Some(device) = console.input_frame().device() {
            pairs.push((
                "devices",
                json(entry["devices"].clone()),
                json(vec![device].into()),
            ));
        }
        pairs
            .into_iter()
            .map(|(what, manifest, crate_says)| (what.to_owned(), manifest, crate_says))
            .collect()
    }

    #[test]
    fn the_manifest_and_the_enum_agree() -> Result<(), Box<dyn std::error::Error>> {
        let manifest: serde_json::Value = serde_json::from_str(MANIFEST)?;
        assert_eq!(disagreements(&manifest), Vec::<String>::new());
        Ok(())
    }

    /// Le jumeau: un contrôle qui ne verrait rien passerait aussi le test du
    /// dessus. Une console ajoutée au seul manifeste, et un verrou changé au seul
    /// manifeste, doivent chacun être nommés.
    #[test]
    fn a_console_or_a_capability_changed_on_one_side_is_named()
    -> Result<(), Box<dyn std::error::Error>> {
        let mut extra: serde_json::Value = serde_json::from_str(MANIFEST)?;
        if let Some(entries) = extra["consoles"].as_array_mut() {
            entries.push(serde_json::json!({"code": "fake", "players": 4}));
        }
        let found = disagreements(&extra);
        assert!(
            found
                .iter()
                .any(|it| it == "fake: aucune variante de Console"),
            "{found:?}"
        );

        let mut unlocked: serde_json::Value = serde_json::from_str(MANIFEST)?;
        unlocked["consoles"][3]["lock"] = serde_json::Value::Null;
        let found = disagreements(&unlocked);
        assert_eq!(
            found,
            ["switch2.lock: manifeste null, crate \"switch\""],
            "seul le verrou de la Switch 2 diffère"
        );
        Ok(())
    }

    /// Les cinq sens de l'ancien `is_switch()`, tenus séparément. Le cas qui a
    /// motivé la séparation: une console qui parle la trame Pro ne prend pas
    /// pour autant le verrou Switch.
    #[test]
    fn the_pro_frame_does_not_bring_the_switch_lock() {
        assert_eq!(Console::Xbox360.input_frame(), InputFrame::Pro);
        assert_eq!(Console::Xbox360.lock_group(), None);
        // Le jumeau: les deux Switch le prennent toujours.
        assert_eq!(Console::Switch.lock_group(), Some(LockGroup::Switch));
        assert_eq!(Console::Switch2.lock_group(), Some(LockGroup::Switch));
        // Un disque inconnu reste sur le chemin Dolphin, comme avant.
        assert_eq!(Console::Unknown.input_frame(), InputFrame::Dolphin);
        assert_eq!(Console::Unknown.adapter(), None);
        assert!(Console::Unknown.playable());
        assert!(!Console::Xbox360.playable());
        assert_eq!(Console::from_code("?"), None);
    }

    #[test]
    fn registered_switch2_reaches_the_catalogue_without_a_dolphin_header()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("zelda.nup");
        std::fs::write(&path, b"NUP registration fixture")?;
        std::fs::write(
            dir.path().join("unregistered.nup"),
            b"not a registered game",
        )?;
        assert!(crate::library::scan(dir.path()).is_empty());
        std::fs::write(
            dir.path().join("zelda.nup.nel3ab.json"),
            r#"{"console":"switch2","name":"Ocarina of Time","title":"0400486024DEC000"}"#,
        )?;
        let library = crate::library::scan(dir.path());
        assert_eq!(library.len(), 1);
        let discs = super::discs(&library, Path::new("/unavailable/dolphin-tool"), dir.path());
        assert_eq!(discs[0].console, Console::Switch2);
        assert_eq!(discs[0].title.as_deref(), Some("0400486024dec000"));
        let catalogue: serde_json::Value = serde_json::from_str(&crate::library::catalogue_json(
            &library,
            &[],
            &[discs[0].console],
            Some(0),
            1,
        ))?;
        assert_eq!(catalogue["roms"][0]["console"], "switch2");
        assert_eq!(catalogue["players"], 1);
        // Le titre inscrit voyage, en minuscules comme les dossiers de
        // sauvegarde qui portent son nom.
        assert_eq!(catalogue["roms"][0]["title_id"], "0400486024dec000");
        Ok(())
    }
}
