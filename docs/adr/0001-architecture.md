# ADR 0001 — Overall architecture

Status: **accepted** · Date: 2026-08-10

Reading note, 2026-09-09: the numbered decisions retain their original context.
Later dated amendments qualify them. D14 and D16 supersede D12's initial identity
and claimed-seat model; the Switch integration below qualifies D3's pipe-only
input path and the prototype-only restrictions. The
[current project state](../etat-du-projet.md) indexes implementation, evidence
and remaining work, including changes not yet committed to Git.

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

Scope amended 2026-09-09: this describes the Dolphin path. Switch retains browser
normalisation but uses its own typed frame and four private virtual Pro
Controllers because Ryubing consumes SDL devices, not Dolphin pipes. The
integration section records that additional lifecycle and its tests.

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

**Downloadable clips, 2026-09-06:** D10 continues to describe live audio.
Clips now retain that PCM alongside video capture timestamps. At download,
ffmpeg copies H.264 and encodes only audio as stereo AAC at 192 kbit/s, following
its [stream selection](https://ffmpeg.org/ffmpeg.html#Stream-selection) and
[AAC encoder documentation](https://ffmpeg.org/ffmpeg-codecs.html#aac).
Forty seconds of PCM at 48 kHz, stereo i16, cost at most 7.68 MB of sample
storage. The encoded audio budget is about 720 kB per thirty seconds, calculated
on 2026-09-06, not a perceptual comparison of bitrates. No additional codec runs
on the live stream or in the browser. An absent audio interval is an explicit
export error, whereas recorded silence remains a valid audio track.

Clip snapshots share their stored video/audio chunks. Copying samples and
encoding the file happen after releasing the lock used by the live threads.
A local ffmpeg fixture decodes known stereo audio and verifies its delayed
start; it also rejects a missing audio track. It is part of `just`, separate
from CI's `check` because ffmpeg and ffprobe are not installed on that runner.

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
`api/schemas`, with lobby events in `api/ws`), under `control/nel3ab_control`,
with their tooling: `uv`, `poe` tasks over `ruff`,
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

This was the initial identity model. D14 supplies authenticated Tailscale
identity; its September amendment distinguishes the two proxies. A signed
worker token remains unimplemented.

**The seats the control plane shows are CLAIMED, not held.** The worker is the
only thing that knows who really has a pad; the control plane knows what each
page told it. The two can disagree for a second after a reconnection, and the
page believes the worker, because the worker is the one applying the buttons.

D16 replaces this claimed-seat display with reconciliation against the worker's
assignment receipts. Presence and the player name still belong to the lobby;
the worker remains the authority on occupied ports.

**The room has a REFERENCE configuration, and one named person publishes it.**
Pads and keys are personal, but a room where everyone starts from nothing makes
every newcomer relearn sixteen controls. The control plane therefore holds one
reference set that every page reads, merged into each person's list as read-only
profiles under a prefixed name — a prefix rather than a flag because the
collisions are certain, not hypothetical, and a prefix removes the arbitration.

**Who may publish it is a login in the unit file, not the room's owner.** The
owner is built for deciding the running game: it changes when somebody leaves
or confirms a recovery (D19). The worker's three-minute override permits a game
change but does not transfer the named role. A reference one must be able to return to *whatever happens* cannot
depend on a title that rotates. Empty means nobody, which is the default: a fresh
deployment has no reference and behaves exactly as before.

**The reference is cached in the browser**, for the same reason the whole line
exists: a room already open keeps playing when the control plane stops. Reading
it over HTTP alone would make room profiles vanish mid-game, and take the keys
with them if one was in use.

**And who DECIDES is the worker's answer too.** The control plane elects an owner
— initially the first identified person in the room — until departure or an
explicit recovery (D19). A tab left open never drops. Independently of the named
role, the worker overrides the election: it stamps each seat when a
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

**Amended 2026-09-09 from the incidents of September 5 and 6.** The custom domain
uses Caddy, which strips client-supplied Tailscale identity headers. The service
then asks tailscaled who owns the peer address established through the trusted
loopback proxy. The `.ts.net:8443` path still uses tailscaled's identity headers.
Both exact game origins are allowed by the lobby service; unrelated origins
remain refused. Header precedence in the service still depends on these proxy
boundaries and is a remaining defence-in-depth question, not a closed finding.

Tailscale sharing access to TCP 8443 did not imply access to TCP 443. The
September 6 inspection found the latter absent for guests. A narrow grant for
443 was prepared without replacing the existing policy, and the owner later
confirmed access from friends. Neither the custom domain nor its DNS record
makes the application public. See the logbook for the observed filter and the
limits of that verification.

### D16: Seat names follow worker assignments, 2026-09-06

The worker remains the authority on occupied ports. An assignment receipt combines
a process generation and a connection counter. The control plane reads all four
receipts through `seats` on the unproxied control port and associates a browser's
name only with a matching assignment. Departed assignments lose their names.
A repeated announcement from an old connection cannot rename its successor.
Receipts identify assignments, not authenticated people, and are not secrets.
A current named assignment still refuses another present Socket.IO session.

Input clients request this metadata using `identity=1`. The existing seven-byte
room message stays unchanged; `seat <receipt>` and `pad <kind>` follow as text.
A reconnecting page prefers its previous port without stealing it or silently
moving to another prepared controller. Explicitly taking a port remains a
separate user action. The control plane reconciles once per second while people
are present, outside the image path. Existing workers that do not answer `seats`
retain the legacy announcement behavior until both services are upgraded.

A missing control reply retains the last complete observation; it does not mean
four free ports. A confirmed empty reply still releases names immediately.
A person without a matching assignment is pending, not a spectator. Only an
explicit null-seat announcement confirms watching, and a second tab cannot hide
another tab's active or pending pad. The sidebar leaves unnamed occupied slots
blank and lists pending people separately. Legacy pages need one reload for the
receipt protocol; restarting a worker does not reload JavaScript in open tabs.

### D17: Prepare Wii devices together, 2026-09-06

A Wii launch first opens a preparation for the occupied assignments. Each player
chooses one device for their port and confirms readiness. A new assignment must
confirm again; departing players stop blocking; departure of the initiator
cancels the preparation. Spectators see progress. Only the initiator confirms the
final launch, and the worker checks its current right to decide again.

The control command carries the game, save slot, four device choices and the
four expected assignment receipts in one message. The worker checks the complete
assignment snapshot before accepting. It consumes this prepared launch independently
of the old global `ChoosePad` and `ChooseSave` values. GameCube games retain their
single device and direct launch. Changing between a GameCube pad and a Wii Remote
in a running Wii game reopens preparation instead of immediately restarting it.

`PadSetup` writes mutually exclusive devices per port. Codes 0, 1, 2 and 3 mean
GameCube, Remote with Nunchuk, guitar, and Remote alone. The latter is needed for
Party games. Extension changes remain local to a port and are retained for the
current game. The full device setup is associated with the disc filename, so a
stale setup is not loaded for a different disc. The older launch files are still
read; replacing all persistent launch state by one transaction is separate work.

Named preparation profiles belong to the authenticated person's existing bindings
file. They capture a device kind, physical mapping and keyboard mapping. Loading
one changes only the current browser and its unconfirmed choice. Unknown adapters
must match their stored identifier; standard layouts may be transferred between
standard controllers. Saving an existing name requires an explicit update.
Mapping tests send neutral input to the running game while preparation is open.

Compatibility and game actions are small, sourced annotations on the catalogue.
Unknown titles expose their uncertainty. Nintendo manuals support the Kart,
Strikers and Party annotations; no claim is made that the emulated motion covers
every Party minigame. Protocol, configuration and isolated browser tests prove the
parts independently. A mixed-controller game session in Dolphin remains a release
validation, not a result inferred from those tests.

### D18: An open room can have no running game, 2026-09-06

Closing a game is distinct from leaving the room or pausing an emulator. The
chief may request it through the authenticated lobby even while spectating. With
no authenticated chief, a verified seat must have the worker's existing right to
decide. The private control port accepts `stop` with the four observed assignment
receipts; it refuses a changed occupation or an already pending launch.

The worker records `game-closed`, wakes Dolphin if necessary and uses its normal
shutdown path. Its existing supervisor restarts it in idle mode: the catalogue,
input seats and private control port stay available, with `current: null`, but
Dolphin and the GPU pipeline are not created. An explicit launch records the game
and devices, removes the marker and follows the existing startup path. Restarting
an idle worker cannot silently launch the previous game. No save is removed.

This retains the existing worker restart architecture instead of introducing a
second emulator lifecycle inside the process. The cost remains the short socket
reconnection on transitions. An isolated Chromium/Dolphin test measured 3396 ms
from confirmation to a room without a container on 2026-09-06, on the local
machine, not a remote link. It also restarted the idle worker, admitted a new
spectator and launched a Wii game after collective device confirmation.

While someone is present, the lobby reads the catalogue with the seat poll once
per second and broadcasts a changed game, including to spectators without input
sockets. The page stops its media loops while idle, retaining input seats and the
previous audio permission. The selector opens for everyone; gameplay remains a
separate, explicit launch.


### D19: Recover an absent person's role or pad, 2026-09-06

An open spectator tab is connectivity, not evidence of presence. It must not
retain the chief role indefinitely, and quiet spectators must not be removed
merely because they do not use a controller. Recovery is therefore requested
explicitly, with a warning to the current holder. Every connected device of the
chief can answer. A pad request is addressed to the session holding its receipt.

The recipient has 20 seconds to respond, then the requester can confirm. Consent
allows immediate confirmation; refusal cancels and prevents another request for
the same target for one minute. A request expires after one minute and only one
can be pending per room. These are interface choices, not measured thresholds
that claim to detect absence. Time uses the server's monotonic clock. Timeout
alone never transfers anything, and responses cannot be supplied by bystanders.

Role recovery selects a connected identity until it leaves. An old chief opening
another tab cannot preempt it. The selection lives with lobby presence, in memory;
restarting the control service begins a new election. Worker restarts do not.
The crown, permissions to close and the worker's owner seat follow the selection.
Pad recovery additionally carries the expected assignment into the input socket;
the worker compares it while locking its seats. A delayed confirmation cannot
take a replacement occupant, including after a game restart. No name is moved
before the new input connection proves its receipt. Neither recovery restarts the
game. Existing `ask`/`answer` remains for pages loaded before this change; new
pages use the same recovery dialog for both resources.

### D20: Cooperative shutdown and bounded silence, 2026-09-06

SIGTERM and SIGINT set an atomic flag through signal-hook's safe API. They never
invoke Docker from a signal handler. The worker polls frame reception with a
one-second read deadline, joins its input, audio and sleep threads on every
exit path, then Session wakes Dolphin before stopping it. The unit uses
KillMode=mixed so its initial signal reaches the worker alone; the final kill
still covers remaining children. The container exit status is logged.

Before opening FIFOs or save links, the Docker wrapper reclaims its own previous
container. It verifies the session mount before stopping anything with the same
name. This precedes the audio writer check; otherwise the orphan prevents the
very startup that would remove it. Docker control calls are bounded too.

Awake silence warns after three seconds and requests a clean restart after
thirty. Intentional sleep resets that deadline. These are recovery policy bounds,
not measured Dolphin startup times. The initial ring also has a five-second read
deadline. A timeout after partial protocol input is an error, never a reusable
empty read. A brand-new browser decoder starts its output deadline at first
submission; previously only a decoder that had already produced could recover.

Measured in an isolated Mario Kart Wii room on 2026-09-06: SIGTERM completed in
1.6 seconds awake and 1.5 seconds paused. Forced awake silence recovered images
in 36 seconds. A killed worker's paused orphan was reclaimed in a single restart.
`just resilience-test <rom>` repeats these scenarios without stopping the live
room. These observations do not prove recovery from a wedged kernel or GPU.

### D21: A black box records every game, and never touches one, 2026-09-14

On 2026-09-13 Mario Tennis fell from 60 to 40 frames per second after 45 minutes
of play. Finding the cause took a night of probes, and a rerun of the evening
could not reproduce the fragmented video memory that caused it. The data had to
exist before the complaint.

`nel3ab-boite-noire.service` samples the machine every two seconds while an
emulator runs, and every sixty at rest. A sample holds CPU time and frequency per
core, pressure stall figures, sensors, GPU load and clock, the emulator's
threads, their CPU share and wait counts, its GPU objects, disk and network
rates, and the service's own cost. It is written as one JSON line, one file per
day, next to the salon's session journal. It also follows that journal: when
the median page cadence of a room stays under 50 frames per second for thirty
seconds, it captures. It also captures every ten minutes of play, so a slow
capture can be compared with a normal one. A capture is a ten-second `perf`
profile of the busiest emulator threads, summarised to text at once, the count
of GPU object creations, the worker journal, the page measures, and for a slow
Switch room a screenshot. Seven days are kept, like the session journal.

Rejected: a time-series database with a dashboard, such as Prometheus and
Grafana. It would add two services to run and secure, and store counters that
are only read after a complaint. The questions asked after a complaint were not
known in advance. On 2026-09-13 the answer lay in one kernel function, which no
prepared metric would have contained. Plain files read by `just boite-noire`,
and by an agent, answer those questions without a query language.

The service runs as the user with three capabilities, not as root:
DAC_READ_SEARCH, PERFMON and SYSLOG. SYSLOG is needed because
`kptr_restrict = 1` otherwise hides kernel symbols from the profile. It is
scheduled `idle` for CPU and I/O, capped at 50% of a core and 512 MiB. Measured
on 2026-09-14: 0.1% of a core at rest and 0.5 to 1% in play. A sample takes 16
to 18 ms of that idle process, 4.2 kB every two seconds, about 7.5 MB per hour of
play. With captures, a four-hour evening is estimated at 100 to 220 MB, and a
week at 0.7 to 1.5 GB.

The idle scheduling did not make it harmless. An impact bench on a real
four-player match found that each read of the `amdgpu` debugfs files
`amdgpu_vram_mm` and `amdgpu_gem_info` stops the game's picture for about 100 ms.
The reads take a kernel lock that the render thread needs. Reading the allocator
every two seconds made 48 gaps over 33 ms in one minute, against none with the
service stopped. Sampling, `perf record`, `perf stat` and the profile summary
made none. So the allocator is read only when no emulator runs, and captures
copy nothing from debugfs, unless `NEL3AB_BOITE_NOIRE_DEBUGFS_EN_PARTIE` is set
for an investigation that accepts the gaps.

Verified on 2026-09-14 on the same match with these defaults: 57 frames per
second and no gap over 33 ms in every one-minute phase, with the service stopped,
with a periodic capture every twenty seconds, and during a real slowdown capture
with its screenshot. The largest interval was 25.2 ms, against 22.6 ms with the
service stopped. The bench does not prove the absence of subtler effects on a
longer evening, or on Dolphin, which was not measured.


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

This rejection applies to replacing Dolphin's working pipe path. It does not
rule out the isolated virtual devices required by the Switch adapter accepted
on 2026-09-09. Their names, ownership and lifetime are controlled per session;
their cost is retained explicitly rather than presented as a pipe equivalent.

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


## Controller configurator revision, 2026-09-06

The controller editor uses one modal dialog with separate sections for physical
mappings, keyboard bindings and named keyboard profiles. Its emulated diagrams
are previews of the canonical frame, not an assertion about the device currently
attached inside Dolphin. The current device is now reported separately by the worker.

The physical diagram may use a recognised controller family only when the browser
also reports standard mapping. Other adapters retain raw indices. SVG materials
and colours return at the owner's request; the drawings keep their live DOM
updates outside React and the page's existing compressed-size budget.

Unconfirmed personal mappings are cached per identity and retried on arrival.
Writes within an individual page are ordered. Across devices, the last received
snapshot still wins, as before; deletions are not silently merged back in.

See the [controller hand-off](../ecran-manettes.md) and the
[review](../audit-2026-09-06.md) for the invariants and the reproduced failures.

## Media and personal game profiles, 2026-09-07

The VAAPI encoder accepts nonzero even visible sizes. FFmpeg writes H.264 crop
metadata for its internal macroblock padding. GPU conversion, encoding and
software decoding preserve the visible edges at 608×456 and 606×454. Halving
requires a source divisible by four to retain complete NV12 chroma; it never
rounds the game image. This amends D15's divisibility restriction without
changing its per-viewer policy or quality setting.

Audio synchronisation compares the scheduled audio sample with the complete
video presentation schedule, including output latency where the browser reports
it. Optional compensation follows subsequent samples, excludes its own prior
contribution and reserves enough decoded frames for that delay. It is an
estimate of scheduling, not a physical end-to-end measurement.

A preferred Dolphin controller setup belongs to a person and a game. It is stored inside
the existing personal setup snapshot and suggested without applying it or marking
the player ready. Until the catalogue exposes a stable title identifier, console
and exact title form the key. Identically named editions share that preference.
At that date the [Switch study](../etude-switch-2026-09-07.md) proposed a separate
backend experiment. The integration decision of 2026-09-09 below subsequently
approved that backend for the room; Dolphin remains in use for GameCube/Wii.
Switch's named personal profiles are loaded manually and do not yet implement
this per-game suggestion.

### Switch prototype, 2026-09-07: share the room, isolate the emulator experiment

The experiment lives in `spikes/switch-room`, outside the production worker.
Ryubing 1.3.3 executes our Switch homebrew fixture through Vulkan on the Radeon.
Four virtual controllers, stereo sound, browser seat release/reclaim, both video
sizes and the existing MP4 clip exporter have been exercised. Cage provides a
private Wayland display; Xvfb fell back to software rendering. Eden 0.2.1 exited
139 while loading the fixture, including a second attempt with fastmem disabled.

Keep the room transport and control plane as the proposed common parts. This
experiment does not add a fourth unsafe module, change Dolphin's patches, or
approve a Switch production backend. A complete input contract, source capture
timestamps, immediate key-frame requests, demand-driven encoding and reliable
session shutdown are still required. Reading an encoded frame is not equivalent
to Dolphin lending a completed GPU frame with its original timestamp.

The supplied keys and the firmware contained in the XCI subsequently allowed
Mario Tennis Aces to boot. On 2026-09-08, the supplied NSP update loaded as
3.1.0, four browser contexts controlled a doubles match, and the adventure save
loaded after restarting the emulator. One early minute of court presentations
had a median sampled rate of 38.07 FPS, with stutters, while the four browsers
and both capture encoders shared the host. This is not an endurance or remote
latency result. The first `HostMapped` abort was subsequently traced to our
512 MiB Docker shared-memory quota, which the game filled before aborting.
The same mode boots with an 8 GiB tmpfs ceiling, using 3.56 GiB at the title
screen; it is now the default. A later doubles run sampled 52.41 FPS with four
local browsers and both captures, then 60.08 after removing those together.
Characters and inputs differ from the earlier 38.07 FPS run.

The test endpoint uses a private Sway compositor and a supervisor that asks the
game to close its window before stopping the display. The Linux headless Vulkan
shutdown patch is version-pinned and kept in the prototype directory, alongside
its build procedure. It addresses event-loop and render-loop shutdown ordering;
forced exits remain failures. The normal lifecycle and the optional MangoHud
instrumentation are tested separately, as described in the study. This does not
approve Switch production integration. Start with four Pro Controllers;
separate Joy-Con and motion input need their own proof. See the
[measured prototype and feature comparison](../etude-switch-2026-09-07.md#resultats-des-prototypes-le-soir-du-7-septembre).


### Switch prototype amendment, 2026-09-08: bound audio and preserve capture time

The user's first test exposed seconds of audio delay. Instrumenting SDL found
1,725 ms queued upstream of PulseAudio, persisting at normal playback speed.
The version-pinned Ryubing patch discards old samples above 50 ms, retaining
15 ms or one device callback, and retires their buffer ownership too. This
trades a gap after a stall for recovery to current sound. Healthy samples are
unchanged. Four tests call the real backend with a dummy device; restoring the
upstream implementation fails the stale-sound test. A one-second pause of the
private audio server discards 1,065 ms and returns to a 5 ms queue.

A prototype-only wf-recorder 0.4.1 patch emits completed packets with the
compositor's monotonic timestamp. One encode is in flight. This removes the
reader's next-frame dependency and avoids mistaking clustered FIFO reads for
capture times. It still captures after composition, unlike Dolphin's direct
export. An artificial source-to-local-Chrome measurement changes from 114.51 ms
to 78.55 ms median, then 78.32 ms after rebuilding and restarting; each run has
11 retained transitions. These are not controller-to-photon or remote-network
measurements, and do not prove sustained game frame rate.

Capture services must signal the process inside Docker and await its children;
a per-session exclusive lock refuses duplicates. Stopping docker exec alone
left orphan producers and invalidated the intervening capture experiments.
The packet and lock tests have verified failing mutations. Neither this
measurement nor the audio fix approves production Switch integration.


### Switch prototype amendment, 2026-09-08: frame cadence, display catch-up and demand

The recorder declares nominal 60 Hz with `-B 60` without inserting the `fps`
filter. Source timestamps remain authoritative. Reintroducing the filter with
the other changes held constant gives 65.45 ms median source-to-local-Chrome
presentation; removing it gives 41.19 ms, over 60 colour changes per variant.
Neither this nor the earlier short 81.48 ms baseline measures game input latency.

On a display tick, the shared video module now renders the newest decoded frame
whose scheduled presentation time has arrived. Older due frames are closed and
counted as skipped; future frames and the jitter allowance remain intact. A
64 ms stall test goes red when the old one-frame-per-tick dequeue is restored.
The regular-arrival and future-frame twins keep their ordering and ownership.

The prototype capture queries the transport's half-viewer count through a
private zero-payload `D` ingress request. A 100 ms poll keeps demand off the
picture loop. One half recorder starts on the first request, stays while any
viewer remains, and is joined after the last departure. Full video remains
active for clips. Browser and real-process tests cover first/second joins,
last/non-last departures and decoder startup after a later rejoin. Those tests
must use a listener unreachable by real viewers when they assert zero demand.
The runtime cannot infer absence from the test driver's own windows alone.


### Switch prototype amendment, 2026-09-08: recover capture without restarting the game

Reuse the transport's separate full/half key requests and existing 500 ms rate
limit. The private demand query now returns the viewer count and two consumed
key-request flags. Nonblocking local pipes reach the recorder before its next
encode, using the same one-frame intra request as Dolphin's FFmpeg shim. Actual
IDR packets arrived 34.6 and 30.9 ms after requests in the first local test;
restoring the previous bridge and recorder fails the 350 ms regression limit.
The other stream retains its periodic GOP and the next frame is not forced.

Capture failure restarts capture only. Keep the bridge, input seats, emulator
and persistent data alive. The service allows three starts per minute, with a
one-second retry; an explicit stop never retries. Complete-packet progress,
including before the first packet, uses Dolphin's conservative three-second
warning and thirty-second failure deadlines. Reap even a suspended capture
child before releasing the exclusive session lock. Killing full and half
encoders recovered both streams and sound in 2.00 and 2.47 seconds, preserving
the input seat and emulator PID. Suspending a recorder recovered in 36.96
seconds, including the thirty-second deadline and forced capture-child stop.

A connected WebSocket is not proof of moving pictures. The prototype page
announces missing display progress and clears the message when pictures return.
This does not detect an emulated session whose compositor still produces its
last picture. It does not approve production integration or replace the remaining
Switch input, catalogue, preparation, identity and save-slot contracts.

The audio twin exposed a blocked pipe read that survived the watchdog's stop
request. Audio now assembles complete stereo chunks through a nonblocking read,
with a stoppable wait when empty. Suspending its live producer recovers in
36.87 seconds; the original read fails the 43-second browser test. Real-pipe
tests cover stopping before the writer exits, complete byte order and truncated
EOF. Restoring a blocking read makes the stop test fail.


### Switch prototype amendment, 2026-09-08: controller contract and local profiles

Keep Dolphin's thirteen-byte input frame unchanged. A Switch browser sends a
fifteen-byte frame with tag `0x53`, version 1, its seat, sixteen gameplay button
bits in a 32-bit field and four signed 16-bit stick axes. A server fixes its
input format at construction and rejects the other format. Its connection still
assigns the seat, tracks activity, releases controls and routes vibration.
Clients cannot choose another player's port by changing their payload.

Reuse InputStream's connection lifecycle and the existing capture/calibration
functions. Supply a console-specific normalization source, also used by the
live diagram and keyboard preview. Controller configuration sends neutral frames
to the game. Finishing while a control is held waits for release; finishing at
rest accepts the first new press. Do not clear held keys a second time in the
asynchronous native dialog close event: a browser test caught it deleting that
first press after the unit-tested normalization had accepted it.

The prototype opens setup before claiming a playing seat. Named Switch profiles
have their own validated, versioned storage and JSON transfer, independent of
GameCube/Wii profiles. They currently belong to this browser, not to an
identified control-plane account. This individual setup does not constitute
collective game preparation. Home, Capture and motion are not offered because
the guest input path does not connect them.

A four-browser test reaches four isolated Linux virtual controllers without an
emulator. It verifies all sixteen buttons, fractional axes, configuration
neutrality, stored profiles across reloads and neutral state after spectator
transition or closing the tab. It caught the old bridge multiplying already
16-bit stick values by 256: 8192 became 2097152 before the helper's clamp.
This proves the browser-to-kernel path, not a new measurement of guest input
latency. The production catalogue, identities and collective preparation remain
separate integration work.


## Switch room integration, 2026-09-09

At the owner's request, the measured Switch adapter is now a second backend of
the existing room. This supersedes the prototype-only restriction above. The
worker retains the catalogue, authoritative seats, ownership, input transport,
video delivery and audio clips. A private adapter owns its compositor, capture,
emulator and four virtual Pro Controllers. The existing pinned build and capture
sources under `spikes/switch-room` are runtime dependencies, not disposable tests.
No fourth Rust unsafe module is introduced.

Switch launches use collective preparation with device code 4. Each browser
confirms its current seat receipt, and the owner launches only when all current
players are ready. A greeting on the controller connection selects the Switch
frame format before a seat is granted. Reconnection resets that selection, so
Dolphin never receives a Switch frame after a console transition.

Profiles are personal and synchronised through the existing bindings outbox.
Game saves belong to the room. Each registered base application identifier has
independent progression and unlocked slots. A slot lock excludes concurrent
emulation, import and restoration. Backups copy the quiescent user filesystem,
including its metadata. Fresh slots retain system save indexes and empty only
the two user-data banks; deleting their containers broke Mario Tennis startup.

The adapter closes capture before the emulator and removes virtual controllers
last. Container names derive from a fresh private runtime, preventing a test
room from stopping production. A stopped game leaves the catalogue available.
Four Pro Controllers are supported; separate Joy-Con and motion input remain
outside this integration. Automated local browser tests do not prove four remote
players' latency or Nintendo network services.

### Catalogue artwork amendment, 2026-09-09

Switch registrations may provide publisher and description alongside a local
`<rom>.nel3ab.png`. Unlike Dolphin's banners, this artwork is imported during
catalogue setup; Mario Tennis uses Nintendo's product illustration with its
source recorded beside the ROM. No web request or emulator startup occurs while
loading the catalogue. PNG reads and decoding are bounded; missing or malformed
artwork leaves the game playable. The same local artwork route serves all three
menus, preserving image proportions. Console icons are selected explicitly;
an unknown console no longer borrows the GameCube silhouette.

### Vibration failure amendment, 2026-09-09

The production helper's first refused vibration send terminated the helper and
destroyed all four virtual controllers while Mario Tennis kept running. The
worker now creates its private rumble socket with mode 0660 for the shared
group. Delivery uses a nonblocking send; refusal reports feedback availability
without terminating input. This is not a reason to grant the helper permission
to bypass filesystem access controls.

The browser-to-device test now uses the production launch arguments and ingress,
generates force-feedback events for all four players, then refuses delivery
while exercising inputs. Its previous extra DAC_OVERRIDE capability hid the
production permission failure. Recreating devices did not make the running SDL
session reopen them; a game restart was required for that incident. Seamless
recovery from a destroyed helper is not claimed.
