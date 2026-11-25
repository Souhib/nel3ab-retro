//! Les petits fichiers que le worker écrit et relit dans le dossier de session,
//! sans jamais suivre un lien (ADR D36).
//!
//! Le conteneur de Dolphin monte ce dossier en écriture. Un moteur compromis
//! peut y laisser, pendant une session, un lien à la place de `chosen-rom`, de
//! `chosen-setup` ou de `game-closed`, ou un tube nommé. `std::fs::write`
//! suivait le lien et écrasait un fichier de l'hôte, au compte du worker, avec
//! le nom du jeu ou l'adresse de la personne ; `std::fs::read_to_string`
//! restait bloqué sur un tube au démarrage, alors que le salon avait déjà
//! répondu (relecture finale du 25 novembre 2026, `open_on_order`).
//!
//! Les deux fonctions passent par le descripteur du dossier, comme
//! `take_open_order` et les images de la bibliothèque :
//! - écrire, c'est créer un nom provisoire neuf (`O_EXCL | O_NOFOLLOW`) puis
//!   le renommer par-dessus le nom voulu, ce qui REMPLACE un lien ou un tube
//!   au lieu de le suivre ;
//! - lire, c'est ouvrir sans suivre et sans attendre (`O_NOFOLLOW |
//!   O_NONBLOCK`), et n'accepter qu'un fichier ordinaire. Un lien, un tube ou
//!   un dossier à ce nom se lit comme une absence.

use std::io::{self, Read as _, Write as _};
use std::path::Path;

use nix::errno::Errno;
use nix::fcntl::OFlag;
use nix::sys::stat::Mode;

/// Écrit `contents` sous `name` dans `dir`, sans suivre de lien.
///
/// Atomique pour qui lit : l'ancien contenu ou le nouveau, jamais la moitié.
///
/// # Errors
/// Le dossier ne s'ouvre pas, le nom provisoire ne se crée pas, ou le
/// renommage échoue (un dossier à ce nom, par exemple).
pub fn write_no_follow(dir: &Path, name: &str, contents: &[u8]) -> io::Result<()> {
    let folder = std::fs::File::open(dir)?;
    let provisional = format!(".{name}.{}.tmp", std::process::id());
    // Un provisoire laissé par un worker mort, ou posé là par le conteneur :
    // retiré sans être suivi (`unlinkat` retire le lien, pas sa cible).
    let _ = nix::unistd::unlinkat(
        &folder,
        provisional.as_str(),
        nix::unistd::UnlinkatFlags::NoRemoveDir,
    );
    let fd = nix::fcntl::openat(
        &folder,
        provisional.as_str(),
        OFlag::O_WRONLY | OFlag::O_CREAT | OFlag::O_EXCL | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC,
        Mode::from_bits_truncate(0o644),
    )?;
    let written = std::fs::File::from(fd).write_all(contents).and_then(|()| {
        nix::fcntl::renameat(&folder, provisional.as_str(), &folder, name).map_err(Into::into)
    });
    if written.is_err() {
        let _ = nix::unistd::unlinkat(
            &folder,
            provisional.as_str(),
            nix::unistd::UnlinkatFlags::NoRemoveDir,
        );
    }
    written
}

/// Lit `name` dans `dir` s'il est un fichier ordinaire, sans suivre de lien ni
/// attendre un tube. Au plus `max` octets : au-delà, le fichier est refusé.
///
/// `Ok(None)` : rien à ce nom, ou autre chose qu'un fichier ordinaire, ou un
/// fichier trop gros. Le worker le traite comme un fichier absent, ce qui est
/// toujours le repli prudent de ces petits choix retenus.
///
/// # Errors
/// Le dossier lui-même ne s'ouvre pas, ou la lecture échoue.
pub fn read_regular(dir: &Path, name: &str, max: usize) -> io::Result<Option<Vec<u8>>> {
    let folder = std::fs::File::open(dir)?;
    let fd = match nix::fcntl::openat(
        &folder,
        name,
        OFlag::O_RDONLY | OFlag::O_NOFOLLOW | OFlag::O_NONBLOCK | OFlag::O_CLOEXEC,
        Mode::empty(),
    ) {
        Ok(fd) => fd,
        // Absent, ou un lien (`ELOOP` sous `O_NOFOLLOW`) : rien à lire.
        Err(Errno::ENOENT | Errno::ELOOP) => return Ok(None),
        Err(errno) => return Err(errno.into()),
    };
    let file = std::fs::File::from(fd);
    if !file.metadata()?.is_file() {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    file.take(max as u64 + 1).read_to_end(&mut bytes)?;
    Ok((bytes.len() <= max).then_some(bytes))
}

/// [`read_regular`] en texte : `None` aussi pour des octets qui ne sont pas de
/// l'UTF-8, ou pour toute erreur. Les choix retenus retombent alors sur leur
/// défaut, comme pour un fichier absent.
#[must_use]
pub fn read_text(dir: &Path, name: &str, max: usize) -> Option<String> {
    read_regular(dir, name, max)
        .ok()
        .flatten()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    const HOTE: &str = "contenu de l'hôte";

    /// Un dossier de session, et à côté un fichier de l'hôte que rien ne doit
    /// toucher.
    fn with_host() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
        let root = tempfile::tempdir().unwrap();
        let session = root.path().join("session");
        std::fs::create_dir(&session).unwrap();
        let host = root.path().join("precieux");
        std::fs::write(&host, HOTE).unwrap();
        (root, session, host)
    }

    #[test]
    fn writing_replaces_a_link_and_leaves_its_target_intact() {
        let (_root, session, host) = with_host();
        std::os::unix::fs::symlink(&host, session.join("chosen-rom")).unwrap();

        write_no_follow(&session, "chosen-rom", b"Melee.rvz").unwrap();

        assert_eq!(std::fs::read_to_string(&host).unwrap(), HOTE);
        let meta = std::fs::symlink_metadata(session.join("chosen-rom")).unwrap();
        assert!(
            meta.is_file(),
            "le lien est remplacé par un fichier ordinaire"
        );
        assert_eq!(
            std::fs::read_to_string(session.join("chosen-rom")).unwrap(),
            "Melee.rvz"
        );
    }

    /// Le jumeau : `std::fs::write`, l'appel d'avant, suit le lien. Sans ce
    /// témoin, l'essai du dessus passerait aussi sur un système qui ne suit
    /// jamais les liens.
    #[test]
    fn the_old_call_follows_the_link() {
        let (_root, session, host) = with_host();
        std::os::unix::fs::symlink(&host, session.join("chosen-rom")).unwrap();
        std::fs::write(session.join("chosen-rom"), "Melee.rvz").unwrap();
        assert_eq!(std::fs::read_to_string(&host).unwrap(), "Melee.rvz");
    }

    #[test]
    fn writing_replaces_a_pipe_without_blocking() {
        let (_root, session, _host) = with_host();
        nix::unistd::mkfifo(&session.join("chosen-pad"), Mode::from_bits_truncate(0o644)).unwrap();
        write_no_follow(&session, "chosen-pad", b"1").unwrap();
        assert_eq!(
            std::fs::read_to_string(session.join("chosen-pad")).unwrap(),
            "1"
        );
    }

    #[test]
    fn writing_an_ordinary_file_and_reading_it_back() {
        let (_root, session, _host) = with_host();
        std::fs::write(session.join("chosen-save"), "0").unwrap();
        write_no_follow(&session, "chosen-save", b"2").unwrap();
        assert_eq!(read_text(&session, "chosen-save", 16).as_deref(), Some("2"));
        // Aucun provisoire ne reste.
        let left: Vec<_> = std::fs::read_dir(&session)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["chosen-save"]);
    }

    #[test]
    fn a_directory_at_the_name_is_an_error_not_a_success() {
        let (_root, session, _host) = with_host();
        std::fs::create_dir(session.join("game-closed")).unwrap();
        assert!(write_no_follow(&session, "game-closed", b"").is_err());
    }

    #[test]
    fn reading_ignores_a_link_a_pipe_and_a_directory() {
        let (_root, session, host) = with_host();
        std::os::unix::fs::symlink(&host, session.join("chosen-setup")).unwrap();
        nix::unistd::mkfifo(&session.join("chosen-pad"), Mode::from_bits_truncate(0o644)).unwrap();
        std::fs::create_dir(session.join("chosen-rom")).unwrap();
        for name in ["chosen-setup", "chosen-pad", "chosen-rom", "absent"] {
            assert_eq!(read_regular(&session, name, 64).unwrap(), None, "{name}");
        }
    }

    #[test]
    fn reading_refuses_an_oversized_file() {
        let (_root, session, _host) = with_host();
        std::fs::write(session.join("chosen-person"), "x".repeat(65)).unwrap();
        assert_eq!(read_regular(&session, "chosen-person", 64).unwrap(), None);
        std::fs::write(session.join("chosen-person"), "x".repeat(64)).unwrap();
        assert_eq!(
            read_regular(&session, "chosen-person", 64)
                .unwrap()
                .map(|b| b.len()),
            Some(64)
        );
    }
}
