# M2 — Get the frame out of Dolphin and into the GPU encoder

Working document, same contract as [`m1-working-plan.md`](m1-working-plan.md):
research that cost real hours lives here so the next session does not re-derive
it, and the risky unknown is settled **before** any crate code is written.

---

## 0. Where we are

M1 is done: input reaches a headless Dolphin and the game reacts. M2 is the
other direction — pixels out.

**M2 delivers**: the `encoder` crate — take Dolphin's rendered frame on the GPU
and produce an H.264/HEVC stream, without ever touching it with the CPU.
**No network.** That is M3.

The GPU is now exclusive to this project (Wolf removed 2026-08-10), so encode
and latency numbers are finally worth recording.

---

## 0b. RESUME HERE — state at 2026-08-10 22:30

### The frame comes out of Dolphin, zero-copy. Proven — on the second try.

A separate process imported the dma-buf and read back Melee's memory-card dialog
out of a headless Dolphin, with no CPU readback anywhere in the chain:

```
descriptor: 640x480  modifier 0x0200000018601b03  pitch 2560  size 1310720  fd=3
saw 120 frame notifications (last #120)
imported and bound
frame is NOT uniform — it carries an image
```

The captured frame was encoded to PNG and **looked at**: the dialog, not noise,
not an unwritten buffer. The patch is in `docker/dolphin-patches/`, applied by
`Dockerfile.dolphin`; the consumer is `spikes/m2-vaapi-export/receive_frame.c`.

That closes the risk that justified M2's whole architecture. What remains is
engineering, not uncertainty.

### Done, committed and pushed (`main`, CI green)

| | |
|---|---|
| M1 | complete — input reaches headless Dolphin, the game reacts |
| Wolf teardown | GPU exclusive; backup in `~/wolf-teardown-backup-20260810-210542.tar.gz` |
| Baseline | emulation 19.5 % of a core, +PNG dump 76.8 % at 59.9 fps |
| Option B | killed by experiment — nogui has no Wayland platform |
| Spike 1+2 | VAAPI surface is `DCC=0`; RADV imports it; **NV12 as one image is not writable** |
| Spike 3 | export/import between two `VkDevice`s, **0 wrong pixels of 337 920** |

| Dolphin patch | compiles, links, and delivers a real frame to another process |

### The proof that nearly wasn't

The first run of that test had Dolphin's frame dumper enabled, and passed.
Repeated with it off, the consumer read an all-zero image every time.

The export was relying on the dumper's GPU→CPU readback to flush the Vulkan
queue — the readback this whole milestone exists to delete. It worked, and only
while it was pointless. Recording a blit is not running it, and in headless there
is no presentation to end the frame, so nothing submits the command buffer unless
someone makes it. `OnFrame` now does.

Worth keeping, because everything looked fine: every Vulkan call succeeded, the
image was created, the memory exported, the fd delivered, 600 frames announced,
no error logged anywhere — and no pixel ever moved. "It compiles" and "it
delivers" are not related claims, and neither is "it passed once".

### What the patch cost to find out

Three things that could not be read off the source, in the order they bit:

- **`SelectDeviceExtensions` enables none of what this needs** — swapchain,
  `properties2`, `memory_budget`, two depth extensions, and nothing else. The
  five are added as *optional*, since `FrameExport` disables itself when they are
  missing while a hard requirement would stop Dolphin booting on a driver that
  lacks them.
- **Dolphin loads its own Vulkan entry points**, and its table has no
  `vkGetPhysicalDeviceFormatProperties2`. That was the only compile error.
  Fetched with `vkGetInstanceProcAddr` inside the new file rather than by
  extending the loader — one file touched instead of two.
- **`docker exec` needs `-i`** when a script comes in on stdin. Without it the
  script gets EOF, does nothing, and reports success. A whole edit pass appeared
  to run and had not.

### Not done

- **No synchronisation.** See the end of this section — it is the next thing.
- The `encoder` crate does not exist yet.

### Environment left running on lgf

- container `dolphin-dev` (from `nel3ab/dolphin-build:216ffb45`) holding `/src`
  and `/build`, so `ninja` is incremental — **seconds per iteration instead of a
  25-minute image rebuild.** `docker rm -f dolphin-dev` if it is in the way.
- `souhib` was added to `render` and `video`; `sg render -c '…'` covers a shell
  where the new groups are not yet active.

### The order to resume in

1. **Synchronisation.** Nothing else is safe to build on top of a torn frame.
   An exported semaphore (`VK_KHR_external_semaphore_fd`) signalled after the
   blit and waited on by the worker, plus two or three rotating images so the
   producer is never writing the one being read.
2. The `encoder` crate: own the VAAPI surface, import both plane images, run an
   RGBA→NV12 compute shader, submit the encode. This is where CLAUDE.md rule 2's
   `unsafe` exception applies — `// SAFETY:` on every block, `just miri` on the
   module.
3. Measure. The whole point of removing the readback was a number; produce it,
   against the 0.57-core baseline the PNG dump costs.

### Do not forget the gap

The export image is created once and reused, and the worker is notified with a
non-blocking send. **Nothing stops Dolphin overwriting a frame the worker is
still reading.** Deferred on purpose so step 4 can be done at all; unshippable
until an exported semaphore (or sync_file) per frame and two or three rotating
images replace it. A torn frame in a live match is exactly the class of bug this
project exists to delete.

---

## 1. Research already done — do NOT re-derive it

### 1.1 Headless really does render, and there is a clean hook

Read out of Dolphin @ `216ffb45`, and confirmed empirically in M1 (7037 dumped
frames from a headless instance).

`VideoCommon/Present.cpp:906`:

```cpp
void Presenter::Present(PresentInfo* present_info)
{
  m_present_count++;
  if (g_gfx->IsHeadless() || (!m_onscreen_ui && !m_xfb_entry))
    return;                       // ← ONLY presentation is short-circuited
```

Everything upstream — EFB, XFB, shaders, draws — has already run. And on a path
that executes in headless, `Present.cpp:322` hands the finished frame to the
dumper **as a live GPU texture**:

```cpp
g_frame_dumper->DumpCurrentFrame(m_xfb_entry->texture.get(), m_xfb_rect,
                                 target_rect, ticks, frame_number);
```

**That is the interception point.** `src_texture` is an `AbstractTexture` still
on the GPU. The readback happens immediately afterwards, inside the dumper:

```cpp
// FrameDumper.cpp — the line M2 must NOT go through
m_frame_dump_readback_texture->CopyFromTexture(src_texture, copy_rect, ...);
// ...later: output->Map(); DumpFrameData(output->GetMappedPointer(), ...)
```

A staging texture, a `Map()`, and a CPU pointer. **Measured cost of that path:
0.57 of a core, roughly 3x the emulation itself** (M1 baseline). Deleting it is
most of M2's value.

### 1.2 Dolphin cannot export a texture today

Searched at the pinned revision: `VKTexture.h` and `VulkanContext.cpp` contain
**zero** references to `VK_KHR_external_memory_fd`,
`VK_EXT_external_memory_dma_buf`, or any export path. Dolphin allocates every
image for its own use only.

So there is no configuration, no flag, and no plugin hook that gets a dma-buf out
of mainline Dolphin. **Something has to change.** That is the decision below,
and it should be made before writing the crate.

---

## 2. The unknown to resolve FIRST

**How does the frame leave Dolphin's address space, zero-copy?**

Two credible answers. They are not close in character, and picking wrong costs
weeks.

### Option A — patch Dolphin to export a dma-buf

Add `VK_KHR_external_memory_fd` + `VK_EXT_external_memory_dma_buf` to the Vulkan
backend, allocate the frame-dump render texture as exportable, and pass the fd to
our worker over a unix socket.

- **Cheaper than it sounds, because we already build Dolphin from source.**
  `docker/Dockerfile.dolphin` pins a commit and compiles it; a patch is one more
  layer in a pipeline that exists and is already cached.
- Keeps `-p headless`: no compositor, no window, no second process.
- Cost: a fork to rebase. Small, but permanent.

### Option B — render into a headless Wayland compositor we control

Drop `-p headless`, run Dolphin against a Smithay-based headless compositor;
the compositor receives the client buffer as a dma-buf for free.

- **No Dolphin patch at all**, and it is the proven path: this is what
  Games-on-Whales/Wolf and `gst-wayland-display` do in production.
- Note the irony, and do not let it confuse the decision: ADR 0001 rejected Wolf
  as a **room engine** (its sessions are isolated, so four players cannot share
  one screen). It never rejected Wolf's **capture technique**, which is a
  different thing and is worth reading — the same way the ADR says to read
  CloudRetro's room model without adopting the project.
- Cost: a compositor in the loop, another process to supervise, and the image
  currently has no `libwayland-dev` — Dolphin's nogui Wayland platform would have
  to be built in and verified.

### ✅ Experiment run 2026-08-10: B as written is impossible

Two minutes, and it changed the answer. `dolphin-emu-nogui` has **no Wayland
platform at all**:

```console
$ dolphin-emu-nogui --platform wayland --exec /nonexistent
error: option --platform: invalid choice: 'wayland'
       (choose from 'headless', 'fbdev', 'x11')
$ ldd /usr/bin/dolphin-emu-nogui | grep -c wayland
0
```

Not a build-flag oversight on our side: `MainNoGUI.cpp` only ever registers
`headless`, `fbdev` and `x11`. Wayland support in Dolphin lives in the **Qt**
front-end, which uses Qt's own platform abstraction — and our image is built
`ENABLE_QT=OFF`.

So B's whole selling point, "no Dolphin patch", does not survive contact. What is
actually left:

| | Patch Dolphin? | Runtime cost | New risk |
|---|---|---|---|
| **A** — export a dma-buf from the Vulkan backend | yes, small | none; stays `-p headless` | a fork to rebase |
| **B′** — Qt build inside a Smithay compositor | no | Qt toolchain, a real window, a compositor process | focus gate, below |
| **B″** — add a Wayland platform to nogui | yes, **larger than A** | a compositor process | focus gate, below |
| **B‴** — nogui `-p x11` under Xwayland + compositor | no | Xwayland *and* a compositor | focus gate, plus X11 back in the loop |

**The focus gate is real, and it is the one M1 listed as risk #2.**
`MainSettings.cpp:532` — `MAIN_INPUT_BACKGROUND_INPUT{{System::Main, "Input",
"BackgroundInput"}, false}`. Default **false**: with a window that never gains
focus, input is ignored. M1 proved pipes work *headless*, where no focus path
exists at all; every B variant puts a window back and re-opens that question.
The mitigation is known and cheap — `-C Dolphin.Input.BackgroundInput=True` —
but it is now a thing to verify rather than a thing we have proven.

### Recommendation: A

B″ patches Dolphin *more* than A does, for a worse runtime. B′ and B‴ avoid the
patch only by adding a compositor, a window and the focus gate — and B′ also
drags in Qt. Meanwhile A's supposed drawback, "maintaining a fork", is nearly
free here: `docker/Dockerfile.dolphin` already pins a commit and compiles from
source in a cached layer, so a patch is one `COPY` and one `git apply`.

### ✅ Spike run 2026-08-10: A holds, and D5 is confirmed on this hardware

`spikes/m2-vaapi-export/` — allocate the VAAPI encode surface first, export it,
import it into Vulkan. Reproducible with two `gcc` lines; see its README.

Measured on the RX 6650 XT (navi23), Mesa 25.2.8, RADV, kernel 6.8:

```
VAAPI gave us : 1 object, modifier 0x0200000018601b03, 2 layers
                AMD tiled, TILE_VERSION=3, TILE=27, DCC=0
                layer 0  R8    offset 0        pitch 2048   (luma)
                layer 1  GR88  offset 2621440  pitch 2048   (chroma)

RADV advertises that modifier for:
  R8_UNORM                  storage=yes  colour_attachment=yes
  R8G8_UNORM                storage=yes  colour_attachment=yes
  G8_B8R8_2PLANE_420_UNORM  storage=NO   colour_attachment=NO

Import:  luma   IMPORTED and BOUND  1920x1080 offset 0       pitch 2048
         chroma IMPORTED and BOUND  960x540   offset 2621440 pitch 2048
```

**`DCC=0`.** The video engine's constraint that ADR D5 is built around is real
and visible: radeonsi allocates the encode surface *without* delta colour
compression. Allocating in Vulkan first would have let RADV pick a DCC modifier
that VAAPI then refuses — which is precisely the failure D5 predicts, and why
the ordering is not negotiable.

**The trap: do NOT import the surface as one NV12 image.**
`G8_B8R8_2PLANE_420_UNORM` carries this modifier but advertises
`storage=NO, colour_attachment=NO` — it can only be sampled or used as a
transfer destination. A shader **cannot write into it**. The two planes must be
imported as two separate single-plane images, `R8_UNORM` and `R8G8_UNORM`, which
both allow storage *and* colour attachment. The export already describes the
surface that way (two layers, `R8` + `GR88`, one buffer object), so the natural
reading of the descriptor is also the only one that works — but the obvious
shortcut fails, and it fails at image-creation time with a `VkResult`, not at
first pixel.

The encoder hint (`VA_SURFACE_ATTRIB_USAGE_HINT_ENCODER`) made **no difference**
to the modifier on this driver — same layout with and without. Keep passing it
anyway: it is free, it states intent, and a future Mesa is under no obligation to
keep ignoring it.

**Decision: option A.** The remaining M2 work is a Dolphin patch that exports the
frame-dump texture as a dma-buf, plus the Rust side that owns the VAAPI surface,
imports it, runs an RGBA→NV12 compute shader over the two plane images, and
submits the encode.

Do not start the `encoder` crate before the Dolphin patch has a shape, but the
architecture question is now closed.

---

## 3. Already decided — do not relitigate

From [ADR 0001](adr/0001-architecture.md):

- **D5 — Sunshine's topology, not capture-then-import.** Allocate the VAAPI
  surface **first**, export it, and let a shader write NV12 into it. Mesa rejects
  DCC modifiers for the video engine on everything before RDNA4, and the target
  GPU is RDNA2, so a naive render→export→import pipeline corrupts or fails.
  This composes exactly with the hook in §1.1: at `DumpCurrentFrame` we have the
  source texture, and the destination is the imported VAAPI surface.
- **No AV1.** RDNA3+ only; verified (`no such element factory "vaav1enc"`).
  Target H.264 and HEVC, both in hardware on the RX 6650 XT.
- **`unsafe` gets its exception here, and only here.** M2 is the libva FFI
  module CLAUDE.md rule 2 anticipates: every block needs a `// SAFETY:` comment
  establishing the invariant, a test pinning it where it is not obvious, and
  `just miri` must run on it.

---

## 4. Standards reminder

Unchanged from M1, and two of them earned their keep there:

- **A negative twin for every positive assertion**, and **red-first**: M1 had a
  test that read correctly, passed, and proved nothing. It was only caught by
  reintroducing the bug.
- **Every number is measured and dated.** "It is faster" is not a claim.
