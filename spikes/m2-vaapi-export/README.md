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

sg render -c ./spike        # what layout does VAAPI choose?          (destination)
sg render -c ./vk_import    # will RADV take it, writable?            (destination)
sg render -c ./vk_export    # can we export a frame the same way?     (source)
sg render -c ./vk_writes_vaapi_reads   # do the two APIs agree on the bytes?
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

## What they deliberately do NOT do

No shader, and no H.264. They stop where the architectural risk stops: the
surface is writable from Vulkan and the video engine reads back exactly those
bytes. Writing the encoder is several hundred lines of well-trodden libva
boilerplate with nothing to discover in it. Put the RGBA→NV12 conversion and the
encode in the `encoder` crate, with tests —
not here.
