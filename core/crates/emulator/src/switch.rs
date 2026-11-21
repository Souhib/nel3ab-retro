//! Registered Switch games. An NSP may be an update, so its extension alone
//! never adds it to the room.
//!
//! Registration records the base title: verified at boot for a hand-written
//! file, or read from the decrypted NCA header by the lobby's import
//! (`control/nel3ab_control/imports/switch_nca.py`).
use std::{
    io::{Cursor, Read},
    path::Path,
};

use crate::disc::{Console, Registration};

/// Validated local registration beside a game: `<file>.nel3ab.json`.
#[derive(Debug, PartialEq, Eq)]
pub struct Game {
    /// The registered family selects its adapter and its room input limit.
    pub console: Console,
    /// Display name, independent from the archive's name.
    pub name: String,
    /// Base application identifier. Save slots use this, never catalogue indices.
    pub title: String,
    /// Optional publisher, from the locally recorded catalogue source.
    pub maker: String,
    /// Optional short description, independent from the game's controls guide.
    pub about: String,
}

/// Read only explicit registrations, refusing malformed and oversized files.
#[must_use]
pub fn registered(path: &Path) -> Option<Game> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    // Les extensions des consoles inscrites par fiche, lues dans leurs
    // capacités et donc dans le manifeste (ADR D22). Regardées AVANT d'ouvrir
    // la fiche: un disque Dolphin ne paie pas la lecture d'un fichier voisin.
    let by_sidecar = |console: &Console| console.registration() == Registration::Sidecar;
    if !Console::KNOWN
        .iter()
        .filter(|console| by_sidecar(console))
        .any(|console| console.extensions().contains(&extension.as_str()))
    {
        return None;
    }
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(".nel3ab.json");
    let mut bytes = Vec::new();
    std::fs::File::open(sidecar)
        .ok()?
        .take(4097)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let name = value.get("name")?.as_str()?.trim();
    let title = value.get("title")?.as_str()?;
    // La console nommée par la fiche doit être inscrite par fiche ET porter
    // cette extension: un `.xci` déclaré Switch 2 reste refusé, comme un `.iso`
    // déclaré GameCube, que Dolphin lit par son en-tête.
    let console = Console::from_code(value.get("console")?.as_str()?)
        .filter(by_sidecar)
        .filter(|console| console.extensions().contains(&extension.as_str()))?;
    // La famille de titres de la Switch 2: une règle de l'identifiant de titre,
    // pas une description de la console, donc écrite ici.
    if console == Console::Switch2 && !title.starts_with("0400") {
        return None;
    }
    if name.is_empty() || name.len() > 200 || !console.valid_title(title) {
        return None;
    }
    Some(Game {
        console,
        name: name.to_owned(),
        title: title.to_ascii_lowercase(),
        maker: text(&value, "maker", 128),
        about: text(&value, "about", 1024),
    })
}

fn text(value: &serde_json::Value, key: &str, max: usize) -> String {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| text.len() <= max)
        .unwrap_or_default()
        .to_owned()
}

/// Read local artwork without starting an emulator or making a network request.
/// The filename is tied to the registered ROM, never taken from untrusted JSON.
pub(crate) fn art(path: &Path) -> Option<crate::banner::Art> {
    let game = registered(path)?;
    let mut picture = path.as_os_str().to_os_string();
    picture.push(".nel3ab.png");
    // Mario Tennis' official 640×360 PNG is 497,170 bytes (2026-09-09).
    // One MiB leaves room for other covers while bounding startup reads. Eight
    // MiB bounds PNG decoding, including metadata and a 1024² RGBA image.
    let mut bytes = Vec::new();
    std::fs::File::open(&picture)
        .ok()?
        .take(1_048_577)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 1_048_576 {
        return None;
    }
    let mut decoder = png::Decoder::new(Cursor::new(&bytes));
    decoder.set_limits(png::Limits {
        bytes: 8 * 1024 * 1024,
    });
    let mut reader = decoder.read_info().ok()?;
    if reader.info().width > 1024 || reader.info().height > 1024 {
        return None;
    }
    let mut pixels = vec![0; reader.output_buffer_size()?];
    reader.next_frame(&mut pixels).ok()?;
    reader.finish().ok()?;
    Some(crate::banner::Art {
        png: bytes,
        maker: game.maker,
        about: game.about,
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, reason = "invalid fixtures must fail")]
mod tests {
    use super::*;
    #[test]
    fn registration_is_explicit_and_updates_are_not_playable_games() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tennis.xci");
        let sidecar = dir.path().join("tennis.xci.nel3ab.json");
        std::fs::write(&path, b"fixture").unwrap();
        assert!(registered(&path).is_none());
        for title in ["0100BDE00862A000", "../../etc/shadow!", "0100BDE00862A800"] {
            std::fs::write(
                &sidecar,
                format!(r#"{{"console":"switch","name":"Mario Tennis Aces","title":"{title}"}}"#),
            )
            .unwrap();
            assert_eq!(registered(&path).is_some(), title == "0100BDE00862A000");
        }
    }

    /// Une fiche ne vaut que pour une console inscrite par fiche, avec une
    /// extension qu'elle porte et un titre de sa forme. Sans ces refus, un
    /// `.iso` GameCube suivi d'une fiche quitterait le chemin Dolphin.
    #[test]
    fn a_sidecar_needs_its_console_its_extension_and_its_title_shape() {
        let dir = tempfile::tempdir().unwrap();
        for (extension, console, title, expected) in [
            // La Xbox 360 s'inscrit par fiche depuis le 21 novembre 2026: un
            // disque entier, et un titre de 8 chiffres.
            ("iso", "x360", "534507D6", Some(Console::Xbox360)),
            ("iso", "x360", "0100BDE00862A000", None),
            ("iso", "x360", "534507G6", None),
            ("xex", "x360", "534507D6", None),
            ("xci", "x360", "534507D6", None),
            ("iso", "gc", "534507D6", None),
            ("xci", "switch", "534507D6", None),
            ("xci", "switch", "0100BDE00862A000", Some(Console::Switch)),
        ] {
            let path = dir.path().join(format!("game.{extension}"));
            std::fs::write(&path, b"registration fixture").unwrap();
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(".nel3ab.json");
            std::fs::write(
                sidecar,
                format!(r#"{{"console":"{console}","name":"Halo 3","title":"{title}"}}"#),
            )
            .unwrap();
            assert_eq!(
                registered(&path).map(|game| game.console),
                expected,
                "{extension}, {console}, {title}"
            );
        }
    }

    /// La fiche qu'écrit l'import d'un disque Xbox 360 (`rangement.fiche_xbox360`),
    /// comparée octet pour octet par un essai Python à ce même fichier.
    #[test]
    fn the_lobby_import_sidecar_registers_an_xbox_360_disc() {
        const FICHE: &str = include_str!("../../../../consoles/fiche-xbox360.json");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Sonic the Hedgehog.iso");
        std::fs::write(&path, b"disc fixture").unwrap();
        std::fs::write(dir.path().join("Sonic the Hedgehog.iso.nel3ab.json"), FICHE).unwrap();
        let game = registered(&path);
        assert_eq!(game.as_ref().map(|g| g.console), Some(Console::Xbox360));
        assert_eq!(game.as_ref().map(|g| g.title.as_str()), Some("534507d6"));
        assert_eq!(
            game.as_ref().map(|g| g.name.as_str()),
            Some("Sonic the Hedgehog")
        );
        // Le jumeau: la même fiche à côté d'un `.xex` n'inscrit rien.
        let xex = dir.path().join("default.xex");
        std::fs::write(&xex, b"xex fixture").unwrap();
        std::fs::write(dir.path().join("default.xex.nel3ab.json"), FICHE).unwrap();
        assert_eq!(registered(&xex), None);
    }

    /// La fiche que l'import du salon écrit (`rangement.fiche_switch`). Un essai
    /// Python compare ce que le salon produit à ce même fichier, octet pour
    /// octet: changer le format d'un côté fait échouer l'un des deux essais.
    #[test]
    fn the_lobby_import_sidecar_registers_its_game_and_an_update_title_does_not() {
        const FICHE: &str = include_str!("../../../../consoles/fiche-switch.json");
        // Sans ce titre écrit tel quel, le jumeau plus bas remplacerait rien et
        // passerait pour une mauvaise raison.
        assert!(FICHE.contains(r#""title": "0100ABCDEF012000""#));
        let dir = tempfile::tempdir().unwrap();
        for extension in ["nsp", "xci"] {
            let path = dir
                .path()
                .join(format!("Super Essai Kart Écarlate.{extension}"));
            std::fs::write(&path, b"import fixture").unwrap();
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(".nel3ab.json");
            std::fs::write(&sidecar, FICHE).unwrap();
            assert_eq!(
                registered(&path),
                Some(Game {
                    console: Console::Switch,
                    name: "Super Essai Kart Écarlate".to_owned(),
                    title: "0100abcdef012000".to_owned(),
                    maker: String::new(),
                    about: String::new(),
                }),
                "{extension}"
            );
            // Le jumeau: la même fiche, avec le titre de la mise à jour du jeu.
            std::fs::write(
                &sidecar,
                FICHE.replace("0100ABCDEF012000", "0100ABCDEF012800"),
            )
            .unwrap();
            assert_eq!(registered(&path), None, "{extension}");
        }
    }

    #[test]
    fn switch2_requires_its_own_family_container_and_base_title() {
        let dir = tempfile::tempdir().unwrap();
        for (extension, console, title, expected) in [
            ("nup", "switch2", "0400486024DEC000", Some(Console::Switch2)),
            ("NUP", "switch2", "0400486024DEC000", Some(Console::Switch2)),
            ("nup", "switch", "0400486024DEC000", None),
            ("xci", "switch2", "0400486024DEC000", None),
            ("nsp", "switch2", "0400486024DEC000", None),
            ("nup", "switch2", "0100BDE00862A000", None),
            ("nup", "switch2", "0400486024DEC800", None),
            ("nup", "switch2", "../../etc/shadow!", None),
        ] {
            let path = dir.path().join(format!("game.{extension}"));
            std::fs::write(&path, b"registration fixture").unwrap();
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(".nel3ab.json");
            std::fs::write(
                sidecar,
                format!(r#"{{"console":"{console}","name":"Ocarina of Time","title":"{title}"}}"#),
            )
            .unwrap();
            assert_eq!(
                registered(&path).map(|game| game.console),
                expected,
                "{extension}, {console}, {title}"
            );
        }
    }
}
