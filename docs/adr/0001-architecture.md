# ADR 0001 — Overall architecture

Status: **accepted** · Date: 2026-08-10

## Context

Self-hosted platform where a host opens a **room**, picks a console and a game,
and up to four players join **from their browser**, each with their own
controller. Emulation runs server-side on an AMD GPU.

Prior art was surveyed: **no open-source project combines libretro + hardware
GPU cores + zero-copy VAAPI on AMD.** `EmuStream` is closest but is NVENC/x264
only; `CloudRetro` has rooms but encodes in software and targets light retro.

## Decisions

### D1 — We do NOT write an emulator

Dolphin is ~500 k lines and 23 years of work (~65-70 person-years). A from-scratch
GameCube core is 3-8 person-years for a worse result — **and would fix none of the
problems actually observed**, which were all plumbing: SDL renaming devices,
unstable `js*` indices, browsers dropping non-standard gamepads, uinput.

### D2 — Rust for the worker, Python/TypeScript above it

Rust ONLY where latency and the GPU live. The control plane is not on the hot
path — an input never traverses it — so its language is chosen for velocity.
Every critical-path building block already exists in Rust (`wl-screenrec` is the
only published dma-buf→VAAPI zero-copy implementation, plus `webrtcsink`,
Smithay, `inputtino`).

### D3 — Controllers are normalised in the BROWSER

Each client converts its own pad (DualSense, Xbox, GameCube adapter, keyboard)
into one canonical GameCube state and sends 13 bytes. The worker writes it to a
Dolphin **named pipe**. No SDL, no uinput, no device index anywhere in between.

### D4 — Slot assignment is server state

The room decides that a member is player 2. It is never inferred from an
enumeration order.

### D5 — Sunshine's encode topology, not capture-then-import

Allocate the VAAPI surface first, export it, let a shader write NV12 into it.
Mesa rejects DCC modifiers for the video engine on everything before RDNA4 (the
target GPU is RDNA2), so a naive render→export→import pipeline fails or corrupts.

### D6 — Hey API for the generated TypeScript client (M4)

`utoipa` emits the OpenAPI document; **Hey API** (`@hey-api/openapi-ts`) generates
the typed client and TanStack Query hooks. Chosen over Kubb: more actively
maintained, first-class Query plugin. The committed snapshot is gated by a
deterministic contract check so the client cannot silently drift.

### D7 — libavcodec encodes; we do not write an H.264 encoder

Decided 2026-08-11, after writing most of one.

The hand-rolled libva path reached: config, context, all three parameter buffers,
packed SPS/PPS/slice headers byte-identical to ffmpeg's. Then radeonsi segfaults
inside `vaEndPicture`. Four differences against ffmpeg's traced call sequence were
found and matched — misc parameter buffers, `num_render_targets`, the profile,
GOP and reference counts — and none was it. The two `LIBVA_TRACE` logs now agree
on every field either prints.

But the crash is not really the reason. The reason is what was still missing even
if it had worked: our encoder is all-intra with no rate control, which is
unusable for a game stream. Finishing it means reference management, a DPB and
rate control — hundreds more lines at the same risk profile as the ones already
written, where a mistake looks almost right and returns success.

**This is D1 again.** We do not write an emulator; a conformant H.264 encoder is
an object of the same kind.

Measured before deciding
(`spikes/m2-vaapi-export/av_encode_our_surface.c`): a surface from libavcodec's
own pool exports as a dma-buf with **`DCC=0`, two layers, and the same modifier**
`0x0200000018601b03` we get allocating one ourselves. So **D5 is untouched** —
the compute shader still writes NV12 straight into the surface the encoder reads.
The encode produced 16903 bytes that ffprobe decodes back to the exact gradient
written in.

What this costs: a dependency on libavcodec (LGPL-2.1, compatible with AGPL), and
control over submission timing. The second is the only real one, and it is
measurable rather than unknown — `async_depth=1`, `max_b_frames=0` and a GOP with
no reordering give one frame in, one frame out.

**Measured 2026-08-11**, RX 6650 XT, Mesa 25.2.8, 240 frames after a 60-frame
warm-up (`cargo run --release --example encode_latency`):

| | p50 | p95 | p99 | held back |
|---|---|---|---|---|
| 640×480 | 1.00 ms | 1.13 ms | 1.45 ms | **0** |
| 1920×1088 | 2.65 ms | 3.05 ms | 4.98 ms | **0** |

Zero frames held back is the number that settles the trade: `async_depth=1`
really does return a packet per submitted frame, so libavcodec's queue adds no
frames of latency — only its own encode time. At 60 fps a frame is 16.7 ms, and
1080p costs 2.65 ms of it. **The concession D7 made is paid for.**

What the table does *not* say: these surfaces are unwritten, so they compress to
nothing and the encode is at its floor. It was re-measured.

**On real frames, 2026-08-11** — 900 frames out of a running Dolphin, 640×480,
the shader writing Melee into the surface the encoder reads:

| stage | p50 | p95 | p99 | max |
|---|---|---|---|---|
| RGBA→NV12 compute pass | 0.13 ms | 0.17 ms | 0.18 ms | 0.64 ms |
| H.264 encode | 1.14 ms | 1.25 ms | 1.46 ms | 4.19 ms |

The floor for this size was 1.00 ms, so a frame carrying a picture costs **14 %
more than an empty one** — the concession D7 made is not merely paid for, it is
cheap. Total GPU-side cost is about 1.3 ms of a 16.7 ms frame at 60 Hz.

The one number to watch is the encode's `max`: 4.19 ms against a 1.14 ms median.
It is a single frame in 900 and well inside the budget, but it is the shape a
stall would first appear as, so it is worth re-reading at 1080p and under a
four-player load rather than assumed away.

Kept from the hand-written work: `encoder::h264`, the bitstream writer. It is
tested against ffmpeg's own bytes and has a concrete future use — ffmpeg's SPS
declares `max_num_reorder_frames=1` and `max_dec_frame_buffering=2`, where a
latency-critical stream wants zero, and rewriting an SPS in flight is exactly
what that module is for.

### D8 — Vulkan is bound with `ash`, not through a shim

Decided 2026-08-11, the turn after D7 chose the opposite for libavcodec — so the
difference is the whole point.

D7 put a C shim in front of libavcodec because `AVCodecContext` has hundreds of
fields whose layout moves between ffmpeg major versions; measured offsets would
go silently wrong on a distro upgrade. **That reason does not transfer to
Vulkan.** Vulkan is a versioned C API designed to be bound: structures are
extended through `pNext` chains rather than by growing, and the ABI is stable by
specification. The hazard the shim exists to contain is absent here.

Against that, `ash` is the maintained standard, its bindings are pre-generated
(no bindgen, no libclang), and it loads `libvulkan` at runtime.

The deciding argument is not the binding, though — it is **where the bugs were**.
Both races M2 has already fixed were about *when* a frame is safe to touch, not
about calling Vulkan correctly. That logic is orchestration: which slot, whose
turn, when to submit. Rule 5 says orchestration belongs where it can be tested
without a process or a GPU, and Rust is where the slot lifetimes can be enforced
by the type system rather than by a comment. A shim would move exactly the risky
part into the one language that cannot check it.

What this costs: rule 2's `unsafe` exception now covers two modules instead of
one, and every Vulkan call is `unsafe` in `ash`. The rule is amended rather than
bent — see `CLAUDE.md`. In exchange, `just miri` gains something real to check:
Miri cannot execute a Vulkan call any more than a libva one, but the descriptor
and slot arithmetic around them is now Rust.

Reused rather than rediscovered: `spikes/m2-vaapi-export/vk_shader_writes_nv12.c`
(500 lines) and `rgba_to_nv12.comp` are the proven sequences to port. The spike
picks the first discrete GPU, which is fine for one card and wrong as a
component — the Rust version matches the **render node it encodes on**, via
`VK_EXT_physical_device_drm`.

## Consequences

- AV1 encoding is unavailable (needs RDNA3+). Target H.264/HEVC.
- Dolphin headless must be built from source: no distro package ships
  `dolphin-emu-nogui`, and the AppImage does not contain it.
- Netplay is explicitly NOT used: one emulator instance, four ports, one video
  stream. Split-screen is not a compromise — every 4-player GameCube game is
  split-screen by design.

## Rejected alternatives

Kept because the reasoning is expensive and the temptation recurs. Each entry
records what was tried, what was **observed**, and what would justify revisiting.

### Building on a browser-desktop stack (Selkies / webtop, X11 era)

Tried first. The emulator ran, the window frame was captured — **its contents were
black**. Cause: that stack renders into **Xvfb, a software framebuffer**, while the
emulator draws on the GPU, so the pixels never enter the buffer being captured.
Not a settings problem; an architecture mismatch.
*Revisit*: the 2026 Selkies (Wayland + `pixelflux`, zero-copy dma-buf→VAAPI) does
solve the capture problem — but it still streams **one desktop per client**, which
is not a shared room.

### Wolf as the room engine

Wolf works very well and is what the owner plays on today. It is **not** a base for
this product: each client gets a **fully isolated session** ("allow multiple users
to stream *different* content"). There is no shared-room mode, so four players
cannot share one screen. Architecturally excluded — not a missing feature.

### uinput / SDL virtual gamepads for input

The path everything else uses, and the source of most observed pain: SDL **renames**
devices (`Wolf X-Box One (virtual) pad` → `Xbox One S Controller`, which silently
broke a mapping), `js0..js3` indices depend on **connection order**, and four
identical pads are distinguishable only by that unstable integer. This is precisely
why D3 sends a canonical frame to a **named pipe** instead.

### Passing the browser Gamepad API through unmodified

A GameCube adapter reports `mapping: ""`, and at least one browser client drops it
on purpose (source comment: *"Non-standard controllers are ignored on purpose"*),
so the pad **never reaches the host at all**. Normalisation must therefore be ours
and must happen in the browser — which D3 already requires for other reasons.

### Forking CloudRetro

Has rooms and "crowd play", which is the closest existing shape. But it encodes in
**software** and targets light retro systems; adding GPU cores + VAAPI means
rewriting its worker entirely. **Read `pkg/worker/room/room.go` for its room model**
— that part is worth learning from.

### Adopting EmuStream

The nearest prior art to this exact idea (Go, `dlopen`s cores, no RetroArch, no
Xvfb, targets Dolphin). Rejected as a base: **NVENC/x264 only, no AMD/VAAPI path**,
`glReadPixels` readback, 33 commits and no community. Worth reading, not adopting.

### Building on Nestri

Reputation outruns reality: 1.7k stars but **two releases, both May 2024**, its
documentation domain no longer resolves, and the project pivoted to a hosted
service with a desktop client. Do not build on it.

### RomM's emulator streaming

Can launch Dolphin and maps all four GCPad ports — but it is marked *work in
progress*, allows **one session per platform**, runs on X11/Xwayland, and ships a
**square stick gate (`141.42`) against the browser's circular one**, which breaks
diagonals. For Melee that is disqualifying. RomM remains excellent as a *library*
layer above this project.

### Writing a GameCube emulator (Rust or Zig)

Dolphin is ~500 k lines, 23 years, ~65-70 person-years. The most advanced Rust
attempt is described by its own author as "still very much a toy" after a year.
Cost 3-8 person-years for a worse result, and it fixes **none** of the problems
actually observed — all of which were plumbing. Not a close call.

### GameCube in the browser (WebAssembly)

Does not exist, and two problems are open rather than merely hard: the **TEV** needs
Dolphin's *ubershaders* (their authors call it "a ridiculous solution to an
impossible problem"), and **EFB copies require synchronous GPU→CPU readback, which
WebGPU does not have** (`mapAsync` costs at least a frame). The decompilation route
works instead — but only per game, and Melee is not among the completed ones.

### Dolphin netplay / Slippi as the multiplayer mechanism

Orthogonal by design: every client runs its **own** instance on its **own** copy,
built from the **same git revision**, and emulation blocks waiting for remote
inputs. Excellent for what it does, and the right answer for competitive Melee —
but it is not this product. Our topology (one instance, four ports, one broadcast
video stream) is correct, and split-screen is not a compromise: every 4-player
GameCube game is split-screen by design.

### Zig for the core

No libva bindings, no usable WebRTC stack, still pre-1.0, and `@cImport` — its main
advantage here — was deprecated. Performance does not separate the two: ~95 % of CPU
time is inside Dolphin and the encoder.

### Writing the H.264 encoder against libva directly

Superseded by D7 after being most of the way built, and recorded because the
reasoning that led there was sound and will recur: direct libva gives exact
control over submission, which is the thing a latency-critical stream cares about.

What was observed: radeonsi segfaults inside `vaEndPicture` on a call sequence
whose every traced parameter matches ffmpeg's. More decisively, the working
version of it would still have needed reference management, a DPB and rate
control — the encoder as written is all-intra with none, which no game stream can
use.

*Revisit*: if measurement shows libavcodec's queueing costs frames that
`async_depth=1` cannot remove. The bitstream writer that survives (`encoder::h264`)
is the part that would be needed again first.

### Kubb for the generated client

Superseded by Hey API before any code was written (see D6). Recorded so the older
recommendation is not resurrected from a draft.
