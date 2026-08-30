//! The browser end: H.264 out, pad state back.
//!
//! # Ce qui vit où
//!
//! Ce fichier tenait 3 590 lignes et six métiers, ce que le premier audit avait
//! signalé et que le second a reporté une fois de plus. Il a fini par se couper
//! le 30 août 2026, à la troisième semaine où j'y touchais pour autre chose.
//!
//! Il ne reste ici que ce qui est vraiment commun: le serveur lui-même, la
//! boucle qui accepte, l'état partagé, et les types que les autres crates
//! voient. Le reste est chez lui.
//!
//! | Module | Ce qu'il fait |
//! |---|---|
//! | `route` | reconnaître ce qu'une requête veut, sans rien servir |
//! | `page` | la page, sa compression, sa politique, sa revalidation |
//! | `stream` | ce qui part vers ceux qui regardent: image et son |
//! | `pad` | qui tient quelle place, et ce qui remonte vers ses mains |
//!
//! Les tests suivent leur sujet, et ce qu'ils partagent vit dans `harness`.
//!
//! # Two connections, not one
//!
//! Video and input get **separate `WebSockets`**, and that is a latency decision
//! rather than tidiness. A WebSocket is TCP: on one connection, a 10 KB IDR
//! being retransmitted sits in front of every 13-byte pad frame behind it. Two
//! connections do not share a send queue, so a stalled video frame cannot delay
//! a button press.
//!
//! It does not make input *unreliable*, which is what it actually wants — a
//! retransmitted input is already stale. That needs WebTransport datagrams, and
//! the M3 plan says so. This is the cheap half of the fix, and the half that can
//! be had without a second protocol.
//!
//! # Frames are dropped, never queued
//!
//! The outgoing channel is bounded and a full one drops the frame. Queueing
//! video for a client that is not keeping up converts a bandwidth problem into a
//! latency problem and hides it — the player would see a smooth stream of
//! increasingly old pictures. Dropping is visible and recoverable.

use std::io::{Read as _, Write as _};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::mpsc::TrySendError;
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use nel3ab_protocol::{InputFrame, PlayerSlot};
use thiserror::Error;

#[cfg(test)]
mod harness;
mod pad;
mod page;
mod route;
mod stream;

use pad::input_thread;
use page::{Packing, serve_body, serve_bytes, serve_missing, serve_page};
use route::{Route, classify};
use stream::{Viewer, carries_key_frame, deliver, sound_thread, video_thread};

/// How many frames may wait for the socket before one is dropped.
///
/// Two, not zero and not twenty. Zero would drop a frame every time the write
/// took longer than the gap between frames, which happens routinely. Twenty
/// would let a slow client accumulate a third of a second of stale pictures.
const OUTGOING_DEPTH: usize = 2;

/// The four ports a room can hold.
const PORTS: usize = 4;

/// One framed WebSocket payload, shared by every viewer rather than copied per
/// viewer: four players should not cost four copies of the same picture.
type Framed = tungstenite::Bytes;

/// The registry of connected viewers, each with its own bounded queue.
type Viewers = Arc<Mutex<Vec<Viewer>>>;

/// La force de vibration voulue pour chaque port, de zéro à deux cent
/// cinquante-cinq.
///
/// Un emplacement par port et pas une file: seule la valeur COURANTE compte, et
/// une file de vibrations en retard secouerait les mains d'un joueur au rythme
/// d'une partie déjà finie. C'est la même raison que pour les manettes entrantes,
/// juste en sens inverse.
type Rumbles = Arc<Mutex<[u8; PORTS]>>;

/// Who currently holds each port, as a claim number rather than a flag.
///
/// A number because a holder must be able to discover it has been REPLACED. A
/// page that is merely open sends the neutral pad state sixty times a second, so
/// "somebody is holding this port" says nothing about anybody playing: a tab
/// left open on another machine kept the only controller of the room for half an
/// hour while its owner pressed keys into a page that had none. The holder
/// compares the number it was given against the one in the slot, and stands down
/// when they differ.
type Seats = Arc<Mutex<[Option<u64>; PORTS]>>;

/// The latest pad state per port.
type Pads = Arc<Mutex<[Option<InputFrame>; PORTS]>>;

/// How long a single frame write may take before the viewer is given up on.
///
/// Not a tuning knob: any value long enough to survive a hiccup and short enough
/// to be noticed would do. What matters is that it is finite.
const WRITE_TIMEOUT: Duration = Duration::from_secs(2);

/// How long a viewer may hear nothing before the server says something anyway.
///
/// The emulator does go quiet legitimately: a game that blanks the screen
/// presents nothing, and Dolphin's export hook does not fire. From the socket
/// that is indistinguishable from a dead link — and the page, rightly, gives up
/// on two seconds of silence and reconnects. So the CADENCE OF THE STREAM IS
/// OURS, not the emulator's: half a second of nothing and we say so, with an
/// EMPTY message — a sign of life the page counts and decodes nothing from.
/// Empty rather than a header with no unit behind it: a reader has to special
/// case it either way, and a length of zero cannot be mistaken for a frame.
const KEEP_ALIVE: Duration = Duration::from_millis(500);

/// How long a connection has to say what it is before it is dropped.
///
/// It applies to the peek in [`classify`] only, and each route clears it: a
/// player who presses nothing is not a player who has left.
const CLASSIFY_TIMEOUT: Duration = Duration::from_secs(5);

/// The one byte a viewer may send on its video socket: "I need a key frame".
///
/// A page needs one whenever it has a gap in what it fed its decoder — it was
/// switched away from, its decoder died, it just arrived. Without a way to ask,
/// the only answer is to wait for the next scheduled one, which is why the
/// stream used to carry a key frame every single second for nobody.
pub const KEY_FRAME_PLEASE: u8 = 1;

/// How often a silent controller is asked whether it is still there, and how
/// long it may fail to answer before its port goes back to the room.
///
/// This exists because both simple answers are wrong. A read deadline treats a
/// player who presses nothing as a player who has left — that was the bug that
/// dropped controllers every five seconds. No deadline at all treats a socket
/// the TLS proxy is holding open for a browser that is GONE as a player still
/// sitting there, and its port is never given back: the room fills with ghosts
/// and everybody who arrives is turned away.
///
/// A ping separates the two, because it asks the one question that matters.
/// The browser's WebSocket stack answers it without waking the page, so a player
/// who is merely quiet — or whose tab is in the background — keeps their port,
/// and a socket with nobody behind it does not.
const PING_EVERY: Duration = Duration::from_secs(5);
const GONE_AFTER: Duration = Duration::from_secs(15);

/// Everything the browser link can fail at.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum TransportError {
    /// The listening socket could not be created.
    #[error("binding {address} failed")]
    Bind {
        /// Address we tried.
        address: SocketAddr,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// The accept loop could not be started.
    #[error("the accept loop could not start")]
    Accept {
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },
}

/// One encoded frame, with the instant it was captured.
///
/// The timestamp travels with the picture so the page can subtract it from its
/// own clock and report glass-to-glass. It is the server's monotonic clock in
/// microseconds; the page never interprets it, only echoes it back.
#[derive(Debug, Clone)]
pub struct Packet<'a> {
    /// Server-side capture instant, microseconds.
    pub captured_micros: u64,
    /// The Annex B access unit, exactly as the encoder produced it.
    ///
    /// Borrowed, because [`send`](BrowserServer::send) copies it into the
    /// outgoing frame before it returns, and the encoder's buffer stays valid
    /// until the next encode. Owning it here copied the access unit twice per
    /// frame: once to build the packet, once to frame it.
    pub annex_b: &'a [u8],
}

/// A running server: one page, one video channel, one input channel.
#[derive(Debug)]
pub struct BrowserServer {
    /// One queue per listener, the sound's answer to `viewers`. Separate lists
    /// because the two streams are independent: a page may watch without
    /// hearing, and losing one must not disturb the other.
    listeners: Viewers,
    /// Qui tient quelle place. Le serveur en a besoin pour dire combien de
    /// manettes sont tenues, ce que la sieste doit savoir.
    seats: Seats,
    /// Les dernières secondes de la partie. Voir [`crate::clip`].
    clips: Arc<Mutex<crate::clip::Clips>>,
    /// One queue per connected viewer.
    ///
    /// This was a single queue behind a mutex, served by one thread — one
    /// viewer at a time. Two attempts at that rule both failed, and the second
    /// failed loudly: refusing the newcomer locked out anybody who reloaded,
    /// and letting the newcomer win turned two auto-reconnecting pages into a
    /// takeover war that dropped the stream twenty times in twenty-four seconds.
    ///
    /// The rule was wrong at the root. A room holds up to four players and each
    /// of them needs the picture, so the shape is a fan-out, not a lock. A
    /// viewer that falls behind loses its own frames and nobody else's.
    viewers: Viewers,
    /// Les mêmes, pour le flux encodé en demi-format.
    ///
    /// Quatre champs suivent le même préfixe, et ils sont tous là pour la même
    /// raison: **rien n'est partagé entre les deux flux**. Une image-clé du
    /// grand ne répare pas le petit, et quelqu'un qui arrive sur l'un n'a rien
    /// demandé à l'autre. Les mélanger donnerait un écran noir à celui qui
    /// vient de choisir, ce qui est exactement le genre de panne qu'on ne
    /// reproduit pas sur sa propre machine.
    half_viewers: Viewers,
    half_joined: Arc<std::sync::atomic::AtomicBool>,
    half_wants_key: Arc<std::sync::atomic::AtomicBool>,
    /// Woken whenever a pad frame lands, so a writer can act on arrival instead
    /// of on a schedule.
    ///
    /// Measured before this existed: applying input once per emulated frame cost
    /// a **full frame period**, because the write landed at the same phase every
    /// time and that phase was just after the emulator polled. Waiting on a
    /// condition variable rather than polling costs nothing when nobody presses
    /// anything, which is most of the time.
    arrived: Arc<Condvar>,
    /// The latest pad state per port, and nothing older.
    ///
    /// This was a 64-deep channel, and that was the wrong shape twice over. A
    /// pad is a LEVEL: only the newest state per port can ever be applied, so
    /// every older one queued behind it is work that will be thrown away. And a
    /// queue can overflow — it logged "the input queue is full" 1073 times in
    /// five minutes, noise that would hide a real fault.
    ///
    /// A slot per port cannot overflow, cannot go stale, and needs no policy for
    /// what to discard: writing simply replaces.
    incoming: Pads,
    /// Everything that arrived, so a client sending nonsense is still visible.
    received: Arc<std::sync::atomic::AtomicU64>,
    address: SocketAddr,
    rumbles: Rumbles,
    dropped: Arc<std::sync::atomic::AtomicU64>,
    /// Les images refusées au flux RÉDUIT, comptées à part.
    ///
    /// À part parce que confondre les deux rend le compteur muet sur la seule
    /// question qu'on lui pose. Quelqu'un passe en format réduit précisément
    /// quand sa liaison va mal: si ses pertes tombent dans le même seau que
    /// celles des autres, on ne peut plus dire si le worker a dû jeter des
    /// images vers LUI ou vers quelqu'un en pleine taille, et c'est toute la
    /// différence entre « sa liaison lâche » et « la nôtre ».
    half_dropped: Arc<std::sync::atomic::AtomicU64>,
    joined: Arc<std::sync::atomic::AtomicBool>,
    wants_key: Arc<std::sync::atomic::AtomicBool>,
    /// Which game a player asked for, if one did.
    ///
    /// A slot rather than a queue, for the reason the pads are: only the newest
    /// wish can be acted on, and acting on it ends the session anyway.
    wants_rom: Arc<Mutex<Option<u8>>>,
    _accept: JoinHandle<()>,
}

impl BrowserServer {
    /// Binds and starts serving.
    ///
    /// `page` is served for any plain HTTP `GET`; the WebSocket paths are
    /// `/video`, `/sound` and `/input`.
    ///
    /// Nothing here authenticates a PERSON — that is M4, and pretending
    /// otherwise would be worse than saying so. What it does check is that a
    /// handshake comes from a page this server served (see `route::same_origin`), and
    /// the worker binds loopback so the only way in is the Tailscale proxy,
    /// which has already authenticated the device. Neither is an account; both
    /// are what stops a stranger's web page from driving the room.
    ///
    /// `players` is how many ports this room serves, `1..=4`. It is a
    /// [`PlayerSlot`] because that is precisely the set of legal values, and the
    /// number cannot be raised at run time: Dolphin reads which ports have a
    /// controller when it boots, so the room's size is a property of the session.
    ///
    /// # Errors
    /// [`TransportError::Bind`] or [`TransportError::Accept`].
    /// Ouvre l'écoute et rend l'adresse qu'elle a vraiment prise.
    ///
    /// Séparé parce que l'adresse DEMANDÉE n'est pas toujours celle qu'on
    /// obtient: les tests lient le port zéro, et c'est le noyau qui choisit.
    fn bound_listener(address: SocketAddr) -> Result<(TcpListener, SocketAddr), TransportError> {
        let listener = TcpListener::bind(address)
            .map_err(|source| TransportError::Bind { address, source })?;
        let bound = listener
            .local_addr()
            .map_err(|source| TransportError::Accept { source })?;
        Ok((listener, bound))
    }

    /// Ouvre l'écoute, monte l'état partagé, et rend le serveur.
    ///
    /// # Errors
    /// [`TransportError::Bind`] si le port est pris.
    pub fn start(
        address: SocketAddr,
        page: &'static str,
        catalogue: Arc<str>,
        art: Arc<[Option<Arc<[u8]>>]>,
        players: PlayerSlot,
        owner: &crate::control::OwnerSeat,
    ) -> Result<Self, TransportError> {
        let (listener, bound) = Self::bound_listener(address)?;

        let clips = Arc::new(Mutex::new(crate::clip::Clips::new()));
        let viewers: Viewers = Arc::new(Mutex::new(Vec::new()));
        let listeners: Viewers = Arc::new(Mutex::new(Vec::new()));
        let incoming: Pads = Arc::new(Mutex::new([None; PORTS]));
        let received = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let arrived = Arc::new(Condvar::new());
        let rumbles: Rumbles = Arc::new(Mutex::new([0; PORTS]));
        let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let half_dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let joined = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let wants_key = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let wants_rom = Arc::new(Mutex::new(None));
        let granted_key = Arc::new(Mutex::new(
            Instant::now()
                .checked_sub(KEY_FRAME_EVERY)
                .unwrap_or_else(Instant::now),
        ));
        let half_viewers: Viewers = Arc::new(Mutex::new(Vec::new()));
        let half_joined = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let half_wants_key = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let half_granted_key = Arc::new(Mutex::new(
            Instant::now()
                .checked_sub(KEY_FRAME_EVERY)
                .unwrap_or_else(Instant::now),
        ));
        let seats: Seats = Arc::new(Mutex::new([None; PORTS]));

        let accept = std::thread::Builder::new()
            .name("browser-accept".to_owned())
            .spawn({
                let clips = Arc::clone(&clips);
                let joined = Arc::clone(&joined);
                let wants_key = Arc::clone(&wants_key);
                let granted_key = Arc::clone(&granted_key);
                let inputs = Arc::clone(&incoming);
                let received = Arc::clone(&received);
                let viewers = Arc::clone(&viewers);
                let listeners = Arc::clone(&listeners);
                let arrived = Arc::clone(&arrived);
                let seats = Arc::clone(&seats);
                let wants_rom = Arc::clone(&wants_rom);
                let rumbles = Arc::clone(&rumbles);
                let owner = Arc::clone(owner);
                let half_viewers = Arc::clone(&half_viewers);
                let half_joined = Arc::clone(&half_joined);
                let half_wants_key = Arc::clone(&half_wants_key);
                let half_granted_key = Arc::clone(&half_granted_key);
                move || {
                    accept_loop(
                        &listener,
                        page,
                        &Shared {
                            clips: Arc::clone(&clips),
                            viewers,
                            listeners,
                            inputs,
                            arrived,
                            received,
                            joined,
                            wants_key,
                            granted_key,
                            seats,
                            rumbles,
                            players,
                            wants_rom,
                            catalogue,
                            half_viewers,
                            half_joined,
                            half_wants_key,
                            half_granted_key,
                            art,
                            owner,
                        },
                    );
                }
            })
            .map_err(|source| TransportError::Accept { source })?;

        tracing::info!(%bound, "browser server listening");
        Ok(Self {
            clips,
            seats,
            viewers,
            half_viewers,
            half_joined,
            half_wants_key,
            listeners,
            arrived,
            incoming,
            received,
            rumbles,
            address: bound,
            dropped,
            half_dropped,
            joined,
            wants_key,
            wants_rom,
            _accept: accept,
        })
    }

    /// The address actually bound, which matters when port 0 was asked for.
    #[must_use]
    pub const fn address(&self) -> SocketAddr {
        self.address
    }

    /// Offers a frame to everybody watching.
    ///
    /// Returns `false` when nobody took it. Never blocks: a chain that waited
    /// here would be letting the network dictate the emulator's frame rate.
    ///
    /// **An empty room is not a dropped frame.** The first version counted one
    /// every time the queue was full, and with nobody connected it always is —
    /// the worker reported 15 001 drops out of 15 003 frames on a run no browser
    /// ever joined. A metric that cries wolf when nothing is wrong is worse than
    /// no metric.
    #[must_use]
    pub fn send(&self, packet: &Packet) -> bool {
        // Gardé AVANT d'être distribué, et sans regarder si quelqu'un écoute:
        // une image jetée faute de place chez un spectateur reste une image que
        // la partie a produite, et un clip qui aurait des trous là où une
        // liaison a hoqueté ne montrerait pas la partie.
        if let Ok(mut clips) = self.clips.lock() {
            clips.keep(
                Instant::now(),
                carries_key_frame(packet.annex_b),
                packet.annex_b,
            );
        }
        deliver(&self.viewers, &self.dropped, &self.wants_key, packet)
    }

    /// Le clip des dernières secondes, emballé et prêt à partager.
    ///
    /// Rend l'attente restante quand le précédent est trop récent, et `None`
    /// quand la salle vient de démarrer et n'a pas encore de quoi couper. Trois
    /// réponses et pas deux, parce que « pas encore » et « trop tôt » n'appellent
    /// pas la même phrase à l'écran.
    ///
    /// # Errors
    /// [`crate::clip::TooSoon`] avec ce qu'il reste à patienter.
    pub fn take_clip(&self) -> Result<Option<crate::clip::Cut>, crate::clip::TooSoon> {
        let Ok(mut clips) = self.clips.lock() else {
            return Ok(None);
        };
        clips.take(Instant::now())
    }

    /// The same picture, encoded small, to whoever asked for the small one.
    ///
    /// A second list and not a flag on the first: the two streams carry
    /// DIFFERENT bytes, and a viewer of one must never be handed a frame of the
    /// other. Its decoder would be reading a picture of another size against
    /// references it does not have.
    #[must_use]
    pub fn send_half(&self, packet: &Packet) -> bool {
        deliver(
            &self.half_viewers,
            &self.half_dropped,
            &self.half_wants_key,
            packet,
        )
    }

    /// Offers one chunk of sound to everybody listening.
    ///
    /// Framed like a picture, the capture instant then the payload, so the page
    /// reads both streams the same way. Sound is dropped rather than queued for
    /// the same reason a picture is: a listener that has fallen behind wants the
    /// present, not a recording of the past.
    ///
    /// Un seul flux de son pour les deux flux d'image: réduire une image change
    /// ce qu'on voit, pas ce qu'on entend, et le son coûte cent fois moins que
    /// la vidéo.
    #[must_use]
    pub fn send_sound(&self, captured_micros: u64, pcm: &[u8]) -> bool {
        let Ok(mut listeners) = self.listeners.lock() else {
            return false;
        };
        if listeners.is_empty() {
            return false;
        }
        let mut message = Vec::with_capacity(8 + pcm.len());
        message.extend_from_slice(&captured_micros.to_le_bytes());
        message.extend_from_slice(pcm);
        let message = Framed::from(message);

        let mut delivered = false;
        listeners.retain(|listener| match listener.pipe.try_send(message.clone()) {
            Ok(()) => {
                delivered = true;
                true
            }
            Err(TrySendError::Full(_)) => true,
            Err(TrySendError::Disconnected(_)) => false,
        });
        delivered
    }

    /// How many browsers are taking the stream.
    #[must_use]
    pub fn watchers(&self) -> usize {
        self.viewers.lock().map_or(0, |viewers| viewers.len())
    }

    /// Combien de navigateurs prennent le demi-format.
    ///
    /// C'est ce qui autorise le worker à ne PAS l'encoder quand la réponse est
    /// zéro. Une salle où tout le monde a une bonne connexion ne paie donc rien
    /// pour que le demi-format existe: ni temps de carte graphique, ni octets.
    #[must_use]
    pub fn half_watchers(&self) -> usize {
        self.half_viewers.lock().map_or(0, |viewers| viewers.len())
    }

    /// Comme [`take_key_frame_request`](Self::take_key_frame_request), pour le
    /// demi-format. Séparé parce qu'une image-clé de l'un ne répare pas l'autre.
    #[must_use]
    pub fn take_half_key_frame_request(&self) -> bool {
        self.half_wants_key
            .swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    /// Comme [`take_joined`](Self::take_joined), pour le demi-format.
    #[must_use]
    pub fn take_half_joined(&self) -> bool {
        self.half_joined
            .swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    /// Combien de manettes sont tenues en ce moment.
    ///
    /// Pour la sieste, qui doit compter les joueurs et pas seulement les
    /// spectateurs: geler le jeu sous les doigts de quelqu'un qui joue sans
    /// regarder l'image, parce qu'il est sur un téléphone en manette seule, est
    /// exactement ce qui est arrivé le 30 août 2026.
    #[must_use]
    pub fn pads_held(&self) -> usize {
        self.seats.lock().map_or(0, |seats| {
            seats.iter().filter(|held| held.is_some()).count()
        })
    }

    /// Vrai quand un jeu a été demandé et pas encore servi.
    ///
    /// Regarde sans prendre, contrairement à [`take_rom_request`](Self::take_rom_request).
    /// La sieste a besoin de le SAVOIR pour se réveiller; c'est la boucle
    /// d'images qui a le droit de le consommer.
    #[must_use]
    pub fn rom_wanted(&self) -> bool {
        self.wants_rom.lock().is_ok_and(|wanted| wanted.is_some())
    }

    /// Which game a player asked to boot, if one did since this was last asked.
    ///
    /// Reading it clears it: the caller acts on a wish exactly once, and acting
    /// on it means ending this session.
    #[must_use]
    pub fn take_rom_request(&self) -> Option<u8> {
        self.wants_rom.lock().ok()?.take()
    }

    /// Whether a viewer asked for a key frame since this was last asked.
    ///
    /// Reading it clears it: one key frame answers everybody who asked while it
    /// was being made.
    #[must_use]
    pub fn take_key_frame_request(&self) -> bool {
        self.wants_key
            .swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    /// Whether somebody joined since this was last asked.
    ///
    /// Reading it clears it, so the caller gets the event exactly once — a
    /// viewer who joined is owed one key frame, not one per frame thereafter.
    #[must_use]
    pub fn take_joined(&self) -> bool {
        self.joined
            .swap(false, std::sync::atomic::Ordering::Relaxed)
    }

    /// Whether any browser is taking the video stream.
    #[must_use]
    pub fn is_watched(&self) -> bool {
        self.watchers() > 0
    }

    /// Takes the newest pad state for each port, and clears it.
    ///
    /// At most one per port by construction, so the caller has nothing to
    /// coalesce. Clearing means a port whose client went quiet reports nothing
    /// rather than the same state forever — which matters, because "nothing new"
    /// and "still held" are different facts and only the emulator should decide
    /// what the second one means.
    #[must_use]
    pub fn drain_input(&self) -> Vec<InputFrame> {
        let Ok(mut slots) = self.incoming.lock() else {
            return Vec::new();
        };
        slots.iter_mut().filter_map(Option::take).collect()
    }

    /// Blocks until a pad frame arrives, then takes the newest state per port.
    ///
    /// Returns empty on timeout, which is the normal case: a player holding
    /// still sends nothing new. The timeout exists so a caller can notice its
    /// own shutdown rather than sleeping forever.
    ///
    /// # Errors
    /// Never — a poisoned lock returns empty rather than propagating, because a
    /// dropped pad frame is recoverable and a dead input thread is not.
    #[must_use]
    pub fn wait_input(&self, timeout: Duration) -> Vec<InputFrame> {
        let Ok(slots) = self.incoming.lock() else {
            return Vec::new();
        };
        let Ok((mut slots, _)) = self
            .arrived
            .wait_timeout_while(slots, timeout, |slots| slots.iter().all(Option::is_none))
        else {
            return Vec::new();
        };
        slots.iter_mut().filter_map(Option::take).collect()
    }

    /// How many pad frames have arrived in total.
    #[must_use]
    pub fn inputs_received(&self) -> u64 {
        self.received.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// How many frames a connected client was too slow to take.
    #[must_use]
    pub fn dropped(&self) -> u64 {
        self.dropped.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Dit qu'une manette doit vibrer, et à quelle force.
    ///
    /// Écrit dans un emplacement plutôt qu'envoyé: le fil qui sert cette manette
    /// se réveille déjà soixante fois par seconde sur les trames qui montent, et
    /// il verra le changement au passage. Pas de canal, pas de diffusion, comme
    /// pour la salle.
    pub fn rumble(&self, port: PlayerSlot, level: u8) {
        if let Ok(mut held) = self.rumbles.lock()
            && let Some(slot) = held.get_mut(port.index())
        {
            *slot = level;
        }
    }

    /// Combien d'images le flux RÉDUIT a dû jeter faute de place.
    #[must_use]
    pub fn half_dropped(&self) -> u64 {
        self.half_dropped.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// What the connection threads share with the server.
#[derive(Clone)]
struct Shared {
    /// Les dernières secondes, gardées pour qu'on puisse les revoir.
    ///
    /// Nourri par [`BrowserServer::send`], donc par le flux GRAND format et lui
    /// seul: un clip doit montrer ce qu'on regardait, pas la version réduite
    /// que quelqu'un d'autre a choisie pour sa liaison.
    clips: Arc<Mutex<crate::clip::Clips>>,
    viewers: Viewers,
    listeners: Viewers,
    inputs: Pads,
    arrived: Arc<Condvar>,
    received: Arc<std::sync::atomic::AtomicU64>,
    joined: Arc<std::sync::atomic::AtomicBool>,
    wants_key: Arc<std::sync::atomic::AtomicBool>,
    /// When a key frame was last granted to anybody. See [`ask_for_key_frame`].
    granted_key: Arc<Mutex<Instant>>,
    seats: Seats,
    rumbles: Rumbles,
    players: PlayerSlot,
    wants_rom: Arc<Mutex<Option<u8>>>,
    /// The room's library, already rendered as JSON.
    ///
    /// Rendered by the worker rather than here: what a game is called and where
    /// it lives is the emulator's business, and the transport's job is to hand
    /// bytes to a browser without an opinion about them.
    catalogue: Arc<str>,
    /// Le second flux: ses spectateurs, et ce qu'ils demandent. Voir le champ
    /// du même nom sur [`BrowserServer`] pour pourquoi rien n'est partagé.
    half_viewers: Viewers,
    half_joined: Arc<std::sync::atomic::AtomicBool>,
    half_wants_key: Arc<std::sync::atomic::AtomicBool>,
    half_granted_key: Arc<Mutex<Instant>>,
    /// One picture per game, in library order, for whichever games have one.
    ///
    /// Bytes, not a type: this crate does not know what a banner is, where it
    /// came from or how it was encoded, and it does not need to. The same rule
    /// as the catalogue above, applied to something that is not text.
    art: Arc<[Option<Arc<[u8]>>]>,
    /// La place qui a le droit de changer de jeu, dite par le plan de contrôle
    /// sur un port que le proxy ne relaie pas. Voir [`crate::control`].
    owner: crate::control::OwnerSeat,
}

/// How often a viewer's request for a key frame is honoured.
///
/// One byte, from anybody who can open the video socket, makes the encoder
/// produce a key frame — which is five or six times the size of an ordinary one
/// and goes to EVERY viewer. Unlimited, that is an amplifier: measured on this
/// machine, a single client sending that byte every two milliseconds inflated
/// the average picture from 40.3 to 56.3 KiB for everybody, on a busy scene
/// where the ratio is at its smallest.
///
/// Half a second is far more often than any legitimate need — a page asks when
/// its decoder died or when it came back from being hidden — and bounds the
/// amplification at two key frames a second whatever anybody sends.
const KEY_FRAME_EVERY: Duration = Duration::from_millis(500);

/// How many connections may be in flight at once.
const MAX_CONNECTIONS: usize = 64;

/// What a browser is allowed to send us, and how much room we keep for it.
///
/// Everything a page sends is tiny: thirteen bytes of pad state, one byte to ask
/// for a key frame. Tungstenite's defaults are sized for the general case — 64
/// MiB per message, 16 MiB per frame, and a 128 KiB read buffer allocated for
/// every connection whether it is used or not. Nobody here needs any of that,
/// and an unauthenticated stranger who can open a socket should not be able to
/// make us hold megabytes for them.
///
/// The write side keeps its default buffer, because a picture legitimately
/// reaches a hundred kilobytes, but gains a ceiling: a viewer whose socket has
/// stopped draining must not be able to grow that buffer without bound.
fn socket_limits() -> tungstenite::protocol::WebSocketConfig {
    tungstenite::protocol::WebSocketConfig::default()
        .read_buffer_size(4 * 1024)
        .max_message_size(Some(4 * 1024))
        .max_frame_size(Some(4 * 1024))
        .max_write_buffer_size(4 * 1024 * 1024)
}

/// Serves pages and hands WebSocket connections to their own threads.
fn accept_loop(listener: &TcpListener, page: &'static str, shared: &Shared) {
    let mut sockets: Vec<JoinHandle<()>> = Vec::new();
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        // Handed to a thread BEFORE it is classified, because classifying reads
        // from the socket and reading can wait. It used to happen here, on this
        // thread, and a connection that opened and said nothing held the whole
        // room for five seconds. Measured: three silent sockets delayed a page
        // by 15.7 s, and no traffic was needed beyond opening them. Browsers do
        // this by accident with speculative connections.
        // Reaped first, so the count below is of connections still alive rather
        // than of threads that finished long ago. Reaped rather than joined: a
        // client can stay for a whole session, and waiting on one would stop the
        // loop accepting the next.
        sockets.retain(|handle| !handle.is_finished());
        if sockets.len() >= MAX_CONNECTIONS {
            // Moving classification off this thread means a thread per
            // connection, and a thread per connection is something a stranger
            // can ask for by opening sockets. Four players hold twelve; sixty-four
            // leaves room for every reconnection storm this has ever produced and
            // still bounds what anybody can make us allocate.
            tracing::warn!(
                open = sockets.len(),
                "too many connections at once, refusing this one"
            );
            drop(stream);
            continue;
        }
        let shared = shared.clone();
        sockets.push(std::thread::spawn(move || {
            serve_connection(stream, page, &shared);
        }));
    }
}

/// Emballe les dernières secondes et les rend, ou dit pourquoi il n'y en a pas.
///
/// Sur le fil de cette connexion, donc jamais sur celui des images: emballer
/// prend le temps que ffmpeg prend, et une partie ne doit pas hoqueter parce que
/// quelqu'un a cliqué.
///
/// Trois refus, et ils ne disent pas la même chose. **429** avec le temps qui
/// reste: le précédent est trop récent, et le nombre est ce qui permet au bouton
/// de compter à rebours honnêtement plutôt que de deviner. **409**: la salle
/// vient de démarrer et n'a pas encore trente secondes derrière une image-clé.
/// **500**: l'emballage a échoué, et le message dit lequel des trois cas.
fn serve_clip(mut stream: TcpStream, shared: &Shared) {
    // La requête est LUE avant qu'on réponde, comme les autres routes de ce
    // serveur le font déjà.
    //
    // `classify` ne fait que regarder: elle appelle `peek`, donc les octets de
    // la requête restent dans la file de réception. Fermer une socket qui en
    // contient encore fait envoyer un RST au noyau plutôt qu'un FIN, et le
    // client perd alors tout ce qu'il avait déjà reçu. Sur un clip, ça donne
    // « Failed to fetch » côté navigateur pendant que le worker écrit dans son
    // journal « un clip est parti », ce qui est le pire des deux mondes.
    // Retrouvé le 30 août 2026, en local, sur un clip de 1,2 Mo.
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);

    let Ok(mut ring) = shared.clips.lock() else {
        serve_refusal(stream, 500, 0, "la salle n'a pas pu lire son anneau");
        return;
    };
    let taken = ring.take(Instant::now());
    // Le verrou est rendu AVANT d'emballer: ffmpeg prend une seconde, et le
    // garder pendant ce temps arrêterait la boucle d'images, qui range chaque
    // image dans le même anneau.
    drop(ring);
    let cut = match taken {
        Err(crate::clip::TooSoon { wait }) => {
            let seconds = wait.as_secs() + u64::from(wait.subsec_millis() > 0);
            serve_refusal(
                stream,
                429,
                seconds,
                "un clip couvre au moins trente secondes, donc deux clips plus rapprochés se recouvrent",
            );
            return;
        }
        Ok(None) => {
            serve_refusal(
                stream,
                409,
                0,
                "la salle n'a pas encore trente secondes de jeu derrière une image-clé",
            );
            return;
        }
        Ok(Some(cut)) => cut,
    };

    let covers = cut.covers.as_secs();
    let fps = cut.fps();
    match crate::clip::to_mp4(&cut.annex_b, fps) {
        Ok(mp4) => {
            tracing::info!(
                seconds = covers,
                frames = cut.frames,
                fps,
                bytes = mp4.len(),
                "un clip est parti"
            );
            serve_mp4(stream, &mp4, covers);
        }
        Err(error) => {
            tracing::warn!(%error, "le clip n'a pas pu être emballé");
            serve_refusal(stream, 500, 0, &error.to_string());
        }
    }
}

/// Le fichier, nommé pour qu'on sache ce qu'on partage sans l'ouvrir.
fn serve_mp4(mut stream: TcpStream, mp4: &[u8], covers: u64) {
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: video/mp4\r\nContent-Length: {}\r\n\
         Content-Disposition: attachment; filename=\"nel3ab-{covers}s.mp4\"\r\n\
         Cache-Control: no-store\r\n{HARDENING}Connection: close\r\n\r\n",
        mp4.len()
    );
    // L'écriture est SURVEILLÉE, contrairement au reste des réponses de ce
    // serveur. Un clip fait des dizaines de mégaoctets là où une page en fait
    // moins d'un, donc c'est la seule réponse qui puisse s'arrêter au milieu:
    // le navigateur voit alors un corps tronqué et dit « Failed to fetch »,
    // c'est-à-dire rien. Repéré le 30 août 2026 sur un clip de 18,7 Mo, où le
    // worker annonçait « un clip est parti » pendant que la page n'avait rien.
    let sent = stream
        .write_all(head.as_bytes())
        .and_then(|()| stream.write_all(mp4))
        .and_then(|()| stream.flush());
    if let Err(error) = sent {
        tracing::warn!(%error, bytes = mp4.len(), "le clip n'a pas pu être livré en entier");
    }
}

/// Un refus, avec de quoi l'afficher en français plutôt qu'en code.
fn serve_refusal(mut stream: TcpStream, code: u16, wait: u64, why: &str) {
    let reason = match code {
        429 => "Too Many Requests",
        409 => "Conflict",
        _ => "Internal Server Error",
    };
    // Le corps porte le message, l'en-tête porte l'attente: `Retry-After` est ce
    // qu'un client générique sait lire, et le message est ce qu'une personne
    // sait lire.
    let body = format!("{{\"attendre\":{wait},\"pourquoi\":\"{why}\"}}");
    let retry = if wait > 0 {
        format!("Retry-After: {wait}\r\n")
    } else {
        String::new()
    };
    let head = format!(
        "HTTP/1.1 {code} {reason}\r\nContent-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n{retry}Cache-Control: no-store\r\n{HARDENING}\
         Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body.as_bytes());
    let _ = stream.flush();
}

/// Works out what one connection wants, then serves it. Runs on its own thread.
fn serve_connection(stream: TcpStream, page: &'static str, shared: &Shared) {
    match classify(&stream) {
        Some(Route::Video { half: false }) => video_thread(
            stream,
            &shared.viewers,
            &shared.joined,
            &shared.wants_key,
            &shared.granted_key,
        ),
        Some(Route::Video { half: true }) => video_thread(
            stream,
            &shared.half_viewers,
            &shared.half_joined,
            &shared.half_wants_key,
            &shared.half_granted_key,
        ),
        Some(Route::Sound) => sound_thread(stream, &shared.listeners),
        Some(Route::Input { take }) => input_thread(stream, shared, take),
        Some(Route::Roms) => serve_body(stream, &shared.catalogue, "application/json"),
        Some(Route::Clip) => serve_clip(stream, shared),
        Some(Route::Art(index)) => match shared.art.get(index).and_then(Option::as_ref) {
            Some(png) => serve_bytes(stream, png, "image/png"),
            None => serve_missing(stream),
        },
        Some(Route::Page { packing }) => serve_page(stream, page, packing),
        None => {}
    }
}

/// Les en-têtes qui ne dépendent pas de la page.
///
/// `style-src` garde `'unsafe-inline'`, et ce n'est pas un oubli: les styles de
/// React sont des ATTRIBUTS `style` posés sur des éléments, que les empreintes
/// ne couvrent pas. Prétendre le contraire serait la seule chose pire qu'une
/// règle faible: une règle faible qu'on croit forte.
const HARDENING: &str = concat!(
    "X-Content-Type-Options: nosniff\r\n",
    "Referrer-Policy: no-referrer\r\n",
);

impl Packing {
    /// Ce que ce client accepte, lu sur son en-tête plutôt que dans sa requête
    /// entière.
    ///
    /// La version d'avant cherchait « gzip » n'importe où dans le texte de la
    /// requête, donc un chemin ou un agent qui contenait ces quatre lettres
    /// suffisait à déclencher une compression que personne n'avait demandée.
    /// Personne ne l'a jamais remarqué parce que tous les navigateurs
    /// l'acceptent; ça restait une lecture qui devine.
    ///
    /// Brotli d'abord quand les deux sont offerts: c'est le plus petit, et tout
    /// navigateur qui connaît brotli connaît gzip.
    fn wanted(text: &str) -> Self {
        let Some(line) = text
            .lines()
            .find_map(|line| line.strip_prefix("accept-encoding:"))
        else {
            return Self::Raw;
        };
        let offered: Vec<&str> = line
            .split(',')
            .map(|token| token.split(';').next().unwrap_or("").trim())
            .collect();
        if offered.contains(&"br") {
            Self::Brotli
        } else if offered.contains(&"gzip") {
            Self::Gzip
        } else {
            Self::Raw
        }
    }

    /// Le nom que l'en-tête de réponse porte, ou rien pour une page brute.
    const fn header(self) -> &'static str {
        match self {
            Self::Raw => "",
            Self::Gzip => "Content-Encoding: gzip\r\n",
            Self::Brotli => "Content-Encoding: br\r\n",
        }
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use std::io::{Read as _, Write as _};
    use std::sync::mpsc::sync_channel;

    use nel3ab_protocol::{Command, Echo};

    use super::harness::*;
    use super::*;

    /// Les deux flux ne se mélangent jamais.
    ///
    /// C'est l'invariant qui compte, parce que le rater ne donne pas une erreur:
    /// un décodeur qui reçoit une image d'une autre taille, référencée sur des
    /// images qu'il n'a pas, rend une bouillie ou rien du tout. Et ça
    /// n'arriverait qu'à celui qui vient de changer de format.
    #[test]
    fn a_frame_of_one_stream_never_reaches_a_viewer_of_the_other() {
        let (full, full_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let (half, half_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![full]);
        server.half_viewers.lock().unwrap().push(Viewer {
            pipe: half,
            resyncing: false,
        });

        assert!(server.send(&frame()));
        assert!(full_held.try_recv().is_ok(), "le grand format a reçu");
        assert!(
            half_held.try_recv().is_err(),
            "le demi-format a reçu une image du grand"
        );

        assert!(server.send_half(&frame()));
        assert!(half_held.try_recv().is_ok(), "le demi-format a reçu");
        assert!(
            full_held.try_recv().is_err(),
            "le grand format a reçu une image du petit"
        );

        assert_eq!(server.watchers(), 1);
        assert_eq!(server.half_watchers(), 1);
    }

    /// Et une demande d'image-clé ne traverse pas non plus.
    ///
    /// Le jumeau du dessus, sur l'autre canal. Une clé du grand format ne
    /// répare pas le petit: ce sont deux suites d'images sans rapport, et
    /// partager le drapeau donnerait au demandeur une clé qui ne lui sert à
    /// rien pendant que l'autre flux en fabrique une pour personne.
    #[test]
    fn a_key_frame_asked_for_on_one_stream_is_not_owed_on_the_other() {
        let (full, full_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![full]);

        // La file du grand format déborde sur une image ordinaire, ce qui casse
        // sa chaîne et lui fait demander une clé.
        for _ in 0..=OUTGOING_DEPTH {
            let _ = server.send(&delta());
        }
        drop(full_held);

        assert!(server.take_key_frame_request(), "le grand en a demandé une");
        assert!(
            !server.take_half_key_frame_request(),
            "le demi-format n'a rien demandé"
        );
    }

    /// Routing a picture is not serving one.
    ///
    /// The table above proves `classify` picks the right route; it would go on
    /// passing if the arm that answers were deleted. This one asks a real server
    /// over a real socket, and reads the bytes back.
    #[test]
    fn a_picture_is_served_and_a_missing_one_is_a_refusal_not_a_page() {
        let art: Arc<[Option<Arc<[u8]>>]> = Arc::from(vec![Some(Arc::from(&b"PNG-ish"[..])), None]);
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            art,
            PlayerSlot::new(1).unwrap(),
            &nobody(),
        )
        .unwrap();

        let ask = |path: &str| {
            let mut stream = TcpStream::connect(server.address()).unwrap();
            stream
                .write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
                .unwrap();
            stream.flush().unwrap();
            let mut answer = Vec::new();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let _ = std::io::Read::read_to_end(&mut stream, &mut answer);
            String::from_utf8_lossy(&answer).into_owned()
        };

        let found = ask("/art/0.png");
        assert!(found.starts_with("HTTP/1.1 200"), "{found}");
        assert!(found.contains("image/png"), "{found}");
        assert!(found.ends_with("PNG-ish"), "{found}");

        // The twin. A game with no picture must say no, so an `<img>` fails at
        // once and the menu draws its own fallback. Answering with the page
        // would make the browser decode an HTML document before giving up.
        let missing = ask("/art/1.png");
        assert!(missing.starts_with("HTTP/1.1 404"), "{missing}");
        // And a position that is not in the library at all, which is the same
        // answer for a different reason.
        assert!(ask("/art/9.png").starts_with("HTTP/1.1 404"));
    }

    /// Une perte sur un flux ne doit pas se voir sur le compteur de l'autre.
    ///
    /// C'est la question qu'on pose à ce compteur et pas une autre: quelqu'un
    /// passe en format réduit précisément quand sa liaison va mal, et si ses
    /// pertes tombent dans le seau commun on ne peut plus dire si le worker a dû
    /// jeter des images vers LUI ou vers quelqu'un en pleine taille. Les deux
    /// moitiés comptent, donc le test remplit un flux et vérifie l'autre.
    #[test]
    fn a_stream_that_falls_behind_does_not_stain_the_other_stream() {
        let (full, _full_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let (half, _half_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![full]);
        server.half_viewers.lock().unwrap().push(Viewer {
            pipe: half,
            resyncing: false,
        });

        // Le demi-format déborde: sa file tient deux images, on en pousse
        // quatre sans que personne ne lise.
        for _ in 0..4 {
            let _sent = server.send_half(&frame());
        }

        assert!(
            server.half_dropped() > 0,
            "le flux réduit a débordé sans que rien ne le compte"
        );
        assert_eq!(
            server.dropped(),
            0,
            "la perte du flux réduit a été portée au compte du grand format"
        );
    }

    /// Le jumeau: dans l'autre sens.
    #[test]
    fn a_full_stream_that_falls_behind_does_not_stain_the_reduced_one() {
        let (full, _full_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let (half, _half_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![full]);
        server.half_viewers.lock().unwrap().push(Viewer {
            pipe: half,
            resyncing: false,
        });

        for _ in 0..4 {
            let _sent = server.send(&frame());
        }

        assert!(server.dropped() > 0, "le grand format a débordé sans trace");
        assert_eq!(
            server.half_dropped(),
            0,
            "la perte du grand format a été portée au compte du flux réduit"
        );
    }

    /// Le jumeau: un spectateur qui suit ne perd rien et ne voit jamais ce
    /// mécanisme. C'est la propriété qui compte pour tous les autres.
    #[test]
    fn a_viewer_that_keeps_up_receives_every_frame() {
        let (sender, held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![sender]);

        for _ in 0..20 {
            assert!(server.send(&delta()));
            assert!(held.recv().is_ok());
        }
        assert_eq!(server.dropped(), 0);
    }

    /// A watcher that falls behind loses frames rather than delaying the
    /// emulator — the chain keeps its own cadence whatever the network does.
    #[test]
    fn frames_are_dropped_rather_than_queued_when_the_client_is_behind() {
        let (sender, held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![sender]);

        for _ in 0..OUTGOING_DEPTH {
            assert!(server.send(&frame()), "the queue should accept its depth");
        }
        assert!(!server.send(&frame()), "a full queue must drop, not block");
        assert_eq!(server.dropped(), 1);

        // The negative twin: draining one makes room again, so the drop was
        // backpressure rather than a channel that had died.
        drop(held.recv().unwrap());
        assert!(server.send(&frame()));
        assert_eq!(
            server.dropped(),
            1,
            "an accepted frame must not count as dropped"
        );
    }

    /// The reason the single-viewer design had to go. One viewer that stops
    /// reading must cost only itself: two attempts at "one at a time" locked
    /// out whoever reloaded, then turned two reconnecting pages into a takeover
    /// war that dropped the stream twenty times in twenty-four seconds.
    #[test]
    fn a_stalled_viewer_does_not_cost_another_viewer_its_frames() {
        let (slow, _slow_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let (fast, fast_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![slow, fast]);

        // The fast one is drained every frame; the slow one never is.
        for _ in 0..20 {
            assert!(server.send(&frame()), "somebody took it");
            assert!(
                fast_held.try_recv().is_ok(),
                "the healthy viewer got its frame"
            );
        }
        assert_eq!(server.watchers(), 2, "neither viewer was forgotten");
        assert!(
            server.dropped() >= 18,
            "the stalled viewer should be losing frames, and only it"
        );
    }

    /// Le plafond de connexions existait sans qu'aucun test ne le tienne: je
    /// l'ai supprimé le 19 août 2026 et toute la suite est restée verte. Un
    /// garde que personne ne vérifie est un garde qui disparaîtra au prochain
    /// remaniement.
    #[test]
    fn the_sixty_fifth_connection_is_refused() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            PlayerSlot::new(1).unwrap(),
            &nobody(),
        )
        .unwrap();

        // Des spectateurs, parce qu'un spectateur reste: son fil vit tant que sa
        // socket vit, et c'est ce que le plafond compte.
        let held: Vec<_> = (0..MAX_CONNECTIONS)
            .map(|_| watch(server.address()))
            .collect();
        assert!(
            eventually(|| server.watchers() == MAX_CONNECTIONS),
            "le serveur n'a compté que {} spectateurs sur {MAX_CONNECTIONS}",
            server.watchers()
        );

        // La suivante est acceptée par le noyau puis refermée sans un octet:
        // c'est ce que « refusée » veut dire au niveau TCP.
        let mut extra = TcpStream::connect(server.address()).unwrap();
        extra
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        extra
            .write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let mut answer = Vec::new();
        let _ = extra.read_to_end(&mut answer);
        assert!(
            answer.is_empty(),
            "la connexion en trop a reçu {} octets au lieu d'être refusée",
            answer.len()
        );

        drop(held);
    }

    /// Même histoire: la borne de quatre kilo-octets par message n'était tenue
    /// par rien. Une page envoie treize octets d'état de manette; personne n'a
    /// de raison d'en envoyer huit mille.
    #[test]
    fn a_message_over_the_ceiling_closes_the_socket() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            PlayerSlot::new(1).unwrap(),
            &nobody(),
        )
        .unwrap();
        let (mut socket, port) = hold(server.address());
        assert_eq!(port, 1);

        // D'abord une trame normale, pour prouver que la socket marchait avant.
        let one = PlayerSlot::new(1).unwrap();
        socket
            .send(tungstenite::Message::binary(
                InputFrame::neutral(one).encode().to_vec(),
            ))
            .unwrap();
        assert!(eventually(|| server.inputs_received() > 0));

        // Puis le double de la borne. Tungstenite refuse côté serveur et ferme.
        //
        // La lecture est raccourcie exprès: le fil de la manette envoie l'état
        // de la salle et la vibration, donc lire rend parfois autre chose que la
        // fermeture, et il faut pouvoir réessayer sans attendre trois secondes.
        socket
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let flood = vec![0_u8; 8 * 1024];
        let _ = socket.send(tungstenite::Message::binary(flood));

        // « Fermée » et pas « n'a rien dit »: un délai de lecture dépassé est
        // AUSSI une erreur, et une première version de ce test s'en contentait.
        // Elle passait donc aussi bien avec la borne que sans, ce qui est
        // exactement le défaut que ce test est là pour interdire.
        let mut closed = false;
        for _ in 0..8 {
            closed = match socket.read() {
                // Rien à lire pour l'instant: on réessaie, ce n'est pas une
                // fermeture.
                Err(tungstenite::Error::Io(io))
                    if matches!(
                        io.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    false
                }
                Err(_) | Ok(tungstenite::Message::Close(_)) => true,
                // La salle et la vibration passent par cette socket: en lire
                // une ne dit rien sur la borne.
                Ok(_) => false,
            };
            if closed {
                break;
            }
        }
        assert!(
            closed,
            "la socket est restée ouverte après un message hors borne"
        );
    }

    /// `max_frame_size` n'a pas son propre test, et c'est délibéré. Une trame
    /// plus grosse que la borne fait forcément un message plus gros que la même
    /// borne, donc `max_message_size` la refuse d'abord: il n'existe aucun envoi
    /// que la seconde attrape et que la première laisse passer. C'est une
    /// ceinture en plus de la bretelle, pas une règle distincte, et écrire un
    /// test qui ne peut pas la distinguer serait un test qui ment.
    #[test]
    fn the_frame_ceiling_matches_the_message_ceiling() {
        let limits = socket_limits();
        assert_eq!(limits.max_frame_size, limits.max_message_size);
        assert_eq!(limits.max_message_size, Some(4 * 1024));
    }

    /// La page ne peut pas mesurer sa latence avec l'horloge du worker: les deux
    /// ne sont pas synchronisées, et une ancre prise pour un retard avait déjà
    /// affiché moins quinze secondes. Un aller-retour se mesure sur une seule
    /// horloge, à condition que le worker rende exactement ce qu'on lui donne.
    #[test]
    fn an_echo_comes_back_byte_for_byte() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            PlayerSlot::new(1).unwrap(),
            &nobody(),
        )
        .unwrap();
        let (mut socket, _) = hold(server.address());

        let sent = Echo([9, 8, 7, 6, 5, 4, 3, 2]);
        socket
            .send(tungstenite::Message::binary(sent.encode().to_vec()))
            .unwrap();

        // La socket porte aussi l'état de la salle et la vibration, donc on lit
        // jusqu'à trouver, plutôt que de supposer que le premier message est
        // celui qu'on attend.
        let mut came_back = None;
        for _ in 0..8 {
            if let Ok(tungstenite::Message::Binary(bytes)) = socket.read()
                && let Ok(echo) = Echo::decode(&bytes)
            {
                came_back = Some(echo);
                break;
            }
        }

        assert_eq!(came_back, Some(sent));
    }

    /// Le jumeau: neuf octets sans la marque ne sont pas un aller-retour, et ne
    /// doivent donc rien faire revenir.
    #[test]
    fn nine_bytes_without_the_mark_bring_nothing_back() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            PlayerSlot::new(1).unwrap(),
            &nobody(),
        )
        .unwrap();
        let (mut socket, _) = hold(server.address());
        socket
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(300)))
            .unwrap();

        socket
            .send(tungstenite::Message::binary(vec![0x11_u8; Echo::LEN]))
            .unwrap();

        for _ in 0..4 {
            if let Ok(tungstenite::Message::Binary(bytes)) = socket.read() {
                assert!(
                    Echo::decode(&bytes).is_err(),
                    "un écho est revenu: {bytes:?}"
                );
            }
        }
    }

    /// A page that is merely OPEN holds a port: it sends the neutral pad state
    /// sixty times a second whether anybody is playing or not. A tab forgotten on
    /// another machine kept the only controller of a one-player room while its
    /// owner pressed keys into a page that had none — so a person must be able to
    /// take it back.
    #[test]
    fn a_player_can_take_the_controller_from_a_forgotten_page() {
        let one = PlayerSlot::new(1).unwrap();
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            one,
            &nobody(),
        )
        .unwrap();
        let (mut forgotten, port) = hold(server.address());
        assert_eq!(port, 1);

        let (_taken, took) = insist_on(server.address(), 1);
        assert_eq!(took, 1, "the insisting page got the port");

        // And the page it was taken from is TOLD, rather than left believing it
        // still drives the game. It can take a whole ping interval: a page that
        // is playing reads sixty times a second and learns within a frame, but a
        // FORGOTTEN one sends nothing, so its thread is sitting in a read that
        // only returns when the ping deadline expires. The port itself changed
        // hands immediately — this is only how long the loser takes to hear it.
        forgotten
            .get_ref()
            .set_read_timeout(Some(PING_EVERY + Duration::from_secs(3)))
            .unwrap();
        // Skipping the ping the server sends when a socket goes quiet: this Rust
        // client is handed control frames, where a browser's WebSocket never
        // shows them to the page at all.
        let told = loop {
            if let tungstenite::Message::Binary(bytes) = forgotten.read().unwrap() {
                break bytes;
            }
        };
        assert_eq!(
            told[1], 0,
            "the replaced page was told it has no controller"
        );
    }

    /// A person clicking the third socket gets the third port, not the next free
    /// one. The whole point of drawing four sockets is that they can be chosen:
    /// two players who want to be P1 and P3 cannot get there by arriving in the
    /// right order.
    #[test]
    fn a_named_port_is_the_port_you_get() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let (_third, took) = insist_on(server.address(), 3);
        assert_eq!(took, 3, "asked for the third socket");

        let (_first, next) = hold(server.address());
        assert_eq!(next, 1, "the free ports were not disturbed");
    }

    /// A port this room does not serve is not a port. Asking for it must not
    /// invent one: a one-player room has one socket whatever a request says.
    #[test]
    fn a_port_the_room_does_not_serve_is_refused() {
        let one = PlayerSlot::new(1).unwrap();
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            one,
            &nobody(),
        )
        .unwrap();
        let (_held, port) = insist_on(server.address(), 4);
        assert_eq!(port, 1, "a room of one gave out its only port");
    }

    /// Every page is told when the room changes, or the sockets it draws are a
    /// picture of the moment it connected and nothing after.
    #[test]
    fn a_page_is_told_when_somebody_else_plugs_in() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let (mut first, mine) = hold(server.address());
        assert_eq!(mine, 1);

        let (_second, other) = hold(server.address());
        assert_eq!(other, 2);

        first
            .get_ref()
            .set_read_timeout(Some(PING_EVERY + Duration::from_secs(2)))
            .unwrap();
        // Bounded, because the failure this guards against is an update that
        // never comes. An unbounded read loop would swallow pings for ever
        // instead of failing, and a test that hangs says nothing at all — which
        // is exactly what it did when the update was disabled on purpose.
        let deadline = std::time::Instant::now() + PING_EVERY + Duration::from_secs(3);
        let mut update = None;
        while std::time::Instant::now() < deadline && update.is_none() {
            match first.read() {
                Ok(tungstenite::Message::Binary(bytes))
                    if bytes.len() == 2 + PORTS && bytes[3] == 1 =>
                {
                    update = Some(bytes);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let update = update.expect("the page was never told that port 2 filled");
        assert_eq!(update[0], 4, "four ports in this room");
        assert_eq!(update[1], 1, "still mine");
        assert_eq!(update[2], 1, "port 1 is held");
        assert_eq!(update[3], 1, "port 2 filled while we watched");
        assert_eq!(update[4], 0, "port 3 is free");
    }

    /// The negative twin: without asking, a newcomer is still refused. Taking a
    /// controller has to be a decision somebody made, or two open pages would
    /// trade it back and forth for ever — which is exactly what happened when
    /// the same "newest wins" rule was tried on the video socket.
    #[test]
    fn a_newcomer_that_does_not_insist_is_still_refused() {
        let one = PlayerSlot::new(1).unwrap();
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            one,
            &nobody(),
        )
        .unwrap();
        let (_holder, port) = hold(server.address());
        assert_eq!(port, 1);

        let (_polite, refused) = hold(server.address());
        assert_eq!(refused, 0, "a newcomer takes nothing by simply arriving");
    }

    /// A connection that says nothing must not hold up the next one.
    ///
    /// Classifying a connection means reading from it, and reading can wait. It
    /// used to happen on the accept thread: three sockets that connected and
    /// stayed silent delayed a page by 15.7 seconds, five per socket, and
    /// opening sockets is free. Browsers do it by accident with speculative
    /// connections; anybody who can reach the port can do it on purpose.
    #[test]
    fn a_silent_connection_does_not_hold_up_the_next_one() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let address = server.address();

        let _silent: Vec<TcpStream> = (0..3)
            .filter_map(|_| TcpStream::connect(address).ok())
            .collect();

        let started = std::time::Instant::now();
        let mut page = TcpStream::connect(address).unwrap();
        page.set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        page.write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            .unwrap();
        let mut head = [0_u8; 16];
        page.read_exact(&mut head).unwrap();
        let waited = started.elapsed();

        assert!(head.starts_with(b"HTTP/1.1 200"), "not a page: {head:?}");
        assert!(
            waited < CLASSIFY_TIMEOUT,
            "the page waited {waited:?} behind three silent sockets"
        );
    }

    /// One byte asks for a key frame, which is five or six times the size of an
    /// ordinary picture and goes to every viewer. Unlimited, that is an
    /// amplifier for anybody who can open the socket.
    /// Le propriétaire décide, et la règle vit dans le WORKER.
    ///
    /// Rouge d'abord: sans le contrôle dans `obey`, la première assertion passe
    /// et la salle change de jeu sur l'ordre de n'importe qui. Le pilote de
    /// navigateur ne pouvait pas l'attraper, parce qu'une page qui n'offre pas
    /// le bouton n'envoie pas l'octet — c'est précisément la console de
    /// développeur qu'on essaie de fermer.
    #[test]
    fn only_the_owner_may_change_the_game() {
        let owner: crate::control::OwnerSeat = Arc::new(Mutex::new(None));
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &owner,
        )
        .unwrap();
        let address = server.address();

        let (mut first, one) = hold(address);
        let (mut second, two) = hold(address);
        assert_eq!((one, two), (1, 2), "the room hands out ports in order");

        // La place 1 décide.
        *owner.lock().unwrap() = Some(PlayerSlot::new(1).unwrap());

        // Le joueur 2 demande: rien ne doit bouger, et il garde sa manette.
        second
            .send(tungstenite::Message::binary(
                Command::SwitchRom { index: 3 }.encode().to_vec(),
            ))
            .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(
            server.take_rom_request(),
            None,
            "a player who does not own the room must not change the game"
        );
        second
            .send(tungstenite::Message::binary(
                InputFrame::neutral(PlayerSlot::new(2).unwrap())
                    .encode()
                    .to_vec(),
            ))
            .expect("refusing an order must not hang up on the player");

        // Le jumeau positif: le propriétaire, lui, est obéi. Sans lui, un
        // `obey` qui refuserait TOUT passerait l'assertion du dessus.
        first
            .send(tungstenite::Message::binary(
                Command::SwitchRom { index: 3 }.encode().to_vec(),
            ))
            .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        assert_eq!(server.take_rom_request(), Some(3));
    }

    /// Four browsers, four ports, in the order they arrived.
    #[test]
    fn each_browser_is_given_its_own_port() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let held: Vec<_> = (0..4).map(|_| hold(server.address())).collect();
        let ports: Vec<u8> = held.iter().map(|(_, port)| *port).collect();
        assert_eq!(
            ports,
            vec![1, 2, 3, 4],
            "each browser got a port of its own"
        );
    }

    /// The negative twin of the assignment: a port that is given back must be
    /// given out again. Without releasing, a player reconnecting once per
    /// session would exhaust a four-player room in four reloads.
    #[test]
    fn a_port_is_free_again_once_its_browser_leaves() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let (first, port) = hold(server.address());
        assert_eq!(port, 1);
        drop(first);

        // The thread notices the close on its own read, which is not instant.
        let mut regained = 0;
        for _ in 0..40 {
            std::thread::sleep(Duration::from_millis(50));
            let (socket, port) = hold(server.address());
            regained = port;
            drop(socket);
            if regained == 1 {
                break;
            }
        }
        assert_eq!(regained, 1, "the freed port was handed out again");
    }

    /// A room of one says so rather than silently handing out a second pad: two
    /// browsers on one port would fight over the same character.
    #[test]
    fn a_full_room_turns_the_next_browser_away() {
        let one = PlayerSlot::new(1).unwrap();
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            one,
            &nobody(),
        )
        .unwrap();
        let (_held, port) = hold(server.address());
        assert_eq!(port, 1);

        let (_turned_away, port) = hold(server.address());
        assert_eq!(port, 0, "zero is how a full room says no");
    }

    /// A page cannot play somebody else's character. The frame carries a port
    /// because the protocol is symmetric, but the SERVER decides which one it
    /// was: a check that rejects a wrong port is a check that can be forgotten,
    /// and overwriting cannot.
    #[test]
    fn a_browser_cannot_move_another_players_pad() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let (_first, first_port) = hold(server.address());
        let (mut second, second_port) = hold(server.address());
        assert_eq!((first_port, second_port), (1, 2));

        // The second browser claims to be the first, and presses something.
        let mut lie = InputFrame::neutral(PlayerSlot::new(1).unwrap());
        lie.main.x = i16::MAX;
        second
            .send(tungstenite::Message::binary(lie.encode().to_vec()))
            .unwrap();

        let mut landed = Vec::new();
        for _ in 0..40 {
            landed = server.drain_input();
            if !landed.is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert_eq!(landed.len(), 1, "one pad state landed");
        assert_eq!(
            landed[0].slot.get(),
            2,
            "the lie was applied to the liar's own port"
        );
    }

    /// Silence on a controller is not a controller that has left. This test
    /// costs six seconds of wall clock because a timeout is the thing being
    /// observed, and there is no way to observe one without waiting for it.
    #[test]
    fn a_player_who_presses_nothing_keeps_their_port() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let (mut quiet, port) = hold(server.address());
        assert_eq!(port, 1);

        std::thread::sleep(CLASSIFY_TIMEOUT + Duration::from_secs(1));

        // Still theirs: a newcomer gets the NEXT port, not this one.
        let (_newcomer, next) = hold(server.address());
        assert_eq!(next, 2, "the quiet player's port was given away");

        // And the connection still works, rather than merely being remembered.
        let mut pressed = InputFrame::neutral(PlayerSlot::new(1).unwrap());
        pressed.l = 255;
        quiet
            .send(tungstenite::Message::binary(pressed.encode().to_vec()))
            .unwrap();
        let mut landed = Vec::new();
        for _ in 0..40 {
            landed = server.drain_input();
            if landed.iter().any(|frame| frame.l == 255) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(
            landed
                .iter()
                .any(|frame| frame.l == 255 && frame.slot.get() == 1),
            "the quiet player's next press should still arrive"
        );
    }

    /// The other half of the seat question, and the one that locked a player out
    /// of his own room for an evening: a socket the proxy is holding open for a
    /// browser that has GONE must give its port back.
    ///
    /// Simulated the only way it happens in the wild — the handshake completes,
    /// then nothing ever answers again. The kernel keeps acknowledging, so every
    /// write still succeeds; only the absence of a reply distinguishes this from
    /// a player who is thinking. It costs `GONE_AFTER` of wall clock for the same
    /// reason the quiet-player test costs six seconds.
    #[test]
    fn a_socket_with_nobody_behind_it_gives_its_port_back() {
        use tungstenite::client::IntoClientRequest as _;
        let one = PlayerSlot::new(1).unwrap();
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            one,
            &nobody(),
        )
        .unwrap();
        let address = server.address();

        // A client that finishes the handshake and then never reads again: it
        // cannot answer a ping, because answering is `read`'s job.
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let (mut ghost, _) = tungstenite::client(
            format!("ws://{address}/input")
                .as_str()
                .into_client_request()
                .unwrap(),
            stream,
        )
        .unwrap();
        assert_eq!(
            ghost.read().unwrap().into_data()[0],
            1,
            "the ghost took the only port"
        );

        // While it is still answering nothing, the room really is full.
        let (_turned_away, refused) = hold(address);
        assert_eq!(refused, 0, "the port is held while the ghost is fresh");

        let deadline = std::time::Instant::now() + GONE_AFTER + Duration::from_secs(5);
        let mut given_back = 0;
        while std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(500));
            let (socket, port) = hold(address);
            given_back = port;
            drop(socket);
            if given_back == 1 {
                break;
            }
        }
        assert_eq!(given_back, 1, "the ghost's port was never given back");
        drop(ghost);
    }

    /// The emulator goes quiet legitimately — a game blanking the screen
    /// presents nothing — and the page gives up after two seconds of silence.
    /// The stream's cadence has to be the server's, not the emulator's.
    #[test]
    fn a_viewer_hears_from_the_server_even_when_the_emulator_says_nothing() {
        let server = BrowserServer::start(
            "127.0.0.1:0".parse().unwrap(),
            "page",
            "[]".into(),
            no_art(),
            four(),
            &nobody(),
        )
        .unwrap();
        let mut socket = watch(server.address());

        // Not one frame is sent for the whole of this test.
        let heard = socket.read().unwrap();
        assert_eq!(
            heard.len(),
            0,
            "silence should be broken by a keep-alive, and a keep-alive is empty"
        );
    }

    /// The negative twin: a keep-alive fills a GAP, so a stream with no gaps
    /// must carry none. Without this, sending one on every pass would satisfy
    /// the test above and quietly double the message rate.
    #[test]
    fn a_stream_that_never_pauses_carries_no_keep_alives() {
        let server = Arc::new(
            BrowserServer::start(
                "127.0.0.1:0".parse().unwrap(),
                "page",
                "[]".into(),
                no_art(),
                four(),
                &nobody(),
            )
            .unwrap(),
        );
        let mut socket = watch(server.address());

        // A frame every 50 ms — ten times inside the keep-alive window — for
        // longer than the reader below needs.
        let feeding = std::thread::spawn({
            let server = Arc::clone(&server);
            move || {
                for _ in 0..40 {
                    let _ = server.send(&frame());
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        });

        for index in 0..20 {
            let message = socket.read().unwrap();
            assert!(
                !message.is_empty(),
                "message {index} was a keep-alive, in a stream that never paused"
            );
        }
        feeding.join().unwrap();
    }

    /// Every viewer is handed the SAME buffer, not a copy of it.
    ///
    /// Byte equality cannot catch the mistake this pins: a version that framed
    /// the picture once per viewer would send identical bytes and pass. Pointer
    /// identity is what says "framed once", which is what the fan-out claimed to
    /// do and did not, for as long as the sending thread cloned the `Vec`.
    #[test]
    fn every_viewer_is_handed_the_same_buffer() {
        let (first, first_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let (second, second_held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![first, second]);
        assert!(server.send(&frame()));

        let one = first_held.try_recv().unwrap();
        let two = second_held.try_recv().unwrap();
        assert_eq!(one, two, "the two viewers were sent different bytes");
        assert_eq!(
            one.as_ptr(),
            two.as_ptr(),
            "the picture was framed twice: the fan-out is copying per viewer"
        );
    }

    /// A viewer whose thread has ended is forgotten, so the list does not grow
    /// across a session's reconnections.
    #[test]
    fn a_departed_viewer_is_forgotten() {
        let (sender, held) = sync_channel::<Framed>(OUTGOING_DEPTH);
        let server = detached(vec![sender]);
        assert!(server.send(&frame()));

        drop(held);
        assert!(!server.send(&frame()), "nobody is left to take it");
        assert_eq!(server.watchers(), 0);
        assert!(!server.is_watched());
    }

    /// A pad is a level: the newest state for a port replaces the older one
    /// rather than queuing behind it.
    ///
    /// The queue this replaced logged "the input queue is full" 1073 times in
    /// five minutes — noise that would hide a real fault, for states that could
    /// never have been applied anyway.
    #[test]
    fn a_newer_pad_state_replaces_the_one_nobody_read() {
        use nel3ab_protocol::{Buttons, PlayerSlot};

        let server = detached(Vec::new());
        let slots = Arc::clone(&server.incoming);
        let one = PlayerSlot::new(1).unwrap();
        let two = PlayerSlot::new(2).unwrap();
        let with = |slot, buttons| InputFrame {
            buttons,
            ..InputFrame::neutral(slot)
        };

        for buttons in [Buttons::A, Buttons::B, Buttons::START] {
            slots.lock().unwrap()[one.index()] = Some(with(one, buttons));
        }
        slots.lock().unwrap()[two.index()] = Some(with(two, Buttons::Z));

        let mut taken = server.drain_input();
        taken.sort_by_key(|frame| frame.slot.get());
        assert_eq!(taken.len(), 2, "one per port, not one per arrival");
        assert_eq!(taken[0].buttons, Buttons::START, "the newest state won");
        assert_eq!(taken[1].buttons, Buttons::Z, "the other port is untouched");

        // Taking clears: a client that goes quiet reports nothing rather than
        // the same state forever.
        assert!(server.drain_input().is_empty());
    }

    /// The wait returns as soon as a frame lands, not on a schedule — which is
    /// the whole point: writing on the frame loop's schedule cost a full frame
    /// period, measured.
    #[test]
    fn waiting_for_input_returns_the_moment_one_arrives() {
        use nel3ab_protocol::{Buttons, PlayerSlot};

        let server = detached(Vec::new());
        let slots = Arc::clone(&server.incoming);
        let arrived = Arc::clone(&server.arrived);
        let one = PlayerSlot::new(1).unwrap();

        let writer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            slots.lock().unwrap()[one.index()] = Some(InputFrame {
                buttons: Buttons::A,
                ..InputFrame::neutral(one)
            });
            arrived.notify_one();
        });

        let started = std::time::Instant::now();
        let taken = server.wait_input(Duration::from_secs(5));
        let waited = started.elapsed();
        writer.join().unwrap();

        assert_eq!(taken.len(), 1, "the frame should have been taken");
        assert_eq!(taken[0].buttons, Buttons::A);
        assert!(
            waited < Duration::from_millis(500),
            "woken by the arrival, not by the timeout — waited {waited:?}"
        );
    }

    /// The negative twin: nothing arriving means an empty return at the
    /// deadline, not a hang.
    #[test]
    fn waiting_for_input_gives_up_at_the_deadline() {
        let server = detached(Vec::new());
        let started = std::time::Instant::now();
        let taken = server.wait_input(Duration::from_millis(120));
        assert!(taken.is_empty());
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    /// The negative twin, and the bug that produced it: with nobody watching,
    /// offering a frame must be a no-op — not a drop. The worker reported
    /// **15 001 drops out of 15 003 frames** on a run no browser ever joined.
    #[test]
    fn an_empty_room_is_not_a_dropped_frame() {
        let server = detached(Vec::new());
        for _ in 0..1000 {
            assert!(!server.send(&frame()));
        }
        assert_eq!(
            server.dropped(),
            0,
            "an empty room must not look like congestion"
        );
        assert!(!server.is_watched());
    }
}
