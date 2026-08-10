# Dolphin patch — export the frame as a dma-buf

**Status: written, NOT YET COMPILED, NOT YET WIRED IN.** Nothing here has been
through a compiler. Treat it as a draft that still owes its first build.

What has been done to it without one: the predictable build breakers were
pre-empted (`<cerrno>` for the `EAGAIN` check, `Common/CommonTypes.h` for the
`u32`/`u64` spellings, and `MathUtil.h` included rather than forward-declared),
and `Initialize()` now verifies the dma-buf entry points at startup so a missing
device extension says so instead of failing silently at frame one. That is
guesswork narrowed, not correctness — the compiler has still never seen this.

## Why a patch at all

`docs/m2-working-plan.md` settled this: Dolphin has **no external-memory support
at any revision we pin** — `VKTexture.h` and `VulkanContext.cpp` contain zero
references to `VK_KHR_external_memory_fd` or dma-buf. So the frame cannot leave
its address space without a change, and the alternatives (a Wayland compositor,
the Qt build, Xwayland) all cost more at runtime and reopen the input focus gate
that M1 closed.

Patching is cheap *here* specifically because `docker/Dockerfile.dolphin`
already pins a commit and compiles from source in a cached layer.

## What it does

`Presenter::ProcessFrameDumping` already receives the finished XFB as a GPU
texture, on a path that runs in headless. The patch blits that texture into an
image backed by exportable memory and hands the worker a dma-buf fd, so the
frame never makes the GPU→CPU round trip that Dolphin's own dumper makes —
measured at 0.57 of a core, about 3x the emulation itself.

The Vulkan sequence is not guesswork: it was rehearsed outside Dolphin first, in
`spikes/m2-vaapi-export/vk_export.c`, which round-trips an image between two
`VkDevice`s with **0 wrong pixels out of 337 920**. This patch is that spike,
moved.

Two decisions carried over from the spike:

- **Allocated outside VMA.** Dolphin routes every other texture through the
  allocator, which has nowhere to attach `VkExportMemoryAllocateInfo`. One
  hand-allocated image touches nothing else.
- **Modifiers filtered to `planeCount == 1`.** That is the DCC filter: the
  compressed variants keep their metadata in extra planes, and the video engine
  cannot read delta colour compression before RDNA4.

Inert unless `NEL3AB_FRAME_SOCKET` names a socket that accepts a connection —
which keeps the patch out of Dolphin's config system, so the fork stays small.
Every failure path disables export and lets the emulator run on: a broken stream
is bad, a dead game session is worse.

## Applying it

`VKFrameExport.{h,cpp}` are new files, dropped into
`Source/Core/VideoBackends/Vulkan/`. Four small edits wire them in:

| File | Edit |
|---|---|
| `VideoCommon/FrameDumper.h` | declare `using FrameExportHook = void (*)(const AbstractTexture*, const MathUtil::Rectangle<int>&);` and `extern FrameExportHook g_frame_export_hook;` above `class FrameDumper` |
| `VideoCommon/FrameDumper.cpp` | define `FrameExportHook g_frame_export_hook = nullptr;` next to `g_frame_dumper` |
| `VideoCommon/Present.cpp` | at the **top** of `Presenter::ProcessFrameDumping`, *before* the `IsFrameDumping()` guard: `if (g_frame_export_hook && m_xfb_entry) g_frame_export_hook(m_xfb_entry->texture.get(), m_xfb_rect);` |
| `VideoBackends/Vulkan/VKGfx.cpp` | include `VKFrameExport.h`; call `FrameExport::Initialize()` from the constructor and replace `VKGfx::~VKGfx() = default;` with a destructor calling `FrameExport::Shutdown()` |
| `VideoBackends/Vulkan/CMakeLists.txt` | add `VKFrameExport.cpp` and `VKFrameExport.h` |
| `VideoBackends/Vulkan/VulkanContext.cpp` | **enable the four device extensions** — see below |

Ordering matters in one place only: the hook must be called **before**
`IsFrameDumping()`, or the export would require the readback it exists to avoid.

### ⚠️ The sixth edit, and the one most likely to be forgotten

Mainline Dolphin enables no external-memory extension anywhere — that is the
finding that made this patch necessary in the first place. So the device it
creates almost certainly does **not** enable:

```
VK_KHR_external_memory_fd
VK_EXT_external_memory_dma_buf
VK_EXT_image_drm_format_modifier
VK_EXT_queue_family_foreign
```

Without them `vkGetDeviceProcAddr` returns null for `vkGetMemoryFdKHR` and
`vkGetImageDrmFormatModifierPropertiesEXT`, and every export call fails. Add
them to whatever list `VulkanContext` builds for device creation, as **optional**
extensions (the export path disables itself when they are missing; a hard
requirement would stop Dolphin booting on a driver that lacks them, which is a
far worse trade).

`VK_EXT_image_drm_format_modifier` additionally requires `VK_KHR_image_format_list`
and `VK_KHR_sampler_ycbcr_conversion` — both core since Vulkan 1.1, so they only
need listing if Dolphin targets 1.0.

`FrameExport::Initialize()` checks both entry points up front and logs exactly
this, rather than letting the failure surface at the first frame inside a running
game. **This was inferred, not verified** — the check that would have confirmed
which extensions `VulkanContext` enables was blocked before it ran. Read
`SelectDeviceExtensions` before assuming anything here is right.

### Iterating

Do not iterate through `docker build` — each cycle is ~25 minutes. Use the
persistent dev container, where `ninja` is incremental:

```bash
docker build --target dolphin-build -t nel3ab/dolphin-build:216ffb45 -f docker/Dockerfile.dolphin .
docker run -d --name dolphin-dev nel3ab/dolphin-build:216ffb45 sleep infinity
# copy the files in, make the five edits, then:
docker exec dolphin-dev sh -c 'cd /build && ninja'
```

Once it compiles, generate the real patch from the container's git checkout
(`git -C /src diff`) and have the Dockerfile apply it, so the image build stays
reproducible.

## Known gap: no synchronisation yet

The image is created once and reused, and the worker is told "frame N is ready"
with a non-blocking send. **Nothing stops Dolphin overwriting frame N while the
worker is still reading it.** That is a real tearing window and it is not
solved here.

It is deliberately deferred so the first proof can be made on a *static* screen —
Melee's memory-card modal, the same one M1 used — where the exported pixels can
be compared against Dolphin's own PNG dump of the same frame without sync
entering into it. Once that passes, the answer is an exported semaphore or
sync_file per frame, and probably two or three rotating images.

Do not ship this without that. A torn frame in a live match is exactly the class
of bug this project exists to avoid.
