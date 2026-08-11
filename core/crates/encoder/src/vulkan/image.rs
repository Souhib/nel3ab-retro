//! Importing a dma-buf as a Vulkan image the shader can write.
//!
//! This is the join D5 exists to make legal: the surface was allocated by the
//! encoder, so its tiling is one the video engine can read, and Vulkan is told
//! that tiling **explicitly** rather than being allowed to pick. An import that
//! guessed the layout would succeed and produce a plausible wrong picture — the
//! failure mode `vaDeriveImage` already produced once in this milestone.

use std::os::fd::{AsRawFd as _, OwnedFd};

use ash::vk;

use super::{Context, borrow};
use crate::error::EncoderError;
use crate::frame_source::DmaBuf;
use crate::va::{ExportedSurface, PlaneLayout};

/// The DRM fourccs the two NV12 planes arrive as, and the Vulkan formats they
/// map to.
///
/// Written out rather than derived, because the mapping is the assertion: `R8`
/// is one byte of luma, `GR88` is the interleaved Cb/Cr pair at half resolution.
/// Getting the second one wrong swaps the colour axes, which looks like a
/// tinted-but-plausible picture rather than an error.
const PLANE_FORMATS: [(u32, vk::Format); 2] = [
    (u32::from_le_bytes(*b"R8  "), vk::Format::R8_UNORM),
    (u32::from_le_bytes(*b"GR88"), vk::Format::R8G8_UNORM),
];

/// One imported plane: a `VkImage` bound to memory that is somebody else's.
///
/// Borrows the [`Context`], so it cannot outlive the device that owns it — which
/// Vulkan would treat as destroying an image on a dead device.
pub struct ImportedPlane<'a> {
    context: &'a Context,
    image: vk::Image,
    memory: vk::DeviceMemory,
    view: vk::ImageView,
    width: u32,
    height: u32,
}

impl core::fmt::Debug for ImportedPlane<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("ImportedPlane")
            .field("width", &self.width)
            .field("height", &self.height)
            .finish_non_exhaustive()
    }
}

impl<'a> ImportedPlane<'a> {
    /// Imports one plane of an exported surface.
    ///
    /// `buffer` is borrowed, not consumed: Vulkan **dups** the descriptor during
    /// import and owns its copy, so the caller keeps theirs. Handing over the
    /// original would leave the exported surface holding a closed fd.
    ///
    /// # Errors
    /// [`EncoderError::UnexpectedExport`] for a plane fourcc this crate has not
    /// measured, or [`EncoderError::Vulkan`].
    pub fn import(
        context: &'a Context,
        buffer: &DmaBuf,
        modifier: u64,
        plane: PlaneLayout,
        width: u32,
        height: u32,
    ) -> Result<Self, EncoderError> {
        let format = PLANE_FORMATS
            .iter()
            .find_map(|(fourcc, format)| (*fourcc == plane.drm_format).then_some(*format))
            .ok_or(EncoderError::UnexpectedExport {
                what: "a plane whose fourcc is neither R8 nor GR88",
            })?;

        let layout = vk::SubresourceLayout {
            offset: u64::from(plane.offset),
            row_pitch: u64::from(plane.pitch),
            ..Default::default()
        };
        let layouts = [layout];
        let mut explicit = vk::ImageDrmFormatModifierExplicitCreateInfoEXT::default()
            .drm_format_modifier(modifier)
            .plane_layouts(&layouts);
        let mut external = vk::ExternalMemoryImageCreateInfo::default()
            .handle_types(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
        let create = vk::ImageCreateInfo::default()
            .image_type(vk::ImageType::TYPE_2D)
            .format(format)
            .extent(vk::Extent3D {
                width,
                height,
                depth: 1,
            })
            .mip_levels(1)
            .array_layers(1)
            .samples(vk::SampleCountFlags::TYPE_1)
            // The tiling is the surface's, stated explicitly. Anything else here
            // would let Vulkan assume a layout the encoder does not use.
            .tiling(vk::ImageTiling::DRM_FORMAT_MODIFIER_EXT)
            // STORAGE, because the shader writes into it directly. Not SAMPLED:
            // nothing ever reads this image through Vulkan.
            .usage(vk::ImageUsageFlags::STORAGE)
            .sharing_mode(vk::SharingMode::EXCLUSIVE)
            .initial_layout(vk::ImageLayout::UNDEFINED)
            .push_next(&mut external)
            .push_next(&mut explicit);

        let device = context.device();
        // SAFETY: `create` and every structure chained into it are live locals
        // for the call, and ash's builders keep each length field matching its
        // slice. Vulkan copies what it needs and retains no pointer.
        let image =
            unsafe { device.create_image(&create, None) }.map_err(|code| EncoderError::Vulkan {
                what: "vkCreateImage",
                code: code.as_raw(),
            })?;

        // From here every failure must destroy the image, so the rest is done in
        // a closure whose error is handled once.
        match Self::bind(context, image, buffer, format) {
            Ok((memory, view)) => Ok(Self {
                context,
                image,
                memory,
                view,
                width,
                height,
            }),
            Err(error) => {
                // SAFETY: the image was just created, nothing is bound to it and
                // no command references it.
                unsafe { device.destroy_image(image, None) };
                Err(error)
            }
        }
    }

    /// Allocates the imported memory, binds it, and makes the storage view.
    fn bind(
        context: &Context,
        image: vk::Image,
        buffer: &DmaBuf,
        format: vk::Format,
    ) -> Result<(vk::DeviceMemory, vk::ImageView), EncoderError> {
        let device = context.device();
        let fd_properties = context.external_memory_fd();

        let mut properties = vk::MemoryFdPropertiesKHR::default();
        // SAFETY: the descriptor is open and valid for the call, and
        // `properties` is a live local. This only *queries*; it does not consume
        // the descriptor, which is why the dup below is still needed.
        unsafe {
            fd_properties.get_memory_fd_properties(
                vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT,
                borrow(buffer).as_raw_fd(),
                &mut properties,
            )
        }
        .map_err(|code| EncoderError::Vulkan {
            what: "vkGetMemoryFdPropertiesKHR",
            code: code.as_raw(),
        })?;

        // SAFETY: `image` was created above on this device and is not yet bound.
        let requirements = unsafe { device.get_image_memory_requirements(image) };
        let memory_type = context
            .memory_type_for_import(requirements.memory_type_bits & properties.memory_type_bits)?;

        // Vulkan takes ownership of the descriptor it is given and closes it
        // with the memory. Duplicating first is what leaves the caller's copy
        // intact — handing over the original would close the exported surface's
        // own fd behind its back.
        let owned: OwnedFd =
            borrow(buffer)
                .try_clone_to_owned()
                .map_err(|source| EncoderError::Socket {
                    what: "duplicating the dma-buf for Vulkan to own",
                    source,
                })?;

        let mut import = vk::ImportMemoryFdInfoKHR::default()
            .handle_type(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT)
            .fd(owned.as_raw_fd());
        // Dedicated, because the memory is one buffer object backing one image;
        // a suballocating driver would have nowhere to put anything else in it.
        let mut dedicated = vk::MemoryDedicatedAllocateInfo::default().image(image);
        let allocate = vk::MemoryAllocateInfo::default()
            .allocation_size(requirements.size)
            .memory_type_index(memory_type)
            .push_next(&mut dedicated)
            .push_next(&mut import);

        // SAFETY: the chained structures are live locals, and the descriptor in
        // `import` is open until `owned` is forgotten below.
        let memory = unsafe { device.allocate_memory(&allocate, None) }.map_err(|code| {
            EncoderError::Vulkan {
                what: "vkAllocateMemory",
                code: code.as_raw(),
            }
        })?;
        // The import succeeded, so Vulkan owns the descriptor now and will close
        // it with the memory. Dropping `owned` would close it a second time.
        core::mem::forget(owned);

        // SAFETY: the image and memory were both created on this device; neither
        // has been bound before, and offset 0 is what a dedicated allocation
        // requires.
        unsafe { device.bind_image_memory(image, memory, 0) }.map_err(|code| {
            // The memory must not leak if the bind fails.
            // SAFETY: nothing was bound to it, so nothing can reference it.
            unsafe { device.free_memory(memory, None) };
            EncoderError::Vulkan {
                what: "vkBindImageMemory",
                code: code.as_raw(),
            }
        })?;

        let view_create = vk::ImageViewCreateInfo::default()
            .image(image)
            .view_type(vk::ImageViewType::TYPE_2D)
            .format(format)
            .subresource_range(vk::ImageSubresourceRange {
                aspect_mask: vk::ImageAspectFlags::COLOR,
                base_mip_level: 0,
                level_count: 1,
                base_array_layer: 0,
                layer_count: 1,
            });
        // SAFETY: the image is created and bound, and `view_create` is a live
        // local naming it.
        let view = unsafe { device.create_image_view(&view_create, None) }.map_err(|code| {
            // SAFETY: nothing references the memory or the image yet.
            unsafe { device.free_memory(memory, None) };
            EncoderError::Vulkan {
                what: "vkCreateImageView",
                code: code.as_raw(),
            }
        })?;

        Ok((memory, view))
    }

    /// The image handle, for barriers and dispatches.
    #[must_use]
    pub const fn image(&self) -> vk::Image {
        self.image
    }

    /// The tiling Vulkan says this image actually has.
    ///
    /// Worth asking rather than remembering what we declared. The import states
    /// the modifier explicitly, and a driver will happily accept a **wrong**
    /// one: declaring LINEAR for a tiled surface creates an image, binds it, and
    /// reports success — then reads the bytes in the wrong order. Nothing in the
    /// import path can catch that, and this milestone has already been bitten
    /// once by exactly this shape of lie (`vaDeriveImage`). Comparing this
    /// against the surface's own modifier is what makes it catchable.
    ///
    /// # Errors
    /// [`EncoderError::Vulkan`].
    pub fn modifier(&self) -> Result<u64, EncoderError> {
        let mut properties = vk::ImageDrmFormatModifierPropertiesEXT::default();
        // SAFETY: the image is live and was created with
        // `DRM_FORMAT_MODIFIER_EXT` tiling, which is this call's precondition;
        // `properties` is a live local the driver writes.
        unsafe {
            self.context
                .drm_format_modifier()
                .get_image_drm_format_modifier_properties(self.image, &mut properties)
        }
        .map_err(|code| EncoderError::Vulkan {
            what: "vkGetImageDrmFormatModifierPropertiesEXT",
            code: code.as_raw(),
        })?;
        Ok(properties.drm_format_modifier)
    }

    /// The storage view the shader binds.
    #[must_use]
    pub const fn view(&self) -> vk::ImageView {
        self.view
    }

    /// Width in pixels of this plane — half the surface's, for chroma.
    #[must_use]
    pub const fn width(&self) -> u32 {
        self.width
    }

    /// Height in pixels of this plane.
    #[must_use]
    pub const fn height(&self) -> u32 {
        self.height
    }
}

impl Drop for ImportedPlane<'_> {
    fn drop(&mut self) {
        let device = self.context.device();
        // SAFETY: the view, image and memory were all created on this device and
        // are destroyed in dependency order. Any work referencing them has been
        // waited on — `Context`'s own Drop waits, and it outlives this by the
        // borrow, so the ordering holds for the whole lifetime.
        unsafe {
            device.destroy_image_view(self.view, None);
            device.destroy_image(self.image, None);
            device.free_memory(self.memory, None);
        }
    }
}

/// Both planes of an NV12 encode surface, imported and ready to be written.
#[derive(Debug)]
pub struct Nv12Target<'a> {
    /// Full-resolution luma, `R8_UNORM`.
    pub luma: ImportedPlane<'a>,
    /// Half-resolution interleaved chroma, `R8G8_UNORM`.
    pub chroma: ImportedPlane<'a>,
}

impl<'a> Nv12Target<'a> {
    /// Imports an encoder surface as two storage images.
    ///
    /// Two separate images rather than one NV12 image, and that is not a style
    /// choice: measured on the RX 6650 XT, a combined
    /// `G8_B8R8_2PLANE_420_UNORM` carries the modifier with `storage=NO`, so a
    /// shader cannot write it at all.
    ///
    /// # Errors
    /// [`EncoderError::UnexpectedExport`] if the surface is not the two-plane,
    /// single-buffer shape this crate has measured, or [`EncoderError::Vulkan`].
    pub fn import(context: &'a Context, surface: &ExportedSurface) -> Result<Self, EncoderError> {
        if surface.planes.len() != 2 {
            return Err(EncoderError::UnexpectedExport {
                what: "an NV12 surface that is not exactly two planes",
            });
        }
        if surface.buffers.len() != 1 {
            return Err(EncoderError::UnexpectedExport {
                what: "an NV12 surface spread over more than one buffer object",
            });
        }
        // Odd dimensions would put half a chroma sample at the edge. The encoder
        // already refuses anything that is not whole macroblocks, so this cannot
        // trigger from that path — it is here because this function is public.
        if !surface.width.is_multiple_of(2) || !surface.height.is_multiple_of(2) {
            return Err(EncoderError::UnsupportedSize {
                width: surface.width,
                height: surface.height,
            });
        }

        let buffer = &surface.buffers[0];
        let luma = ImportedPlane::import(
            context,
            buffer,
            surface.modifier,
            surface.planes[0],
            surface.width,
            surface.height,
        )?;
        // 4:2:0 means the chroma plane is exactly half in both axes. The
        // division is exact and cannot truncate, because odd dimensions were
        // refused above — which is why the check is a precondition rather than a
        // rounding decision hidden here.
        #[allow(
            clippy::integer_division,
            reason = "both dimensions were just asserted even, so this is exact"
        )]
        let (chroma_width, chroma_height) = (surface.width / 2, surface.height / 2);
        let chroma = ImportedPlane::import(
            context,
            buffer,
            surface.modifier,
            surface.planes[1],
            chroma_width,
            chroma_height,
        )?;
        Ok(Self { luma, chroma })
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
    use crate::av::Encoder;
    use crate::va::DEFAULT_RENDER_NODE;

    fn encoder_and_context() -> (Encoder, Context) {
        let Ok(encoder) = Encoder::open(DEFAULT_RENDER_NODE, 640, 480, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        (encoder, context)
    }

    /// The join D5 exists to make legal, in Rust for the first time: a surface
    /// libavcodec allocated, imported into Vulkan as two writable images.
    #[test]
    fn the_encoders_own_surface_imports_as_two_writable_planes() {
        let (mut encoder, context) = encoder_and_context();
        let surface = encoder.export(0).unwrap();
        let target = Nv12Target::import(&context, &surface).unwrap();

        assert_eq!((target.luma.width(), target.luma.height()), (640, 480));
        // Half in both axes is the whole point of 4:2:0; a chroma plane at full
        // size would sample the picture wrong without failing anything.
        assert_eq!((target.chroma.width(), target.chroma.height()), (320, 240));
        assert_ne!(target.luma.image(), target.chroma.image());
        assert_ne!(target.luma.view(), target.chroma.view());

        // The assertion that catches a wrong tiling. Everything above passes
        // just as happily if the import declares LINEAR for a tiled surface —
        // verified by doing exactly that — because the driver accepts the lie
        // and only the pixels would disagree, much later and much less legibly.
        assert_eq!(target.luma.modifier().unwrap(), surface.modifier);
        assert_eq!(target.chroma.modifier().unwrap(), surface.modifier);
    }

    /// Importing must not consume the caller's descriptor. If it did, the
    /// exported surface would be holding a closed fd and the *second* import
    /// would fail — so importing twice is what proves the dup.
    #[test]
    fn importing_does_not_consume_the_callers_descriptor() {
        let (mut encoder, context) = encoder_and_context();
        let surface = encoder.export(0).unwrap();

        let first = Nv12Target::import(&context, &surface).unwrap();
        let second = Nv12Target::import(&context, &surface).unwrap();
        // Two independent imports of the same memory: distinct Vulkan objects.
        assert_ne!(first.luma.image(), second.luma.image());
        drop(first);
        // And the surviving one is still usable after the first is destroyed.
        assert_eq!(second.luma.width(), 640);
    }

    /// The negative twin: a surface that is not the measured shape is refused
    /// rather than imported into something plausible.
    #[test]
    fn a_surface_that_is_not_two_planes_is_refused() {
        let (mut encoder, context) = encoder_and_context();
        let mut surface = encoder.export(0).unwrap();
        surface.planes.truncate(1);

        let error = Nv12Target::import(&context, &surface).unwrap_err();
        assert!(
            matches!(error, EncoderError::UnexpectedExport { .. }),
            "{error:?}"
        );
    }

    /// A plane fourcc nobody has measured must stop the import, not be mapped to
    /// whichever Vulkan format looks close.
    #[test]
    fn an_unmeasured_plane_format_is_refused() {
        let (mut encoder, context) = encoder_and_context();
        let mut surface = encoder.export(0).unwrap();
        surface.planes[1].drm_format = u32::from_le_bytes(*b"AR24");

        let error = Nv12Target::import(&context, &surface).unwrap_err();
        assert!(
            matches!(error, EncoderError::UnexpectedExport { .. }),
            "{error:?}"
        );
    }
}
