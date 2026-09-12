//! Un seul worker à la fois par répertoire de session.
//!
//! Le répertoire de session porte tout l'état durable d'une salle: la
//! configuration de l'émulateur, ses tubes, le jeu retenu et surtout les
//! sauvegardes, reliées par lien symbolique à ce que le jeu écrit. Deux workers
//! sur le même répertoire ne se voient pas: chacun pose ses liens, et le second
//! à s'arrêter écrase la partie du premier, sans une erreur nulle part. La seule
//! détection qui existait était une sonde audio de 250 ms au démarrage, qui ne
//! couvre que le son et arrive après la création des dossiers.
//!
//! Le geste existe déjà ailleurs dans le projet, en Python, pour la même raison:
//! `docker/switch-room.py` tient un `flock` sur l'emplacement pendant toute la
//! partie, et l'outillage refuse d'y toucher tant qu'il est tenu.
//!
//! Le verrou du système survit à un worker tué: le noyau le relâche avec le
//! fichier. Un worker qui reste, lui, le garde, ce qui est exactement voulu.

use std::fs::File;
use std::io;
use std::path::Path;

/// Le nom du fichier verrou, à côté des autres marqueurs de la session.
const LOCK: &str = "room.lock";

/// Le verrou d'une salle, tenu tant que cette valeur vit.
///
/// Rien à appeler pour le rendre: la fermeture du fichier le relâche, y compris
/// si le worker meurt sans passer par son arrêt propre.
#[derive(Debug)]
pub struct Held(
    // Le fichier n'est jamais relu: c'est sa DURÉE DE VIE qui est le verrou, et
    // le noyau le relâche à sa fermeture. `expect` plutôt qu'`allow` pour que
    // l'avertissement revienne si un jour quelqu'un s'en sert vraiment.
    #[expect(dead_code, reason = "tenu pour son Drop, jamais lu")] File,
);

/// Prend le répertoire de session pour cette salle.
///
/// Rend `None` quand un autre worker le tient déjà: ce n'est pas une panne, et
/// l'appelant doit le dire clairement plutôt que démarrer une salle qui
/// écraserait les sauvegardes de l'autre.
///
/// # Errors
/// L'erreur du système de fichiers si le répertoire ou le verrou est
/// inaccessible, ce qui n'est pas la même chose qu'un répertoire déjà pris.
pub fn take(session_dir: &Path) -> io::Result<Option<Held>> {
    std::fs::create_dir_all(session_dir)?;
    let file = File::create(session_dir.join(LOCK))?;
    match file.try_lock() {
        Ok(()) => Ok(Some(Held(file))),
        // Déjà tenu: une autre salle vit ici. Ce n'est pas une panne du disque,
        // et l'appelant doit pouvoir le dire avec ses mots.
        Err(std::fs::TryLockError::WouldBlock) => Ok(None),
        Err(std::fs::TryLockError::Error(error)) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deux salles sur le même dossier: la seconde doit être refusée.
    #[test]
    fn un_second_worker_sur_le_meme_dossier_est_refuse() -> io::Result<()> {
        let dossier = tempfile::tempdir()?;
        let premier = take(dossier.path())?;
        assert!(premier.is_some(), "le premier worker doit pouvoir entrer");
        assert!(
            take(dossier.path())?.is_none(),
            "un second worker a pris le même répertoire de session"
        );
        drop(premier);
        Ok(())
    }

    /// Le jumeau négatif: un verrou relâché ne doit bloquer personne.
    #[test]
    fn un_verrou_relache_laisse_entrer_le_suivant() -> io::Result<()> {
        let dossier = tempfile::tempdir()?;
        let premier = take(dossier.path())?;
        assert!(premier.is_some());
        drop(premier);
        assert!(
            take(dossier.path())?.is_some(),
            "le verrou n'a pas été rendu à la fermeture du worker"
        );
        Ok(())
    }

    /// Deux dossiers différents sont deux salles différentes.
    #[test]
    fn deux_salles_distinctes_ne_se_genent_pas() -> io::Result<()> {
        let une = tempfile::tempdir()?;
        let autre = tempfile::tempdir()?;
        let _premier = take(une.path())?.expect("la première salle entre");
        assert!(take(autre.path())?.is_some(), "une autre salle a été bloquée");
        Ok(())
    }
}
