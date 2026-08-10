//! The FIFOs that carry input into Dolphin.
//!
//! # The ordering constraint this module encodes
//!
//! Dolphin scans its pipe directory **once**, while the input backend starts,
//! and never rescans. So the only workable order is: create every FIFO, start
//! Dolphin, then open the write ends. Getting it wrong does not raise anything —
//! the pad simply never appears.
//!
//! That order is expressed in the types rather than in a comment: [`PendingPipes`]
//! is what exists before Dolphin runs and cannot send anything, [`Pipes`] is what
//! exists after and can. There is no constructor for [`Pipes`] that skips the
//! first state.
//!
//! # Why the write end is non-blocking
//!
//! Opening a FIFO `O_WRONLY` normally blocks until a reader arrives, which would
//! turn "wait for Dolphin" into an uninterruptible sleep with no way to notice
//! that Dolphin died. `O_NONBLOCK` instead fails with `ENXIO` while no reader is
//! attached, so readiness becomes a syscall we can poll between liveness checks.
//!
//! The same flag makes writes fail with `EAGAIN` instead of blocking when the
//! pipe is full. That is the right behaviour for a realtime input path and not a
//! compromise: a stalled write would hold up every other player, whereas a
//! dropped frame is corrected by the next one ~8 ms later.

use std::fs::{File, OpenOptions};
use std::io::Write as _;
use std::os::unix::fs::OpenOptionsExt as _;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use nel3ab_protocol::{InputFrame, PlayerSlot};
use nix::errno::Errno;
use nix::fcntl::OFlag;
use nix::sys::stat::Mode;

use crate::config::{PIPES_DIR, pipe_file_name};
use crate::error::EmulatorError;
use crate::slots::SlotSet;
use crate::wire::{self, PadState};

/// How often the attach loop retries an `ENXIO` open.
///
/// Dolphin takes seconds to reach input-backend init, so a tighter poll would
/// only burn syscalls; a looser one would add its own latency to session start.
const ATTACH_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Permissions on a created FIFO: owner read/write only.
///
/// Anyone who can write this file can play as that player. There is no
/// authentication on a pipe, so the file mode IS the access control, and the
/// worker and Dolphin are expected to run as the same uid.
const FIFO_MODE: Mode = Mode::S_IRUSR.union(Mode::S_IWUSR);

/// What became of one call to [`Pipes::send`].
///
/// Three outcomes rather than `()` because two of them are worth counting and
/// only one of them is an error. In particular `Dropped` is a normal, bounded
/// event on a busy pipe, not a fault — collapsing it into `Ok(())` would hide
/// the one signal that says the input path is falling behind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use]
pub enum Delivery {
    /// The command batch reached the pipe.
    Written,
    /// Nothing to send: this state is identical to the last one Dolphin received.
    Coalesced,
    /// The pipe was full. The frame was discarded and the encoder's idea of
    /// Dolphin's state was left untouched, so the next send re-derives the
    /// difference from what Dolphin actually has.
    Dropped,
}

/// One player's FIFO, created on disk but not yet opened for writing.
#[derive(Debug)]
struct PendingPadPipe {
    slot: PlayerSlot,
    path: PathBuf,
}

/// Every FIFO for a session, created but not yet attached.
///
/// Holding one of these means Dolphin can be started: the files it will scan for
/// all exist.
#[derive(Debug)]
pub struct PendingPipes {
    dir: PathBuf,
    pending: Vec<PendingPadPipe>,
}

impl PendingPipes {
    /// Creates `<user_dir>/Pipes/pN` for every served port.
    ///
    /// An existing path is removed first. A FIFO left behind by a crashed run
    /// would otherwise be reused with whatever readers it still had, and a
    /// regular file of the same name would be accepted by Dolphin's scan and
    /// then never deliver anything.
    ///
    /// # Errors
    /// [`EmulatorError::PipeDirectory`] or [`EmulatorError::CreateFifo`].
    pub fn create(user_dir: &Path, slots: SlotSet) -> Result<Self, EmulatorError> {
        let dir = user_dir.join(PIPES_DIR);
        std::fs::create_dir_all(&dir).map_err(|source| EmulatorError::PipeDirectory {
            path: dir.clone(),
            source,
        })?;

        let mut pending = Vec::with_capacity(slots.len() as usize);
        for slot in slots.iter() {
            let path = dir.join(pipe_file_name(slot));
            if path.exists() {
                std::fs::remove_file(&path).map_err(|source| EmulatorError::CreateFifo {
                    path: path.clone(),
                    source,
                })?;
            }
            nix::unistd::mkfifo(&path, FIFO_MODE).map_err(|errno| EmulatorError::CreateFifo {
                path: path.clone(),
                source: errno_to_io(errno),
            })?;
            tracing::debug!(slot = slot.get(), path = %path.display(), "created input FIFO");
            pending.push(PendingPadPipe { slot, path });
        }

        Ok(Self { dir, pending })
    }

    /// The directory Dolphin must be pointed at.
    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Opens the write end of every FIFO, waiting for Dolphin to attach.
    ///
    /// `liveness` is called between attempts so a Dolphin that died during
    /// startup is reported as [`EmulatorError::ExitedDuringStartup`] rather than
    /// as a timeout thirty seconds later — the difference between a diagnosis
    /// and a shrug.
    ///
    /// # Errors
    /// [`EmulatorError::PipeNeverRead`] on timeout, [`EmulatorError::OpenFifo`]
    /// on any other open failure, or whatever `liveness` reports.
    pub fn attach_all<F>(self, timeout: Duration, mut liveness: F) -> Result<Pipes, EmulatorError>
    where
        F: FnMut() -> Result<(), EmulatorError>,
    {
        let started = Instant::now();
        let mut pads = Vec::with_capacity(self.pending.len());

        for pending in self.pending {
            loop {
                liveness()?;
                if let Some(writer) = try_open_writer(&pending.path)? {
                    tracing::debug!(slot = pending.slot.get(), "Dolphin attached to FIFO");
                    pads.push(PadPipe {
                        slot: pending.slot,
                        path: pending.path,
                        writer,
                        last: None,
                        scratch: String::with_capacity(wire::MAX_BATCH_LEN),
                    });
                    break;
                }
                let waited = started.elapsed();
                if waited >= timeout {
                    return Err(EmulatorError::PipeNeverRead {
                        path: pending.path,
                        slot: pending.slot,
                        waited,
                    });
                }
                std::thread::sleep(ATTACH_POLL_INTERVAL);
            }
        }

        Ok(Pipes { pads })
    }
}

/// Every FIFO for a session, with a persistent write end held open.
///
/// # Why the file descriptor is held for the whole session
///
/// When the last writer closes, the reader's next `read` returns EOF. Dolphin
/// treats that as "nothing to read" and keeps the device, so nothing breaks
/// loudly — but reopening per write would race that EOF against the next open
/// and cost two syscalls on a path walked 60 times a second per player. One fd,
/// opened once, has neither problem.
///
/// Deleting the FIFO files is deliberately NOT done here. The session owns the
/// user directory and removes the whole thing; splitting cleanup across two
/// owners is how half-deleted state happens.
#[derive(Debug)]
pub struct Pipes {
    pads: Vec<PadPipe>,
}

impl Pipes {
    /// Routes a client frame to the pipe for its slot.
    ///
    /// The frame carries the slot, so the caller never picks the pipe — which is
    /// what makes it impossible to diff one player's state against another's.
    ///
    /// # Errors
    /// [`EmulatorError::UnknownSlot`] if this session serves no such port, or a
    /// write failure from the underlying pipe.
    pub fn send(&mut self, frame: &InputFrame) -> Result<Delivery, EmulatorError> {
        let state = PadState::from_frame(frame);
        if let Some(pad) = self.pads.iter_mut().find(|pad| pad.slot == frame.slot) {
            return pad.send(state);
        }
        Err(EmulatorError::UnknownSlot {
            slot: frame.slot,
            configured: self.pads.iter().map(|pad| pad.slot).collect(),
        })
    }

    /// Forces the next send on every pipe to transmit a full state.
    ///
    /// The diff is only valid while our record of Dolphin's state is. After
    /// anything that could have desynchronised them, re-sending everything is
    /// the only way back — a diff computed from a wrong baseline can leave a
    /// button held down with no later frame that would ever release it.
    pub fn resync(&mut self) {
        for pad in &mut self.pads {
            pad.last = None;
        }
    }

    /// The ports this session serves.
    #[must_use]
    pub fn slots(&self) -> SlotSet {
        self.pads.iter().map(|pad| pad.slot).collect()
    }
}

/// One player's FIFO with its write end open.
#[derive(Debug)]
struct PadPipe {
    slot: PlayerSlot,
    path: PathBuf,
    writer: File,
    /// The state Dolphin is believed to hold, or `None` before the first sync.
    last: Option<PadState>,
    /// Reused across sends so the hot path does not allocate.
    scratch: String,
}

impl PadPipe {
    fn send(&mut self, state: PadState) -> Result<Delivery, EmulatorError> {
        match self.last {
            Some(previous) if previous == state => return Ok(Delivery::Coalesced),
            Some(previous) => {
                self.scratch.clear();
                wire::encode_delta(previous, state, &mut self.scratch);
            }
            None => {
                self.scratch.clear();
                wire::encode_full(state, &mut self.scratch);
            }
        }

        match self.writer.write(self.scratch.as_bytes()) {
            Ok(written) if written == self.scratch.len() => {
                self.last = Some(state);
                Ok(Delivery::Written)
            }
            Ok(written) => Err(EmulatorError::TornWrite {
                path: self.path.clone(),
                wrote: written,
                len: self.scratch.len(),
            }),
            Err(source) if source.kind() == std::io::ErrorKind::WouldBlock => {
                // `last` is deliberately NOT advanced: Dolphin never saw this
                // batch, so the next frame must still diff against the state it
                // actually holds. Advancing here would drop the change forever.
                tracing::warn!(slot = self.slot.get(), "input pipe full, frame dropped");
                Ok(Delivery::Dropped)
            }
            Err(source) => Err(EmulatorError::WriteFifo {
                path: self.path.clone(),
                source,
            }),
        }
    }
}

/// `Ok(None)` means no reader has attached yet — the caller should retry.
fn try_open_writer(path: &Path) -> Result<Option<File>, EmulatorError> {
    match OpenOptions::new()
        .write(true)
        .custom_flags(OFlag::O_NONBLOCK.bits())
        .open(path)
    {
        Ok(file) => Ok(Some(file)),
        // ENXIO on a write-only non-blocking FIFO open means exactly one thing:
        // nobody has the read end yet.
        Err(source) if source.raw_os_error() == Some(Errno::ENXIO as i32) => Ok(None),
        Err(source) => Err(EmulatorError::OpenFifo {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn errno_to_io(errno: Errno) -> std::io::Error {
    std::io::Error::from_raw_os_error(errno as i32)
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;
    use nel3ab_protocol::{Buttons, Stick};
    use std::io::Read as _;

    fn slot(raw: u8) -> PlayerSlot {
        PlayerSlot::new(raw).unwrap()
    }

    /// Stands in for Dolphin: holds the read end open, non-blocking, and drains
    /// on demand. Everything below is a real FIFO exercised through real
    /// syscalls — the only thing missing is the emulator itself.
    struct FakeDolphin {
        reader: File,
    }

    impl FakeDolphin {
        fn attach(path: &Path) -> Self {
            let reader = OpenOptions::new()
                .read(true)
                .custom_flags(OFlag::O_NONBLOCK.bits())
                .open(path)
                .unwrap();
            Self { reader }
        }

        fn drain(&mut self) -> String {
            let mut out = Vec::new();
            let mut chunk = [0u8; 4096];
            while let Ok(n) = self.reader.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                out.extend_from_slice(&chunk[..n]);
            }
            String::from_utf8(out).unwrap()
        }
    }

    /// Creates the FIFOs, attaches a fake reader to each, then attaches the
    /// writers — the same order Dolphin imposes.
    fn session(slots: SlotSet) -> (tempfile::TempDir, Pipes, Vec<FakeDolphin>) {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingPipes::create(dir.path(), slots).unwrap();
        let readers: Vec<FakeDolphin> = slots
            .iter()
            .map(|s| FakeDolphin::attach(&pending.dir().join(pipe_file_name(s))))
            .collect();
        let pipes = pending
            .attach_all(Duration::from_secs(5), || Ok(()))
            .unwrap();
        (dir, pipes, readers)
    }

    #[test]
    fn a_created_pipe_is_a_fifo_at_the_path_the_ini_names() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingPipes::create(dir.path(), SlotSet::ALL).unwrap();
        for raw in 1..=4 {
            let path = dir.path().join(PIPES_DIR).join(format!("p{raw}"));
            let meta = std::fs::metadata(&path).unwrap();
            assert!(
                std::os::unix::fs::FileTypeExt::is_fifo(&meta.file_type()),
                "{} is not a FIFO",
                path.display()
            );
        }
        drop(pending);
    }

    #[test]
    fn attaching_times_out_when_nobody_reads() {
        // Negative twin of the happy path: if `attach_all` returned Ok without a
        // reader, every test below would pass against a pipe Dolphin never
        // opened, and so would production.
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingPipes::create(dir.path(), SlotSet::EMPTY.with(slot(1))).unwrap();
        let error = pending
            .attach_all(Duration::from_millis(80), || Ok(()))
            .unwrap_err();
        assert!(
            matches!(error, EmulatorError::PipeNeverRead { slot: s, .. } if s == slot(1)),
            "got {error:?}"
        );
    }

    #[test]
    fn attaching_reports_a_dead_emulator_instead_of_waiting_out_the_timeout() {
        let dir = tempfile::tempdir().unwrap();
        let pending = PendingPipes::create(dir.path(), SlotSet::EMPTY.with(slot(1))).unwrap();
        let started = Instant::now();
        let error = pending
            .attach_all(Duration::from_secs(30), || {
                Err(EmulatorError::ExitedDuringStartup {
                    status: std::process::Command::new("false").status().unwrap(),
                })
            })
            .unwrap_err();
        assert!(matches!(error, EmulatorError::ExitedDuringStartup { .. }));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "waited too long"
        );
    }

    #[test]
    fn the_first_send_transmits_a_full_state() {
        // Dolphin's initial pad state is only accidentally neutral (it sets both
        // half-axes to 0.5, which cancels). Assuming it would make the first
        // diff a guess about a process we have never spoken to.
        let (_dir, mut pipes, mut readers) = session(SlotSet::EMPTY.with(slot(1)));
        let frame = InputFrame::neutral(slot(1));
        assert_eq!(pipes.send(&frame).unwrap(), Delivery::Written);

        let received = readers[0].drain();
        assert!(received.contains("RELEASE A\n"), "{received}");
        assert!(
            received.contains("SET MAIN 0.50000 0.50000\n"),
            "{received}"
        );
        assert_eq!(received.lines().count(), 16);
    }

    #[test]
    fn a_repeated_state_puts_nothing_on_the_wire() {
        let (_dir, mut pipes, mut readers) = session(SlotSet::EMPTY.with(slot(1)));
        let frame = InputFrame::neutral(slot(1));
        assert_eq!(pipes.send(&frame).unwrap(), Delivery::Written);
        readers[0].drain();

        assert_eq!(pipes.send(&frame).unwrap(), Delivery::Coalesced);
        assert_eq!(readers[0].drain(), "");
    }

    #[test]
    fn a_change_transmits_only_the_difference() {
        let (_dir, mut pipes, mut readers) = session(SlotSet::EMPTY.with(slot(1)));
        assert_eq!(
            pipes.send(&InputFrame::neutral(slot(1))).unwrap(),
            Delivery::Written
        );
        readers[0].drain();

        let pressed = InputFrame {
            buttons: Buttons::A,
            ..InputFrame::neutral(slot(1))
        };
        assert_eq!(pipes.send(&pressed).unwrap(), Delivery::Written);
        assert_eq!(readers[0].drain(), "PRESS A\n");
    }

    #[test]
    fn each_player_reaches_only_its_own_pipe() {
        // The property the whole named-pipe design exists for (ADR D3): player 2
        // is player 2 because of the file name, with nothing enumerating.
        let (_dir, mut pipes, mut readers) = session(SlotSet::ALL);
        let frame = InputFrame {
            buttons: Buttons::Z,
            ..InputFrame::neutral(slot(3))
        };
        assert_eq!(pipes.send(&frame).unwrap(), Delivery::Written);

        assert!(readers[2].drain().contains("PRESS Z\n"));
        for index in [0, 1, 3] {
            assert_eq!(
                readers[index].drain(),
                "",
                "slot {} was written to",
                index + 1
            );
        }
    }

    #[test]
    fn a_frame_for_an_unserved_port_is_rejected_not_misrouted() {
        let (_dir, mut pipes, _readers) = session(SlotSet::EMPTY.with(slot(1)));
        let error = pipes.send(&InputFrame::neutral(slot(2))).unwrap_err();
        assert!(
            matches!(error, EmulatorError::UnknownSlot { slot: s, .. } if s == slot(2)),
            "got {error:?}"
        );
    }

    #[test]
    fn a_dropped_frame_does_not_desynchronise_the_diff() {
        // The subtle one. If a full pipe advanced our record of Dolphin's state,
        // the change in the dropped batch would never be re-sent by any later
        // frame — a stick could stay deflected for the rest of the match.
        //
        // The assertion is deliberately "re-send the SAME state and expect it on
        // the wire". An earlier version sent a DIFFERENT follow-up state and
        // passed even with the bug reintroduced, because a different state
        // re-derives those fields anyway. Only the identical state distinguishes
        // "we kept Dolphin's real state" from "we recorded one it never got".
        let (_dir, mut pipes, mut readers) = session(SlotSet::EMPTY.with(slot(1)));
        assert_eq!(
            pipes.send(&InputFrame::neutral(slot(1))).unwrap(),
            Delivery::Written
        );
        readers[0].drain();

        // Fill the pipe without draining it. 64 KiB is the default capacity, and
        // each distinct frame writes tens of bytes, so this reaches EAGAIN.
        let mut dropped = None;
        for step in 1..=4000i16 {
            let frame = InputFrame {
                main: Stick::new(step, 0),
                ..InputFrame::neutral(slot(1))
            };
            if pipes.send(&frame).unwrap() == Delivery::Dropped {
                dropped = Some(frame);
                break;
            }
        }
        let dropped = dropped.expect("the pipe never filled; the test proved nothing");

        // Make room again, then ask for exactly the state that was lost.
        readers[0].drain();
        assert_eq!(
            pipes.send(&dropped).unwrap(),
            Delivery::Written,
            "the dropped state was treated as already delivered"
        );

        let received = readers[0].drain();
        let expected = {
            let mut out = String::new();
            wire::encode_full(PadState::from_frame(&dropped), &mut out);
            out.lines()
                .find(|line| line.starts_with("SET MAIN "))
                .unwrap()
                .to_owned()
        };
        assert!(
            received.contains(&expected),
            "expected {expected:?} on the wire, got {received:?}"
        );
    }

    #[test]
    fn resync_retransmits_everything() {
        let (_dir, mut pipes, mut readers) = session(SlotSet::EMPTY.with(slot(1)));
        let frame = InputFrame::neutral(slot(1));
        assert_eq!(pipes.send(&frame).unwrap(), Delivery::Written);
        readers[0].drain();

        pipes.resync();
        assert_eq!(pipes.send(&frame).unwrap(), Delivery::Written);
        assert_eq!(readers[0].drain().lines().count(), 16);
    }

    #[test]
    fn reported_slots_match_what_was_created() {
        let (_dir, pipes, _readers) = session(SlotSet::EMPTY.with(slot(2)).with(slot(4)));
        assert_eq!(pipes.slots(), SlotSet::EMPTY.with(slot(2)).with(slot(4)));
    }

    #[test]
    fn creating_over_a_stale_path_replaces_it() {
        // A crashed run leaves its FIFOs behind, and a regular file of the same
        // name would be scanned by Dolphin and then never deliver anything.
        let dir = tempfile::tempdir().unwrap();
        let pipes_dir = dir.path().join(PIPES_DIR);
        std::fs::create_dir_all(&pipes_dir).unwrap();
        std::fs::write(pipes_dir.join("p1"), b"stale").unwrap();

        PendingPipes::create(dir.path(), SlotSet::EMPTY.with(slot(1))).unwrap();

        let meta = std::fs::metadata(pipes_dir.join("p1")).unwrap();
        assert!(std::os::unix::fs::FileTypeExt::is_fifo(&meta.file_type()));
    }
}
