//! The browser end: H.264 out, pad state back.
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
use std::sync::mpsc::{RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use nel3ab_protocol::{Command, Echo, InputFrame, PlayerSlot};
use thiserror::Error;

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

/// One connected viewer: its queue, and whether its stream is currently broken.
#[derive(Debug)]
struct Viewer {
    pipe: SyncSender<Framed>,
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
    resyncing: bool,
}

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
    /// handshake comes from a page this server served (see [`same_origin`]), and
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
    pub fn start(
        address: SocketAddr,
        page: &'static str,
        catalogue: Arc<str>,
        art: Arc<[Option<Arc<[u8]>>]>,
        players: PlayerSlot,
        owner: &crate::control::OwnerSeat,
    ) -> Result<Self, TransportError> {
        let listener = TcpListener::bind(address)
            .map_err(|source| TransportError::Bind { address, source })?;
        let bound = listener
            .local_addr()
            .map_err(|source| TransportError::Accept { source })?;

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
        deliver(&self.viewers, &self.dropped, &self.wants_key, packet)
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

/// Hands one access unit to every viewer of one stream.
///
/// Written once and called for both streams: la politique de resynchronisation
/// juste en dessous est délicate, et deux copies qui divergent donneraient un
/// flux réparé et un flux cassé sans que rien ne le dise.
fn deliver(
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
fn ask_for_key_frame(
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
        Some(Route::Art(index)) => match shared.art.get(index).and_then(Option::as_ref) {
            Some(png) => serve_bytes(stream, png, "image/png"),
            None => serve_missing(stream),
        },
        Some(Route::Page { packing }) => serve_page(stream, page, packing),
        None => {}
    }
}

/// The port named by `take=N` in a request line, if any is.
fn take_from(request: &str) -> Option<PlayerSlot> {
    let rest = request.split("take=").nth(1)?;
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    PlayerSlot::new(digits.parse().ok()?).ok()
}

/// What a connection turned out to be.
enum Route {
    /// One game's picture, asked for by its position in the library.
    ///
    /// By position and never by name, for the reason the library itself gives:
    /// a position can only ever select something this worker found, so no
    /// spelling of a path can reach a file it did not offer.
    Art(usize),
    /// La vidéo, et LEQUEL des deux flux.
    ///
    /// `/video` donne la pleine taille, `/video?half=1` le demi-format. Un
    /// paramètre et pas un second chemin, pour la même raison que `?take=` sur
    /// la manette: le souhait voyage avec la demande plutôt que d'être deviné.
    Video {
        /// Vrai pour le flux réduit.
        half: bool,
    },
    Sound,
    Input {
        take: Option<PlayerSlot>,
    },
    /// The room's library, as JSON. A plain `GET`, because listing what is
    /// there changes nothing — and because a page that can be fetched can be
    /// looked at with `curl` when it misbehaves.
    Roms,
    Page {
        /// La compression que ce client a dite accepter.
        packing: Packing,
    },
}

/// Whether a handshake came from a page this server itself served.
///
/// A `WebSocket` is NOT subject to the same-origin policy: any page in any tab
/// can open one to any host the browser can reach, and read what comes back.
/// Measured on this machine before the check existed — a raw handshake declaring
/// `Origin: https://un-site-quelconque.example` was answered `101 Switching
/// Protocols` and handed 32 KiB of live video.
///
/// That matters more here than the missing authentication it resembles, because
/// it defeats the one thing that WAS protecting the room. The tailnet stops a
/// stranger connecting; it does not stop a stranger's PAGE using the browser of
/// somebody who is already on it.
///
/// The rule compares `Origin` against `Host` rather than an allow-list, so it
/// configures itself: the page is served by this same server, so its origin is
/// whatever host it was fetched from. Through the Tailscale proxy that is
/// `salle.exemple.ts.net:8443` on both headers; locally it is `localhost:8100`
/// on both. An allow-list would be one more place to update when the address
/// changes, and the failure mode of forgetting is a room nobody can join.
///
/// **An absent `Origin` is allowed, and that is deliberate.** A browser always
/// sends one; a native client — the benchmark harness, a test script — sends
/// none. Rejecting those would close the harness without closing anything a
/// browser can do. What actually bounds the non-browser case is the listening
/// address: bound to loopback, the only things that can reach it are local
/// processes and the proxy.
fn same_origin(head: &str) -> bool {
    let field = |name: &str| {
        head.lines()
            .find_map(|line| line.strip_prefix(name))
            .map(|value| value.trim().to_owned())
    };
    let Some(origin) = field("origin:") else {
        return true;
    };
    // `null` is what a sandboxed iframe sends. It is not this server.
    let Some(host) = field("host:") else {
        return false;
    };
    // Scheme off, and nothing else: `Origin` carries no path by definition, so
    // what is left is exactly the authority to compare.
    origin
        .split_once("://")
        .is_some_and(|(_, authority)| authority == host)
}

/// Reads the request head **without consuming it**, so tungstenite can do the
/// handshake itself afterwards.
fn classify(stream: &TcpStream) -> Option<Route> {
    let mut head = [0_u8; 1024];
    // A short peek is enough: the request line and the Upgrade header are both
    // in the first kilobyte of anything a browser sends.
    //
    // NAMED, because it does not stay here: the deadline is set on the SOCKET,
    // so every route inherits it and has to say what it wants instead.
    if stream.set_read_timeout(Some(CLASSIFY_TIMEOUT)).is_err() {
        return None;
    }
    let read = stream.peek(&mut head).ok()?;
    let text = String::from_utf8_lossy(&head[..read]).to_lowercase();
    if !text.contains("upgrade: websocket") {
        // Before the catch-all, or both would be served the HTML page.
        if text.starts_with("get /roms") {
            return Some(Route::Roms);
        }
        let packing = Packing::wanted(&text);
        return Some(art_from(&text).map_or(Route::Page { packing }, Route::Art));
    }
    // Checked once, here, rather than in each of the three socket routes: a
    // check that has to be repeated is a check somebody adds a fourth route
    // without. The page itself is not covered because reading it cross-origin
    // gains nothing — it is the same bytes anybody can fetch.
    if !same_origin(&text) {
        tracing::warn!("a websocket handshake came from another origin, refusing it");
        return None;
    }
    if text.starts_with("get /video") {
        return Some(Route::Video {
            half: text.contains("half=1"),
        });
    }
    if text.starts_with("get /sound") {
        return Some(Route::Sound);
    }
    if text.starts_with("get /input") {
        // `/input?take=3` asks for THAT port, occupied or not. Only a person can
        // send it — the page has four sockets drawn on it and this is what
        // clicking one does — so the wish travels with the request rather than
        // being guessed at from the state of the room.
        return Some(Route::Input {
            take: take_from(&text),
        });
    }
    None
}

/// Reads `/art/<n>.png` out of a request line.
///
/// Strict on purpose. Anything that is not exactly a number between `/art/` and
/// `.png` falls through to the page, which is what every other unknown path
/// does: a route that accepted `/art/x.png` would have to decide what to do with
/// it, and there is nothing right to decide.
fn art_from(text: &str) -> Option<usize> {
    text.strip_prefix("get /art/")?
        .split_whitespace()
        .next()?
        .strip_suffix(".png")?
        .parse()
        .ok()
}

/// Sends bytes that are not text.
///
/// Cached for five minutes, unlike everything else here, and the number has a
/// reason on each side. Without any cache the browser refetches eight pictures
/// every time the menu opens, and each one flashes as it arrives. Cached for
/// ever, a game dropped into the folder would show the previous occupant of its
/// position until somebody emptied the cache by hand.
fn serve_bytes(mut stream: TcpStream, body: &[u8], content_type: &str) {
    let head = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n\
         Content-Length: {}\r\nCache-Control: max-age=300\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// Says no, for a picture this room does not have.
///
/// A real 404 rather than the page, so an `<img>` fails cleanly and the menu
/// draws its fallback. Served the HTML instead, the browser would report a
/// broken image only after decoding a page.
fn serve_missing(mut stream: TcpStream) {
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream
        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    let _ = stream.flush();
}

/// Cette unité d'accès contient-elle une image-clé ?
///
/// On cherche un NAL de type 5 (`IDR`) parmi ceux que sépare un code de départ.
/// Le type est dans les cinq bits de poids faible du premier octet du NAL.
///
/// Écrit ici plutôt que déduit de « on vient de demander une clé »: le worker
/// demande, l'encodeur décide, et les deux ne sont pas au même moment.
fn carries_key_frame(annex_b: &[u8]) -> bool {
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

/// La page servie: compressée quand le client sait la lire, et étiquetée.
///
/// # Ce que ça change, mesuré
///
/// 424 Kio non compressée contre 128 en gzip. C'est exactement la personne dont
/// la liaison va mal qui paie ces trois cent kilo-octets, et c'est celle qu'on
/// passe son temps à essayer d'aider.
///
/// La compression se fait UNE fois, au premier appel, et pas à chaque requête:
/// la page ne change pas pendant qu'un worker tourne, puisqu'elle est compilée
/// dans le binaire.
///
/// L'étiquette remplace un `Cache-Control: no-store` qui faisait retélécharger
/// la page entière à chaque visite. Avec `no-cache` et un `ETag`, le navigateur
/// redemande mais reçoit une réponse vide quand rien n'a changé.
/// Ce qu'on dit au navigateur en plus du contenu.
///
/// Le risque est faible et il faut le dire: le service n'écoute que sur la
/// boucle locale, le proxy est la seule porte, et la socket vérifie déjà
/// l'origine, ce qui est la protection qui compte. Ces trois lignes ne
/// remplacent rien; elles ferment ce qui reste ouvert pour rien.
///
/// Ce que `script-src` autorise: rien, sauf exactement les scripts de CETTE
/// page.
///
/// # Pourquoi une empreinte plutôt que `'unsafe-inline'`
///
/// L'en-tête portait `script-src 'self' 'unsafe-inline'`, ce qui autorise
/// n'importe quel script en ligne et retire à la règle presque tout son intérêt
/// contre l'injection. C'était la conséquence de la page en un seul fichier, et
/// ce choix reste bon.
///
/// Sauf que le contenu est FIGÉ: la page est un artefact construit puis compilé
/// dans le binaire. Son script ne changera pas d'ici le prochain démarrage, donc
/// le nommer par son empreinte transforme une règle de façade en règle réelle,
/// sans rien changer à l'architecture.
///
/// # Pourquoi calculée ici, et pas écrite à côté
///
/// Une empreinte gardée dans un fichier serait une deuxième copie à tenir
/// d'accord avec la première, et ce dépôt a déjà payé plusieurs fois pour ce
/// genre de paire. Calculée sur la page qu'on sert vraiment, elle ne peut pas
/// diverger de ce qui part sur le fil: si elle était fausse, la page ne
/// s'exécuterait pas du tout, ce qui se voit tout de suite.
///
/// Coût: une passe de SHA-256 sur 450 ko, mesurée à 0,3 ms sur cette machine,
/// et seulement quand quelqu'un charge la page. Pas de cache: un état global
/// gardé entre deux pages ne peut se tromper qu'une fois, mais il se trompe
/// alors sur toutes les suivantes, et une première version de cette fonction
/// s'est fait attraper là-dessus par ses propres tests.
fn script_policy(page: &str) -> String {
    use base64::Engine as _;
    use sha2::Digest as _;

    let mut allowed = String::from("'self'");
    let mut rest = page;
    // Le contenu de chaque `<script ...>` jusqu'à son `</script>`. Une recherche
    // de texte plutôt qu'un analyseur HTML: on cherche une balise dans un
    // fichier qu'on a construit soi-même, pas dans du HTML trouvé.
    while let Some(open) = rest.find("<script")
        && let Some(head) = rest[open..].find('>')
        && let Some(close) = rest[open + head + 1..].find("</script>")
    {
        let body = &rest[open + head + 1..open + head + 1 + close];
        let digest = sha2::Sha256::digest(body.as_bytes());
        allowed.push_str(" 'sha256-");
        allowed.push_str(&base64::engine::general_purpose::STANDARD.encode(digest));
        allowed.push('\'');
        rest = &rest[open + head + 1 + close..];
    }
    allowed
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

/// La politique complète, empreinte comprise.
///
/// Stricte parce que la page peut se le permettre: un fichier unique, sans
/// ressource externe, avec ses styles et son script à l'intérieur. Tout ce qui
/// viendrait d'ailleurs est refusé, y compris une image.
fn policy_headers(page: &str) -> String {
    format!(
        "Content-Security-Policy: default-src 'self'; script-src {}; \
         style-src 'self' 'unsafe-inline'; img-src 'self' data:; \
         connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'\r\n{HARDENING}",
        script_policy(page)
    )
}

/// Comment la page part sur le fil.
///
/// Trois états et pas deux booléens, parce que deux booléens autorisent
/// « brotli ET gzip », qui ne veut rien dire: une réponse porte un encodage.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Packing {
    /// Telle quelle. Le cas d'un client qui n'a rien demandé.
    Raw,
    Gzip,
    /// Treize pour cent de moins que gzip sur cette page, mesuré le 19 août
    /// 2026: 136 493 octets contre 117 841. Sur un lien à 400 kbit/s, la
    /// première image passe de 2,73 s à 2,36 s.
    ///
    /// Le niveau le plus élevé ne coûte rien ici, et c'est ce qui rend le choix
    /// évident: la page est un artefact FIGÉ, compilé dans le binaire, donc elle
    /// est compressée une fois au premier envoi et jamais plus.
    Brotli,
}

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

/// La page, dans l'emballage demandé.
///
/// Compressée une seule fois par emballage et gardée: la page est un artefact
/// figé compilé dans le binaire, donc le travail ne se refait jamais. C'est ce
/// qui permet de prendre le niveau brotli le plus élevé sans y penser.
fn packed(page: &str, packing: Packing) -> &[u8] {
    static ZIPPED: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    static BROTLIED: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    match packing {
        Packing::Raw => page.as_bytes(),
        Packing::Gzip => ZIPPED.get_or_init(|| {
            use flate2::{Compression, write::GzEncoder};
            let mut packer = GzEncoder::new(Vec::new(), Compression::best());
            let _ = packer.write_all(page.as_bytes());
            packer.finish().unwrap_or_else(|_| page.as_bytes().to_vec())
        }),
        Packing::Brotli => BROTLIED.get_or_init(|| {
            let mut out = Vec::new();
            let mut packer = brotli::CompressorWriter::new(&mut out, 4096, 11, 22);
            let _ = packer.write_all(page.as_bytes());
            drop(packer);
            if out.is_empty() {
                page.as_bytes().to_vec()
            } else {
                out
            }
        }),
    }
}

fn serve_page(mut stream: TcpStream, page: &str, packing: Packing) {
    let hardening = policy_headers(page);
    let tag = format!("\"{:x}\"", page_tag(page));

    // Déjà à jour chez le client: on ne renvoie rien du tout. Lu sur l'entête
    // qu'on a déjà en main, en minuscules, d'où la comparaison en minuscules.
    let mut head = [0_u8; 2048];
    let read = stream.read(&mut head).unwrap_or(0);
    let request = String::from_utf8_lossy(&head[..read]).to_lowercase();
    if request.contains(&tag.to_lowercase()) {
        let response = format!(
            "HTTP/1.1 304 Not Modified\r\nETag: {tag}\r\n\
             Cache-Control: no-cache\r\n{hardening}Connection: close\r\n\r\n"
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        return;
    }

    let body = packed(page, packing);
    // Le repli est visible: si la compression a échoué, on a rendu les octets
    // bruts, et annoncer un encodage dessus donnerait une page illisible.
    let encoding = if body.len() == page.len() {
        ""
    } else {
        packing.header()
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\n{encoding}ETag: {tag}\r\n\
         Cache-Control: no-cache\r\n{hardening}Connection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

/// Une étiquette de version pour la page, tirée de son contenu.
///
/// Un condensat rapide et non cryptographique: il ne protège rien, il distingue
/// deux versions. Deux pages différentes qui tomberaient sur la même valeur
/// serviraient une page périmée, ce qui vaut ici un rechargement manuel et non
/// une faille.
fn page_tag(page: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    page.len().hash(&mut hasher);
    page.hash(&mut hasher);
    hasher.finish()
}

fn serve_body(mut stream: TcpStream, body: &str, content_type: &str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    // The request is still unread because `classify` only peeked; draining it
    // keeps the client from seeing a reset before it has read the response.
    let mut sink = [0_u8; 2048];
    let _ = stream.read(&mut sink);
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
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
fn video_thread(
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
fn sound_thread(stream: TcpStream, listeners: &Viewers) {
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

/// Takes a port for this connection and tells the page about the room.
///
/// Which port a browser holds is the SERVER'S to decide, and the room is the
/// first thing said on the socket: a page cannot stamp its own port on a pad
/// frame — see the re-stamping in the loop — so this is how it learns.
///
/// Returns the port, the claim that proves it is still ours, and the message
/// that was sent, so the loop can tell later when the room has changed.
fn claim_a_port(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    shared: &Shared,
    take: Option<PlayerSlot>,
) -> Option<(PlayerSlot, u64, Vec<u8>)> {
    let (seats, players) = (&shared.seats, shared.players);
    let Some((seat, claim)) = take_seat(seats, players, take) else {
        tracing::info!("a browser asked for a controller in a full room");
        let _ = socket.send(tungstenite::Message::binary(room_message(
            players, None, seats,
        )));
        return None;
    };
    let told = room_message(players, Some(seat), seats);
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
fn apply_pad(
    payload: &[u8],
    seat: PlayerSlot,
    slots: &Pads,
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
fn bounce(socket: &mut tungstenite::WebSocket<TcpStream>, payload: &[u8]) -> bool {
    let Ok(echo) = Echo::decode(payload) else {
        // Neuf octets sans la marque ne sont pas un aller-retour. On se tait
        // plutôt que de renvoyer quelque chose, et la socket reste ouverte.
        return true;
    };
    socket
        .send(tungstenite::Message::binary(echo.encode().to_vec()))
        .is_ok()
}

fn input_thread(stream: TcpStream, shared: &Shared, take: Option<PlayerSlot>) {
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
                players, None, seats,
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
        match send_room(&mut socket, players, seat, seats, told) {
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
        if !apply_pad(&payload, seat, slots, received, arrived) {
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
fn obey(payload: &[u8], shared: &Shared, seat: PlayerSlot) -> bool {
    match Command::decode(payload) {
        Ok(Command::SwitchRom { index }) => {
            // Le propriétaire décide, et c'est vérifié ICI plutôt que dans la
            // page: une règle qui ne vit que dans une interface est une règle
            // qu'une console de développeur contourne en une ligne.
            //
            // Aucun propriétaire déclaré veut dire aucune règle, et la salle
            // retombe sur ce qu'elle faisait avant: tenir une manette suffit.
            // C'est le cas quand le plan de contrôle n'est pas là, et refuser
            // tout ferait une salle où plus personne ne peut rien.
            let decides = shared
                .owner
                .lock()
                .ok()
                .and_then(|held| *held)
                .is_none_or(|boss| boss == seat);
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
fn take_seat(
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
fn occupancy(seats: &Seats) -> [bool; PORTS] {
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
fn send_room(
    socket: &mut tungstenite::WebSocket<TcpStream>,
    players: PlayerSlot,
    seat: PlayerSlot,
    seats: &Seats,
    told: Vec<u8>,
) -> Result<Vec<u8>, ()> {
    let current = room_message(players, Some(seat), seats);
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
fn send_rumble(
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

fn room_message(players: PlayerSlot, mine: Option<PlayerSlot>, seats: &Seats) -> Vec<u8> {
    let mut message = Vec::with_capacity(2 + PORTS);
    message.push(players.get());
    message.push(mine.map_or(0, PlayerSlot::get));
    message.extend(occupancy(seats).into_iter().map(u8::from));
    message
}

/// Gives the port back, but only if it is still ours: a holder that was replaced
/// must not release the seat its replacement is now sitting in.
fn release_seat(seats: &Seats, seat: PlayerSlot, claim: u64) {
    if let Ok(mut seats) = seats.lock()
        && let Some(taken) = seats.get_mut(seat.index())
        && *taken == Some(claim)
    {
        *taken = None;
    }
}

/// Whether this claim still holds its port.
fn still_ours(seats: &Seats, seat: PlayerSlot, claim: u64) -> bool {
    seats
        .lock()
        .is_ok_and(|seats| seats.get(seat.index()).copied().flatten() == Some(claim))
}

fn next_claim() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Routing is decided by peeking, so the bytes must still be there for the
    /// handshake afterwards. Checked by reading them after classifying.
    #[test]
    fn classifying_a_request_does_not_consume_it() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let request = b"GET /video HTTP/1.1\r\nUpgrade: websocket\r\n\r\n";

        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(address).unwrap();
            stream.write_all(request).unwrap();
            stream.flush().unwrap();
            // Held open so the server side does not see EOF mid-test.
            std::thread::sleep(Duration::from_millis(200));
        });

        let (stream, _) = listener.accept().unwrap();
        assert!(matches!(
            classify(&stream),
            Some(Route::Video { half: false })
        ));

        let mut seen = vec![0_u8; request.len()];
        let mut stream = stream;
        stream.read_exact(&mut seen).unwrap();
        assert_eq!(seen, request, "the peek consumed the request");
        client.join().unwrap();
    }

    #[test]
    fn a_plain_request_is_a_page_and_an_unknown_upgrade_is_neither() {
        for (request, expected) in [
            (&b"GET / HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (
                &b"GET /input HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "input",
            ),
            (
                &b"GET /nope HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "none",
            ),
            (
                &b"GET /video HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video",
            ),
            (
                &b"GET /video?half=1 HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video-half",
            ),
            // Les jumeaux négatifs. Chacun donnerait le demi-format si la
            // lecture était approximative, et aucun ne le demande.
            (
                &b"GET /video?half=0 HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video",
            ),
            (
                &b"GET /video?other=1 HTTP/1.1\r\nUpgrade: websocket\r\n\r\n"[..],
                "video",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let owned = request.to_vec();
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                stream.write_all(&owned).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(200));
            });
            let (stream, _) = listener.accept().unwrap();
            let route = classify(&stream);
            let got = match route {
                Some(Route::Page { .. }) => "page",
                Some(Route::Video { half }) => {
                    if half {
                        "video-half"
                    } else {
                        "video"
                    }
                }
                Some(Route::Sound) => "sound",
                Some(Route::Input { .. }) => "input",
                Some(Route::Roms) => "roms",
                Some(Route::Art(_)) => "art",
                None => "none",
            };
            assert_eq!(got, expected, "for {}", String::from_utf8_lossy(request));
            client.join().unwrap();
        }
    }

    /// The positive case, and its negative twins.
    ///
    /// Red-first: delete the `same_origin` call in `classify` and the foreign
    /// and sandboxed cases below both pass, which is what the server did before
    /// this existed.
    #[test]
    fn a_handshake_is_taken_only_from_a_page_this_server_served() {
        // Through the Tailscale proxy: both headers carry the proxy's authority.
        assert!(same_origin(
            "host: salle.exemple.ts.net:8443\r\norigin: https://salle.exemple.ts.net:8443"
        ));
        // Locally, over plain http.
        assert!(same_origin(
            "host: localhost:8100\r\norigin: http://localhost:8100"
        ));
        // No origin at all: a native client, not a page. Allowed on purpose —
        // see the note on `same_origin`.
        assert!(same_origin("host: localhost:8100"));

        // The attack this exists for.
        assert!(!same_origin(
            "host: salle.exemple.ts.net:8443\r\norigin: https://un-site-quelconque.example"
        ));
        // A sandboxed iframe. It is not this server, so it is not us.
        assert!(!same_origin("host: localhost:8100\r\norigin: null"));
        // The same name on another port is another origin, and the browser
        // agrees: a page on :9000 must not drive the room on :8100.
        assert!(!same_origin(
            "host: localhost:8100\r\norigin: http://localhost:9000"
        ));
        // A host that merely ENDS with ours. Matching by suffix would take this.
        assert!(!same_origin(
            "host: salle.exemple.ts.net:8443\r\norigin: https://evil-salle.exemple.ts.net:8443"
        ));
    }

    /// And that the check is WIRED IN, not merely present.
    ///
    /// The test above proves `same_origin` decides correctly; it would go on
    /// passing if nobody called it. This one drives `classify` itself, so
    /// deleting the call from the routing turns it red.
    #[test]
    fn a_foreign_origin_gets_no_route_at_all() {
        for (request, routed) in [
            (
                &b"GET /video HTTP/1.1\r\nHost: localhost:8100\r\nUpgrade: websocket\r\n\r\n"[..],
                true,
            ),
            (
                &b"GET /video HTTP/1.1\r\nHost: localhost:8100\r\nOrigin: http://localhost:8100\r\nUpgrade: websocket\r\n\r\n"[..],
                true,
            ),
            (
                &b"GET /video HTTP/1.1\r\nHost: localhost:8100\r\nOrigin: https://un-site-quelconque.example\r\nUpgrade: websocket\r\n\r\n"[..],
                false,
            ),
            (
                &b"GET /input?take=1 HTTP/1.1\r\nHost: localhost:8100\r\nOrigin: https://un-site-quelconque.example\r\nUpgrade: websocket\r\n\r\n"[..],
                false,
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let owned = request.to_vec();
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                stream.write_all(&owned).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(200));
            });
            let (stream, _) = listener.accept().unwrap();
            assert_eq!(
                classify(&stream).is_some(),
                routed,
                "for {}",
                String::from_utf8_lossy(request)
            );
            client.join().unwrap();
        }
    }

    /// The library is its own route, and it is NOT the page.
    ///
    /// Red-first: move the `/roms` test after the catch-all in `classify` and
    /// this returns `Page` — which is how a browser asking for the game list
    /// would quietly receive an HTML document and parse nothing out of it.
    #[test]
    fn asking_for_the_library_is_not_asking_for_the_page() {
        for (request, expected) in [
            (&b"GET /roms HTTP/1.1\r\nHost: x\r\n\r\n"[..], "roms"),
            (&b"GET / HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            // No prefix match on anything shorter: `/rom` is not `/roms`.
            (&b"GET /rom HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/0.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "art0"),
            (&b"GET /art/12.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "art12"),
            // The negative twins. Each of these would be a picture if the
            // parsing were loose, and none of them names one.
            (&b"GET /art/x.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/3 HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (&b"GET /art/-1.png HTTP/1.1\r\nHost: x\r\n\r\n"[..], "page"),
            (
                &b"GET /art/../roms.png HTTP/1.1\r\nHost: x\r\n\r\n"[..],
                "page",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let owned = request.to_vec();
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect(address).unwrap();
                stream.write_all(&owned).unwrap();
                stream.flush().unwrap();
                std::thread::sleep(Duration::from_millis(200));
            });
            let (stream, _) = listener.accept().unwrap();
            let got = match classify(&stream) {
                Some(Route::Roms) => "roms".to_owned(),
                Some(Route::Art(index)) => format!("art{index}"),
                Some(Route::Page { .. }) => "page".to_owned(),
                _ => "other".to_owned(),
            };
            assert_eq!(got, expected, "for {}", String::from_utf8_lossy(request));
            client.join().unwrap();
        }
    }

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

    /// Builds a server with no accept loop, for tests that only exercise policy.
    fn detached(viewers: Vec<SyncSender<Framed>>) -> BrowserServer {
        BrowserServer {
            half_viewers: Arc::new(Mutex::new(Vec::new())),
            half_joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            half_wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            viewers: Arc::new(Mutex::new(
                viewers
                    .into_iter()
                    .map(|pipe| Viewer {
                        pipe,
                        resyncing: false,
                    })
                    .collect(),
            )),
            listeners: Arc::new(Mutex::new(Vec::new())),
            arrived: Arc::new(Condvar::new()),
            incoming: Arc::new(Mutex::new([None; PORTS])),
            received: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            address: "127.0.0.1:0".parse().unwrap(),
            rumbles: Arc::new(Mutex::new([0; PORTS])),
            dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            half_dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            wants_rom: Arc::new(Mutex::new(None)),
            _accept: std::thread::spawn(|| {}),
        }
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

    fn frame() -> Packet<'static> {
        Packet {
            captured_micros: 0,
            annex_b: &[0, 0, 0, 1, 0x65],
        }
    }

    /// Une image qui n'est PAS une clé: NAL de type 1.
    fn delta() -> Packet<'static> {
        Packet {
            captured_micros: 0,
            annex_b: &[0, 0, 0, 1, 0x41],
        }
    }

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

    /// A full room, for tests that are not about the room being full.
    fn four() -> PlayerSlot {
        PlayerSlot::new(4).unwrap()
    }

    /// Aucun propriétaire déclaré: la salle applique alors sa règle d'avant, où
    /// tenir une manette suffit à changer de jeu. C'est ce que ces essais
    /// vérifiaient déjà, et ce que fait une salle sans plan de contrôle.
    /// A room whose games have no pictures, which is every room in these tests:
    /// what is under test here is the serving, not the drawing.
    fn no_art() -> Arc<[Option<Arc<[u8]>>]> {
        Arc::from(Vec::new())
    }

    fn nobody() -> crate::control::OwnerSeat {
        Arc::new(Mutex::new(None))
    }

    /// Connects a real WebSocket to a real server, because keep-alives are a
    /// property of the connection thread and not of `send`.
    fn watch(address: SocketAddr) -> tungstenite::WebSocket<std::net::TcpStream> {
        use tungstenite::client::IntoClientRequest as _;

        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let (socket, _) = tungstenite::client(
            format!("ws://{address}/video")
                .as_str()
                .into_client_request()
                .unwrap(),
            stream,
        )
        .unwrap();
        socket
    }

    /// Attend qu'une condition devienne vraie, sans dormir une durée choisie au
    /// hasard. Rend faux si elle ne vient jamais.
    fn eventually(mut what: impl FnMut() -> bool) -> bool {
        for _ in 0..300 {
            if what() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        false
    }

    /// La CSP nommait `'unsafe-inline'`, ce qui autorise n'importe quel script
    /// en ligne et retire à la règle presque tout son intérêt. L'empreinte est
    /// calculée sur la page qu'on sert, donc elle ne peut pas diverger.
    #[test]
    fn the_policy_names_the_script_of_the_page_it_serves() {
        let page = "<html><script>alert(1)</script></html>";

        let policy = script_policy(page);

        assert!(policy.starts_with("'self' "), "{policy}");
        assert!(policy.contains("'sha256-"), "{policy}");
        assert!(!policy.contains("unsafe-inline"), "{policy}");
    }

    /// Le jumeau, et c'est celui qui compte: une empreinte prise sur autre chose
    /// que le contenu exact du script laisserait la page refuser de s'exécuter,
    /// ce qui est un écran noir. Vérifié contre la vraie page.
    #[test]
    fn the_hash_is_the_one_a_browser_computes() {
        use base64::Engine as _;
        use sha2::Digest as _;

        let page = include_str!("../../worker/src/page/index.html");
        let open = page.find("<script").expect("la page a un script en ligne");
        let head = page[open..].find('>').expect("la balise se ferme");
        let close = page[open + head + 1..]
            .find("</script>")
            .expect("le script se ferme");
        let body = &page[open + head + 1..open + head + 1 + close];
        let expected = base64::engine::general_purpose::STANDARD.encode(sha2::Sha256::digest(body));

        assert!(
            script_policy(page).contains(&expected),
            "l'empreinte annoncée n'est pas celle du script servi"
        );
    }

    /// Et les styles gardent `'unsafe-inline'`, délibérément: React pose des
    /// ATTRIBUTS `style`, que les empreintes ne couvrent pas. Une règle faible
    /// qu'on croit forte serait pire qu'une règle faible.
    #[test]
    fn the_style_rule_stays_honest_about_what_it_does_not_cover() {
        let headers = policy_headers("<html><script>x</script></html>");

        assert!(headers.contains("style-src 'self' 'unsafe-inline'"));
        assert!(!headers.contains("script-src 'self' 'unsafe-inline'"));
        assert!(headers.contains("frame-ancestors 'none'"));
        // Un saut de ligne au milieu couperait la réponse en deux.
        assert!(headers.ends_with("\r\n"));
        assert!(!headers.contains("\n\n"));
    }

    /// La lecture d'avant cherchait « gzip » n'importe où dans le texte de la
    /// requête, donc un chemin ou un agent qui contenait ces quatre lettres
    /// suffisait à déclencher une compression que personne n'avait demandée.
    #[test]
    fn the_encoding_is_read_on_its_own_header() {
        for (head, want) in [
            ("accept-encoding: br, gzip\r\n", Packing::Brotli),
            ("accept-encoding: gzip, deflate\r\n", Packing::Gzip),
            // Brotli d'abord quand les deux sont offerts, quelles que soient les
            // préférences annoncées: il est plus petit, et tout navigateur qui
            // connaît brotli connaît gzip.
            ("accept-encoding: gzip;q=1.0, br;q=0.5\r\n", Packing::Brotli),
            ("accept-encoding: identity\r\n", Packing::Raw),
            ("accept-encoding: \r\n", Packing::Raw),
            ("", Packing::Raw),
        ] {
            assert_eq!(Packing::wanted(head), want, "sur {head:?}");
        }
    }

    /// Le jumeau, et c'est le défaut qu'on répare: ces quatre lettres se
    /// trouvent ailleurs que dans l'en-tête qui les concerne.
    #[test]
    fn the_word_elsewhere_in_the_request_asks_for_nothing() {
        for head in [
            "get /art/gzip.png http/1.1\r\nhost: x\r\n",
            "get / http/1.1\r\nuser-agent: mon-navigateur-brotli\r\n",
            "get / http/1.1\r\nreferer: https://exemple/br\r\n",
        ] {
            assert_eq!(Packing::wanted(head), Packing::Raw, "sur {head:?}");
        }
    }

    /// Et l'emballage annoncé doit correspondre à celui qui a servi: annoncer
    /// gzip sur des octets brotli rend une page illisible, sans erreur nulle
    /// part côté serveur.
    #[test]
    fn each_packing_names_itself_and_only_itself() {
        assert_eq!(Packing::Raw.header(), "");
        assert!(Packing::Gzip.header().contains("gzip"));
        assert!(Packing::Brotli.header().contains("br"));
        assert!(!Packing::Brotli.header().contains("gzip"));
    }

    /// Brotli tient sa promesse, sur la vraie page et pas sur un exemple choisi.
    /// Mesuré le 19 août 2026: 136 493 octets en gzip contre 117 841 en brotli,
    /// soit 13,7 % de moins et 370 ms gagnés sur un lien à 400 kbit/s.
    #[test]
    fn brotli_is_smaller_than_gzip_on_the_page_we_actually_ship() {
        let page = include_str!("../../worker/src/page/index.html");

        let zipped = packed(page, Packing::Gzip).len();
        let brotlied = packed(page, Packing::Brotli).len();

        assert!(brotlied < zipped, "brotli {brotlied} contre gzip {zipped}");
        assert!(zipped < page.len());
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

    /// Takes a controller and returns the socket with the port it was given.
    fn hold(address: SocketAddr) -> (tungstenite::WebSocket<std::net::TcpStream>, u8) {
        use tungstenite::client::IntoClientRequest as _;
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let (mut socket, _) = tungstenite::client(
            format!("ws://{address}/input")
                .as_str()
                .into_client_request()
                .unwrap(),
            stream,
        )
        .unwrap();
        let told = socket.read().unwrap().into_data();
        assert_eq!(
            told.len(),
            2 + PORTS,
            "the room is announced in one message"
        );
        (socket, told[1])
    }

    /// Takes a controller, naming the port it wants.
    fn insist_on(
        address: SocketAddr,
        port: u8,
    ) -> (tungstenite::WebSocket<std::net::TcpStream>, u8) {
        use tungstenite::client::IntoClientRequest as _;
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let (mut socket, _) = tungstenite::client(
            format!("ws://{address}/input?take={port}")
                .as_str()
                .into_client_request()
                .unwrap(),
            stream,
        )
        .unwrap();
        let told = socket.read().unwrap().into_data();
        (socket, told[1])
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

    #[test]
    fn key_frames_are_granted_no_faster_than_the_limit() {
        let shared = Shared {
            viewers: Arc::new(Mutex::new(Vec::new())),
            half_viewers: Arc::new(Mutex::new(Vec::new())),
            half_joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            half_wants_key: Arc::new(std::sync::atomic::AtomicBool::new(false)),
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
