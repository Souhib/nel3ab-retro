# Spike — can Vulkan write into a VAAPI encode surface on RDNA2?

Throwaway C, kept because it is the **evidence** behind M2's architecture
decision, and because a claim about hardware that cannot be re-run is a rumour.
See [`../../docs/m2-working-plan.md`](../../docs/m2-working-plan.md) for what it
decided.

## The question

ADR 0001 D5 says: allocate the VAAPI surface **first**, export it, and let a
shader write NV12 into it — because Mesa rejects DCC modifiers for the video
engine on everything before RDNA4, and this GPU is RDNA2. Everything in M2 rests
on that being true *here*, on this card and this Mesa.

## Running it

`souhib` must be in the `render` group (done 2026-08-10; `sg render` covers a
shell where the new group is not active yet).

```bash
gcc spike.c     -o spike     $(pkg-config --cflags libdrm) -lva -lva-drm
gcc vk_import.c -o vk_import $(pkg-config --cflags libdrm) -lva -lva-drm -lvulkan
gcc vk_export.c -o vk_export $(pkg-config --cflags libdrm) -lvulkan
gcc vk_writes_vaapi_reads.c -o vk_writes_vaapi_reads $(pkg-config --cflags libdrm) -lva -lva-drm -lvulkan
glslangValidator -V rgba_to_nv12.comp -o rgba_to_nv12.spv    # needs glslang-tools
gcc vk_shader_writes_nv12.c -o vk_shader_writes_nv12 $(pkg-config --cflags libdrm) -lva -lva-drm -lvulkan -lm

sg render -c ./spike        # what layout does VAAPI choose?          (destination)
sg render -c ./vk_import    # will RADV take it, writable?            (destination)
sg render -c ./vk_export    # can we export a frame the same way?     (source)
sg render -c ./vk_writes_vaapi_reads   # do the two APIs agree on the bytes?
sg render -c ./vk_shader_writes_nv12   # can a SHADER write the encode surface?
```

Needs `libva-dev libdrm-dev libvulkan-dev` and a free `/dev/dri/renderD128`.

## What they answered, 2026-08-10, RX 6650 XT / Mesa 25.2.8 / kernel 6.8

- The encode surface comes back **AMD tiled with `DCC=0`** — D5's premise is
  real and visible, not folklore.
- RADV advertises that same modifier for `R8_UNORM` and `R8G8_UNORM` with
  **storage and colour-attachment**, and the dma-buf **imports and binds**.
- **But not as NV12.** `G8_B8R8_2PLANE_420_UNORM` carries the modifier with
  `storage=NO, colour_attachment=NO`: sampling and transfers only. The planes
  must be imported as two single-plane images. The obvious shortcut fails at
  `vkCreateImage`, not at the first pixel.

### The source half (`vk_export.c`)

The sequence the Dolphin patch has to perform, rehearsed outside Dolphin because
every iteration inside it costs a ~25-minute image rebuild and here it costs
three seconds.

Device A creates an RGBA8 image with a DRM modifier and exportable memory, clears
it to a known colour and exports the fd; device B imports it and reads the pixels
back. Two `VkDevice`s from one card, standing in for two processes.

- **0 wrong pixels out of 337 920.** Every pixel, not a spot check: a tiling
  mismatch corrupts *some* of an image, and the first pixel would happily match
  anyway.
- RADV offers RGBA8 modifiers with `planeCount` 2 and 3 — those are the DCC
  variants, which carry compression metadata in extra planes. **Filtering to
  `planeCount == 1` is what keeps DCC out**, and it matters for the same reason
  as on the VAAPI side.
- The modifier RADV picked for the RGBA source, `0x0200000018601b03`, is the same
  one radeonsi picked for the NV12 destination.
- The image is allocated **outside VMA**, by hand, so the export info can be
  attached without touching the allocator Dolphin uses for everything else. That
  is what keeps the fork small.

`vulkaninfo` cannot answer any of this — this build prints no per-format modifier
list at all, which is why the query is made directly in `vk_import.c`.

### The one that mattered most (`vk_writes_vaapi_reads.c`)

Everything before it proved the plumbing: surfaces allocate, planes import, fds
survive. None of it proved the two APIs **agree on what the bytes mean**. They
share a buffer object and a modifier, and if either interprets the tiling
differently, every call still returns success and the picture is scrambled. That
is ADR D5's premise, and it was the last thing that could have invalidated M2.

Vulkan writes a gradient into both planes; VAAPI is then asked what it sees.

```
luma   : 0 wrong of 307200
chroma : 0 wrong of 153600
```

The pattern is a gradient on purpose, and Y/U/V each get a different function of
(x, y). A flat fill would read back identical under *any* tiling, and a shared
one would hide a plane swap — the same trap that already produced two tests in
this milestone which passed while proving nothing.

**Do not verify an exported surface with `vaDeriveImage`.** The first run of this
spike did, and 99.6 % of the image "disagreed". On radeonsi `vaDeriveImage`
succeeds and then describes a *linear* layout — chroma pitch 768 at offset
368640 — for a surface `vaExportSurfaceHandle` describes as tiled with chroma
pitch 1024 at offset 393216. VAAPI contradicts itself, and the wrong description
wins. `vaCreateImage` + `vaGetImage` asks the driver to detile instead, which is
its authoritative view and the only thing worth comparing against.

### The conversion itself (`vk_shader_writes_nv12.c` + `rgba_to_nv12.comp`)

Part 5 wrote the surface with `vkCmdCopyBufferToImage`. The real pipeline writes
it from a **compute shader**, into storage images backed by a tiled dma-buf — and
"RADV advertises `storage=yes` on that modifier" is not the same claim as "a
shader can write it". This milestone has been caught by that distinction more
than once.

```
luma   : 0 outside +/-1 of 307200
chroma : 0 outside +/-1 of 153600
worst single-sample difference: 1
```

The worst disagreement is one step, which is rounding: the shader works in float
and the reference in double. The reference is written out longhand rather than
sharing code with the shader, so a mistake in one cannot hide in the other.

BT.709, limited range — what an H.264 stream is expected to carry. Both of the
plausible mistakes there are caught:

| Mutation | luma outside ±1 | worst |
|---|---|---|
| BT.601 coefficients | 274 169 of 307 200 | 28 |
| Full range instead of limited | 269 990 of 307 200 | 20 |

Neither produces a *broken* picture — they produce one that looks almost right,
which is exactly why they are worth a test rather than a careful read.

One invocation per chroma sample, handling a 2×2 block: four luma writes and one
interleaved chroma write. The 4:2:0 average is then free, and it is taken in
**linear RGB before conversion**, which is what the subsampling actually means —
averaging the chroma values afterwards gives a slightly different answer.

### The one that ended the milestone's hardest week (`av_encode_our_surface.c`)

Asks whether the hand-rolled libva encoder is needed at all, and answers no. Two
things had to hold, and both do:

- a surface from **libavcodec's own pool** exports as a dma-buf with `DCC=0`, two
  layers, and the same modifier as one we allocate ourselves — so ADR D5's
  pipeline is untouched and the compute shader still writes it;
- the encode produces 16903 bytes that `ffprobe` decodes back to the exact
  gradient written in.

It fills the surface from the CPU rather than from the shader on purpose: the
shader path is proven on its own in part 6, and mixing them would have made a
failure ambiguous.

## What they deliberately do NOT do

No H.264. They stop where the architectural risk stops: the
surface is writable from Vulkan and the video engine reads back exactly those
bytes. Writing the encoder is several hundred lines of well-trodden libva
boilerplate with nothing to discover in it. Put the RGBA→NV12 conversion and the
encode in the `encoder` crate, with tests —
not here.
