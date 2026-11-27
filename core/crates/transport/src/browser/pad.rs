//! Les manettes: qui tient quelle place, et ce qui remonte vers ses mains.
//!
//! Une place est tenue par une CONNEXION et pas par un nom, parce que la même
//! personne peut ouvrir la salle sur deux appareils. Le worker est la seule
//! autorité: la page dit ce qu'elle voudrait, il répond ce qu'elle a, et une
//! trame de manette est estampillée de la place que cette socket a reçue quoi
//! qu'elle prétende.

use std::net::TcpStream;
use std::time::{Duration, Instant};

use nel3ab_protocol::{Command, Echo, PlayerSlot, Reste};

use super::{
    AWAY_AFTER, Acted, GONE_AFTER, PING_EVERY, PORTS, Seats, Shared, Unread, socket_limits,
};

/// Takes a port for this connection and tells the page about the room.
///
/// Which port a browser holds is the SERVER'S to decide, and the room is the
/// first thing said on the socket: a page cannot stamp its own port on a pad
/// frame — see the re-stamping in the loop — so this is how it learns.
///
/// Returns the port, the claim that proves it is still ours, and the message
/// that was sent, so the loop can tell later when the room has changed.
pub(super) fn claim_a_port(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    shared: &Shared,
    take: Option<PlayerSlot>,
    prefer: Option<PlayerSlot>,
    expected: Option<&str>,
) -> Option<(PlayerSlot, u64, Vec<u8>)> {
    let (seats, players) = (&shared.seats, shared.players);
    let Some((seat, claim)) = take_seat(seats, players, take, prefer, expected) else {
        tracing::info!("a browser asked for a controller in a full room");
        let _ = socket.send(tungstenite::Message::binary(room_message(
            players,
            None,
            seats,
            false,
            shared.closing_in.load(std::sync::atomic::Ordering::Relaxed),
            shared.mics.bits(),
        )));
        return None;
    };
    let told = room_message(
        players,
        Some(seat),
        seats,
        decides(&shared.owner, &shared.acted, seat),
        shared.closing_in.load(std::sync::atomic::Ordering::Relaxed),
        shared.mics.bits(),
    );
    if socket
        .send(tungstenite::Message::binary(told.clone()))
        .is_err()
    {
        release_seat(seats, seat, claim);
        return None;
    }
    tracing::info!(
        port = seat.get(),
        asked = take.map_or(0, PlayerSlot::get),
        "a browser is holding a controller"
    );
    Some((seat, claim, told))
}

/// Un écart plus long qu'une image à 60 Hz: une trame au moins a manqué.
const ONE_FRAME: Duration = Duration::from_millis(17);

/// Trois images à 60 Hz: un trou que le jeu peut voir.
const THREE_FRAMES: Duration = Duration::from_millis(50);

/// Les arrivées de trames d'une place, datées dans le fil de sa socket.
///
/// La page en envoie une toutes les 4 ms, immobile ou non. Le 26 novembre
/// 2026, 18 % des intervalles d'image n'en avaient reçu aucune au worker
/// (audit ENT-1), sans que rien dise si elles arrivaient en paquets ou pas du
/// tout. Les seuils viennent de l'audit et ne sont pas mesurés: une image à
/// 60 Hz, et trois.
#[derive(Debug, Default, Clone, Copy)]
pub(super) struct Arrivals {
    /// La dernière trame, gardée d'un relevé à l'autre et oubliée quand la
    /// place change de main: l'écart avec la trame d'un autre ne dit rien.
    last: Option<Instant>,
    frames: u64,
    over_one: u64,
    over_three: u64,
    longest: Option<Duration>,
}

impl Arrivals {
    /// Une trame de cette place est arrivée à `at`.
    pub(super) fn arrived(&mut self, at: Instant) {
        self.frames += 1;
        let Some(last) = self.last.replace(at) else {
            return;
        };
        let gap = at.saturating_duration_since(last);
        self.over_one += u64::from(gap > ONE_FRAME);
        self.over_three += u64::from(gap > THREE_FRAMES);
        self.longest = Some(self.longest.map_or(gap, |longest| longest.max(gap)));
    }

    /// La place a été rendue: la prochaine trame n'est pas un écart.
    pub(super) const fn forget(&mut self) {
        self.last = None;
    }

    /// Le relevé depuis le dernier appel, puis un relevé neuf.
    pub(super) fn take(&mut self) -> PadArrivals {
        let taken = PadArrivals {
            frames: self.frames,
            over_17_ms: self.over_one,
            over_50_ms: self.over_three,
            gap_max_ms: self.longest.map(|longest| longest.as_secs_f64() * 1000.0),
        };
        *self = Self {
            last: self.last,
            ..Self::default()
        };
        taken
    }
}

/// Ce qu'une place a reçu depuis le dernier relevé.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct PadArrivals {
    /// Les trames reçues.
    pub frames: u64,
    /// Les écarts de plus de 17 ms.
    pub over_17_ms: u64,
    /// Les écarts de plus de 50 ms.
    pub over_50_ms: u64,
    /// Le plus long écart, absent tant que deux trames ne sont pas arrivées.
    pub gap_max_ms: Option<f64>,
}

/// Receives pad frames until the client goes away.
///
/// A malformed frame closes the connection rather than being skipped. On a
/// stream there is no framing to resynchronise against — the same reasoning the
/// frame socket uses — and a client sending rubbish is a client with a bug worth
/// noticing.
/// Range l'état de manette qui vient d'arriver, et dit si la page parle encore
/// le bon protocole.
///
/// Rend `false` sur ce qui n'est pas une trame de manette, et l'appelant ferme:
/// une page qui envoie autre chose n'est pas notre page, et continuer à
/// l'écouter serait accepter n'importe quoi.
pub(super) fn apply_pad(payload: &[u8], seat: PlayerSlot, shared: &Shared) -> bool {
    // Read once and before any lock: the arrival is the instant the frame
    // was read off the socket, not the instant a lock was free.
    let now = Instant::now();
    // The room fixes the format; the connection fixes the seat. Neither comes
    // from a client claim, including a valid frame naming somebody else's port.
    let Some(frame) = shared.input_kind.decode(payload, seat) else {
        tracing::warn!("a client sent an invalid controller frame for this room");
        return false;
    };
    if let Ok(mut arrivals) = shared.arrivals.lock()
        && let Some(place) = arrivals.get_mut(seat.index())
    {
        place.arrived(now);
    }
    // Une trame NEUTRE ne compte pas comme une présence. La page en envoie une à
    // chaque tour, même quand personne ne touche à rien: prendre « une trame est
    // arrivée » pour « quelqu'un joue » rendrait tout le monde éternellement
    // présent, et c'est précisément ce qu'on cherche à distinguer.
    if !frame.is_neutral()
        && let Ok(mut acted) = shared.acted.lock()
        && let Some(when) = acted.get_mut(seat.index())
    {
        *when = Some(now);
    }
    if let Ok(mut slots) = shared.inputs.lock() {
        // Replaces rather than queues: an emulator can only ever apply the
        // newest state. The buttons that went down or up on the way are kept
        // as two masks, because a press and its release both unread used to
        // leave only the release (audit ENT-2). See `Unread`.
        if let Some(place) = slots.get_mut(seat.index()) {
            *place = Some(place.map_or_else(|| Unread::new(frame), |unread| unread.then(frame)));
        }
    }
    // Counted once dated and stored, with `Release`: whoever reads this count
    // with `Acquire` then finds the frame in its slot and in its arrivals.
    // Counted first, the count could run ahead of the slot (relecture du
    // 2026-11-27).
    shared
        .received
        .fetch_add(1, std::sync::atomic::Ordering::Release);
    // Woken after the lock is released, so the waiter does not wake straight
    // into a lock it cannot take.
    shared.arrived.notify_one();
    true
}

/// « Je reste »: cette place compte comme active, sans trame pour le jeu.
///
/// Le même horodatage qu'une trame non neutre (`acted`), donc la même règle
/// d'inactivité et la même règle de propriétaire absent: qui dit « je reste »
/// est là. Rien n'entre dans `inputs`: l'émulateur ne voit aucune trame.
fn reste(shared: &Shared, seat: PlayerSlot) {
    if let Ok(mut acted) = shared.acted.lock()
        && let Some(when) = acted.get_mut(seat.index())
    {
        *when = Some(std::time::Instant::now());
    }
}

/// Renvoie un aller-retour tel quel, et dit si la socket tient encore.
///
/// Rendu sans rien y lire: c'est la page qui sait à quoi elle a associé son
/// jeton, et lui donner un sens ici créerait un état à tenir des deux côtés pour
/// rien. Neuf octets rendus pour neuf reçus, donc rien n'est amplifié: qui
/// l'envoie en boucle se coûte exactement ce qu'il nous coûte.
pub(super) fn bounce(socket: &mut tungstenite::WebSocket<TcpStream>, payload: &[u8]) -> bool {
    let Ok(echo) = Echo::decode(payload) else {
        // Neuf octets sans la marque ne sont pas un aller-retour. On se tait
        // plutôt que de renvoyer quelque chose, et la socket reste ouverte.
        return true;
    };
    socket
        .send(tungstenite::Message::binary(echo.encode().to_vec()))
        .is_ok()
}

/// L'ancien message de sept octets reste intact. Les lecteurs qui demandent
/// une identité reçoivent aussi leur attribution et l'appareil réellement tenu.
fn announce_assignment(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    shared: &Shared,
    seat: PlayerSlot,
    claim: u64,
) -> Result<(), tungstenite::Error> {
    socket.send(tungstenite::Message::text(format!(
        "seat {}",
        crate::control::receipt(claim)
    )))?;
    let kind = shared.devices.lock().map_or(0, |pads| pads[seat.index()]);
    socket.send(tungstenite::Message::text(format!("pad {kind}")))
}

// The first poll after a seat grant must already know the input format.
fn announce_format(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    shared: &Shared,
    identity: bool,
) -> bool {
    !identity
        || !matches!(shared.input_kind, super::InputKind::Switch)
        || socket
            .send(tungstenite::Message::text("format switch"))
            .is_ok()
}

/// Receives pad frames until the client goes away.
#[expect(
    clippy::too_many_lines,
    reason = "la boucle de manette tient la place, la vibration, la salle et la \
              réponse au remplacement ; la couper déplacerait l'ordre sans le réduire"
)]
pub(super) fn input_thread(
    stream: TcpStream,
    shared: &Shared,
    take: Option<PlayerSlot>,
    identity: bool,
    prefer: Option<PlayerSlot>,
    expected: Option<&str>,
) {
    let (slots, arrived, seats, players) = (
        &shared.inputs,
        &shared.arrived,
        &shared.seats,
        shared.players,
    );
    let _ = stream.set_nodelay(true);
    // Cleared, and this is not a formality. The deadline `classify` set to bound
    // the peek stayed on the socket, so a read of the NEXT pad frame inherited
    // it — and a player who pressed nothing for five seconds was dropped as if
    // they had left. Their seat went back to the room, and they came back as a
    // different player. Silence on a controller is the normal state of a
    // controller; a socket that has closed is what ending a session looks like.
    // Not `None`, and not the deadline `classify` left behind either: the read
    // returns regularly so this thread can ASK, rather than concluding anything
    // from silence. See `PING_EVERY`.
    let _ = stream.set_read_timeout(Some(PING_EVERY));
    let Ok(mut socket) = tungstenite::accept_with_config(stream, Some(socket_limits())) else {
        return;
    };

    if !announce_format(&mut socket, shared, identity) {
        return;
    }

    let Some((seat, claim, mut told)) = claim_a_port(&mut socket, shared, take, prefer, expected)
    else {
        let _ = socket.close(None);
        return;
    };

    if identity && announce_assignment(&mut socket, shared, seat, claim).is_err() {
        release_seat(seats, seat, claim);
        return;
    }

    let mut heard_from = std::time::Instant::now();
    // La dernière force envoyée à cette page, pour n'envoyer que les changements.
    let mut shook = 0_u8;
    loop {
        // Checked every time round, so an active page — which reads sixty times a
        // second — learns it was replaced within a frame.
        if !still_ours(seats, seat, claim) {
            tracing::info!(port = seat.get(), "another browser took this controller");
            // A room where nothing is yours: the page reads that as having no
            // controller and stops asking rather than reconnecting, because two
            // pages that both insisted would trade the pad for ever.
            let _ = socket.send(tungstenite::Message::binary(room_message(
                players,
                None,
                seats,
                false,
                shared.closing_in.load(std::sync::atomic::Ordering::Relaxed),
                shared.mics.bits(),
            )));
            break;
        }
        // La salle et la vibration, toutes deux envoyées seulement quand elles
        // CHANGENT, et toutes deux depuis ce fil plutôt que poussées d'ailleurs.
        //
        // Il se réveille déjà sur chaque trame de manette, soixante fois par
        // seconde pour une page qui joue, et sur son ping quand elle ne joue
        // pas. Pas de canal, pas de diffusion, et une page qui dessine quatre
        // sockets les voit se remplir.
        match send_rumble(&mut socket, shared, seat, shook) {
            Ok(now) => shook = now,
            Err(()) => break,
        }
        match send_room(&mut socket, players, seat, seats, shared, told) {
            Ok(now) => told = now,
            Err(()) => break,
        }

        let message = match socket.read() {
            Ok(message) => {
                // ANY frame is proof of life, pad state or pong alike.
                heard_from = std::time::Instant::now();
                message
            }
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                // Deliberately NOT breaking on a lost seat here: leaving by this
                // door skips the byte that tells the page it was replaced, and a
                // page that is never told goes on showing a controller it does
                // not have. `continue` puts the loop head — which tells, then
                // leaves — back in charge.
                if heard_from.elapsed() >= GONE_AFTER {
                    tracing::info!(port = seat.get(), "a controller stopped answering");
                    break;
                }
                // Answered by the browser's own stack, so a page that is idle or
                // in the background is not disturbed by it.
                if socket
                    .send(tungstenite::Message::Ping(Vec::new().into()))
                    .is_err()
                {
                    break;
                }
                continue;
            }
            Err(_) => break,
        };
        let payload = match message {
            tungstenite::Message::Binary(bytes) => bytes,
            tungstenite::Message::Close(_) => break,
            // Un seul texte est compris: un jeu demandé par sa clé. Voir
            // `choose_by_key`, qui dit pourquoi le reste est ignoré.
            tungstenite::Message::Text(text) => {
                if choose_by_key(&mut socket, text.as_str(), shared, seat) {
                    continue;
                }
                break;
            }
            // Pong is the answer to our own ping and has already counted as
            // proof of life above.
            _ => continue,
        };
        // Neuf octets sont un aller-retour: la page mesure sa propre latence, et
        // c'est le seul chiffre qu'elle peut établir sans supposer que les deux
        // horloges sont d'accord.
        //
        // Rendu tel quel, sans rien y lire. Un renvoi de la même taille que la
        // demande n'amplifie rien: qui l'envoie en boucle se coûte exactement ce
        // qu'il nous coûte.
        if payload.len() == Echo::LEN {
            if bounce(&mut socket, &payload) {
                continue;
            }
            break;
        }
        // Un octet est « je reste » (D16): un geste qui ne va pas au jeu. Un
        // octet inconnu est ignoré, et la socket reste ouverte, comme un
        // aller-retour sans sa marque.
        if payload.len() == Reste::LEN {
            if Reste::decode(&payload).is_ok() {
                reste(shared, seat);
            }
            continue;
        }
        // Two bytes is a command, thirteen is a pad. Told apart by length,
        // which needs no mode and no header — see `Command` in the protocol.
        if payload.len() == Command::LEN {
            if obey(&payload, shared, seat) {
                continue;
            }
            break;
        }
        if !apply_pad(&payload, seat, shared) {
            break;
        }
    }
    tracing::info!(port = seat.get(), "the controller disconnected");
    // The seat goes back before the state does: a port nobody holds keeps
    // applying whatever its last holder left pressed, and a stuck direction is
    // exactly the bug a player would blame the network for.
    release_seat(seats, seat, claim);
    if let Ok(mut arrivals) = shared.arrivals.lock()
        && let Some(place) = arrivals.get_mut(seat.index())
    {
        place.forget();
    }
    if let Ok(mut slots) = slots.lock()
        && let Some(place) = slots.get_mut(seat.index())
    {
        let neutral = shared.input_kind.neutral(seat);
        *place = Some(place.map_or_else(|| Unread::new(neutral), |unread| unread.then(neutral)));
    }
    arrived.notify_one();
    let _ = socket.close(None);
}

/// Acts on a command from a seated player. `false` means hang up.
///
/// Its own function rather than a branch in the loop, because reading a pad and
/// obeying an order are two different jobs and the loop was doing one of them
/// well. A command that cannot be understood closes the connection, for the
/// reason a malformed pad frame does: on a stream there is nothing to
/// resynchronise against, and a client sending what we do not know is a client
/// worth noticing rather than humouring.
pub(super) fn obey(payload: &[u8], shared: &Shared, seat: PlayerSlot) -> bool {
    match Command::decode(payload) {
        Ok(Command::ChooseSave { slot }) => {
            // Retenu sans rien déclencher: c'est le changement de jeu qui agit,
            // et la page envoie ce message juste avant. Le séparer laisse la
            // salle changer d'avis sur la sauvegarde sans redémarrer.
            //
            // Aucune règle de propriétaire ici, contrairement au changement de
            // jeu. Choisir une sauvegarde ne décide rien tant que personne ne
            // lance quoi que ce soit, et c'est le lancement qui est gardé.
            if let Ok(mut wanted) = shared.wants_save.lock() {
                *wanted = slot;
            }
            tracing::info!(port = seat.get(), slot, "une sauvegarde a été choisie");
            true
        }
        Ok(Command::ChoosePad { kind }) => {
            // Comme la sauvegarde: on retient, on ne déclenche rien. C'est la
            // demande de jeu qui agit, et elle arrive juste après.
            //
            // Pas de contrôle de propriétaire ici non plus: tant que personne
            // n'a demandé de jeu, ce choix ne décide de rien.
            if let Ok(mut wanted) = shared.wants_pad.lock() {
                *wanted = kind;
            }
            tracing::info!(port = seat.get(), kind, "une manette a été choisie");
            true
        }
        Ok(Command::ChooseExtension { kind }) => {
            // Elle AGIT, contrairement aux deux du dessus qu'on retient jusqu'au
            // prochain démarrage. Rien ne redémarre: Dolphin échange l'extension
            // d'une Wiimote émulée en cours de partie, comme on débranche un
            // Nunchuk pour brancher une guitare.
            //
            // Aucune règle de propriétaire, et c'est délibéré. Changer ce qu'on
            // a dans les mains est personnel, comme ses touches; ça ne touche ni
            // la partie ni la manette de qui que ce soit d'autre. La place vient
            // de la SOCKET et non du message, donc personne ne peut viser la
            // Wiimote de son voisin.
            if let Ok(mut wanted) = shared.wants_extension.lock()
                && let Some(place) = wanted.get_mut(usize::from(seat.get() - 1))
            {
                *place = Some(kind);
            }
            tracing::info!(port = seat.get(), kind, "une extension a été demandée");
            true
        }
        Ok(Command::SwitchRom { index }) => {
            // Le propriétaire décide, et c'est vérifié ICI plutôt que dans la
            // page: une règle qui ne vit que dans une interface est une règle
            // qu'une console de développeur contourne en une ligne.
            //
            // Aucun propriétaire déclaré veut dire aucune règle, et la salle
            // retombe sur ce qu'elle faisait avant: tenir une manette suffit.
            // C'est le cas quand le plan de contrôle n'est pas là, et refuser
            // tout ferait une salle où plus personne ne peut rien.
            let decides = decides(&shared.owner, &shared.acted, seat);
            if !decides {
                tracing::info!(
                    port = seat.get(),
                    index,
                    "a player who does not own the room asked for another game"
                );
                // On garde la connexion: refuser l'ordre n'est pas refuser le
                // joueur, et le déconnecter lui ferait perdre sa manette pour
                // avoir cliqué au mauvais endroit.
                return true;
            }
            tracing::info!(port = seat.get(), index, "a player asked for another game");
            if let Ok(mut wanted) = shared.wants_rom.lock() {
                *wanted = Some(usize::from(index));
            }
            true
        }
        Err(error) => {
            tracing::warn!(%error, "a client sent a command we do not know");
            false
        }
    }
}

/// Ce qu'une demande de jeu par sa clé devient.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum KeyRequest {
    /// Ce texte n'est pas une demande de jeu. Il est ignoré, comme tout texte
    /// l'était sur cette socket avant le 21 novembre 2026.
    NotOurs,
    /// Le jeu à cette position de la bibliothèque, accordé à cette place.
    Granted(usize),
    /// Refusé, pour la raison écrite. La raison part aussi vers la page.
    Refused(&'static str),
}

/// Le texte qu'une page envoie pour lancer un jeu: `{"jeu":"<clé>"}`.
///
/// Une fonction pure, pour que chaque refus se vérifie sans socket. L'ordre des
/// gardes est celui du chemin `SwitchRom`, plus deux: une clé qui n'est pas un
/// nom de fichier, puis une clé que ce catalogue ne porte pas. La règle du
/// propriétaire vient en dernier, et c'est la même fonction que pour la
/// position (`decides`).
pub(super) fn judge(
    text: &str,
    keys: &[Option<String>],
    may_decide: impl FnOnce() -> bool,
) -> KeyRequest {
    let Ok(serde_json::Value::Object(said)) = serde_json::from_str::<serde_json::Value>(text)
    else {
        return KeyRequest::NotOurs;
    };
    if said.len() != 1 {
        return KeyRequest::NotOurs;
    }
    let Some(asked) = said.get("jeu") else {
        return KeyRequest::NotOurs;
    };
    let Some(key) = asked
        .as_str()
        .and_then(|raw| nel3ab_protocol::GameKey::new(raw).ok())
    else {
        return KeyRequest::Refused("clé invalide");
    };
    let Some(index) = super::position_of(keys, &key) else {
        return KeyRequest::Refused("absent de cette bibliothèque");
    };
    if !may_decide() {
        return KeyRequest::Refused("cette place ne décide pas du jeu");
    }
    KeyRequest::Granted(index)
}

/// Un jeu demandé par sa clé, sur la socket de manette (ADR D23).
///
/// Rend `false` seulement quand la socket est partie. Un texte qui n'est pas une
/// demande de jeu reste ignoré, comme avant: rien d'autre ne parle texte ici, et
/// fermer pour cela changerait la règle d'une socket qui a déjà des pages
/// ouvertes. Une demande bien formée mais refusée reçoit son refus nommé, et la
/// connexion reste ouverte, comme pour une position refusée: refuser l'ordre
/// n'est pas refuser le joueur.
///
/// Le refus est envoyé en texte, `jeu refusé: <raison>`. Une page plus ancienne
/// ignore tout texte qu'elle ne connaît pas, donc rien ne casse chez elle.
pub(super) fn choose_by_key(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    text: &str,
    shared: &Shared,
    seat: PlayerSlot,
) -> bool {
    match judge(text, &shared.keys, || {
        decides(&shared.owner, &shared.acted, seat)
    }) {
        KeyRequest::NotOurs => {
            tracing::debug!(port = seat.get(), "un texte que cette socket ne parle pas");
            true
        }
        KeyRequest::Granted(index) => {
            tracing::info!(
                port = seat.get(),
                index,
                "a player asked for another game by key"
            );
            if let Ok(mut wanted) = shared.wants_rom.lock() {
                *wanted = Some(index);
            }
            true
        }
        KeyRequest::Refused(reason) => {
            tracing::info!(port = seat.get(), reason, "jeu demandé par clé, refusé");
            socket
                .send(tungstenite::Message::text(format!("jeu refusé: {reason}")))
                .is_ok()
        }
    }
}

/// Claims the lowest free port, or `None` when the room is full.
///
/// `insist` takes the FIRST port even when somebody is on it. That is not a
/// courtesy the server can decide for itself — two pages would trade the pad
/// back and forth for ever — so it happens only when a person asks for it by
/// pressing the button, and the page they took it from is told and stops asking.
pub(super) fn take_seat(
    seats: &Seats,
    players: PlayerSlot,
    take: Option<PlayerSlot>,
    prefer: Option<PlayerSlot>,
    expected: Option<&str>,
) -> Option<(PlayerSlot, u64)> {
    let claim = next_claim();
    // The lock lives in this block and no longer: every caller of this function
    // goes on to write to a socket, and holding the room's lock across a write
    // is how one slow client stops everybody else from joining.
    let taken = {
        let mut seats = seats.lock().ok()?;
        // Le délai de réponse vise UNE attribution. Une reconnexion ou un
        // lancement entre-temps annule la reprise, même si le port est le même.
        if let Some(expected) = expected {
            let wanted = take?;
            if seats[wanted.index()].is_none_or(|held| crate::control::receipt(held) != expected) {
                return None;
            }
        }
        let chosen = match take {
            None if prefer.is_some() => {
                let wanted = prefer?;
                if wanted.get() > players.get() || seats[wanted.index()].is_some() {
                    return None;
                }
                wanted
            }
            // A named port, occupied or not: somebody clicked that socket.
            Some(wanted) if wanted.get() <= players.get() => wanted,
            // A port this room does not serve is not a port. Fall through to
            // the polite path rather than inventing one.
            Some(_) | None => (1..=players.get())
                .filter_map(|raw| PlayerSlot::new(raw).ok())
                .find(|slot| seats.get(slot.index()).copied().flatten().is_none())?,
        };
        *seats.get_mut(chosen.index())? = Some(claim);
        chosen
    };
    Some((taken, claim))
}

/// Which ports are held, as the page is told them.
pub(super) fn occupancy(seats: &Seats) -> [bool; PORTS] {
    seats.lock().map_or([false; PORTS], |seats| {
        std::array::from_fn(|index| seats.get(index).copied().flatten().is_some())
    })
}

/// What the page needs to draw the console's front panel.
///
/// One message rather than two: how many ports this room has, which one is
/// yours, and which of the others are busy. A page that only knew its own port
/// could not tell an empty socket from somebody else's, and the whole point of
/// drawing the sockets is that you can see the room.
/// Envoie l'état de la salle à cette page, s'il a changé.
///
/// Rend ce que la page connaît désormais, ou `Err` quand la socket est partie.
pub(super) fn send_room(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    players: PlayerSlot,
    seat: PlayerSlot,
    seats: &Seats,
    shared: &Shared,
    told: Vec<u8>,
) -> Result<Vec<u8>, ()> {
    let current = room_message(
        players,
        Some(seat),
        seats,
        decides(&shared.owner, &shared.acted, seat),
        shared.closing_in.load(std::sync::atomic::Ordering::Relaxed),
        shared.mics.bits(),
    );
    if current == told {
        return Ok(told);
    }
    socket
        .send(tungstenite::Message::binary(current.clone()))
        .map_err(|_| ())?;
    Ok(current)
}

/// Envoie la vibration de cette place, si elle a changé.
///
/// Par le même chemin que la salle, et pour la même raison: le fil qui sert
/// cette manette se réveille déjà à chaque trame qui monte, soixante fois par
/// seconde pour une page qui joue. Pas de canal, pas de diffusion.
///
/// Deux octets, contre six pour la salle, et c'est la LONGUEUR qui les
/// distingue. La page rejette déjà tout ce qui n'a pas la taille d'une salle,
/// donc il n'y a rien à taguer et une page plus ancienne ignore les secousses
/// sans rien casser.
///
/// Rend la force désormais connue de cette page, ou `Err` quand la socket est
/// partie.
pub(super) fn send_rumble(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    shared: &Shared,
    seat: PlayerSlot,
    shook: u8,
) -> Result<u8, ()> {
    let shaking = shared
        .rumbles
        .lock()
        .ok()
        .and_then(|held| held.get(seat.index()).copied())
        .unwrap_or(0);
    if shaking == shook {
        return Ok(shook);
    }
    socket
        .send(tungstenite::Message::binary(vec![seat.get(), shaking]))
        .map_err(|_| ())?;
    Ok(shaking)
}

pub(super) fn room_message(
    players: PlayerSlot,
    mine: Option<PlayerSlot>,
    seats: &Seats,
    // Vrai quand CETTE place a le droit de changer le jeu, en ce moment.
    //
    // Dit par le worker plutôt que déduit par la page, et c'est la correction
    // d'un vieux désaccord: le worker tranche par PLACE, le salon nommait un
    // propriétaire par PERSONNE. Les deux ne disaient pas la même chose dès
    // qu'on ouvrait deux onglets, et la page annonçait un droit que le worker
    // refusait ensuite en silence.
    may_decide: bool,
    // Dans combien de minutes la salle ferme, zéro quand il n'y a rien à dire.
    //
    // Dans CE message plutôt que dans un message à part: il n'est envoyé que
    // lorsqu'il change, il part vers toutes les pages, et une page qui arrive
    // le reçoit d'emblée. Un message d'avertissement séparé aurait raté celle
    // qui se connecte après l'annonce.
    closing_in: u8,
    // Les places qui ont un micro ouvert, un bit par place. Diffusé pour que
    // chacun voie qui sera capté dans le prochain clip, avant d'y figurer.
    mics: u8,
) -> Vec<u8> {
    let mut message = Vec::with_capacity(4 + PORTS + 1);
    message.push(players.get());
    message.push(mine.map_or(0, PlayerSlot::get));
    message.push(u8::from(may_decide));
    message.push(closing_in);
    message.extend(occupancy(seats).into_iter().map(u8::from));
    message.push(mics);
    message
}

/// Qui a le droit de changer le jeu, en ce moment.
///
/// Trois cas, et le troisième est celui qui a manqué pendant une soirée:
///
/// - **aucun propriétaire déclaré**: tout le monde décide. C'est la salle sans
///   son plan de contrôle, et refuser tout ferait une salle où plus personne ne
///   peut rien;
/// - **c'est notre place**: on décide, évidemment;
/// - **le propriétaire n'a rien touché depuis trois minutes**: tout le monde
///   décide. Sans ce cas, quelqu'un qui part manger en gardant son onglet ouvert
///   bloque la soirée entière, et personne ne peut le lui retirer.
///
/// Le troisième cas se mesure sur ce qu'on TOUCHE, pas sur une page ouverte: une
/// page immobile envoie quand même une trame à chaque tour.
pub(super) fn decides(owner: &crate::control::OwnerSeat, acted: &Acted, seat: PlayerSlot) -> bool {
    let Some(boss) = owner.lock().ok().and_then(|held| *held) else {
        return true;
    };
    if boss == seat {
        return true;
    }
    let Ok(acted) = acted.lock() else {
        return false;
    };
    acted
        .get(boss.index())
        .copied()
        .flatten()
        .is_none_or(|when| when.elapsed() >= AWAY_AFTER)
}

/// Gives the port back, but only if it is still ours: a holder that was replaced
/// must not release the seat its replacement is now sitting in.
pub(super) fn release_seat(seats: &Seats, seat: PlayerSlot, claim: u64) {
    if let Ok(mut seats) = seats.lock()
        && let Some(taken) = seats.get_mut(seat.index())
        && *taken == Some(claim)
    {
        *taken = None;
    }
}

/// Whether this claim still holds its port.
pub(super) fn still_ours(seats: &Seats, seat: PlayerSlot, claim: u64) -> bool {
    seats
        .lock()
        .is_ok_and(|seats| seats.get(seat.index()).copied().flatten() == Some(claim))
}

pub(super) fn next_claim() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Des trames à 4 ms, puis un trou de 20 ms et un de 60: deux écarts de
    /// plus d'une image, un de plus de trois, et le plus long dit 60.
    #[test]
    fn the_gaps_between_a_seats_frames_are_counted_by_their_length() {
        let start = Instant::now();
        let mut seat = Arrivals::default();
        for ms in [0, 4, 8, 28, 88] {
            seat.arrived(start + Duration::from_millis(ms));
        }
        let taken = seat.take();
        assert_eq!(
            (taken.over_17_ms, taken.over_50_ms),
            (2, 1),
            "the gaps were not counted by their length"
        );
        assert_eq!(taken.frames, 5);
        assert!((taken.gap_max_ms.unwrap() - 60.0).abs() < 1e-6);
        // Le relevé se vide, et la dernière trame reste: le premier écart du
        // relevé suivant se compte depuis elle.
        seat.arrived(start + Duration::from_millis(92));
        let next = seat.take();
        assert_eq!(next.frames, 1);
        assert!((next.gap_max_ms.unwrap() - 4.0).abs() < 1e-6);
    }

    /// Le jumeau: une cadence de 4 ms ne compte aucun écart, et un écart
    /// d'exactement 17 ms n'est pas « au-dessus ».
    #[test]
    fn a_steady_cadence_counts_no_gap() {
        let start = Instant::now();
        let mut seat = Arrivals::default();
        for ms in [0, 4, 8, 12, 29] {
            seat.arrived(start + Duration::from_millis(ms));
        }
        let taken = seat.take();
        assert_eq!(
            (taken.frames, taken.over_17_ms, taken.over_50_ms),
            (5, 0, 0)
        );
        // Rien d'arrivé: aucun écart, et pas un écart de zéro.
        assert!(Arrivals::default().take().gap_max_ms.is_none());
        // Une place rendue puis reprise ne compte pas l'écart entre deux mains.
        seat.forget();
        seat.arrived(start + Duration::from_mins(1));
        assert!(seat.take().gap_max_ms.is_none());
    }
}
