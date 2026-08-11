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
use std::sync::mpsc::{Receiver, RecvTimeoutError, SyncSender, TrySendError, sync_channel};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use nel3ab_protocol::InputFrame;
use thiserror::Error;

/// How many frames may wait for the socket before one is dropped.
///
/// Two, not zero and not twenty. Zero would drop a frame every time the write
/// took longer than the gap between frames, which happens routinely. Twenty
/// would let a slow client accumulate a third of a second of stale pictures.
const OUTGOING_DEPTH: usize = 2;

/// How many pad frames may wait to be read before the oldest is dropped.
///
/// Deeper than the video queue for the opposite reason: inputs are 13 bytes and
/// the consumer reads them in a batch once per emulated frame, so a handful in
/// flight is normal rather than a symptom.
const INCOMING_DEPTH: usize = 64;

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
    outgoing: SyncSender<Packet>,
    incoming: Receiver<InputFrame>,
    address: SocketAddr,
    dropped: Arc<std::sync::atomic::AtomicU64>,
    watching: Arc<std::sync::atomic::AtomicUsize>,
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
    /// # Errors
    /// [`TransportError::Bind`] or [`TransportError::Accept`].
    pub fn start(address: SocketAddr, page: &'static str) -> Result<Self, TransportError> {
        let listener = TcpListener::bind(address)
            .map_err(|source| TransportError::Bind { address, source })?;
        let bound = listener
            .local_addr()
            .map_err(|source| TransportError::Accept { source })?;

        let (outgoing, to_send) = sync_channel::<Packet>(OUTGOING_DEPTH);
        let (received, incoming) = sync_channel::<InputFrame>(INCOMING_DEPTH);
        let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let watching = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let joined = Arc::new(std::sync::atomic::AtomicBool::new(false));
        // Shared, not moved: a client that reconnects gets a new thread, and the
        // queue has to survive the old one. Only one holds the lock at a time.
        let to_send = Arc::new(Mutex::new(to_send));

        let accept = std::thread::Builder::new()
            .name("browser-accept".to_owned())
            .spawn({
                let watching = Arc::clone(&watching);
                let joined = Arc::clone(&joined);
                move || accept_loop(&listener, page, &to_send, &received, &watching, &joined)
            })
            .map_err(|source| TransportError::Accept { source })?;

        tracing::info!(%bound, "browser server listening");
        Ok(Self {
            outgoing,
            incoming,
            address: bound,
            dropped,
            watching,
            joined,
            _accept: accept,
        })
    }

    /// The address actually bound, which matters when port 0 was asked for.
    #[must_use]
    pub const fn address(&self) -> SocketAddr {
        self.address
    }

    /// Offers a frame to whoever is watching.
    ///
    /// Returns `false` when nobody took it. Never blocks: a chain that waited
    /// here would be letting the network dictate the emulator's frame rate.
    ///
    /// **An empty room is not a dropped frame.** The first version of this
    /// counted one every time the queue was full, and with nobody connected the
    /// queue is *always* full — the worker reported 15 001 drops out of 15 003
    /// frames on a run no browser ever joined. A metric that cries wolf when
    /// nothing is wrong is worse than no metric, so `dropped` now means what its
    /// name says: somebody was watching and could not keep up.
    #[must_use]
    pub fn send(&self, packet: Packet) -> bool {
        if !self.is_watched() {
            return false;
        }
        match self.outgoing.try_send(packet) {
            Ok(()) => true,
            Err(TrySendError::Full(_)) => {
                self.dropped
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                false
            }
            Err(TrySendError::Disconnected(_)) => false,
        }
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

    /// Whether a browser is currently taking the video stream.
    #[must_use]
    pub fn is_watched(&self) -> bool {
        self.watching.load(std::sync::atomic::Ordering::Relaxed) > 0
    }

    /// Takes every pad frame that has arrived since the last call.
    ///
    /// Drains rather than returning one: the consumer runs once per emulated
    /// frame, and applying only the oldest of a burst would add latency in
    /// exactly the place this project cares about.
    #[must_use]
    pub fn drain_input(&self) -> Vec<InputFrame> {
        self.incoming.try_iter().collect()
    }

    /// How many frames a connected client was too slow to take.
    #[must_use]
    pub fn dropped(&self) -> u64 {
        self.dropped.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// Serves pages and hands WebSocket connections to their own threads.
fn accept_loop(
    listener: &TcpListener,
    page: &'static str,
    to_send: &Arc<Mutex<Receiver<Packet>>>,
    received: &SyncSender<InputFrame>,
    watching: &Arc<std::sync::atomic::AtomicUsize>,
    joined: &Arc<std::sync::atomic::AtomicBool>,
) {
    let mut sockets: Vec<JoinHandle<()>> = Vec::new();
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        match classify(&stream) {
            Some(Route::Video) => {
                let queue = Arc::clone(to_send);
                let watching = Arc::clone(watching);
                let joined = Arc::clone(joined);
                sockets.push(std::thread::spawn(move || {
                    video_thread(stream, &queue, &watching, &joined);
                }));
            }
            Some(Route::Input) => {
                let sink = received.clone();
                sockets.push(std::thread::spawn(move || input_thread(stream, &sink)));
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
    if stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .is_err()
    {
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
fn video_thread(
    stream: TcpStream,
    queue: &Arc<Mutex<Receiver<Packet>>>,
    watching: &Arc<std::sync::atomic::AtomicUsize>,
    joined: &Arc<std::sync::atomic::AtomicBool>,
) {
    // Nagle would hold a small frame back waiting for company. Every frame here
    // is latency-critical and self-contained, so there is nothing to gain by
    // waiting and 40 ms to lose.
    let _ = stream.set_nodelay(true);
    let _ = stream.set_read_timeout(None);
    let Ok(mut socket) = tungstenite::accept(stream) else {
        return;
    };
    tracing::info!("a browser is watching");

    // One watcher at a time. A second would have to be fed a copy of every
    // frame, and there is no product question yet that needs it.
    let Ok(queue) = queue.lock() else { return };
    // Counted only once the socket is up and the queue is ours, and decremented
    // on every exit below — so `send` never believes in a watcher that is only
    // half connected.
    watching.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    joined.store(true, std::sync::atomic::Ordering::Relaxed);
    // Whatever accumulated while nobody was here is stale by definition.
    while queue.try_recv().is_ok() {}
    loop {
        match queue.recv_timeout(Duration::from_millis(500)) {
            Ok(packet) => {
                let mut message = Vec::with_capacity(8 + packet.annex_b.len());
                message.extend_from_slice(&packet.captured_micros.to_le_bytes());
                message.extend_from_slice(&packet.annex_b);
                if socket.send(tungstenite::Message::binary(message)).is_err() {
                    break;
                }
            }
            // Nothing to send is normal — the emulator may be paused, or nobody
            // has produced a frame yet. Keep the connection.
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    watching.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
    tracing::info!("the browser stopped watching");
    let _ = socket.close(None);
}

/// Receives pad frames until the client goes away.
///
/// A malformed frame closes the connection rather than being skipped. On a
/// stream there is no framing to resynchronise against — the same reasoning the
/// frame socket uses — and a client sending rubbish is a client with a bug worth
/// noticing.
fn input_thread(stream: TcpStream, sink: &SyncSender<InputFrame>) {
    let _ = stream.set_nodelay(true);
    let Ok(mut socket) = tungstenite::accept(stream) else {
        return;
    };
    tracing::info!("a browser is holding a controller");

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
                // A full queue means the consumer is not draining, which is a
                // bug on our side rather than the client's — say so once per
                // occurrence rather than silently losing a button press.
                if sink.try_send(frame).is_err() {
                    tracing::warn!("the input queue is full; a pad frame was lost");
                }
            }
            Err(error) => {
                tracing::warn!(%error, "a client sent something that is not an InputFrame");
                break;
            }
        }
    }
    tracing::info!("the controller disconnected");
    let _ = socket.close(None);
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

    /// A watcher that falls behind loses frames rather than delaying the
    /// emulator — the chain keeps its own cadence whatever the network does.
    #[test]
    fn frames_are_dropped_rather_than_queued_when_the_client_is_behind() {
        let (outgoing, held) = sync_channel::<Packet>(OUTGOING_DEPTH);
        let dropped = Arc::new(std::sync::atomic::AtomicU64::new(0));
        // One watcher, pretended: without it `send` refuses every frame, which
        // is what the next test checks.
        let watching = Arc::new(std::sync::atomic::AtomicUsize::new(1));
        let server = BrowserServer {
            outgoing,
            incoming: sync_channel::<InputFrame>(1).1,
            address: "127.0.0.1:0".parse().unwrap(),
            dropped: Arc::clone(&dropped),
            watching,
            joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            _accept: std::thread::spawn(|| {}),
        };

        let packet = || Packet {
            captured_micros: 0,
            annex_b: vec![0, 0, 0, 1, 0x65],
        };
        // The queue takes exactly its depth, then refuses.
        for _ in 0..OUTGOING_DEPTH {
            assert!(server.send(packet()), "the queue should accept its depth");
        }
        assert!(!server.send(packet()), "a full queue must drop, not block");
        assert_eq!(server.dropped(), 1);

        // The negative twin: draining one makes room again, so the drop was
        // backpressure rather than a channel that had died.
        drop(held.recv().unwrap());
        assert!(server.send(packet()));
        assert_eq!(
            server.dropped(),
            1,
            "an accepted frame must not count as dropped"
        );
    }

    /// The negative twin, and the bug that produced it: with nobody watching,
    /// offering a frame must be a no-op — not a drop. The worker reported
    /// **15 001 drops out of 15 003 frames** on a run no browser ever joined,
    /// because an empty queue with no reader is indistinguishable from a full
    /// one unless somebody asks whether anyone is there.
    #[test]
    fn an_empty_room_is_not_a_dropped_frame() {
        let (outgoing, _held) = sync_channel::<Packet>(OUTGOING_DEPTH);
        let server = BrowserServer {
            outgoing,
            incoming: sync_channel::<InputFrame>(1).1,
            address: "127.0.0.1:0".parse().unwrap(),
            dropped: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            watching: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            joined: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            _accept: std::thread::spawn(|| {}),
        };

        for _ in 0..1000 {
            assert!(!server.send(Packet {
                captured_micros: 0,
                annex_b: vec![0, 0, 0, 1, 0x65],
            }));
        }
        assert_eq!(
            server.dropped(),
            0,
            "an empty room must not look like congestion"
        );
        assert!(!server.is_watched());
    }
}
