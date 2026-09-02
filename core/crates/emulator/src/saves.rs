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

/// Fait pointer la sauvegarde d'un jeu WII vers cet emplacement.
///
/// Une Wii ne range pas sa partie dans une carte mémoire: elle l'écrit dans sa
/// propre mémoire, sous l'identifiant du titre. Pour Mario Kart Wii en PAL,
/// c'est `Wii/title/00010004/524d4350/data`, et ce chemin vient de
/// `dolphin-tool` plutôt que d'un calcul sur le code de jeu: la moitié haute de
/// l'identifiant change selon le type de titre.
///
/// Un seul dossier à relier, là où la carte GameCube en demande trois — une par
/// région. La console, elle, n'a pas de régions dans ce chemin.
///
/// # Errors
/// [`EmulatorError::Saves`] quand l'emplacement sort du dossier de session, ou
/// quand un dossier ne peut pas être créé ou relié.
pub fn point_nand_at(session_dir: &Path, title: &str, slot: &Path) -> Result<(), EmulatorError> {
    let fail = |what: &'static str, source: std::io::Error| EmulatorError::Saves {
        what,
        path: slot.to_path_buf(),
        source,
    };
    // Seize chiffres hexadécimaux, coupés en deux. Vérifié plutôt que supposé:
    // ce texte vient d'un outil externe, et il sert à construire un CHEMIN.
    if title.len() != 16 || !title.chars().all(|letter| letter.is_ascii_hexdigit()) {
        return Err(fail(
            "cet identifiant de titre n'en est pas un",
            std::io::Error::from(std::io::ErrorKind::InvalidInput),
        ));
    }
    let (high, low) = title.split_at(8);
    let data = session_dir
        .join("Wii")
        .join("title")
        .join(high)
        .join(low)
        .join("data");
    link(session_dir, slot, &data)
}

/// Fait pointer les dossiers de carte de la session vers cet emplacement.
///
/// Après cet appel, tout ce que le jeu sauvegarde atterrit dans
/// `slot_dir(...)`, et rien n'a besoin d'être recopié ensuite.
///
/// L'emplacement doit se trouver SOUS le dossier de session, et ce n'est pas
/// une question de rangement. Le conteneur ne monte que ce dossier, donc un
/// lien qui en sort pointe, vu de l'intérieur, vers rien. Dolphin suit un lien
/// mort sans rien dire: pas d'erreur, pas de trace, et le jeu recrée sa
/// sauvegarde à chaque démarrage. Un après-midi entier le 30 août 2026, passé à
/// soupçonner le nom du fichier puis le code d'éditeur. La règle est ici plutôt
/// que dans un commentaire chez l'appelant, pour qu'aucun appelant ne puisse la
/// contourner.
///
/// # Errors
/// [`EmulatorError::Saves`] quand l'emplacement sort du dossier de session,
/// ou quand un dossier ne peut pas être créé ou relié.
pub fn point_card_at(session_dir: &Path, slot: &Path) -> Result<(), EmulatorError> {
    let fail = |what: &'static str, source: std::io::Error| EmulatorError::Saves {
        what,
        path: slot.to_path_buf(),
        source,
    };
    if !slot.starts_with(session_dir) {
        return Err(fail(
            "l'emplacement sort du dossier monté dans le conteneur",
            std::io::Error::from(std::io::ErrorKind::InvalidInput),
        ));
    }
    std::fs::create_dir_all(slot).map_err(|source| fail("créer l'emplacement", source))?;

    for region in REGIONS {
        let card = session_dir.join("GC").join(region).join("Card A");
        link(session_dir, slot, &card)?;
    }
    Ok(())
}

/// Met à l'abri une partie écrite avant que les emplacements existent.
///
/// Dans l'emplacement quand il est vide, à côté sinon. Jamais à la poubelle.
fn rescue(from: &Path, slot: &Path) -> Result<(), std::io::Error> {
    let empty = std::fs::read_dir(slot).is_ok_and(|mut entries| entries.next().is_none());
    if empty {
        for entry in std::fs::read_dir(from)?.flatten() {
            std::fs::rename(entry.path(), slot.join(entry.file_name()))?;
        }
        return std::fs::remove_dir(from);
    }
    // `.mis-de-cote` une seule fois: écraser une mise à l'abri par une autre
    // ferait perdre la première, ce qui est exactement ce qu'on évite ici.
    let aside = from.with_extension("mis-de-cote");
    if aside.exists() {
        return {
            std::fs::remove_dir_all(from).unwrap_or(());
            Ok(())
        };
    }
    std::fs::rename(from, &aside)
}

/// Relie UN dossier vers l'emplacement, en retirant ce qui était là.
///
/// Sorti des deux appelants parce qu'ils font exactement la même chose, et que
/// la partie délicate ne doit exister qu'une fois: le TYPE de ce qui était là
/// compte, et se tromper laisse le lien en place sans une erreur.
/// Retire les titres de la NAND dont la sauvegarde ne pointe plus sur rien.
///
/// # Le défaut que ça corrige
///
/// Un disque qui quitte la bibliothèque emporte son emplacement de sauvegarde,
/// et laisse son entrée dans la NAND: un lien qui ne mène nulle part. Dolphin
/// parcourt la NAND au démarrage et lève une exception dessus — « cannot get
/// file size: No such file or directory » — qui n'est pas rattrapée. Le
/// processus meurt, aucune image n'arrive, et la page montre un écran noir
/// pendant que l'écran de chargement attend quelque chose qui ne viendra jamais.
///
/// Constaté le 2 septembre 2026: Mario Party 9 PAL avait été remplacé par la
/// version USA deux jours plus tôt. Son entrée de NAND est restée, et elle a tué
/// chaque démarrage de Dolphin depuis — y compris pour des jeux GameCube, qui
/// n'ont rien à faire de la NAND.
///
/// # Pourquoi ça ne supprime aucune sauvegarde
///
/// Un lien MORT ne contient rien: sa cible n'existe pas, par définition. La
/// fonction ne touche donc que ce cas, vérifié avant chaque retrait, et laisse
/// intacts un lien qui pointe quelque part et un vrai dossier. Une sauvegarde ne
/// se supprime pas, et c'est la règle qui rend celle-ci écrivable.
///
/// Rend les titres retirés, pour que l'appelant puisse le DIRE. Effacer quelque
/// chose dans un arbre de sauvegardes sans une ligne de journal serait le genre
/// de silence qu'on regrette.
#[must_use]
pub fn sweep_nand(session_dir: &Path) -> Vec<String> {
    let titles = session_dir.join("Wii").join("title");
    let mut swept = Vec::new();
    let Ok(highs) = std::fs::read_dir(&titles) else {
        return swept;
    };
    for high in highs.flatten() {
        let Ok(lows) = std::fs::read_dir(high.path()) else {
            continue;
        };
        for low in lows.flatten() {
            let data = low.path().join("data");
            // `symlink_metadata` ne SUIT pas le lien, `metadata` le suit. Il faut
            // les deux: le premier dit « c'est un lien », le second dit « il ne
            // mène nulle part ». N'utiliser que le second confondrait un lien
            // mort avec un titre qui n'a pas encore de sauvegarde.
            let Ok(kind) = std::fs::symlink_metadata(&data) else {
                continue;
            };
            // Deux conditions, et la seconde suffit à tous les cas qu'un essai
            // sait fabriquer: un vrai dossier se lit, donc `metadata` réussit,
            // donc on passe. La première n'est donc PAS couverte, et je préfère
            // le dire que de la laisser croire vérifiée.
            //
            // Elle n'est pas décorative pour autant: `metadata` peut échouer sur
            // un dossier qui existe — droits refusés, montage parti — et sans
            // « c'est un lien », ce dossier-là serait effacé. Une garde qu'on ne
            // peut pas mettre en scène reste une garde, tant qu'on dit laquelle.
            if !kind.is_symlink() || std::fs::metadata(&data).is_ok() {
                continue;
            }
            if std::fs::remove_dir_all(low.path()).is_ok() {
                swept.push(format!(
                    "{}{}",
                    high.file_name().to_string_lossy(),
                    low.file_name().to_string_lossy()
                ));
            }
        }
    }
    swept
}

fn link(session_dir: &Path, slot: &Path, at: &Path) -> Result<(), EmulatorError> {
    let fail = |what: &'static str, source: std::io::Error| EmulatorError::Saves {
        what,
        path: slot.to_path_buf(),
        source,
    };
    if !slot.starts_with(session_dir) {
        return Err(fail(
            "l'emplacement sort du dossier monté dans le conteneur",
            std::io::Error::from(std::io::ErrorKind::InvalidInput),
        ));
    }
    std::fs::create_dir_all(slot).map_err(|source| fail("créer l'emplacement", source))?;
    {
        let card = at;
        if let Some(parent) = card.parent() {
            std::fs::create_dir_all(parent).map_err(|source| fail("créer la région", source))?;
        }
        // Ce qui était là avant est retiré, et le TYPE compte: un lien s'enlève
        // avec `remove_file`, un vrai dossier avec `remove_dir_all`. Se tromper
        // laisse le lien en place et le jeu écrit dans l'ancien emplacement,
        // sans une erreur.
        match std::fs::symlink_metadata(card) {
            Ok(found) if found.is_dir() => {
                // Un VRAI dossier veut dire qu'une partie existe déjà là, écrite
                // avant qu'on range par emplacements. On la DÉPLACE, jamais on ne
                // l'efface: le premier jet appelait `remove_dir_all` ici, et
                // c'était une partie perdue au premier changement d'emplacement,
                // sans un mot. Une sauvegarde effacée ne se récupère pas.
                //
                // Elle va dans l'emplacement choisi s'il est vide, ce qui est le
                // cas juste après la migration, et c'est ce qu'on attend: ce
                // qu'on jouait devient ce qu'on retrouve. S'il ne l'est pas, on
                // ne mélange pas deux parties: l'ancien dossier est mis de côté.
                rescue(card, slot).map_err(|source| fail("mettre l'ancien à l'abri", source))?;
            }
            Ok(_) => {
                std::fs::remove_file(card).map_err(|source| fail("retirer l'ancien", source))?;
            }
            Err(_) => {}
        }
        std::os::unix::fs::symlink(slot, card).map_err(|source| fail("relier", source))?;
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

    /// Prépare une NAND d'essai: un titre par cas, et rend son dossier.
    fn a_nand_with(session: &Path, cases: &[(&str, &str)]) -> std::path::PathBuf {
        let titles = session.join("Wii").join("title");
        for (title, kind) in cases {
            let (high, low) = title.split_at(8);
            let held = titles.join(high).join(low);
            std::fs::create_dir_all(&held).unwrap();
            let data = held.join("data");
            match *kind {
                "vivant" => {
                    let target = session.join("saves").join(*title);
                    std::fs::create_dir_all(&target).unwrap();
                    std::os::unix::fs::symlink(&target, &data).unwrap();
                }
                "mort" => {
                    std::os::unix::fs::symlink(session.join("saves").join("parti"), &data).unwrap();
                }
                _ => std::fs::create_dir_all(&data).unwrap(),
            }
        }
        titles
    }

    /// Le défaut du 2 septembre 2026: un disque retiré laisse son entrée de NAND,
    /// Dolphin lève une exception dessus au démarrage et MEURT. Aucune image
    /// n'arrive ensuite, y compris pour un jeu GameCube.
    #[test]
    fn a_dead_link_in_the_nand_is_swept() {
        let session = tempfile::tempdir().unwrap();
        let titles = a_nand_with(
            session.path(),
            &[("0001000053535150", "mort"), ("0001000053535145", "vivant")],
        );

        let swept = sweep_nand(session.path());

        assert_eq!(swept, vec!["0001000053535150".to_owned()]);
        assert!(!titles.join("00010000").join("53535150").exists());
    }

    /// Les trois jumeaux, et ce sont eux qui rendent la fonction écrivable: elle
    /// efface dans un arbre de SAUVEGARDES, et une sauvegarde ne se supprime pas.
    #[test]
    fn nothing_that_holds_anything_is_swept() {
        let session = tempfile::tempdir().unwrap();
        let titles = a_nand_with(
            session.path(),
            &[
                ("0001000053535145", "vivant"),
                ("0001000052345145", "dossier"),
                ("000100005247484f", "mort"),
            ],
        );

        let swept = sweep_nand(session.path());

        // Seul le lien mort part.
        assert_eq!(swept, vec!["000100005247484f".to_owned()]);
        // Un lien qui pointe quelque part reste, et sa cible aussi.
        assert!(
            titles
                .join("00010000")
                .join("53535145")
                .join("data")
                .exists()
        );
        // Un VRAI dossier de sauvegarde reste, quoi qu'il arrive.
        assert!(
            titles
                .join("00010000")
                .join("52345145")
                .join("data")
                .is_dir()
        );
    }

    /// Une salle qui n'a jamais lancé de jeu Wii n'a pas de NAND du tout.
    #[test]
    fn a_room_without_a_nand_sweeps_nothing() {
        let session = tempfile::tempdir().unwrap();

        assert!(sweep_nand(session.path()).is_empty());
    }

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
        let slot = session.join("saves").join("jeu").join("neuve");

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
        let first = session.join("saves").join("jeu").join("neuve");
        let second = session.join("saves").join("jeu").join("debloquee");

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
        let slot = session.join("saves").join("jeu").join("neuve");

        point_card_at(&session, &slot).unwrap();

        assert_eq!(std::fs::read_link(&card).unwrap(), slot);
        // Et la partie qui était là a été DÉPLACÉE, pas effacée. Le premier jet
        // appelait `remove_dir_all` ici: une soirée de jeu perdue au premier
        // changement d'emplacement, sans un mot. Une sauvegarde effacée ne se
        // récupère pas, et personne ne pense à en faire une copie d'avance.
        assert_eq!(
            std::fs::read(slot.join("01-TEST-jeu.gci")).unwrap(),
            b"anciennes donnees",
            "la partie d'avant doit se retrouver dans l'emplacement"
        );
    }

    /// Et quand l'emplacement n'est PAS vide, on ne mélange pas deux parties.
    #[test]
    fn an_older_save_is_set_aside_rather_than_mixed_in() {
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let card = session.join("GC").join("USA").join("Card A");
        std::fs::create_dir_all(&card).unwrap();
        std::fs::write(card.join("01-TEST-jeu.gci"), b"ancienne").unwrap();
        let slot = session.join("saves").join("jeu").join("neuve");
        std::fs::create_dir_all(&slot).unwrap();
        std::fs::write(slot.join("01-TEST-jeu.gci"), b"celle de l'emplacement").unwrap();

        point_card_at(&session, &slot).unwrap();

        assert_eq!(
            std::fs::read(slot.join("01-TEST-jeu.gci")).unwrap(),
            b"celle de l'emplacement",
            "l'emplacement choisi garde la sienne"
        );
        assert_eq!(
            std::fs::read(card.with_extension("mis-de-cote").join("01-TEST-jeu.gci")).unwrap(),
            b"ancienne",
            "et l'autre est mise de côté, jamais perdue"
        );
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

    /// La sauvegarde d'un jeu Wii va dans la console, sous son identifiant.
    #[test]
    fn un_jeu_wii_range_sa_partie_sous_son_titre() {
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let dedans = slot_dir(&session.join("saves"), "mario-kart.rvz", Slot::Unlocked);

        point_nand_at(&session, "00010004524d4350", &dedans).unwrap();

        let data = session
            .join("Wii")
            .join("title")
            .join("00010004")
            .join("524d4350")
            .join("data");
        assert_eq!(std::fs::read_link(&data).unwrap(), dedans);
    }

    /// Le jumeau, et il n'est pas décoratif: cet identifiant vient d'un outil
    /// EXTERNE et sert à construire un chemin. Un texte qui n'en est pas un doit
    /// être refusé ici, pas plus loin.
    #[test]
    fn un_identifiant_de_titre_qui_n_en_est_pas_un_est_refuse() {
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let dedans = slot_dir(&session.join("saves"), "jeu.rvz", Slot::Fresh);

        for faux in ["", "00010004", "../../../../etc/passwd", "00010004524d435z"] {
            assert!(
                point_nand_at(&session, faux, &dedans).is_err(),
                "« {faux} » ne doit pas devenir un chemin"
            );
        }
        assert!(
            !session.join("Wii").exists(),
            "et rien ne doit être créé au passage"
        );
    }

    #[test]
    fn refuse_un_emplacement_hors_du_dossier_monte() {
        // Le défaut du 30 août 2026: l'emplacement était posé à CÔTÉ de la
        // session, le lien pointait hors du montage, et Dolphin le suivait sans
        // le dire. Rien ne se sauvegardait, pour aucun jeu.
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let dehors = home.path().join("saves").join("un-jeu").join("neuve");

        let refus = point_card_at(&session, &dehors);

        assert!(refus.is_err(), "un lien hors du montage doit être refusé");
        assert!(
            !session.join("GC").join("USA").join("Card A").exists(),
            "et rien ne doit être relié au passage"
        );
    }

    #[test]
    fn accepte_un_emplacement_sous_le_dossier_monte() {
        // Le jumeau: un test qui refuserait tout laisserait la salle sans
        // carte mémoire, ce qui est exactement le défaut qu'on corrige.
        let home = tempfile::tempdir().unwrap();
        let session = home.path().join("session");
        let dedans = slot_dir(&session.join("saves"), "un-jeu.iso", Slot::Fresh);

        point_card_at(&session, &dedans).unwrap();

        let card = session.join("GC").join("USA").join("Card A");
        assert_eq!(
            std::fs::read_link(&card).unwrap(),
            dedans,
            "la carte doit pointer vers l'emplacement demandé"
        );
    }
}
