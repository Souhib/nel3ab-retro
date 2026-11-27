//! Translation to the private virtual controllers. No browser device names or
//! physical event numbers cross the room's controller protocol.
use crate::browser::{BrowserServer, ControllerFrame, Packet};
use crate::edges::{Edges, Kept};
use nel3ab_protocol::switch::SwitchFrame;
use nel3ab_telemetry::{Summary, Timings};
use std::{
    io::{self, Read, Write},
    os::unix::{
        fs::PermissionsExt,
        net::{UnixDatagram, UnixListener, UnixStream},
    },
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

/// From a CHANGE handed to the private pads to the first picture captured
/// after it, published as `pad_change_to_frame`.
///
/// Until 2026-11-27 every state handed to the pads restarted the clock, and the
/// figure was published as `input_to_frame`. The page sends a state every 4 ms
/// since 2026-08-16 (`input.ts`, `PAD_PERIOD_MS`), moving or not, so the clock
/// restarted at nearly every frame: the figure read the gap between the LAST
/// frame received and the next picture, about 2 ms at p50 and never more than
/// one picture apart (audit WK-4 and ENT-5). Only a state that differs from the
/// one this seat had before starts the clock now, buttons or sticks. A new name,
/// so the evenings before it are not read with the new meaning.
///
/// What it still is: a lower bound of our transport, from the pads to the next
/// picture the capture sends. It is never the game's reaction: the picture that
/// closes it was almost always drawn before the game read the change. The real
/// figure takes the test program that draws every button (`switch-reaction`).
///
/// The latest change wins, and only the first picture after it is measured.
/// Both streams take the pending change. The adapter captures the half stream
/// alone when nobody watches the full one, and a change taken only by a full
/// picture would wait for the next full watcher and be counted minutes late.
///
/// Measured on 2026-09-09 from outside, on the Looney Tunes title screen:
/// 51 ms from the pad command to the first heavy picture on `/video`, three
/// stable trials. That number was read by a script that no longer exists.
#[derive(Debug)]
pub struct Reaction {
    pending: Mutex<Option<Instant>>,
    /// The last state told to each seat, to tell a change from a repeat.
    last: Mutex<[Option<SwitchFrame>; crate::browser::PORTS]>,
    window: Mutex<Timings>,
}
impl Default for Reaction {
    fn default() -> Self {
        Self::new()
    }
}
impl Reaction {
    /// An empty window. Two thousand samples is a full ten-second window at
    /// sixty changes a second, plus room; a fuller one says so in `dropped`.
    #[must_use]
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(None),
            last: Mutex::new([None; crate::browser::PORTS]),
            window: Mutex::new(Timings::new(2048)),
        }
    }
    /// A state was handed to the pads now. Only a change starts the clock.
    pub fn told(&self, frame: SwitchFrame) {
        let changed = self.last.lock().is_ok_and(|mut last| {
            last.get_mut(frame.slot.index())
                .is_some_and(|seat| seat.replace(frame) != Some(frame))
        });
        if changed {
            self.pressed();
        }
    }
    /// A command left for the pads now.
    pub fn pressed(&self) {
        if let Ok(mut at) = self.pending.lock() {
            *at = Some(Instant::now());
        }
    }
    /// A picture arrived: the first one after a press closes that press.
    pub fn pictured(&self) {
        if let Ok(mut at) = self.pending.lock()
            && let Some(at) = at.take()
            && let Ok(mut window) = self.window.lock()
        {
            window.observe(at.elapsed());
        }
    }
    /// The window since the last call, then a new one.
    pub fn summary(&self) -> Summary {
        self.window.lock().map_or(
            Summary {
                samples: 0,
                p50: 0.0,
                p95: 0.0,
                p99: 0.0,
                max: 0.0,
            },
            |mut window| {
                let summary = window.summary();
                window.clear();
                summary
            },
        )
    }
}

/// The four kinds of packet a capture sends, each on its own connection.
///
/// `F` and `H` are the two picture streams, `A` the sound and `D` the demand
/// poll. `capture.py` opens one connection per kind, so a kind names a
/// producer.
const KINDS: [u8; 4] = *b"FHAD";

/// How long a producer may stay silent before another may take its stream.
///
/// Three seconds, the capture's own guard (`capture_health.py`): a producer
/// silent for that long is already declared quiet there. Chosen, not
/// measured. Shorter would let a second producer interleave its pictures
/// with a live one across a short stall. Without any limit, a dead
/// connection that never closes would keep its stream for ever and the
/// restarted capture would feed nobody.
const YIELD_AFTER: Duration = Duration::from_secs(3);

/// What the table answers for one packet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Admission {
    /// This connection feeds this stream.
    Owner,
    /// It does now: the previous one had been silent for [`YIELD_AFTER`].
    TookOver,
    /// Another connection feeds this stream, and it is alive.
    Refused,
}

/// Which capture connection feeds each stream.
///
/// The ingress used to hand every packet of every connection to the same
/// viewers. Two captures alive at once would have sent two H.264 streams,
/// interleaved, to one decoder: a picture nobody can read, for everybody.
/// The capture's lock (`capture_control.py`) was the only guard (audit WK-7,
/// 2026-11-27). The first connection that sends a kind keeps it until it
/// closes, or until it has been silent for [`YIELD_AFTER`].
#[derive(Debug, Default)]
struct Producers {
    held: Mutex<[Option<(u64, Instant)>; KINDS.len()]>,
    refused: std::sync::atomic::AtomicU64,
}
impl Producers {
    /// Whether `connection` may feed `kind` at `now`.
    fn admit(&self, kind: u8, connection: u64, now: Instant) -> Admission {
        let Some(index) = KINDS.iter().position(|known| *known == kind) else {
            return Admission::Owner;
        };
        let Ok(mut held) = self.held.lock() else {
            // A poisoned table refuses nothing: the lock is what failed, and
            // the capture's own lock still stands behind it.
            return Admission::Owner;
        };
        let admission = match held[index] {
            None => Admission::Owner,
            Some((owner, _)) if owner == connection => Admission::Owner,
            Some((_, last)) if now.saturating_duration_since(last) >= YIELD_AFTER => {
                Admission::TookOver
            }
            Some(_) => Admission::Refused,
        };
        if admission == Admission::Refused {
            self.refused.fetch_add(1, Ordering::Relaxed);
        } else {
            held[index] = Some((connection, now));
        }
        admission
    }
    /// A connection ended: the streams it fed are free.
    fn release(&self, connection: u64) {
        if let Ok(mut held) = self.held.lock() {
            for place in held.iter_mut() {
                if place.is_some_and(|(owner, _)| owner == connection) {
                    *place = None;
                }
            }
        }
    }
    /// Packets refused since the start, from a second producer.
    fn refused(&self) -> u64 {
        self.refused.load(Ordering::Relaxed)
    }
}

/// The capture clock, read as a number: `CLOCK_MONOTONIC`.
///
/// `capture.py` stamps each packet with `time.monotonic_ns()`, and the engine
/// container shares this clock with the host: Docker gives it no time
/// namespace. `Instant` reads the same clock but does not give its value.
fn capture_clock() -> Option<Duration> {
    nix::time::clock_gettime(nix::time::ClockId::CLOCK_MONOTONIC)
        .ok()
        .map(Duration::from)
}

/// One stream at the ingress, over one report window.
///
/// Dated where the packet has been read in full and before it is offered to
/// anybody: what is measured here is the capture and its socket, and nothing
/// of the viewers' queues or of the network behind them (audit WK-1).
#[derive(Debug)]
struct Flow {
    /// The last arrival, kept across windows: a gap that straddles a report
    /// is still a gap the viewers saw.
    last: Option<Instant>,
    packets: u64,
    gaps: Timings,
    ages: Timings,
    bytes: Timings,
    keys: u64,
}
impl Default for Flow {
    fn default() -> Self {
        // Two thousand samples: ten seconds of sound at a hundred chunks a
        // second, twice over. A fuller window says so in `Timings::dropped`.
        Self {
            last: None,
            packets: 0,
            gaps: Timings::new(2048),
            ages: Timings::new(2048),
            bytes: Timings::new(2048),
            keys: 0,
        }
    }
}
impl Flow {
    /// One packet arrived at `at`, `age` after its capture when that is known.
    fn arrived(&mut self, at: Instant, age: Option<Duration>, size: usize, key: bool) {
        if let Some(last) = self.last.replace(at) {
            self.gaps.observe(at.saturating_duration_since(last));
        }
        if let Some(age) = age {
            self.ages.observe(age);
        }
        #[expect(
            clippy::cast_precision_loss,
            reason = "a packet is at most 4 MiB, checked before it is read: f64 is \
                      exact for every size this can hold"
        )]
        self.bytes.record(size as f64);
        self.packets += 1;
        self.keys += u64::from(key);
    }
    /// The window so far, then a new one.
    fn summary(&mut self) -> FlowSummary {
        let measured = |window: &mut Timings| (!window.is_empty()).then(|| window.summary());
        let summary = FlowSummary {
            packets: self.packets,
            gap: measured(&mut self.gaps),
            age: measured(&mut self.ages),
            bytes: measured(&mut self.bytes),
            keys: self.keys,
        };
        self.packets = 0;
        self.keys = 0;
        self.gaps.clear();
        self.ages.clear();
        self.bytes.clear();
        summary
    }
}

/// What one stream looked like at the ingress since the last report.
///
/// A distribution nobody measured is `None`, never zeros: a window without a
/// picture must not read as a window of perfect pictures.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct FlowSummary {
    /// Packets that reached the ingress and were offered to the viewers.
    pub packets: u64,
    /// Milliseconds between two arrivals.
    pub gap: Option<Summary>,
    /// Milliseconds from the capture stamp to the arrival.
    pub age: Option<Summary>,
    /// Bytes per packet.
    pub bytes: Option<Summary>,
    /// Pictures that carried a key frame.
    pub keys: u64,
}

/// The three streams at the ingress since the last report.
#[derive(Debug, Default, Clone, Copy, PartialEq)]
pub struct IngressReport {
    /// The full-size pictures, `F`.
    pub full: FlowSummary,
    /// The reduced pictures, `H`.
    pub half: FlowSummary,
    /// The sound, `A`.
    pub sound: FlowSummary,
}

/// What every capture connection of one ingress shares.
#[derive(Debug, Default)]
struct Entry {
    reaction: Reaction,
    producers: Producers,
    /// `F`, `H` and `A`, in that order. Its own lock, never one of the
    /// server's: dating a packet must not wait on a viewer.
    flows: Mutex<[Flow; 3]>,
    /// What the pads thread handed to `pads.py`. See [`PadsReport`].
    pads: Mutex<PadsWindow>,
}

/// What the pads thread did for one seat since the last report.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SeatPads {
    /// States handed to `pads.py`, one datagram each.
    pub sent: u64,
    /// Of those, the ones identical to the state before for this seat.
    pub repeated: u64,
    /// The edges [`Edges`] kept for this seat.
    pub kept: Kept,
}

/// What the pads thread handed to `pads.py` since the last report.
///
/// Counted before anybody changes the traffic (audit WK-6, ENT-8, 2026-11-27).
/// The page sends a state every 4 ms, moving or not, and each one goes on to
/// `pads.py` as JSON. Whether that costs anything was never measured: here is
/// how many there are, how many repeat the one before, and how long the send
/// takes. `pads.py` lets a seat go after one second without a state, so the
/// repeats are not removed until a measure says they cost something.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PadsReport {
    /// Per seat, in seat order.
    pub seats: [SeatPads; crate::browser::PORTS],
    /// Milliseconds spent in `send_to`, every seat together. `None` when
    /// nothing was sent.
    pub send: Option<Summary>,
}

/// The pads window, filled by the pads thread and drained by the report.
#[derive(Debug)]
struct PadsWindow {
    seats: [SeatPads; crate::browser::PORTS],
    send: Timings,
}
impl Default for PadsWindow {
    fn default() -> Self {
        // Four thousand: ten seconds of one seat at the page's 4 ms, and room.
        Self {
            seats: [SeatPads::default(); crate::browser::PORTS],
            send: Timings::new(4096),
        }
    }
}
impl PadsWindow {
    /// One state handed to `pads.py` for `seat`, in `took`.
    fn sent(&mut self, seat: usize, repeated: bool, kept: Kept, took: Duration) {
        if let Some(seat) = self.seats.get_mut(seat) {
            seat.sent += 1;
            seat.repeated += u64::from(repeated);
            seat.kept.rescued += kept.rescued;
            seat.kept.deferred += kept.deferred;
        }
        self.send.observe(took);
    }
    /// The window so far, then a new one.
    fn take(&mut self) -> PadsReport {
        let report = PadsReport {
            seats: self.seats,
            send: (!self.send.is_empty()).then(|| self.send.summary()),
        };
        self.seats = [SeatPads::default(); crate::browser::PORTS];
        self.send.clear();
        report
    }
}

impl Entry {
    /// Dates one packet of `kind`, read in full at `at`.
    fn arrived(&self, kind: u8, at: Instant, captured: u64, payload: &[u8]) {
        let Some(index) = KINDS[..3].iter().position(|known| *known == kind) else {
            return;
        };
        // A stamp ahead of this clock is no age at all, and it is left out
        // rather than counted as zero.
        let age = capture_clock().and_then(|now| now.checked_sub(Duration::from_micros(captured)));
        let key = kind != b'A' && crate::browser::carries_key_frame(payload);
        if let Ok(mut flows) = self.flows.lock()
            && let Some(flow) = flows.get_mut(index)
        {
            flow.arrived(at, age, payload.len(), key);
        }
    }
    /// The pads window, then a new one.
    fn pads_report(&self) -> Option<PadsReport> {
        Some(self.pads.lock().ok()?.take())
    }
    /// The three windows, then new ones.
    fn report(&self) -> Option<IngressReport> {
        let [full, half, sound] = &mut *self.flows.lock().ok()?;
        Some(IngressReport {
            full: full.summary(),
            half: half.summary(),
            sound: sound.summary(),
        })
    }
}

/// How long the pads thread waits for a frame when no held edge is due.
///
/// Only how often it looks at its stop flag: a frame or a due edge wakes it
/// sooner.
const IDLE_WAIT: Duration = Duration::from_millis(50);

/// The seats the emulator connects a controller for, from who sits where.
///
/// A Switch game counts every connected controller as a player. Mario Tennis
/// asked the controller applet for exactly two, was told four, and forced
/// doubles (2026-09-10). A console lets people unplug the extra controllers;
/// the room does it for them through the `seats` file that Ryubing reads
/// (`amont/ryubing-seats.patch`).
///
/// A seat joins at once and leaves only after `grace`: a page that reloads
/// takes its seat back, and a controller unplugged mid-match stops the game.
/// With nobody seated, seat 1 stays connected, so a game never runs without a
/// controller at all.
#[derive(Debug)]
pub struct Connected {
    last_seen: Vec<Option<Instant>>,
    grace: Duration,
}
impl Connected {
    /// Nobody seen yet, for a room of `seats` seats.
    #[must_use]
    pub fn new(seats: usize, grace: Duration) -> Self {
        Self {
            last_seen: vec![None; seats],
            grace,
        }
    }
    /// The seat numbers, from 1, to connect at `now`.
    pub fn update(&mut self, occupied: &[bool], now: Instant) -> Vec<u8> {
        let mut connected = Vec::new();
        for ((seen, &taken), number) in self.last_seen.iter_mut().zip(occupied).zip(1_u8..) {
            if taken {
                *seen = Some(now);
            }
            if seen.is_some_and(|at| now.saturating_duration_since(at) < self.grace) {
                connected.push(number);
            }
        }
        if connected.is_empty() {
            connected.push(1);
        }
        connected
    }
}

/// Staged then renamed, so Ryubing never reads half a list.
///
/// The engine container mounts this folder read-write under the host's
/// account, so a compromised engine could leave `seats.tmp` as a link to a
/// host file: `fs::write` would follow it (review of 2026-11-22). The stale
/// name is removed, then created with `create_new` (`O_CREAT | O_EXCL`), which
/// never follows a link: a link recreated in between makes this write fail
/// and the next one retry. `rename` replaces a link at `seats` itself.
fn write_seats(root: &Path, seats: &[u8]) -> io::Result<()> {
    use std::io::Write as _;
    let text: Vec<String> = seats.iter().map(u8::to_string).collect();
    let staged = root.join("seats.tmp");
    match std::fs::remove_file(&staged) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged)?
        .write_all((text.join(" ") + "\n").as_bytes())?;
    std::fs::rename(staged, root.join("seats"))
}

/// How long an empty seat keeps its controller. Chosen, not measured: longer
/// than a page reload takes to reclaim its seat on the tailnet, and short
/// enough that a player who leaves frees the game within a few seconds.
const SEAT_GRACE: Duration = Duration::from_secs(5);

/// Private capture and controller ingress. Dropping it stops all readers;
/// emulator lifecycle remains the caller's responsibility.
pub struct Ingress {
    stopping: Arc<AtomicBool>,
    entry: Arc<Entry>,
}
impl Drop for Ingress {
    fn drop(&mut self) {
        self.stopping.store(true, Ordering::Relaxed);
    }
}
impl Ingress {
    /// What the pads-to-picture window holds since the last report.
    #[must_use]
    pub fn reaction(&self) -> Summary {
        self.entry.reaction.summary()
    }
    /// What the three streams looked like at the ingress since the last call.
    ///
    /// `None` only when the window's lock was poisoned, which a caller says
    /// rather than reporting an empty window as a quiet one.
    #[must_use]
    pub fn report(&self) -> Option<IngressReport> {
        self.entry.report()
    }
    /// What the pads thread handed to `pads.py` since the last call.
    ///
    /// `None` only when the window's lock was poisoned.
    #[must_use]
    pub fn pads_report(&self) -> Option<PadsReport> {
        self.entry.pads_report()
    }
    /// Packets refused since the start because another capture fed their stream.
    #[must_use]
    pub fn producers_refused(&self) -> u64 {
        self.entry.producers.refused()
    }
    /// Bind only a fresh private directory, never unlink another worker's sockets.
    pub fn bind(root: &Path, server: Arc<BrowserServer>) -> io::Result<Self> {
        let listener = UnixListener::bind(root.join("media.sock"))?;
        listener.set_nonblocking(true)?;
        let rumble_path = root.join("rumble.sock");
        let rumble = UnixDatagram::bind(&rumble_path)?;
        // The helper shares our group but has no DAC_OVERRIDE capability.
        // On 2026-09-09 the default 0755 socket refused its first vibration.
        // Keep other users out, and explicitly allow the private helper group.
        std::fs::set_permissions(&rumble_path, std::fs::Permissions::from_mode(0o660))?;
        rumble.set_read_timeout(Some(Duration::from_millis(100)))?;
        let input = UnixDatagram::unbound()?;
        let pad_address = root.join("pads.sock");
        let stopping = Arc::new(AtomicBool::new(false));
        let entry = Arc::new(Entry::default());
        pads_thread(
            Arc::clone(&server),
            input,
            pad_address,
            Arc::clone(&entry),
            Arc::clone(&stopping),
        );
        let stopped = Arc::clone(&stopping);
        let output = Arc::clone(&server);
        thread::spawn(move || {
            let mut bytes = [0; 3];
            while !stopped.load(Ordering::Relaxed) {
                if rumble.recv(&mut bytes).is_ok_and(|size| size == 2)
                    && let Ok(seat) = nel3ab_protocol::PlayerSlot::new(bytes[0])
                {
                    output.rumble(seat, bytes[1]);
                }
            }
        });
        let mut connected = Connected::new(server.occupied_seats().len(), SEAT_GRACE);
        let mut written = connected.update(&server.occupied_seats(), Instant::now());
        write_seats(root, &written)?;
        let stopped = Arc::clone(&stopping);
        let output = Arc::clone(&server);
        let seats_root = root.to_path_buf();
        thread::spawn(move || {
            while !stopped.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(100));
                let wanted = connected.update(&output.occupied_seats(), Instant::now());
                if wanted != written {
                    match write_seats(&seats_root, &wanted) {
                        Ok(()) => written = wanted,
                        Err(error) => tracing::warn!(%error, "the seats file could not be written"),
                    }
                }
            }
        });
        let stopped = Arc::clone(&stopping);
        let shared = Arc::clone(&entry);
        thread::spawn(move || {
            let mut connections = 0_u64;
            while !stopped.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        connections += 1;
                        let connection = connections;
                        let output = Arc::clone(&server);
                        let stop = Arc::clone(&stopped);
                        let entry = Arc::clone(&shared);
                        thread::spawn(move || {
                            let ended = receive(stream, &output, &entry, connection, &stop);
                            // Released whatever ended it: a stream must not stay
                            // held by a connection that no longer exists.
                            entry.producers.release(connection);
                            if let Err(error) = ended {
                                tracing::info!(%error, "capture connection ended");
                            }
                        });
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => {
                        tracing::error!(%error, "Switch capture listener failed");
                        break;
                    }
                }
            }
        });
        Ok(Self { stopping, entry })
    }
}
/// Hands each seat's newest state to the private pads, keeping short edges.
///
/// One datagram per state taken, as before: `pads.py` lets a seat go after a
/// second without one, so a held button needs the repeated frames the page
/// sends (audit ENT-8, not changed). What is new is [`Edges`]: a press and its
/// release read together reach the pads one after the other, [`crate::edges::HOLD`]
/// apart, and the thread wakes for that release at its time.
fn pads_thread(
    output: Arc<BrowserServer>,
    input: UnixDatagram,
    pad_address: PathBuf,
    pressed: Arc<Entry>,
    stopped: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let mut last: [Option<SwitchFrame>; crate::browser::PORTS] = [None; crate::browser::PORTS];
        let mut tell = |frame: SwitchFrame, kept: Kept| {
            let bytes = command(frame).to_string();
            // Read around the send only, outside every lock.
            let started = Instant::now();
            let delivered = input.send_to(bytes.as_bytes(), &pad_address);
            let took = started.elapsed();
            match delivered {
                // Counted from the moment the pads could have read
                // it. A command refused before the helper listens
                // reached nothing, and no picture answers it.
                Ok(_) => {
                    pressed.reaction.told(frame);
                    let seat = frame.slot.index();
                    let repeated = last
                        .get_mut(seat)
                        .is_some_and(|before| before.replace(frame) == Some(frame));
                    if let Ok(mut window) = pressed.pads.lock() {
                        window.sent(seat, repeated, kept, took);
                    }
                }
                Err(error) => {
                    tracing::debug!(%error, "Switch virtual pads not yet available");
                }
            }
        };
        let mut seats: [Edges; crate::browser::PORTS] = Default::default();
        while !stopped.load(Ordering::Relaxed) {
            // Woken for a held edge at its time, not at the next frame:
            // the page may have nothing more to send (audit ENT-2).
            let now = Instant::now();
            let wait = seats
                .iter()
                .filter_map(Edges::due)
                .min()
                .map_or(IDLE_WAIT, |due| due.saturating_duration_since(now))
                .min(IDLE_WAIT);
            for unread in output.wait_unread(wait) {
                if let ControllerFrame::Switch(latest) = unread.latest
                    && let Some(seat) = seats.get_mut(latest.slot.index())
                {
                    let frame =
                        seat.offer(latest, unread.went_down, unread.went_up, Instant::now());
                    tell(frame, seat.take_kept());
                }
            }
            let now = Instant::now();
            for seat in &mut seats {
                if let Some(frame) = seat.tick(now) {
                    tell(frame, seat.take_kept());
                }
            }
        }
    });
}
fn read(stream: &mut UnixStream, mut bytes: &mut [u8], stop: &AtomicBool) -> io::Result<()> {
    while !bytes.is_empty() {
        if stop.load(Ordering::Relaxed) {
            return Err(io::ErrorKind::Interrupted.into());
        }
        match stream.read(bytes) {
            Ok(0) => return Err(io::ErrorKind::UnexpectedEof.into()),
            Ok(size) => bytes = &mut bytes[size..],
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}
fn receive(
    mut stream: UnixStream,
    output: &BrowserServer,
    entry: &Entry,
    connection: u64,
    stop: &AtomicBool,
) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_millis(100)))?;
    stream.set_write_timeout(Some(Duration::from_secs(1)))?;
    // Said once per connection and kind, not once per packet: a second
    // capture sends sixty pictures a second.
    let mut warned = [false; KINDS.len()];
    loop {
        let mut header = [0u8; 13];
        read(&mut stream, &mut header, stop)?;
        let captured = u64::from_le_bytes(
            header[1..9]
                .try_into()
                .map_err(|_| io::ErrorKind::InvalidData)?,
        );
        let length = u32::from_le_bytes(
            header[9..13]
                .try_into()
                .map_err(|_| io::ErrorKind::InvalidData)?,
        ) as usize;
        // The recorder already rejects packets above 4 MiB. Bound before allocating.
        if length > 4 * 1024 * 1024 {
            return Err(io::ErrorKind::InvalidData.into());
        }
        if header[0] == b'D' {
            if length != 0 || captured != 0 {
                return Err(io::ErrorKind::InvalidData.into());
            }
            if admitted(entry, b'D', connection, Instant::now(), &mut warned) == Admission::Refused
            {
                // Answered, so the second capture does not block on its read,
                // and answered empty: the demand belongs to the capture that
                // feeds the pictures, and taking it here would rob that one of
                // the key frame a viewer is waiting for.
                stream.write_all(&[0; 10])?;
                continue;
            }
            let full = output.take_joined() | output.take_key_frame_request();
            let half = output.take_half_joined() | output.take_half_key_frame_request();
            stream.write_all(&(output.half_watchers() as u64).to_le_bytes())?;
            stream.write_all(&[u8::from(full), u8::from(half)])?;
            continue;
        }
        let mut payload = vec![0; length];
        read(&mut stream, &mut payload, stop)?;
        // Read once, here, and never under one of the server's locks: the
        // instant the whole packet is in, before anybody is offered it.
        let arrived = Instant::now();
        let packet = Packet {
            captured_micros: captured,
            annex_b: &payload,
        };
        if KINDS.contains(&header[0])
            && admitted(entry, header[0], connection, arrived, &mut warned) == Admission::Refused
        {
            continue;
        }
        entry.arrived(header[0], arrived, captured, &payload);
        let reaction = &entry.reaction;
        match header[0] {
            b'F' => {
                reaction.pictured();
                let _ = output.send(&packet);
            }
            b'H' => {
                reaction.pictured();
                let _ = output.send_half(&packet);
            }
            b'A' => {
                let _ = output.send_sound(captured, &payload);
            }
            _ => return Err(io::ErrorKind::InvalidData.into()),
        }
    }
}

/// Asks the producer table, and says so in the journal the first time.
fn admitted(
    entry: &Entry,
    kind: u8,
    connection: u64,
    now: Instant,
    warned: &mut [bool; KINDS.len()],
) -> Admission {
    let admission = entry.producers.admit(kind, connection, now);
    let Some(index) = KINDS.iter().position(|known| *known == kind) else {
        return admission;
    };
    match admission {
        Admission::Refused if !warned[index] => {
            warned[index] = true;
            tracing::warn!(
                kind = char::from(kind).to_string(),
                connection,
                "a second capture producer was refused for a stream another one feeds"
            );
        }
        Admission::TookOver => {
            tracing::warn!(
                kind = char::from(kind).to_string(),
                connection,
                "a capture producer took over a stream left silent"
            );
        }
        _ => {}
    }
    admission
}

/// Translate the room state to the four private Linux pads.
#[must_use]
pub fn command(frame: SwitchFrame) -> serde_json::Value {
    let bits = frame.buttons.bits();
    let buttons: Vec<_> = [
        (0, "a"),
        (1, "b"),
        (2, "x"),
        (3, "y"),
        (4, "l"),
        (5, "r"),
        (8, "minus"),
        (9, "plus"),
        (10, "ls"),
        (11, "rs"),
    ]
    .into_iter()
    .filter_map(|(bit, name)| (bits & (1_u32 << bit) != 0).then_some(name))
    .collect();
    let down = |bit: u32| i32::from(bits & (1_u32 << bit) != 0_u32);
    // The browser already sends signed 16-bit axes. Multiplying by 256 here
    // saturated a quarter-stick at the virtual device (red test, 2026-09-08).
    serde_json::json!({"player":frame.slot.get(),"buttons":buttons,"axes":{
        "lx":frame.left.x,"ly":-i32::from(frame.left.y),
        "rx":frame.right.x,"ry":-i32::from(frame.right.y),
        "zl":down(6)*255,"zr":down(7)*255,
        "dx":down(15)-down(14),"dy":down(13)-down(12)}})
}
#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "invalid fixtures must fail, and a missing measurement fails by its name"
)]
mod tests {
    use super::*;
    use nel3ab_protocol::{PlayerSlot, Stick, switch::SwitchButtons};
    #[test]
    fn rumble_allows_the_private_helper_group_but_not_other_users() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let owner = Arc::new(std::sync::Mutex::new(None));
        let server = BrowserServer::start(
            ([127, 0, 0, 1], 0).into(),
            "",
            Arc::from("[]"),
            Arc::from([]),
            PlayerSlot::new(4).unwrap(),
            &owner,
        )
        .unwrap();
        let _ingress = Ingress::bind(root.path(), Arc::new(server)).unwrap();
        let mode = std::fs::metadata(root.path().join("rumble.sock"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode & 0o060, 0o060, "the helper shares the worker's group");
        assert_eq!(mode & 0o007, 0, "other users must not access the socket");
    }
    #[test]
    fn demand_is_bounded_and_unknown_media_is_refused() {
        let owner = Arc::new(std::sync::Mutex::new(None));
        let server = BrowserServer::start(
            ([127, 0, 0, 1], 0).into(),
            "",
            Arc::from("[]"),
            Arc::from([]),
            PlayerSlot::new(4).unwrap(),
            &owner,
        )
        .unwrap();
        let (mut client, receiver) = UnixStream::pair().unwrap();
        let reader = thread::spawn(move || {
            receive(
                receiver,
                &server,
                &Entry::default(),
                1,
                &AtomicBool::new(false),
            )
        });
        let mut header = [0; 13];
        header[0] = b'D';
        client.write_all(&header).unwrap();
        let mut answer = [0; 10];
        client.read_exact(&mut answer).unwrap();
        assert_eq!(answer, [0; 10]);
        header[0] = b'?';
        client.write_all(&header).unwrap();
        assert_eq!(
            reader.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
    #[test]
    fn a_seat_joins_at_once_and_leaves_only_after_its_grace() {
        let start = Instant::now();
        let grace = Duration::from_secs(5);
        let mut connected = Connected::new(4, grace);
        assert_eq!(
            connected.update(&[false; 4], start),
            vec![1],
            "nobody seated keeps seat 1"
        );
        assert_eq!(
            connected.update(&[false, true, false, false], start),
            vec![2]
        );
        let reload = start + Duration::from_secs(4);
        assert_eq!(
            connected.update(&[false; 4], reload),
            vec![2],
            "a reload does not unplug"
        );
        let gone = start + grace + Duration::from_millis(1);
        assert_eq!(
            connected.update(&[false; 4], gone),
            vec![1],
            "a player who left is unplugged"
        );
        // The negative twin: a seat nobody took is never connected.
        assert_eq!(
            connected.update(&[true, false, true, false], gone),
            vec![1, 3]
        );
    }
    #[test]
    fn the_seats_file_is_never_written_through_a_link_the_engine_left() {
        // The engine container mounts this folder read-write under the host's
        // account (`-v {pads}:/pads`): it can leave `seats.tmp` as a link to a
        // host file it cannot see. Found on 2026-11-22.
        let root = tempfile::tempdir().unwrap();
        let host = tempfile::tempdir().unwrap();
        let witness = host.path().join("rc");
        std::fs::write(&witness, "host content\n").unwrap();
        std::os::unix::fs::symlink(&witness, root.path().join("seats.tmp")).unwrap();
        let dangling = host.path().join("created");
        std::os::unix::fs::symlink(&dangling, root.path().join("seats")).unwrap();
        write_seats(root.path(), &[1, 3]).unwrap();
        assert_eq!(std::fs::read_to_string(&witness).unwrap(), "host content\n");
        assert!(
            !dangling.exists(),
            "a link at `seats` is replaced, never followed"
        );
        // The twin: the room's own file still says which seats are taken.
        let seats = root.path().join("seats");
        assert!(!seats.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(seats).unwrap(), "1 3\n");
        write_seats(root.path(), &[2]).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.path().join("seats")).unwrap(),
            "2\n"
        );
    }
    #[test]
    fn the_emulator_reads_the_seats_the_room_holds() {
        use tungstenite::client::IntoClientRequest as _;
        let root = tempfile::tempdir().unwrap();
        let owner = Arc::new(std::sync::Mutex::new(None));
        let server = Arc::new(
            BrowserServer::start(
                ([127, 0, 0, 1], 0).into(),
                "",
                Arc::from("[]"),
                Arc::from([]),
                PlayerSlot::new(4).unwrap(),
                &owner,
            )
            .unwrap(),
        );
        let address = server.address();
        let _ingress = Ingress::bind(root.path(), Arc::clone(&server)).unwrap();
        let seats = || std::fs::read_to_string(root.path().join("seats")).unwrap();
        assert_eq!(
            seats(),
            "1\n",
            "an empty room keeps one controller, not four"
        );
        let stream = std::net::TcpStream::connect(address).unwrap();
        let (_socket, _) = tungstenite::client(
            format!("ws://{address}/input?take=3")
                .as_str()
                .into_client_request()
                .unwrap(),
            stream,
        )
        .unwrap();
        for _ in 0..40 {
            if seats() == "3\n" {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        panic!("the seats file still says {:?}", seats());
    }
    #[test]
    fn a_press_is_closed_by_the_next_picture_and_by_nothing_else() {
        let reaction = Reaction::new();
        // The negative twin first: pictures with nothing pending measure nothing.
        reaction.pictured();
        reaction.pictured();
        assert_eq!(reaction.summary().samples, 0);
        reaction.pressed();
        thread::sleep(Duration::from_millis(20));
        reaction.pictured();
        // A second picture belongs to no press.
        reaction.pictured();
        let summary = reaction.summary();
        assert_eq!(summary.samples, 1);
        assert!(
            summary.p50 >= 20.0,
            "measured {} ms for a 20 ms wait",
            summary.p50
        );
        // A summary is a window: reading it starts the next one empty.
        assert_eq!(reaction.summary().samples, 0);
        // The latest press wins, as in the Dolphin loop: a stick held for a
        // second measures the picture after its last command, not its first.
        reaction.pressed();
        thread::sleep(Duration::from_millis(40));
        reaction.pressed();
        reaction.pictured();
        assert!(reaction.summary().p50 < 30.0);
    }
    /// A known state, closed by a picture, so what follows starts from it.
    fn settled_on(reaction: &Reaction, frame: SwitchFrame) {
        reaction.told(frame);
        reaction.pictured();
        assert_eq!(reaction.summary().samples, 1, "the first state is a change");
    }
    /// Five identical frames 3 ms apart, then a picture: nothing changed, and
    /// nothing is measured. The page sends a frame every 4 ms whether anything
    /// moves or not, and every one of them used to restart the clock (audit
    /// WK-4 and ENT-5, 2026-11-27).
    #[test]
    fn identical_frames_start_no_clock() {
        let reaction = Reaction::new();
        let rest = SwitchFrame::neutral(PlayerSlot::new(1).unwrap());
        settled_on(&reaction, rest);
        for _ in 0..5 {
            reaction.told(rest);
            thread::sleep(Duration::from_millis(3));
        }
        reaction.pictured();
        assert_eq!(
            reaction.summary().samples,
            0,
            "five identical frames were measured as a change"
        );
    }
    /// The twins: a change 12 ms before the picture reads at least 12 ms, and
    /// the identical frames after it do not restart its clock; a stick that
    /// moves at every frame stays measured, from its latest move.
    #[test]
    fn a_change_is_measured_to_the_next_picture() {
        let reaction = Reaction::new();
        let one = PlayerSlot::new(1).unwrap();
        let rest = SwitchFrame::neutral(one);
        settled_on(&reaction, rest);
        let pressed = SwitchFrame {
            buttons: SwitchButtons::from_bits(1).unwrap(),
            ..rest
        };
        reaction.told(pressed);
        for _ in 0..3 {
            thread::sleep(Duration::from_millis(4));
            reaction.told(pressed);
        }
        reaction.pictured();
        let summary = reaction.summary();
        assert_eq!(summary.samples, 1);
        assert!(
            summary.p50 >= 12.0,
            "a change 12 ms old read {} ms: a repeat restarted the clock",
            summary.p50
        );
        for x in 1..=5 {
            reaction.told(SwitchFrame {
                left: Stick::new(x * 1000, 0),
                ..pressed
            });
            thread::sleep(Duration::from_millis(3));
        }
        reaction.pictured();
        let summary = reaction.summary();
        assert_eq!(summary.samples, 1, "a moving stick was not measured");
        assert!(summary.p50 < 10.0, "measured from its first move");
        // Each seat is compared with itself: another seat's repeat is no change.
        let two = SwitchFrame::neutral(PlayerSlot::new(2).unwrap());
        settled_on(&reaction, two);
        reaction.told(rest);
        reaction.pictured();
        assert_eq!(reaction.summary().samples, 1, "seat 1 went back to rest");
        reaction.told(two);
        reaction.pictured();
        assert_eq!(reaction.summary().samples, 0);
    }
    #[test]
    fn only_pictures_close_a_press_on_the_wire() {
        let owner = Arc::new(std::sync::Mutex::new(None));
        let server = BrowserServer::start(
            ([127, 0, 0, 1], 0).into(),
            "",
            Arc::from("[]"),
            Arc::from([]),
            PlayerSlot::new(4).unwrap(),
            &owner,
        )
        .unwrap();
        let entry = Arc::new(Entry::default());
        let (mut client, receiver) = UnixStream::pair().unwrap();
        let read_by = Arc::clone(&entry);
        let reader =
            thread::spawn(move || receive(receiver, &server, &read_by, 1, &AtomicBool::new(false)));
        let reaction = &entry.reaction;
        let packet = |client: &mut UnixStream, kind: u8| {
            let mut header = [0; 13];
            header[0] = kind;
            header[9..13].copy_from_slice(&4_u32.to_le_bytes());
            client.write_all(&header).unwrap();
            client.write_all(&[0, 0, 0, 1]).unwrap();
        };
        let settled = |pending: bool| {
            for _ in 0..100 {
                thread::sleep(Duration::from_millis(5));
                if reaction.pending.lock().unwrap().is_some() == pending {
                    return;
                }
            }
            panic!("the reader did not settle");
        };
        reaction.pressed();
        packet(&mut client, b'A');
        thread::sleep(Duration::from_millis(50));
        // Sound is not a picture: the press is still open.
        settled(true);
        packet(&mut client, b'H');
        settled(false);
        reaction.pressed();
        packet(&mut client, b'F');
        settled(false);
        assert_eq!(reaction.summary().samples, 2);
        drop(client);
        assert_eq!(
            reader.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
    }
    /// A real `/video` viewer, as a page opens it.
    fn watch(address: std::net::SocketAddr) -> tungstenite::WebSocket<std::net::TcpStream> {
        use tungstenite::client::IntoClientRequest as _;
        let stream = std::net::TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        tungstenite::client(
            format!("ws://{address}/video")
                .as_str()
                .into_client_request()
                .unwrap(),
            stream,
        )
        .unwrap()
        .0
    }
    /// The next picture a viewer reads, by the marker its producer put in it.
    fn next_marker(viewer: &mut tungstenite::WebSocket<std::net::TcpStream>) -> u8 {
        loop {
            let message = viewer.read().unwrap().into_data();
            // An empty message is the server's keep-alive, not a picture.
            if let Some(marker) = message.last()
                && message.len() > 8
            {
                return *marker;
            }
        }
    }
    /// A key frame (NAL type 5) whose last byte names who sent it.
    fn picture(client: &mut UnixStream, kind: u8, marker: u8) {
        let payload = [0, 0, 0, 1, 0x65, marker];
        let mut header = [0; 13];
        header[0] = kind;
        header[9..13].copy_from_slice(&6_u32.to_le_bytes());
        client.write_all(&header).unwrap();
        client.write_all(&payload).unwrap();
    }
    fn room() -> Arc<BrowserServer> {
        let owner = Arc::new(std::sync::Mutex::new(None));
        Arc::new(
            BrowserServer::start(
                ([127, 0, 0, 1], 0).into(),
                "",
                Arc::from("[]"),
                Arc::from([]),
                PlayerSlot::new(4).unwrap(),
                &owner,
            )
            .unwrap(),
        )
    }
    fn wait_for(mut what: impl FnMut() -> bool) {
        for _ in 0..300 {
            if what() {
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("the condition never came");
    }
    #[test]
    fn a_second_capture_feeds_nobody_while_the_first_lives() {
        let server = room();
        let mut viewer = watch(server.address());
        wait_for(|| server.watchers() == 1);
        let entry = Arc::new(Entry::default());
        let stop = Arc::new(AtomicBool::new(false));
        let reader = |end: UnixStream, connection: u64| {
            let (server, entry, stop) =
                (Arc::clone(&server), Arc::clone(&entry), Arc::clone(&stop));
            thread::spawn(move || {
                let ended = receive(end, &server, &entry, connection, &stop);
                entry.producers.release(connection);
                ended
            })
        };
        let (mut first, first_end) = UnixStream::pair().unwrap();
        let (mut second, second_end) = UnixStream::pair().unwrap();
        let first_reader = reader(first_end, 1);
        let _second_reader = reader(second_end, 2);
        picture(&mut first, b'F', 1);
        assert_eq!(
            next_marker(&mut viewer),
            1,
            "the first capture feeds the stream"
        );
        picture(&mut second, b'F', 2);
        thread::sleep(Duration::from_millis(100));
        picture(&mut first, b'F', 3);
        assert_eq!(
            next_marker(&mut viewer),
            3,
            "a second capture's picture reached a viewer while the first one lived"
        );
        assert_eq!(entry.producers.refused(), 1, "the refusal is counted");
        // The twin: once the first has gone, the second feeds the stream.
        drop(first);
        assert_eq!(
            first_reader.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::UnexpectedEof
        );
        picture(&mut second, b'F', 4);
        assert_eq!(
            next_marker(&mut viewer),
            4,
            "the second capture took the free stream"
        );
        assert_eq!(
            entry.producers.refused(),
            1,
            "an accepted picture is not refused"
        );
    }
    #[test]
    fn a_silent_producer_yields_its_stream_and_only_then() {
        let producers = Producers::default();
        let start = Instant::now();
        let at = |ms| start + Duration::from_millis(ms);
        assert_eq!(producers.admit(b'F', 1, at(0)), Admission::Owner);
        assert_eq!(producers.admit(b'F', 2, at(1000)), Admission::Refused);
        assert_eq!(producers.admit(b'F', 1, at(2000)), Admission::Owner);
        // Each kind is its own stream: the sound is free.
        assert_eq!(producers.admit(b'A', 2, at(2000)), Admission::Owner);
        // Silent for 2.9 s: still the first one's.
        assert_eq!(producers.admit(b'F', 2, at(4900)), Admission::Refused);
        // Silent for 3.1 s: the stream yields, and the old producer is refused.
        assert_eq!(producers.admit(b'F', 2, at(5100)), Admission::TookOver);
        assert_eq!(producers.admit(b'F', 1, at(5200)), Admission::Refused);
        assert_eq!(producers.refused(), 3);
        // A closed connection frees what it fed, and nothing else.
        producers.release(2);
        assert_eq!(producers.admit(b'F', 1, at(5300)), Admission::Owner);
        assert_eq!(producers.admit(b'A', 1, at(5300)), Admission::Owner);
    }
    #[test]
    fn a_refused_demand_is_answered_empty_and_leaves_the_key_frame_owed() {
        let server = room();
        let entry = Arc::new(Entry::default());
        let stop = Arc::new(AtomicBool::new(false));
        let mut ends = Vec::new();
        for connection in [1, 2] {
            let (client, end) = UnixStream::pair().unwrap();
            let (server, entry, stop) =
                (Arc::clone(&server), Arc::clone(&entry), Arc::clone(&stop));
            thread::spawn(move || receive(end, &server, &entry, connection, &stop));
            ends.push(client);
        }
        let demand = |client: &mut UnixStream| {
            let mut header = [0; 13];
            header[0] = b'D';
            client.write_all(&header).unwrap();
            let mut answer = [0; 10];
            client.read_exact(&mut answer).unwrap();
            answer
        };
        let _one = watch(server.address());
        wait_for(|| server.watchers() == 1);
        assert_eq!(demand(&mut ends[0])[8], 1, "a newcomer is owed a key frame");
        let _two = watch(server.address());
        wait_for(|| server.watchers() == 2);
        assert_eq!(
            demand(&mut ends[1]),
            [0; 10],
            "a second capture was handed the demand of the live one"
        );
        assert_eq!(
            demand(&mut ends[0])[8],
            1,
            "the key frame is still owed to the capture that feeds the pictures"
        );
        stop.store(true, Ordering::Relaxed);
    }
    /// The capture clock in microseconds, as the worker reads it. Good for a
    /// gap, which needs only one clock; an age needs [`stamp_as_capture_does`].
    fn stamp_now() -> u64 {
        u64::try_from(capture_clock().unwrap().as_micros()).unwrap()
    }
    /// The capture clock in microseconds, as `capture.py` stamps a packet: a
    /// fresh `python3` reading `time.monotonic_ns() // 1000`, the expression of
    /// its `send`. Read through the worker's own function, a wrong clock would
    /// agree with itself, and the age test could not fail (relecture du
    /// 2026-11-27: on `CLOCK_REALTIME`, it passed).
    fn stamp_as_capture_does() -> u64 {
        let out = std::process::Command::new("python3")
            .args(["-c", "import time; print(time.monotonic_ns() // 1000)"])
            .output()
            .unwrap();
        assert!(out.status.success(), "python3 could not read its clock");
        String::from_utf8(out.stdout)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }
    /// One packet of `kind`, `size` bytes, a key frame when `key`.
    fn packet(client: &mut UnixStream, kind: u8, captured: u64, size: usize, key: bool) {
        let mut payload = vec![0x11; size.max(5)];
        payload[..5].copy_from_slice(&[0, 0, 0, 1, if key { 0x65 } else { 0x41 }]);
        let mut header = [0; 13];
        header[0] = kind;
        header[1..9].copy_from_slice(&captured.to_le_bytes());
        header[9..13].copy_from_slice(&u32::try_from(payload.len()).unwrap().to_le_bytes());
        client.write_all(&header).unwrap();
        client.write_all(&payload).unwrap();
    }
    /// `count` packets on absolute deadlines `every` apart, so a late wake
    /// does not push every later one: `late` names one held back by `delay`.
    ///
    /// Stamped on the NOMINAL schedule, as the compositor stamps them: the
    /// late one carries the stamp it would have had. That is the night of
    /// 2026-11-26, where the capture's own gaps stayed near 17 ms while the
    /// page saw 117. A gap read from the stamps would miss it.
    fn pace(
        client: &mut UnixStream,
        kind: u8,
        count: usize,
        every: Duration,
        late: Option<(usize, Duration)>,
    ) {
        let start = Instant::now();
        let stamped = stamp_now();
        let mut owed = Duration::ZERO;
        for index in 0..count {
            if let Some((at, delay)) = late
                && at == index
            {
                owed = delay;
            }
            let nominal = every * u32::try_from(index).unwrap();
            thread::sleep((start + nominal + owed).saturating_duration_since(Instant::now()));
            let captured = stamped + u64::try_from(nominal.as_micros()).unwrap();
            packet(client, kind, captured, 1000, index % 10 == 0);
        }
    }
    /// An ingress on a fresh folder, and a capture connected to it.
    fn capture() -> (tempfile::TempDir, Ingress, UnixStream) {
        let root = tempfile::tempdir().unwrap();
        let ingress = Ingress::bind(root.path(), room()).unwrap();
        let client = UnixStream::connect(root.path().join("media.sock")).unwrap();
        (root, ingress, client)
    }
    /// Long enough for the reader to have read what was written: it reads
    /// as soon as a byte is there, and a report drains its window. The count
    /// is checked by each test AFTER its named assertion, because it comes
    /// from the window under test.
    fn settled(ingress: &Ingress) -> IngressReport {
        thread::sleep(Duration::from_millis(200));
        ingress.report().unwrap()
    }
    #[test]
    fn the_ingress_sees_a_picture_two_hundred_milliseconds_late() {
        let (_root, ingress, mut client) = capture();
        let frame = Duration::from_micros(16_700);
        pace(
            &mut client,
            b'F',
            60,
            frame,
            Some((30, Duration::from_millis(200))),
        );
        pace(
            &mut client,
            b'A',
            20,
            Duration::from_millis(10),
            Some((10, Duration::from_millis(100))),
        );
        let report = settled(&ingress);
        let gap = report
            .full
            .gap
            .expect("the ingress measured no arrival gap");
        assert!(
            gap.max >= 200.0,
            "a picture 200 ms late read {} ms at the ingress",
            gap.max
        );
        let sound = report.sound.gap.expect("the ingress measured no sound gap");
        assert!(
            sound.max >= 100.0,
            "a chunk 100 ms late read {} ms",
            sound.max
        );
        assert_eq!(report.full.keys, 6, "one key frame in ten pictures");
        assert_eq!(report.sound.keys, 0, "sound carries no key frame");
        assert!(
            report
                .full
                .bytes
                .is_some_and(|bytes| (bytes.max - 1000.0).abs() < 0.5)
        );
        assert_eq!((report.full.packets, report.sound.packets), (60, 20));
        // The window drains: the next report has measured nothing.
        let empty = ingress.report().unwrap();
        assert_eq!(empty.full.packets, 0);
        assert!(
            empty.full.gap.is_none(),
            "an empty window is absent, not zero"
        );
    }
    #[test]
    fn a_regular_capture_reads_regular_at_the_ingress() {
        let (_root, ingress, mut client) = capture();
        pace(&mut client, b'F', 60, Duration::from_micros(16_700), None);
        pace(&mut client, b'A', 20, Duration::from_millis(10), None);
        let report = settled(&ingress);
        let gap = report
            .full
            .gap
            .expect("the ingress measured no arrival gap");
        assert_eq!((report.full.packets, report.sound.packets), (60, 20));
        assert!(
            gap.max < 25.0,
            "a regular capture read {} ms at the ingress",
            gap.max
        );
        assert!(
            gap.p50 >= 15.0,
            "the median gap {} ms is not the cadence",
            gap.p50
        );
        let sound = report.sound.gap.expect("the ingress measured no sound gap");
        assert!(sound.max < 25.0, "regular sound read {} ms", sound.max);
        assert_eq!(report.half.packets, 0);
        assert!(report.half.gap.is_none(), "a stream nobody sent is absent");
    }
    #[test]
    fn the_age_at_the_ingress_is_read_on_the_capture_clock() {
        let (_root, ingress, mut client) = capture();
        let before = Instant::now();
        let stamped = stamp_as_capture_does();
        for _ in 0..10 {
            packet(&mut client, b'F', stamped - 40_000, 1000, false);
        }
        let report = settled(&ingress);
        // The stamp was read after `before`, and the packets arrived before
        // now: their age lies between 40 ms and 40 ms plus all of that.
        let bound = (before.elapsed() + Duration::from_millis(40)).as_secs_f64() * 1000.0;
        let age = report.full.age.expect("the ingress measured no age");
        assert_eq!(report.full.packets, 10);
        assert!(
            age.p50 >= 40.0 && age.max <= bound,
            "a packet the capture's clock stamped 40 ms ago read {} ms old, \
             not within 40 to {bound:.0} ms",
            age.max
        );
        // The twin: a fresh stamp is young, and a stamp from the future is no
        // age at all rather than zero.
        let before = Instant::now();
        let stamped = stamp_as_capture_does();
        for _ in 0..10 {
            packet(&mut client, b'F', stamped, 1000, false);
        }
        let report = settled(&ingress);
        assert!(report.full.age.unwrap().max <= before.elapsed().as_secs_f64() * 1000.0);
        packet(
            &mut client,
            b'F',
            stamp_as_capture_does() + 10_000_000,
            1000,
            false,
        );
        let report = settled(&ingress);
        assert_eq!(report.full.packets, 1, "the packet itself was read");
        assert!(
            report.full.age.is_none(),
            "a stamp ahead of the clock was counted"
        );
    }
    #[test]
    fn partial_headers_survive_timeouts_and_silent_readers_stop() {
        let (mut sender, mut receiver) = UnixStream::pair().unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        let reader = thread::spawn(move || {
            let mut bytes = [0; 4];
            read(&mut receiver, &mut bytes, &AtomicBool::new(false)).unwrap();
            bytes
        });
        sender.write_all(&[1, 2]).unwrap();
        thread::sleep(Duration::from_millis(80));
        sender.write_all(&[3, 4]).unwrap();
        assert_eq!(reader.join().unwrap(), [1, 2, 3, 4]);
        let (_sender, mut receiver) = UnixStream::pair().unwrap();
        receiver
            .set_read_timeout(Some(Duration::from_millis(20)))
            .unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let other = Arc::clone(&stop);
        let reader = thread::spawn(move || read(&mut receiver, &mut [0; 4], &other));
        stop.store(true, Ordering::Relaxed);
        assert_eq!(
            reader.join().unwrap().unwrap_err().kind(),
            io::ErrorKind::Interrupted
        );
    }
    #[test]
    fn fractional_sticks_keep_their_precision_and_only_y_changes_sign() {
        let mut frame = SwitchFrame::neutral(PlayerSlot::new(2).unwrap());
        frame.left = Stick::new(8192, -4096);
        frame.right = Stick::new(-16384, 2048);
        let axes = &command(frame)["axes"];
        for (name, value) in [("lx", 8192), ("ly", 4096), ("rx", -16384), ("ry", -2048)] {
            assert_eq!(axes[name], value);
        }
        let neutral = command(SwitchFrame::neutral(frame.slot));
        assert_eq!(neutral["buttons"], serde_json::json!([]));
        for value in neutral["axes"].as_object().unwrap().values() {
            assert_eq!(value, 0);
        }
    }
    #[test]
    fn all_sixteen_controls_reach_a_distinct_virtual_input() {
        let expected = [
            ("a", 0),
            ("b", 1),
            ("x", 2),
            ("y", 3),
            ("l", 4),
            ("r", 5),
            ("minus", 8),
            ("plus", 9),
            ("ls", 10),
            ("rs", 11),
        ];
        for bit in 0..16 {
            let frame = SwitchFrame {
                buttons: SwitchButtons::from_bits(1 << bit).unwrap(),
                ..SwitchFrame::neutral(PlayerSlot::new(4).unwrap())
            };
            let got = command(frame);
            assert_eq!(got["player"], 4);
            let buttons: Vec<_> = expected
                .iter()
                .filter(|(_, b)| *b == bit)
                .map(|(name, _)| *name)
                .collect();
            assert_eq!(got["buttons"], serde_json::json!(buttons));
            for (axis, positive, negative) in
                [("zl", 6, 99), ("zr", 7, 99), ("dx", 15, 14), ("dy", 13, 12)]
            {
                let amount = if axis == "zl" || axis == "zr" { 255 } else { 1 };
                assert_eq!(
                    got["axes"][axis],
                    (i32::from(bit == positive) - i32::from(bit == negative)) * amount
                );
            }
        }
    }

    /// A Switch room, its ingress on a fresh folder, and the pads' socket as
    /// `pads.py` binds it.
    fn switch_room() -> (tempfile::TempDir, Arc<BrowserServer>, Ingress, UnixDatagram) {
        let root = tempfile::tempdir().unwrap();
        let server = Arc::new(
            BrowserServer::start_with_input(
                ([127, 0, 0, 1], 0).into(),
                "",
                Arc::from("[]"),
                Arc::from([]),
                PlayerSlot::new(4).unwrap(),
                &Arc::new(std::sync::Mutex::new(None)),
                crate::browser::InputKind::Switch,
            )
            .unwrap(),
        );
        let pads = UnixDatagram::bind(root.path().join("pads.sock")).unwrap();
        pads.set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let ingress = Ingress::bind(root.path(), Arc::clone(&server)).unwrap();
        (root, server, ingress, pads)
    }
    /// Every command the pads received until they stay quiet, with the instant
    /// each one arrived and whether it holds A. Read as they come, so call it
    /// on its own thread before sending: a datagram read late is dated late.
    fn commands(pads: &UnixDatagram) -> Vec<(Instant, bool)> {
        let mut said = Vec::new();
        let mut bytes = [0; 4096];
        while let Ok(size) = pads.recv(&mut bytes) {
            let at = Instant::now();
            let command: serde_json::Value = serde_json::from_slice(&bytes[..size]).unwrap();
            let a = command["buttons"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!("a"));
            said.push((at, a));
        }
        said
    }
    fn tap(seat: PlayerSlot, a: bool) -> tungstenite::Message {
        let frame = SwitchFrame {
            buttons: SwitchButtons::from_bits(u32::from(a)).unwrap(),
            ..SwitchFrame::neutral(seat)
        };
        tungstenite::Message::Binary(frame.encode().to_vec().into())
    }
    /// A press and its release in the same burst, as after a gap on the link:
    /// the pads hold A for one picture before they let it go (audit ENT-2).
    #[test]
    fn a_tap_in_one_burst_holds_on_the_pads_for_one_picture() {
        let (_root, server, ingress, pads) = switch_room();
        let (mut socket, seat) = crate::browser::harness::hold(server.address());
        // As a browser does: without it, Nagle held the second frame behind
        // a delayed acknowledgement, and the two never left together.
        socket.get_ref().set_nodelay(true).unwrap();
        let seat = PlayerSlot::new(seat).unwrap();
        // The seat's arrival, then quiet, so the burst is all that is read.
        let _ = commands(&pads);
        let listening = thread::spawn(move || commands(&pads));
        socket.send(tap(seat, true)).unwrap();
        socket.send(tap(seat, false)).unwrap();
        let said = listening.join().unwrap();
        let pressed = said.iter().position(|(_, a)| *a);
        let Some(pressed) = pressed else {
            panic!("the press never reached the pads: {said:?}");
        };
        let released = said[pressed..]
            .iter()
            .find(|(_, a)| !*a)
            .map(|(at, _)| at.saturating_duration_since(said[pressed].0));
        let Some(held) = released else {
            panic!("the release never reached the pads: {said:?}");
        };
        assert!(
            held >= Duration::from_millis(15),
            "a tap held {held:?} on the pads, less than a picture"
        );
        // Let go at its time, not at the thread's next idle wake-up.
        assert!(
            held < Duration::from_millis(40),
            "the held release waited {held:?}, past its time"
        );
        assert!(said.last().is_some_and(|(_, a)| !*a), "A stayed down");
        // The report says the release was held, whichever way the race went:
        // both states read together (rescued), or the press read alone first.
        let kept = ingress.pads_report().unwrap().seats[seat.index()].kept;
        assert!(kept.deferred >= 1, "the held release was not counted");
    }
    /// Every state the page sends goes on to the pads, repeated or not, and
    /// the report counts both (audit WK-6): what a change of that traffic
    /// would save is measured before anybody changes it.
    #[test]
    fn the_report_counts_what_the_pads_were_sent() {
        let (_root, server, ingress, pads) = switch_room();
        let (mut socket, seat) = crate::browser::harness::hold(server.address());
        socket.get_ref().set_nodelay(true).unwrap();
        let seat = PlayerSlot::new(seat).unwrap();
        socket.send(tap(seat, false)).unwrap();
        let _ = commands(&pads);
        let _ = ingress.pads_report();
        let listening = thread::spawn(move || commands(&pads));
        for _ in 0..10 {
            socket.send(tap(seat, false)).unwrap();
            thread::sleep(Duration::from_millis(5));
        }
        socket.send(tap(seat, true)).unwrap();
        thread::sleep(Duration::from_millis(50));
        socket.send(tap(seat, false)).unwrap();
        let said = listening.join().unwrap();
        let report = ingress.pads_report().unwrap();
        let mine = report.seats[seat.index()];
        assert_eq!(
            mine.sent,
            u64::try_from(said.len()).unwrap(),
            "the pads were sent {} states and the report counted {}",
            said.len(),
            mine.sent
        );
        assert!(mine.sent >= 12, "only {} states were sent", mine.sent);
        assert_eq!(
            mine.repeated,
            mine.sent - 2,
            "only the press and its release changed anything"
        );
        assert!(report.send.is_some_and(|send| send.samples >= 12));
        // The twin: the other seats were sent nothing, and the next window
        // starts empty rather than at zero milliseconds.
        assert!(
            report
                .seats
                .iter()
                .enumerate()
                .all(|(index, other)| index == seat.index() || other.sent == 0)
        );
        let next = ingress.pads_report().unwrap();
        assert_eq!(next.seats[seat.index()].sent, 0);
        assert!(next.send.is_none(), "an empty window read as a measure");
    }
    /// The twin: a press held 100 ms is told at once, and let go at its time.
    #[test]
    fn a_long_press_reaches_the_pads_on_time_and_unchanged() {
        let (_root, server, _ingress, pads) = switch_room();
        let (mut socket, seat) = crate::browser::harness::hold(server.address());
        // As a browser does: without it, Nagle held the second frame behind
        // a delayed acknowledgement, and the two never left together.
        socket.get_ref().set_nodelay(true).unwrap();
        let seat = PlayerSlot::new(seat).unwrap();
        let _ = commands(&pads);
        let listening = thread::spawn(move || commands(&pads));
        let pressed_at = Instant::now();
        socket.send(tap(seat, true)).unwrap();
        thread::sleep(Duration::from_millis(100));
        let let_go = Instant::now();
        socket.send(tap(seat, false)).unwrap();
        let said = listening.join().unwrap();
        let pressed = said.iter().find(|(_, a)| *a).unwrap().0;
        let released = said.iter().rev().find(|(_, a)| !*a).unwrap().0;
        assert!(
            pressed.saturating_duration_since(pressed_at) < Duration::from_millis(15),
            "a long press waited {:?}",
            pressed.saturating_duration_since(pressed_at)
        );
        assert!(
            released.saturating_duration_since(let_go) < Duration::from_millis(15),
            "a long press was let go {:?} late",
            released.saturating_duration_since(let_go)
        );
    }
}
