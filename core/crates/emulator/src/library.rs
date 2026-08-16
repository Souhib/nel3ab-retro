//! What games this machine has, and in what order.
//!
//! # Why an index on the wire and a name on disk
//!
//! A browser asks for a game by its **position** in this list, never by a path.
//! A position can only ever select something the worker itself found, so a
//! client cannot ask for `../../etc/shadow` however it is written — the invalid
//! state is unrepresentable rather than checked for.
//!
//! The choice is REMEMBERED by name, though, because a position is only stable
//! while the directory is. Dropping a new game in would otherwise silently
//! change which one a restart resumes. Name to persist, index to transmit, and
//! neither does the other's job.

use std::path::{Path, PathBuf};

/// Extensions Dolphin can boot for a `GameCube` disc.
///
/// Deliberately not "every file in the directory": a half-copied download or a
/// stray text file would otherwise appear as a game and fail at boot, which is
/// the kind of thing a person blames the room for.
const PLAYABLE: [&str; 5] = ["rvz", "iso", "gcm", "ciso", "gcz"];

/// One game on this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rom {
    /// Where it is, for handing to Dolphin.
    pub path: PathBuf,
    /// What to call it on screen: the file name without its extension.
    pub name: String,
}

/// Every game in `dir`, sorted by name so a position means the same thing twice.
///
/// An unreadable directory is an empty library rather than an error: a room with
/// no games is a room that says so, and a worker that refuses to start because a
/// directory moved is worse than one that starts and tells you it is empty.
#[must_use]
pub fn scan(dir: &Path) -> Vec<Rom> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut roms: Vec<Rom> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
        .filter_map(|entry| {
            let path = entry.path();
            let extension = path.extension()?.to_str()?.to_lowercase();
            if !PLAYABLE.contains(&extension.as_str()) {
                return None;
            }
            Some(Rom {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                path,
            })
        })
        .collect();
    roms.sort_by(|left, right| left.name.cmp(&right.name));
    roms
}

/// The library as the page reads it.
///
/// Hand-rolled rather than a serialisation crate, because this is the only JSON
/// the worker produces and a dependency that exists for one string is a
/// dependency to keep up to date for ever. What that costs is the escaping,
/// which is therefore written out and tested rather than assumed: a game called
/// `Zelda "Ocarina"` would otherwise produce a document the page cannot parse,
/// and the room would show an empty library with nothing to explain it.
#[must_use]
pub fn catalogue_json(roms: &[Rom], current: Option<usize>) -> String {
    let mut out = String::from("{\"current\":");
    match current {
        Some(index) => out.push_str(&index.to_string()),
        // `null`, not `-1`: a page checking `=== null` cannot be caught out by
        // a number it has to know the meaning of.
        None => out.push_str("null"),
    }
    out.push_str(",\"roms\":[");
    for (index, rom) in roms.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        out.push('"');
        for character in rom.name.chars() {
            match character {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                // Anything a JSON string may not carry raw. A file name should
                // not contain a control character, but "should not" is not a
                // guarantee about somebody else's disk.
                c if (c as u32) < 0x20 => {
                    use std::fmt::Write as _;
                    // The write cannot fail on a String; ignoring the result is
                    // what `push_str` would have done anyway.
                    let _ = write!(out, "\\u{:04x}", c as u32);
                }
                c => out.push(c),
            }
        }
        out.push('"');
    }
    out.push_str("]}");
    out
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) {
        std::fs::write(dir.join(name), b"not really a disc").unwrap();
    }

    #[test]
    fn every_playable_extension_is_found() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["a.rvz", "b.iso", "c.gcm", "d.ciso", "e.gcz"] {
            touch(dir.path(), name);
        }

        let found = scan(dir.path());

        assert_eq!(found.len(), 5, "found {found:?}");
        assert_eq!(found[0].name, "a");
    }

    /// The negative twin. Without it, "finds the games" would pass just as well
    /// while listing every file in the directory, and the half-downloaded one
    /// would fail at boot with nothing to explain it.
    #[test]
    fn anything_dolphin_cannot_boot_is_not_a_game() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["notes.txt", "cover.png", "melee.rvz.part", "no-extension"] {
            touch(dir.path(), name);
        }
        std::fs::create_dir(dir.path().join("saves.iso")).unwrap();

        let found = scan(dir.path());

        assert!(found.is_empty(), "found {found:?}");
    }

    /// A capital in an extension is still that extension. Real libraries have
    /// `.ISO` in them, and a game that vanishes because of its case is a bug
    /// report nobody can reproduce.
    #[test]
    fn the_case_of_an_extension_does_not_hide_a_game() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "Mario.ISO");

        assert_eq!(scan(dir.path()).len(), 1);
    }

    /// The whole reason a position can be sent over a wire: it means the same
    /// thing on both sides, and the same thing after a restart.
    #[test]
    fn the_order_is_by_name_so_a_position_is_stable() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["zelda.iso", "animal.rvz", "melee.gcm"] {
            touch(dir.path(), name);
        }

        let names: Vec<String> = scan(dir.path()).into_iter().map(|rom| rom.name).collect();

        assert_eq!(names, ["animal", "melee", "zelda"]);
    }

    #[test]
    fn the_catalogue_says_which_game_is_running() {
        let roms = vec![
            Rom {
                path: "/a".into(),
                name: "Melee".to_owned(),
            },
            Rom {
                path: "/b".into(),
                name: "Mario Kart".to_owned(),
            },
        ];

        assert_eq!(
            catalogue_json(&roms, Some(1)),
            r#"{"current":1,"roms":["Melee","Mario Kart"]}"#
        );
        // Nothing running is `null` rather than a number standing in for it.
        assert_eq!(
            catalogue_json(&roms, None),
            r#"{"current":null,"roms":["Melee","Mario Kart"]}"#
        );
        assert_eq!(catalogue_json(&[], None), r#"{"current":null,"roms":[]}"#);
    }

    /// A name with a quote in it must not end the string early. Without this,
    /// one file on the disk empties the whole library and the page has nothing
    /// to say about why.
    #[test]
    fn a_name_cannot_break_out_of_the_document() {
        let roms = vec![Rom {
            path: "/a".into(),
            name: "Zelda \"Ocarina\" \\ tab\there".to_owned(),
        }];

        let json = catalogue_json(&roms, Some(0));

        assert_eq!(
            json,
            r#"{"current":0,"roms":["Zelda \"Ocarina\" \\ tab\u0009here"]}"#
        );
    }

    #[test]
    fn a_directory_that_is_not_there_is_an_empty_library_not_a_failure() {
        assert!(scan(Path::new("/nowhere/at/all")).is_empty());
    }
}
