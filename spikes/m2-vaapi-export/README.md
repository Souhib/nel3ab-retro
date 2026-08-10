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

sg render -c ./spike        # what layout does VAAPI choose?          (destination)
sg render -c ./vk_import    # will RADV take it, writable?            (destination)
sg render -c ./vk_export    # can we export a frame the same way?     (source)
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

## What they deliberately do NOT do

No shader, no encode, no output to compare. They stop at "the surface is
writable from Vulkan", which is the part that could have killed the design. Put
the RGBA→NV12 conversion and the encode in the `encoder` crate, with tests —
not here.
