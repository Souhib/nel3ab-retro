//! Deux sauvegardes par jeu, et celle qu'on choisit au démarrage.
//!
//! # Pourquoi deux
//!
//! Une partie propre pour découvrir un jeu, et une où tout est déjà débloqué
//! pour une soirée à quatre où personne n'a envie de gagner trois coupes avant
//! de jouer au circuit qu'il voulait. Les deux vivent côte à côte et ne se
//! marchent pas dessus.
//!
//! # Comment, sans rien demander à Dolphin
//!
//! Dolphin range les sauvegardes GameCube en fichiers `.gci` séparés, dans
//! `GC/<région>/Card A` sous son répertoire de session. Le choix se fait donc en
//! faisant POINTER ce dossier vers l'emplacement voulu, par un lien.
//!
//! Un lien plutôt qu'une copie, et c'est ce qui rend la persistance gratuite:
//! Dolphin écrit directement dans l'emplacement pendant qu'on joue, donc il n'y
//! a rien à recopier au bon moment, et rien à perdre si la salle s'arrête mal.
//!
//! Un lien plutôt qu'un réglage, aussi. Dolphin a peut-être une clé de
//! configuration pour ce dossier, mais je n'ai pas pu la vérifier sur cette
//! version, et une clé qu'on suppose est une clé qui ne marche pas en silence.
//! Le lien, lui, ne dépend d'aucune clé et vaut pour toutes les régions.

use std::path::{Path, PathBuf};

use crate::error::EmulatorError;

/// Les régions sous lesquelles Dolphin peut ranger une carte.
///
/// Toutes reliées au même emplacement, parce que le worker ne sait pas de
/// quelle région est le jeu qu'il lance et n'a pas besoin de le savoir: une
/// seule partie tourne à la fois, donc une seule de ces trois sert.
const REGIONS: [&str; 3] = ["USA", "EUR", "JAP"];

/// Laquelle des deux sauvegardes d'un jeu.
///
/// Un type et pas une chaîne: une salle ne peut pas se retrouver à lancer un
/// jeu sur un emplacement mal orthographié, et il n'y a pas de troisième cas à
/// traiter nulle part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Slot {
    /// Rien de débloqué: on commence le jeu comme à sa sortie.
    #[default]
    Fresh,
    /// Tout débloqué: personnages, circuits, coupes, modes.
    Unlocked,
}

impl Slot {
    /// Le nom du dossier. Sans accent ni espace, parce que c'est un chemin.
    #[must_use]
    pub const fn folder(self) -> &'static str {
        match self {
            Self::Fresh => "neuve",
            Self::Unlocked => "debloquee",
        }
    }

    /// Ce qu'on en dit à l'écran.
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Fresh => "partie neuve",
            Self::Unlocked => "tout débloqué",
        }
    }

    /// Comment il voyage sur le fil, et comment il en revient.
    #[must_use]
    pub const fn code(self) -> u8 {
        match self {
            Self::Fresh => 0,
            Self::Unlocked => 1,
        }
    }

    /// Lit un code venu d'une page.
    ///
    /// Rend `Fresh` sur n'importe quoi d'autre plutôt qu'une erreur: le pire cas
    /// est alors de démarrer sur une partie neuve, ce qui n'efface rien et se
    /// corrige d'un clic. Refuser aurait laissé la salle sans jeu du tout.
    #[must_use]
    pub const fn from_code(code: u8) -> Self {
        if code == Self::Unlocked.code() {
            Self::Unlocked
        } else {
            Self::Fresh
        }
    }
}

/// La clé sous laquelle les sauvegardes d'un jeu sont rangées.
///
/// Tirée du NOM DE FICHIER de la ROM, comme le choix de jeu lui-même, et pour la
/// même raison: le titre affiché a le droit de changer quand les règles de
/// nettoyage s'améliorent, et une sauvegarde qui cesserait de correspondre parce
/// qu'un titre a perdu une parenthèse serait une soirée perdue.
///
/// Tout ce qui n'est ni lettre ni chiffre devient un tiret, et les tirets ne
/// s'accumulent pas. Ça rend le nom lisible dans un `ls`, et surtout ça rend un
/// `..` impossible à écrire: une ROM appelée `../../etc` donne `etc`.
#[must_use]
pub fn key(rom_file: &str) -> String {
    let mut out = String::with_capacity(rom_file.len());
    for ch in rom_file.chars() {
        if ch.is_ascii_alphanumeric() {
            out.extend(ch.to_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        // Un nom qui ne contient aucune lettre ni chiffre. Il en faut un quand
        // même, sinon on écrirait à la racine du dossier des sauvegardes.
        return "sans-nom".to_owned();
    }
    trimmed.to_owned()
}

/// Où vivent les sauvegardes d'un jeu, pour un emplacement donné.
#[must_use]
pub fn slot_dir(root: &Path, rom_file: &str, slot: Slot) -> PathBuf {
    root.join(key(rom_file)).join(slot.folder())
}

/// Fait pointer les dossiers de carte de la session vers cet emplacement.
///
/// Après cet appel, tout ce que le jeu sauvegarde atterrit dans
/// `slot_dir(...)`, et rien n'a besoin d'être recopié ensuite.
///
/// # Errors
/// [`EmulatorError::Saves`] quand un dossier ne peut pas être créé ou relié.
pub fn point_card_at(session_dir: &Path, slot: &Path) -> Result<(), EmulatorError> {
    let fail = |what: &'static str, source: std::io::Error| EmulatorError::Saves {
        what,
        path: slot.to_path_buf(),
        source,
    };
    std::fs::create_dir_all(slot).map_err(|source| fail("créer l'emplacement", source))?;

    for region in REGIONS {
        let card = session_dir.join("GC").join(region).join("Card A");
        if let Some(parent) = card.parent() {
            std::fs::create_dir_all(parent).map_err(|source| fail("créer la région", source))?;
        }
        // Ce qui était là avant est retiré, et le TYPE compte: un lien s'enlève
        // avec `remove_file`, un vrai dossier avec `remove_dir_all`. Se tromper
        // laisse le lien en place et le jeu écrit dans l'ancien emplacement,
        // sans une erreur.
        match std::fs::symlink_metadata(&card) {
            Ok(found) if found.is_dir() => {
                std::fs::remove_dir_all(&card)
                    .map_err(|source| fail("retirer l'ancien", source))?;
            }
            Ok(_) => {
                std::fs::remove_file(&card).map_err(|source| fail("retirer l'ancien", source))?;
            }
            Err(_) => {}
        }
        std::os::unix::fs::symlink(slot, &card).map_err(|source| fail("relier", source))?;
    }
    Ok(())
}

/// Vide un emplacement, pour repartir vraiment de zéro.
///
/// « Neuve » cesse de l'être dès qu'on a joué une heure dessus: il faut donc un
/// geste pour la remettre à neuf, sinon le mot ment au bout d'une soirée.
///
/// # Errors
/// [`EmulatorError::Saves`] quand l'effacement échoue.
pub fn empty(slot: &Path) -> Result<(), EmulatorError> {
    if !slot.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(slot).map_err(|source| EmulatorError::Saves {
        what: "lire l'emplacement",
        path: slot.to_path_buf(),
        source,
    })? {
        let Ok(entry) = entry else { continue };
        // Seulement les fichiers de sauvegarde. Un emplacement n'est pas censé
        // contenir autre chose, et effacer ce qu'on ne reconnaît pas est la
        // façon dont on mange les données de quelqu'un d'autre.
        if entry.path().extension().is_some_and(|ext| ext == "gci") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    #[test]
    fn a_rom_file_gives_a_readable_key() {
        assert_eq!(key("Super Mario Strikers.rvz"), "super-mario-strikers-rvz");
        assert_eq!(
            key("Mario Kart Double Dash (Retro Track Grand Prix).rvz"),
            "mario-kart-double-dash-retro-track-grand-prix-rvz"
        );
    }

    /// Le jumeau qui compte: la clé devient un CHEMIN, donc elle ne doit jamais
    /// pouvoir sortir du dossier des sauvegardes.
    #[test]
    fn a_key_can_never_climb_out_of_its_folder() {
        for nasty in [
            "../../etc/passwd",
            "..",
            "/absolu/ailleurs.rvz",
            "jeu/../../ailleurs",
        ] {
            let made = key(nasty);
            assert!(!made.contains(".."), "{nasty} a donné {made}");
            assert!(!made.contains('/'), "{nasty} a donné {made}");
            assert!(!made.starts_with('-'), "{nasty} a donné {made}");
        }
    }

    #[test]
    fn a_name_with_nothing_usable_still_gets_a_folder() {
        // Sans ce repli, on écrirait à la racine du dossier des sauvegardes,
        // où les emplacements de tous les jeux se mélangeraient.
        assert_eq!(key("...///..."), "sans-nom");
        assert_eq!(key(""), "sans-nom");
    }

    #[test]
    fn the_two_slots_never_share_a_folder_or_a_code() {
        // Le jumeau de tout ce module: deux emplacements qui se confondraient
        // feraient jouer sur la sauvegarde de l'autre sans rien signaler.
        assert_ne!(Slot::Fresh.folder(), Slot::Unlocked.folder());
        assert_ne!(Slot::Fresh.code(), Slot::Unlocked.code());
        assert_ne!(Slot::Fresh.label(), Slot::Unlocked.label());
    }

    #[test]
    fn a_slot_survives_the_trip_to_a_page_and_back() {
        for slot in [Slot::Fresh, Slot::Unlocked] {
            assert_eq!(Slot::from_code(slot.code()), slot);
        }
    }

    #[test]
    fn an_unknown_code_lands_on_the_fresh_save_rather_than_failing() {
        // Le pire cas doit être « on démarre sur une partie neuve », qui
        // n'efface rien et se corrige d'un clic. Refuser laisserait la salle
        // sans jeu du tout.
        for wrong in [2, 7, 255] {
            assert_eq!(Slot::from_code(wrong), Slot::Fresh);
        }
    }

    #[test]
    fn the_card_folders_point_at_the_chosen_slot() {
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let slot = home.path().join("saves").join("jeu").join("neuve");

        point_card_at(&session, &slot).unwrap();

        for region in REGIONS {
            let card = session.join("GC").join(region).join("Card A");
            assert_eq!(std::fs::read_link(&card).unwrap(), slot, "région {region}");
        }
    }

    #[test]
    fn changing_slot_replaces_the_link_instead_of_stacking_on_it() {
        // Le défaut que ça évite: un lien laissé en place fait écrire le jeu
        // dans l'ancien emplacement, et rien ne le dit.
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let first = home.path().join("saves").join("jeu").join("neuve");
        let second = home.path().join("saves").join("jeu").join("debloquee");

        point_card_at(&session, &first).unwrap();
        point_card_at(&session, &second).unwrap();

        let card = session.join("GC").join("USA").join("Card A");
        assert_eq!(std::fs::read_link(&card).unwrap(), second);
    }

    /// Et le cas qui arrive une seule fois, à la migration: le dossier de carte
    /// existe déjà comme VRAI dossier, avec des sauvegardes dedans.
    #[test]
    fn a_real_folder_already_there_is_replaced_too() {
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let card = session.join("GC").join("USA").join("Card A");
        std::fs::create_dir_all(&card).unwrap();
        std::fs::write(card.join("01-TEST-jeu.gci"), b"anciennes donnees").unwrap();
        let slot = home.path().join("saves").join("jeu").join("neuve");

        point_card_at(&session, &slot).unwrap();

        assert_eq!(std::fs::read_link(&card).unwrap(), slot);
    }

    #[test]
    fn emptying_a_slot_removes_the_saves_and_nothing_else() {
        let home = tempfile::tempdir().unwrap();
        let slot = home.path().join("neuve");
        std::fs::create_dir_all(&slot).unwrap();
        std::fs::write(slot.join("01-GM4E-jeu.gci"), b"une partie").unwrap();
        std::fs::write(slot.join("notes.txt"), b"pas a nous").unwrap();

        empty(&slot).unwrap();

        assert!(!slot.join("01-GM4E-jeu.gci").exists());
        // Effacer ce qu'on ne reconnaît pas est la façon dont on mange les
        // données de quelqu'un d'autre.
        assert!(slot.join("notes.txt").exists());
    }

    #[test]
    fn emptying_a_slot_that_does_not_exist_is_not_an_error() {
        assert!(empty(&std::path::PathBuf::from("/nexiste/pas/du/tout")).is_ok());
    }
}
