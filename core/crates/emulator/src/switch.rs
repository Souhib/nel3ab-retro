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
    // cette extension: un `.xci` déclaré Switch 2 reste refusé, comme une fiche
    // qui nommerait une console décrite mais non inscrite (Xbox 360).
    let console = Console::from_code(value.get("console")?.as_str()?)
        .filter(by_sidecar)
        .filter(|console| console.extensions().contains(&extension.as_str()))?;
    // La famille de titres de la Switch 2: une règle de l'identifiant de titre,
    // pas une description de la console, donc écrite ici.
    if console == Console::Switch2 && !title.starts_with("0400") {
        return None;
    }
    if name.is_empty()
        || name.len() > 200
        || title.len() != 16
        || !title.bytes().all(|c| c.is_ascii_hexdigit())
        || !title.ends_with("000")
    {
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

    /// Une console décrite par le manifeste mais inscrite par aucune fiche ne
    /// passe pas par cette porte, même avec une fiche bien formée. Sans ce
    /// refus, un `.iso` déclaré Xbox 360 quitterait le chemin Dolphin.
    #[test]
    fn a_console_the_manifest_does_not_register_by_sidecar_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        for (extension, console, expected) in [
            ("iso", "x360", None),
            ("xex", "x360", None),
            ("xci", "x360", None),
            ("iso", "gc", None),
            // Le jumeau: la même fiche, pour une console inscrite par fiche.
            ("xci", "switch", Some(Console::Switch)),
        ] {
            let path = dir.path().join(format!("game.{extension}"));
            std::fs::write(&path, b"registration fixture").unwrap();
            let mut sidecar = path.as_os_str().to_os_string();
            sidecar.push(".nel3ab.json");
            std::fs::write(
                sidecar,
                format!(r#"{{"console":"{console}","name":"Halo 3","title":"0100BDE00862A000"}}"#),
            )
            .unwrap();
            assert_eq!(
                registered(&path).map(|game| game.console),
                expected,
                "{extension}, {console}"
            );
        }
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
