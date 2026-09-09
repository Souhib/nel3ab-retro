//! Registered Switch games. An NSP may be an update, so its extension alone
//! never adds it to the room. Registration records the title verified at boot.
use std::{
    io::{Cursor, Read},
    path::Path,
};

/// Validated local registration beside a game: `<file>.nel3ab.json`.
#[derive(Debug, PartialEq, Eq)]
pub struct Game {
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
    if !["xci", "nsp"].contains(&extension.as_str()) {
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
    if value.get("console")?.as_str()? != "switch"
        || name.is_empty()
        || name.len() > 200
        || title.len() != 16
        || !title.bytes().all(|c| c.is_ascii_hexdigit())
        || !title.ends_with("000")
    {
        return None;
    }
    Some(Game {
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
}
