//! La vibration, qui remonte de l'émulateur vers les mains du joueur.
//!
//! # Pourquoi il a fallu un patch
//!
//! L'interface d'entrée par tube nommé est à SENS UNIQUE. La page écrit des
//! boutons, le worker les écrit dans le tube, Dolphin les lit, et rien ne
//! revient: Dolphin n'a aucun chemin pour rendre une vibration à une manette
//! qu'il ne connaît que par un tube.
//!
//! La console émulée, elle, envoie bien la commande, et elle arrive dans
//! `Pad::Rumble`, trois lignes appelées à chaque image. Le troisième patch du
//! projet l'écrit sur un second tube, en deux octets, et c'est ce tube qu'on lit
//! ici.
//!
//! # Ce que le tube porte
//!
//! Deux octets par changement: le numéro de manette vu par Dolphin, de zéro à
//! trois, et la force de zéro à deux cent cinquante-cinq. Seuls les changements
//! sont écrits, sinon il en arriverait deux cent quarante par seconde pour dire
//! quatre fois la même chose.

use std::io::Read;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use crate::error::EmulatorError;

/// Le nom du tube dans le répertoire de session, à côté du son.
pub const RUMBLE_PIPE: &str = "rumble.fifo";

/// Une secousse: quelle manette, et à quelle force.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shake {
    /// Le port, de un à quatre. Converti depuis l'index de Dolphin, qui compte
    /// à partir de zéro, parce que tout le reste du projet compte les ports à
    /// partir de un et qu'un décalage qui traîne finit par se perdre.
    pub port: u8,
    /// La force, de zéro à deux cent cinquante-cinq.
    pub level: u8,
}

/// Le bout du tube que le worker tient.
#[derive(Debug)]
pub struct RumbleTap {
    file: std::fs::File,
    path: PathBuf,
    /// Un octet gardé quand une lecture tombe au milieu d'une paire.
    ///
    /// Un tube ne promet rien sur les frontières: une lecture peut rendre un
    /// nombre impair d'octets. Sans ce report, un octet orphelin décalerait
    /// toute la suite d'une position, et chaque secousse serait attribuée à la
    /// mauvaise manette pour le reste de la partie.
    odd: Option<u8>,
}

impl RumbleTap {
    /// Crée le tube et l'ouvre en lecture, sans bloquer.
    ///
    /// Le tube doit exister AVANT que Dolphin ne démarre, sinon son propre
    /// `open` créerait un fichier ordinaire et la vibration partirait sur le
    /// disque. C'est la même raison, et le même ordre, que pour le son.
    ///
    /// # Errors
    /// [`EmulatorError::CreateFifo`] ou [`EmulatorError::OpenFifo`].
    pub fn open(user_dir: &Path) -> Result<Self, EmulatorError> {
        let path = user_dir.join(RUMBLE_PIPE);
        if let Ok(meta) = std::fs::symlink_metadata(&path)
            && !std::os::unix::fs::FileTypeExt::is_fifo(&meta.file_type())
        {
            let _ = std::fs::remove_file(&path);
        }
        if !path.exists() {
            nix::unistd::mkfifo(&path, nix::sys::stat::Mode::from_bits_truncate(0o600)).map_err(
                |errno| EmulatorError::CreateFifo {
                    path: path.clone(),
                    source: std::io::Error::from(errno),
                },
            )?;
        }
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(nix::fcntl::OFlag::O_NONBLOCK.bits())
            .open(&path)
            .map_err(|source| EmulatorError::OpenFifo {
                path: path.clone(),
                source,
            })?;
        Ok(Self {
            file,
            path,
            odd: None,
        })
    }

    /// Où le tube se trouve, pour le dire à Dolphin.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Ce qui est arrivé depuis le dernier appel.
    ///
    /// Ne bloque jamais et ne rend jamais d'erreur: un tube vide est le cas
    /// NORMAL, puisque la plupart des images ne changent aucune vibration. Une
    /// panne de lecture ne doit pas non plus arrêter une partie, et le pire
    /// qu'elle produise est une manette qui ne vibre plus.
    pub fn drain(&mut self) -> Vec<Shake> {
        let mut buffer = [0_u8; 256];
        let Ok(read) = self.file.read(&mut buffer) else {
            return Vec::new();
        };
        let mut bytes: Vec<u8> = Vec::with_capacity(read + 1);
        bytes.extend(self.odd.take());
        bytes.extend_from_slice(&buffer[..read]);

        let mut shakes = Vec::new();
        let mut pairs = bytes.chunks_exact(2);
        for pair in pairs.by_ref() {
            // Dolphin compte ses manettes à partir de zéro, le reste du projet à
            // partir de un.
            if let (Some(&pad), Some(&level)) = (pair.first(), pair.get(1))
                && pad < 4
            {
                shakes.push(Shake {
                    port: pad + 1,
                    level,
                });
            }
        }
        self.odd = pairs.remainder().first().copied();
        shakes
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tap(tag: &str) -> (RumbleTap, PathBuf) {
        let dir = std::env::temp_dir().join(format!("nel3ab-rumble-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tap = RumbleTap::open(&dir).unwrap();
        let path = tap.path().to_path_buf();
        (tap, path)
    }

    fn write(path: &Path, bytes: &[u8]) {
        let mut pipe = std::fs::OpenOptions::new()
            .write(true)
            .custom_flags(nix::fcntl::OFlag::O_NONBLOCK.bits())
            .open(path)
            .unwrap();
        pipe.write_all(bytes).unwrap();
    }

    /// Le port est décalé, parce que Dolphin compte à partir de zéro.
    #[test]
    fn dolphins_first_pad_is_our_port_one() {
        let (mut tap, path) = tap("first");
        write(&path, &[0, 200, 3, 15]);

        assert_eq!(
            tap.drain(),
            vec![
                Shake {
                    port: 1,
                    level: 200
                },
                Shake { port: 4, level: 15 },
            ]
        );
    }

    /// Un tube vide est le cas NORMAL, pas une panne.
    ///
    /// La plupart des images ne changent aucune vibration. Rendre une erreur ici
    /// ferait passer le silence pour un problème.
    #[test]
    fn an_empty_pipe_is_not_an_error() {
        let (mut tap, _path) = tap("empty");

        assert_eq!(tap.drain(), Vec::new());
    }

    /// Un octet orphelin est GARDÉ pour la lecture suivante.
    ///
    /// C'est la moitié qui compte. Un tube ne promet rien sur les frontières:
    /// sans ce report, un octet coupé en deux décalerait toute la suite d'une
    /// position, et chaque secousse serait attribuée à la mauvaise manette pour
    /// le reste de la partie.
    #[test]
    fn a_pair_split_across_two_reads_is_not_lost() {
        let (mut tap, path) = tap("split");

        write(&path, &[2]);
        assert_eq!(tap.drain(), Vec::new(), "un demi-message ne dit rien");

        write(&path, &[128]);
        assert_eq!(
            tap.drain(),
            vec![Shake {
                port: 3,
                level: 128
            }]
        );
    }

    /// Une manette hors de portée est ignorée plutôt que crue.
    #[test]
    fn a_pad_beyond_four_is_refused() {
        let (mut tap, path) = tap("beyond");
        write(&path, &[9, 255, 1, 64]);

        assert_eq!(
            tap.drain(),
            vec![Shake { port: 2, level: 64 }],
            "une manette inventée a été crue, ou une vraie a été perdue avec elle"
        );
    }
}
