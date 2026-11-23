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

**Amended 2026-11-22: the stamp reads git's list, not the directory.** A
directory walk hashed an 83-byte vitest cache under `front/src/node_modules`,
ignored by git: the stamp was right in one worktree and wrong in every clean
copy of the same commit, so `just check` passed there and CI would have failed
after the merge. The stamp's inputs are now the files git tracks or would track
under the input paths (`git ls-files --cached --others --exclude-standard`).
Untracked but not ignored files count, so a stamp written before `git add`
still matches after the commit; a tracked file deleted from disk is not read;
outside a git repository the stamp refuses instead of guessing.
`front/stamp.test.mjs` pins this in a throwaway repository.

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


### D22: One console manifest, read or checked by every layer, 2026-11-21

The audit of 2026-11-20 counted 28 places in 15 files to touch for one more
console, and the console list copied at least seven times. One boolean,
`Console::is_switch()`, carried five decisions: the input frame, the device
shown to the page, the external adapter path, the machine lock and the cover
art source. A retro console added by extending it would have taken the Switch
lock and been refused while another room played a Switch game.

`consoles/consoles.json`, at the repository root, is now the description of
each console. It lists engines (name, the role the black box records, kernel
process names of at most 15 characters) and consoles: code, label, short note,
player limit, engine, form (internal, or external with its default script, the
variable that replaces it and the variable naming its private configuration),
input frame (`dolphin` or `pro`), devices offered by a preparation, lock group,
art source (`banner`, `wii-save`, `sidecar`), media kind, folder, registration
(`dolphin-header`, `sidecar`, `none`), extensions, experimental and playable
flags. JSON has no comments, so each entry carries a `why` object for the values
that need a reason (rule 1).

Who reads it:

- the control plane, through `nel3ab_control.consoles`, which validates the file
  at import and derives the black box's engine processes and screen-capture
  roles, the preparable consoles, the devices offered, the one-player
  preparation and the Switch lock flag shown on the lobby list;
- the page, which imports it through Vite; the file is an input of the page
  stamp (D13), so editing it without `just front-build` turns `just check` red;
- the worker keeps its `Console` enum and `const fn` capabilities:
  `input_frame()`, `adapter()`, `lock_group()`, `art_source()`, plus
  `registration()`, `extensions()`, `folder()`, `playable()` and
  `experimental()`. A test reads the manifest and names every disagreement in
  both directions, field by field. Switch registration (`switch::registered`)
  and art gathering now ask these capabilities, and the lock follows the lock
  group rather than the adapter path.

Rejected: generating the enum in `build.rs`. Its variants are named across four
crates, its documentation would move into JSON, and a generated `match` reads
worse than a written one. `const fn` capabilities cannot fail at run time, so a
bad manifest stops the gate instead of a room (rule 6). The cost is two places
to edit for a capability Rust uses; the test names the field that differs.
Rejected: TOML, which has comments but needs a new Rust dependency to audit.

The guards that run in each layer: the Rust test above; Python tests that pin
today's black box processes, require every playable console's engine to have a
process (the `eden-cli` omission of 2026-11-07), and compare the worker unit's
`NEL3AB_ROM_DIR` folders and adapter configuration variables with the manifest;
page tests that require a distinct icon and a lobby label for every manifest
console. Adding a fake console to the manifest alone was shown to turn all
three red on 2026-11-21.

The Xbox 360 entry (`x360`, engine `xenia`, external, Pro frame, four players,
disc, folder `xbox360`, `iso` and `xex`) is described and not playable. Its
registration is `none`, so no scan files a game under it: its `.iso` would
otherwise leave the Dolphin path. A worker refuses to start a console that is
not playable and stays on its menu; the lobby does not prepare it; the page
greys it. Its adapter script and variables are reserved and read by nothing. Its
engine has no process name yet: none has been observed, and the manifest refuses
a playable console without one. GOD (Games on Demand) containers are described
as an extensionless header file next to a `<name>.data` directory, which Xenia
opens directly; the scan does not read them. Superseded the same day: see
« Xbox 360 room, 2026-11-21 » below, where it becomes playable, registered by
sidecar, with `iso` only.

Still written by hand, with their reason: Dolphin's own per-console behaviour in
the worker (Wii NAND against GameCube card, Wiimote devices), the Switch title
rules (16 hex digits, base `000`, Switch 2 family `0400`), the default ROM
folders when `NEL3AB_ROM_DIR` is unset (gc and wii only: deriving them would
make a development worker on this machine take the real Switch lock), the
black box's companion processes (`nel3ab-worker`, Sway, the recorders), the
`boite_noire_roulant_sauf` setting (checked against the manifest roles), the
guide tables (checked to name manifest consoles), the page's Wii-specific
device screens, and the icons (checked to be one per console).


**Amended 2026-11-22: title-id shapes, once per language.** The lobby still
copied « 16 hex digits » in three modules: the catalogue dropped Sonic's title
(`534507d6`), the profile listed no Xbox 360 save, and duplicate detection
ignored Xbox 360 sidecars. A console's title-id shape is now written once per
language and pinned by shared examples. Rust keeps `Console::valid_title`
(`core/crates/emulator/src/disc.rs`); the lobby keeps
`nel3ab_control.consoles.FORMES_TITRE` (switch and switch2: 16 hex digits
ending in `000`; x360: 8 hex digits). Both test suites read
`consoles/titres-vecteurs.json`: 32 vectors covering every manifest console,
cross-family negatives (a Switch title refused for the Xbox 360 and the
reverse), and Python-specific traps (full-width digits, `0x`, underscores,
signs, whitespace, a trailing newline). Weighed: moving the shape into
`consoles.json` (for example `title: {digits, suffix}`) would leave a single
source. Not done here, because `valid_title` was outside that change and the
Switch 2 `0400` prefix is a registration rule in `emulator::switch`, not a
shape; it is step E8 of the engine plan (D27), with the case question for the
owner. Hex case is still accepted on both sides; the lobby requires lower case
where it reads names the worker writes (save folders, catalogue). The lobby
also derives adapter save roots from the manifest: `form.config_env` maps to the
lobby setting with the same name minus `NEL3AB_` (`xbox360_config`), and a test
requires such a setting for every external console. The adapter scripts in
`docker/*-room.py` still carry their own copies.


### D23: A game is named by its file name, 2026-11-21

A page asked for a game by its position in a list sorted by name, on one byte.
A file that sorts earlier moves every later position, so a page or the lobby
holding the old list would start the neighbour. Positions stay valid today only
because the worker scans once per process and the seat receipts carry a process
generation; an import adding files while rooms run would break both.

Every catalogue entry served at `/roms` now has a `key`: the file name, which is
already what a room remembers its choice by and what Dolphin saves are keyed on,
and which the scan keeps unique. A key is resolved by EQUALITY against the names
the worker's own scan found, never joined to a path. `nel3ab_protocol::GameKey`
also refuses what a path needs (separators, `.`, `..`, empty, control
characters, more than 255 bytes), so `../x` cannot even be held.

Two routes carry it. On the input socket, a text frame `{"jeu":"<key>"}`. Binary
messages are told apart by length, and a key has none fixed; text frames were
ignored, so an older worker ignores this one and an older page never sends it.
It goes through the same owner rule as `SwitchRom`. A refusal is named back as a
text frame, `jeu refusé: <raison>` (invalid key, absent from this library, this
seat does not decide), and the connection stays open, as for a refused position.
Other text stays ignored. Through the lobby, the page sends `key` with its
preparation; the lobby finds the game by key in the library it just read, keeps
the key, and finds the game again by key at launch. The private control line
carries `k` followed by the key's UTF-8 bytes in hexadecimal, because the line
is split on spaces and file names contain them. The worker's browser server
reads the keys from the catalogue it serves and resolves them to a position in
its own library when it accepts the launch. The two-byte `SwitchRom`, the
numeric game field on the control line and the lobby's `game` index stay
accepted for a page, lobby or worker that has not restarted yet. Art is still
served by position, from the same process that served the list.

Rejected: a library generation sent with each position. It detects a changed
list and refuses, where a key finds the game. Rejected: a content hash, which
would cost a full read of files up to 24 GiB and names nothing a person can read.
Rejected: the displayed title, which is not unique and changes with the cleaning
rules.

Found while measuring the control line on 2026-11-21: its read bound of 320
bytes had been too small since the launcher's identity was added on 2026-09-12.
The longest legal line was 358 bytes. A longer line was cut inside its last
field, still parsed, and named a truncated identity, hence the wrong personal
save folder. Real seat receipts are shorter than their maximum, which hid it.
The bound is now the measured maximum with a key, 866 bytes, and a line that
reaches the bound without its newline is refused. Both halves were shown to fail
their regression test when reintroduced.


### D24: The library is a file the lobby can read without a room, 2026-11-21

The lobby needs the list of games (key, console, title, art available) for the
import and profile pages, including when no room runs. Asking a worker needs a
running room. Scanning in Python would copy the title cleaning written in Rust,
and asking a disc its console means starting the `dolphin-tool` container, which
the lobby must not do.

At each scan, which is each start, the worker writes `catalogue.json`:
`version`, `scanned_ms` (Unix milliseconds) and `roms`, whose entries are the
`/roms` entries written by the same function. It writes a temporary file in the
same directory, flushes it, then renames it over the old one, so a reader sees
the old file or the new one. The path is `NEL3AB_CATALOGUE`, by default inside
the room's own session directory, `salles/<N>/catalogue.json`. Inside and not
next to it: a test that gives the worker a temporary session directory writes
nothing outside it, and no unit file changes. A failed write is logged and does
not stop the room.

The lobby reads `salles_dir/<N>/catalogue.json` for each numbered room and keeps
the freshest by `scanned_ms`. A file that is unreadable, of an unknown version,
or with one malformed entry, a path-like key or a repeated key is set aside
whole, and the next freshest is used: half a list would hide games without
saying so. `GET /api/catalogue` serves it, and answers a named 404 when no room
has ever written one. A test proves the route asks no worker.

Limits: the file is as fresh as the last room start. A file added to `~/roms`
since then is not listed until a room starts again; the import will need a
rescan at rest. Art itself is still served by a room.

### D25: A durable play journal per person, and a private profile, 2026-11-21

The session journal is erased after seven days, names games by their displayed
title and does not record when a seat ends: it cannot say what someone played.
The lobby now keeps a second journal, `NEL3AB_PARTIES_DIR/<sha256>.jsonl`, one
append-only file per person, never swept, mode 0600. Lines are `place_debut`
(room, port, game key, console, title, launcher and save kind), `place_fin`
(same `id`, monotonic seconds, one of five reasons) and `lancement`. A seat whose
end was not seen stays unknown; nothing is extrapolated. Pages flagged as bench
drivers and pages without identity write nothing.

The file name is the SHA-256 of the login, the digest that already ends the
personal save folder names. This is pseudonymisation, not secrecy. Rejected: the
HMAC mark of D14's public payloads, because replacing its secret would orphan
every journal.

Ownership follows the owner's rule of 2026-11-21: a game's save belongs to the
person who launched it, except the shared « tout débloqué » import. Each seat
start records the last launch of THAT game in that room; a game already running
when the lobby started has no known launcher.

Only `RoomController` changes seats, so it alone writes seat ends, and
`release()` requires a reason. A seat lost to the worker after a launch or a
close ends as « game changed », otherwise as « replaced ». `Seat.premiere` tells
every page whether its holder had never held a seat in that room; the page keeps
its browser memory as a fallback.

`GET /api/me/{profil,jeux,parties,sauvegardes}` read only the caller's own data,
answer 401 without identity, and take no login parameter. Consecutive seats on
the same game, room, launcher and save within two minutes form one play; its
time is the union of its seats. Personal saves are found under the worker's three
roots only (`NEL3AB_PERSONAL_SAVE_ROOT`, and `state` of the two adapter
configurations), by `lstat`, without following links or opening files: Switch
slots contain named pipes. The folder name is recomputed in Python; Rust and
Python test the same vector file, `core/crates/emulator/person-key-vectors.json`.

Limits: Switch saves are not linked to their game until the catalogue publishes
the title identifier. Whether a save is in use is not shown, because testing its
lock could make another room's launch fail.


### D26: One régie for the room and the lobby: shared tokens, two themes that follow the system, 2026-11-22

The room page had its own identity: #08080a, an indigo accent, and the device's
font, measured as DejaVu Sans on lgf. The lobby pages used the graphite
"régie", Anybody and Departure. The visual audit of 2026-11-22 found that
moving from the lobby to the room felt like changing sites, and that one hue
meant different things on different pages.

**Tokens.** Colours live in one file, `front/src/regie.css`, in three layers:
primitives (raw values); roles (fond, plaque, creux, survol, encre, legende,
discret, trait, filet, signal, alerte, ok, p1 to p4 and their inks); component
tokens (ecran, buttons, field, focus, state bar, radius 0). The lobby receives
a byte-identical copy (`control/nel3ab_control/api/routes/regie.css`) through a
`/*__REGIE__*/` marker replaced at startup, and `front/src/lib/regie.test.ts`
compares the two copies. No page, component or preview may redeclare any token
of the sheet: `regie.test.ts` checks `front/src` and the previews, and
`control/tests/test_accueil.py` checks every served lobby page. Both read the
token names from the sheet itself, because a hand-written list of five roles
let a redeclared `--encre` through. Old Tailwind names (ink, panel, muted,
indigo...) remain as aliases of the roles, to avoid a mass rename while other
work touched the same components.

**Two themes replace seven.** Several of the seven "ambiances" did not keep
their promise, and none followed the system setting. Night is the default on
bare `:root`. Day applies under `prefers-color-scheme: light` unless
`data-theme="nuit"`, or explicitly with `data-theme="jour"`. The day block is
written twice, because a rule inside `@media` cannot share a selector with one
outside; a test requires the two copies to be identical, and requires the same
pairing for any other day rule (the Bobine console, for instance), so the lobby,
which reads no choice, gets it too. Stored legacy values map by the side they
painted: instrument-sombre, phosphore and ambre to nuit; instrument-clair,
indigo, famicom and gameboy to jour; anything else to auto. A test rejects any
`data-theme` selector naming a theme that no longer exists. Rejected:
`light-dark()`, which needs Safari 17.5 and cannot fall back inside a custom
property; a script that sets the attribute from `matchMedia`, which would paint
the wrong theme until the script runs.

First frame: the page's module script runs after the document is parsed, so an
explicit choice against the system painted the system's theme first (measured
in headless Chrome on the built page: "nuit" on a light system still had the
day background at the first animation frame in 5 loads of 6). Closed the same
day by D35, whose classic head script sets `data-theme` before first paint.

**Controls over the image.** `.regie-nuit` applies the night roles to a subtree,
for controls floating over the always-black image. A custom property is
computed where it is declared and inherited as a value, so every `:root` block
that derives a token from a role is also declared on `.regie-nuit`; a test
enforces it. The image area is painted by the `--ecran` token, black in both
themes, and a test requires it.

**One hue, one meaning.** The four player hues belong to players only. Each
player has a flat colour, unchanged and equal to `media/players.ts`, and a
per-theme ink for text, computed to at least 4.6:1 on every surface, including
the player's own 12 % tint. Rooms are identified by their number, consoles by
name and medium; violet only marks focus and selection. Drawn controllers are
objects: their pressed colour is a fixed object colour on `[data-padmap]`, not
the theme's signal, which fell to 2.06:1 on the Wiimote at night and 1.57:1 on
the standard pad by day.

**Fonts, and the policy they need.** The room embeds the lobby's Anybody (400,
600 and 700 wide) and Departure woff2 files from their single location, read at
build time and inlined as data URIs; `stamp.mjs` lists that folder as a page
input. This requires `font-src 'self' data:` in the worker's
Content-Security-Policy (`core/crates/transport/src/browser/page.rs`). Without
it the policy falls back to `default-src 'self'`, which refuses `data:` fonts:
the built page served with the old policy reported "Anybody 400 error" and fell
back to system fonts. Vite sends no policy, which is why the first verification
missed it. A font cannot execute; opening `data:` for fonts opens nothing else,
and `default-src` still closes other origins. Two Rust tests pin both halves.
Cost: 171,933 to 199,372 brotli bytes (budget 300,000). The policy lives in the
worker binary, so the worker must be rebuilt for the fonts to load in service.

**Digits.** The Anybody subsets have no `tnum` feature and proportional digits
(checked with fontTools), so `font-variant-numeric: tabular-nums` does nothing
on running text. Live numbers are written in `font-mono`, and `banc-visuel`
checks that the bench values keep their width. Deferred: adding tabular digit
glyphs and a `tnum` feature to the subsets with fontTools, as
`tools/polices-accents.py` already modifies their accents; it changes files
shared with the lobby.

### D27: An engine manager for external rooms, 2026-11-22

External rooms (Switch, Switch 2, Xbox 360) move to a shared lifecycle base,
`moteurs/socle/`, plus one folder per engine, `moteurs/<engine>/`: a minimal
card `moteur.json`, then an adapter module. The worker binary and every
`form.script` path stay unchanged during the migration. Each console switches
on its own, in the order Xbox 360, Switch 2, Switch. A console first gets a
canary script, which the owner wires to one chosen room through its
`script_env`; only after a real game on that room does the original path become
a thin wrapper that calls `principal("<code>")` (step E2c for the Xbox 360).
Steps E0 to E2b were built on `chantier/moteurs` and merged into
`chantier/integration` on 2026-11-22; nothing is in `main`, and no room runs the
canary.

**A room never reads the manifest at launch.** D22's reasoning applies to
adapters too: a wrong manifest must stop the gate, never every external room
(rule 6). The base keeps its own hand-written console table (code, label,
engine, script, script_env, config_env, players, extensions), and a test
compares it with `consoles/consoles.json` in both directions. An AST test
forbids any module a room loads from naming the manifest or `control/`, and a
fresh-interpreter test checks which modules are loaded when `serve` starts.
Comparing a card with the manifest (C1, C2, C8, C12) happens in a test module,
`conformite.py`, never at launch. At launch a room reads three things: the
base's table, which is code; its engine card; its configuration. `charger(code)`
reads all three before anything else.

**The golden test is the proof of identity.** `docker/test_salles_dore.py` runs
every room script in a fresh `/usr/bin/python3`, with the worker's script path,
a throwaway working directory and an environment built from scratch. A
bootstrap replaces only standard-library entry points and records argv, the
final error and the slot tree, for 50 scenarios. Every scenario runs three
times: under the machine's account, under another account (1001:118), and on a
copy of the files the scripts read. All three must equal `docker/dore/*.json`.
The fake selector reports the closure of stdin only to a room that registered
stdin, as a real selector does, because the worker stops a room by closing stdin
and then waits without a timeout. The bootstrap refuses a script folder that
would shadow a module it has already imported. Thirteen mutants must each be
seen by their named scenario. A migration commit keeps `docker/dore/*.json`
unchanged; a commit that changes them touches only `docker/dore/` and states
why, and `just salles-dore-ecrire` refuses to run while any other file is
modified.

**Cards grow with their readers.** A card has five fields: name, executable,
display (Wayland, or X11 through Xwayland), pad layout, and the reason for each
deviation. Saves, caches and versions arrive with their first reader, because an
unread field can be wrong without failing anything.

Rejected:

- reading the manifest at launch through `control/nel3ab_control/consoles.py`,
  which contradicts D22;
- an in-process golden test through `runpy`: it keeps the working directory at
  `sys.path[0]`, so it passed a wrapper with a wrong import path that the
  worker's launch refused (shown on a throwaway repository, and reproduced by a
  test);
- a full engine card in the first step;
- changing the Xbox 360 path directly instead of a canary that nobody runs
  until the owner wires one room.

Costs. `serve` and its helpers exist in two copies until the Switch switches
over. Two guards keep them equal: every golden scenario replayed with the
base's `serve`, and an AST comparison of every copied function, `serve`
included, statement by statement except for the one documented `launch = ...`
line. The golden bench takes 5.4 to 5.9 s, measured on 2026-11-22 over four
runs alternated with the previous layout (6.1 to 6.3 s), at load 4 to 5.6, so
this is a ceiling. It runs in `check` with `moteurs-test`, by the owner's
decision: until then no CI recipe tested the external adapters.

Deployment. `deploy-check` reads the effective `Environment` of
`nel3ab-worker@1` to `@3` without sudo (`deploy/salles-adaptateurs.sh`). It
names every `NEL3AB_*_ADAPTER` override, and fails if the override points to a
missing file or matches no console. A relative override is resolved from the
unit's `WorkingDirectory`. Each wrapper is loaded with `charger(code)` under the
`python3` that the unit gives the worker, with stdin closed: importing a wrapper
alone loads neither the engine module nor its card. The check does not see
`EnvironmentFile=`.

### D28: Touch pad geometry is computed, not styled, 2026-11-22

The on-screen pads placed their groups with CSS: corner anchors, a centred flex
row, and `bottom: 140px` for the Switch tool row. A phone-sized audit on
2026-11-22 found page gestures on top of game keys: a tap on R or Z hid the pad
in portrait and L pressed START; in landscape the top of Y hid the pad; the
Switch tool row covered L and L3. No test saw it: jsdom computes no layout, and
the browser driver compared eight boxes among themselves. In Xbox 360 rooms the
pad used Switch names. A review of the first fix found four more defects the
same night: gestures on the picture while the letterbox bands were free; the
gestures covering the room's closing notice (both layers at z-index 30, the pad
later in the page); `padLabel(4)` saying "appareil 4 inconnu" on every ready
player of a Switch preparation; inline Xbox letter colours at 1.05:1 on the
light panel.

Decision:

- `front/src/lib/faces.ts` holds one face per manifest console, and a test
  refuses a console without one. Pro inscriptions come from the
  `switch-labels.ts` names; the ABXY diamond is read from the `padmap` drawings
  (`diamondOf`), so the pad and the configurator cannot disagree.
- `placePad(face, box, bands)` is pure. It returns a `Pose`: one rectangle per
  piece, and `degraded`, which names in words what the pose could not hold, or
  is `null`. Groups go into their letterbox band when they fit, and otherwise
  hug the screen edge; short heights merge rows, short widths round the
  palettes, then shrink the sticks in 4 px steps down to 80 px.
- Page gestures take free slots inside the bands, at least 16 px from every game
  key. When no slot keeps 16 px, the pose says so instead of silently taking the
  least bad place.
- Both pads render the pose through one component, `Pave`, which writes
  `data-degradee` when the pose is degraded. CSS only styles.
- The pad box has z-index 29, so room overlays at 30 painted before it (closing
  notice, plug message) stay on top. Xbox letters sit on a fixed dark
  background; page gestures use the opaque theme panel.

Weighed:

1. Keep CSS and fix the offsets. Rejected: a CSS position cannot be checked
   without a browser, and pad groups had collided three times since 2026-08-18.
2. The audit's single "•••" button opening a sheet. Deferred here, because it
   adds a tap before sound can start on iOS and needed a sheet design. Adopted
   the same day by D35, which leaves the pad one gesture (`GESTES = ["feuille"]`).
3. Four 44 px d-pad buttons. Rejected: a 136 px cross plus the stick do not fit
   the bottom band of a 375x667 phone, and fingers missed in the gaps. The cross
   is one block read at the finger's angle.
4. Raise the closing notice to z-40 in `App`. Not done: lowering the pad to 29
   is local, and also lifts the plug message above the pad, which an alert
   wants. Cost: the plug message covers L for its five seconds.
5. A fully fixed dark pad in every theme. Rejected for plain keys, which hold
   their contrast on every theme; only the coloured letters needed a fixed
   background.

Consequences. A vitest sweep covers 1,267 sizes from 260 to 1,440 px, four
picture formats and three faces (15,204 poses), plus 50 real device sizes; it
requires no overlap, 44 px targets, 12 px gesture clearance and no degraded
pose. `just manette-garde` hit-tests every key with `elementFromPoint`, taps it
for real, checks the closing notice above the pad and measures label contrast,
at seven sizes in four rooms; it is part of `local`. Contrast over a bright
picture is not required: the GameCube A falls to 2.79:1 on white. The pad knows
only the side bands; using the top and bottom bands needs the placed picture
height from `App`. Found while integrating the documentation: the guard's
contrast loop still set `data-theme` to the seven names D26 retired, so it
measured the system's theme seven times. Fixed in the final review of
2026-11-22: it sets `nuit` then `jour` and requires two different `--panel`
values. A mutant that darkens the night ink passed the old loop and fails all
eight contrast cases of the new one.

### D29: One link state, computed in the media layer, shown in one place on the picture, 2026-11-22

On 2026-11-21 the picture froze for twenty minutes while sound continued. The
worker kept sending its 500 ms empty keep-alives, so the video socket stayed
connected. Every page detector keyed on connection state, and three overlays
disagreed: a full-page recovery screen, a boot screen, and a sidebar-only
proposal. None of them fired. Four of the audit's ten critical findings were
this one event, seen from four angles.

**Decision.** A pure function in `front/src/media/liaison.ts` maps signals the
page already has to exactly one of eleven link states. The signals: the time
since any video message and the time since an image-carrying message, measured
separately; the time since the last painted frame; socket open and down
durations, with down time counted from the last proof of life (last message, or
the open), not from the close; the last sound chunk and the last pad echo;
`navigator.onLine` and tab visibility; the boot and game context; a fresh
`/api/salles` probe. It keeps two memories, passed in and returned. A freeze is
left after one second in which every reading saw an image younger than 500 ms,
with at least two images per second; it never reads the measured source rate.
A fallen room is left only on an image received after the fall, and a freeze
survives a cut shorter than 3 s, so "Relancer l'image" does not flicker.

`VeilleLiaison` (`media/veille.ts`) gathers the signals and runs the probe.
Only a 2xx JSON list counts as "the site answers"; any other answer (Caddy's 502
when the lobby is down) is "relay"; no answer within 2.5 s is "silent".
"Closed" is believed only after two closed answers at least 2.5 s apart. The
lobby reads the word printed by `systemctl is-active`, not only its exit code,
exposes `Salle.redemarre` for `activating`, and `ouvrir()` never takes a slot
that systemd is restarting. The session publishes the result in its 500 ms
snapshot; React renders it once, inside `<main>`, anchored to the picture
rectangle (`EtatSalle`), and announces changes on a single `role=status` line.
Every overlay sits below the menus.

Weighed:

1. Deciding in React. Rejected: rule 8 keeps media logic out of components, and
   the state must be testable without a DOM.
2. A typed "capture stalled" message from the worker. Better evidence, and it
   would let the lobby say "everyone" versus "only you". Deferred: the page
   already had enough signals, and the change needed no protocol version.
3. The lobby socket as evidence that the site answers. Rejected: socket.io
   reports "connected" for up to 45 s after a Wi-Fi loss.
4. A probe answer as evidence that the link carries the stream. Rejected: on
   2026-09-22 a small request passed on a Wi-Fi that no longer carried the
   stream. The wording states only what the probe saw.
5. Gating the freeze exit on 90 % of the measured source rate (first version).
   Rejected after review: that rate is a median of compositor-aligned capture
   intervals, so a 45 fps game reads as 60 and never left the freeze.

**Reduced-format proposal.** `fenetrePourProposition` returns one verdict per
ten-second window: hold (a game is starting; the 30 s grace applies), ignore
(closed, restarting, decoder, hidden tab, arrival, or a freeze during which
every reading still had sound and pad echo; neither counted nor resetting the
run), or count (everything else, cuts included). The first version held the
proposal on every cut, and a link that stalled every 16 s was never offered the
reduced format.

Thresholds, with their rationale in the code: frozen at 2 s, banner at 5 s;
resume after 1 s without a 500 ms gap; freeze kept across a cut shorter than
3 s; freshness 1.5 s for messages and 2.5 s for echoes; "closed" confirmed after
2.5 s (RestartSec is 2 s); end of arrival at 15 s. None was confronted with real
Xenia or Eden pauses, nor with a Tailscale relay.

Consequences: a closed room is announced about 3 s later than before. A
whole-site outage that straddles two windows can still lead to a proposal,
because from the page it looks like the page's own Wi-Fi. Caddy still redirects
every gateway error under `/r/` to `/?salle=fermee`, and the lobby home does not
read `redemarre` yet. The browser proof is `just etats-navigateur`, with
`just etats-navigateur-rouge` requiring the two earlier pages to fail on each
named defect.

Amended 2026-11-22 (final review). The column's « Ta connexion » summary kept a
second state machine (`diagnose`), with its own freeze rule: during the
recovery after a freeze, the banner still said « image figée » while the column
said « aucune surcharge ». The column now reads the link state and says it with
the banner's words (`diagnostic(liaison, …)`); `diagnose` keeps only what the
link state does not know: the decode queue, reception pace, a screen slower
than the game. A closed room no longer offers « Inviter quelqu'un » or
« Prendre une place » (`etats.mjs`, `fermee-vraie`, with an open-room twin),
and the spoken line no longer says « Première image reçue. » before any picture
was painted.

### D30: The game keyboard lives in a focusable game zone; room menus are modal dialogs whose cursor is the focus, 2026-11-22

The accessibility audit of 2026-11-22 found two keyboard owners on the room
page. The input loop listened on the whole window and called `preventDefault`
on every bound key, so Enter on a column button reached the game as START and
the button never activated. The menu shells kept their own cursor, separate
from DOM focus, and took Enter and Space for the entry under that cursor: Enter
on the focused "resume" button opened the GameCube folder. The full-screen menu
was not modal: focus stayed on the hidden opener, and Tab walked through twelve
covered column buttons.

Decision:

1. **One focus model** (`front/src/lib/focus-jeu.ts`). A key goes to the game
   only when its target is inside `[data-zone-jeu]`, or when nothing holds focus.
   The zone is the picture box rendered by `Screen`: focusable,
   `role="application"`, `tabIndex` 0 during a game outside loading. The
   browser keeps Tab, Enter, Space and the arrows everywhere else. A `focusin`
   away from the zone releases held keys. The zone takes focus on room entry
   and whenever the menu closes during a game. A pointer click on a one-shot
   column button marked `data-rend-le-jeu` (seats, modes, clip, microphone)
   returns focus to the zone; keyboard activation keeps focus on the button.
   The zone's focus ring shows only on Tab arrival and clears on the first game
   key.
2. **Menus are `<dialog>` elements opened with `showModal()`**
   (`useMenuDialogue` in `components/shell.ts`). The cursor is the focus, with a
   roving tabindex: one entry has `tabIndex` 0 and carries `aria-current`;
   disabled entries use `aria-disabled`, so the cursor never lands on an
   unfocusable element. Enter and Space on a focused button are left to native
   activation. The keydown that opens the menu calls `preventDefault`: Chrome
   151 otherwise delivered that keypress's close request to the new dialog.
   `cancel` (Android back) maps to "back".
3. **Anything that must stay above an open menu renders through a portal** into
   a slot inside the dialog (`components/Surcouche.tsx`): Recovery, the launch
   error, the preparation status. The slot measures the shell footer and
   exposes `--pied-menu`, so notices sit above the exit. Keys and Android back
   that come from a notice never drive the menu, with two guards (`keydown` on
   Escape, and `onCancel`), each owned by its own jsdom test. State that must
   survive the portal remount lives in the parent.
4. **The menu list never narrows below `LISTE_MIN`** (480 px) in the wide layout
   (`lib/menu-xmb.ts`). Below 700 px, the categories split the width equally.

Weighed:

- Ignoring only Enter and Space on interactive targets (the audit's minimal
  fix). Rejected: arrows and letters on a focused control would still drive the
  game.
- Strict zone-only ownership. Rejected: a click on plain text leaves focus on
  `body`, and play would stop with nothing on screen to say why.
- Marking `<main>` and `<aside>` inert, with `role="dialog"` on a positioned
  div. It would keep `z-index` stacking and avoid the portal. Rejected: it
  rebuilds by hand what `showModal()` already gives (inertness, focus trap,
  focus restore, close requests), and the Bindings dialog already used
  `showModal()`.
- Returning focus to the zone after every column click. Rejected: a click that
  opens something must leave focus to what it opened.

Consequences. Outside the marked buttons, a click on a focusable column control
keeps the keyboard on the page; the picture then says "Le jeu ne reçoit plus tes
touches." with "Rendre les touches au jeu", in one top stack (`#avisDuHaut`).
While a menu is open, `<main>` is inert: the spoken status line is silent and
the seat-request banner cannot be answered. Loading and idle overlays are not
modal on purpose, so the column stays usable during an outage. The keyboard
card reads the seat's device: names from `controlsFor`, presence from the drawn
plan in `EMULATED` (one frame, three readings, `docs/ecran-manettes.md`). jsdom
has no `showModal`; the proof is `just focus-navigateur` (24 steps) and
`just focus-navigateur-rouge`, and both browser recipes run in `local`.

### D31: The player-facing vocabulary is a module, and a test holds it, 2026-11-22

The UI audit counted five names for one seat (manette, place, prise, port, P1),
three for the personal save and four for the light picture with two different
costs. Engine and protocol words (socket, worker, running, Dolphin, Xenia)
reached players.

`front/src/lib/mots.ts` holds the player-facing terms and gestures (`PLACE`,
`ENTREES`, `SORTIES`, `SAUVEGARDES`, `IMAGE`, and `LEXIQUE`, which lists them).
The menu writes a gesture in lower case through `enMenu`, always from the same
constant. `front/src/lib/mots.test.ts` extracts with the TypeScript compiler the
strings it can recognise as visible: JSX text, attributes a browser shows,
text-carrying props, menu items and notice arguments, constants whose use
reaches one of those, array elements rendered through `.map`, and templates read
twice (holes filled with "2" and with nothing). It rejects workshop words
outside a `<MesuresTechniques>` subtree, retired synonyms and em dashes
everywhere, and any lexicon phrase written as a literal outside `mots.ts`. The
one exception is `saves.ts`, which the lobby reads byte for byte and a test ties
to `SAUVEGARDES`.

Weighed: a text grep, rejected because it would refuse comments and comparisons
(`state === "running"`). The first extractor kept only upper-case constants,
skipped arrays and replaced template holes by an ellipsis; the review found
three visible strings it missed, and the widened extractor found a fourth.
Runtime values (device names, server messages) remain invisible to it and go
through lexicon functions tested on their own. Lobby pages (accueil, importer,
profil) are not covered and were corrected by hand.

Measured figures are shown only where they were measured. The light picture's
"2,6 times less bandwidth" comes from one Dolphin race (2026-08-17), so other
engines read "moins de débit" (`prixImageLegere(moteurDe(console))`).

Amended 2026-11-22 (final review). The measurement column still wrote « 2,6 »
for every console and the pad-only hint « 13,6 Mbit/s » (a Dolphin p95 from
three days of logs, commit 6e0fd98): both now go through `mots.ts`
(`prixManetteSeule`), and a test refuses these figures anywhere else. One name
per thing joined the lexicon: `IMAGE.passer`, `SORTIES_MENU` and `sortieDuMenu`
for the three menu forms, `TACTILE` and `MANETTE_SEULE`; the old « en réduit »
is refused like « format réduit ». A new guard refuses a new `<button>` whose
written text starts in lower case (charter rule 5); eighteen older ones are
listed with their reason, since about twenty browser drivers read some of
those texts and none was rerun for them. The list can only shrink: an entry
that no longer matches fails the test.

### D32: A preparation accepts a direct launch, the starter's own choice, and launching without an absent player, 2026-11-22

Launching a game alone took seven actions and three confirmations of the same
decision, and one seated player who did not answer blocked everybody.

On the socket event `preparation`: `begin` accepts `direct: true` and launches
at once when `Preparation.directe()` holds (the starter is the only player and
the game offers one device); `launch` accepts `pad`, the starter's own device,
confirmed by launching; `launch` accepts `sans_attendre: true`, allowed
`ATTENTE_SANS` seconds (20 s, a chosen value, not measured) after the arrival of
the latest absent player, on the lobby's monotonic clock. Absent players keep
their seat with their chosen device, or the first allowed one. The page counts
the same delay from when it sees each player arrive, so it never offers the
gesture before the lobby would accept it. The `booting` announcement carries
`starter`, and slot 2 is announced as « la sauvegarde de <prénom> », with
elision rules shared by the page and the lobby through
`front/src/test/elisions.json`.

Rejected: counting the delay from the preparation's opening (first version), so
that a player seated at 19 s could be launched without at 20 s.

Amended 2026-11-22 (final review). A lobby from before this decision ignores
`pad` and refuses a starter who has not confirmed (« Chaque joueur doit
confirmer sa configuration. »); with a rebuilt worker in front of the old
lobby, no prepared game could start, since the starter no longer has a « Je
suis prêt » button. Two answers: the lobby restarts before the worker is
rebuilt (the hand-off in `etat-du-projet.md`), and the page meets that exact
refusal by confirming the starter's choice then launching again
(`lancerEnChef`), as an older page did. Today's lobby has already confirmed
that choice, so the second pass changes nothing there. « Sans attendre » does
not exist in an old lobby, and its refusal is shown as is.

A launch announcement on slot 2 (« ma sauvegarde ») was ignored, so a Wii
device change relaunched on the previous launch's slot. The page now keeps 2
only when it launched itself; for another person's launch it no longer knows
the slot and says so, since `save: 2` from this page would open its own
person's save (`sauvegardeRelancee`).

### D33: The room entry mode lives in the URL and follows the session, 2026-11-22

`?entrer=jouer` and `?entrer=regarder` enter the room directly; the lobby cards
and the invitation link use these addresses. Inside the room, the address
follows the session's own intention (`InputStream.watching`), not the door used
to enter: `entreeDeLaSession`, then `retenirEntree` with `history.replaceState`.
Only the address changes, because changing the entry state would rebuild the
session. A reload returns to the room as a player or a watcher; it does not
guarantee the same seat, because the worker still hands the first free one.
Leaving goes to `/` when a lobby is above (`sortieVers`).

Rejected: writing the mode once, at entry (first version). A watcher who took a
seat lost it on reload, and a player who gave theirs up took it back.

Amended 2026-11-22 (final review, audit P9). The room knows a person by their
private-network address, with no cookie: a foreign page open on a member's
machine could navigate to `?entrer=jouer` and seat them without a gesture. The
worker now answers a request whose `Sec-Fetch-Site` is `cross-site` or
`same-site` with a 303 to the same address without `entrer` (a relative `?…`
reference, so the path behind the relay is kept). A reload (`same-origin`), a
link opened from another application (`none`) and a browser that sends no such
header keep the direct entry. Proved by the router's test, not behind the real
relay.

### D34: Page wiring is held by a committed route bench, 2026-11-22

Five mutants applied together to `App.tsx` left all unit tests and the type
check green: the entry read from the URL, the address rewrite, the invitation
link, the exit, and room closing. The browser routes that would have caught them
lived outside the repository.

`spikes/m3-browser-drive/parcours-banc.mjs` and `parcours.mjs` serve the
committed page against a simulated room and lobby. The simulated room gives the
first free seat to each input socket and frees it on close, with a settable
owner, a preparation, boot announcements and `DELETE /api/salles/1`. Twelve
steps, each with its twin, run as `just parcours-navigateur`, part of `local`,
in 24 s. `just parcours-navigateur-rouge` is the negative control: the page
before the work (528e870) must fail eleven steps on their defect, and the
refused page (e851a64) exactly the four steps of its review defects. Pure
functions carry the wiring that can be unit-tested (`lib/chef.ts`,
`consoleDesTouches`, `sauvegardeAnnoncee`, `entreeDeLaSession`).

Of ten defects reintroduced one by one into `App.tsx`, nine turn their step red.
The tenth removes the address write at entry and is equivalent under a lobby,
because the room rewrites the same address once started; it would show only on
a page served alone, which the bench cannot serve yet.

After a game upload, "Jouer maintenant" joins a room that is open or restarting
(`aRejoindre`) instead of opening a second room on the shared GPU, and its label
says what it does (`libelleJouer`), because the worker only reads its library at
start-up.

### D35: On a phone or tablet, the room column is a drawer, and page gestures live in a bottom sheet, 2026-11-22

The mobile audit of 2026-11-22 found the column folded by default on phones. Its
functions (seats, ask for a seat, report, link diagnosis, spectators, leave)
existed nowhere else. Unfolded, it took half the width: the picture was 195 px
wide and touch keys were off screen. Three page gestures (sound, menu, hide) sat
among the game keys.

Decision:

- Below 900 px of width, or with a coarse pointer (`lib/disposition`, query
  `(max-width: 899.98px), (pointer: coarse)`), the same `<aside id="side">` is
  rendered inside a modal `<dialog id="tiroir">`: full width below 480 px, a
  420 px right panel otherwise, never beside the picture. Its top bar
  (`BarreDuTiroir`, "Revenir au jeu") is sticky. At 900 px the default 304 px
  column still leaves two thirds of the window to the picture.
- One pure function, `couchesDeLaSalle`, decides every overlay mount: the drawer
  exists only in compact mode; the touch pad is unmounted under the drawer and
  the sheet, which releases held keys; the standalone `•••` stays mounted under
  the sheet so focus can return to it. "La salle" opens the drawer in compact
  mode and unfolds the column otherwise (`ouvrirLaSalle`): a drawer flag set on
  a wide screen used to unmount the pad and open nothing.
- The pad keeps one page gesture, `•••`, placed by `placePad` (D28) at least
  16 px from every game key. It opens a modal bottom sheet (`lib/feuille`,
  `FeuilleDuBas`): sound, game menu, the room, show or hide the pad, fullscreen
  or home-screen advice, report. A mouse press on `•••` does not take focus,
  because the keyboard-paused notice used to appear under the pointer and
  swallow the click. Without a pad, or under a full-picture overlay, a
  standalone `•••` sits top right in the safe area.
- A pad-only page is never veiled by loading: its loading clears when the lobby
  announces the requested game (`suiteDuChargement`).
- Fullscreen is offered wherever the API exists; home-screen advice only to
  Apple devices without it. The page sets `viewport-fit=cover` and exposes
  `--zone-*` tokens that the menus, the seat request, the recovery panel and the
  Pro configurator honour.
- A classic head script sets `data-theme` before first paint (closing D26's
  first-frame gap). The worker's CSP already hashes every inline script
  (`script_policy`), and its test now checks every script hash, not only the
  first.

Weighed: putting seats back in the XMB menu (gamepad-friendly, but two places
for one gesture); a non-modal drawer, which would keep the seat-request banner
live but loses the focus trap and inertness. Instead, a seat request or opening
the menu closes the drawer and the sheet; the request lasts ten seconds and
keeps your seat when unanswered.

Proof: `just salle-telephone`, six phone and tablet sizes with simulated iPhone
safe areas, then a desktop, on the built page served with the worker's policy;
51 cases green, 24 red on the tree before review (fbb3bcc). Not tried on a real
phone: home-screen launch, sound after a call, and Android fullscreen from the
home screen remain open, as do an app manifest (it needs `manifest-src` in the
worker's policy), a landscape lock and Wake Lock.

Amended 2026-11-22 (final review). Held in low landscape (height under 500 px),
the antechamber puts its card and its two buttons side by side: in one column,
« Rejoindre » ended at 438 px on a 390 px screen. `salle-telephone` now
measures the bottom of `#enter` at every size; it failed at 844x390, 932x430
and 667x375 before the change.

### D36: The host never follows a link inside a folder a container writes, 2026-11-22

Each engine container mounts its save slot read-write, under the host's own
account (`-v {slot}:/run-data`, `--user` equal to the host user), and the
worker shares the controller folder (`/pads`) the same way. The final review of
the integration branch found that the host followed symbolic links there: a
compromised engine (a trapped game plus an emulator flaw) could leave a link
to a host file it cannot read, and the host would then write `docker logs`
into it through `emulator.log`, overwrite it through `exit.json`, `pads.log`
or `seats.tmp`, empty it through `running.lock`, or copy host files back into
the mount through a save copy. The defect came from `main`; the socle had
copied it faithfully.

Decision:

- Every file the host writes in a slot is opened from a descriptor of its
  folder, each folder level opened from the previous one, all with
  `O_NOFOLLOW` (`emplacement.ouvrir_sans_lien`, `dossier_sans_lien`). A link
  is refused, even one that appeared between two levels; a named pipe is
  refused at once instead of blocking the host (`O_NONBLOCK`, then only a
  regular file is accepted).
- A copy keeps a link as a link (`copytree(symlinks=True)`), and the path to
  what it copies is checked first (`sans_lien`). Copies run with the engine
  container stopped, before the launch or after `docker stop`, so no link can
  appear between that check and the copy.
- The three primitives live in `moteurs/socle/emplacement.py` and are copied
  verbatim into `docker/switch-room.py`, which `switch2-room.py`,
  `xbox360-room.py` and `switch-saves.py` load; `test_differentiel.py`
  compares their syntax trees.
- The worker removes `seats.tmp`, then creates it with `create_new`
  (`O_CREAT | O_EXCL`), which never follows a link; `rename` replaces a link at
  `seats` itself.

Weighed:

1. Keep host-written files outside the mounted tree (a sibling folder the
   container cannot see). Simplest to reason about, and still the better end
   state, but the black box and the measurement readers find `emulator.log` and
   `exit.json` in the slot today: moving them means changing every reader at
   once.
2. Refuse any copy that contains a link. Rejected: a game or its runtime may
   create one legitimately, and a refusal at stop would lose the post-game
   copy.

Proof: `moteurs/socle/test_liens.py` and `docker/test_switch_liens.py` place a
link for each host-written file and require its target intact, with an
ordinary twin still written; 23 and 15 failures on the code before, and the
Rust test read « 1 3 » written into the host file. `just salles-dore` is
unchanged: no Docker command moved. Not proven: a real container, and a slot
where an engine created a legitimate link. The Switch save import, the Rust
unlocked-save module and the Dolphin paths were not reviewed from this angle.

### D37: A retro theme, and its effects behind a three-level setting per device, 2026-11-23

The owner rejected the « régie » screens of D26 (graphite, chalk, violet) and
then the « Scotch et feutre » proposal's theme, while keeping its screen
reorganisations. He chose an 8- and 16-bit console and arcade theme built
around the lobby's EBU test card (« HORS ANTENNE »), the « relief en
escalier » pixel logo, Pixelify Sans for titles, and all 46 effects of the
effects page, behind a setting. This entry is the base the seven screen
tracks build on; it changes no screen layout.

Decision:

- **Tokens keep their names, values change.** `regie.css` keeps every role of
  D26 (`--fond`, `--plaque`, `--creux`, `--encre`, `--legende`, `--trait`,
  `--signal`, `--focus`, `--bouton-plein-*`, the players), so existing
  components re-skin without being rewritten. Values come from the effects
  page's `.borne.on-palette` rules: navy at night, frost by day, the test card
  as the only source of saturated colour (night signal = test-card yellow,
  alert = its red, success = its green). Three values moved for a measured
  reason: day `--creux` is white (frost 400 left player inks at 3.8:1), night
  `--survol` is the lightest navy where the alert holds 4.55:1, and `--trait` is
  the slate #6a76a8 in both themes (navy 700 held 1.8:1). The bold button is
  the signal filled. The test card gets seven tokens (`--mire-*`), the logo
  five per theme, the scoreboard five, the display digits one.
- **Sixteen colours per theme, counted.** `regie.test.ts` resolves every role,
  component token and player flat and requires at most 16 distinct colours,
  with a 17-colour twin. Outside the count, and said in the sheet: the test
  card and the logo (images, identical day and night) and the players' inks
  (the player colour lightened or darkened to read). Player flats are
  unchanged (`media/players.ts`).
- **One engine, one key.** `lib/effets.ts` holds the 46 effects (id, family,
  strength, verdict copied from the page) and three nested levels: « sobre »
  = strength `d` (18), « conseillé » (default) = verdict `oui` (23), « tout »
  = all but sounds (45). Menu sounds are a separate opt-in, off by default,
  never while the game zone has focus. The setting lives in one
  `localStorage` key, `nel3ab:effets` (`{niveau, sons}`), read by the room and
  the lobby, which share an origin. It surfaces as `fx-<id>` classes and
  `data-effets` on `<html>`, set before first paint by a classic head script
  generated from the catalogue (`scriptEnTete`), in the room's single head
  script and in each lobby page. A test runs that script in a bare context for
  every stored value and compares it with the engine.
- **Effects are opt-in classes, flat when off.** `src/effets.css` gives each
  effect an `rt-…` class (box, button, display, waiting screen, layers,
  fronton, START button…) whose off state is plain and readable. Reduced
  motion keeps the key pose and the text, and moves nothing. Every blink is
  1 s in `steps(1)`: at most one per second.
- **Nothing passes over the game picture.** Layers live inside a UI surface or
  a waiting screen, never in the game zone; every JS helper (`src/retro/`)
  refuses an element that is, contains or sits inside the game zone; a
  transition hides the game zone first and restores it after, even on error;
  the snow replaces a hidden zone rather than covering it. `etats-navigateur`
  (`calques-sous-image`) hit-tests a 5×5 grid on the painted picture at level
  « tout », with every `rt-` element made hittable, and its twin detects a
  page-wide layer.
- **One source for the room and the lobby.** The lobby has no React page, so
  it receives generated copies (`routes/retro/`: the effects sheet, the head
  script with the tab icon, the logo, the setting form), compared byte for
  byte by `salon-retro.test.ts` and placed by markers (`retro.py`), like
  `regie.css` before them. A missing marker fails at lobby start.
- **The mascot is abstract.** Screens ask for one of 19 scenes
  (`src/mascotte/`): full version the first time in this browser, short
  afterwards, key pose under reduced motion, refused on the game picture, its
  host clipping whatever leaves its box. A provisional coin draws them until
  the character is chosen; replacing it means changing `mascotte/rendu.ts`.

Weighed:

1. A palette switchable by the « palette » effect (old colours when off).
   Rejected: « palette » is in all three levels, so the old palette would only
   ever show without script, and two palettes double every contrast proof.
2. A strict 16 including the test card and the inks. Rejected: the hover tone,
   the slate and the white field are each required by a measured contrast,
   and the inks exist because a player flat cannot be text on both themes.
3. Global page-wide layers above the picture with a hole cut by script.
   Rejected: a frame of lag on resize would draw over the picture. Layers stay
   inside their surface by construction.
4. A bundle of the JS helpers for the lobby now. Deferred to the lobby track:
   nothing in the lobby uses them yet, and an unused bundle is a copy to keep
   in sync for nothing.

Proof: `regie.test.ts` (contrast of every pair in both themes, 16 colours,
test card, logo tokens), `logo.test.ts` (the logo painted cell by cell against
the effects page's function, night and day, with a wrong-order twin),
`effets.test.ts`, `retro/retro.test.ts`, `mascotte/mascotte.test.ts`,
`salon-retro.test.ts`, `control/tests/test_accueil.py`, and in a browser
`salle-telephone` (effects classes and the title font set before the body
starts, under the worker's policy), `etats-navigateur`
(`calques-sous-image`) and `contraste.mjs --simule` (31 rendered screens; it
found the légende at 4.31:1 on the picker's selected row, tinted with 18 % of
the yellow signal: the tint is now 12 % and `regie.test.ts` reads it). Room page weight, brotli 11: 219 695 bytes before,
235 158 after, margin 64 842 under the 300 000 budget; the font is 10 020
bytes. Not proven: any effect on a real phone (cost of the mosaic filter, moiré
of dithering), menu sounds on iOS, the effects inside real screens (the tracks
will place them), and the provisional coin as a character.

Amended the same day, before the screen tracks branch off, with what their
plans asked of the base (K14, K27 and K28 of the track partition):

- **The test-card cycle moves one bar per second** (7 steps in 7 s, was
  4.2 s). The room allows one change per second for anything that moves
  unasked, and the lobby's blink step would have refused the base's sheet.
  `retro.test.ts` reads the rule's duration and step count; it was red at
  0.6 s per step, and its twin feeds the old declaration to the same reader.
- **The arcade screen keeps its night by day.** `--encre-ecran`,
  `--ecran-trame` and `--fronton-encre` point at night primitives, not roles,
  so they do not change with the theme: text on the black screen holds
  18.38:1, the dithering partner 1.09:1 (bounded at 1.2:1, the night plaque
  would be 1.22:1), the marquee 15.65:1. They leave the day's count of 16,
  and the test requires them to be colours the night already counts, with
  pure white as the twin it must refuse. Weighed: a role with near-identical
  light values per theme would have kept the strict count, but the room plan
  asked for a token that does not change with the theme, and the screen is
  the same object in both.
- **Panel, START buttons, offer.** `--panneau` and `--panneau-filet` (every
  ink measured on the panel, players' inks at 5.39:1 by day, the raw player 3
  flat refused); `--start-encre` (black on each player flat, 5.3:1 at worst,
  where the test-card white would hold 3.47:1); the unlit START
  (`--start-eteint-fond`, `-encre`, `-trait`: a hollow with a dotted outline,
  no player colour); `--offre`, a dotted signal outline that must differ from
  the alert. All point at existing roles, so neither theme gains a colour.
- **The controllers' object colours** form a section of their own at the end
  of `regie.css`: 65 primitives copied from the `[data-padmap]` materials of
  `index.css` and `TINTS` of `padmap.ts`, without the translucent values.
  Nothing reads them yet; the controllers track owns that section, and the
  test refuses a role or component that points at one.
- **Four shared pixel icons** (chevron, sliders, clock, door), each asked by
  two tracks, so two additions of the same key cannot collide at merge. The
  test now checks every icon's grid (7 rows of 12 cells) with three twins.

Eight token mutants each fail the test that names them. Room page weight
after the amendment: 235 700 bytes in brotli 11, margin 64 300.


### D38: What the lobby publishes of each room, and what « open since » means, 2026-11-23

The retro screens read facts about a room that the lobby either did not
publish or published under a misleading name (plan « donnees », lot 1). The
lobby publishes only what it can fill; an absent value is `None` and the page
hides the line (the rule of `api/schemas/salle.py`).

Decision:

- **`Salle.ouverte_depuis` is the time since the LOBBY opened the room;
  `Salle.jeu_depuis` is the old value.** Measured on lgf on 2026-11-23: a game
  change makes the worker exit, and systemd 255 passes the unit through the
  inactive state for one step (« Deactivated successfully » at 07:09:06.65,
  `InactiveExitTimestamp` 07:09:06, `ActiveEnterTimestamp` 07:09:08). The old
  field read `ActiveEnterTimestampMonotonic`, so it restarted at every game
  change: it was the current game's age. It is now `jeu_depuis`. The opening
  time comes from a marker, `salles_dir/N/ouverte-le` (boot id and monotonic
  microseconds), written by `ouvrir` AFTER systemd accepts the start and
  removed by `fermer`, through a directory descriptor without following links
  (D36).
- **A stale marker is detected by the length of the last inactive pause, not
  by `InactiveEnterTimestamp` alone.** The plan proposed ignoring a marker older
  than `InactiveEnterTimestampMonotonic`; on systemd 255 that timestamp moves at
  every game change, so the rule would have hidden the opening time after the
  first game. The marker is ignored when it comes from another boot, or when it
  is older than `InactiveExitTimestampMonotonic` and the last inactive pause
  lasted more than one second (a room that closed on its own, then was started
  by hand outside the lobby). Not covered: such a hand start followed by a game
  change, since systemd keeps only the last pause.
- **systemd properties are read by name.** `systemctl show -p A -p B --value`
  prints values in systemd's own order (`Result`, `ExecMainStatus`,
  `InactiveExitTimestampMonotonic`, `ActiveEnterTimestampMonotonic`,
  `InactiveEnterTimestampMonotonic`), not the requested one. The lobby asks
  once per room for `Name=value` lines.
- **The fake systemd follows the real one** (`control/tests/faux_systeme.py`):
  restarts move the three timestamps, an inactivity close leaves `failed` with
  status 42, calls take time, and properties come back in systemd's order.
  The old fake had one fixed age per room, which is why nobody saw the field
  restart.
- **Closed, restarting, and on but silent are three facts.** `Salle.repond`
  is true when a running room answered `GET /roms`, false when systemd says
  it runs and it did not answer usably (an error, or JSON that is not an
  object, which used to raise `AttributeError` and fail the whole list), and
  `None` when nobody asked. `Salle.fermee_depuis` and `Salle.fermee_pour`
  (`inactivite` for exit status 42, `arret` for a clean stop, `panne` for any
  other result) come from the same `systemctl show`, only for the words
  `inactive` and `failed`: a `deactivating` unit still carries the inactive
  timestamp of its last game change. Who closed the room is not published.
- **The last game comes from the room's own folder.** `Salle.dernier_jeu` and
  `Room.dernier_jeu` (`{cle, titre, quand}`) read `salles_dir/N/chosen-rom`,
  which the worker writes before it exits for a new game and which survives a
  closed room. `quand` is when the game was chosen (the file's mtime), not when
  play ended. The title comes from the freshest catalogue for the list and from
  the worker's library for the room; a key that is no longer there gives
  nothing rather than a title made from a file name. `chosen-person`, an
  address, is never read. During a restart, `Salle.jeu` is that game when the
  `game-closed` marker is absent (the worker removes it before exiting); a link
  at that name means « unknown » and gives no game. `Salle.console` and
  `Salle.cle` describe the running game (K19); « ? » is not published as a
  console.
- **Who is there, from what the lobby already holds.** `Salle.chef` is the
  pseudonym of `people.owner(numero)`; `Salle.sieges` (`{port, nom, tenu}`) and
  `Salle.regardent` come from the room's controller and the presence register,
  with no extra worker call: `tenu` is the worker's last read, kept fresh by
  `follow_seats` only while somebody is connected. An open room nobody is
  connected to therefore has `sieges = None`, not a stale list. A spectator is
  someone present with no pad who said so; someone waiting for a pad is not.
  Only pseudonyms leave, never an address. Field names are this track's (K18).
- **`Room.lancement` says who launched the running game and on which save.**
  It reads the table's last launch of that game (`Tablee.lancement_courant`),
  with the launcher's pseudonym and repère (computed from the address kept in
  memory only, never published nor written) and the save (`lanceur`,
  `commune`, `neuve`, `inconnue`). `None` when the lobby saw no launch (it
  restarted since), and when the game changed more than once since that
  launch: a game that came back through the worker's own menu was not
  launched by that person. `Room.vue_par` sets `moi` on the launcher too.
- **Two socket messages, closed by construction.** `menu {ouvert: bool}` marks
  `Person.au_menu` until the page closes its menu, leaves, or loses its pad;
  its rate limit is held per word, so opening then closing within half a
  second is not lost. `plainte_quoi {quoi}` writes the complaint's reason
  (`image`, `son`, `manette`, `autre`) to the session journal, on its own
  twenty-second limit. Every rate-limit refusal now carries `reste_s`, the
  seconds before the next accepted message.


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

## Switch 2 experimental adapter, 2026-11-07

Keep the worker's catalogue, authoritative seats, Pro Controller frames and
media transport. The Eden-family adapter supplies a separate launch plan to
the existing Switch container lifecycle. Capture stops and the actual emulator
exits before its NAND is backed up. Switch 2 progression has its own state root;
shader caches are also separated by engine revision. No Rust FFI is added.

Register a verified base application explicitly as `switch2` beside its NUP.
The prototype exposes one kernel controller and one worker seat. Spectators
remain supported. This limit describes the integration validated here, not the
physical console's capabilities. Only the starter confirms preparation. The
lobby identifies its connection in the launch announcement, so a starter on
seat three can politely request seat one after the worker restarts. Other
connections switch to watching. No occupied seat is taken during this handover.

On this server, the first Eglantine 3D launch lost the Vulkan device and the
kernel reset the GPU at 14:00 UTC. `EDEN_NX2_NO_MESH=1` avoids that path while
omitting objects. The public console label and game guide must retain that
experimental limitation. The private container does not isolate GPU resets.

Two alternating rounds on the same Ocarina of Time save place Eglantine's
2026-11-07 build at about 22 actual game presentations per second on the
Ryzen 5 3600 and RX 6650 XT. Select it for the experimental Zelda entry.
Ten accepted introduction samples keep sound and picture within the estimated
0.5-second measurement uncertainty; the other three builds reach about
36 seconds of sound lead in their observed excerpt. Rejected late image
matches give no evidence about the end of the film.

The isolated room verifies browser movement, camera, native X jumping,
spectator input refusal, entry into and exit from Link's house, and manual
save recovery after complete shutdown. A starter on seat three becomes the
only player on restart. These observations do not approve a full playthrough,
motion controls, all zones or additional games. The dated study records the
protocol, limits and private-data locations.

Follow-up on the first user session: D21's observer must recognise the actual
`eden-cli` kernel process name, not only Ryujinx and Dolphin. Otherwise its
idle path permits GPU allocator reads during play and misses game metrics.
The real scanner is exercised through the service with fake system files,
including the idle negative twin. Freeze screenshots accept both Switch
families; periodic captures still omit screenshots. No GPU performance gain
is attributed to this observer correction without an alternating comparison.

Follow-up on 2026-11-08: the official PGO package of the same Eglantine revision
raises pooled Kokiri presentations from 22.68 to 23.96 per second over two
alternating rounds. One shutdown after save recovery exits 139; identical
standard and PGO recovery controls then exit normally. Its cause is unproven.
Keep the installed standard package while that uncertainty remains. Lichii 117
standard and PGO do not reach the menu with this server's `NO_MESH=1` setup;
these trials do not judge it on other configurations. The dated study retains
the evidence, including the invalidated request to disable built-in patches.

The later requested trials on 2026-11-08 evaluate Eglantine experimental
`eab2c2246d` PGO and Orchid 0.9.0. The former reaches 23.90 presentations/s
against 22.97 for the installed standard over alternating Kokiri rounds;
five observed exits are normal. This does not establish that the earlier
rare shutdown crash is fixed. Orchid finishes two seven-point CPU matches
with normal exits and restart, using its own recommended Tennis settings
and no mesh-skip override. Its native trial does not validate browser-room
integration, additional players or other courts. Keep the installed engine
and catalogue: the current adapter still imposes Eglantine settings on every
Switch 2 title, so a global replacement is not a verified per-game selection.

The later Zelda-specific Orchid trial on 2026-11-08 loads a copied Kokiri save
rather than judging the introductory movie. Three launches reach hearts and
the map, but fail to render the world and avatar correctly, including a launch
without any `EDEN_NX2_*` overrides. Native graphics shader translation rejects
operations and skips draws. No playable cadence is accepted for this missing
world. Orchid's Tennis results do not validate Zelda or justify a global
engine replacement. The dated study retains the configurations and exit results.
A functional control with the installed Eglantine renders the same file and
checkpoint, shows avatar and camera movement, and exits normally. This does
not add a cadence comparison or validate a new zone transition.

The later Zelda profiling and parallelism trial on 2026-11-08 waits for an
unrelated browser CI job to end before measuring. Seven unprofiled Kokiri
phases alternate modes 0, 1 and 2. Pooled rates are 20.64, 20.61 and 20.72
actual presentations/s; the observed differences are smaller than the
baseline's variation. All seven exits are normal. Keep `SPLIT=0`: this scene
does not demonstrate a material gain from the existing parallel modes.
The separate native profile puts the CPU-side graphics thread at 94% of one
logical CPU, with method processing, macros and stage buffer binding its main
timed costs. CPU temperatures near 96 C remain a measured constraint, not proof
of thermal throttling or a quantified hardware upgrade benefit. The dated
study retains the raw-window evidence and the missing full-world/zone coverage.

A separate split-mode2 profile records about 56% elapsed time in the front's
drain wait while that thread consumes about 93% of a logical CPU. The drain
path polls with pause/yield rather than a blocking notification. Treat its
coordination cost as a source-level investigation target, not a demonstrated
FPS fix. Any replacement must preserve ordered writes, deferred submission
completion and shutdown wakeups. No emulator source change is installed by
this profiling trial.


On 2026-11-08 the user authorizes a source-level experiment for Eglantine's
GPU split drain. Keep the pinned upstream checkout, builds, saves and input
devices isolated from the installed room. Compare unmodified and modified
binaries built with identical options and runtime dependencies, rather than
attributing a local-build versus official-package difference to the patch.
The progress wait must retain command completion, deferred submission and
front-before-back shutdown ownership. This extends D1 with a bounded local
emulator investigation; it does not authorize a new emulator or an untested
production replacement. The [60 FPS plan](../plan-60fps-switch2-2026-11-08.md)
separates measured bottlenecks from hypotheses and future acceptance checks.


The source experiment on 2026-11-08 compiles and verifies the actual changed
GPU object after detecting and excluding a stale-object candidate. Runtime
activation and targeted disassembly now supplement executable hashes.
Four matched-cache phases alternate original and notification-based waits:
21.28 versus 20.71 native presentations/s, with front-thread CPU falling
from 80.46% to 36.86% of one logical CPU. Keep the prototype isolated and the
installed standard engine in split mode 0. A separate resolution alternation
returns 21.68 versus 21.63 presentations/s, giving no pixel-count gain here.
The CPU sample points primarily to FrontDmaRead among drain callers; investigate
valid argument snapshots and precise dependencies before removing waits.
Save/write/restart and ground movement succeed in the private patched run.
Known mesh omissions, an unreproduced unmodified Vulkan allocation failure,
and unproven thermal causality remain explicit limits. The dated plan records
milestones and acceptance evidence for 30, 45 and 60 native frames/s; none is a
promised gain from this patch.

The next authorized source experiment on 2026-11-08 targets MME argument
reads. Its separate diagnostic records 845,091 reads over 50.02 seconds,
with no buffer download required and no read page marked GPU-written in
that scene. Preserve command ordering, including queued draw writes, but
investigate waiting for consumed entries without also claiming scheduler
idleness for CPU-owned arguments. Reuse existing versioned GPU copies only
when current; unknown data keeps the original drain/flush fallback.
Expose the extracted existing copy-validity state to negative tests.
Compare one identical local executable with the experiment disabled and
enabled; do not label that disabled control an untouched upstream package.
An unrelated CI starting before the comparison delays performance phases
without being interrupted. No production engine change is authorized by
the diagnostic alone.

The four retained phases complete normally: the disabled control pools at
22.13 native presentations/s and the enabled variant at 22.51, an observed
1.70% difference over two phases per condition. Retained window coverage is
unequal and front CPU remains about 80% of one logical CPU. Keep the patch
isolated and the installed standard in mode 0. The separate post-phase CPU
sample still attributes 51.5% of front user cycles to waiting for consumed
commands. Back-thread buffer binding and synchronization remain measured
targets, with overlapping call-stack shares rather than additive FPS gains.
Track precise dependencies before removing another barrier; measure physical
GPU work before treating this as a CPU-only limit. An option-disabled boot
also failed before gameplay with the prior Vulkan allocation-error pattern;
the four normal retained runs do not prove that failure fixed. Private ground
save/reload succeeds, but full-world rendering, new zones and precise AV timing
remain unvalidated. Production config and four progress files are unchanged.


On 2026-11-08 the third isolated source prototype measures buffer synchronization
requests separately from real upload traffic: roughly 139,000 requests/s and
74.43 MiB/s over four complete multi-row diagnostic windows. A conservative
CPU-dirty/untracked-page summary skips some clean manager scans while retaining
tracking rearm and cached-write semantics. Five targeted mutants fail and both
full test configurations pass 241 tests, with four network tests skipped.
Four matched-cache mode-0 phases alternate pristine local upstream and the
complete candidate, diagnostics disabled: 22.37 versus 21.34 presentations/s,
an observed 4.61% regression. Do not install the candidate. This comparison
includes summary maintenance and dormant diagnostic branches; it does not
causally isolate the regression to one of them. Six complete Vulkan timestamp
captures validate the diagnostic path, but overlapping intervals and thousands
of added timestamp commands prohibit treating these as an unperturbed per-frame
GPU budget. Prefer fewer pass-level timestamps with an overhead alternation
before declaring either CPU or hardware the sole limit. Keep the installed
standard in mode 0 and retain known mesh omissions as a separate acceptance
failure. The dated plan and report record the next concrete changes and their
required evidence. The user's own game was stopped through the normal worker
lifecycle only after their explicit confirmation, independently of lab saves.


On 2026-11-09 the coarse GPU study begun at 23:25 UTC on November 8 completes.
Keep it isolated and disabled in production. It reuses existing upload/execution
submissions and rotates one guest compute program, sampling one frame in 60.
Four same-binary alternating phases pool at 22.36 presents/s disabled and 21.75
enabled, a 2.74% observed regression whose sign differs between repetitions.
Seven long frames occur in the last enabled phase; do not certify transparency
or attribute every long frame to the probe. The disabled binary retains dormant
branches and native-key lookup, so this is activation overhead only. 64 complete
camera captures show median upload 0.80 ms, execution 24.87 ms and 155 submission
segments. TOP/BOTTOM intervals overlap, contain pipeline effects, and do not
establish an exclusive uninstrumented GPU budget. Count observed and timed
programs explicitly: 128 survey captures missed a frequent program despite 77
observed programs. A forced target is absent in the saved ground view and the
negative assertion rejects that run; seven actual balcony samples later measure
it at 0.039 ms median. One rare original-scene program remains unmeasured. Guest
program windows are not exclusive shader costs and do not identify internal
emulator compute passes. Investigate small submission/dependency and binding
costs without dropping GPU writes, CPU readback waits, presentation or shutdown
flushes. No 60 FPS claim or new speed patch follows from this diagnostic alone.
The final engine passes 241 tests in each flag configuration with four network
skips; four deliberate mutants fail. Private ground save/resume and stereo
signal pass; no zone or precise AV check is claimed. All eight production
progress files and installed config remain unchanged, own devices/containers
are removed and the system observer is restored. No commit, push or remote CI.

## Per-title Switch 2 engine selection, 2026-11-10

The qualified Zelda candidate keeps the existing room adapter and capture.
An optional `engines_by_title` table selects exactly `image`, `engine` and
`revision` for a validated base title. `main` resolves one copied configuration
before both `launch` and `serve`, so the helper image, engine image, executable
mount and revision cache agree. Other titles keep the global engine triple.
Every configured entry must be complete and valid; state, controllers and
display settings cannot be overridden through it.

Reason: the existing global Switch 2 configuration also serves Mario Tennis,
which has not qualified this Zelda profile. The real-entrypoint filesystem
test first receives the old image for Zelda, passes after selection, and fails
again when selection is deliberately disabled. It also proves the unconfigured
title retains its engine and cache while both use the original state root.

This is selection infrastructure, not approval of constant 30 FPS. The private
browser trial completes 90 seconds of requested movement but its complete WSI
windows contain one 113.149 ms interval. A separate visit reaches an unnamed
interior without proving new-map loading performance. Keep the candidate's
exact profile and diagnostics until a changed configuration is qualified.
Preserve a pre-activation NAND copy: restoring an old engine does not establish
save-format compatibility. No remote CI result is inferred from the local gate.

The following isolated real-room trial exercises the actual per-title routing
and installed package before activation. Both helper and engine use the pinned
image, the selected revision cache and the private save root; 141 settings pass
before and after 90 seconds of browser-origin inputs. Complete WSI windows
average 29.3054/s, maximum 65.824 ms, without proving constant 30. After cleanup,
22 NAND files from two slots are backed up and eight progression hashes remain
unchanged. Only Zelda's engine triple is activated atomically for future starts;
the legacy global triple remains and no live room is restarted. Evidence:
`spikes/switch2-room/title-profile-installation-2026-11-10.json`.

### 10 November 2026: imported saves and account ownership

Complete-save availability is filesystem evidence, queried through the worker's
read-only `/saves` route in catalogue order. A directory named `debloquee` is not
evidence: Zelda created ordinary progression there. `unlocked.json` records an
explicitly qualified import and its payload paths. The reader requires every
payload to remain a nonempty regular file inside the slot. It rejects malformed
receipts, unknown versions and symbolic links. It does not infer completion flags
for arbitrary game formats. The import tools write the receipt; ordinary play
never does. The lobby rechecks availability before preparation and launch, and
the worker rechecks before acting on an unlocked choice.

For an authenticated account, codes 0 and 2 use the same personal slot. Code 0
requests a new game once, moving previous progress into history; code 2 resumes
without resetting it. Code 1 remains the shared imported save. Anonymous launch
keeps the existing shared fresh slot. Only the lobby's authenticated login names
a personal slot. A readable prefix plus the full SHA-256 identity digest replaces
the lossy name alone: two distinct logins with matching cleaned punctuation were
shown to collide in a failing test on 10 November.

Personal Dolphin storage is common to the numbered rooms, with a lock for each
game and identity. The Docker helper mounts only the selected account's payload
onto its ordinary path below the room's existing `saves` directory. This retains
the invariant that card/NAND links remain visible inside the container, and keeps
direct persistent writes. There is no exit-time copy back to lose on a crash.
Switch adapters already use shared title storage. Their personal slots use the
same identity key and one-shot new-game action. Legacy migration retains source
directories and requires a unique match to a known authenticated identity.

## Lobby doors, 2026-11-21

Four decisions close the control-plane findings of the 2026-11-20 audit. The
logbook entry « 21 novembre : fermer les portes du salon » tells the tests and
what each one showed on the previous code.

**Writes carry the page's origin.** One FastAPI dependency, `same_origin`, is
attached to the application rather than to each route, so a route added later
inherits it. It lets reads through. A write needs exactly one `Origin` listed
in `NEL3AB_ORIGINS`, the same list the lobby socket uses, and, when the browser
sends `Sec-Fetch-Site`, the value `same-origin` or `none`. Rejected: a guard per
route, because a later route can forget it. A test walks the effective routes
and fails on a write without the guard. Consequence: a non-browser client that
writes must send a listed origin, and local Vite development must add its own.

**Closing a room is the chief's decision.** Opening needs any identity. Closing
needs the chief of that room or `NEL3AB_ADMIN`: 401 without identity, 403
otherwise. An empty room has no chief; only the administrator closes it before
the automatic close. Rejected: letting anybody close an empty room, because a
chief reloading a page leaves it empty for a moment.

**A room controller carries its number.** `describe` reads presence under the
controller's own number, `Salons.poser` refuses a controller born for another
room, and the retained chief is kept per room. The room number became a
required parameter where it defaulted to room 1 or to every room.

**Public payloads carry an opaque mark, never a login.** `Person.login` is
replaced by `id`, the first 16 hex characters of HMAC-SHA256(login) under a
32-byte machine secret stored beside the nicknames, and `moi`, computed for each
receiving socket and each `GET /api/room` request. Rejected: a bare SHA-256 of
the login, which anyone can recompute from a guessed address. Cost: one copy of
the room state per page, measured at 71 µs per page on a synthetic 60-game room.

**Remaining, D14:** identity still trusts whatever reaches the loopback port,
header or forwarded address. A local process can claim any identity,
including the administrator's. The topology is unchanged on purpose; a Unix
socket reachable only by the proxies, or a proxy-held secret, are candidates
that have not been tried.

## Switch titles read by the game import, 2026-11-21

The import (`/importer`) registers a Switch base game by writing its
`<file>.nel3ab.json` sidecar. The logbook entry « 21 novembre : la Switch se
range aussi » tells the tests and the check against the real library.

**The lobby reads one line of the console's keys.** The title identifier sits
in each NCA header, encrypted with the console's header key. The lobby takes
the path of the private `prod.keys` from `NEL3AB_SWITCH_KEYS`, with no default,
and reads only its `header_key` line, each time an upload is finished. The key
stays in memory, inside an object whose representation omits it, and no
message quotes a value read from the file. Weighed: the lobby is reachable
through the proxy, but it already runs as the account that owns `prod.keys`.
Code running inside the lobby could read the file anyway, so holding the line
adds no access; what must not happen is the key leaving through a response or
a log. Rejected: a separate process holding the key, because it would add a
second service for no access the lobby lacks; Docker, for the reason the import
already gave (a Docker client is root in practice).

**Two checks prove the key and the bytes.** AES-128-XTS over 0x200-byte
sectors, sector number big-endian, decrypts only the first 0xC00 bytes of each
NCA. Every NCA must show « NCA3 » or « NCA2 » and announce the exact size of its
container entry, or the whole file is refused. The Meta NCA's identifier then
decides: base game (low 13 bits zero), update (plus 0x800), add-on (plus 0x1000
and an index). Anything else, several games in one file, or a base without its
Program NCA stays « à confirmer ». The CNMT body, which states the type itself,
needs another key and is not read.

**A base title is registered once.** A title already registered by a sidecar
lying beside its game, or listed with a game in the rooms' catalogue (D24), is
refused as a duplicate: saves are keyed by title. The
sidecar is written before the game, under a provisional name, then linked
without replacement; it is removed if the game link fails, compared by an
inode still held open. `consoles/fiche-switch.json` is the contract: the Python
test compares the lobby's output to it, and an `emulator::switch` test passes
it to `registered`.

**Not done:** updates and add-ons stay in quarantine with their own state; the
game's display name comes from the file name, since the NACP title needs
key-area or title-key decryption; the key generation is reported, not compared
with the keys the room holds.

## One address, and import rights given from the page, 2026-11-21

The owner asked that everything go through `nel3ab.app`, and that he choose
from the interface who may upload games. The logbook entries « 21 novembre :
donner la clé du quai depuis la page » and « 21 novembre : une seule adresse »
tell the tests and the measurements.

**The `.ts.net` doors only redirect.** tailscaled still terminates TLS on
`:8443` and `:8444`, but proxies them to two loopback-only Caddy sites that
answer 302 to `https://nel3ab.app{uri}` and `https://nel3ab.app/docs{uri}`.
The path follows, so a deep link lands in place. The `.ts.net` origin leaves
`NEL3AB_ORIGINS`: no page is served from it, so it has no reason to write.
Rejected: switching the doors off, because old links would then fail without
saying where the room went; a 301, because browsers keep it forever and
undoing it would need every visitor's cache cleared. Cost: the door that
needed no upkeep is no longer a fallback if the certificate renewal breaks;
the Caddyfile states the one command that reopens it.

**Three sources of the right to upload, one editable.** The administrator and
`NEL3AB_IMPORTEURS` keep theirs. The page adds and removes only the addresses
it named, stored in `NEL3AB_IMPORTEURS_FILE` (mode 600, written before the
answer, read once at start). The page shows the first two without a button,
and the API answers 409 rather than pretending to remove a right that comes
from elsewhere. An unreadable file grants nothing and is never overwritten:
writes answer 503 until it is repaired by hand. Rejected: making the file
replace the environment list, because a typo in the page would then lock out
a right the owner wrote on purpose; replacing an unreadable file as the
nickname store does, because a right lost in silence does not show.

**The list comes from tailscaled and from the lobby.** tailscaled's local
status names every account with a device that can reach this machine;
`ShareeNode` marks guests of a share, and tagged devices are left out. The
nickname store adds everyone who already came. The list shows addresses, so
only the administrator may read it (401 or 403 otherwise), and the global
origin guard covers its writes.

## Xbox 360 room, 2026-11-21

The owner asked to play the Xbox 360 and to test it himself, with every
capture and measurement needed to improve it. The logbook entry « 21 novembre :
la Xbox 360 devient jouable » tells the research and the tests;
`docs/xbox360.md` is the operating note.

**An adapter of the Switch room, not a new room.** `docker/xbox360-room.py`
hands an `EngineLaunch` to the shared `serve()`: same image (by digest), Sway,
capture, PulseAudio sink, four virtual Xbox 360 pads, stop order. Xenia Edge
`01ca7a5` is installed outside the repository, unpacked without execution and
its AppImage checked against the published hash. Rejected: a dedicated image,
because the Switch image already ran Sonic to its intro on the Radeon, and a
new image would have to repeat the pad-helper proof the rules require.

**Registered by sidecar, with the title of the disc's `default.xex`.** The
importer walks the XDVDFS directory tree to the executable and reads the
title from its execution header (8 hex digits). `Console::valid_title` gives
each family its own title shape; the 16-digit Switch rule had been written in
four places. Only whole discs (`iso`) are registered: a lone `default.xex`
lacks its game, and Games on Demand packages span several files the upload
does not keep together. A game left in quarantine before its console became
playable is re-examined in place (`imports/reexaminer.py`).

**Four profiles written before the first launch.** Without a signed-in
profile Xenia shows a modal « No Profiles Found » over the picture and delays
full screen; no option removes it. The adapter writes four offline `Account`
files encrypted exactly as Xenia's `EncryptAccountFile` (HMAC-SHA1, RC4) and
signs them into the four slots. The key is a console key published in
Xenia's code; it stays out of the repository in a 0600 file the configuration
names, like the Switch keys. Rejected: shipping the key in the repository,
which is public; asking players to click « Create profile », which the stream
cannot do.

**X stays left and Y stays top.** The pad helper gains a layout chosen by the
adapter. The Switch keeps its swap for Ryubing's profile; the Xbox 360 sends
the page's X as BTN_X, which Xenia's SDL mapping (pinned by
`--mappings_file`) reads as the left button.

**Measured by design.** Xenia prints no frame rate, but prefixes every log
line with the count of frames the game presented. `--guest_scheduler_stats`
adds one line per second; `spikes/xbox360/xenia.sh` timestamps every line,
and `just xbox360-releve` turns them into frames per second per window. A
screenshot every 30 s lands in the save slot. The black box knows Xenia by
its kernel name, `xenia_edge`. No lock yet: it waits for the measured cost.

**Amended the same evening: X11 through Xwayland, full screen by Xenia.** The
first game kept 59.5 game frames a second while the picture stopped after
40 seconds; one resize showed one new frame. Under Wayland, Xenia Edge routes
every frame through a UI-thread paint request (`presenter.cc`), and
`WxWindow::RequestPaintImpl` stores the GLib idle-source id in a plain field
both threads write: if the UI thread runs the request before the GPU thread
stores the id, the stale id blocks every later request. The code is unchanged
at Edge's head of 2026-11-21. Under X11 the GPU thread presents by itself
unless an ImGui drawer is on screen, so the Xbox 360 room starts Sway with
`xwayland force` (`NEL3AB_SWAY_X11=1`), runs Xenia with `GDK_BACKEND=x11`, and
turns achievement notifications off. Sway no longer forces that window full
screen: a compositor-forced state makes wxGTK's `ShowFullScreen(true)` return
before it hides the menu bar. Rejected for now: building Edge with the race
fixed, which would make this project the maintainer of an emulator build; a
watchdog that resizes the window, which the experiment showed yields one
frame. Measured the same evening: 12.5 minutes under X11 with no
`capture_quiet`, a median of 60 delivered frames a second, a 1280x720
immediate-mode swapchain with no menu bar, and Xwayland at 4 CPU seconds in
14 minutes. One game, one player.

**Amended 2026-11-22: no longer marked experimental.** At the owner's request,
after the 12.5-minute Sonic game under X11 of 2026-11-21. `consoles/consoles.json`
sets `experimental: false` for `x360`, and `Console::experimental()` now
matches the Switch 2 only. The flag had four readers: the page's folder label
(« (expérimental) »), the crate's const fn checked against the manifest (D22),
the lobby's `ConsoleVue.experimental` on `/api/me/sauvegardes` (not displayed)
and the importer's console view (read by nothing). Nothing greyed a menu or
refused a launch because of it; that is `playable`. The note repeated the
status in words, so it was rewritten, and a page test refuses the word in any
manifest label or note: the status lives in the flag alone. The note was then
cut to 41 characters (« gâchettes tout ou rien, à-coups possibles »): at
90 characters the rendered menu truncated it just before the unproven part.
Unchanged: no lock; two Xbox 360 rooms together, or one beside a Switch room,
have not been measured. Weighed: keeping the mark until a four-player evening.
The owner chose one game; `docs/xbox360.md` lists what that game does not prove.
