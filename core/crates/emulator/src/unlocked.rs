//! An imported complete save needs an explicit receipt, not just a folder name.
use std::collections::HashSet;
use std::io::Read as _;
use std::path::{Component, Path, PathBuf};

/// Receipt written by the import tools after installing an unlocked save.
pub const RECEIPT: &str = "unlocked.json";

/// Whether every payload named by a complete-save receipt still exists.
#[must_use]
pub fn available(directory: &Path) -> bool {
    read_receipt(directory).unwrap_or(false)
}

fn read_receipt(directory: &Path) -> Option<bool> {
    let root = std::fs::symlink_metadata(directory).ok()?;
    if !root.is_dir() || root.is_symlink() {
        return None;
    }
    let path = directory.join(RECEIPT);
    if !std::fs::symlink_metadata(&path).ok()?.is_file() {
        return None;
    }
    // Inventory on 2026-11-10: at most 13 payloads per installed import,
    // duplicated across two Switch banks. The importer caps logical files
    // at 64, so 128 physical paths cover both banks. 64 KiB leaves
    // room for their paths while bounding reads of a damaged local receipt.
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(65_537)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 65_536 {
        return None;
    }
    let receipt: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    if receipt.get("version")?.as_u64()? != 1 || receipt.get("source")?.as_str()?.trim().is_empty()
    {
        return None;
    }
    let files = receipt.get("files")?.as_array()?;
    if files.is_empty() || files.len() > 128 {
        return None;
    }
    let mut seen = HashSet::new();
    for value in files {
        let name = value.as_str()?;
        if name == RECEIPT
            || name.split('/').any(|part| matches!(part, "" | "." | ".."))
            || !seen.insert(name)
        {
            return None;
        }
        let mut current = directory.to_owned();
        for part in Path::new(name).components() {
            let Component::Normal(part) = part else {
                return None;
            };
            current.push(part);
            if std::fs::symlink_metadata(&current).ok()?.is_symlink() {
                return None;
            }
        }
        let metadata = std::fs::metadata(current).ok()?;
        if !metadata.is_file() || metadata.len() == 0 {
            return None;
        }
    }
    Some(true)
}

/// State root from the same local configuration consumed by an adapter.
#[must_use]
pub fn state_root(config: &Path) -> Option<PathBuf> {
    let mut bytes = Vec::new();
    // The installed adapter configs are below 2 KiB (2026-11-10); use the
    // receipt read bound here too, rather than reading arbitrary local files.
    std::fs::File::open(config)
        .ok()?
        .take(65_537)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 65_536 {
        return None;
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let root = PathBuf::from(value.get("state")?.as_str()?);
    root.is_absolute().then_some(root)
}

/// Resolve each console's real save storage without starting an emulator.
#[must_use]
pub fn directories(
    roms: &[crate::Rom],
    discs: &[crate::Disc],
    session: &Path,
    switch: Option<&Path>,
    switch2: Option<&Path>,
) -> Vec<Option<PathBuf>> {
    roms.iter()
        .enumerate()
        .map(|(index, rom)| {
            let disc = discs.get(index)?;
            match disc.console {
                crate::Console::GameCube | crate::Console::Wii => Some(crate::saves::slot_dir(
                    &session.join("saves"),
                    &rom.file,
                    crate::saves::Slot::Unlocked,
                    None,
                )),
                crate::Console::Switch | crate::Console::Switch2 => {
                    let title = disc.title.as_deref()?;
                    if title.len() != 16 || !title.bytes().all(|c| c.is_ascii_hexdigit()) {
                        return None;
                    }
                    let root = if disc.console == crate::Console::Switch {
                        switch?
                    } else {
                        switch2?
                    };
                    Some(root.join(title.to_ascii_lowercase()).join("debloquee"))
                }
                crate::Console::Unknown => None,
            }
        })
        .collect()
}

/// JSON in catalogue order. No filesystem path reaches the browser.
#[must_use]
pub fn catalogue(directories: &[Option<PathBuf>]) -> String {
    serde_json::json!(availability(directories)).to_string()
}

/// Availability in catalogue order, re-read when the menu requests it.
#[must_use]
pub fn availability(directories: &[Option<PathBuf>]) -> Vec<bool> {
    directories
        .iter()
        .map(|p| p.as_deref().is_some_and(available))
        .collect()
}

/// Recheck a persisted launch after restart, before publishing a running game.
#[must_use]
pub fn allows_start(slot: crate::saves::Slot, directory: Option<&Path>) -> bool {
    slot != crate::saves::Slot::Unlocked || directory.is_some_and(available)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_persisted_unlocked_launch_needs_its_payload_again()
    -> Result<(), Box<dyn std::error::Error>> {
        use crate::saves::Slot;
        let dir = tempfile::tempdir()?;
        assert!(!allows_start(Slot::Unlocked, None));
        assert!(!allows_start(Slot::Unlocked, Some(dir.path())));
        std::fs::write(dir.path().join("save"), b"qualified fixture")?;
        receipt(dir.path(), &serde_json::json!(["save"]))?;
        assert!(allows_start(Slot::Unlocked, Some(dir.path())));
        std::fs::remove_file(dir.path().join("save"))?;
        assert!(!allows_start(Slot::Unlocked, Some(dir.path())));
        for slot in [Slot::Fresh, Slot::Person] {
            assert!(allows_start(slot, None));
            assert!(allows_start(slot, Some(dir.path())));
        }
        Ok(())
    }

    fn receipt(dir: &Path, files: &serde_json::Value) -> std::io::Result<()> {
        std::fs::write(
            dir.join(RECEIPT),
            serde_json::json!({"version":1,"source":"verified fixture import","files":files})
                .to_string(),
        )
    }

    #[test]
    fn a_folder_or_an_ordinary_save_is_not_an_import_receipt()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        assert!(!available(dir.path()));
        std::fs::write(dir.path().join("progress.sav"), b"ordinary progress")?;
        assert!(!available(dir.path()));
        receipt(dir.path(), &serde_json::json!(["progress.sav"]))?;
        assert!(available(dir.path()));
        std::fs::remove_file(dir.path().join("progress.sav"))?;
        assert!(!available(dir.path()));
        Ok(())
    }

    #[test]
    fn every_declared_file_must_be_real_nonempty_and_inside_the_slot()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        std::fs::create_dir(dir.path().join("bank"))?;
        std::fs::write(dir.path().join("bank/save.dat"), b"complete fixture")?;
        std::fs::write(dir.path().join("empty"), b"")?;
        let outside =
            tempfile::NamedTempFile::new_in(dir.path().parent().ok_or("missing parent")?)?;
        std::fs::write(outside.path(), b"real outside payload")?;
        assert!(outside.path().is_file());
        for invalid in [
            serde_json::json!([]),
            serde_json::json!(["missing"]),
            serde_json::json!(["bank/save.dat", "missing"]),
            serde_json::json!(["empty"]),
            serde_json::json!([format!(
                "../{}",
                outside
                    .path()
                    .file_name()
                    .ok_or("missing filename")?
                    .to_string_lossy()
            )]),
            serde_json::json!([outside.path()]),
            serde_json::json!(["bank/../bank/save.dat"]),
            serde_json::json!(["bank/save.dat", "bank/save.dat"]),
            serde_json::json!(["unlocked.json"]),
            serde_json::json!(["bank/./save.dat"]),
            serde_json::json!(["bank//save.dat"]),
            serde_json::json!([true]),
        ] {
            receipt(dir.path(), &invalid)?;
            assert!(!available(dir.path()), "{invalid}");
        }
        receipt(dir.path(), &serde_json::json!(["bank/save.dat"]))?;
        assert!(available(dir.path()));
        std::os::unix::fs::symlink("bank", dir.path().join("linked"))?;
        receipt(dir.path(), &serde_json::json!(["linked/save.dat"]))?;
        assert!(!available(dir.path()));
        std::os::unix::fs::symlink("bank/save.dat", dir.path().join("linked.dat"))?;
        receipt(dir.path(), &serde_json::json!(["linked.dat"]))?;
        assert!(!available(dir.path()));
        Ok(())
    }

    #[test]
    fn malformed_receipts_and_unknown_versions_fail_closed()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        std::fs::write(dir.path().join("save"), b"fixture")?;
        for bad in [
            "{}".to_owned(),
            "not json".to_owned(),
            serde_json::json!({"version":2,"source":"fixture","files":["save"]}).to_string(),
            serde_json::json!({"version":1,"source":" ","files":["save"]}).to_string(),
            "x".repeat(65_537),
        ] {
            std::fs::write(dir.path().join(RECEIPT), bad)?;
            assert!(!available(dir.path()));
        }
        receipt(dir.path(), &serde_json::json!(["save"]))?;
        assert!(available(dir.path()));
        assert_eq!(catalogue(&[None, Some(dir.path().into())]), "[false,true]");
        Ok(())
    }

    #[test]
    fn consoles_resolve_their_actual_storage_and_unknowns_stay_unavailable()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let config = root.path().join("adapter.json");
        std::fs::write(&config, r#"{"state":"relative"}"#)?;
        assert!(state_root(&config).is_none());
        std::fs::write(
            &config,
            serde_json::json!({"state":root.path().join("hybrid")}).to_string(),
        )?;
        assert_eq!(state_root(&config), Some(root.path().join("hybrid")));
        let consoles = [
            crate::Console::GameCube,
            crate::Console::Wii,
            crate::Console::Switch,
            crate::Console::Switch2,
            crate::Console::Unknown,
        ];
        let roms: Vec<_> = consoles
            .iter()
            .enumerate()
            .map(|(n, _)| crate::Rom {
                path: root.path().join(format!("game{n}.iso")),
                file: format!("game{n}.iso"),
                name: format!("game{n}"),
            })
            .collect();
        let discs: Vec<_> = consoles
            .into_iter()
            .map(|console| crate::Disc {
                console,
                title: Some("0400486024dec000".into()),
            })
            .collect();
        let paths = directories(
            &roms,
            &discs,
            root.path(),
            Some(&root.path().join("hybrid")),
            Some(&root.path().join("nx2")),
        );
        assert_eq!(
            paths[0],
            Some(root.path().join("saves/game0-iso/debloquee"))
        );
        assert_eq!(
            paths[1],
            Some(root.path().join("saves/game1-iso/debloquee"))
        );
        assert_eq!(
            paths[2],
            Some(root.path().join("hybrid/0400486024dec000/debloquee"))
        );
        assert_eq!(
            paths[3],
            Some(root.path().join("nx2/0400486024dec000/debloquee"))
        );
        assert!(paths[4].is_none());
        assert!(directories(&roms, &discs, root.path(), None, None)[2].is_none());
        Ok(())
    }

    #[test]
    fn receipt_limits_accept_the_boundary_and_reject_the_next_value()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::tempdir()?;
        let names: Vec<_> = (0..129).map(|i| format!("save-{i}")).collect();
        for name in &names {
            std::fs::write(dir.path().join(name), b"real payload")?;
        }
        receipt(dir.path(), &serde_json::json!(&names[..128]))?;
        assert!(available(dir.path()));
        receipt(dir.path(), &serde_json::json!(&names))?;
        assert!(!available(dir.path()));
        let mut value = serde_json::json!({"version":1,"source":"x","files":["save-0"]});
        let extra = 65_536 - value.to_string().len();
        value["source"] = serde_json::json!("x".repeat(extra + 1));
        let at_limit = value.to_string();
        assert_eq!(at_limit.len(), 65_536);
        std::fs::write(dir.path().join(RECEIPT), at_limit)?;
        assert!(available(dir.path()));
        value["source"] = serde_json::json!("x".repeat(extra + 2));
        let above = value.to_string();
        assert_eq!(above.len(), 65_537);
        std::fs::write(dir.path().join(RECEIPT), above)?;
        assert!(!available(dir.path()));
        Ok(())
    }
}
