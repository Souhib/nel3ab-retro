//! The compute pass: RGBA in, NV12 written straight into the encoder's surface.
//!
//! This is the step the whole architecture was arranged around. Nothing is
//! copied to the CPU, nothing is copied between GPU buffers: the shader reads
//! the frame the emulator rendered and writes the two planes the video engine
//! will read, in place.
//!
//! The colour maths lives in `shaders/rgba_to_nv12.comp` and is compiled to
//! SPIR-V at build time rather than committed, so the binary cannot drift from
//! the source it claims to be. It was proven separately: **0 samples outside
//! ±1** against a double-precision reference written out longhand.

use ash::vk;

use super::Context;
use super::image::Nv12Target;
use crate::error::EncoderError;

/// The compiled shader, embedded at build time.
const SHADER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/rgba_to_nv12.spv"));

/// Workgroup size, matching `local_size_x/y` in the shader.
///
/// Duplicated between GLSL and Rust because SPIR-V does not hand it back
/// conveniently — so it is asserted rather than trusted: a mismatch would
/// dispatch too few groups and leave the bottom-right of the picture unwritten,
/// which reads as a frame with a stale corner rather than as an error.
const WORKGROUP: u32 = 8;

/// Everything the compute pass needs, built once and reused per frame.
///
/// Borrows the [`Context`], so it cannot outlive the device that owns its
/// pipeline.
pub struct Converter<'a> {
    context: &'a Context,
    sampler: vk::Sampler,
    descriptor_layout: vk::DescriptorSetLayout,
    pipeline_layout: vk::PipelineLayout,
    pipeline: vk::Pipeline,
    descriptor_pool: vk::DescriptorPool,
    descriptor_set: vk::DescriptorSet,
    command_pool: vk::CommandPool,
    command_buffer: vk::CommandBuffer,
    fence: vk::Fence,
}

impl core::fmt::Debug for Converter<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Converter").finish_non_exhaustive()
    }
}

impl<'a> Converter<'a> {
    /// Builds the pipeline.
    ///
    /// # Errors
    /// [`EncoderError::Vulkan`].
    pub fn new(context: &'a Context) -> Result<Self, EncoderError> {
        let device = context.device();
        let mut built = Built::default();

        // Every step below can fail, and each leaves objects the next one would
        // leak. `build` returns through one path so `Built`'s teardown is the
        // only place destruction is written.
        match Self::build(context, &mut built) {
            Ok(()) => Ok(Self {
                context,
                sampler: built.sampler,
                descriptor_layout: built.descriptor_layout,
                pipeline_layout: built.pipeline_layout,
                pipeline: built.pipeline,
                descriptor_pool: built.descriptor_pool,
                descriptor_set: built.descriptor_set,
                command_pool: built.command_pool,
                command_buffer: built.command_buffer,
                fence: built.fence,
            }),
            Err(error) => {
                built.destroy(device);
                Err(error)
            }
        }
    }

    fn build(context: &Context, built: &mut Built) -> Result<(), EncoderError> {
        let device = context.device();

        // NEAREST and no mipmaps: the shader uses texelFetch, which ignores
        // filtering entirely. A LINEAR sampler here would be a lie about what
        // the pass does.
        let sampler_create = vk::SamplerCreateInfo::default()
            .mag_filter(vk::Filter::NEAREST)
            .min_filter(vk::Filter::NEAREST)
            .address_mode_u(vk::SamplerAddressMode::CLAMP_TO_EDGE)
            .address_mode_v(vk::SamplerAddressMode::CLAMP_TO_EDGE)
            .address_mode_w(vk::SamplerAddressMode::CLAMP_TO_EDGE);
        // SAFETY: `sampler_create` is a live local; Vulkan copies it.
        built.sampler = unsafe { device.create_sampler(&sampler_create, None) }
            .map_err(|code| fail("vkCreateSampler", code))?;

        let bindings = [
            binding(0, vk::DescriptorType::COMBINED_IMAGE_SAMPLER),
            binding(1, vk::DescriptorType::STORAGE_IMAGE),
            binding(2, vk::DescriptorType::STORAGE_IMAGE),
        ];
        let layout_create = vk::DescriptorSetLayoutCreateInfo::default().bindings(&bindings);
        // SAFETY: `bindings` outlives the call and its length is what ash
        // recorded.
        built.descriptor_layout =
            unsafe { device.create_descriptor_set_layout(&layout_create, None) }
                .map_err(|code| fail("vkCreateDescriptorSetLayout", code))?;

        let layouts = [built.descriptor_layout];
        let push = [vk::PushConstantRange::default()
            .stage_flags(vk::ShaderStageFlags::COMPUTE)
            .offset(0)
            // Two int32s: the chroma-plane size the shader bounds-checks against.
            .size(8)];
        let pipeline_layout_create = vk::PipelineLayoutCreateInfo::default()
            .set_layouts(&layouts)
            .push_constant_ranges(&push);
        // SAFETY: both slices are live locals for the call.
        built.pipeline_layout =
            unsafe { device.create_pipeline_layout(&pipeline_layout_create, None) }
                .map_err(|code| fail("vkCreatePipelineLayout", code))?;

        let code = spirv_words(SHADER)?;
        let module_create = vk::ShaderModuleCreateInfo::default().code(&code);
        // SAFETY: `code` is a live, 4-byte-aligned `Vec<u32>` of the length ash
        // recorded — the alignment is why `spirv_words` copies rather than
        // casting the byte slice in place.
        let module = unsafe { device.create_shader_module(&module_create, None) }
            .map_err(|code| fail("vkCreateShaderModule", code))?;

        let entry = c"main";
        let stage = vk::PipelineShaderStageCreateInfo::default()
            .stage(vk::ShaderStageFlags::COMPUTE)
            .module(module)
            .name(entry);
        let pipeline_create = [vk::ComputePipelineCreateInfo::default()
            .stage(stage)
            .layout(built.pipeline_layout)];
        // SAFETY: the module and layout are live, and `entry` is a `&'static
        // CStr`. ash returns the pipelines it created alongside any error.
        let pipelines = unsafe {
            device.create_compute_pipelines(vk::PipelineCache::null(), &pipeline_create, None)
        };
        // The module is only needed while the pipeline is compiled.
        // SAFETY: creation has returned, so nothing references it any more.
        unsafe { device.destroy_shader_module(module, None) };
        built.pipeline = *pipelines
            .map_err(|(_, code)| fail("vkCreateComputePipelines", code))?
            .first()
            .ok_or(EncoderError::Vulkan {
                what: "vkCreateComputePipelines returned no pipeline",
                code: 0,
            })?;

        let sizes = [
            vk::DescriptorPoolSize::default()
                .ty(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
                .descriptor_count(1),
            vk::DescriptorPoolSize::default()
                .ty(vk::DescriptorType::STORAGE_IMAGE)
                .descriptor_count(2),
        ];
        let pool_create = vk::DescriptorPoolCreateInfo::default()
            .pool_sizes(&sizes)
            .max_sets(1);
        // SAFETY: `sizes` is a live local of the recorded length.
        built.descriptor_pool = unsafe { device.create_descriptor_pool(&pool_create, None) }
            .map_err(|code| fail("vkCreateDescriptorPool", code))?;

        let allocate = vk::DescriptorSetAllocateInfo::default()
            .descriptor_pool(built.descriptor_pool)
            .set_layouts(&layouts);
        // SAFETY: the pool has room for exactly this one set, and `layouts` is
        // live.
        built.descriptor_set = *unsafe { device.allocate_descriptor_sets(&allocate) }
            .map_err(|code| fail("vkAllocateDescriptorSets", code))?
            .first()
            .ok_or(EncoderError::Vulkan {
                what: "vkAllocateDescriptorSets returned no set",
                code: 0,
            })?;

        let command_pool_create = vk::CommandPoolCreateInfo::default()
            .queue_family_index(context.queue_family())
            // The buffer is re-recorded every frame rather than reset
            // individually, which is what this flag allows.
            .flags(vk::CommandPoolCreateFlags::RESET_COMMAND_BUFFER);
        // SAFETY: live local; the family index came from this device.
        built.command_pool = unsafe { device.create_command_pool(&command_pool_create, None) }
            .map_err(|code| fail("vkCreateCommandPool", code))?;

        let command_allocate = vk::CommandBufferAllocateInfo::default()
            .command_pool(built.command_pool)
            .level(vk::CommandBufferLevel::PRIMARY)
            .command_buffer_count(1);
        // SAFETY: the pool was just created on this device.
        built.command_buffer = *unsafe { device.allocate_command_buffers(&command_allocate) }
            .map_err(|code| fail("vkAllocateCommandBuffers", code))?
            .first()
            .ok_or(EncoderError::Vulkan {
                what: "vkAllocateCommandBuffers returned no buffer",
                code: 0,
            })?;

        // SAFETY: a default fence create info is always valid.
        built.fence = unsafe { device.create_fence(&vk::FenceCreateInfo::default(), None) }
            .map_err(|code| fail("vkCreateFence", code))?;

        Ok(())
    }

    /// Converts one frame, and blocks until the GPU has finished.
    ///
    /// Blocking is deliberate at this stage. The frame must be finished before
    /// the encoder reads the surface, and a fence waited on here is the simplest
    /// thing that is *correct* — the same reasoning that closed M2's second
    /// race. Overlapping this with the next frame is a later optimisation, and
    /// one to make only with a measurement in hand.
    ///
    /// # Errors
    /// [`EncoderError::Vulkan`], or [`EncoderError::UnsupportedSize`] if the
    /// source is not the size of the target.
    pub fn convert(&self, source: Source, target: &Nv12Target<'_>) -> Result<(), EncoderError> {
        if source.width != target.luma.width() || source.height != target.luma.height() {
            return Err(EncoderError::UnsupportedSize {
                width: source.width,
                height: source.height,
            });
        }

        let device = self.context.device();
        self.write_descriptors(source, target);

        // SAFETY: no submission using this buffer is in flight — the previous
        // `convert` waited on the fence before returning, and `&self` plus the
        // fence wait below serialise the rest.
        unsafe {
            device
                .reset_command_buffer(self.command_buffer, vk::CommandBufferResetFlags::empty())
                .map_err(|code| fail("vkResetCommandBuffer", code))?;
            device
                .begin_command_buffer(
                    self.command_buffer,
                    &vk::CommandBufferBeginInfo::default()
                        .flags(vk::CommandBufferUsageFlags::ONE_TIME_SUBMIT),
                )
                .map_err(|code| fail("vkBeginCommandBuffer", code))?;
        }

        self.record(source, target);

        // SAFETY: recording is complete and the buffer is in the recording state.
        unsafe {
            device
                .end_command_buffer(self.command_buffer)
                .map_err(|code| fail("vkEndCommandBuffer", code))?;
        }

        let buffers = [self.command_buffer];
        let submit = [vk::SubmitInfo::default().command_buffers(&buffers)];
        // SAFETY: the buffer is recorded and not in flight; the fence is
        // unsignalled, having been reset below on every previous call.
        unsafe {
            device
                .reset_fences(&[self.fence])
                .map_err(|code| fail("vkResetFences", code))?;
            device
                .queue_submit(self.context.queue(), &submit, self.fence)
                .map_err(|code| fail("vkQueueSubmit", code))?;
            device
                .wait_for_fences(&[self.fence], true, u64::MAX)
                .map_err(|code| fail("vkWaitForFences", code))?;
        }
        Ok(())
    }

    /// Points the descriptor set at this frame's images.
    fn write_descriptors(&self, source: Source, target: &Nv12Target<'_>) {
        let sampled = [vk::DescriptorImageInfo::default()
            .sampler(self.sampler)
            .image_view(source.view)
            .image_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)];
        let luma = [vk::DescriptorImageInfo::default()
            .image_view(target.luma.view())
            .image_layout(vk::ImageLayout::GENERAL)];
        let chroma = [vk::DescriptorImageInfo::default()
            .image_view(target.chroma.view())
            .image_layout(vk::ImageLayout::GENERAL)];
        let writes = [
            vk::WriteDescriptorSet::default()
                .dst_set(self.descriptor_set)
                .dst_binding(0)
                .descriptor_type(vk::DescriptorType::COMBINED_IMAGE_SAMPLER)
                .image_info(&sampled),
            vk::WriteDescriptorSet::default()
                .dst_set(self.descriptor_set)
                .dst_binding(1)
                .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
                .image_info(&luma),
            vk::WriteDescriptorSet::default()
                .dst_set(self.descriptor_set)
                .dst_binding(2)
                .descriptor_type(vk::DescriptorType::STORAGE_IMAGE)
                .image_info(&chroma),
        ];
        // SAFETY: every view and the sampler are live for the call, the set was
        // allocated from a pool that is still alive, and no submission using
        // this set is in flight.
        unsafe {
            self.context.device().update_descriptor_sets(&writes, &[]);
        }
    }

    /// Records the barriers and the dispatch.
    fn record(&self, source: Source, target: &Nv12Target<'_>) {
        let device = self.context.device();
        let buffer = self.command_buffer;

        if source.ownership == Ownership::Foreign {
            // GENERAL is the layout the producer leaves it in — see the Dolphin
            // patch's final barrier. Naming UNDEFINED here instead would be
            // legal Vulkan and would discard the picture.
            let acquire = [vk::ImageMemoryBarrier::default()
                .dst_access_mask(vk::AccessFlags::SHADER_READ)
                .old_layout(vk::ImageLayout::GENERAL)
                .new_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                .src_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                .dst_queue_family_index(self.context.queue_family())
                .image(source.image)
                .subresource_range(whole_image())];
            // SAFETY: the buffer is recording and the image is live.
            unsafe {
                device.cmd_pipeline_barrier(
                    buffer,
                    vk::PipelineStageFlags::TOP_OF_PIPE,
                    vk::PipelineStageFlags::COMPUTE_SHADER,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[],
                    &acquire,
                );
            }
        }

        // The two planes were imported with layout UNDEFINED, so they must be
        // moved to GENERAL before a shader can store into them. UNDEFINED as the
        // old layout discards their contents, which is correct: the shader
        // writes every pixel.
        let to_general = [
            image_barrier(target.luma.image(), vk::AccessFlags::SHADER_WRITE),
            image_barrier(target.chroma.image(), vk::AccessFlags::SHADER_WRITE),
        ];
        // SAFETY: the buffer is recording, and every image named is live.
        unsafe {
            device.cmd_pipeline_barrier(
                buffer,
                vk::PipelineStageFlags::TOP_OF_PIPE,
                vk::PipelineStageFlags::COMPUTE_SHADER,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &to_general,
            );

            device.cmd_bind_pipeline(buffer, vk::PipelineBindPoint::COMPUTE, self.pipeline);
            device.cmd_bind_descriptor_sets(
                buffer,
                vk::PipelineBindPoint::COMPUTE,
                self.pipeline_layout,
                0,
                &[self.descriptor_set],
                &[],
            );

            let chroma_size = [
                i32::try_from(target.chroma.width()).unwrap_or(i32::MAX),
                i32::try_from(target.chroma.height()).unwrap_or(i32::MAX),
            ];
            device.cmd_push_constants(
                buffer,
                self.pipeline_layout,
                vk::ShaderStageFlags::COMPUTE,
                0,
                bytemuck_i32(&chroma_size),
            );

            // Round up: a picture whose chroma size is not a multiple of the
            // workgroup would otherwise leave its last row and column unwritten,
            // which looks like a stale edge rather than an error. The shader
            // bounds-checks the surplus invocations.
            device.cmd_dispatch(
                buffer,
                target.chroma.width().div_ceil(WORKGROUP),
                target.chroma.height().div_ceil(WORKGROUP),
                1,
            );

            // Hand both planes to the foreign queue family — VAAPI's video
            // engine is not a Vulkan queue, and this is how Vulkan is told the
            // memory is about to be read by something it does not know about.
            let release = [
                release_barrier(target.luma.image(), self.context.queue_family()),
                release_barrier(target.chroma.image(), self.context.queue_family()),
            ];
            device.cmd_pipeline_barrier(
                buffer,
                vk::PipelineStageFlags::COMPUTE_SHADER,
                vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                vk::DependencyFlags::empty(),
                &[],
                &[],
                &release,
            );

            if source.ownership == Ownership::Foreign {
                // Back to GENERAL and back to foreign, which is the state the
                // producer's own acquire expects to find next frame.
                let give_back = [vk::ImageMemoryBarrier::default()
                    .src_access_mask(vk::AccessFlags::SHADER_READ)
                    .old_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                    .new_layout(vk::ImageLayout::GENERAL)
                    .src_queue_family_index(self.context.queue_family())
                    .dst_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                    .image(source.image)
                    .subresource_range(whole_image())];
                device.cmd_pipeline_barrier(
                    buffer,
                    vk::PipelineStageFlags::COMPUTE_SHADER,
                    vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[],
                    &give_back,
                );
            }
        }
    }
}

impl Drop for Converter<'_> {
    fn drop(&mut self) {
        let device = self.context.device();
        // SAFETY: `convert` waits on its fence before returning, so nothing is
        // in flight; the wait below covers any path that did not. Objects are
        // destroyed in dependency order, and the `Context` outlives this by the
        // borrow.
        unsafe {
            let _ = device.device_wait_idle();
            device.destroy_fence(self.fence, None);
            device.destroy_command_pool(self.command_pool, None);
            device.destroy_descriptor_pool(self.descriptor_pool, None);
            device.destroy_pipeline(self.pipeline, None);
            device.destroy_pipeline_layout(self.pipeline_layout, None);
            device.destroy_descriptor_set_layout(self.descriptor_layout, None);
            device.destroy_sampler(self.sampler, None);
        }
    }
}

/// The RGBA frame to read.
#[derive(Debug, Clone, Copy)]
pub struct Source {
    /// The image, needed for the ownership barriers.
    pub image: vk::Image,
    /// The sampled view the shader reads.
    pub view: vk::ImageView,
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Who owns the image when it arrives.
    pub ownership: Ownership,
}

/// Where a source image comes from, which decides the barriers it needs.
///
/// An enum rather than a bool, and stated by the caller rather than guessed:
/// getting this wrong is a synchronisation bug, and those do not announce
/// themselves. Vulkan is entitled to hand back undefined contents for a
/// mismatched ownership transfer, which on a real driver usually means "works
/// until it does not".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ownership {
    /// Written by another device — the emulator — and released to the foreign
    /// queue family in `GENERAL`.
    ///
    /// It is acquired before the dispatch and given back after, because the
    /// producer's next frame acquires it from foreign in `GENERAL` again. Not
    /// giving it back would leave the two sides disagreeing about who owns the
    /// memory, which the validation layers notice and the driver may not.
    Foreign,

    /// Already ours, and already in `SHADER_READ_ONLY_OPTIMAL`.
    Local,
}

/// Objects built one at a time, so a failure part-way destroys exactly what
/// exists.
///
/// Null handles are what Vulkan's destroy functions are specified to ignore, so
/// the teardown needs no per-field conditional — the type does it.
#[derive(Default)]
struct Built {
    sampler: vk::Sampler,
    descriptor_layout: vk::DescriptorSetLayout,
    pipeline_layout: vk::PipelineLayout,
    pipeline: vk::Pipeline,
    descriptor_pool: vk::DescriptorPool,
    descriptor_set: vk::DescriptorSet,
    command_pool: vk::CommandPool,
    command_buffer: vk::CommandBuffer,
    fence: vk::Fence,
}

impl Built {
    fn destroy(&self, device: &ash::Device) {
        // SAFETY: every handle is either live and created on this device, or
        // null — which vkDestroy* is required to accept and ignore. Nothing has
        // been submitted, so nothing is in flight.
        unsafe {
            device.destroy_fence(self.fence, None);
            device.destroy_command_pool(self.command_pool, None);
            device.destroy_descriptor_pool(self.descriptor_pool, None);
            device.destroy_pipeline(self.pipeline, None);
            device.destroy_pipeline_layout(self.pipeline_layout, None);
            device.destroy_descriptor_set_layout(self.descriptor_layout, None);
            device.destroy_sampler(self.sampler, None);
        }
    }
}

const fn fail(what: &'static str, code: vk::Result) -> EncoderError {
    EncoderError::Vulkan {
        what,
        code: code.as_raw(),
    }
}

fn binding(index: u32, kind: vk::DescriptorType) -> vk::DescriptorSetLayoutBinding<'static> {
    vk::DescriptorSetLayoutBinding::default()
        .binding(index)
        .descriptor_type(kind)
        .descriptor_count(1)
        .stage_flags(vk::ShaderStageFlags::COMPUTE)
}

fn image_barrier(image: vk::Image, access: vk::AccessFlags) -> vk::ImageMemoryBarrier<'static> {
    vk::ImageMemoryBarrier::default()
        .dst_access_mask(access)
        .old_layout(vk::ImageLayout::UNDEFINED)
        .new_layout(vk::ImageLayout::GENERAL)
        .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
        .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
        .image(image)
        .subresource_range(whole_image())
}

fn release_barrier(image: vk::Image, from: u32) -> vk::ImageMemoryBarrier<'static> {
    vk::ImageMemoryBarrier::default()
        .src_access_mask(vk::AccessFlags::SHADER_WRITE)
        .old_layout(vk::ImageLayout::GENERAL)
        .new_layout(vk::ImageLayout::GENERAL)
        .src_queue_family_index(from)
        .dst_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
        .image(image)
        .subresource_range(whole_image())
}

const fn whole_image() -> vk::ImageSubresourceRange {
    vk::ImageSubresourceRange {
        aspect_mask: vk::ImageAspectFlags::COLOR,
        base_mip_level: 0,
        level_count: 1,
        base_array_layer: 0,
        layer_count: 1,
    }
}

/// Reinterprets two `i32`s as the bytes `vkCmdPushConstants` wants.
const fn bytemuck_i32(values: &[i32; 2]) -> &[u8] {
    // SAFETY: `i32` has no padding and no invalid bit patterns, and `u8` has
    // alignment 1, so any `[i32; 2]` is a valid `[u8; 8]`. The lifetime is tied
    // to the input, so the bytes cannot outlive the array.
    unsafe {
        core::slice::from_raw_parts(values.as_ptr().cast::<u8>(), core::mem::size_of_val(values))
    }
}

/// Turns the embedded SPIR-V into the `u32` words Vulkan wants.
///
/// Copied rather than cast in place: `include_bytes!` gives a `&[u8]` with no
/// alignment guarantee, and `vkCreateShaderModule` requires 4-byte-aligned code.
/// Casting would be undefined behaviour that happens to work most of the time.
fn spirv_words(bytes: &[u8]) -> Result<Vec<u32>, EncoderError> {
    if !bytes.len().is_multiple_of(4) || bytes.is_empty() {
        return Err(EncoderError::Vulkan {
            what: "the embedded SPIR-V is not a whole number of words",
            code: 0,
        });
    }
    Ok(bytes
        .chunks_exact(4)
        .map(|word| u32::from_le_bytes([word[0], word[1], word[2], word[3]]))
        .collect())
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "a panic IS the failure signal in a test"
)]
mod tests {
    use super::*;

    /// SPIR-V starts with a magic number. Checking it is cheap and catches the
    /// build script having produced something that is not a shader — which would
    /// otherwise surface as a driver error with no explanation.
    #[test]
    fn the_embedded_shader_is_spirv() {
        let words = spirv_words(SHADER).unwrap();
        assert_eq!(words[0], 0x0723_0203, "not a SPIR-V magic number");
    }

    /// The negative twin: a byte count that is not a whole number of words must
    /// be refused rather than silently truncated.
    #[test]
    fn a_truncated_shader_is_refused() {
        assert!(spirv_words(&SHADER[..SHADER.len() - 1]).is_err());
        assert!(spirv_words(&[]).is_err());
    }

    /// The push constant is read by the shader as two `int`s, so its byte
    /// layout is part of the interface rather than an implementation detail.
    #[test]
    fn the_push_constant_is_two_little_endian_int32s() {
        assert_eq!(
            bytemuck_i32(&[320, 240]),
            &[0x40, 0x01, 0x00, 0x00, 0xf0, 0x00, 0x00, 0x00]
        );
    }

    #[cfg(feature = "gpu-tests")]
    const WIDTH: u32 = 640;
    #[cfg(feature = "gpu-tests")]
    const HEIGHT: u32 = 480;

    /// BT.709 luma weights, written out here independently of the shader.
    ///
    /// Deliberately not shared: a reference that imported the shader's constants
    /// would prove the code equals itself. These are transcribed from the
    /// standard.
    #[allow(
        clippy::suboptimal_flops,
        reason = "a reference is a transcription; written as the standard states it, \
                  not as the fastest way to get the same number. f64 carries some ten \
                  orders of magnitude more precision than the +/-1 this compares at, so \
                  the fused form would buy accuracy nothing here can spend"
    )]
    #[cfg(feature = "gpu-tests")]
    fn reference_luma(r: f64, g: f64, b: f64) -> f64 {
        16.0 + 219.0 * (0.2126 * r + 0.7152 * g + 0.0722 * b)
    }

    /// A pattern with structure in both axes and all three channels, so a
    /// swapped axis, a swapped channel or a stale region all change the answer.
    #[cfg(feature = "gpu-tests")]
    fn pattern() -> Vec<u8> {
        let mut pixels = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
        #[allow(
            clippy::cast_possible_truncation,
            reason = "WIDTH*HEIGHT*4 is 1.2 MB; the cast is exact on every target \
                      this builds for"
        )]
        for y in 0..HEIGHT {
            for x in 0..WIDTH {
                // `& 0xff` rather than `% 256` and a cast: the truncation is
                // the intent, and saying so with a mask means no lint to silence
                // and no reader wondering whether it was an oversight.
                pixels.push(u8::try_from(x & 0xff).unwrap_or(0));
                pixels.push(u8::try_from(y & 0xff).unwrap_or(0));
                pixels.push(u8::try_from((x + y) & 0xff).unwrap_or(0));
                pixels.push(255);
            }
        }
        pixels
    }

    /// The whole point of M2, proven on the bytes.
    ///
    /// A known picture goes into an RGBA image, the compute pass writes NV12
    /// straight into a surface **libavcodec allocated**, and the luma plane is
    /// read back and compared against a reference computed from the standard.
    ///
    /// The readback is the thing this architecture exists to delete, which is why
    /// it lives only in this test. What it catches: wrong colour maths, a
    /// swapped plane, a region nothing wrote.
    ///
    /// What it does **not** catch, verified rather than assumed: a wrong DRM
    /// modifier. Declaring LINEAR for a tiled surface leaves this test green,
    /// because the shader writes and the copy reads through the *same*
    /// declaration — a lie that is consistent with itself is invisible to a
    /// round trip through it. Only the video engine uses the real tiling, and
    /// only [`Nv12Target`]'s modifier assertion compares what we declared
    /// against what the surface actually is. Re-checked: with modifier 0, that
    /// test is the single one in the crate that fails.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn the_shader_writes_correct_bt709_luma_into_the_encoders_surface() {
        use crate::av::Encoder;
        use crate::va::DEFAULT_RENDER_NODE;

        let Ok(mut encoder) = Encoder::open(DEFAULT_RENDER_NODE, WIDTH, HEIGHT, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };

        let surface = encoder.export(0).unwrap();
        let target = Nv12Target::import(&context, &surface).unwrap();

        let pixels = pattern();
        let source = scaffold::Rgba::upload(&context, WIDTH, HEIGHT, &pixels);
        let converter = Converter::new(&context).unwrap();
        converter.convert(source.source(), &target).unwrap();

        let luma = scaffold::read_plane(&context, target.luma.image(), WIDTH, HEIGHT, 1);
        assert_eq!(luma.len(), (WIDTH * HEIGHT) as usize);

        let mut worst = 0_i32;
        let mut at = (0_u32, 0_u32);
        for y in 0..HEIGHT {
            for x in 0..WIDTH {
                let i = ((y * WIDTH + x) * 4) as usize;
                let expected = reference_luma(
                    f64::from(pixels[i]) / 255.0,
                    f64::from(pixels[i + 1]) / 255.0,
                    f64::from(pixels[i + 2]) / 255.0,
                );
                let got = f64::from(luma[(y * WIDTH + x) as usize]);
                #[allow(
                    clippy::cast_possible_truncation,
                    reason = "a difference between two 8-bit samples fits in i32"
                )]
                let delta = (got - expected).abs().round() as i32;
                if delta > worst {
                    worst = delta;
                    at = (x, y);
                }
            }
        }
        // ±1 was measured by the C spike against a double-precision reference;
        // the tolerance is 1, not "small", so a regression to 2 fails here.
        assert!(
            worst <= 1,
            "worst luma error {worst} at {at:?} — the conversion, the tiling or the \
             plane mapping is wrong"
        );

        // Not a formality: a plane of a single value would pass the comparison
        // above only if the reference were also flat, but it guards against a
        // readback that silently returned zeroes.
        let first = luma[0];
        assert!(
            luma.iter().any(|sample| *sample != first),
            "the luma plane is uniform; nothing was written"
        );
    }

    /// The chain as it will actually run, minus who renders the picture.
    ///
    /// A **real dma-buf** carrying the pattern, described by a real
    /// [`FrameDescriptor`] and handed over in `GENERAL` released to the foreign
    /// queue family — the state the Dolphin patch leaves its slots in — is
    /// imported, converted, and checked on the bytes.
    ///
    /// This is the last thing that can be proven without running Dolphin. What
    /// it does not cover is the tiling of the emulator's own slots and the ring
    /// protocol; both need the emulator itself.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn a_frame_arriving_as_a_dma_buf_converts_correctly() {
        use crate::av::Encoder;
        use crate::va::DEFAULT_RENDER_NODE;
        use crate::vulkan::image::ImportedFrame;

        let Ok(mut encoder) = Encoder::open(DEFAULT_RENDER_NODE, WIDTH, HEIGHT, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };

        let pixels = pattern();
        let produced = scaffold::ExportedRgba::new(&context, WIDTH, HEIGHT, &pixels);
        let frame =
            ImportedFrame::import(&context, &produced.descriptor, &produced.buffer).unwrap();

        let surface = encoder.export(0).unwrap();
        let target = Nv12Target::import(&context, &surface).unwrap();
        let source = Source {
            image: frame.plane().image(),
            view: frame.plane().view(),
            width: WIDTH,
            height: HEIGHT,
            // The producer released it; we must acquire it and give it back.
            ownership: Ownership::Foreign,
        };
        Converter::new(&context)
            .unwrap()
            .convert(source, &target)
            .unwrap();

        let luma = scaffold::read_plane(&context, target.luma.image(), WIDTH, HEIGHT, 1);
        let mut worst = 0_i32;
        for y in 0..HEIGHT {
            for x in 0..WIDTH {
                let i = ((y * WIDTH + x) * 4) as usize;
                let expected = reference_luma(
                    f64::from(pixels[i]) / 255.0,
                    f64::from(pixels[i + 1]) / 255.0,
                    f64::from(pixels[i + 2]) / 255.0,
                );
                let got = f64::from(luma[(y * WIDTH + x) as usize]);
                #[allow(
                    clippy::cast_possible_truncation,
                    reason = "a difference between two 8-bit samples fits in i32"
                )]
                let delta = (got - expected).abs().round() as i32;
                worst = worst.max(delta);
            }
        }
        assert!(
            worst <= 1,
            "worst luma error {worst} through a real dma-buf"
        );

        // When the validation layer is switched on, its silence is part of the
        // claim. It is off by default because it segfaults RADV on this exact
        // path — see `vulkan::validation` — so on a normal run this asserts
        // nothing. Said out loud rather than left looking like a check.
        let complaints = crate::vulkan::validation_messages();
        assert!(
            complaints.is_empty(),
            "the validation layer objected: {complaints:#?}"
        );
    }

    /// The negative twin: a frame in a format nobody has measured must be
    /// refused rather than reinterpreted. Swapping red and blue is exactly what
    /// mapping DRM's naming onto Vulkan's by eye produces.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn a_frame_that_is_not_abgr8888_is_refused() {
        use crate::va::DEFAULT_RENDER_NODE;
        use crate::vulkan::image::ImportedFrame;

        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        let produced = scaffold::ExportedRgba::new(&context, 64, 64, &vec![0_u8; 64 * 64 * 4]);
        let mut descriptor = produced.descriptor;
        descriptor.drm_format = u32::from_le_bytes(*b"XR24");

        let error = ImportedFrame::import(&context, &descriptor, &produced.buffer).unwrap_err();
        assert!(
            matches!(error, EncoderError::UnexpectedExport { .. }),
            "{error:?}"
        );
    }

    /// And the frame that came out of the shader encodes. The end of the chain,
    /// minus Dolphin — which only supplies the RGBA image the pattern stood in
    /// for.
    #[test]
    #[cfg(feature = "gpu-tests")]
    fn a_converted_frame_encodes_to_more_bytes_than_an_empty_one() {
        use crate::av::Encoder;
        use crate::va::DEFAULT_RENDER_NODE;

        let Ok(mut encoder) = Encoder::open(DEFAULT_RENDER_NODE, WIDTH, HEIGHT, 26, 60, 3) else {
            panic!("no encoder on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device on {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };

        // Slot 1 is left untouched, slot 0 gets the pattern. Encoding both and
        // comparing is what makes this test mean something: an absolute byte
        // count would only be pinning this driver's rate control.
        let empty = encoder.encode(1).unwrap().expect("a packet").len();

        let surface = encoder.export(0).unwrap();
        let target = Nv12Target::import(&context, &surface).unwrap();
        let source = scaffold::Rgba::upload(&context, WIDTH, HEIGHT, &pattern());
        Converter::new(&context)
            .unwrap()
            .convert(source.source(), &target)
            .unwrap();
        drop(target);

        let coded = encoder.encode(0).unwrap().expect("a packet").len();
        assert!(
            coded > empty * 4,
            "a frame carrying a gradient coded {coded} bytes against {empty} for an \
             untouched surface — the encoder did not see the shader's output"
        );
    }
}

/// Scaffolding for the pixel test: an RGBA image that can be filled from the
/// CPU, and a way to read a plane back.
///
/// Test-only, and deliberately so — nothing in the real path ever moves a frame
/// through host memory, which is the entire point of the architecture. This
/// exists because a conversion can only be *proven* against pixels somebody
/// chose, and it is the one place allowed to be slow.
#[cfg(all(test, feature = "gpu-tests"))]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "test scaffolding; a panic IS the failure signal"
)]
mod scaffold {
    use super::*;
    use crate::frame_source::DmaBuf;
    use crate::protocol::FrameDescriptor;

    /// Finds memory the CPU can write.
    fn host_memory_type(context: &Context, allowed: u32) -> u32 {
        let memory = context.physical_memory_properties();
        (0..memory.memory_type_count)
            .find(|index| {
                let legal = allowed & (1_u32 << index) != 0;
                let flags = memory.memory_types[*index as usize].property_flags;
                legal
                    && flags.contains(
                        vk::MemoryPropertyFlags::HOST_VISIBLE
                            | vk::MemoryPropertyFlags::HOST_COHERENT,
                    )
            })
            .expect("some memory type is host-visible and coherent")
    }

    /// A host-writable buffer.
    pub struct Staging<'a> {
        context: &'a Context,
        pub buffer: vk::Buffer,
        memory: vk::DeviceMemory,
        pub size: u64,
    }

    impl<'a> Staging<'a> {
        pub fn new(context: &'a Context, size: u64, usage: vk::BufferUsageFlags) -> Self {
            let device = context.device();
            let create = vk::BufferCreateInfo::default()
                .size(size)
                .usage(usage)
                .sharing_mode(vk::SharingMode::EXCLUSIVE);
            // SAFETY: `create` is a live local.
            let buffer = unsafe { device.create_buffer(&create, None) }.unwrap();
            // SAFETY: the buffer was just created on this device.
            let requirements = unsafe { device.get_buffer_memory_requirements(buffer) };
            let allocate = vk::MemoryAllocateInfo::default()
                .allocation_size(requirements.size)
                .memory_type_index(host_memory_type(context, requirements.memory_type_bits));
            // SAFETY: `allocate` is a live local naming a legal memory type.
            let memory = unsafe { device.allocate_memory(&allocate, None) }.unwrap();
            // SAFETY: neither has been bound before.
            unsafe { device.bind_buffer_memory(buffer, memory, 0) }.unwrap();
            Self {
                context,
                buffer,
                memory,
                size,
            }
        }

        /// Runs `f` over the mapped bytes.
        pub fn with_bytes<R>(&self, f: impl FnOnce(&mut [u8]) -> R) -> R {
            let device = self.context.device();
            // SAFETY: the memory is host-visible and coherent, nothing else maps
            // it, and the range is the whole allocation.
            let pointer = unsafe {
                device.map_memory(self.memory, 0, self.size, vk::MemoryMapFlags::empty())
            }
            .unwrap();
            // SAFETY: the mapping covers `size` bytes, is writable, and no other
            // reference to it exists while this slice is alive.
            let bytes = unsafe {
                core::slice::from_raw_parts_mut(
                    pointer.cast::<u8>(),
                    usize::try_from(self.size).unwrap(),
                )
            };
            let result = f(bytes);
            // SAFETY: the memory is mapped and the slice is dead.
            unsafe { device.unmap_memory(self.memory) };
            result
        }
    }

    impl Drop for Staging<'_> {
        fn drop(&mut self) {
            let device = self.context.device();
            // SAFETY: nothing is in flight — every helper here submits and waits.
            unsafe {
                device.destroy_buffer(self.buffer, None);
                device.free_memory(self.memory, None);
            }
        }
    }

    /// A device-local RGBA image the shader can sample.
    pub struct Rgba<'a> {
        context: &'a Context,
        image: vk::Image,
        memory: vk::DeviceMemory,
        pub view: vk::ImageView,
        pub width: u32,
        pub height: u32,
    }

    impl<'a> Rgba<'a> {
        /// Creates the image and uploads `pixels` into it, leaving it in
        /// `SHADER_READ_ONLY_OPTIMAL` — which is the layout `convert` expects.
        pub fn upload(context: &'a Context, width: u32, height: u32, pixels: &[u8]) -> Self {
            let device = context.device();
            let create = vk::ImageCreateInfo::default()
                .image_type(vk::ImageType::TYPE_2D)
                .format(vk::Format::R8G8B8A8_UNORM)
                .extent(vk::Extent3D {
                    width,
                    height,
                    depth: 1,
                })
                .mip_levels(1)
                .array_layers(1)
                .samples(vk::SampleCountFlags::TYPE_1)
                .tiling(vk::ImageTiling::OPTIMAL)
                .usage(vk::ImageUsageFlags::SAMPLED | vk::ImageUsageFlags::TRANSFER_DST)
                .sharing_mode(vk::SharingMode::EXCLUSIVE)
                .initial_layout(vk::ImageLayout::UNDEFINED);
            // SAFETY: `create` is a live local.
            let image = unsafe { device.create_image(&create, None) }.unwrap();
            // SAFETY: just created on this device.
            let requirements = unsafe { device.get_image_memory_requirements(image) };
            let allocate = vk::MemoryAllocateInfo::default()
                .allocation_size(requirements.size)
                .memory_type_index(
                    context
                        .memory_type_for_import(requirements.memory_type_bits)
                        .unwrap(),
                );
            // SAFETY: live local naming a legal memory type.
            let memory = unsafe { device.allocate_memory(&allocate, None) }.unwrap();
            // SAFETY: neither has been bound before.
            unsafe { device.bind_image_memory(image, memory, 0) }.unwrap();

            Self::fill(context, image, width, height, pixels);

            let view_create = vk::ImageViewCreateInfo::default()
                .image(image)
                .view_type(vk::ImageViewType::TYPE_2D)
                .format(vk::Format::R8G8B8A8_UNORM)
                .subresource_range(whole_image());
            // SAFETY: the image is created and bound.
            let view = unsafe { device.create_image_view(&view_create, None) }.unwrap();

            Self {
                context,
                image,
                memory,
                view,
                width,
                height,
            }
        }

        /// Uploads `pixels` and leaves the image in `SHADER_READ_ONLY_OPTIMAL`.
        fn fill(context: &Context, image: vk::Image, width: u32, height: u32, pixels: &[u8]) {
            let device = context.device();
            let staging = Staging::new(
                context,
                u64::from(width) * u64::from(height) * 4,
                vk::BufferUsageFlags::TRANSFER_SRC,
            );
            staging.with_bytes(|bytes| bytes.copy_from_slice(pixels));

            context.one_shot(|command| {
                let to_dst = vk::ImageMemoryBarrier::default()
                    .dst_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .old_layout(vk::ImageLayout::UNDEFINED)
                    .new_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .image(image)
                    .subresource_range(whole_image());
                let region = vk::BufferImageCopy::default()
                    .image_subresource(vk::ImageSubresourceLayers {
                        aspect_mask: vk::ImageAspectFlags::COLOR,
                        mip_level: 0,
                        base_array_layer: 0,
                        layer_count: 1,
                    })
                    .image_extent(vk::Extent3D {
                        width,
                        height,
                        depth: 1,
                    });
                let to_read = vk::ImageMemoryBarrier::default()
                    .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .dst_access_mask(vk::AccessFlags::SHADER_READ)
                    .old_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                    .new_layout(vk::ImageLayout::SHADER_READ_ONLY_OPTIMAL)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .image(image)
                    .subresource_range(whole_image());
                // SAFETY: the buffer is recording; every handle named is live.
                unsafe {
                    device.cmd_pipeline_barrier(
                        command,
                        vk::PipelineStageFlags::TOP_OF_PIPE,
                        vk::PipelineStageFlags::TRANSFER,
                        vk::DependencyFlags::empty(),
                        &[],
                        &[],
                        &[to_dst],
                    );
                    device.cmd_copy_buffer_to_image(
                        command,
                        staging.buffer,
                        image,
                        vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                        &[region],
                    );
                    device.cmd_pipeline_barrier(
                        command,
                        vk::PipelineStageFlags::TRANSFER,
                        vk::PipelineStageFlags::COMPUTE_SHADER,
                        vk::DependencyFlags::empty(),
                        &[],
                        &[],
                        &[to_read],
                    );
                }
            });
        }

        pub const fn source(&self) -> Source {
            Source {
                image: self.image,
                view: self.view,
                width: self.width,
                height: self.height,
                // Created and filled on this device by the scaffolding above,
                // and left in SHADER_READ_ONLY_OPTIMAL by `fill`.
                ownership: Ownership::Local,
            }
        }
    }

    impl Drop for Rgba<'_> {
        fn drop(&mut self) {
            let device = self.context.device();
            // SAFETY: every helper submits and waits, so nothing is in flight.
            unsafe {
                device.destroy_image_view(self.view, None);
                device.destroy_image(self.image, None);
                device.free_memory(self.memory, None);
            }
        }
    }

    /// An RGBA image exported as a dma-buf, standing in for the emulator.
    ///
    /// Not a simulation of Dolphin's rendering — a real dma-buf, exported from
    /// Vulkan, described by a real [`FrameDescriptor`], and handed over in
    /// `GENERAL` released to the foreign queue family, which is the state the
    /// Dolphin patch's final barrier leaves its slots in.
    ///
    /// What it does not cover: the tiling. It asks for LINEAR because that is
    /// the one modifier guaranteed exportable everywhere, whereas the emulator's
    /// slots are AMD-tiled. Tiled import is covered by [`Nv12Target`]'s test,
    /// which imports a surface the encoder allocated. Only a run against real
    /// Dolphin covers both at once.
    pub struct ExportedRgba<'a> {
        context: &'a Context,
        image: vk::Image,
        memory: vk::DeviceMemory,
        pub descriptor: FrameDescriptor,
        pub buffer: DmaBuf,
    }

    impl<'a> ExportedRgba<'a> {
        pub fn new(context: &'a Context, width: u32, height: u32, pixels: &[u8]) -> Self {
            let device = context.device();
            let modifiers = [0_u64]; // DRM_FORMAT_MOD_LINEAR
            let mut list = vk::ImageDrmFormatModifierListCreateInfoEXT::default()
                .drm_format_modifiers(&modifiers);
            let mut external = vk::ExternalMemoryImageCreateInfo::default()
                .handle_types(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
            let create = vk::ImageCreateInfo::default()
                .image_type(vk::ImageType::TYPE_2D)
                .format(vk::Format::R8G8B8A8_UNORM)
                .extent(vk::Extent3D {
                    width,
                    height,
                    depth: 1,
                })
                .mip_levels(1)
                .array_layers(1)
                .samples(vk::SampleCountFlags::TYPE_1)
                .tiling(vk::ImageTiling::DRM_FORMAT_MODIFIER_EXT)
                // Exactly what the Dolphin patch asks for on its slots.
                .usage(vk::ImageUsageFlags::TRANSFER_DST | vk::ImageUsageFlags::SAMPLED)
                .sharing_mode(vk::SharingMode::EXCLUSIVE)
                .initial_layout(vk::ImageLayout::UNDEFINED)
                .push_next(&mut external)
                .push_next(&mut list);
            // SAFETY: `create` and its chain are live locals.
            let image = unsafe { device.create_image(&create, None) }.unwrap();

            // SAFETY: just created on this device.
            let requirements = unsafe { device.get_image_memory_requirements(image) };
            let mut export = vk::ExportMemoryAllocateInfo::default()
                .handle_types(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
            let mut dedicated = vk::MemoryDedicatedAllocateInfo::default().image(image);
            let allocate = vk::MemoryAllocateInfo::default()
                .allocation_size(requirements.size)
                .memory_type_index(
                    context
                        .memory_type_for_import(requirements.memory_type_bits)
                        .unwrap(),
                )
                .push_next(&mut dedicated)
                .push_next(&mut export);
            // SAFETY: live locals naming a legal memory type.
            let memory = unsafe { device.allocate_memory(&allocate, None) }.unwrap();
            // SAFETY: neither has been bound before.
            unsafe { device.bind_image_memory(image, memory, 0) }.unwrap();

            Self::fill_and_release(context, image, width, height, pixels);

            let get = vk::MemoryGetFdInfoKHR::default()
                .memory(memory)
                .handle_type(vk::ExternalMemoryHandleTypeFlags::DMA_BUF_EXT);
            // SAFETY: the memory was allocated with DMA_BUF in its export types.
            let fd = unsafe { context.external_memory_fd().get_memory_fd(&get) }.unwrap();

            // MEMORY_PLANE_0 rather than COLOR: a modifier image is described by
            // its *memory* planes, and asking for COLOR is an error the
            // validation layers catch and the driver may not.
            let subresource = vk::ImageSubresource::default()
                .aspect_mask(vk::ImageAspectFlags::MEMORY_PLANE_0_EXT);
            // SAFETY: the image is live and was created with modifier tiling.
            let layout = unsafe { device.get_image_subresource_layout(image, subresource) };

            let mut properties = vk::ImageDrmFormatModifierPropertiesEXT::default();
            // SAFETY: as above.
            unsafe {
                context
                    .drm_format_modifier()
                    .get_image_drm_format_modifier_properties(image, &mut properties)
            }
            .unwrap();

            Self {
                context,
                image,
                memory,
                descriptor: FrameDescriptor {
                    width,
                    height,
                    drm_format: u32::from_le_bytes(*b"AB24"),
                    modifier: properties.drm_format_modifier,
                    offset: layout.offset,
                    pitch: layout.row_pitch,
                    size: requirements.size,
                },
                buffer: DmaBuf::from_owned_raw(fd),
            }
        }

        /// Uploads the pattern and leaves the image exactly as the emulator
        /// leaves its slots: `GENERAL`, released to the foreign queue family.
        fn fill_and_release(
            context: &Context,
            image: vk::Image,
            width: u32,
            height: u32,
            pixels: &[u8],
        ) {
            let device = context.device();
            let staging = Staging::new(
                context,
                u64::from(width) * u64::from(height) * 4,
                vk::BufferUsageFlags::TRANSFER_SRC,
            );
            staging.with_bytes(|bytes| bytes.copy_from_slice(pixels));

            context.one_shot(|command| {
                let to_dst = vk::ImageMemoryBarrier::default()
                    .dst_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .old_layout(vk::ImageLayout::UNDEFINED)
                    .new_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                    .src_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .dst_queue_family_index(vk::QUEUE_FAMILY_IGNORED)
                    .image(image)
                    .subresource_range(whole_image());
                let region = vk::BufferImageCopy::default()
                    .image_subresource(vk::ImageSubresourceLayers {
                        aspect_mask: vk::ImageAspectFlags::COLOR,
                        mip_level: 0,
                        base_array_layer: 0,
                        layer_count: 1,
                    })
                    .image_extent(vk::Extent3D {
                        width,
                        height,
                        depth: 1,
                    });
                let release = vk::ImageMemoryBarrier::default()
                    .src_access_mask(vk::AccessFlags::TRANSFER_WRITE)
                    .old_layout(vk::ImageLayout::TRANSFER_DST_OPTIMAL)
                    .new_layout(vk::ImageLayout::GENERAL)
                    .src_queue_family_index(context.queue_family())
                    .dst_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                    .image(image)
                    .subresource_range(whole_image());
                // SAFETY: the buffer is recording; image and buffer are live.
                unsafe {
                    device.cmd_pipeline_barrier(
                        command,
                        vk::PipelineStageFlags::TOP_OF_PIPE,
                        vk::PipelineStageFlags::TRANSFER,
                        vk::DependencyFlags::empty(),
                        &[],
                        &[],
                        &[to_dst],
                    );
                    device.cmd_copy_buffer_to_image(
                        command,
                        staging.buffer,
                        image,
                        vk::ImageLayout::TRANSFER_DST_OPTIMAL,
                        &[region],
                    );
                    device.cmd_pipeline_barrier(
                        command,
                        vk::PipelineStageFlags::TRANSFER,
                        vk::PipelineStageFlags::BOTTOM_OF_PIPE,
                        vk::DependencyFlags::empty(),
                        &[],
                        &[],
                        &[release],
                    );
                }
            });
        }
    }

    impl Drop for ExportedRgba<'_> {
        fn drop(&mut self) {
            let device = self.context.device();
            // SAFETY: every helper submits and waits, so nothing is in flight.
            // The dma-buf holds its own reference, so closing it separately in
            // `DmaBuf`'s Drop is independent of this.
            unsafe {
                device.destroy_image(self.image, None);
                device.free_memory(self.memory, None);
            }
        }
    }

    /// Copies a plane out of GPU memory so its bytes can be looked at.
    ///
    /// This is the readback the architecture exists to delete — which is exactly
    /// why it belongs only here.
    ///
    /// Note what it cannot do: the copy reads the image through the same layout
    /// declaration the shader wrote it with, so a *wrong* declaration round-trips
    /// cleanly. Tiling is checked where it can be, by comparing declared against
    /// actual in `image.rs`.
    pub fn read_plane(
        context: &Context,
        image: vk::Image,
        width: u32,
        height: u32,
        bytes_per_pixel: u32,
    ) -> Vec<u8> {
        let device = context.device();
        let size = u64::from(width) * u64::from(height) * u64::from(bytes_per_pixel);
        let staging = Staging::new(context, size, vk::BufferUsageFlags::TRANSFER_DST);

        context.one_shot(|command| {
            let to_src = vk::ImageMemoryBarrier::default()
                .src_access_mask(vk::AccessFlags::SHADER_WRITE)
                .dst_access_mask(vk::AccessFlags::TRANSFER_READ)
                .old_layout(vk::ImageLayout::GENERAL)
                .new_layout(vk::ImageLayout::TRANSFER_SRC_OPTIMAL)
                // Taking the image BACK from the foreign family the convert pass
                // released it to. Omitting this would be reading memory Vulkan
                // believes it no longer owns.
                .src_queue_family_index(vk::QUEUE_FAMILY_FOREIGN_EXT)
                .dst_queue_family_index(context.queue_family())
                .image(image)
                .subresource_range(whole_image());
            let region = vk::BufferImageCopy::default()
                .image_subresource(vk::ImageSubresourceLayers {
                    aspect_mask: vk::ImageAspectFlags::COLOR,
                    mip_level: 0,
                    base_array_layer: 0,
                    layer_count: 1,
                })
                .image_extent(vk::Extent3D {
                    width,
                    height,
                    depth: 1,
                });
            // SAFETY: the buffer is recording; image and buffer are live.
            unsafe {
                device.cmd_pipeline_barrier(
                    command,
                    vk::PipelineStageFlags::COMPUTE_SHADER,
                    vk::PipelineStageFlags::TRANSFER,
                    vk::DependencyFlags::empty(),
                    &[],
                    &[],
                    &[to_src],
                );
                device.cmd_copy_image_to_buffer(
                    command,
                    image,
                    vk::ImageLayout::TRANSFER_SRC_OPTIMAL,
                    staging.buffer,
                    &[region],
                );
            }
        });

        staging.with_bytes(|bytes| bytes.to_vec())
    }
}
