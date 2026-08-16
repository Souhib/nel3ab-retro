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
    /// What to call it on screen: the file name, cleaned of the cataloguing
    /// that dump collections carry. See [`title`].
    pub name: String,
    /// The file name, which is what a choice is REMEMBERED by.
    ///
    /// Separate from `name` because the display name is now allowed to change
    /// when the cleaning rules improve, and a remembered choice must not stop
    /// matching because a title lost a parenthesis.
    pub file: String,
}

/// Groups a dump collection adds, and that nobody wants to read on a menu.
///
/// Deliberately a short list of KNOWN shapes rather than "drop every
/// parenthesis": one of the games here is `Mario Kart Double Dash (Retro Track
/// Grand Prix)`, where the parenthesis is the name of the hack and the only
/// thing distinguishing it. A rule that strips everything would have renamed it
/// to a game it is not.
fn is_cataloguing(group: &str) -> bool {
    const REGIONS: [&str; 16] = [
        "usa",
        "europe",
        "japan",
        "world",
        "australia",
        "korea",
        "france",
        "germany",
        "spain",
        "italy",
        "netherlands",
        "sweden",
        "brazil",
        "canada",
        "asia",
        "taiwan",
    ];
    let lower = group.trim().to_lowercase();

    // A region, or a list of them: `USA, Europe`.
    if lower.split(',').all(|part| REGIONS.contains(&part.trim())) {
        return true;
    }
    // A revision: `Rev 2`, `Rev A`.
    if let Some(rest) = lower.strip_prefix("rev ")
        && !rest.is_empty()
        && rest.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return true;
    }
    // A language list: `En,Fr,De,Es,It`. Two letters each, at least two of them,
    // because a single `En` is more likely part of a title than a catalogue tag.
    let languages: Vec<&str> = group.split(',').map(str::trim).collect();
    languages.len() >= 2
        && languages.iter().all(|code| {
            code.len() == 2
                && code.starts_with(|c: char| c.is_ascii_uppercase())
                && code.ends_with(|c: char| c.is_ascii_lowercase())
        })
}

/// The name a person reads, from the name a dump carries.
///
/// `Mario Party 4 (Europe) (En,Fr,De,Es,It) (Rev 2)` becomes `Mario Party 4`.
/// Anything that is not recognised cataloguing stays, parentheses included.
#[must_use]
pub fn title(stem: &str) -> String {
    let mut out = String::with_capacity(stem.len());
    let mut rest = stem;
    while let Some(open) = rest.find('(') {
        let Some(close) = rest[open..].find(')') else {
            break;
        };
        let group = &rest[open + 1..open + close];
        if is_cataloguing(group) {
            // The text before the group is kept; the group and the space that
            // introduced it go together, or every removal leaves a double space.
            out.push_str(rest[..open].trim_end());
            out.push(' ');
        } else {
            out.push_str(&rest[..=open + close]);
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
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
            let stem = path.file_stem()?.to_string_lossy().into_owned();
            Some(Rom {
                name: title(&stem),
                file: path.file_name()?.to_string_lossy().into_owned(),
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
///
/// `players` is here for one reason: it is the worker that decides how many pads
/// a room has, because it is the worker that tells Dolphin which ports hold one
/// at boot. It used to be configured a second time on the control plane, which
/// meant two settings that had to agree and nothing making them. Anything that
/// needs the number now asks the thing that knows it.
#[must_use]
pub fn catalogue_json(roms: &[Rom], current: Option<usize>, players: u8) -> String {
    let mut out = format!("{{\"players\":{players},\"current\":");
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

    /// Ce que la bibliothèque doit afficher, à partir de ce que les collections
    /// de dumps écrivent vraiment.
    #[test]
    fn cataloguing_is_removed_from_the_name_on_screen() {
        for (raw, wanted) in [
            (
                "Mario Party 4 (Europe) (En,Fr,De,Es,It) (Rev 2)",
                "Mario Party 4",
            ),
            (
                "Mario Power Tennis (Europe) (En,Fr,De,Es,It)",
                "Mario Power Tennis",
            ),
            ("Super Mario Strikers (USA)", "Super Mario Strikers"),
            ("Zelda (USA, Europe)", "Zelda"),
            ("Something (Rev A)", "Something"),
        ] {
            assert_eq!(title(raw), wanted, "from {raw}");
        }
    }

    /// The negative twin, and the reason the rule is a list of known shapes
    /// rather than "drop every parenthesis": one game in this library IS its
    /// parenthesis. Stripping it would rename a hack to the game it modifies.
    #[test]
    fn a_parenthesis_that_is_part_of_the_title_survives() {
        for name in [
            "Mario Kart Double Dash (Retro Track Grand Prix)",
            "Super Smash Bros Melee",
            "Zelda (Collector's Edition)",
            "Wario Ware (Mega Party Games)",
        ] {
            assert_eq!(title(name), name);
        }
    }

    /// Un seul code de langue ressemble trop à un mot pour être retiré.
    #[test]
    fn one_word_that_looks_like_a_language_is_not_cataloguing() {
        assert_eq!(title("Something (En)"), "Something (En)");
    }

    /// The remembered choice keys on the FILE, not on what is displayed: the
    /// cleaning rules are allowed to improve without a room forgetting what it
    /// was playing.
    #[test]
    fn the_file_name_is_kept_beside_the_title() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "Mario Party 5 (Europe) (En,Fr,De,Es,It).rvz");

        let found = scan(dir.path());

        assert_eq!(found[0].name, "Mario Party 5");
        assert_eq!(found[0].file, "Mario Party 5 (Europe) (En,Fr,De,Es,It).rvz");
    }

    #[test]
    fn the_catalogue_says_which_game_is_running() {
        let roms = vec![
            Rom {
                path: "/a".into(),
                name: "Melee".to_owned(),
                file: "Melee.rvz".to_owned(),
            },
            Rom {
                path: "/b".into(),
                name: "Mario Kart".to_owned(),
                file: "Mario Kart.rvz".to_owned(),
            },
        ];

        assert_eq!(
            catalogue_json(&roms, Some(1), 4),
            r#"{"players":4,"current":1,"roms":["Melee","Mario Kart"]}"#
        );
        // Nothing running is `null` rather than a number standing in for it.
        assert_eq!(
            catalogue_json(&roms, None, 4),
            r#"{"players":4,"current":null,"roms":["Melee","Mario Kart"]}"#
        );
        assert_eq!(
            catalogue_json(&[], None, 1),
            r#"{"players":1,"current":null,"roms":[]}"#
        );
    }

    /// A name with a quote in it must not end the string early. Without this,
    /// one file on the disk empties the whole library and the page has nothing
    /// to say about why.
    #[test]
    fn a_name_cannot_break_out_of_the_document() {
        let roms = vec![Rom {
            path: "/a".into(),
            name: "Zelda \"Ocarina\" \\ tab\there".to_owned(),
            file: "z.rvz".to_owned(),
        }];

        let json = catalogue_json(&roms, Some(0), 2);

        assert_eq!(
            json,
            r#"{"players":2,"current":0,"roms":["Zelda \"Ocarina\" \\ tab\u0009here"]}"#
        );
    }

    #[test]
    fn a_directory_that_is_not_there_is_an_empty_library_not_a_failure() {
        assert!(scan(Path::new("/nowhere/at/all")).is_empty());
    }
}
