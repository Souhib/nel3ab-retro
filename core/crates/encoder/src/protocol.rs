//! The wire format the patched Dolphin speaks.
//!
//! # Why this is spelled out byte by byte
//!
//! The other end of this protocol is C, in
//! `docker/dolphin-patches/0001-nel3ab-frame-export.patch`. There is no shared
//! header and no code generation, so the only thing keeping the two in step is
//! the tests below — which is why they assert exact offsets and exact lengths
//! rather than round-tripping our own encoder against our own decoder.
//!
//! Every field is little-endian because both ends are x86-64 and the C side
//! writes packed structs straight out. If this ever has to cross an
//! architecture, this module is the one place that changes.

use crate::error::EncoderError;

/// A ring descriptor, one per slot, each carrying a dma-buf fd.
///
/// The literal was meant to spell `'N3AB'`; little-endian it actually reads
/// `NBA3`, because the digits are transposed. **Do not "fix" it.** A magic is
/// arbitrary — all that matters is that both ends use the same number, and the C
/// side uses this one. Correcting the value would break every build of the patch
/// that is already out there, to make a comment true.
pub const HEADER_MAGIC: u32 = 0x3341_424e;
/// `'FRME'` — the GPU has finished writing a slot.
pub const FRAME_MAGIC: u32 = 0x454d_5246;
/// `'FREL'` — we are done with a slot and Dolphin may reuse it.
pub const RELEASE_MAGIC: u32 = 0x4c45_5246;

/// The protocol revision this crate speaks.
///
/// Bumped from 1 when the single reused image became a ring with explicit
/// release. A mismatch is refused rather than tolerated: version 1 had no slot
/// field, so reading it as version 2 would silently address the wrong image.
pub const PROTOCOL_VERSION: u32 = 2;

/// Bytes in a ring descriptor: eight `u32` then four `u64`.
pub const HEADER_LEN: usize = 64;
/// Bytes in a frame-ready notification.
pub const FRAME_READY_LEN: usize = 16;
/// Bytes in a release.
pub const RELEASE_LEN: usize = 8;

/// The layout of every image in the ring.
///
/// All slots share one descriptor: Dolphin allocates them together, from the
/// same modifier list, at the same size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameDescriptor {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// DRM fourcc; `ABGR8888` for the `VK_FORMAT_R8G8B8A8_UNORM` Dolphin exports.
    pub drm_format: u32,
    /// DRM format modifier the driver chose. Must be passed back verbatim when
    /// importing, or the tiling is reinterpreted and the picture is garbage.
    pub modifier: u64,
    /// Byte offset of the single plane within the buffer object.
    pub offset: u64,
    /// Bytes per row, which is NOT `width * 4` once tiling is involved.
    pub pitch: u64,
    /// Size of the whole buffer object.
    pub size: u64,
}

/// One ring descriptor as it arrives, before the fd is attached to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    /// Which slot this describes.
    pub slot: u32,
    /// How many slots the ring has in total.
    pub slot_count: u32,
    /// The shared layout.
    pub descriptor: FrameDescriptor,
}

/// A slot whose contents the GPU has finished writing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameReady {
    /// Which slot holds the frame.
    pub slot: u32,
    /// Monotonic counter from Dolphin, starting at 1.
    pub frame_number: u64,
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    // Every caller has already checked the slice length, and the offsets are
    // constants below — so the slice cannot fail and the array conversion cannot
    // either. `unwrap_or` keeps that fact from needing an `expect`, which the
    // workspace denies.
    let mut raw = [0u8; 4];
    raw.copy_from_slice(bytes.get(offset..offset + 4).unwrap_or(&[0; 4]));
    u32::from_le_bytes(raw)
}

fn u64_at(bytes: &[u8], offset: usize) -> u64 {
    let mut raw = [0u8; 8];
    raw.copy_from_slice(bytes.get(offset..offset + 8).unwrap_or(&[0; 8]));
    u64::from_le_bytes(raw)
}

impl Header {
    /// Parses a ring descriptor.
    ///
    /// # Errors
    /// [`EncoderError::ShortMessage`], [`EncoderError::BadMagic`],
    /// [`EncoderError::VersionMismatch`] or [`EncoderError::EmptyRing`].
    pub fn parse(bytes: &[u8]) -> Result<Self, EncoderError> {
        if bytes.len() != HEADER_LEN {
            return Err(EncoderError::ShortMessage {
                what: "ring descriptor",
                expected: HEADER_LEN,
                got: bytes.len(),
            });
        }
        let magic = u32_at(bytes, 0);
        if magic != HEADER_MAGIC {
            return Err(EncoderError::BadMagic {
                what: "ring descriptor",
                expected: HEADER_MAGIC,
                got: magic,
            });
        }
        let version = u32_at(bytes, 4);
        if version != PROTOCOL_VERSION {
            return Err(EncoderError::VersionMismatch {
                expected: PROTOCOL_VERSION,
                got: version,
            });
        }
        let slot_count = u32_at(bytes, 12);
        let slot = u32_at(bytes, 8);
        if slot_count == 0 {
            return Err(EncoderError::EmptyRing);
        }
        if slot >= slot_count {
            return Err(EncoderError::SlotOutOfRange { slot, slot_count });
        }
        Ok(Self {
            slot,
            slot_count,
            descriptor: FrameDescriptor {
                width: u32_at(bytes, 16),
                height: u32_at(bytes, 20),
                drm_format: u32_at(bytes, 24),
                // bytes 28..32 are the C side's explicit padding.
                modifier: u64_at(bytes, 32),
                offset: u64_at(bytes, 40),
                pitch: u64_at(bytes, 48),
                size: u64_at(bytes, 56),
            },
        })
    }
}

impl FrameReady {
    /// Parses a frame-ready notification.
    ///
    /// # Errors
    /// [`EncoderError::ShortMessage`] or [`EncoderError::BadMagic`].
    pub fn parse(bytes: &[u8]) -> Result<Self, EncoderError> {
        if bytes.len() != FRAME_READY_LEN {
            return Err(EncoderError::ShortMessage {
                what: "frame notification",
                expected: FRAME_READY_LEN,
                got: bytes.len(),
            });
        }
        let magic = u32_at(bytes, 0);
        if magic != FRAME_MAGIC {
            return Err(EncoderError::BadMagic {
                what: "frame notification",
                expected: FRAME_MAGIC,
                got: magic,
            });
        }
        Ok(Self {
            slot: u32_at(bytes, 4),
            frame_number: u64_at(bytes, 8),
        })
    }
}

/// Builds the release Dolphin is waiting for.
#[must_use]
pub fn encode_release(slot: u32) -> [u8; RELEASE_LEN] {
    let mut out = [0u8; RELEASE_LEN];
    out[0..4].copy_from_slice(&RELEASE_MAGIC.to_le_bytes());
    out[4..8].copy_from_slice(&slot.to_le_bytes());
    out
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Builds the bytes the C side would write, from field offsets rather than
    /// from our own parser — otherwise the test would only prove we are
    /// self-consistent, which is exactly the failure mode that matters here.
    fn c_header(slot: u32, slot_count: u32) -> [u8; HEADER_LEN] {
        let mut b = [0u8; HEADER_LEN];
        b[0..4].copy_from_slice(&HEADER_MAGIC.to_le_bytes());
        b[4..8].copy_from_slice(&PROTOCOL_VERSION.to_le_bytes());
        b[8..12].copy_from_slice(&slot.to_le_bytes());
        b[12..16].copy_from_slice(&slot_count.to_le_bytes());
        b[16..20].copy_from_slice(&640u32.to_le_bytes());
        b[20..24].copy_from_slice(&480u32.to_le_bytes());
        b[24..28].copy_from_slice(&0x3432_4241u32.to_le_bytes());
        b[32..40].copy_from_slice(&0x0200_0000_1860_1b03u64.to_le_bytes());
        b[40..48].copy_from_slice(&0u64.to_le_bytes());
        b[48..56].copy_from_slice(&2560u64.to_le_bytes());
        b[56..64].copy_from_slice(&1_310_720u64.to_le_bytes());
        b
    }

    #[test]
    fn a_real_descriptor_parses_to_the_values_the_gpu_reported() {
        // These are the numbers the running patch actually produced on the
        // RX 6650 XT, not invented ones.
        let header = Header::parse(&c_header(1, 3)).unwrap();
        assert_eq!(header.slot, 1);
        assert_eq!(header.slot_count, 3);
        assert_eq!(
            header.descriptor,
            FrameDescriptor {
                width: 640,
                height: 480,
                drm_format: 0x3432_4241,
                modifier: 0x0200_0000_1860_1b03,
                offset: 0,
                pitch: 2560,
                size: 1_310_720,
            }
        );
    }

    #[test]
    fn the_pitch_is_not_width_times_four() {
        // 640 * 4 = 2560 here by coincidence at this resolution, so pin the
        // intent instead: the pitch is read from the wire, never computed.
        let header = Header::parse(&c_header(0, 3)).unwrap();
        assert_eq!(header.descriptor.pitch, 2560);
        assert!(header.descriptor.pitch >= u64::from(header.descriptor.width) * 4);
    }

    #[test]
    fn a_wrong_magic_is_refused_rather_than_parsed() {
        let mut bytes = c_header(0, 3);
        bytes[0] ^= 0xff;
        assert!(matches!(
            Header::parse(&bytes),
            Err(EncoderError::BadMagic { .. })
        ));
    }

    #[test]
    fn an_older_protocol_is_refused_instead_of_misread() {
        // Version 1 had no slot field. Reading it as version 2 would address a
        // different image and look almost right.
        let mut bytes = c_header(0, 3);
        bytes[4..8].copy_from_slice(&1u32.to_le_bytes());
        assert!(matches!(
            Header::parse(&bytes),
            Err(EncoderError::VersionMismatch { got: 1, .. })
        ));
    }

    #[test]
    fn a_slot_outside_the_ring_is_refused() {
        let mut bytes = c_header(0, 3);
        bytes[8..12].copy_from_slice(&3u32.to_le_bytes());
        assert!(matches!(
            Header::parse(&bytes),
            Err(EncoderError::SlotOutOfRange {
                slot: 3,
                slot_count: 3
            })
        ));
    }

    #[test]
    fn a_ring_of_zero_slots_is_refused() {
        let mut bytes = c_header(0, 3);
        bytes[12..16].copy_from_slice(&0u32.to_le_bytes());
        assert!(matches!(
            Header::parse(&bytes),
            Err(EncoderError::EmptyRing)
        ));
    }

    #[test]
    fn any_length_but_the_exact_one_is_refused() {
        // Negative twin of the parse tests: accepting the right bytes is
        // worthless if a truncated message is also accepted.
        for len in [0, HEADER_LEN - 1, HEADER_LEN + 1] {
            assert!(matches!(
                Header::parse(&vec![0u8; len]),
                Err(EncoderError::ShortMessage { .. })
            ));
        }
    }

    #[test]
    fn a_frame_notification_parses() {
        let mut b = [0u8; FRAME_READY_LEN];
        b[0..4].copy_from_slice(&FRAME_MAGIC.to_le_bytes());
        b[4..8].copy_from_slice(&2u32.to_le_bytes());
        b[8..16].copy_from_slice(&600u64.to_le_bytes());
        let ready = FrameReady::parse(&b).unwrap();
        assert_eq!(ready.slot, 2);
        assert_eq!(ready.frame_number, 600);
    }

    #[test]
    fn a_release_is_eight_bytes_the_c_side_recognises() {
        let bytes = encode_release(2);
        assert_eq!(bytes.len(), RELEASE_LEN);
        assert_eq!(&bytes[0..4], &RELEASE_MAGIC.to_le_bytes());
        assert_eq!(&bytes[4..8], &2u32.to_le_bytes());
    }

    #[test]
    fn the_magics_are_the_bytes_actually_on_the_wire() {
        // Pinned to what the wire carries, not to what the comments intended.
        // The header magic reads NBA3: the literal's digits are transposed, and
        // this assertion is what stops someone correcting the value to match the
        // comment and silently breaking compatibility with the shipped patch.
        assert_eq!(&HEADER_MAGIC.to_le_bytes(), b"NBA3");
        assert_eq!(&FRAME_MAGIC.to_le_bytes(), b"FRME");
        assert_eq!(&RELEASE_MAGIC.to_le_bytes(), b"FREL");
    }
}
