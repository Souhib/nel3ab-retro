//! The declarations for `csrc/nel3ab_encode.h`.
//!
//! Unlike [`crate::va::sys`], nothing here is a redeclaration of somebody else's
//! ABI — the header is ours, compiled from the same tree by the same build. The
//! only thing left to get wrong is whether Rust's `#[repr(C)]` lays these two
//! structures out the way the C compiler did, and [`n3_layout`] exists so that
//! is checked rather than assumed. See the test at the bottom of [`super`].

use core::ffi::{c_char, c_int, c_long};

/// Opaque; only ever held behind a pointer.
#[repr(C)]
pub struct N3Encoder {
    _private: [u8; 0],
}

/// One plane of an exported surface.
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct N3Plane {
    /// DRM fourcc of this plane.
    pub drm_format: u32,
    /// Byte offset within the buffer object.
    pub offset: u32,
    /// Bytes per row.
    pub pitch: u32,
}

/// An exported surface, as the shim describes it.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct N3Surface {
    /// dma-buf descriptor, owned by the caller.
    pub fd: c_int,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Surface fourcc.
    pub fourcc: u32,
    /// The tiling every plane shares.
    pub modifier: u64,
    /// How many entries of `planes` are meaningful.
    pub plane_count: u32,
    /// Plane layouts, luma then chroma.
    pub planes: [N3Plane; 4],
}

impl Default for N3Surface {
    fn default() -> Self {
        Self {
            // -1 rather than 0: 0 is a perfectly good file descriptor, so a
            // default that used it could close somebody's stdin.
            fd: -1,
            width: 0,
            height: 0,
            fourcc: 0,
            modifier: 0,
            plane_count: 0,
            planes: [N3Plane::default(); 4],
        }
    }
}

/// The shim's success code.
pub const N3_OK: c_int = 0;

/// Ask for `sizeof(n3_surface)`. See the enum in the header for the rest.
pub const N3_LAYOUT_SURFACE_SIZE: c_int = 0;
/// Ask for `offsetof(n3_surface, fd)`.
pub const N3_LAYOUT_SURFACE_FD: c_int = 1;
/// Ask for `offsetof(n3_surface, width)`.
pub const N3_LAYOUT_SURFACE_WIDTH: c_int = 2;
/// Ask for `offsetof(n3_surface, height)`.
pub const N3_LAYOUT_SURFACE_HEIGHT: c_int = 3;
/// Ask for `offsetof(n3_surface, fourcc)`.
pub const N3_LAYOUT_SURFACE_FOURCC: c_int = 4;
/// Ask for `offsetof(n3_surface, modifier)`.
pub const N3_LAYOUT_SURFACE_MODIFIER: c_int = 5;
/// Ask for `offsetof(n3_surface, plane_count)`.
pub const N3_LAYOUT_SURFACE_PLANE_COUNT: c_int = 6;
/// Ask for `offsetof(n3_surface, planes)`.
pub const N3_LAYOUT_SURFACE_PLANES: c_int = 7;
/// Ask for `sizeof(n3_plane)`.
pub const N3_LAYOUT_PLANE_SIZE: c_int = 8;
/// Ask for `offsetof(n3_plane, drm_format)`.
pub const N3_LAYOUT_PLANE_FORMAT: c_int = 9;
/// Ask for `offsetof(n3_plane, offset)`.
pub const N3_LAYOUT_PLANE_OFFSET: c_int = 10;
/// Ask for `offsetof(n3_plane, pitch)`.
pub const N3_LAYOUT_PLANE_PITCH: c_int = 11;

unsafe extern "C" {
    /// Opens an encoder; returns null and sets `error` on failure.
    pub fn n3_encoder_open(
        render_node: *const c_char,
        width: u32,
        height: u32,
        qp: u32,
        fps: u32,
        slots: u32,
        error: *mut c_int,
    ) -> *mut N3Encoder;

    /// How many surfaces the pool holds.
    pub fn n3_encoder_slots(encoder: *const N3Encoder) -> u32;

    /// Exports one pooled surface as a dma-buf.
    pub fn n3_encoder_export(encoder: *mut N3Encoder, slot: u32, out: *mut N3Surface) -> c_int;

    /// Encodes one slot; returns the byte count, or a negative code.
    pub fn n3_encoder_encode(encoder: *mut N3Encoder, slot: u32, data: *mut *const u8) -> c_long;

    /// Makes the next encoded frame an IDR.
    pub fn n3_encoder_force_key(encoder: *mut N3Encoder);

    /// Frees the encoder and its pool.
    pub fn n3_encoder_close(encoder: *mut N3Encoder);

    /// Reports a real size or offset from the C side.
    pub fn n3_layout(what: c_int) -> usize;
}
