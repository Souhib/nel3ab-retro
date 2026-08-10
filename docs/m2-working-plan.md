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

### How to decide

Same method that worked in M1: **the cheapest experiment that can invalidate the
plan, first.** For A that is a spike proving a Vulkan image allocated by Dolphin
can be exported and imported into VAAPI on RDNA2. For B it is checking that
`dolphin-emu-nogui` even has a working Wayland platform in our build.

Do not start the `encoder` crate until one of them is answered.

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
