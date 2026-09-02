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
//! HTTP, pas de JSON: deux messages existent, et une bibliothèque de plus pour
//! les lire serait une dépendance à tenir à jour pour trois mots.
//!
//! Le second est `decides <place>\n`, et il va dans l'autre sens: il DEMANDE au
//! worker si cette place a le droit de changer de jeu, et le worker répond `yes`
//! ou `no`. Il existe parce que le worker sait une chose que le plan de contrôle
//! ne peut pas savoir: depuis quand le propriétaire n'a rien touché. Sans cette
//! question, le plan de contrôle refusait de relayer « je change de jeu » venant
//! de quelqu'un que le worker, lui, laissait décider — et tout le monde sauf
//! celui qui avait cliqué regardait dix secondes de noir.

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

/// Ce qu'une ligne demande.
///
/// Un type plutôt qu'un booléen à côté d'une place: les deux messages n'ont pas
/// la même forme — `owner 0` est valide et veut dire personne, `decides 0` ne
/// veut rien dire — et les distinguer par le type évite d'avoir à s'en souvenir.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Order {
    /// « Voici la place qui décide », ou personne.
    SetOwner(Option<PlayerSlot>),
    /// « Cette place a-t-elle le droit de changer de jeu ? »
    MayDecide(PlayerSlot),
}

/// Lit un ordre. `None` veut dire « je ne comprends pas », et l'appelant se tait
/// plutôt que d'agir sur une supposition.
#[must_use]
pub fn parse(line: &str) -> Option<Order> {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("owner ") {
        let seat: u8 = rest.trim().parse().ok()?;
        if seat == 0 {
            return Some(Order::SetOwner(None));
        }
        return PlayerSlot::new(seat)
            .ok()
            .map(|seat| Order::SetOwner(Some(seat)));
    }
    let rest = line.strip_prefix("decides ")?;
    let seat: u8 = rest.trim().parse().ok()?;
    PlayerSlot::new(seat).ok().map(Order::MayDecide)
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
/// Le plus long ordre valide est `decides 4` avec ses espaces autour, donc une
/// vingtaine d'octets. Soixante-quatre laisse de la place à une variante future
/// sans laisser de place à un flot sans fin: `read_line` remplit une `String`
/// qui grossit tant qu'aucun saut de ligne n'arrive, et le worker n'a pas le
/// droit de mourir de faim mémoire pour un port de service.
const ORDER_MAX: u64 = 64;

/// Répond à `decides <place>`.
///
/// Une fonction plutôt qu'une valeur, parce que la réponse dépend de QUAND on
/// pose la question: le propriétaire s'absente tout seul, sans que personne
/// n'envoie rien. La règle elle-même vit dans `browser`, avec les horodatages
/// qu'elle lit, et n'est pas réécrite ici: deux exemplaires d'une règle
/// finissent par répondre différemment à la même question.
pub type Decider = Box<dyn Fn(PlayerSlot) -> bool + Send>;

/// Écoute les ordres du plan de contrôle jusqu'à l'arrêt du processus.
///
/// # Errors
/// [`TransportError::Bind`] si le port est pris.
pub fn serve(
    address: SocketAddr,
    owner: OwnerSeat,
    decides: Decider,
) -> Result<JoinHandle<()>, TransportError> {
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
                    |order| match order {
                        Order::SetOwner(seat) => {
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
                        }
                        // `yes`/`no` et pas `ok`: une réponse à une question ne
                        // doit pas ressembler à un accusé de réception, sinon un
                        // client qui teste `== "ok"` lit « refusé » comme
                        // « accepté ».
                        Order::MayDecide(seat) => {
                            if decides(seat) {
                                "yes\n"
                            } else {
                                "no\n"
                            }
                        }
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
        let two = Order::SetOwner(Some(PlayerSlot::new(2).unwrap()));
        assert_eq!(parse("owner 2\n"), Some(two));
        assert_eq!(parse("owner 0\n"), Some(Order::SetOwner(None)));
        // Sans saut de ligne, et avec des espaces autour: ce qui arrive d'une
        // socket n'est pas toujours ce qu'on a écrit.
        let four = Order::SetOwner(Some(PlayerSlot::new(4).unwrap()));
        assert_eq!(parse("  owner 4  "), Some(four));
    }

    #[test]
    fn a_question_about_a_seat_is_not_an_order_about_it() {
        // Les deux messages portent une place et ne veulent pas dire la même
        // chose. Les confondre ferait qu'une simple QUESTION changerait qui
        // décide, ce qui est exactement le pouvoir que ce port ne doit pas
        // donner deux fois.
        let asked = Order::MayDecide(PlayerSlot::new(3).unwrap());
        assert_eq!(parse("decides 3\n"), Some(asked));
        assert_ne!(parse("decides 3\n"), parse("owner 3\n"));
    }

    /// Le jumeau: `owner 0` veut dire personne, `decides 0` ne veut rien dire.
    /// Une place est `1..=4`, et il n'y a personne à interroger au numéro zéro.
    #[test]
    fn nobody_is_a_valid_owner_but_not_a_valid_question() {
        assert_eq!(parse("owner 0"), Some(Order::SetOwner(None)));
        assert!(parse("decides 0").is_none());
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
            "decides",
            "decides x",
            "decides 5",
            "decides -1",
            "DECIDES 2",
        ] {
            assert!(parse(line).is_none(), "accepted {line:?}");
        }
    }

    /// Ouvre une écoute sur un port libre et rend son adresse.
    fn a_listening_port(owner: &OwnerSeat) -> SocketAddr {
        a_listening_port_where(owner, Box::new(|_| true))
    }

    /// La même, en disant ce que le worker répond à `decides`.
    fn a_listening_port_where(owner: &OwnerSeat, decides: Decider) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        serve(address, Arc::clone(owner), decides).unwrap();
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

    /// Ce que le plan de contrôle demande avant de relayer « je change de jeu ».
    ///
    /// L'essai existe parce que la règle vivait à DEUX endroits: le worker
    /// laissait quelqu'un lancer un jeu quand le propriétaire s'était absenté,
    /// et le plan de contrôle refusait de prévenir les autres, avec sa propre
    /// idée du propriétaire, qui ne connaît pas les absences. Résultat: celui
    /// qui cliquait voyait son écran de chargement, et tous les autres dix
    /// secondes de noir.
    #[test]
    fn the_listener_answers_whether_a_seat_may_decide() {
        let owner: OwnerSeat = Arc::new(Mutex::new(None));
        let address = a_listening_port_where(&owner, Box::new(|seat| seat.get() == 3));

        assert_eq!(asked(address, "decides 3\n"), "yes");
        // Le jumeau: une écoute qui répondrait toujours `yes` laisserait
        // n'importe quelle page poser un écran de chargement sur celui des
        // autres, ce qui est la raison d'être du contrôle.
        assert_eq!(asked(address, "decides 2\n"), "no");
    }

    /// Une question ne doit pas nommer un propriétaire au passage.
    #[test]
    fn asking_the_question_changes_nothing() {
        let owner: OwnerSeat = Arc::new(Mutex::new(None));
        let address = a_listening_port_where(&owner, Box::new(|_| true));

        assert_eq!(asked(address, "decides 4\n"), "yes");

        assert_eq!(
            *owner.lock().unwrap(),
            None,
            "une question a changé qui décide"
        );
    }

    /// Envoie une ligne et rend la réponse, sans le saut de ligne.
    fn asked(address: SocketAddr, line: &str) -> String {
        let mut stream = connected(address);
        stream.write_all(line.as_bytes()).unwrap();
        let mut back = String::new();
        BufReader::new(&mut stream).read_line(&mut back).unwrap();
        back.trim().to_owned()
    }

    #[test]
    fn the_listener_takes_an_order_and_answers() {
        let owner: OwnerSeat = Arc::new(Mutex::new(None));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        serve(address, Arc::clone(&owner), Box::new(|_| true)).unwrap();

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
