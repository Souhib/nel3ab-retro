//! Safe ownership over the libavcodec H.264 encoder.
//!
//! # Why this exists and [`crate::va`] no longer encodes
//!
//! ADR **D7**: libavcodec drives the encode. The hand-written libva encoder is
//! gone — not because it crashed, but because even working it was all-intra with
//! no rate control, and finishing it meant a DPB, reference management and a
//! rate controller at the same "returns success, produces rubbish" risk profile
//! that cost this milestone most of its length.
//!
//! # What D5 still holds
//!
//! The surfaces come out of **libavcodec's** pool now, not ours. That was the
//! question that could have killed the idea, because ADR D5's whole pipeline is
//! a compute shader writing NV12 straight into the surface the video engine
//! reads. Measured on the RX 6650 XT: a pooled surface exports as modifier
//! `0x0200000018601b03` with `DCC=0` and two separate layers — byte-for-byte the
//! shape we got when we allocated it ourselves. So [`Encoder::export`] hands out
//! the same [`ExportedSurface`] the Vulkan side already knows how to import.
//!
//! # Where the `unsafe` lives
//!
//! Every call below crosses into [`sys`], whose header is ours. The one thing
//! `#[repr(C)]` does not guarantee is that Rust padded these structures exactly
//! as the C compiler did, so [`the layout test`](self#tests) asks the C side what
//! it built instead of trusting the mirror.

pub mod sys;

use core::ffi::c_int;
use core::ptr::NonNull;
use std::ffi::CString;
use std::path::Path;

use crate::error::EncoderError;
use crate::frame_source::DmaBuf;
use crate::va::{ExportedSurface, PlaneLayout};

/// Largest pool the shim will allocate. Mirrors `MAX_SLOTS` in the C file.
pub const MAX_SLOTS: u32 = 8;

/// Turns the shim's error code into the sentence it stands for.
const fn describe(code: c_int) -> &'static str {
    match code {
        -1 => "the render node would not open as a VA device",
        -2 => "the frame pool would not initialise",
        -3 => "this libavcodec has no h264_vaapi encoder",
        -4 => "avcodec_open2 refused the settings",
        -5 => "the surface would not export as a dma-buf",
        -6 => "send_frame or receive_packet failed",
        -7 => "a slot index outside the pool",
        -8 => "allocation failed",
        _ => "an unrecognised failure",
    }
}

const fn fail<T>(what: &'static str, code: c_int) -> Result<T, EncoderError> {
    Err(EncoderError::Av {
        what,
        code,
        message: describe(code),
    })
}

/// An open H.264 encoder and the pool of surfaces it reads.
///
/// Not [`Sync`] and not [`Send`]: libavcodec's context and the VA display behind
/// it are bound to the thread that opened them, and the auto traits are left
/// unimplemented by the raw pointer rather than asserted away.
#[derive(Debug)]
pub struct Encoder {
    handle: NonNull<sys::N3Encoder>,
    slots: u32,
    width: u32,
    height: u32,
}

impl Encoder {
    /// Opens an encoder on a DRM render node.
    ///
    /// `qp` is the constant quantiser — rate control by target bitrate is a
    /// later decision and deliberately not exposed yet. `slots` is the size of
    /// the surface pool, and wants to match the frame ring the emulator
    /// announces, for the same reason that ring exists.
    ///
    /// # Errors
    /// [`EncoderError::UnsupportedSize`] for a picture that is not a whole
    /// number of macroblocks, [`EncoderError::SlotOutOfRange`] for a pool size
    /// outside `1..=MAX_SLOTS`, [`EncoderError::RenderNode`] if the path is
    /// not representable as a C string, or [`EncoderError::Av`].
    pub fn open(
        node: impl AsRef<Path>,
        width: u32,
        height: u32,
        qp: u32,
        fps: u32,
        slots: u32,
    ) -> Result<Self, EncoderError> {
        // Cropping is not written on our side and libavcodec would silently
        // encode the padding as picture, so refuse rather than produce a stream
        // with garbage down two edges.
        if !width.is_multiple_of(16) || !height.is_multiple_of(16) {
            return Err(EncoderError::UnsupportedSize { width, height });
        }
        if slots == 0 || slots > MAX_SLOTS {
            return Err(EncoderError::SlotOutOfRange {
                slot: slots,
                slot_count: MAX_SLOTS,
            });
        }

        let node = node.as_ref();
        let path = CString::new(node.as_os_str().as_encoded_bytes()).map_err(|_| {
            EncoderError::RenderNode {
                path: node.to_path_buf(),
                source: std::io::Error::from(std::io::ErrorKind::InvalidInput),
            }
        })?;

        let mut code: c_int = sys::N3_OK;
        // SAFETY: `path` is a live NUL-terminated string that outlives the call
        // (the shim copies what it needs into libavutil), and `code` addresses a
        // live `c_int`. Every other argument is a plain value.
        let handle = unsafe {
            sys::n3_encoder_open(path.as_ptr(), width, height, qp, fps, slots, &raw mut code)
        };
        let Some(handle) = NonNull::new(handle) else {
            return fail("n3_encoder_open", code);
        };

        tracing::info!(%width, %height, qp, fps, slots, "libavcodec h264_vaapi encoder ready");
        Ok(Self {
            handle,
            slots,
            width,
            height,
        })
    }

    /// How many surfaces the pool holds.
    #[must_use]
    pub const fn slots(&self) -> u32 {
        self.slots
    }

    /// Width in pixels.
    #[must_use]
    pub const fn width(&self) -> u32 {
        self.width
    }

    /// Height in pixels.
    #[must_use]
    pub const fn height(&self) -> u32 {
        self.height
    }

    /// Exports one pooled surface as a dma-buf, for the shader to write into.
    ///
    /// The returned surface owns its descriptor and closes it on drop. It does
    /// **not** borrow the encoder: a dma-buf holds its own reference to the
    /// underlying memory, so the mapping stays valid even if the encoder is
    /// dropped first. What would *not* be valid is encoding that slot
    /// afterwards, and the borrow checker covers that because
    /// [`encode`](Self::encode) needs the encoder.
    ///
    /// # Errors
    /// [`EncoderError::Av`] if the driver refuses, or
    /// [`EncoderError::UnexpectedExport`] for a shape this crate has not
    /// measured.
    pub fn export(&mut self, slot: u32) -> Result<ExportedSurface, EncoderError> {
        let mut surface = sys::N3Surface::default();
        // SAFETY: `handle` is a live encoder from `open`, and `surface` is a
        // live, correctly-laid-out `n3_surface` — the layout test below asserts
        // that against the C compiler's own answer. The shim writes into it and
        // does not retain the pointer.
        let status =
            unsafe { sys::n3_encoder_export(self.handle.as_ptr(), slot, &raw mut surface) };
        if status != sys::N3_OK {
            return fail("n3_encoder_export", status);
        }

        // Take the descriptor into an owning wrapper first, so every check after
        // this point can return early without leaking it.
        let buffer = DmaBuf::from_owned_raw(surface.fd);

        let plane_count = surface.plane_count as usize;
        if plane_count == 0 || plane_count > surface.planes.len() {
            return Err(EncoderError::UnexpectedExport {
                what: "plane count outside 1..=4",
            });
        }
        let planes = surface.planes[..plane_count]
            .iter()
            .map(|plane| PlaneLayout {
                drm_format: plane.drm_format,
                // The shim rejects any export with more than one buffer object,
                // so every plane necessarily sits in object zero.
                object_index: 0,
                offset: plane.offset,
                pitch: plane.pitch,
            })
            .collect();

        Ok(ExportedSurface {
            width: surface.width,
            height: surface.height,
            fourcc: surface.fourcc,
            modifier: surface.modifier,
            buffers: vec![buffer],
            planes,
        })
    }

    /// Encodes whatever the shader last wrote into `slot`.
    ///
    /// Returns the coded bytes, or [`None`] if libavcodec took the frame without
    /// producing a packet. With `async_depth=1` and no B-frames that should not
    /// happen, and saying so rather than blocking is what makes it noticeable.
    ///
    /// The slice borrows the encoder, so the next call cannot run while the
    /// previous packet is still held — which is exactly the lifetime libavcodec
    /// gives it.
    ///
    /// # Errors
    /// [`EncoderError::Av`].
    pub fn encode(&mut self, slot: u32) -> Result<Option<&[u8]>, EncoderError> {
        let mut data: *const u8 = core::ptr::null();
        // SAFETY: `handle` is live, and `data` addresses a live pointer the shim
        // writes. On success it points into the encoder's own packet, which
        // libavcodec keeps valid until the next call — and `&mut self` is what
        // stops us from making that call while the slice is alive.
        let size = unsafe { sys::n3_encoder_encode(self.handle.as_ptr(), slot, &raw mut data) };
        if size < 0 {
            // The shim's codes are all in -8..=-1, so anything that will not fit
            // in a `c_int` is not one of them — and `describe` says "an
            // unrecognised failure" rather than inventing a cause for it.
            return fail(
                "n3_encoder_encode",
                c_int::try_from(size).unwrap_or(c_int::MIN),
            );
        }
        // `c_long` and `usize` are both 64-bit here, so this narrows only on a
        // 32-bit target — where a packet that large could not have been
        // allocated in the first place. Clamping to zero then reports "nothing
        // produced", which is the safe reading; handing out a slice shorter than
        // the packet would not be.
        let len = usize::try_from(size).unwrap_or(0);
        if len == 0 || data.is_null() {
            return Ok(None);
        }
        // SAFETY: the shim returned a non-null pointer and a positive length,
        // both taken straight from the AVPacket libavcodec just filled, so the
        // bytes are initialised and contiguous. The slice borrows `self`, which
        // keeps the packet alive: only `&mut self` methods can invalidate it.
        Ok(Some(unsafe { core::slice::from_raw_parts(data, len) }))
    }
}

impl Drop for Encoder {
    fn drop(&mut self) {
        // SAFETY: `handle` came from a successful `n3_encoder_open` and has not
        // been closed — nothing else calls this, and Drop runs once.
        unsafe { sys::n3_encoder_close(self.handle.as_ptr()) };
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
    use crate::va::DEFAULT_RENDER_NODE;

    /// Reports what the C compiler actually built. Only the layout tests need
    /// it, so it lives here rather than leaving dead code in the real build.
    fn c_layout(what: c_int) -> usize {
        // SAFETY: `n3_layout` reads nothing, writes nothing, and answers every
        // integer — unknown questions get `(size_t)-1` rather than undefined
        // behaviour.
        unsafe { sys::n3_layout(what) }
    }

    /// Asks the C compiler where it put every field, and compares.
    ///
    /// This needs no GPU, which is the point: a padding mismatch is a defect of
    /// the binding, not of the machine, and it should be caught anywhere the
    /// crate compiles. Every field is checked rather than just the size, because
    /// two compensating padding errors would leave the size right and every
    /// value wrong.
    #[test]
    fn the_rust_mirror_matches_what_the_c_compiler_built() {
        use core::mem::{offset_of, size_of};

        assert_eq!(
            size_of::<sys::N3Surface>(),
            c_layout(sys::N3_LAYOUT_SURFACE_SIZE)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, fd),
            c_layout(sys::N3_LAYOUT_SURFACE_FD)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, width),
            c_layout(sys::N3_LAYOUT_SURFACE_WIDTH)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, height),
            c_layout(sys::N3_LAYOUT_SURFACE_HEIGHT)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, fourcc),
            c_layout(sys::N3_LAYOUT_SURFACE_FOURCC)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, modifier),
            c_layout(sys::N3_LAYOUT_SURFACE_MODIFIER)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, plane_count),
            c_layout(sys::N3_LAYOUT_SURFACE_PLANE_COUNT)
        );
        assert_eq!(
            offset_of!(sys::N3Surface, planes),
            c_layout(sys::N3_LAYOUT_SURFACE_PLANES)
        );

        assert_eq!(
            size_of::<sys::N3Plane>(),
            c_layout(sys::N3_LAYOUT_PLANE_SIZE)
        );
        assert_eq!(
            offset_of!(sys::N3Plane, drm_format),
            c_layout(sys::N3_LAYOUT_PLANE_FORMAT)
        );
        assert_eq!(
            offset_of!(sys::N3Plane, offset),
            c_layout(sys::N3_LAYOUT_PLANE_OFFSET)
        );
        assert_eq!(
            offset_of!(sys::N3Plane, pitch),
            c_layout(sys::N3_LAYOUT_PLANE_PITCH)
        );
    }

    /// A question the C side does not answer must say so, not return a plausible
    /// number — the negative twin for the assertions above, which would all pass
    /// vacuously if `n3_layout` returned zero for everything.
    #[test]
    fn an_unknown_layout_question_is_refused() {
        assert_eq!(c_layout(999), usize::MAX);
    }

    #[test]
    fn a_size_that_is_not_whole_macroblocks_is_refused() {
        let error = Encoder::open(DEFAULT_RENDER_NODE, 1920, 1081, 26, 60, 3).unwrap_err();
        assert!(
            matches!(error, EncoderError::UnsupportedSize { height: 1081, .. }),
            "{error:?}"
        );
    }

    #[test]
    fn a_pool_size_outside_the_shims_range_is_refused() {
        for slots in [0, MAX_SLOTS + 1] {
            let error = Encoder::open(DEFAULT_RENDER_NODE, 640, 480, 26, 60, slots).unwrap_err();
            assert!(
                matches!(error, EncoderError::SlotOutOfRange { .. }),
                "{slots} slots gave {error:?}"
            );
        }
        // The positive twin: a size inside the range gets past this check. It is
        // asserted by NOT being a range error, so the test still means something
        // on a machine with no GPU.
        let outcome = Encoder::open(DEFAULT_RENDER_NODE, 640, 480, 26, 60, MAX_SLOTS);
        assert!(
            !matches!(outcome, Err(EncoderError::SlotOutOfRange { .. })),
            "{MAX_SLOTS} slots is inside the range and must not be refused as one"
        );
    }

    /// Needs the GPU. The numbers are the ones the C spike measured; if the Rust
    /// path disagrees, the binding is wrong rather than the driver.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn a_pooled_surface_is_still_ours_to_write() {
        let Ok(mut encoder) = Encoder::open(DEFAULT_RENDER_NODE, 640, 480, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        assert_eq!(encoder.slots(), 3);

        let exported = encoder.export(0).unwrap();
        assert_eq!((exported.width, exported.height), (640, 480));
        assert_eq!(exported.fourcc, u32::from_le_bytes(*b"NV12"));
        // Two separate layers, luma then chroma: a single combined NV12 image is
        // not writable by a shader on this hardware, so this is load-bearing.
        assert_eq!(exported.planes.len(), 2);
        assert_eq!(exported.planes[0].drm_format, u32::from_le_bytes(*b"R8  "));
        assert_eq!(exported.planes[1].drm_format, u32::from_le_bytes(*b"GR88"));
        assert_eq!(exported.planes[0].offset, 0);
        assert!(exported.planes[1].offset > 0);

        // ADR D5's premise, and the reason libavcodec's pool was worth checking
        // at all: bit 13 of an AMD modifier is DCC, which the video engine
        // cannot read before RDNA4.
        assert_eq!(exported.modifier >> 56, 0x02, "{:#x}", exported.modifier);
        assert_eq!((exported.modifier >> 13) & 1, 0, "DCC must be off");
    }

    /// Every slot in the pool must export, not just the first — a pool that
    /// handed out one real surface and three aliases would pass the test above.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn every_slot_exports_a_distinct_buffer_with_the_same_layout() {
        let Ok(mut encoder) = Encoder::open(DEFAULT_RENDER_NODE, 640, 480, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };

        let mut exports = Vec::new();
        for slot in 0..encoder.slots() {
            exports.push(encoder.export(slot).unwrap());
        }

        let first = &exports[0];
        for (slot, export) in exports.iter().enumerate() {
            assert_eq!(export.modifier, first.modifier, "slot {slot}");
            assert_eq!(export.planes, first.planes, "slot {slot}");
        }

        // Distinct descriptors are guaranteed by the kernel and prove nothing;
        // what matters is that they name different memory. The dma-buf's inode
        // does, and /proc reaches it without needing an unsafe fstat on a raw fd.
        let inodes: Vec<u64> = exports
            .iter()
            .map(|export| {
                use std::os::unix::fs::MetadataExt as _;
                let fd = export.buffers[0].as_raw_fd();
                std::fs::metadata(format!("/proc/self/fd/{fd}"))
                    .expect("an exported dma-buf is a live, stat-able descriptor")
                    .ino()
            })
            .collect();
        for slot in 1..inodes.len() {
            assert_ne!(
                inodes[slot], inodes[0],
                "slot {slot} exports the same buffer as slot 0"
            );
        }
    }

    /// The end of ADR D7's promise: a frame the encoder accepts comes back as
    /// H.264. The surface is left as the pool allocated it, so this asserts the
    /// *stream shape* rather than the picture — pixels are the wiring test's job.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn an_encoded_frame_comes_back_as_an_h264_idr_access_unit() {
        let Ok(mut encoder) = Encoder::open(DEFAULT_RENDER_NODE, 640, 480, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };

        let packet = encoder
            .encode(0)
            .unwrap()
            .expect("async_depth=1 with no B-frames must return the first frame immediately");

        // Annex B start code, then the NAL types the first access unit owes us.
        assert_eq!(
            &packet[..4],
            &[0x00, 0x00, 0x00, 0x01],
            "no Annex B start code"
        );
        let kinds = nal_kinds(packet);
        assert!(
            kinds.contains(&7),
            "no SPS in the first access unit: {kinds:?}"
        );
        assert!(
            kinds.contains(&8),
            "no PPS in the first access unit: {kinds:?}"
        );
        assert!(
            kinds.contains(&5),
            "the first frame is not an IDR: {kinds:?}"
        );
    }

    /// The NAL unit types in an Annex B stream, in order.
    #[cfg(feature = "gpu-tests")]
    fn nal_kinds(stream: &[u8]) -> Vec<u8> {
        let mut kinds = Vec::new();
        for window in stream.windows(4) {
            if window[..3] == [0x00, 0x00, 0x01] {
                kinds.push(window[3] & 0x1f);
            }
        }
        kinds
    }
}
