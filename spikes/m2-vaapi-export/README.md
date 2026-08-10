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

sg render -c ./spike        # what layout does VAAPI choose?
sg render -c ./vk_import    # will RADV take it, and can a shader write to it?
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

`vulkaninfo` cannot answer any of this — this build prints no per-format modifier
list at all, which is why the query is made directly in `vk_import.c`.

## What they deliberately do NOT do

No shader, no encode, no output to compare. They stop at "the surface is
writable from Vulkan", which is the part that could have killed the design. Put
the RGBA→NV12 conversion and the encode in the `encoder` crate, with tests —
not here.
