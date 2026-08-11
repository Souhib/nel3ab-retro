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
| Spike 5 | Vulkan writes, the video engine reads back **0 wrong bytes** — D5 confirmed |
| Spike 6 | a compute shader writes BT.709 NV12 in place, **0 samples outside ±1** |
| Dolphin patch | ring of 3, explicit release, delivers real frames at full speed |
| `encoder` crate | frame transport, 18 tests, release-on-drop in the type |

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

- The H.264 encode. **Nothing architectural is left in M2**, but the boilerplate
  is bigger than hoped: the driver synthesises no headers, so a bitstream writer
  comes first. See below.

### Environment left running on lgf

- container `dolphin-dev` (from `nel3ab/dolphin-build:216ffb45`) holding `/src`
  and `/build`, so `ninja` is incremental — **seconds per iteration instead of a
  25-minute image rebuild.** `docker rm -f dolphin-dev` if it is in the way.
- `souhib` was added to `render` and `video`; `sg render -c '…'` covers a shell
  where the new groups are not yet active.

### Synchronisation — done and measured

Both races are closed. A ring of three exported images with **explicit release**
(a slot is reused only once the worker gives it back; a frame with no free slot
is dropped) plus `ExecuteCommandBuffer(false, true)` so the worker is notified
only after the GPU has finished writing.

Proven by asserting the protocol, not the pixels:

```
with the ring check removed:   0 frames on other slots, 25 on the held one   FAIL
with it:                      25 frames on other slots,  0 on the held one   PASS
```

The pixel-comparison version of that test **passed with the bug in**, because
Melee's static screen meant Dolphin overwrote the held slot with an identical
picture. Second time this milestone that a test read correctly and proved
nothing; both were caught only by reintroducing the bug.

### What the wait costs

At the target it costs nothing — **59.91 fps against NTSC's 59.94**, not a frame
dropped. Unthrottled, varying only `wait_for_completion`: **2130 fps with the
wait, 2665 without**, so ~20 % of headroom, leaving ×35 over realtime. Keep it.

Two caveats travel with that number. The CPU figures (14.5 % with export against
a 19.5 % baseline) measure nothing useful and should not be quoted — a thread
blocked on the GPU consumes no CPU, so the sync point makes CPU usage *fall*
while doing more work. And this is a static modal, not a four-player match;
20 % of a much smaller headroom is a different conversation, so **re-measure on
real gameplay** before concluding for the product.

⚠️ The image tagged `nel3ab/dolphin:216ffb45-nel3ab` still carries the
**pre-ring** patch. Rebuild it before relying on it.

### D5 is confirmed on the bytes, not just the handles

`spikes/m2-vaapi-export/vk_writes_vaapi_reads.c`: Vulkan writes a gradient into
both planes of a VAAPI encode surface, and the driver reads back **0 wrong of
307 200 luma and 0 of 153 600 chroma**. The two APIs agree on what the bytes
mean, which is the last thing that could have invalidated the architecture.

⚠️ **Never verify an exported surface with `vaDeriveImage`.** On radeonsi it
succeeds and describes a *linear* layout for a tiled surface — chroma pitch 768
at offset 368640 against the export's 1024 at 393216. The first run of that spike
used it and reported 99.6 % of the image wrong. `vaCreateImage` + `vaGetImage`
asks the driver to detile, which is its authoritative view.

### The conversion works, from a shader, in place

`vk_shader_writes_nv12.c` + `rgba_to_nv12.comp`: a compute shader writes BT.709
limited-range NV12 straight into the imported planes. **0 samples outside ±1**,
worst disagreement 1 — rounding between the shader's float and a double
reference written out longhand rather than shared.

Both plausible colour mistakes are caught by it: BT.601 coefficients leave
274 169 of 307 200 luma samples wrong, full range instead of limited leaves
269 990. Neither would look *broken*, only slightly off, which is why they get a
test instead of a careful read.

### The encoder needs a bitstream writer — settled by observation

`va_encode_caps` reports that radeonsi **accepts** packed SPS/PPS, which is not
the same as requiring them. The question was settled by tracing the reference
implementation instead of guessing:

```
LIBVA_TRACE=... ffmpeg -vaapi_device /dev/dri/renderD128 -c:v h264_vaapi ...
```

ffmpeg requests `VAConfigAttribEncPackedHeaders = 0x0d`
(`SEQUENCE | SLICE | MISC`) and then supplies, per access unit:

| packed header | size | contents |
|---|---|---|
| type 1, Sequence | 312 bits | **SPS and PPS together** |
| type 4, RawData | 1488 bits | SEI |
| type 3, Slice | 72 bits | **the slice header, every frame** |

So the driver synthesises nothing, and the crate needs exp-Golomb coding,
emulation-prevention bytes, and the SPS/PPS/slice-header syntax.

`spikes/m2-vaapi-export/va_encode_one_frame.c` supplies none of those and
**segfaults inside radeonsi at `vaEndPicture`**. It is committed anyway, clearly
marked: it carries most of the parameter set the real encoder needs, and
deleting it would make the next attempt rediscover all of it.

The lesson worth keeping is the method, not the fact: three rounds of guessing at
parameter buffers cost more than `LIBVA_TRACE` would have, and it is the same
lesson as `vulkaninfo` being unable to answer the modifier question. When a
driver is the authority, ask the driver.

### The encoder is libavcodec's, and D7 says why

The hand-rolled libva encoder was abandoned after being most of the way built.
It segfaults inside radeonsi at `vaEndPicture` on a call sequence whose every
traced parameter matches ffmpeg's — four differences were found by diffing
`LIBVA_TRACE` logs, all matched, none of them it.

But the crash is not the reason. Even working, it was all-intra with no rate
control, and finishing it meant reference management, a DPB and rate control:
hundreds more lines at the same risk profile as the ones already written. That is
ADR **D1** again — we do not write an emulator, and an H.264 encoder is the same
kind of object. Recorded as **D7**.

Measured before deciding (`spikes/m2-vaapi-export/av_encode_our_surface.c`):

```
surface from libavcodec's pool: 0x00000004
exported: modifier 0x0200000018601b03, 2 layers, DCC=0
coded 16903 bytes in 1 packet(s)
ffprobe: frame,640,480,I  →  decodes back to the gradient written in
```

**D5 is untouched**: the pool's surface exports with the same DCC-free modifier
we get allocating one ourselves, so the compute shader still writes NV12 straight
into what the encoder reads.

`encoder::va::enc` is deleted; `encoder::h264` is kept. The bitstream writer is
tested against ffmpeg's own bytes and has a concrete use ahead — ffmpeg's SPS
declares `max_num_reorder_frames=1` and `max_dec_frame_buffering=2` where a
latency-critical stream wants zero.

### The order to resume in

1. ~~**Bind libavcodec from the `encoder` crate**~~ — done 2026-08-11, see below.
1. ~~**Measure what libavcodec's queueing costs**~~ — done, and it costs zero
   frames. See *The encode is bound, and the concession is paid for*.
1. ~~**Wire the chain**~~ — done 2026-08-11, minus Dolphin. `encoder::vulkan`
   imports a pool surface as two writable planes, the compute pass writes BT.709
   NV12 into it, and the encoder codes it. Proven on the bytes: **worst luma
   error 1** against a reference transcribed from the standard, and a frame
   carrying a gradient codes far larger than an untouched surface.
1. **Put Dolphin at the front of it.** The only piece left is importing the
   emulator's exported frame as the RGBA source instead of a test pattern — the
   `frame_source` transport already delivers the descriptors.
1. **Re-measure the encode latency on real frames.** The table in D7 was taken on
   unwritten surfaces, which compress to nothing — it is a floor, not the
   steady-state.
1. Then the whole chain against the **0.57-core baseline** the PNG readback used
   to cost, which is the number M2 exists to beat.
1. ~~A bitstream writer~~ — done; `encoder::h264`, pinned against ffmpeg's bytes.
   Its remaining use is rewriting the SPS in flight (see D7).

Every piece except the wiring is now proven in Rust, on this GPU. This is where
CLAUDE.md rule 2's `unsafe` exception applies — `// SAFETY:` on every block.

### The encode is bound, and the concession is paid for

`encoder::av` drives libavcodec's `h264_vaapi`. It talks to a **C shim**
(`crates/encoder/csrc/`) rather than to libavcodec directly, and that choice is
the interesting part:

> `AVCodecContext` has hundreds of fields whose layout moves between ffmpeg major
> versions, and Ubuntu will upgrade `libavcodec60` underneath us. Measured
> offsets — the technique that worked for libva, whose ABI is stable — would then
> be **silently wrong**, which is the exact failure mode this milestone has spent
> its length avoiding. So the ABI question is answered in C, by the compiler,
> against the real headers. Rust binds to a header we own. The cost is a `cc`
> build dependency, far lighter than bindgen's libclang.

What is left to get wrong is whether Rust's `#[repr(C)]` padded our two structs
the way the C compiler did — so the shim exports `n3_layout()`, which reports its
own `sizeof`/`offsetof`, and a test compares every field. **It needs no GPU**: a
padding mismatch is a defect of the binding, not of the machine. Verified
red-first by reordering the Rust mirror (`left: 24, right: 12`), and its negative
twin catches an `n3_layout` that answers zero to everything.

Measured 2026-08-11, 240 frames after 60 warm-up:

| | p50 | p95 | p99 | frames held back |
|---|---|---|---|---|
| 640×480 | 1.00 ms | 1.13 ms | 1.45 ms | **0** |
| 1920×1088 | 2.65 ms | 3.05 ms | 4.98 ms | **0** |

**Zero held back** is the number that matters. `async_depth=1` returns a packet
for every frame submitted, so libavcodec's queue adds no *frames* of latency —
only its own encode time, 2.65 ms of a 16.7 ms budget at 1080p60. That was the
one thing D7 gave up, and it is paid for.

The pool's surfaces still export `DCC=0`, two layers, modifier
`0x0200000018601b03`, on **every** slot — checked by inode, because a pool that
handed out one real surface and two aliases would pass a first-slot-only test.

### What is left, and what is not

The synchronisation gap this section used to warn about is **closed** — see
*Synchronisation, done and measured* above. What remains in M2 is the encode
itself, and none of it is uncertain any more: the RGBA→NV12 compute shader and
several hundred lines of libva boilerplate.

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
