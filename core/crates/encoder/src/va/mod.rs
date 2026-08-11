//! Safe ownership over libva.
//!
//! # The exception this module is
//!
//! `CLAUDE.md` rule 2 bans `unsafe` and names exactly one exception: the FFI
//! module. This is it — which is also why the workspace lint is `deny` rather
//! than `forbid`, since `forbid` could not be lifted even here. Every block
//! below carries a `SAFETY:`
//! comment establishing the invariant that makes the call sound, and the layout
//! of every structure crossing the boundary is asserted at compile time in
//! [`sys`] against measurements taken from the real headers.
//!
//! Note what `just miri` can and cannot do here: Miri cannot execute foreign
//! functions at all, so it will never validate a libva call. It is still worth
//! running on the pointer and slice arithmetic *around* the calls, which is
//! where a mistake would be ours rather than the driver's.
//!
//! # The ordering this preserves
//!
//! ADR D5: allocate the VAAPI surface **first**, export it, and let a shader
//! write NV12 into it. Measured on the RX 6650 XT — radeonsi hands back an
//! AMD-tiled surface with `DCC=0`, because the video engine cannot read delta
//! colour compression before RDNA4. Allocating in Vulkan first would let RADV
//! choose a DCC modifier that VAAPI then refuses. So this module offers no way
//! to import an externally-allocated surface: the only constructor allocates.

pub mod enc;
pub mod sys;

use core::ffi::{CStr, c_int};
use std::os::fd::{AsRawFd as _, OwnedFd};
use std::path::Path;

use crate::error::EncoderError;
use crate::frame_source::DmaBuf;

/// The DRM render node a session encodes on.
pub const DEFAULT_RENDER_NODE: &str = "/dev/dri/renderD128";

/// Turns a libva status into an error carrying the driver's own words.
pub(crate) fn check(status: sys::VaStatus, what: &'static str) -> Result<(), EncoderError> {
    if status == sys::VA_STATUS_SUCCESS {
        return Ok(());
    }
    // SAFETY: `vaErrorStr` returns a pointer to a static, NUL-terminated string
    // for any input, including codes it does not recognise (it has a default
    // arm). The pointer is never null and never freed, so borrowing it for the
    // length of this call is sound.
    let message = unsafe { CStr::from_ptr(sys::vaErrorStr(status)) }
        .to_string_lossy()
        .into_owned();
    Err(EncoderError::Va {
        what,
        status,
        message,
    })
}

/// An initialised VA display, and the render node it lives on.
///
/// Owns both: dropping it terminates the display before closing the fd, which is
/// the order libva requires.
#[derive(Debug)]
pub struct Display {
    handle: sys::VaDisplay,
    // Held to keep the render node open for as long as the display uses it.
    // libva does not dup it.
    _node: OwnedFd,
    vendor: String,
}

impl Display {
    /// Opens a display on a DRM render node.
    ///
    /// # Errors
    /// [`EncoderError::RenderNode`] if the node cannot be opened, or
    /// [`EncoderError::Va`] if libva refuses it.
    pub fn open(node: impl AsRef<Path>) -> Result<Self, EncoderError> {
        let node = node.as_ref();
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(node)
            .map_err(|source| EncoderError::RenderNode {
                path: node.to_path_buf(),
                source,
            })?;
        let node_fd = OwnedFd::from(file);

        // SAFETY: the fd is open, ours, and outlives the display because it is
        // stored alongside it. libva neither closes nor dups it.
        let handle = unsafe { sys::vaGetDisplayDRM(node_fd.as_raw_fd()) };
        if handle.is_null() {
            return Err(EncoderError::Va {
                what: "vaGetDisplayDRM",
                status: -1,
                message: "the driver returned no display".to_owned(),
            });
        }

        let mut major: c_int = 0;
        let mut minor: c_int = 0;
        // SAFETY: `handle` is the non-null display just returned, and both out
        // parameters point at live, correctly-typed locals.
        check(
            unsafe { sys::vaInitialize(handle, &raw mut major, &raw mut minor) },
            "vaInitialize",
        )?;

        // SAFETY: called after a successful vaInitialize, which is libva's
        // precondition. The returned string is owned by the driver and valid
        // until vaTerminate, so it is copied out immediately.
        let vendor = unsafe { CStr::from_ptr(sys::vaQueryVendorString(handle)) }
            .to_string_lossy()
            .into_owned();

        tracing::info!(%vendor, version = format!("{major}.{minor}"), "VA display ready");
        Ok(Self {
            handle,
            _node: node_fd,
            vendor,
        })
    }

    /// The raw display, for the encode module.
    pub(crate) const fn handle(&self) -> sys::VaDisplay {
        self.handle
    }

    /// The driver's own identification string.
    #[must_use]
    pub fn vendor(&self) -> &str {
        &self.vendor
    }

    /// Allocates an NV12 surface intended for the encoder.
    ///
    /// # Errors
    /// [`EncoderError::Va`] if the driver refuses the size or format.
    pub fn create_nv12_surface(
        &self,
        width: u32,
        height: u32,
    ) -> Result<Surface<'_>, EncoderError> {
        let mut attributes = [
            sys::VaSurfaceAttrib {
                attrib_type: sys::VA_SURFACE_ATTRIB_PIXEL_FORMAT,
                flags: sys::VA_SURFACE_ATTRIB_SETTABLE,
                value: sys::VaGenericValue {
                    value_type: sys::VA_GENERIC_VALUE_TYPE_INTEGER,
                    value: sys::VaGenericValuePayload {
                        #[allow(
                            clippy::cast_possible_wrap,
                            reason = "the fourcc is a bit pattern; libva's field is signed"
                        )]
                        i: sys::VA_FOURCC_NV12 as i32,
                    },
                },
            },
            // The hint made no difference to the modifier on Mesa 25.2.8
            // (measured), but it is free, it states intent, and a future driver
            // is under no obligation to keep ignoring it.
            sys::VaSurfaceAttrib {
                attrib_type: sys::VA_SURFACE_ATTRIB_USAGE_HINT,
                flags: sys::VA_SURFACE_ATTRIB_SETTABLE,
                value: sys::VaGenericValue {
                    value_type: sys::VA_GENERIC_VALUE_TYPE_INTEGER,
                    value: sys::VaGenericValuePayload {
                        i: sys::VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER,
                    },
                },
            },
        ];

        let mut id: sys::VaSurfaceId = 0;
        // SAFETY: `attributes` is a live array of exactly the length passed, the
        // out pointer addresses one live `VaSurfaceId`, and `self.handle` is an
        // initialised display. libva copies the attributes; it does not retain
        // the pointer.
        check(
            unsafe {
                sys::vaCreateSurfaces(
                    self.handle,
                    sys::VA_RT_FORMAT_YUV420,
                    width,
                    height,
                    &raw mut id,
                    1,
                    attributes.as_mut_ptr(),
                    u32::try_from(attributes.len()).unwrap_or(0),
                )
            },
            "vaCreateSurfaces",
        )?;

        Ok(Surface {
            display: self,
            id,
            width,
            height,
        })
    }
}

impl Drop for Display {
    fn drop(&mut self) {
        // SAFETY: `handle` came from a successful vaInitialize and has not been
        // terminated — nothing else in this type calls vaTerminate, and Drop
        // runs once. The node fd is closed after, by its own Drop, which is the
        // order libva requires.
        let status = unsafe { sys::vaTerminate(self.handle) };
        if status != sys::VA_STATUS_SUCCESS {
            tracing::warn!(status, "vaTerminate failed");
        }
    }
}

/// An NV12 surface owned by a [`Display`].
///
/// Borrows the display, so a surface cannot outlive the display that allocated
/// it — which libva would treat as a use-after-free.
#[derive(Debug)]
pub struct Surface<'a> {
    display: &'a Display,
    id: sys::VaSurfaceId,
    width: u32,
    height: u32,
}

impl Surface<'_> {
    /// The raw id, for the encode module.
    pub(crate) const fn id(&self) -> sys::VaSurfaceId {
        self.id
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

    /// Blocks until the driver has finished any work on this surface.
    ///
    /// # Errors
    /// [`EncoderError::Va`].
    pub fn sync(&self) -> Result<(), EncoderError> {
        // SAFETY: the id is live for as long as this `Surface` exists, and the
        // display is borrowed for the same lifetime.
        check(
            unsafe { sys::vaSyncSurface(self.display.handle, self.id) },
            "vaSyncSurface",
        )
    }

    /// Exports the surface as dma-bufs, one descriptor per plane.
    ///
    /// `WRITE_ONLY` and `SEPARATE_LAYERS` are not adjustable, and both are
    /// load-bearing: the shader *writes* NV12 in, and the planes must arrive
    /// separately because `G8_B8R8_2PLANE_420_UNORM` carries the modifier with
    /// `storage=NO` — a single combined image cannot be written by a shader at
    /// all. Measured on the RX 6650 XT.
    ///
    /// # Errors
    /// [`EncoderError::Va`], or [`EncoderError::UnexpectedExport`] if the driver
    /// returns a shape this crate does not handle.
    pub fn export(&self) -> Result<ExportedSurface, EncoderError> {
        let mut descriptor = sys::VaDrmPrimeSurfaceDescriptor::default();
        // SAFETY: `descriptor` is a live, correctly-laid-out
        // VADRMPRIMESurfaceDescriptor — its size and every field offset are
        // asserted against the C headers at compile time in `sys`. libva writes
        // into it and does not retain the pointer.
        check(
            unsafe {
                sys::vaExportSurfaceHandle(
                    self.display.handle,
                    self.id,
                    sys::VA_SURFACE_ATTRIB_MEM_TYPE_DRM_PRIME_2,
                    sys::VA_EXPORT_SURFACE_WRITE_ONLY | sys::VA_EXPORT_SURFACE_SEPARATE_LAYERS,
                    (&raw mut descriptor).cast(),
                )
            },
            "vaExportSurfaceHandle",
        )?;

        // Everything past here is plain Rust over a filled-in struct; the fds
        // are taken into owning wrappers immediately so an early return cannot
        // leak them.
        let object_count = descriptor.num_objects as usize;
        let layer_count = descriptor.num_layers as usize;
        if object_count == 0 || object_count > 4 || layer_count == 0 || layer_count > 4 {
            return Err(EncoderError::UnexpectedExport {
                what: "object or layer count outside 1..=4",
            });
        }

        let mut buffers = Vec::with_capacity(object_count);
        let mut modifier = None;
        for object in descriptor.objects.iter().take(object_count) {
            // SAFETY-adjacent, but no unsafe: DmaBuf only closes the descriptor,
            // and libva has transferred ownership of it to us.
            buffers.push(DmaBuf::from_owned_raw(object.fd));
            match modifier {
                None => modifier = Some(object.drm_format_modifier),
                // One tiling for the whole surface is what every consumer here
                // assumes; a driver that disagreed would need real handling
                // rather than a silent first-wins.
                Some(first) if first != object.drm_format_modifier => {
                    return Err(EncoderError::UnexpectedExport {
                        what: "objects with differing DRM format modifiers",
                    });
                }
                Some(_) => {}
            }
        }

        let mut planes = Vec::with_capacity(layer_count);
        for layer in descriptor.layers.iter().take(layer_count) {
            if layer.num_planes != 1 {
                return Err(EncoderError::UnexpectedExport {
                    what: "a layer with more than one plane",
                });
            }
            planes.push(PlaneLayout {
                drm_format: layer.drm_format,
                object_index: layer.object_index[0],
                offset: layer.offset[0],
                pitch: layer.pitch[0],
            });
        }

        Ok(ExportedSurface {
            width: descriptor.width,
            height: descriptor.height,
            fourcc: descriptor.fourcc,
            modifier: modifier.unwrap_or_default(),
            buffers,
            planes,
        })
    }
}

impl Drop for Surface<'_> {
    fn drop(&mut self) {
        let mut id = self.id;
        // SAFETY: the id was returned by vaCreateSurfaces on this display, has
        // not been destroyed (Drop runs once), and the display outlives this
        // surface by the borrow.
        let status = unsafe { sys::vaDestroySurfaces(self.display.handle, &raw mut id, 1) };
        if status != sys::VA_STATUS_SUCCESS {
            tracing::warn!(status, "vaDestroySurfaces failed");
        }
    }
}

/// Where one plane sits inside an exported buffer object.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlaneLayout {
    /// DRM fourcc of this plane — `R8` for luma, `GR88` for chroma.
    pub drm_format: u32,
    /// Which exported buffer object holds it.
    pub object_index: u32,
    /// Byte offset within that object.
    pub offset: u32,
    /// Bytes per row.
    pub pitch: u32,
}

/// A surface handed out as dma-bufs, ready to import into Vulkan.
#[derive(Debug)]
pub struct ExportedSurface {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Surface fourcc, `NV12` here.
    pub fourcc: u32,
    /// The tiling every plane shares.
    pub modifier: u64,
    /// The buffer objects, closed when this is dropped.
    pub buffers: Vec<DmaBuf>,
    /// One entry per plane, in libva's order: luma then chroma.
    pub planes: Vec<PlaneLayout>,
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// Needs the GPU, so it is behind the same feature that compiles the FFI.
    /// The numbers are the ones the C spikes measured on the RX 6650 XT; if the
    /// Rust path disagrees with them, the FFI is wrong rather than the driver.
    #[test]
    fn an_encode_surface_exports_the_layout_the_spikes_measured() {
        let Ok(display) = Display::open(DEFAULT_RENDER_NODE) else {
            // A machine without the render node cannot answer this, and
            // pretending otherwise would be the "test that cannot fail" the
            // project forbids — so say so loudly instead of passing quietly.
            panic!("no VA display on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        assert!(display.vendor().contains("Mesa"), "{}", display.vendor());

        let surface = display.create_nv12_surface(640, 480).unwrap();
        let exported = surface.export().unwrap();

        assert_eq!(exported.fourcc, sys::VA_FOURCC_NV12);
        assert_eq!((exported.width, exported.height), (640, 480));
        // One buffer object, two planes: luma R8 then chroma GR88. The two-plane
        // shape is not cosmetic — a single NV12 image is not writable by a
        // shader on this hardware.
        assert_eq!(exported.buffers.len(), 1);
        assert_eq!(exported.planes.len(), 2);
        assert_eq!(exported.planes[0].drm_format, u32::from_le_bytes(*b"R8  "));
        assert_eq!(exported.planes[1].drm_format, u32::from_le_bytes(*b"GR88"));
        assert_eq!(exported.planes[0].offset, 0);
        assert!(exported.planes[1].offset > 0);

        // DCC off is ADR D5's entire premise: bit 13 of an AMD modifier.
        let vendor = exported.modifier >> 56;
        assert_eq!(vendor, 0x02, "expected an AMD modifier, got {vendor:#x}");
        let dcc = (exported.modifier >> 13) & 1;
        assert_eq!(dcc, 0, "the video engine cannot read DCC before RDNA4");
    }
}
