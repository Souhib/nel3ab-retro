//! Personal saves are written directly to persistent storage, with one writer.
use std::io;
use std::io::Read as _;
use std::path::{Path, PathBuf};

use crate::saves::Slot;

/// One-shot request, consumed after the old progress has been archived.
pub const NEW_REQUEST: &str = "new-personal-save";
/// The Docker helper mounts just this person's data at an in-session path.
pub const MOUNT: &str = "personal-save-mount";

/// The guard outlives the emulator, so a second room cannot write the same save.
#[derive(Debug)]
pub struct Personal {
    _held: crate::lock::Held,
    /// Persistent payload directory, independent of the numbered room.
    directory: PathBuf,
}

/// Record the user's action, rather than treating every process restart as new.
///
/// # Errors
/// The request cannot be persisted or a previous request cannot be removed.
pub fn request(session: &Path, slot: Slot, person: &str, rom_file: &str) -> io::Result<()> {
    let path = session.join(NEW_REQUEST);
    if slot == Slot::Fresh && crate::saves::folder_for(slot, Some(person)).starts_with("joueur-") {
        let pending = path.with_extension("pending");
        std::fs::write(&pending, serde_json::json!({"game":rom_file,"person":crate::saves::folder_for(slot,Some(person))}).to_string())?;
        std::fs::rename(pending, path)
    } else {
        remove(&path)
    }
}

/// Lock a personal slot and honour a new-game action once, retaining its history.
///
/// # Errors
/// The slot, history, lock or request cannot be safely written.
pub fn begin(directory: &Path, session: &Path, rom_file: &str) -> io::Result<Option<Personal>> {
    let parent = directory
        .parent()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let name = directory
        .file_name()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let lock = parent.join(".personal-locks").join(name);
    let Some(held) = crate::lock::take_switch(&lock)? else {
        return Ok(None);
    };
    if directory.is_symlink() {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    if new_requested(directory, session, rom_file)? {
        if directory.exists() {
            let history = parent.join("history");
            std::fs::create_dir_all(&history)?;
            let unique = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(io::Error::other)?
                .as_nanos();
            let archive = history.join(format!("{}-{unique}", name.to_string_lossy()));
            if archive.exists() {
                return Err(io::Error::from(io::ErrorKind::AlreadyExists));
            }
            std::fs::rename(directory, archive)?;
        }
        std::fs::create_dir_all(directory)?;
        remove(&session.join(NEW_REQUEST))?;
    } else {
        std::fs::create_dir_all(directory)?;
    }
    Ok(Some(Personal {
        _held: held,
        directory: directory.to_owned(),
    }))
}

fn new_requested(directory: &Path, session: &Path, rom_file: &str) -> io::Result<bool> {
    let file = match std::fs::File::open(session.join(NEW_REQUEST)) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error),
    };
    // A filename is at most 255 bytes and our identity folder at most 96.
    // Four KiB covers their JSON escapes and bounds a damaged local request.
    let mut bytes = Vec::new();
    file.take(4097).read_to_end(&mut bytes)?;
    if bytes.len() > 4096 {
        return Err(io::Error::from(io::ErrorKind::InvalidData));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| io::Error::from(io::ErrorKind::InvalidData))?;
    if value.get("game").and_then(serde_json::Value::as_str) != Some(rom_file)
        || value.get("person").and_then(serde_json::Value::as_str)
            != directory.file_name().and_then(|name| name.to_str())
    {
        return Err(io::Error::from(io::ErrorKind::InvalidData));
    }
    Ok(true)
}

/// Keep Dolphin's links inside its session, while mounting the account's data
/// onto that target. Only the selected account is exposed to this container.
///
/// # Errors
/// A path is outside the mounted session, contains a line break or cannot be written.
pub fn mount(session: &Path, local: &Path, source: &Personal) -> io::Result<()> {
    let inside = local.strip_prefix(session.join("saves")).ok();
    if inside.is_none_or(|path| {
        path.components().count() != 2
            || !path
                .components()
                .all(|p| matches!(p, std::path::Component::Normal(_)))
    }) || !local.is_absolute()
        || !source.directory.is_absolute()
    {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    let from = source
        .directory
        .to_str()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let to = local
        .to_str()
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    if from.contains(['\n', '\r']) || to.contains(['\n', '\r']) {
        return Err(io::Error::from(io::ErrorKind::InvalidInput));
    }
    std::fs::create_dir_all(local)?;
    std::fs::write(session.join(MOUNT), format!("{from}\n{to}\n"))
}

/// Remove a previous mount when launching a shared or anonymous save.
///
/// # Errors
/// A stale mount file exists but cannot be removed.
pub fn clear_mount(session: &Path) -> io::Result<()> {
    remove(&session.join(MOUNT))
}

fn remove(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_game_request_cannot_reset_another_account() -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let session = root.path().join("room");
        std::fs::create_dir(&session)?;
        let a = root.path().join(crate::saves::folder_for(
            Slot::Person,
            Some("a@example.com"),
        ));
        let b = root.path().join(crate::saves::folder_for(
            Slot::Person,
            Some("b@example.com"),
        ));
        std::fs::create_dir(&b)?;
        std::fs::write(b.join("progress"), b"belongs to B")?;
        request(&session, Slot::Fresh, "a@example.com", "game.iso")?;
        assert!(begin(&b, &session, "game.iso").is_err());
        assert_eq!(std::fs::read(b.join("progress"))?, b"belongs to B");
        assert!(begin(&a, &session, "another-game.iso").is_err());
        assert!(!a.exists());
        let accepted = begin(&a, &session, "game.iso")?.ok_or("matching request rejected")?;
        assert!(!accepted.directory.join("progress").exists());
        assert!(!session.join(NEW_REQUEST).exists());
        Ok(())
    }

    #[test]
    fn a_broken_request_never_discards_existing_progress() -> Result<(), Box<dyn std::error::Error>>
    {
        let root = tempfile::tempdir()?;
        let session = root.path().join("room");
        std::fs::create_dir(&session)?;
        let slot = root.path().join(crate::saves::folder_for(
            Slot::Person,
            Some("a@example.com"),
        ));
        std::fs::create_dir(&slot)?;
        std::fs::write(slot.join("progress"), b"keep this")?;
        for broken in [
            "not JSON".to_owned(),
            "x".repeat(4097),
            serde_json::json!({"game":"game.iso"}).to_string(),
        ] {
            std::fs::write(session.join(NEW_REQUEST), broken)?;
            assert!(begin(&slot, &session, "game.iso").is_err());
            assert_eq!(std::fs::read(slot.join("progress"))?, b"keep this");
        }
        request(&session, Slot::Person, "a@example.com", "game.iso")?;
        assert!(begin(&slot, &session, "game.iso")?.is_some());
        Ok(())
    }

    #[test]
    fn new_then_resume_preserves_history_and_separates_two_accounts()
    -> Result<(), Box<dyn std::error::Error>> {
        let root = tempfile::tempdir()?;
        let session = root.path().join("room");
        std::fs::create_dir(&session)?;
        let a = root.path().join(crate::saves::folder_for(
            Slot::Person,
            Some("alex+test@example.com"),
        ));
        let b = root.path().join(crate::saves::folder_for(
            Slot::Person,
            Some("alex-test@example.com"),
        ));
        request(&session, Slot::Fresh, "alex+test@example.com", "game.iso")?;
        let first = begin(&a, &session, "game.iso")?.ok_or("first save busy")?;
        assert!(!session.join(NEW_REQUEST).exists());
        std::fs::write(first.directory.join("progress"), b"first account")?;
        assert!(begin(&a, &session, "game.iso")?.is_none());
        let other = begin(&b, &session, "game.iso")?.ok_or("second save busy")?;
        assert!(!other.directory.join("progress").exists());
        std::fs::write(other.directory.join("progress"), b"second account")?;
        drop(first);
        let resumed = begin(&a, &session, "game.iso")?.ok_or("resume busy")?;
        assert_eq!(
            std::fs::read(resumed.directory.join("progress"))?,
            b"first account"
        );
        let local = session.join("saves/game").join(crate::saves::folder_for(
            Slot::Person,
            Some("alex+test@example.com"),
        ));
        mount(&session, &local, &resumed)?;
        assert_eq!(
            std::fs::read_to_string(session.join(MOUNT))?,
            format!("{}\n{}\n", a.display(), local.display())
        );
        assert!(mount(&session, &root.path().join("outside"), &resumed).is_err());
        drop(resumed);
        request(&session, Slot::Fresh, "alex+test@example.com", "game.iso")?;
        let fresh = begin(&a, &session, "game.iso")?.ok_or("new save busy")?;
        assert!(!fresh.directory.join("progress").exists());
        assert_eq!(
            std::fs::read(other.directory.join("progress"))?,
            b"second account"
        );
        let archives: Vec<_> =
            std::fs::read_dir(root.path().join("history"))?.collect::<Result<_, _>>()?;
        assert_eq!(archives.len(), 1);
        assert_eq!(
            std::fs::read(archives[0].path().join("progress"))?,
            b"first account"
        );
        clear_mount(&session)?;
        assert!(!session.join(MOUNT).exists());
        Ok(())
    }
}
