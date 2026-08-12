//! Everything this crate can fail at, typed.
//!
//! No variant here is decorative: each one names a failure that was actually
//! reachable while getting M1 to work, and each carries the path or status a
//! reader needs to act on it. A worker that logs `EmulatorError` should never
//! have to also log "…somewhere in the emulator".

use std::path::PathBuf;
use std::process::ExitStatus;
use std::time::Duration;

use nel3ab_protocol::PlayerSlot;
use thiserror::Error;

/// A failure in the emulator's process or input plumbing.
///
/// `#[non_exhaustive]`: M2 adds video capture to this crate, and a caller that
/// wrote an exhaustive `match` today should get a compiler nudge then rather
/// than a silently-wrong branch.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum EmulatorError {
    /// A holder of the input pipes panicked while writing.
    ///
    /// Recorded as an error rather than a panic of our own: rule 6 says the
    /// worker must not die, and a poisoned lock is exactly the moment that
    /// matters — one player's thread failing must not take the session with it.
    #[error("the input pipes are poisoned; a writer panicked")]
    PipesPoisoned,

    /// The directory Dolphin scans for pipes could not be created.
    #[error("creating the pipe directory {path} failed")]
    PipeDirectory {
        /// Directory we tried to create.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// `mkfifo` failed for one player's pipe.
    #[error("creating the FIFO {path} failed")]
    CreateFifo {
        /// FIFO we tried to create.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// Opening the write end failed for a reason other than "no reader yet".
    #[error("opening the write end of {path} failed")]
    OpenFifo {
        /// FIFO we tried to open.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// Dolphin never opened the read end of a pipe.
    ///
    /// Almost always means Dolphin did not see the FIFO: it scans its pipe
    /// directory exactly once, during input-backend init, and never rescans. A
    /// FIFO created even slightly late is a FIFO Dolphin will ignore for the
    /// entire session.
    #[error("Dolphin never opened {path} for slot {slot:?} within {waited:?}")]
    PipeNeverRead {
        /// The FIFO nobody attached to.
        path: PathBuf,
        /// Which player it belonged to.
        slot: PlayerSlot,
        /// How long we waited before giving up.
        waited: Duration,
    },

    /// Writing a command batch to a pipe failed.
    ///
    /// A `BrokenPipe` source means Dolphin closed its read end — the session is
    /// over. Rust sets `SIGPIPE` to `SIG_IGN` before `main`, so this arrives as
    /// an error rather than killing the worker outright.
    #[error("writing to {path} failed")]
    WriteFifo {
        /// The FIFO we were writing to.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// A write transferred only part of a command batch.
    ///
    /// This should be unreachable: POSIX makes a write of at most `PIPE_BUF`
    /// bytes to a FIFO atomic, and a test pins our worst-case batch well under
    /// that. It is an error rather than an `unwrap` because the cost of being
    /// wrong is a half-parsed command in a live game, and a worker must not
    /// panic to report it.
    #[error("torn write to {path}: {wrote} of {len} bytes reached the pipe")]
    TornWrite {
        /// The FIFO we were writing to.
        path: PathBuf,
        /// Bytes that made it.
        wrote: usize,
        /// Bytes we asked for.
        len: usize,
    },

    /// A client sent a frame for a slot this session has no pipe for.
    ///
    /// A boundary check, not an invariant: the room decides which slots exist
    /// (ADR D4) while the slot number arrives from a browser, so the two can
    /// legitimately disagree and the worker must say so rather than guess.
    #[error("no pipe for slot {slot:?}: this session serves {configured:?}")]
    UnknownSlot {
        /// The slot the client asked for.
        slot: PlayerSlot,
        /// The slots this session actually serves.
        configured: Vec<PlayerSlot>,
    },

    /// A generated Dolphin config file could not be written.
    #[error("writing the Dolphin config {path} failed")]
    WriteConfig {
        /// File we tried to write.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// The Dolphin binary could not be started.
    #[error("spawning {binary} failed")]
    Spawn {
        /// Binary we tried to execute.
        binary: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// Dolphin exited before it was ready to take input.
    #[error("Dolphin exited during startup: {status}")]
    ExitedDuringStartup {
        /// How it exited.
        status: ExitStatus,
    },

    /// Signalling or reaping the Dolphin process failed.
    #[error("controlling the Dolphin process (pid {pid}) failed")]
    ProcessControl {
        /// The process we lost control of.
        pid: u32,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// A `-C` override was not expressible in Dolphin's command-line grammar.
    #[error("invalid config override {field} = {value:?}: {reason}")]
    InvalidOverride {
        /// Which part was rejected.
        field: &'static str,
        /// The rejected text.
        value: String,
        /// Why it cannot be sent.
        reason: &'static str,
    },
}
