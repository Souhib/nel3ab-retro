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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Console {
    /// Une carte mémoire, donc deux emplacements de sauvegarde possibles.
    GameCube,
    /// La NAND de la console, donc une seule partie et pas de choix à proposer.
    Wii,
    /// Le disque n'a pas répondu. Voir le module: ce n'est pas « GameCube ».
    Unknown,
}

impl Console {
    /// Ce qu'on en écrit sur le fil et dans le cache.
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::GameCube => "gc",
            Self::Wii => "wii",
            Self::Unknown => "?",
        }
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
}
