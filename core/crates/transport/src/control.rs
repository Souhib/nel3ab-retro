//! Ce que le plan de contrôle dit au worker, et par où.
//!
//! # Pourquoi un deuxième port
//!
//! Le proxy Tailscale envoie `/` au worker, donc **tout chemin que le worker
//! sert est joignable depuis un navigateur**. Une route `/owner` sur le serveur
//! de pages laisserait n'importe quelle console de développeur se déclarer
//! propriétaire, ce qui est exactement la règle qu'on essaie de poser.
//!
//! Cette écoute-ci est sur un autre port, que le proxy ne relaie pas du tout.
//! Seul un processus de la machine peut l'atteindre, et c'est une propriété de
//! la liaison plutôt que d'un fichier de configuration ailleurs: retirer une
//! ligne du proxy ne peut pas l'ouvrir par accident.
//!
//! # Le protocole, et pourquoi il tient en une ligne
//!
//! `owner <place>\n`, où la place est `0..=4` et `0` veut dire personne. Pas de
//! HTTP, pas de JSON: un seul message existe, et une bibliothèque de plus pour
//! le lire serait une dépendance à tenir à jour pour deux mots.

use std::io::{BufRead as _, BufReader, Write as _};
use std::net::{SocketAddr, TcpListener};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use nel3ab_protocol::PlayerSlot;

use crate::browser::TransportError;

/// La place qui a le droit de changer de jeu, ou personne.
///
/// `None` veut dire « aucune règle »: la salle retombe alors sur ce qu'elle
/// faisait avant, où tenir une manette suffit. C'est le cas quand le plan de
/// contrôle n'est pas là, et refuser tout ferait une salle où plus personne ne
/// peut rien.
pub type OwnerSeat = Arc<Mutex<Option<PlayerSlot>>>;

/// Lit un ordre. `None` veut dire « je ne comprends pas », et l'appelant se tait
/// plutôt que d'agir sur une supposition.
#[must_use]
pub fn parse(line: &str) -> Option<Option<PlayerSlot>> {
    let rest = line.trim().strip_prefix("owner ")?;
    let seat: u8 = rest.trim().parse().ok()?;
    if seat == 0 {
        return Some(None);
    }
    PlayerSlot::new(seat).ok().map(Some)
}

/// Écoute les ordres du plan de contrôle jusqu'à l'arrêt du processus.
///
/// # Errors
/// [`TransportError::Bind`] si le port est pris.
pub fn serve(address: SocketAddr, owner: OwnerSeat) -> Result<JoinHandle<()>, TransportError> {
    let listener =
        TcpListener::bind(address).map_err(|source| TransportError::Bind { address, source })?;
    let bound = listener
        .local_addr()
        .map_err(|source| TransportError::Accept { source })?;
    tracing::info!(%bound, "control listener ready");

    std::thread::Builder::new()
        .name("worker-control".to_owned())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut line = String::new();
                let read = BufReader::new(match stream.try_clone() {
                    Ok(copy) => copy,
                    Err(_) => continue,
                })
                .read_line(&mut line);
                let answer = read.ok().and_then(|_| parse(&line)).map_or_else(
                    || {
                        tracing::warn!(line = line.trim(), "an order we do not understand");
                        "no\n"
                    },
                    |seat| {
                        if let Ok(mut held) = owner.lock() {
                            if *held != seat {
                                tracing::info!(
                                    seat = seat.map_or(0, PlayerSlot::get),
                                    "the room's owner changed"
                                );
                            }
                            *held = seat;
                        }
                        "ok\n"
                    },
                );
                let _ = stream.write_all(answer.as_bytes());
            }
        })
        .map_err(|source| TransportError::Accept { source })
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    #[test]
    fn an_order_names_a_seat_or_nobody() {
        assert_eq!(parse("owner 2\n"), Some(Some(PlayerSlot::new(2).unwrap())));
        assert_eq!(parse("owner 0\n"), Some(None));
        // Sans saut de ligne, et avec des espaces autour: ce qui arrive d'une
        // socket n'est pas toujours ce qu'on a écrit.
        assert_eq!(
            parse("  owner 4  "),
            Some(Some(PlayerSlot::new(4).unwrap()))
        );
    }

    /// Le jumeau négatif. Sans lui, une lecture qui rendrait toujours `Some`
    /// passerait les lignes du dessus, et n'importe quoi arrivant sur ce port
    /// changerait qui décide.
    #[test]
    fn anything_else_is_not_an_order() {
        for line in [
            "",
            "owner",
            "owner x",
            "owner 5",
            "owner -1",
            "owner 2 3",
            "hello",
            "OWNER 2",
        ] {
            assert!(parse(line).is_none(), "accepted {line:?}");
        }
    }

    #[test]
    fn the_listener_takes_an_order_and_answers() {
        let owner: OwnerSeat = Arc::new(Mutex::new(None));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        serve(address, Arc::clone(&owner)).unwrap();

        // La liaison est faite dans le fil, donc on réessaie plutôt que de
        // dormir une durée choisie au hasard.
        let mut stream = None;
        for _ in 0..50 {
            if let Ok(open) = std::net::TcpStream::connect(address) {
                stream = Some(open);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let mut stream = stream.unwrap();
        stream.write_all(b"owner 3\n").unwrap();
        let mut answer = String::new();
        BufReader::new(&stream).read_line(&mut answer).unwrap();

        assert_eq!(answer.trim(), "ok");
        assert_eq!(*owner.lock().unwrap(), Some(PlayerSlot::new(3).unwrap()));
    }
}
