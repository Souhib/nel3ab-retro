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
use std::time::Duration;

use nel3ab_protocol::{InputFrame, PlayerSlot};
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
type Framed = Arc<Vec<u8>>;

/// The registry of connected viewers, each with its own bounded queue.
type Viewers = Arc<Mutex<Vec<SyncSender<Framed>>>>;

/// Which ports currently have a browser holding them.
///
/// Separate from [`Pads`], which holds the last STATE of each port: a port can
/// be held with nothing pressed, and a port nobody holds must not keep applying
/// the state its last holder left behind.
type Seats = Arc<Mutex<[bool; PORTS]>>;

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
pub struct Packet {
    /// Server-side capture instant, microseconds.
    pub captured_micros: u64,
    /// The Annex B access unit, exactly as the encoder produced it.
    pub annex_b: Vec<u8>,
}

/// A running server: one page, one video channel, one input channel.
#[derive(Debug)]
pub struct BrowserServer {
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
    dropped: Arc<std::sync::atomic::AtomicU64>,
    joined: Arc<std::sync::atomic::AtomicBool>,
    _accept: JoinHandle<()>,
}

impl BrowserServer {
    /// Binds and starts serving.
    ///
    /// `page` is served for any plain HTTP `GET`; the two WebSocket paths are
    /// `/video` and `/input`. Nothing here authenticates anybody — that is M4,
    /// and pretending otherwise would be worse than saying so.
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
        players: PlayerSlot,
    ) -> Result<Self, TransportError> {
        let listener = TcpListener::bind(address)
            .map_err(|source| TransportError::Bind { address, source })?;
        let bound = listener
            .local_addr()
            .map_err(|source| TransportError::Accept { source })?;

        let viewers: Viewers = Arc::new(Mutex::new(Vec::new()));
        let incoming: Pads = Arc::new(Mutex::new([None; PORTS]));
        let received = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let arrived = Arc::new(Condvar::new());
        let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let joined = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let seats: Seats = Arc::new(Mutex::new([false; PORTS]));

        let accept = std::thread::Builder::new()
            .name("browser-accept".to_owned())
            .spawn({
                let joined = Arc::clone(&joined);
                let inputs = Arc::clone(&incoming);
                let received = Arc::clone(&received);
                let viewers = Arc::clone(&viewers);
                let arrived = Arc::clone(&arrived);
                let seats = Arc::clone(&seats);
                move || {
                    accept_loop(
                        &listener,
                        page,
                        &Shared {
                            viewers,
                            inputs,
                            arrived,
                            received,
                            joined,
                            seats,
                            players,
                        },
                    );
                }
            })
            .map_err(|source| TransportError::Accept { source })?;

        tracing::info!(%bound, "browser server listening");
        Ok(Self {
            viewers,
            arrived,
            incoming,
            received,
            address: bound,
            dropped,
            joined,
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
        let Ok(mut viewers) = self.viewers.lock() else {
            return false;
        };
        if viewers.is_empty() {
            return false;
        }
        // Framed once and shared: four viewers should not cost four copies of
        // the same picture.
        let mut message = Vec::with_capacity(8 + packet.annex_b.len());
        message.extend_from_slice(&packet.captured_micros.to_le_bytes());
        message.extend_from_slice(&packet.annex_b);
        let message = Arc::new(message);

        let mut delivered = false;
        let dropped = &self.dropped;
        viewers.retain(|viewer| match viewer.try_send(Arc::clone(&message)) {
            Ok(()) => {
                delivered = true;
                true
            }
            // This viewer is behind. Its own frames are lost; the others are
            // untouched, which is the whole point of a queue each.
            Err(TrySendError::Full(_)) => {
                dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                true
            }
            // Its thread has gone. Forgetting it here is what keeps the list
            // from growing across a session's reconnections.
            Err(TrySendError::Disconnected(_)) => false,
        });
        delivered
    }

    /// How many browsers are taking the stream.
    #[must_use]
    pub fn watchers(&self) -> usize {
        self.viewers.lock().map_or(0, |viewers| viewers.len())
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
}

/// What the connection threads share with the server.
struct Shared {
    viewers: Viewers,
    inputs: Pads,
    arrived: Arc<Condvar>,
    received: Arc<std::sync::atomic::AtomicU64>,
    joined: Arc<std::sync::atomic::AtomicBool>,
    seats: Seats,
    players: PlayerSlot,
}

/// Serves pages and hands WebSocket connections to their own threads.
fn accept_loop(listener: &TcpListener, page: &'static str, shared: &Shared) {
    let mut sockets: Vec<JoinHandle<()>> = Vec::new();
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        match classify(&stream) {
            Some(Route::Video) => {
                let viewers = Arc::clone(&shared.viewers);
                let joined = Arc::clone(&shared.joined);
                sockets.push(std::thread::spawn(move || {
                    video_thread(stream, &viewers, &joined);
                }));
            }
            Some(Route::Input) => {
                let slots = Arc::clone(&shared.inputs);
                let counter = Arc::clone(&shared.received);
                let arrived = Arc::clone(&shared.arrived);
                let seats = Arc::clone(&shared.seats);
                let players = shared.players;
                sockets.push(std::thread::spawn(move || {
                    input_thread(stream, &slots, &counter, &arrived, &seats, players);
                }));
            }
            Some(Route::Page) => serve_page(stream, page),
            None => {}
        }
        // Reaped rather than joined: a client can stay for a whole session, and
        // waiting on one would stop the loop accepting the next.
        sockets.retain(|handle| !handle.is_finished());
    }
}

/// What a connection turned out to be.
enum Route {
    Video,
    Input,
    Page,
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
        return Some(Route::Page);
    }
    if text.starts_with("get /video") {
        return Some(Route::Video);
    }
    if text.starts_with("get /input") {
        return Some(Route::Input);
    }
    None
}

fn serve_page(mut stream: TcpStream, page: &'static str) {
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{page}",
        page.len()
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
fn video_thread(stream: TcpStream, viewers: &Viewers, joined: &Arc<std::sync::atomic::AtomicBool>) {
    // Nagle would hold a small frame back waiting for company. Every frame here
    // is latency-critical and self-contained, so there is nothing to gain by
    // waiting and 40 ms to lose.
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(None);
    // A write that can block forever is how a stalled client wedges a thread.
    // Two seconds is far longer than any healthy write and far shorter than a
    // session; what matters is that it is finite.
    let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
    let Ok(mut socket) = tungstenite::accept(stream) else {
        return;
    };

    let (sender, frames) = sync_channel::<Framed>(OUTGOING_DEPTH);
    match viewers.lock() {
        Ok(mut viewers) => viewers.push(sender),
        Err(_) => return,
    }
    joined.store(true, std::sync::atomic::Ordering::Relaxed);
    tracing::info!("a browser is watching");

    loop {
        let outgoing = match frames.recv_timeout(KEEP_ALIVE) {
            Ok(message) => (*message).clone(),
            // Nothing for half a second: say "still here" and nothing else.
            Err(RecvTimeoutError::Timeout) => Vec::new(),
            Err(RecvTimeoutError::Disconnected) => break,
        };
        if let Err(error) = socket.send(tungstenite::Message::binary(outgoing)) {
            // Including a write timeout: a viewer this far behind is better
            // dropped than carried, and the page reconnects.
            tracing::info!(%error, "the viewer's connection gave up");
            break;
        }
    }
    // The receiver dies with this thread, so the next `send` sees the channel
    // disconnected and forgets this viewer. Nothing to unregister by hand.
    tracing::info!("the browser stopped watching");
    let _ = socket.close(None);
}

/// Receives pad frames until the client goes away.
///
/// A malformed frame closes the connection rather than being skipped. On a
/// stream there is no framing to resynchronise against — the same reasoning the
/// frame socket uses — and a client sending rubbish is a client with a bug worth
/// noticing.
fn input_thread(
    stream: TcpStream,
    slots: &Pads,
    received: &Arc<std::sync::atomic::AtomicU64>,
    arrived: &Arc<Condvar>,
    seats: &Seats,
    players: PlayerSlot,
) {
    let _ = stream.set_nodelay(true);
    // Cleared, and this is not a formality. The deadline `classify` set to bound
    // the peek stayed on the socket, so a read of the NEXT pad frame inherited
    // it — and a player who pressed nothing for five seconds was dropped as if
    // they had left. Their seat went back to the room, and they came back as a
    // different player. Silence on a controller is the normal state of a
    // controller; a socket that has closed is what ending a session looks like.
    let _ = stream.set_read_timeout(None);
    let Ok(mut socket) = tungstenite::accept(stream) else {
        return;
    };

    // Which port this browser holds is the SERVER'S to decide, and it is the
    // first thing said on the socket: one byte, the port number, or zero for a
    // room with no seat left. A page cannot pick its own port — see the
    // re-stamping below — so this is the only way it can learn which it got.
    let Some(seat) = take_seat(seats, players) else {
        tracing::info!("a browser asked for a controller in a full room");
        let _ = socket.send(tungstenite::Message::binary(vec![0]));
        let _ = socket.close(None);
        return;
    };
    if socket
        .send(tungstenite::Message::binary(vec![seat.get()]))
        .is_err()
    {
        release_seat(seats, seat);
        return;
    }
    tracing::info!(port = seat.get(), "a browser is holding a controller");

    while let Ok(message) = socket.read() {
        let payload = match message {
            tungstenite::Message::Binary(bytes) => bytes,
            tungstenite::Message::Close(_) => break,
            // Ping/Pong are answered by tungstenite itself; text is not
            // something this endpoint speaks.
            _ => continue,
        };
        match InputFrame::decode(&payload) {
            Ok(frame) => {
                // Stamped with the seat this connection was given, whatever the
                // frame claims. A page that says "I am player 1" must not be
                // able to move player 1's character, and the check that would
                // reject it is a check that can be forgotten: overwriting cannot.
                let frame = InputFrame {
                    slot: seat,
                    ..frame
                };
                received.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                if let Ok(mut slots) = slots.lock() {
                    // Replaces rather than queues. Overwriting a state the
                    // emulator has not read yet is not a loss: it could only
                    // ever have applied the newer one.
                    if let Some(place) = slots.get_mut(frame.slot.index()) {
                        *place = Some(frame);
                    }
                }
                // Woken after the lock is released, so the waiter does not wake
                // straight into a lock it cannot take.
                arrived.notify_one();
            }
            Err(error) => {
                tracing::warn!(%error, "a client sent something that is not an InputFrame");
                break;
            }
        }
    }
    tracing::info!(port = seat.get(), "the controller disconnected");
    // The seat goes back before the state does: a port nobody holds keeps
    // applying whatever its last holder left pressed, and a stuck direction is
    // exactly the bug a player would blame the network for.
    release_seat(seats, seat);
    if let Ok(mut slots) = slots.lock()
        && let Some(place) = slots.get_mut(seat.index())
    {
        *place = Some(InputFrame::neutral(seat));
    }
    arrived.notify_one();
    let _ = socket.close(None);
}

/// Claims the lowest free port, or `None` when the room is full.
fn take_seat(seats: &Seats, players: PlayerSlot) -> Option<PlayerSlot> {
    let mut seats = seats.lock().ok()?;
    for raw in 1..=players.get() {
        let slot = PlayerSlot::new(raw).ok()?;
        if let Some(taken) = seats.get_mut(slot.index())
            && !*taken
        {
            *taken = true;
            return Some(slot);
        }
    }
    None
}

fn release_seat(seats: &Seats, seat: PlayerSlot) {
    if let Ok(mut seats) = seats.lock()
        && let Some(taken) = seats.get_mut(seat.index())
    {
        *taken = false;
    }
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
        assert!(matches!(classify(&stream), Some(Route::Video)));

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
                Some(Route::Page) => "page",
                Some(Route::Video) => "video",
                Some(Route::Input) => "input",
                None => "none",
            };
            assert_eq!(got, expected, "for {}", String::from_utf8_lossy(request));
            client.join().unwrap();
        }
    }

    /// Builds a server with no accept loop, for tests that only exercise policy.
    fn detached(viewers: Vec<SyncSender<Framed>>) -> BrowserServer {
        BrowserServer {
            viewers: Arc::new(Mutex::new(viewers)),
            arrived: Arc::new(Condvar::new()),
            incoming: Arc::new(Mutex::new([None; PORTS])),
            received: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            address: "127.0.0.1:0".parse().unwrap(),
            dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            _accept: std::thread::spawn(|| {}),
        }
    }

    fn frame() -> Packet {
        Packet {
            captured_micros: 0,
            annex_b: vec![0, 0, 0, 1, 0x65],
        }
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
        assert_eq!(told.len(), 1, "the seat is announced as one byte");
        (socket, told[0])
    }

    /// Four browsers, four ports, in the order they arrived.
    #[test]
    fn each_browser_is_given_its_own_port() {
        let server = BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", four()).unwrap();
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
        let server = BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", four()).unwrap();
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
        let server = BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", one).unwrap();
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
        let server = BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", four()).unwrap();
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
        let server = BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", four()).unwrap();
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

    /// The emulator goes quiet legitimately — a game blanking the screen
    /// presents nothing — and the page gives up after two seconds of silence.
    /// The stream's cadence has to be the server's, not the emulator's.
    #[test]
    fn a_viewer_hears_from_the_server_even_when_the_emulator_says_nothing() {
        let server = BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", four()).unwrap();
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
        let server =
            Arc::new(BrowserServer::start("127.0.0.1:0".parse().unwrap(), "page", four()).unwrap());
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
