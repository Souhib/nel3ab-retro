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

**The line is the frame, not the protocol.** "WebSocket" appears on both sides of
it and that has caused the question to be asked twice, so state it once: a socket
carrying pad state or encoded frames is on the hot path and stays in the worker;
a socket carrying lobby events (who joined, which rooms exist, chat) fires a few
times a minute and belongs with the control plane, whatever that is written in.
The second kind never touches the first — it hands out a signed token and the
browser opens its own connection to the worker with it. Go is not considered: it
would add a third language to buy a control plane that is not measurably faster
than FastAPI at the rate this one runs.

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

### D9 — `WebCodecs` over a plain socket, not WebRTC

Decided 2026-08-12, after building it and running it.

The M3 plan wrote down, before measuring, what would make the answer WebRTC.
Against each:

- *"WebCodecs refuses our stream, or needs it reshaped"* — it takes the bytes
  `encoder::av` emits **unchanged**. No length prefixing, no `description`, no
  repackaging. 120 of 120 access units on the first run.
- *"the loss behaviour on a real Wi-Fi client is visibly worse and no cheap fix
  exists"* — the jitter is real (p95 36 ms of inter-arrival on a Mac over
  Tailscale, against 17 ms on the loopback) and the cheap fix worked: a queue
  presented one frame per refresh, with an adaptive depth. It cost 16.7 ms and
  took the gap between frames arrived and frames painted from 5-6/s to 0.6/s.
- *"the glass-to-glass difference is under a couple of milliseconds"* —
  **not measured.** WebRTC was never built, so there is no comparison. Said
  plainly rather than quietly dropped.

So the decision rests on two of three criteria and the honest absence of the
third. What it buys is visible in the code: the transport is a socket and a loop,
the page is one file, and *we* decide when a frame is submitted — the property
D7 fought to keep on the encode side, kept on the display side too.

What it costs, and what would justify revisiting: everything WebRTC gives free.
Loss recovery is ours (today: none — a lost frame is a broken picture until the
next IDR, and the encoder forces one when a viewer joins). Congestion control is
ours (today: none — frames are dropped for a client that falls behind, which is
backpressure, not control). Both are fine on a tailnet among people the host
knows, and neither is fine on the open internet. **If this ever leaves the
tailnet, D9 is the first decision to re-open.**

Input rides a second WebSocket rather than sharing the video's. That is a
latency decision: one TCP connection would put a 10 KB IDR being retransmitted
in front of every 13-byte pad frame behind it. It does not make input
*unreliable*, which is what it actually wants — a retransmitted input is already
stale. That needs WebTransport datagrams, and it is the one part of D9 already
known to be provisional.

### D10 — Sound travels as raw PCM, with no codec

Decided 2026-08-14, after measuring what it costs.

The sound leaves Dolphin through ALSA's `file` plugin into a pipe and reaches the
page as signed 16-bit samples, 48 kHz, two channels: 1.5 Mbit/s against sixteen
for the picture. Opus would carry the same sound in a tenth of that.

It is not taken because of what a codec adds on both ends. The worker would gain
a dependency and an encode stage on the audio thread; the page would gain a
second decoder, and this milestone has already spent days on the ways the FIRST
decoder can die — wedged, stalled, starved behind a hidden tab, each needing a
watchdog and a recovery path. One tenth of a stream that is a tenth of the video
is not worth a second copy of that machinery.

What would justify revisiting it: somebody playing over a link where 1.5 Mbit/s
is a material share of what is available. On a tailnet with the picture at 16 to
24 Mbit/s, it is noise.

### D11 — Key frames are asked for, not scheduled

Decided 2026-08-14, measured before and after.

The encoder used to emit a key frame every second. A key frame is five to six
times the size of an ordinary picture — measured here: 8.2 KiB median against
53.7 KiB — so once a second every viewer had to absorb a burst, which on a
20 Mbit/s link takes 22 ms to transmit inside a 16.7 ms budget.

Nothing needed them. The stream rides TCP, so nothing is lost on the way; a
viewer that joins is given one; and a page whose decoder died, or that came back
from being hidden, asks for one with a single byte on the video socket. The
scheduled interval is now ten seconds and exists only as a backstop.

Measured, four interleaved runs: the frame-size tail (p99) fell from 77.8 and
78.0 KiB to 61.4 and 57.5, with no overlap between the arms. The average bitrate
did not move measurably — the scene varies more between runs than the effect —
and that part is reported as inconclusive.

What it costs: a request that is lost delays recovery to the next scheduled key
frame, up to ten seconds. The page re-asks every 500 ms until one arrives, and
the server grants at most two a second however many are asked for, because one
byte from anybody on the network would otherwise inflate the bitrate for
everybody.

### D12 — The control plane is FastAPI, and it never touches a frame

D2 drew the line and left the language open above it. It is FastAPI, laid out the
way the owner's other services are (`api/routes`, `api/controllers`,
`api/schemas`, `api/services`), with their tooling: `uv`, `poe` tasks over `ruff`,
`ty` and `pytest`, and `python-socketio` mounted on the ASGI app for lobby
events. Copying a layout that is already maintained is worth more than a
marginally better one nobody else knows.

**What it owns:** who is here and what they are called, which room exists, which
game it runs, and who claims which pad. **What it must never own:** a frame, a
chunk of sound, or a pad state. Those stay on the worker's own sockets, and the
browser opens them itself.

That is the whole latency argument, and it is checkable rather than asserted: if
the control plane is stopped, a room already open keeps playing. Anything that
breaks when it stops was on the hot path and should not have been.

**Identity is a name, not an account.** Rooms are private and shared with people
who are already on the tailnet; a password would protect nothing that the network
does not already protect, and would be one more thing to lose. The name exists so
a seat can say "Souhib" rather than "player 2". When rooms become shareable
outside the tailnet, this is the decision that has to change first — and D2's
signed token is where it changes.

**The seats the control plane shows are CLAIMED, not held.** The worker is the
only thing that knows who really has a pad; the control plane knows what each
page told it. The two can disagree for a second after a reconnection, and the
page believes the worker, because the worker is the one applying the buttons.

**The room has a REFERENCE configuration, and one named person publishes it.**
Pads and keys are personal, but a room where everyone starts from nothing makes
every newcomer relearn sixteen controls. The control plane therefore holds one
reference set that every page reads, merged into each person's list as read-only
profiles under a prefixed name — a prefix rather than a flag because the
collisions are certain, not hypothetical, and a prefix removes the arbitration.

**Who may publish it is a login in the unit file, not the room's owner.** The
owner is built for deciding the running game: it changes when somebody leaves,
and since the away rule it is handed over on its own after three minutes of
silence. A reference one must be able to return to *whatever happens* cannot
depend on a title that rotates. Empty means nobody, which is the default: a fresh
deployment has no reference and behaves exactly as before.

**The reference is cached in the browser**, for the same reason the whole line
exists: a room already open keeps playing when the control plane stops. Reading
it over HTTP alone would make room profiles vanish mid-game, and take the keys
with them if one was in use.

**And who DECIDES is the worker's answer too.** The control plane elects an owner
— the first identified person in the room — and holds that election until the
socket drops. A tab left open never drops, so a friend who walks away keeps the
room. The worker therefore overrides the election: it stamps each seat when a
frame arrives that is not neutral, and once the owner has been silent for three
minutes anybody may change the game. The room message carries the answer as a
byte, so the page reads a verdict instead of computing one. This removes a second
authority as much as it removes the deadlock: the page used to compare its own
login against the control plane's owner, while the worker reasoned in seats, and
the two disagreed after every reconnection.

### D15 — The same picture is encoded twice, and each viewer picks

One Dolphin, one compute pass, **two encoders**: 1216x896 and 608x448. A page
opens `/video` or `/video?half=1` and the choice is its own.

The problem it answers is a measurement, not a hunch. During a race the stream
costs 14,3 Mbit/s; at half size, 5,6 Mbit/s. A viewer whose link cannot carry the
first was losing 12 % of frames in transit and the rest of the picture with them
(see D11 and the logbook, 7.29), while everybody else was fine. Every earlier
lever — the display schedule, the resync on a broken stream, the cheaper key
frame — is per-viewer and none of them can create bandwidth.

**What was rejected, and why the constraint made it easy.** The brief was "change
nothing for a good connection", and that kills every shared lever at once:

- a real rate control (CBR, VBR, QVBR) redistributes bits across ALL frames for
  ALL viewers. Measured on 2026-08-16: CBR at 12 Mbit/s moves p95 from 32 053 to
  29 114 bytes for everybody;
- dropping the room's internal resolution is the same objection with a bigger
  number: it works, and it takes the person with the good link down too;
- automatic adaptation without a second stream has nothing to adapt WITH.

**What makes it affordable.** The reduction is a specialisation constant on the
existing shader, so the full-size path compiles to exactly what it was — one
`texelFetch` per pixel — and the reduced one averages a 2x2 block. Measured on
lgf, 2026-08-17: the second stream costs **+1,2 ms per frame** (conversion 0,175
to 0,301 ms, encode 1,77 to 2,85 ms) inside a 16,7 ms budget, and the worker's
idle time only falls from 14,7 to 13,5 ms.

And it is **encoded only while somebody watches it**. A room where everybody has a
good link pays nothing at all: not a millisecond, not a byte. That is the
difference between honouring the constraint and approximating it.

**What has to stay separate, and why it is written down.** The two streams share
nothing: viewers, key-frame requests, arrival notifications. A key frame of one
does not repair the other, and a frame of one fed to a decoder started on the
other produces mush rather than an error — visible only to the person who just
switched. Two tests hold that line, one in the transport and one in a browser
driver with a witness page on the other stream.

Sound is not duplicated: reducing a picture changes what is seen, not what is
heard, and sound costs a hundredth of the video.

*Revisit*: when somebody wants the switch to be AUTOMATIC. The signal already
exists — the worker knows exactly when a viewer's queue overflows, which is what
sets `resyncing`. What is missing is a policy that does not oscillate, and that
wants a measurement on a real link rather than a rule invented here.

### D6 amended — the OpenAPI document comes from FastAPI

D6 chose Hey API for the generated TypeScript client and named `utoipa` as the
producer of the document. With the control plane in FastAPI, the document is
FastAPI's own `/openapi.json` and `utoipa` does not enter. The generator stays
Hey API rather than the Kubb used in the owner's other front ends: the practice
being copied is "the client is generated from the contract, never hand-written",
and which generator does it was already weighed here.

### D13 — The page is a build artefact, committed, and stamped

The worker serves its page from `include_str!`, so the page must exist as a file
in the source tree. Vite builds it there as a single self-contained HTML file.

The alternative was a build script invoking npm from `cargo build`. Rejected: it
makes every Rust build depend on node and a populated `node_modules`, including
on a CI runner that only wants to run clippy, and it makes a cargo build fail
for reasons that have nothing to do with Rust.

The cost of committing an artefact is that it can go stale. That is covered by a
stamp (`front/stamp.mjs`, checked in `just check`) over the build INPUTS plus the
hash of the page this build produced. Comparing two builds byte for byte does
not work: the minifier assigns short identifiers differently between runs of
identical sources, measured here at three lines of a 350 kB file.

### D14 — Identity comes from the Tailscale proxy, not from a login form

There is no signup, no password, no session cookie, and no plan to add one for a
tailnet-only room. `tailscale serve` terminates the WireGuard connection, knows
which authenticated peer is on the other end, and writes it into the request it
forwards:

```
Tailscale-User-Login: souhib@example.com
Tailscale-User-Name: Souhib Trabelsi
```

Three properties were MEASURED on 2026-08-16 rather than assumed, because the
whole design rests on them:

- the proxy **overwrites** what the client sends. A request carrying
  `Tailscale-User-Login: attaquant@example.com` reached the backend with the real
  address, exactly once;
- the header is present on a **WebSocket upgrade** too, so the lobby recognises
  somebody without a token travelling between an HTTP route and a socket;
- both services bind `127.0.0.1`, so the proxy is the only path. This is what
  turns the first point into a guarantee, and it is why that binding was chosen
  (see the comment in `worker/src/main.rs`).

Rejected: a shared room password (one more secret to leak, and it identifies
nobody), and real accounts (Argon2, sessions, recovery, for five people who are
already authenticated one layer down).

The **address** is the identity and is not editable. The **pseudonym** is chosen
by the person, editable at will, and stored server-side under that address, so it
follows them across browsers and machines. A room with no proxy in front still
works and simply does not know who anybody is; it falls back to a name kept in
the browser.

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
