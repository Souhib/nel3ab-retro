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

use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{SocketAddr, TcpListener};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

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

/// Le temps qu'une connexion a pour dire ce qu'elle veut, et pour lire la
/// réponse.
///
/// Sans lui, une seule connexion qui n'envoie jamais de fin de ligne gelait ce
/// port pour toujours: les ordres sont servis un par un, et `read_line` attend
/// sans limite. Reproduit le 19 août 2026 sur cette machine, avec zéro octet
/// envoyé, et le siège du propriétaire ne pouvait plus changer.
///
/// Deux secondes, et pas moins: le plan de contrôle est sur la même machine,
/// donc un ordre normal met des microsecondes, mais une machine chargée peut
/// faire attendre un ordonnancement. Ce qui reste après ce délai est borné et se
/// répare tout seul, là où avant rien ne se réparait.
const SAY_WITHIN: Duration = Duration::from_secs(2);

/// Ce qu'on accepte de lire avant de refuser.
///
/// Le plus long ordre valide est `owner 4` avec ses espaces autour, donc une
/// vingtaine d'octets. Soixante-quatre laisse de la place à une variante future
/// sans laisser de place à un flot sans fin: `read_line` remplit une `String`
/// qui grossit tant qu'aucun saut de ligne n'arrive, et le worker n'a pas le
/// droit de mourir de faim mémoire pour un port de service.
const ORDER_MAX: u64 = 64;

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
                // Les deux sens sont bornés. La lecture pour la raison écrite
                // sur `SAY_WITHIN`; l'écriture parce qu'un client qui ne lit
                // jamais sa réponse remplirait le tampon du noyau et bloquerait
                // `write_all` exactement de la même façon.
                let _ = stream.set_read_timeout(Some(SAY_WITHIN));
                let _ = stream.set_write_timeout(Some(SAY_WITHIN));
                let mut line = String::new();
                let read = BufReader::new(
                    match stream.try_clone() {
                        Ok(copy) => copy,
                        Err(_) => continue,
                    }
                    .take(ORDER_MAX),
                )
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

    /// Ouvre une écoute sur un port libre et rend son adresse.
    fn a_listening_port(owner: &OwnerSeat) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        serve(address, Arc::clone(owner)).unwrap();
        address
    }

    /// Se connecte en réessayant: la liaison est faite dans un autre fil, donc
    /// dormir une durée choisie au hasard rendrait le test capricieux.
    fn connected(address: SocketAddr) -> std::net::TcpStream {
        for _ in 0..50 {
            if let Ok(open) = std::net::TcpStream::connect(address) {
                return open;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("le port n'a jamais accepté de connexion");
    }

    /// Envoie un ordre et rend la réponse, en refusant d'attendre pour toujours.
    ///
    /// Le délai est du côté CLIENT, et c'est tout l'intérêt: sans lui, un port
    /// gelé ferait pendre le test au lieu de le faire échouer, et un test qui
    /// pend est un test qu'on finit par retirer.
    fn ask(address: SocketAddr, order: &str) -> Option<String> {
        ask_within(address, order, Duration::from_secs(10))
    }

    /// La même chose, avec le délai choisi par l'appelant.
    fn ask_within(address: SocketAddr, order: &str, patience: Duration) -> Option<String> {
        let mut stream = connected(address);
        stream.set_read_timeout(Some(patience)).ok()?;
        stream.write_all(order.as_bytes()).ok()?;
        let mut answer = String::new();
        BufReader::new(&stream).read_line(&mut answer).ok()?;
        Some(answer.trim().to_owned())
    }

    /// Rouge d'abord: retirer `set_read_timeout` de `serve` fait échouer
    /// celui-ci sur un délai dépassé, exactement comme la salle réelle le
    /// faisait le 19 août 2026.
    #[test]
    fn a_connection_that_says_nothing_does_not_freeze_the_port() {
        let owner: OwnerSeat = Arc::new(Mutex::new(None));
        let address = a_listening_port(&owner);
        assert_eq!(ask(address, "owner 1\n").as_deref(), Some("ok"));

        // Une seule connexion, et pas un octet dedans. Elle reste ouverte
        // pendant tout ce qui suit.
        let mute = connected(address);

        assert_eq!(
            ask(address, "owner 3\n").as_deref(),
            Some("ok"),
            "un ordre légitime doit passer pendant qu'une connexion muette traîne"
        );
        assert_eq!(*owner.lock().unwrap(), Some(PlayerSlot::new(3).unwrap()));
        drop(mute);
    }

    /// Le second défaut du même endroit: `read_line` remplissait une `String`
    /// sans borne. Ici on envoie beaucoup plus que la borne sans jamais de saut
    /// de ligne, et le port doit refuser au lieu d'attendre la suite.
    #[test]
    fn an_endless_line_is_refused_rather_than_swallowed() {
        let owner: OwnerSeat = Arc::new(Mutex::new(Some(PlayerSlot::new(2).unwrap())));
        let address = a_listening_port(&owner);

        // Le délai du client est PLUS COURT que celui du serveur, et c'est ce
        // qui rend la borne observable. Avec elle, la lecture s'arrête à 64
        // octets et la réponse part tout de suite. Sans elle, le serveur attend
        // un saut de ligne qui n'arrive jamais et ne répond qu'au bout de
        // `SAY_WITHIN`, donc après que le client a renoncé.
        assert!(
            SAY_WITHIN > Duration::from_secs(1),
            "sinon la mesure ci-dessous ne mesure rien"
        );
        assert_eq!(
            ask_within(address, &"o".repeat(4096), Duration::from_secs(1)).as_deref(),
            Some("no"),
            "au-delà de la borne, l'ordre n'est pas compris, et il l'est tout de suite"
        );
        // Et il n'a rien changé: ne pas comprendre veut dire ne rien faire.
        assert_eq!(*owner.lock().unwrap(), Some(PlayerSlot::new(2).unwrap()));
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
