//! Le choix explicite de fermer le jeu survit au redémarrage du worker.
//!
//! Un marqueur séparé conserve le dernier disque et ses sauvegardes. Son
//! absence garde le comportement des installations précédentes. Une erreur de
//! lecture n'est jamais interprétée comme une permission de relancer Dolphin.

use std::io;
use std::path::Path;

const CLOSED: &str = "game-closed";

/// La salle sert ses menus, avec ou sans émulateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Playback {
    /// Lancer le disque retenu.
    Playing,
    /// Garder les menus disponibles sans lancer Dolphin.
    Idle,
}

impl Playback {
    /// Relit le choix persistant.
    ///
    /// # Errors
    /// L'erreur du système de fichiers si le marqueur est inaccessible.
    pub fn read(directory: &Path) -> io::Result<Self> {
        Ok(if directory.join(CLOSED).try_exists()? {
            Self::Idle
        } else {
            Self::Playing
        })
    }

    /// Retient le choix avant de quitter le worker. Les sauvegardes restent en place.
    ///
    /// # Errors
    /// L'erreur du système de fichiers si le choix ne peut pas être retenu.
    pub fn store(self, directory: &Path) -> io::Result<()> {
        let path = directory.join(CLOSED);
        match self {
            Self::Idle => std::fs::write(path, []),
            Self::Playing => match std::fs::remove_file(path) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                result => result,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_survives_a_restart_until_an_explicit_launch() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        let path = directory.path();
        std::fs::write(path.join("chosen-rom"), "kart.rvz")?;
        assert_eq!(Playback::read(path)?, Playback::Playing);
        Playback::Idle.store(path)?;
        assert_eq!(Playback::read(path)?, Playback::Idle);
        assert_eq!(
            std::fs::read_to_string(path.join("chosen-rom"))?,
            "kart.rvz"
        );
        Playback::Playing.store(path)?;
        assert_eq!(Playback::read(path)?, Playback::Playing);
        Playback::Playing.store(path)?;
        Ok(())
    }

    #[test]
    fn an_unwritable_choice_is_not_reported_as_saved() -> io::Result<()> {
        let directory = tempfile::tempdir()?;
        std::fs::create_dir(directory.path().join(CLOSED))?;
        assert!(Playback::Idle.store(directory.path()).is_err());
        assert!(Playback::Playing.store(directory.path()).is_err());
        Ok(())
    }
}
