# Dolphin patch — export the frame as a dma-buf

**Status: compiles and links.** Not yet proven end to end — see *What is still
missing*.

`0001-nel3ab-frame-export.patch` is the single source of truth: 8 files, ~540
lines, applied by `docker/Dockerfile.dolphin` against the pinned commit. The
`.cpp`/`.h` are deliberately **not** also kept unpacked beside it — two copies
of the same code is exactly the drift this project designs against elsewhere.

## Why a patch at all

`docs/m2-working-plan.md` settled it: Dolphin has **no external-memory support at
the revision we pin** — `VKTexture.h` and `VulkanContext.cpp` contain no
reference to `VK_KHR_external_memory_fd` or dma-buf. The frame cannot leave its
address space without a change, and every alternative (a Wayland compositor, the
Qt build, Xwayland) costs more at runtime and reopens the input focus gate that
M1 closed.

Patching is cheap *here* because the Dockerfile already pins a commit and
compiles from source in a cached layer.

## What it does

`Presenter::ProcessFrameDumping` receives the finished XFB as a GPU texture, on a
path that runs in headless. The patch blits it into an image backed by
exportable memory and hands the worker a dma-buf fd — so the frame never makes
the GPU→CPU round trip Dolphin's own dumper makes, measured at 0.57 of a core,
about 3x the emulation itself.

The Vulkan sequence is `spikes/m2-vaapi-export/vk_export.c` moved: that rehearsal
round-trips an image between two `VkDevice`s with **0 wrong pixels out of
337 920**, and it ran in three seconds per iteration instead of a 25-minute
image rebuild.

Inert unless `NEL3AB_FRAME_SOCKET` names a socket that accepts a connection,
which keeps the patch out of Dolphin's config system. Every failure path
disables export and lets the emulator run on: a broken stream is bad, a dead
game session is worse.

## The six edits, and what each one is for

| File | Why |
|---|---|
| `VideoCommon/FrameDumper.{h,cpp}` | declares/defines `g_frame_export_hook`, a plain function pointer, so VideoCommon needs no knowledge of which backend can export |
| `VideoCommon/Present.cpp` | calls the hook at the **top** of `ProcessFrameDumping`, *before* the `IsFrameDumping()` guard — the export must not require the readback it exists to avoid |
| `VideoBackends/Vulkan/VKFrameExport.{h,cpp}` | the export path itself |
| `VideoBackends/Vulkan/VKGfx.cpp` | `Initialize()` from the constructor, `Shutdown()` from a no-longer-defaulted destructor |
| `VideoBackends/Vulkan/CMakeLists.txt` | builds the new files |
| `VideoBackends/Vulkan/VulkanContext.cpp` | **enables the five device extensions** — mainline enables none of them |

### Three things the first build taught

- **`SelectDeviceExtensions` enables nothing we need.** Verified, not assumed:
  it adds swapchain, `properties2`, `memory_budget` and two depth extensions,
  and that is all. The five are added as **optional** — `FrameExport` disables
  itself when they are missing, whereas a hard requirement would stop Dolphin
  booting on a driver that lacks them.
- **Dolphin loads its own Vulkan entry points**, and its table has no
  `vkGetPhysicalDeviceFormatProperties2`. It is fetched with
  `vkGetInstanceProcAddr` inside `VKFrameExport.cpp` rather than by extending the
  loader — one file touched instead of two.
- **Allocated outside VMA.** Dolphin routes every other texture through the
  allocator, which has nowhere to attach `VkExportMemoryAllocateInfo`. One
  hand-allocated image touches nothing else.

Modifiers are filtered to `planeCount == 1`. That is not a simplification, it is
the DCC filter: the compressed variants keep their metadata in extra planes, and
the video engine cannot read delta colour compression before RDNA4.

## Iterating on it

Never through `docker build` — each cycle is ~25 minutes. Use a persistent
container, where `ninja` is incremental and a rebuild is seconds:

```bash
docker build --target dolphin-build -t nel3ab/dolphin-build:216ffb45 -f docker/Dockerfile.dolphin .
docker run -d --name dolphin-dev nel3ab/dolphin-build:216ffb45 sleep infinity
docker exec -i dolphin-dev sh -c 'cd /build && ninja'
```

`docker exec` needs **`-i`** when feeding it a script on stdin; without it the
script silently receives EOF and does nothing.

Regenerate the patch after any change:

```bash
docker exec -i dolphin-dev sh -c 'cd /src && git add -N Source/Core/VideoBackends/Vulkan/VKFrameExport.* && git diff' \
  > docker/dolphin-patches/0001-nel3ab-frame-export.patch
```

## What is still missing

**No end-to-end proof yet.** It compiles and links; nothing has confirmed that a
worker receives pixels matching what Dolphin rendered. Do that on a *static*
screen — Melee's memory-card modal, as in M1 — and compare against Dolphin's own
PNG dump of the same frame.

**No synchronisation.** The image is created once and reused, and the worker is
notified with a non-blocking send. **Nothing stops Dolphin overwriting a frame
the worker is still reading.** Deferred so the static-screen proof can be made at
all; the answer is an exported semaphore or sync_file per frame plus two or three
rotating images.

Do not ship without that second one. A torn frame in a live match is exactly the
class of bug this project exists to delete.
