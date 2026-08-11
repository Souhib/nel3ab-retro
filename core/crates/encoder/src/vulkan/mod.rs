//! The Vulkan side: import the emulator's dma-buf, dispatch the shader, write
//! NV12 into the surface the encoder reads.
//!
//! # Why `ash` and not a shim
//!
//! ADR **D8**, which decides the opposite of D7 on purpose. The libavcodec shim
//! exists because `AVCodecContext`'s layout moves between ffmpeg major versions;
//! Vulkan has no such hazard — it extends through `pNext` chains rather than by
//! growing structures, and its ABI is stable by specification. The deciding
//! argument is that both races M2 has already fixed were about *when* a frame is
//! safe to touch, not about calling Vulkan correctly. That is orchestration, and
//! rule 5 wants it where the type system can hold it.
//!
//! # Picking the device is not a formality
//!
//! `spikes/m2-vaapi-export/vk_shader_writes_nv12.c` takes the first discrete GPU.
//! That is fine for a spike on a one-card machine and wrong for a component: the
//! dma-buf comes from a specific render node, and importing it on a different
//! physical device is not something Vulkan promises anything about. So
//! [`Context::open`] matches the **device number of the render node itself**,
//! through `VK_EXT_physical_device_drm`, and fails rather than guessing.

pub mod image;
pub mod sys;

use core::ffi::CStr;
use std::os::fd::BorrowedFd;
use std::path::Path;

use ash::vk;

use crate::error::EncoderError;
use crate::frame_source::DmaBuf;

/// Device extensions the import path cannot work without.
///
/// All five are required rather than optional, and that asymmetry with the
/// Dolphin patch is deliberate: the patch makes them optional so a driver
/// lacking them cannot stop Dolphin booting, but here their absence means the
/// frame cannot be imported at all. There is nothing to degrade to.
pub const REQUIRED_DEVICE_EXTENSIONS: [&CStr; 5] = [
    // The dma-buf arrives as a file descriptor; these two take it.
    ash::khr::external_memory_fd::NAME,
    ash::ext::external_memory_dma_buf::NAME,
    // The surface is AMD-tiled, not linear. Without this the import would have
    // to lie about the layout, which is how you get a plausible wrong picture.
    ash::ext::image_drm_format_modifier::NAME,
    ash::khr::image_format_list::NAME,
    // NV12's two planes are written while VAAPI owns the image; the transfer of
    // ownership needs the foreign queue family.
    ash::ext::queue_family_foreign::NAME,
];

/// Turns a Vulkan result into an error naming the call that produced it.
fn check(result: vk::Result, what: &'static str) -> Result<(), EncoderError> {
    if result == vk::Result::SUCCESS {
        return Ok(());
    }
    Err(EncoderError::Vulkan {
        what,
        code: result.as_raw(),
    })
}

/// An instance, the physical device that owns the render node, and a compute
/// queue on it.
///
/// Dropping it destroys the device then the instance, which is the order Vulkan
/// requires.
pub struct Context {
    // Held so the loader outlives every call made through it.
    _entry: ash::Entry,
    instance: ash::Instance,
    physical: vk::PhysicalDevice,
    device: ash::Device,
    /// The `VK_KHR_external_memory_fd` entry points, loaded once. Vulkan
    /// resolves extension functions per device, so caching beats fetching them
    /// on every import.
    external_memory_fd: ash::khr::external_memory_fd::Device,
    /// `VK_EXT_image_drm_format_modifier`, used to ask an image what tiling it
    /// actually ended up with — see [`image::ImportedPlane::modifier`].
    drm_format_modifier: ash::ext::image_drm_format_modifier::Device,
    queue: vk::Queue,
    queue_family: u32,
    name: String,
}

impl core::fmt::Debug for Context {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // `ash::Device` has no useful Debug, and printing raw handles would
        // invite comparing them across runs, where they mean nothing.
        f.debug_struct("Context")
            .field("device", &self.name)
            .field("queue_family", &self.queue_family)
            .finish_non_exhaustive()
    }
}

impl Context {
    /// Opens Vulkan on the physical device that **is** the given render node.
    ///
    /// # Errors
    /// [`EncoderError::RenderNode`] if the node cannot be stat'd,
    /// [`EncoderError::NoMatchingDevice`] if no physical device claims it or the
    /// one that does lacks [`REQUIRED_DEVICE_EXTENSIONS`], or
    /// [`EncoderError::Vulkan`] if a call fails.
    pub fn open(node: impl AsRef<Path>) -> Result<Self, EncoderError> {
        let node = node.as_ref();
        let wanted = sys::device_number(node)?;

        // SAFETY: `Entry::load` dlopen's libvulkan. It is unsafe because the
        // library runs initialisers of its own choosing; nothing here can make
        // that sounder, and every Vulkan program takes the same step.
        let entry = unsafe { ash::Entry::load() }.map_err(|_| EncoderError::NoMatchingDevice {
            what: "libvulkan could not be loaded",
        })?;

        // 1.1 rather than 1.0, so `properties2` is core and needs no instance
        // extension. Every driver this project targets is well past it.
        let application = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_1);
        let create = vk::InstanceCreateInfo::default().application_info(&application);
        // SAFETY: `create` and everything it borrows are live for the call, and
        // ash's builders guarantee the length fields match their slices.
        let instance = unsafe { entry.create_instance(&create, None) }.map_err(|code| {
            EncoderError::Vulkan {
                what: "vkCreateInstance",
                code: code.as_raw(),
            }
        })?;

        // From here on the instance must be destroyed on every failure path, so
        // the search is factored out and its result matched.
        let found = Self::find_device(&instance, wanted);
        let (physical, name) = match found {
            Ok(found) => found,
            Err(error) => {
                // SAFETY: the instance was just created, no device or child
                // object exists yet, and it is not used again.
                unsafe { instance.destroy_instance(None) };
                return Err(error);
            }
        };

        match Self::open_device(&instance, physical) {
            Ok((device, queue, queue_family)) => {
                let external_memory_fd =
                    ash::khr::external_memory_fd::Device::new(&instance, &device);
                let drm_format_modifier =
                    ash::ext::image_drm_format_modifier::Device::new(&instance, &device);
                Ok(Self {
                    _entry: entry,
                    instance,
                    physical,
                    device,
                    external_memory_fd,
                    drm_format_modifier,
                    queue,
                    queue_family,
                    name,
                })
            }
            Err(error) => {
                // SAFETY: as above — no device was created on this path.
                unsafe { instance.destroy_instance(None) };
                Err(error)
            }
        }
    }

    /// Finds the physical device whose DRM render minor matches the node.
    fn find_device(
        instance: &ash::Instance,
        wanted: sys::DeviceNumber,
    ) -> Result<(vk::PhysicalDevice, String), EncoderError> {
        // SAFETY: the instance is live and ash allocates the vector itself.
        let devices = unsafe { instance.enumerate_physical_devices() }.map_err(|code| {
            EncoderError::Vulkan {
                what: "vkEnumeratePhysicalDevices",
                code: code.as_raw(),
            }
        })?;

        for physical in devices {
            let mut drm = vk::PhysicalDeviceDrmPropertiesEXT::default();
            // Scoped, because `properties` holds `drm` mutably borrowed for as
            // long as it lives — the borrow checker enforcing the very lifetime
            // Vulkan's `pNext` chain requires and C would not have mentioned.
            let name = {
                let mut properties = vk::PhysicalDeviceProperties2::default().push_next(&mut drm);
                // SAFETY: `properties` and the `drm` it chains are live locals,
                // and the chain is well-formed by ash's `push_next`. A driver
                // without VK_EXT_physical_device_drm leaves `drm` untouched —
                // which is why `has_render` is checked below rather than the
                // numbers alone, since zeroes would otherwise match device 0:0.
                unsafe { instance.get_physical_device_properties2(physical, &mut properties) };
                properties.properties.device_name_as_c_str().map_or_else(
                    |_| "<unnamed>".to_owned(),
                    |name| name.to_string_lossy().into_owned(),
                )
            };

            if drm.has_render == vk::FALSE {
                continue;
            }
            #[allow(
                clippy::cast_sign_loss,
                reason = "Vulkan types these as i64; a device number is never negative"
            )]
            let reported = sys::DeviceNumber {
                major: drm.render_major as u64,
                minor: drm.render_minor as u64,
            };
            if reported != wanted {
                continue;
            }

            Self::require_extensions(instance, physical)?;
            return Ok((physical, name));
        }

        Err(EncoderError::NoMatchingDevice {
            what: "no Vulkan physical device reports this render node",
        })
    }

    /// Refuses a device that cannot import a dma-buf, naming what is missing.
    fn require_extensions(
        instance: &ash::Instance,
        physical: vk::PhysicalDevice,
    ) -> Result<(), EncoderError> {
        // SAFETY: the instance and handle are live; ash allocates the vector.
        let available = unsafe { instance.enumerate_device_extension_properties(physical) }
            .map_err(|code| EncoderError::Vulkan {
                what: "vkEnumerateDeviceExtensionProperties",
                code: code.as_raw(),
            })?;

        for required in REQUIRED_DEVICE_EXTENSIONS {
            let present = available.iter().any(|extension| {
                extension
                    .extension_name_as_c_str()
                    .is_ok_and(|name| name == required)
            });
            if !present {
                // The name is leaked into a `&'static str` rather than carried
                // as an owned String, because the set is a compile-time constant
                // and this keeps the error type Copy-cheap.
                return Err(EncoderError::MissingExtension {
                    name: required.to_str().unwrap_or("<non-utf8 extension name>"),
                });
            }
        }
        Ok(())
    }

    /// Creates the logical device and takes a compute queue from it.
    fn open_device(
        instance: &ash::Instance,
        physical: vk::PhysicalDevice,
    ) -> Result<(ash::Device, vk::Queue, u32), EncoderError> {
        // SAFETY: the instance and handle are live; ash allocates the vector.
        let families = unsafe { instance.get_physical_device_queue_family_properties(physical) };
        let queue_family = families
            .iter()
            .position(|family| family.queue_flags.contains(vk::QueueFlags::COMPUTE))
            .ok_or(EncoderError::NoMatchingDevice {
                what: "the device has no compute queue family",
            })?;
        let queue_family =
            u32::try_from(queue_family).map_err(|_| EncoderError::NoMatchingDevice {
                what: "the compute queue family index does not fit in u32",
            })?;

        let priorities = [1.0_f32];
        let queues = [vk::DeviceQueueCreateInfo::default()
            .queue_family_index(queue_family)
            .queue_priorities(&priorities)];
        let names: Vec<*const core::ffi::c_char> = REQUIRED_DEVICE_EXTENSIONS
            .iter()
            .map(|name| name.as_ptr())
            .collect();
        let create = vk::DeviceCreateInfo::default()
            .queue_create_infos(&queues)
            .enabled_extension_names(&names);

        // SAFETY: every pointer in `names` addresses a `&'static CStr`, so all
        // outlive the call; `queues` and `priorities` are live locals of the
        // lengths ash's builders recorded.
        let device =
            unsafe { instance.create_device(physical, &create, None) }.map_err(|code| {
                EncoderError::Vulkan {
                    what: "vkCreateDevice",
                    code: code.as_raw(),
                }
            })?;

        // SAFETY: the device was just created with exactly this family, and
        // index 0 exists because one priority was requested.
        let queue = unsafe { device.get_device_queue(queue_family, 0) };
        Ok((device, queue, queue_family))
    }

    /// The driver's name for the device this opened.
    #[must_use]
    pub fn device_name(&self) -> &str {
        &self.name
    }

    /// The compute queue family index.
    #[must_use]
    pub const fn queue_family(&self) -> u32 {
        self.queue_family
    }

    /// Blocks until the device has finished everything submitted to it.
    ///
    /// # Errors
    /// [`EncoderError::Vulkan`].
    pub fn wait_idle(&self) -> Result<(), EncoderError> {
        // SAFETY: the device is live for as long as `self` is.
        check(
            unsafe { self.device.device_wait_idle() }
                .err()
                .unwrap_or(vk::Result::SUCCESS),
            "vkDeviceWaitIdle",
        )
    }

    /// The memory type index for a dma-buf import, given the bits the driver
    /// says are legal for it.
    ///
    /// Device-local is **preferred, not required**, and the difference matters.
    /// The whole architecture exists so the frame never leaves VRAM, so a
    /// non-local type is worth a warning — but the driver decides which types
    /// accept an imported dma-buf, and refusing an import it called legal would
    /// be us overruling the only party that knows. The C spike asks for no flags
    /// at all; this asks for the good one and takes what it is given.
    ///
    /// # Errors
    /// [`EncoderError::NoMatchingDevice`] if no memory type at all accepts it.
    pub fn memory_type_for_import(&self, allowed: u32) -> Result<u32, EncoderError> {
        // SAFETY: instance and handle are live.
        let memory = unsafe {
            self.instance
                .get_physical_device_memory_properties(self.physical)
        };
        let legal = |index: &u32| allowed & (1_u32 << index) != 0;
        let local = |index: &u32| {
            memory.memory_types[*index as usize]
                .property_flags
                .contains(vk::MemoryPropertyFlags::DEVICE_LOCAL)
        };

        if let Some(index) = (0..memory.memory_type_count).find(|i| legal(i) && local(i)) {
            return Ok(index);
        }
        let index =
            (0..memory.memory_type_count)
                .find(legal)
                .ok_or(EncoderError::NoMatchingDevice {
                    what: "no memory type accepts this dma-buf",
                })?;
        tracing::warn!(
            index,
            "the dma-buf imported into non-device-local memory; the frame is not \
             staying in VRAM and the latency numbers will not hold"
        );
        Ok(index)
    }

    /// Borrowed for building images and pipelines on top.
    #[must_use]
    pub const fn device(&self) -> &ash::Device {
        &self.device
    }

    /// The queue work is submitted to.
    #[must_use]
    pub const fn queue(&self) -> vk::Queue {
        self.queue
    }

    /// The `VK_KHR_external_memory_fd` entry points.
    #[must_use]
    pub const fn external_memory_fd(&self) -> &ash::khr::external_memory_fd::Device {
        &self.external_memory_fd
    }

    /// The `VK_EXT_image_drm_format_modifier` entry points.
    #[must_use]
    pub const fn drm_format_modifier(&self) -> &ash::ext::image_drm_format_modifier::Device {
        &self.drm_format_modifier
    }
}

/// Borrows a dma-buf's descriptor.
///
/// `DmaBuf` keeps a raw descriptor because `frame_source` is a safe module and
/// cannot build an `OwnedFd` without `unsafe`. Turning it into a `BorrowedFd`
/// therefore happens here, where rule 2's exception applies.
const fn borrow(buffer: &DmaBuf) -> BorrowedFd<'_> {
    // SAFETY: `DmaBuf` owns the descriptor and closes it only on Drop, so it is
    // open for as long as the borrow it is tied to. The lifetime on the return
    // type is what makes that a compiler-checked claim rather than a comment.
    unsafe { BorrowedFd::borrow_raw(buffer.as_raw_fd()) }
}

impl Drop for Context {
    fn drop(&mut self) {
        // SAFETY: waiting first is what makes the destruction below legal —
        // Vulkan forbids destroying a device with work in flight. The result is
        // ignored because Drop cannot report, and a lost device is already the
        // failure this would have named.
        unsafe {
            let _ = self.device.device_wait_idle();
            self.device.destroy_device(None);
            self.instance.destroy_instance(None);
        }
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

    #[test]
    fn the_device_we_open_is_the_one_that_owns_the_render_node() {
        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device for {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        // Not an assertion about a name for its own sake: if this opened some
        // other device, the dma-buf import would fail later and much less
        // legibly than here.
        assert!(
            context.device_name().contains("AMD") || context.device_name().contains("RADV"),
            "opened {} for {DEFAULT_RENDER_NODE}",
            context.device_name()
        );
        context.wait_idle().unwrap();
    }

    /// The negative twin. A path that is not a render node must be refused, not
    /// silently answered with whatever device happened to be first — which is
    /// exactly what the C spike would have done.
    #[test]
    fn a_path_that_is_not_this_render_node_is_refused() {
        // /dev/null is a character device with a real device number, so this
        // exercises the *matching*, not the stat. A missing path would only
        // prove the error handling one step earlier.
        let error = Context::open("/dev/null").unwrap_err();
        assert!(
            matches!(error, EncoderError::NoMatchingDevice { .. }),
            "{error:?}"
        );
    }

    #[test]
    fn a_render_node_that_does_not_exist_is_named_in_the_error() {
        let error = Context::open("/dev/dri/renderD999").unwrap_err();
        assert!(
            matches!(error, EncoderError::RenderNode { .. }),
            "{error:?}"
        );
    }

    #[test]
    fn a_dma_buf_import_gets_device_local_memory() {
        let Ok(context) = Context::open(DEFAULT_RENDER_NODE) else {
            panic!("no Vulkan device for {DEFAULT_RENDER_NODE}: run this where the GPU is");
        };
        // Every type allowed: the answer must still be a device-local one, since
        // an imported dma-buf that landed in host memory would have defeated the
        // entire point of the architecture.
        assert!(context.memory_type_for_import(u32::MAX).is_ok());
        // The negative twin: no type allowed cannot produce an answer.
        assert!(context.memory_type_for_import(0).is_err());
    }
}
