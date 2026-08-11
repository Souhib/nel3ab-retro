//! Raw libva declarations — the only place in this workspace that is `unsafe`.
//!
//! # Why these are hand-written
//!
//! `bindgen` would generate them, at the cost of a build dependency and a
//! libclang on every machine that compiles this, for about eighty lines. The
//! trade taken instead is to **measure** the layout rather than trust it:
//! `spikes/m2-vaapi-export/va_layout.c` prints every size and offset from the
//! real headers, and the `const` assertions below fail the BUILD if this file
//! ever disagrees with them.
//!
//! That matters more than it looks. A field declared in the wrong place still
//! compiles, still runs, and hands back plausible garbage — which is the exact
//! failure mode this milestone has already met twice in other guises.
//!
//! Measured against libva 2.12 on lgf, 2026-08-11. Regenerate with:
//! `gcc va_layout.c -o va_layout $(pkg-config --cflags libva) && ./va_layout`

use core::ffi::{c_char, c_int, c_void};

/// libva's status code. Zero is success; everything else is an error.
pub type VaStatus = i32;
/// An opaque surface handle.
pub type VaSurfaceId = u32;
/// An opaque display handle. A pointer, hence the size assertion below.
pub type VaDisplay = *mut c_void;

/// `VA_STATUS_SUCCESS`.
pub const VA_STATUS_SUCCESS: VaStatus = 0;

/// `VA_RT_FORMAT_YUV420`.
pub const VA_RT_FORMAT_YUV420: u32 = 0x0000_0001;
/// `VA_FOURCC_NV12`.
pub const VA_FOURCC_NV12: u32 = 0x3231_564e;

/// `VASurfaceAttribPixelFormat`.
pub const VA_SURFACE_ATTRIB_PIXEL_FORMAT: i32 = 1;
/// `VASurfaceAttribUsageHint`.
pub const VA_SURFACE_ATTRIB_USAGE_HINT: i32 = 8;
/// `VA_SURFACE_ATTRIB_SETTABLE`.
pub const VA_SURFACE_ATTRIB_SETTABLE: u32 = 0x0000_0002;
/// `VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER`.
pub const VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER: i32 = 0x0000_0002;
/// `VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2`.
pub const VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2: u32 = 0x4000_0000;
/// `VA_EXPORT_SURFACE_WRITE_ONLY`.
pub const VA_EXPORT_SURFACE_WRITE_ONLY: u32 = 0x0000_0002;
/// `VA_EXPORT_SURFACE_SEPARATE_LAYERS`.
pub const VA_EXPORT_SURFACE_SEPARATE_LAYERS: u32 = 0x0000_0004;
/// `VAGenericValueTypeInteger`.
pub const VA_GENERIC_VALUE_TYPE_INTEGER: i32 = 1;

/// `VAGenericValue`'s union payload.
///
/// Only the integer arm is ever set by this crate; the others exist so the
/// union is the size libva expects.
#[repr(C)]
#[derive(Clone, Copy)]
pub union VaGenericValuePayload {
    /// Integer arm.
    pub i: i32,
    /// Float arm, unused here.
    pub f: f32,
    /// Pointer arm, unused here.
    pub p: *mut c_void,
}

/// `VAGenericValue`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct VaGenericValue {
    /// Which arm of `value` is live.
    pub value_type: i32,
    /// The payload.
    pub value: VaGenericValuePayload,
}

/// `VASurfaceAttrib`.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct VaSurfaceAttrib {
    /// Which attribute this is.
    pub attrib_type: i32,
    /// Settable/gettable flags.
    pub flags: u32,
    /// The value.
    pub value: VaGenericValue,
}

/// One buffer object of an exported surface.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct VaDrmPrimeObject {
    /// dma-buf descriptor. Owned by the caller after export.
    pub fd: c_int,
    /// Size of the buffer object.
    pub size: u32,
    /// DRM format modifier — the tiling. Must be passed back verbatim.
    pub drm_format_modifier: u64,
}

/// One layer (plane group) of an exported surface.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct VaDrmPrimeLayer {
    /// DRM fourcc of this layer.
    pub drm_format: u32,
    /// How many planes it uses.
    pub num_planes: u32,
    /// Which object each plane lives in.
    pub object_index: [u32; 4],
    /// Byte offset of each plane.
    pub offset: [u32; 4],
    /// Bytes per row of each plane.
    pub pitch: [u32; 4],
}

/// `VADRMPRIMESurfaceDescriptor`.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct VaDrmPrimeSurfaceDescriptor {
    /// Surface fourcc.
    pub fourcc: u32,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// How many of `objects` are populated.
    pub num_objects: u32,
    /// The buffer objects.
    pub objects: [VaDrmPrimeObject; 4],
    /// How many of `layers` are populated.
    pub num_layers: u32,
    /// The layers.
    pub layers: [VaDrmPrimeLayer; 4],
}

// ── The layout, asserted at COMPILE time against the measured header ──
//
// A test would catch this too, but only when someone runs it; a const block
// stops the build. Since the whole risk is a mis-declared struct producing
// plausible garbage, the earliest possible failure is the right one.
const _: () = {
    use core::mem::{align_of, offset_of, size_of};

    assert!(size_of::<VaDisplay>() == 8);
    assert!(size_of::<VaStatus>() == 4);
    assert!(size_of::<VaSurfaceId>() == 4);

    assert!(size_of::<VaGenericValue>() == 16);
    assert!(offset_of!(VaGenericValue, value) == 8);
    assert!(size_of::<VaSurfaceAttrib>() == 24);
    assert!(offset_of!(VaSurfaceAttrib, flags) == 4);
    assert!(offset_of!(VaSurfaceAttrib, value) == 8);

    assert!(size_of::<VaDrmPrimeSurfaceDescriptor>() == 312);
    assert!(align_of::<VaDrmPrimeSurfaceDescriptor>() == 8);
    assert!(offset_of!(VaDrmPrimeSurfaceDescriptor, objects) == 16);
    assert!(offset_of!(VaDrmPrimeSurfaceDescriptor, num_layers) == 80);
    assert!(offset_of!(VaDrmPrimeSurfaceDescriptor, layers) == 84);

    assert!(size_of::<VaDrmPrimeObject>() == 16);
    assert!(offset_of!(VaDrmPrimeObject, size) == 4);
    assert!(offset_of!(VaDrmPrimeObject, drm_format_modifier) == 8);

    assert!(size_of::<VaDrmPrimeLayer>() == 56);
    assert!(offset_of!(VaDrmPrimeLayer, object_index) == 8);
    assert!(offset_of!(VaDrmPrimeLayer, offset) == 24);
    assert!(offset_of!(VaDrmPrimeLayer, pitch) == 40);
};

#[link(name = "va")]
unsafe extern "C" {
    /// Brings up the VA display. Must be called before anything else.
    pub fn vaInitialize(dpy: VaDisplay, major: *mut c_int, minor: *mut c_int) -> VaStatus;
    /// Tears it down.
    pub fn vaTerminate(dpy: VaDisplay) -> VaStatus;
    /// Human-readable form of a status code. Returns a static string.
    pub fn vaErrorStr(error_status: VaStatus) -> *const c_char;
    /// Driver identification string. Owned by the library.
    pub fn vaQueryVendorString(dpy: VaDisplay) -> *const c_char;

    /// Allocates surfaces.
    pub fn vaCreateSurfaces(
        dpy: VaDisplay,
        format: u32,
        width: u32,
        height: u32,
        surfaces: *mut VaSurfaceId,
        num_surfaces: u32,
        attrib_list: *mut VaSurfaceAttrib,
        num_attribs: u32,
    ) -> VaStatus;
    /// Frees them.
    pub fn vaDestroySurfaces(dpy: VaDisplay, surfaces: *mut VaSurfaceId, num: c_int) -> VaStatus;
    /// Waits for any pending work on a surface.
    pub fn vaSyncSurface(dpy: VaDisplay, render_target: VaSurfaceId) -> VaStatus;
    /// Exports a surface as dma-buf descriptors.
    pub fn vaExportSurfaceHandle(
        dpy: VaDisplay,
        surface_id: VaSurfaceId,
        mem_type: u32,
        flags: u32,
        descriptor: *mut c_void,
    ) -> VaStatus;
}

#[link(name = "va-drm")]
unsafe extern "C" {
    /// Opens a VA display on a DRM render node.
    pub fn vaGetDisplayDRM(fd: c_int) -> VaDisplay;
}
