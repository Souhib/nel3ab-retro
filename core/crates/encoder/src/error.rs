//! Everything the encoder can fail at, typed.

use std::path::PathBuf;
use std::time::Duration;

use thiserror::Error;

/// A failure receiving or accounting for emulator frames.
///
/// `#[non_exhaustive]`: the VAAPI and Vulkan variants land here once the FFI
/// module exists, and a caller who wrote an exhaustive `match` today should get
/// a compiler nudge then rather than a silently-wrong branch.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum EncoderError {
    /// The frame socket could not be created.
    #[error("binding the frame socket {path} failed")]
    Bind {
        /// Socket path.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// The emulator never connected.
    #[error("the emulator did not connect to the frame socket within {waited:?}")]
    NoProducer {
        /// How long we waited.
        waited: Duration,
    },

    /// A socket read or write failed.
    #[error("the frame socket failed while {what}")]
    Socket {
        /// What we were doing.
        what: &'static str,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// The producer closed the connection.
    #[error("the emulator closed the frame socket")]
    ProducerGone,

    /// A message was not the length its kind requires.
    ///
    /// Not recoverable on a stream socket: there is no framing to resynchronise
    /// against, so a short message means every later one would be misparsed.
    #[error("{what} must be exactly {expected} bytes, got {got}")]
    ShortMessage {
        /// Which message.
        what: &'static str,
        /// Bytes required.
        expected: usize,
        /// Bytes received.
        got: usize,
    },

    /// A message did not start with the magic its kind requires.
    #[error("{what} has magic {got:#010x}, expected {expected:#010x}")]
    BadMagic {
        /// Which message.
        what: &'static str,
        /// Magic we require.
        expected: u32,
        /// Magic we got.
        got: u32,
    },

    /// The producer speaks a different revision of the protocol.
    #[error("emulator speaks frame protocol v{got}, this build speaks v{expected}")]
    VersionMismatch {
        /// Revision we implement.
        expected: u32,
        /// Revision the producer announced.
        got: u32,
    },

    /// A descriptor named a slot outside its own ring.
    #[error("slot {slot} is outside a ring of {slot_count}")]
    SlotOutOfRange {
        /// The offending slot.
        slot: u32,
        /// Size of the ring.
        slot_count: u32,
    },

    /// A ring with no slots in it.
    #[error("the emulator announced a ring with no slots")]
    EmptyRing,

    /// A descriptor arrived without the file descriptor that gives it meaning.
    #[error("slot {slot} arrived without a dma-buf file descriptor")]
    MissingFd {
        /// The slot whose fd was absent.
        slot: u32,
    },

    /// The producer described the same slot twice, or skipped one.
    #[error("the emulator described slot {slot} twice")]
    DuplicateSlot {
        /// The repeated slot.
        slot: u32,
    },

    /// The DRM render node could not be opened.
    #[error("opening the render node {path} failed")]
    RenderNode {
        /// The node.
        path: PathBuf,
        /// Underlying OS error.
        #[source]
        source: std::io::Error,
    },

    /// libva refused a call.
    #[error("{what} failed: {message} ({status})")]
    Va {
        /// Which libva call.
        what: &'static str,
        /// The raw status code.
        status: i32,
        /// The driver's own description.
        message: String,
    },

    /// The libavcodec shim refused a call.
    ///
    /// The code is the shim's own, not ffmpeg's: libavcodec reports dozens of
    /// distinct `AVERROR`s for the same practical situation, and collapsing them
    /// at the C boundary keeps the meaning of each variant something a reader
    /// can act on.
    #[error("{what} failed: {message} ({code})")]
    Av {
        /// Which shim call.
        what: &'static str,
        /// The shim's status code.
        code: i32,
        /// What that code stands for.
        message: &'static str,
    },

    /// A frame size the encoder cannot express yet.
    ///
    /// Cropping is not written, so a picture that is not a whole number of
    /// macroblocks would encode its padding as picture.
    #[error("{width}x{height} is not a whole number of 16-pixel macroblocks")]
    UnsupportedSize {
        /// Requested width.
        width: u32,
        /// Requested height.
        height: u32,
    },

    /// The driver exported a surface in a shape this crate does not handle.
    ///
    /// Not a driver bug and not ours: a shape nobody has measured, which must be
    /// looked at rather than guessed around.
    #[error("the exported surface has an unexpected shape: {what}")]
    UnexpectedExport {
        /// What was unexpected.
        what: &'static str,
    },

    /// Slots in the same ring disagreed about their layout.
    ///
    /// Every slot is allocated together, from one modifier list, at one size —
    /// so a disagreement means we are talking to something that is not the
    /// patch we ship.
    #[error("slot {slot} describes a different layout from the rest of the ring")]
    InconsistentRing {
        /// The slot that disagreed.
        slot: u32,
    },
}
