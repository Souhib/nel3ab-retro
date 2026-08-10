# Dolphin patch — export the frame as a dma-buf

**Status: proven end to end, with Dolphin's own frame dumper OFF** — which is the
only version of that claim worth anything, and it took a second try to earn.

The first "proof" was run with frame dumping enabled and passed. Repeated without
it, the consumer read an all-zero image. The export had been silently relying on
the dumper's readback to flush the Vulkan queue — the very readback this patch
exists to delete. It worked, and only while it was pointless. `OnFrame` now
submits the command buffer itself; see *Submit it, nothing else will*.

A separate process imported the dma-buf and read back Melee's memory-card dialog
out of a headless Dolphin, with no CPU readback anywhere in the chain.

```
descriptor: 640x480  modifier 0x0200000018601b03  offset 0  pitch 2560  size 1310720  fd=3
saw 120 frame notifications (last #120)
imported and bound
frame is NOT uniform — it carries an image
```

The consumer is `spikes/m2-vaapi-export/receive_frame.c`. The captured frame was
encoded to PNG and **looked at**: it is the dialog, not noise and not a buffer
somebody forgot to write.

One thing to know about the size: the hook is handed `m_xfb_rect`, so the export
is the **raw XFB** (640x480) while Dolphin's own dumper writes an
aspect-corrected 640x528. Raw is what an encoder wants — no resampling on the way
out — but it means the two cannot be compared pixel-for-pixel without scaling one
of them.

The synchronisation gap below is still open.

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

### Submit it, nothing else will

Recording a blit is not running it. In headless there is no presentation to end
the frame, so Dolphin submits its command buffer only when something forces it
to — and with frame dumping on, that something was the dumper's readback. Turn
the dumper off and the queue never flushes, so the consumer reads a buffer that
was never written.

`OnFrame` therefore calls `VKGfx::ExecuteCommandBuffer(false, false)` after the
blit: submit, do not wait. Measured 2026-08-10 — without that line the consumer
gets an all-zero image, with it the game's picture.

This is the clearest argument in the whole milestone for insisting on an
end-to-end proof. Every Vulkan call succeeded. The image was created, the memory
exported, the fd delivered, 600 frames announced. Nothing anywhere reported an
error, and no pixel ever moved.

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

## Synchronisation — done, and how it is proven

There were two independent races, and they needed different answers.

**The worker was told "ready" at submit time, not completion.** It could read
pixels the GPU had not written. Answered by `ExecuteCommandBuffer(false, true)`:
submit *and wait* before notifying.

**One image was reused every frame**, so Dolphin could overwrite a frame the
worker was reading. Answered by a ring of three images with **explicit release**:
a slot is reused only after the worker gives it back, and a frame with no free
slot is **dropped**. Dropping is the same call the input path makes on a full
pipe — the next frame is 16 ms away, and a torn frame is worse than a missing one.

### The test that nearly lied again

The first version of the ring test held a slot for 500 ms and compared its pixels
before and after. It passed. Then the ring check was deliberately removed — and
**it still passed**, because Melee sits on a static screen: Dolphin overwrote the
held slot with an identical picture.

The assertion now targets the protocol instead of the pixels, and needs no help
from the game: *a lent slot must never be announced again until it is released*.

```
with the bug:     0 frames on other slots, 25 on the held one   FAIL
without the bug: 25 frames on other slots,  0 on the held one   PASS
```

Symmetric, and it discriminates. That is the second time in this milestone a test
read correctly, passed, and proved nothing — both caught only by reintroducing
the bug rather than reasoning about it.

## What the GPU wait costs — measured, 2026-08-10

At the real target it costs nothing: **59.91 fps against NTSC's 59.94**. Not a
dropped frame.

But a game capped at 59.94 cannot show headroom, so the emulation was unthrottled
(`Dolphin.Core.EmulationSpeed = 0`) and the *only* thing varied was the
`wait_for_completion` flag:

| | unthrottled | headroom over 59.94 |
|---|---|---|
| `ExecuteCommandBuffer(false, **true**)` | **2130 fps** | ×35 |
| `ExecuteCommandBuffer(false, **false**)` | 2665 fps | ×44 |

So the sync point costs **~20 % of headroom** — real, and irrelevant at this
scene. Keep the wait.

Two caveats that belong with the number. Earlier CPU figures (14.5 % with export
against a 19.5 % baseline) are **not** a measurement of this and should not be
quoted: a thread blocked on the GPU consumes no CPU, so the sync point makes CPU
usage *fall* while doing more work. And this is Melee's static memory-card
modal — a trivial scene. A four-player match is far heavier, and 20 % of a much
smaller headroom is a different conversation. **Re-measure on real gameplay
before concluding for the product.**

If that day comes, the replacement is known: an exported semaphore
(`VK_KHR_external_semaphore_fd`) signalled by the submit carrying the blit, so
the worker waits on the GPU rather than Dolphin's CPU thread. Dolphin's submit
path cannot carry one today, which is why the simple, expensive option was taken
first — and why it turned out not to be expensive.

The first measurement attempt is worth remembering too: 1800 frames were timed
against a ~13 s boot, so the subtraction was between two nearly-equal numbers and
the result was noise. The delta was widened to 29 400 frames before the figures
above were trusted.
