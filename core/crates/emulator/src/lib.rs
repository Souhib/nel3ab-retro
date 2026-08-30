//! Owns the Dolphin process and its input pipes.
//!
//! Inputs reach Dolphin through **named pipes** (`Device = Pipe/0/p1`), never
//! uinput or SDL: a pipe binds by FILE NAME, so player 2 is player 2 because we
//! named the file, not because an enumeration order happened to hold. That
//! single choice removes the unstable-index class of bug outright.
//!
//! Milestone: M1.
//!
//! # Shape of the crate
//!
//! | Module | Holds | Needs Dolphin to test? |
//! |---|---|---|
//! | [`wire`] | the ASCII grammar, as pure functions | no |
//! | [`config`] | the generated `.ini` files | no |
//! | [`slots`] | which ports a session serves | no |
//! | [`pipe`] | FIFO creation and the persistent writers | no — a test FIFO is a real FIFO |
//! | [`process`] | spawn, health, shutdown | only for the integration test |
//!
//! Only [`process`] needs a real emulator, and only to prove the wiring. Every
//! decision the crate makes is tested without one.
//!
//! # The three things Dolphin will not tell you
//!
//! All of these fail *silently* — no error, no log line, no exit code — which is
//! why so much of this crate is byte-exact assertions rather than "it worked":
//!
//! 1. A malformed pipe command is discarded by the parser without a word.
//! 2. An `.ini` expression that binds nothing leaves the button dead.
//! 3. A FIFO created after startup is never seen: the pipe directory is scanned
//!    exactly once.
//!
//! # Typical use
//!
//! ```no_run
//! use std::path::PathBuf;
//! use nel3ab_emulator::{DolphinConfig, Session, SlotSet};
//! use nel3ab_protocol::{InputFrame, PlayerSlot};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let slot = PlayerSlot::new(1)?;
//! let config = DolphinConfig::new(
//!     PathBuf::from("/usr/bin/dolphin-emu-nogui"),
//!     PathBuf::from("/roms/gc/melee-ntsc.rvz"),
//!     PathBuf::from("/run/nel3ab/session-1"),
//!     SlotSet::EMPTY.with(slot),
//! );
//!
//! let mut session = Session::start(&config)?;
//! session.send(&InputFrame::neutral(slot))?;
//! session.shutdown()?;
//! # Ok(())
//! # }
//! ```

#![forbid(unsafe_code)]

pub mod banner;
pub mod config;
pub mod error;
pub mod library;
pub mod nap;
pub mod pipe;
pub mod process;
pub mod rumble;
pub mod saves;
pub mod slots;
mod sound;
pub mod wire;

pub use error::EmulatorError;
pub use library::{Rom, catalogue_json, scan as scan_roms};
pub use pipe::{Delivery, PendingPipes, Pipes};
pub use process::{ConfigOverride, DolphinConfig, Session, VideoBackend};
pub use slots::SlotSet;
pub use sound::{CHUNK, CHUNK_BYTES, CHUNK_FRAMES, SoundTap};
pub use wire::PadState;
