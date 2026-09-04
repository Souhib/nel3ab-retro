//! Ce qui part vers les navigateurs qui REGARDENT: l'image et le son.
//!
//! Une image est encodée une fois et partagée, jamais recopiée par
//! spectateur. Chacun a sa file bornée, et un navigateur dont la socket ne se
//! vide plus se voit refuser des images plutôt que retenir tout le monde: c'est
//! sa liaison qui va mal, pas la salle.

use std::net::TcpStream;
use std::sync::mpsc::{RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::{
    Framed, KEEP_ALIVE, KEY_FRAME_EVERY, KEY_FRAME_PLEASE, OUTGOING_DEPTH, Packet, Viewers,
    WRITE_TIMEOUT, socket_limits,
};

/// One connected viewer: its queue, and whether its stream is currently broken.
#[derive(Debug)]
pub(super) struct Viewer {
    pub(super) pipe: SyncSender<Framed>,
    /// Vrai depuis qu'une image lui a été refusée, jusqu'à la prochaine
    /// image-clé.
    ///
    /// Une image jetée au milieu d'un groupe casse TOUT ce qui suit: le décodeur
    /// du navigateur reçoit des images qui référencent une image qu'il n'a
    /// jamais eue. Continuer à lui en envoyer lui fait décoder du bruit et
    /// afficher une bouillie de blocs, jusqu'à ce qu'il abandonne et redemande
    /// une clé. Mesuré le 2026-08-16 sur un lien étroit: 306 images non
    /// décodables contre 192 décodées, soit deux tiers du travail perdu.
    ///
    /// Se taire jusqu'à la clé transforme ça en un gel court suivi d'une reprise
    /// propre. Un spectateur dont la file ne déborde jamais ne voit rien de tout
    /// ceci.
    pub(super) resyncing: bool,
}

/// Hands one access unit to every viewer of one stream.
///
/// Written once and called for both streams: la politique de resynchronisation
/// juste en dessous est délicate, et deux copies qui divergent donneraient un
/// flux réparé et un flux cassé sans que rien ne le dise.
pub(super) fn deliver(
    viewers: &Viewers,
    dropped: &Arc<std::sync::atomic::AtomicU64>,
    wants_key: &Arc<std::sync::atomic::AtomicBool>,
    packet: &Packet,
) -> bool {
    let Ok(mut viewers) = viewers.lock() else {
        return false;
    };
    if viewers.is_empty() {
        return false;
    }
    // Framed once and shared, and now that is true. The comment said so
    // while the thread serving each viewer called `(*message).clone()` on an
    // `Arc<Vec<u8>>`, which copies the whole picture: four viewers did cost
    // four copies, the exact thing the line claimed to avoid.
    //
    // `Bytes` is what the socket takes anyway — `Message::Binary(Bytes)` —
    // and cloning one is a refcount. The picture is copied once, here, out
    // of the encoder's buffer into the frame that goes on the wire.
    let mut message = Vec::with_capacity(8 + packet.annex_b.len());
    message.extend_from_slice(&packet.captured_micros.to_le_bytes());
    message.extend_from_slice(packet.annex_b);
    let message = Framed::from(message);

    let key = carries_key_frame(packet.annex_b);
    let mut delivered = false;
    let mut broke = false;
    viewers.retain_mut(|viewer| {
        // Un spectateur dont le flux est cassé n'a rien à faire d'une image
        // qui référence ce qu'il n'a pas. On attend la clé.
        if viewer.resyncing {
            if !key {
                return true;
            }
            viewer.resyncing = false;
        }
        match viewer.pipe.try_send(message.clone()) {
            Ok(()) => {
                delivered = true;
                true
            }
            // This viewer is behind. Its own frames are lost; the others are
            // untouched, which is the whole point of a queue each.
            Err(TrySendError::Full(_)) => {
                dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                // Sauf si c'était la clé: la jeter et l'attendre en même
                // temps ne mènerait nulle part.
                if !key {
                    viewer.resyncing = true;
                    broke = true;
                }
                true
            }
            // Its thread has gone. Forgetting it here is what keeps the list
            // from growing across a session's reconnections.
            Err(TrySendError::Disconnected(_)) => false,
        }
    });
    // Demandée ICI plutôt que par le navigateur, qui ne découvre la casse
    // qu'en échouant à décoder: le worker, lui, sait qu'il vient de jeter.
    // La demande est déjà limitée en fréquence, donc un spectateur en
    // difficulté ne peut pas faire grossir le flux de tout le monde.
    if broke {
        wants_key.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    delivered
}

/// Honours a request for a key frame, at most one per [`KEY_FRAME_EVERY`].
///
/// Par flux: les deux paires lui sont passées plutôt que lues sur l'état
/// partagé, parce qu'une image-clé du grand format ne répare pas le petit.
pub(super) fn ask_for_key_frame(
    wants_key: &Arc<std::sync::atomic::AtomicBool>,
    granted_key: &Arc<Mutex<Instant>>,
) {
    let Ok(mut granted) = granted_key.lock() else {
        return;
    };
    if granted.elapsed() < KEY_FRAME_EVERY {
        return;
    }
    *granted = Instant::now();
    wants_key.store(true, std::sync::atomic::Ordering::Relaxed);
}

/// Cette unité d'accès contient-elle une image-clé ?
///
/// On cherche un NAL de type 5 (`IDR`) parmi ceux que sépare un code de départ.
/// Le type est dans les cinq bits de poids faible du premier octet du NAL.
///
/// Écrit ici plutôt que déduit de « on vient de demander une clé »: le worker
/// demande, l'encodeur décide, et les deux ne sont pas au même moment.
pub(super) fn carries_key_frame(annex_b: &[u8]) -> bool {
    let mut zeros = 0_usize;
    let mut at_start = false;
    for byte in annex_b {
        if at_start {
            at_start = false;
            if byte & 0x1F == 5 {
                return true;
            }
        }
        match byte {
            0 => zeros += 1,
            1 if zeros >= 2 => {
                at_start = true;
                zeros = 0;
            }
            _ => zeros = 0,
        }
    }
    false
}

/// Sends encoded frames until the client goes away.
///
/// Blocking writes on a blocking socket: the queue in front of this thread is
/// what absorbs a slow client, and it absorbs it by dropping. Making the socket
/// non-blocking as well would mean re-implementing that policy twice.
/// Sends encoded frames to one viewer until it goes away.
///
/// Blocking writes on a blocking socket, with a deadline. The queue in front of
/// this thread is what absorbs a slow client, and it absorbs it by dropping —
/// this viewer's frames only.
pub(super) fn video_thread(
    stream: TcpStream,
    viewers: &Viewers,
    joined: &Arc<std::sync::atomic::AtomicBool>,
    wants_key: &Arc<std::sync::atomic::AtomicBool>,
    granted_key: &Arc<Mutex<Instant>>,
) {
    // Nagle would hold a small frame back waiting for company. Every frame here
    // is latency-critical and self-contained, so there is nothing to gain by
    // waiting and 40 ms to lose.
    let _ = stream.set_nodelay(true);
    // Short, because this thread READS as well as writes, and it must not block
    // to do it. A viewer's only message is its goodbye: a page that closes its
    // socket sends a Close frame and waits for the reply, and tungstenite only
    // replies to what we read. This thread read nothing at all, so a page that
    // closed politely waited for a handshake that would never finish — its
    // `onclose` never fired, its reconnection never started, and it sat there
    // for good. Invisible for months because nothing depended on it: the page
    // always got a new key frame within a second and never had to reconnect.
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1)));
    // A write that can block forever is how a stalled client wedges a thread.
    // Two seconds is far longer than any healthy write and far shorter than a
    // session; what matters is that it is finite.
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let Ok(mut socket) = tungstenite::accept_with_config(stream, Some(socket_limits())) else {
        return;
    };

    let (sender, frames) = sync_channel::<Framed>(OUTGOING_DEPTH);
    match viewers.lock() {
        Ok(mut viewers) => viewers.push(Viewer {
            pipe: sender,
            resyncing: false,
        }),
        Err(_) => return,
    }
    joined.store(true, std::sync::atomic::Ordering::Relaxed);
    tracing::info!("a browser is watching");

    loop {
        let outgoing = match frames.recv_timeout(KEEP_ALIVE) {
            Ok(message) => message,
            // Nothing for half a second: say "still here" and nothing else.
            Err(RecvTimeoutError::Timeout) => Framed::new(),
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if let Err(error) = socket.send(tungstenite::Message::binary(outgoing)) {
            // Including a write timeout: a viewer this far behind is better
            // dropped than carried, and the page reconnects.
            tracing::info!(%error, "the viewer's connection gave up");
            break;
        }

        // Then listen, briefly. Anything a viewer sends is either a goodbye or a
        // control frame tungstenite answers on our behalf; either way it has to
        // be read for the socket to behave like a socket.
        match socket.read() {
            Ok(tungstenite::Message::Close(_)) => break,
            Ok(tungstenite::Message::Binary(bytes)) if bytes.as_ref() == [KEY_FRAME_PLEASE] => {
                ask_for_key_frame(wants_key, granted_key);
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
    }
    // The receiver dies with this thread, so the next `send` sees the channel
    // disconnected and forgets this viewer. Nothing to unregister by hand.
    tracing::info!("the browser stopped watching");
    let _ = socket.close(None);
}

/// Sends sound to one listener until it goes away.
///
/// The same shape as the picture's thread and deliberately not the same
/// function: a listener has no key frame to ask for and no joining to announce,
/// and threading two unused arguments through the video path would make it
/// harder to read for nothing.
pub(super) fn sound_thread(stream: TcpStream, listeners: &Viewers) {
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1)));
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let Ok(mut socket) = tungstenite::accept_with_config(stream, Some(socket_limits())) else {
        return;
    };

    let (sender, chunks) = sync_channel::<Framed>(OUTGOING_DEPTH);
    match listeners.lock() {
        Ok(mut listeners) => listeners.push(Viewer {
            pipe: sender,
            resyncing: false,
        }),
        Err(_) => return,
    }
    tracing::info!("a browser is listening");

    loop {
        let outgoing = match chunks.recv_timeout(KEEP_ALIVE) {
            Ok(chunk) => chunk,
            Err(RecvTimeoutError::Timeout) => Framed::new(),
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if socket.send(tungstenite::Message::binary(outgoing)).is_err() {
            break;
        }
        match socket.read() {
            Ok(tungstenite::Message::Close(_)) => break,
            Ok(_) => {}
            Err(tungstenite::Error::Io(error))
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) => {}
            Err(_) => break,
        }
    }
    tracing::info!("the browser stopped listening");
    let _ = socket.close(None);
}

#[cfg(test)]
#[expect(
    clippy::unwrap_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use std::sync::Condvar;

    use super::super::harness::*;
    use super::super::{PORTS, Shared};
    use super::*;

    #[test]
    fn a_key_frame_is_recognised_by_its_nal_type_and_nothing_else() {
        // Type 5 après un code de départ: c'est une clé.
        assert!(carries_key_frame(&[0, 0, 0, 1, 0x65]));
        assert!(carries_key_frame(&[0, 0, 1, 0x25]));
        // Une clé annoncée après un SPS et un PPS, ce qui est la forme réelle.
        assert!(carries_key_frame(&[
            0, 0, 0, 1, 0x67, 0, 0, 0, 1, 0x68, 0, 0, 0, 1, 0x65
        ]));

        // Les jumeaux négatifs. Sans eux, une fonction qui rendrait toujours vrai
        // passerait tout ce qui est au-dessus, et le spectateur en resynchro
        // reprendrait sur une image qui ne le répare pas.
        assert!(!carries_key_frame(&[0, 0, 0, 1, 0x41]));
        assert!(!carries_key_frame(&[]));
        // Un 5 qui n'est PAS après un code de départ: c'est de la donnée.
        assert!(!carries_key_frame(&[0, 0, 0, 1, 0x41, 0x05, 0x05]));
        // Deux zéros et un un ne font un code de départ qu'ensemble.
        assert!(!carries_key_frame(&[0, 1, 0x65]));
    }

    /// Ce qu'un spectateur en difficulté reçoit entre deux clés: rien.
    ///
    /// Jeter une image au milieu d'un groupe casse tout ce qui suit, parce que
    /// les suivantes référencent celle qui manque. Le navigateur décodait alors
    /// du bruit: 306 images non décodables contre 192 décodées, mesuré le
    /// 2026-08-16 sur un lien étroit avec `slowlink.mjs`.
    #[test]
    fn a_viewer_whose_stream_broke_is_left_alone_until_the_next_key_frame() {
        let (sender, held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![sender]);

        // On remplit sa file, puis une image de plus: celle-là est perdue, et
        // c'est elle qui casse la chaîne.
        for _ in 0..OUTGOING_DEPTH {
            assert!(server.send(&delta()));
        }
        assert!(!server.send(&delta()), "la file est pleine");
        assert_eq!(server.dropped(), 1);

        // La file se vide. Une image ordinaire ne doit toujours PAS partir: elle
        // référence celle qui manque.
        while held.try_recv().is_ok() {}
        assert!(!server.send(&delta()), "rien tant que la chaîne est cassée");
        assert!(held.try_recv().is_err(), "et rien n'est arrivé non plus");
        assert_eq!(server.dropped(), 1, "se taire n'est pas jeter");

        // La clé le répare, et la suite repart.
        assert!(server.send(&frame()), "la clé passe");
        assert!(held.try_recv().is_ok());
        assert!(
            server.send(&delta()),
            "et les ordinaires repartent après elle"
        );
    }

    #[test]
    fn key_frames_are_granted_no_faster_than_the_limit() {
        let shared = Shared {
            clips: Arc::new(Mutex::new(crate::clip::Clips::new())),
            wants_save: Arc::new(Mutex::new(0)),
            wants_pad: Arc::new(Mutex::new(0_u8)),
            acted: Arc::new(Mutex::new([None; PORTS])),
            wants_extension: Arc::new(Mutex::new([None; PORTS])),
            viewers: Arc::new(Mutex::new(Vec::new())),
            half_viewers: Arc::new(Mutex::new(Vec::new())),
            half_joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            half_wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            half_ready: Arc::new(std::sync::atomic::AtomicU8::new(
                crate::browser::HALF_UNKNOWN,
            )),
            half_granted_key: Arc::new(Mutex::new(Instant::now())),
            listeners: Arc::new(Mutex::new(Vec::new())),
            inputs: Arc::new(Mutex::new([None; PORTS])),
            rumbles: Arc::new(Mutex::new([0; PORTS])),
            arrived: Arc::new(Condvar::new()),
            received: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            granted_key: Arc::new(Mutex::new(
                Instant::now().checked_sub(KEY_FRAME_EVERY).unwrap(),
            )),
            seats: Arc::new(Mutex::new([None; PORTS])),
            players: four(),
            wants_rom: Arc::new(Mutex::new(None)),
            catalogue: "[]".into(),
            art: no_art(),
            owner: nobody(),
        };

        for _ in 0..1000 {
            ask_for_key_frame(&shared.wants_key, &shared.granted_key);
        }
        assert!(
            shared
                .wants_key
                .swap(false, std::sync::atomic::Ordering::Relaxed),
            "the first request should be granted"
        );
        for _ in 0..1000 {
            ask_for_key_frame(&shared.wants_key, &shared.granted_key);
        }
        assert!(
            !shared.wants_key.load(std::sync::atomic::Ordering::Relaxed),
            "two thousand requests bought two key frames instead of one"
        );
    }
}

/// Ce que la lecture d'un flux H.264 doit tenir, quelle que soit l'entrée.
///
/// `carries_key_frame` parcourt des octets qui viennent de l'encodeur, donc de
/// notre côté, mais elle décide si un spectateur en retard peut reprendre. Une
/// erreur ici ne se voit pas comme une erreur: elle se voit comme une image en
/// bouillie chez une seule personne.
#[cfg(test)]
mod properties {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Aucune suite d'octets ne fait paniquer le balayage.
        #[test]
        fn no_bitstream_can_make_the_scan_panic(
            bytes in proptest::collection::vec(any::<u8>(), 0..2048),
        ) {
            let _ = carries_key_frame(&bytes);
        }

        /// Une clé reste trouvable où qu'elle soit dans le flux.
        ///
        /// La moitié qui compte: un balayage qui répondrait toujours faux
        /// satisferait l'essai d'au-dessus, et plus aucun spectateur en retard
        /// ne reprendrait jamais.
        #[test]
        fn a_key_frame_is_found_wherever_it_sits(
            before in proptest::collection::vec(any::<u8>(), 0..64),
            after in proptest::collection::vec(any::<u8>(), 0..64),
        ) {
            let mut stream = before;
            stream.extend_from_slice(&[0, 0, 0, 1, 0x65]);
            stream.extend_from_slice(&after);

            prop_assert!(carries_key_frame(&stream));
        }

        /// Et un flux qui n'en contient pas n'en invente pas.
        #[test]
        fn a_stream_of_delta_frames_never_claims_a_key(
            count in 1_usize..8,
        ) {
            let mut stream = Vec::new();
            for _ in 0..count {
                // NAL de type 1: une image ordinaire.
                stream.extend_from_slice(&[0, 0, 0, 1, 0x41, 0x9a, 0x02]);
            }

            prop_assert!(!carries_key_frame(&stream));
        }
    }
}
