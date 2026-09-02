//! Les manettes: qui tient quelle place, et ce qui remonte vers ses mains.
//!
//! Une place est tenue par une CONNEXION et pas par un nom, parce que la même
//! personne peut ouvrir la salle sur deux appareils. Le worker est la seule
//! autorité: la page dit ce qu'elle voudrait, il répond ce qu'elle a, et une
//! trame de manette est estampillée de la place que cette socket a reçue quoi
//! qu'elle prétende.

use std::net::TcpStream;
use std::sync::{Arc, Condvar};

use nel3ab_protocol::{Command, Echo, InputFrame, PlayerSlot};

use super::{AWAY_AFTER, Acted, GONE_AFTER, PING_EVERY, PORTS, Pads, Seats, Shared, socket_limits};

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
) -> Option<(PlayerSlot, u64, Vec<u8>)> {
    let (seats, players) = (&shared.seats, shared.players);
    let Some((seat, claim)) = take_seat(seats, players, take) else {
        tracing::info!("a browser asked for a controller in a full room");
        let _ = socket.send(tungstenite::Message::binary(room_message(
            players, None, seats, false,
        )));
        return None;
    };
    let told = room_message(
        players,
        Some(seat),
        seats,
        decides(&shared.owner, &shared.acted, seat),
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
pub(super) fn apply_pad(
    payload: &[u8],
    seat: PlayerSlot,
    slots: &Pads,
    acted: &Acted,
    received: &Arc<std::sync::atomic::AtomicU64>,
    arrived: &Arc<Condvar>,
) -> bool {
    let frame = match InputFrame::decode(payload) {
        Ok(frame) => frame,
        Err(error) => {
            tracing::warn!(%error, "a client sent something that is not an InputFrame");
            return false;
        }
    };
    // Stamped with the seat this connection was given, whatever the frame
    // claims. A page that says "I am player 1" must not be able to move player
    // 1's character, and the check that would reject it is a check that can be
    // forgotten: overwriting cannot.
    let frame = InputFrame {
        slot: seat,
        ..frame
    };
    received.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    // Une trame NEUTRE ne compte pas comme une présence. La page en envoie une à
    // chaque tour, même quand personne ne touche à rien: prendre « une trame est
    // arrivée » pour « quelqu'un joue » rendrait tout le monde éternellement
    // présent, et c'est précisément ce qu'on cherche à distinguer.
    if !frame.is_neutral()
        && let Ok(mut acted) = acted.lock()
        && let Some(when) = acted.get_mut(seat.index())
    {
        *when = Some(std::time::Instant::now());
    }
    if let Ok(mut slots) = slots.lock() {
        // Replaces rather than queues. Overwriting a state the emulator has not
        // read yet is not a loss: it could only ever have applied the newer one.
        if let Some(place) = slots.get_mut(frame.slot.index()) {
            *place = Some(frame);
        }
    }
    // Woken after the lock is released, so the waiter does not wake straight
    // into a lock it cannot take.
    arrived.notify_one();
    true
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

pub(super) fn input_thread(stream: TcpStream, shared: &Shared, take: Option<PlayerSlot>) {
    let (slots, received, arrived, seats, players) = (
        &shared.inputs,
        &shared.received,
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

    let Some((seat, claim, mut told)) = claim_a_port(&mut socket, shared, take) else {
        let _ = socket.close(None);
        return;
    };

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
                players, None, seats, false,
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
            // Pong is the answer to our own ping and has already counted as
            // proof of life above; text is not something this endpoint speaks.
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
        // Two bytes is a command, thirteen is a pad. Told apart by length,
        // which needs no mode and no header — see `Command` in the protocol.
        if payload.len() == Command::LEN {
            if obey(&payload, shared, seat) {
                continue;
            }
            break;
        }
        if !apply_pad(&payload, seat, slots, &shared.acted, received, arrived) {
            break;
        }
    }
    tracing::info!(port = seat.get(), "the controller disconnected");
    // The seat goes back before the state does: a port nobody holds keeps
    // applying whatever its last holder left pressed, and a stuck direction is
    // exactly the bug a player would blame the network for.
    release_seat(seats, seat, claim);
    if let Ok(mut slots) = slots.lock()
        && let Some(place) = slots.get_mut(seat.index())
    {
        *place = Some(InputFrame::neutral(seat));
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
                *wanted = Some(index);
            }
            true
        }
        Err(error) => {
            tracing::warn!(%error, "a client sent a command we do not know");
            false
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
) -> Option<(PlayerSlot, u64)> {
    let claim = next_claim();
    // The lock lives in this block and no longer: every caller of this function
    // goes on to write to a socket, and holding the room's lock across a write
    // is how one slow client stops everybody else from joining.
    let taken = {
        let mut seats = seats.lock().ok()?;
        let chosen = match take {
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
) -> Vec<u8> {
    let mut message = Vec::with_capacity(3 + PORTS);
    message.push(players.get());
    message.push(mine.map_or(0, PlayerSlot::get));
    message.push(u8::from(may_decide));
    message.extend(occupancy(seats).into_iter().map(u8::from));
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
