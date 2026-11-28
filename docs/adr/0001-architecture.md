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

Amended on 2026-11-23 by D39 (step 4): a room held in hand gives the pad its
own box outside the picture (under it upright, two side clusters sideways),
sized from `placePad` itself (`encombrement`), and the page gesture is
« La salle », placed among the keys only when the bar is missing. The
overlay placement below survives only for a pad forced on at a fine pointer.
Amended again the same day (D39, pass 6): it no longer survives. The owner's
rule has no exception (nothing on a live picture), and a pad forced on at a
fine pointer put eleven pieces on the picture at 1280×720. The frame now
reserves its place at a fine pointer too: one cluster in a band on each side
of the picture, or the upright pose under it, whichever leaves the larger
picture (`manetteALaSouris`).

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

Amended 2026-11-24 by D40. The one link state and its media-layer rule stay;
the « one place on the picture » does not. The state is now said off the
picture (a pastille, a sheet in the column or the phone's sheet, the
cabinet's full frame when there is no picture at all), and what covers the
picture is lifted by the paint loop on the first painted image. The banner
became the sheet, the curtain the full frame; the frozen, banner and arrival
thresholds above are unchanged.

Amended 2026-11-24 by the room (D39), with the state's paragraph (D40), at
the end of the room's track. The « one place » is now a place of the room's
frame, never on the picture, and the frame names it (`emplacementPastille`,
`lib/cadre.ts`; `placeDeLaPastille`, `lib/etat-place.ts`). A black band of
40 px or more takes the pastille first (the band above the picture, then the
right one). On a desk, the control panel under the picture comes next: the
pastille sits on it, before « Toutes les touches ». Otherwise it joins the
notice stack, at the head of the column. On a phone held upright without a
band, the room bar has a slot between the room name, which is always read
whole, and « La salle »; it needs 120 px, so a 375 px phone gets 138 px and
a bar without them gets nothing. Upright and short (390×664, 375×548 in
4:3), there is still no bar and no band: the spoken line says the state.
The state's paragraph: the pastille, the sheet in the column or the phone's
sheet and the cabinet's full frame keep their D40 rules; the loading
failure says to the person who chooses the game « Tu peux le relancer ou
choisir un autre jeu. », and to others who can relaunch it (decided by the
site lead, taking back the words the menus workstream had written). The 15 s end of arrival counts from the session start; the
browser proof (`arrivee-sans-image`) now counts from the full frame's
appearance and accepts the gestures between 12 and 18 s after it, because
the lobby's entry transition starts the arrival 0.5 s after the click.
Weighed for the phone: covering the room name and leaving it to screen
readers (what the pastille did until this amendment, ruled out by the site
lead), and shrinking « La salle » to its icon to give the pastille more room
(a change to the owner's gesture, not made).

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

#### D30 amendment, 2026-11-24: one room menu, not modal, never on a visible picture

Amended by the menus work of the retro theme (K21 of its partition), for the
menu, the key settings panel and the place cards. Points 2, 3 and 4 above are
replaced; point 1 stands.

The three menu shells (the PlayStation 3 cross, the Wii channels, the Switch
home row) are retired with their `nel3ab:shell` key, which the page now erases
at start. One menu (`components/menu/Menu.tsx`) has four tabs, Jeux, Manettes,
Salle and Réglages, and full-width lines. Its pure half (`lib/menu.ts`) says
what each line draws (fiche, choice, slider, switch, disclosure, action), how
arrows move and where the menu goes.

Decision:

1. **The menu is a `<section id="menu">`, not a dialog.** On a desktop it takes
   the place of the column's rows (the role, people and panel blocks step
   aside while it is open; the place cards stay). Held in hand it is placed
   below the picture, or in the wider side band in landscape
   (`placeDuMenu`). The picture keeps its rectangle and nothing covers it.
   A landscape 16:9 picture leaves two 75 px bands: the menu then falls back to
   the room sheet's rectangle, which covers the picture's edge, and says so
   with `data-sur-image="oui"`. That case is a known defect for the room frame
   to settle. (Replaced the same day by the addendum « after the review »
   below: the fallback covered 42 to 48 % of the live picture, not its edge;
   the menu now takes the screen's place and hides the picture meanwhile.)
2. **Focus.** Opening puts focus on the first line. The cursor is the focus,
   with a roving tabindex inside the panel: one control has `tabIndex` 0 and
   its line carries `aria-current`. Up and down move between lines without
   wrapping; left and right change tab, except on a radio or a range, which
   keep them. Escape closes a fiche, then the menu. A `focusin` inside
   `[data-zone-jeu]` (a click on the picture, or Tab reaching it) closes the
   menu. On close, focus goes to the game zone during a game (point 1) and
   back to the opener otherwise.
3. **Decisions open a fiche inside the panel**: launching a game on a save,
   closing the game, closing the room. The fiche states the consequence above
   the button that acts, and a second button returns without doing anything.
   A refusal or notice born from a menu gesture is written inside the menu
   (`avis`), so `Surcouche` is no longer needed above the menu.
4. **Pad and footer.** The pad drives the same focus through
   `input.setMenu`; A activates, B goes back, Start returns to the game
   (`menupad` now reports `jeu` for Start). The footer appears only after a
   first keyboard or pad use: « ← → rubriques, Échap revenir au jeu » or
   « A valider, B revenir, Start au jeu »; none by touch.

Weighed:

- A dialog laid inside the column (the room frame's proposal). Rejected:
  `showModal()` makes the rest of the page inert, including the picture's
  zone, so a click on the picture could not return to the game.
- Keeping `showModal()` and shrinking the dialog to the column's rectangle.
  Rejected for the same reason, and because the place cards and the state
  block would have needed `Surcouche` again.
- Keeping the three shells as a setting. Rejected by the owner with the
  « Scotch et feutre » proposal: each shell indexed its selection on its own
  geometry, and three keyboard models had to be kept in agreement.

Consequences. The menu is no longer modal: Tab can leave it, into the column
or the picture, and the arrows do not wrap. `Surcouche` stays for the
preparation status outside the menu. The loading screen lost its « ouvrir le
menu » button; « Menu du jeu » in the column opens the menu beside it. A
desktop room whose column was folded by Ctrl unfolds it while the menu is open
and folds it back on close. Proof: `menu-en-colonne`, `une-seule-forme`,
`refus-dans-le-bloc`, `curseur-focus`, `aides-clavier` and `aides-manette` in
`just focus-navigateur`, `chargement-menu` in `just etats-navigateur`,
`fermer-salle` and `menu-chef` in `just parcours-navigateur`. The page lost
5 139 bytes in brotli 11 (281 760 to 276 621).


#### D30 addendum, 2026-11-24 evening: the idle room shows its games

The idle screen (`EcranEteint`, K23) now holds the library: one row per
console, one cartridge per game, its label being the game's art
(`components/Rayonnage.tsx`, `lib/bibliotheque.ts`). A cartridge opens the
game's fiche in place of the rows. The fiche is the menu's own
(`components/menu/Fiche.tsx`), with an id prefix so that the menu and the
idle screen can each hold one open on a desktop.

1. **Focus.** On entry, the chooser's focus goes to the first cartridge
   when nothing else has it. Arrows move between cartridges without moving
   anything; Enter opens the fiche with focus on the checked save; Escape
   closes it, returns focus to the cartridge and stops there, so it does not
   also open the menu. Escape without an open fiche still opens the menu.
   The pad drives the same focus through `input.setMenu` while the menu
   does not hold it.
2. **Saves and identity are read while idle**, not only while the menu is
   open; otherwise every fiche of the idle screen stayed disabled.
3. **What follows « Lancer »** is computed like the lobby's
   `Preparation.directe`, from the manifest's `devices` and `players`.
   Someone who does not choose reads the fiche without the button that acts.

Weighed: the fiche beside the rows on a desktop (the proposal). Deferred:
replacing the rows keeps one focus model for every size, and the side
layout needs the frame's measures.

#### D30 addendum, 2026-11-24 night: the preparation is a block, not a dialog

The multiplayer preparation left the keys dialogs (`Bindings`,
`SwitchBindings`) for a non-modal block, `#preparation`
(`components/Preparation.tsx`), for every console.

1. **Where.** Under the column header on a desktop (`Colonne`'s
   `preparation` prop), and in the expanded sheet of a hand-held room; the
   band of a hand-held room says who launches which game, and « Choisir ma
   manette » opens the sheet. The menu open in the column hides the block,
   like the role block.
2. **Input.** The block does not hold the game's input: only the keys
   panel, opened by « Essayer mes touches » (`ouvrirReglage`), blocks
   gameplay. « Plus tard » and the watching overlay are gone, since nothing
   needs to be put aside.
3. **Speech.** The room's spoken line stays the only polite region: a
   player who becomes ready is said once; the chief's countdown is silent;
   a refusal is written in the block, said, and plays Aïn's « refus » scene
   through the arbiter.
4. **Closing a game** is a state of its menu line and fiche
   (« fermeture… »), no longer a message in the error notice.

Weighed: a panel replacing the touch pad on a phone (the proposal, P8).
Deferred: the sheet already carries the column, and the band keeps the pad
mounted. `Bindings` and `SwitchBindings` are no longer mounted by the room;
their removal belongs to the controllers workstream.

#### D30 addendum, 2026-11-24 late night: the loading screen and the room section

1. **Loading steps** are three 22 px pixel boxes computed by
   `etapesAffichees` (`lib/booting.ts`): done, in progress with a counter
   written by the socle's digit display outside React, to come, unknown
   (« ? ») past the long-wait threshold, and failed (« ✕ ») when no picture
   came. A done box never goes back.
2. **Loading gestures depend on the role** (`gestesDuChargement`): none
   during a normal wait; past the threshold, whoever chooses the game can
   stop the launch (`closeGame` on the requested index), and, without a
   picture, choose another game; everyone can report. The report button is
   the people workstream's `Signaler`, and the column hides its own while
   the loading screen carries one (K25: never two on screen). « arrêter
   d'attendre », which removed the screen without stopping anything, is gone.
3. **Who launched, on which save** (`sauvegardeDuLancement`): the launcher
   reads « Sur ta sauvegarde. », others read the launcher's typed label at
   their seat's colour, and an unknown launcher falls back to the lobby's
   words without a label. The spoken line names the game and the crossed
   threshold; the counter never speaks.
4. **The start-up test card** is visible at every level, static; at
   « tout » one bar lights at a time, one step per second (K14), overriding
   the socle's 0.3 s offsets in `components/chargement.css`. The socle's
   tube layers sit inside `#booting`, under an opaque text plate.
5. **The room section** is built by `lignesSalle` (`lib/rubriques.ts`). Its
   head says who chooses the game with their label (`Rubrique.tete`). On a
   desktop the menu replaces the column's ranks, so `Signaler` becomes a
   line of the section (a « composant » line, the same component); a
   hand-held room or a speaking loading screen does not repeat it.

Weighed: a separate `RubriqueSalle` component, as the plan proposed. A pure
function of lines keeps the section testable without React, like the
controllers section, and the menu renders both the same way. Deferred: the
« coupure » snow on a game change waits for the states workstream's snow;
the « fier » scene for « all ready » is not in this workstream's arbiter
list, so « pret » in « tous » mode stays.

#### D30 addendum, 2026-11-24 end of night: the card beside the rows, and sticky bars

1. **Every card opening rereads the saves and a missing identity.** At rest
   the shelf stays on screen, so `/saves` and `/api/me` were read once on
   arrival. A read now carries a key (menu or rest, plus the card count);
   an answer for another key is ignored, so no render shows a stale choice
   as safe. While it reads, the card's choices are disabled and the focus
   waits on its title, then moves to the checked choice unless the user
   moved it. `save-options.mjs` drives the shelf and the menu.
2. **On a desktop the card sits beside the rows** (`cote`, from
   `modeSalle === "bureau"`); the rows stay visible and keyboard and pad
   still move between cartridges. On a phone, in landscape and in a narrow
   window, the card replaces the rows.
3. **Sticky bars never cover the focus.** The preparation's gesture row
   sticks above Aïn's corner and « Plus bas » (D46); a choice that takes the
   focus under that row scrolls above it, on focus and after every render,
   with a margin equal to the row's current height. A pastille is
   positioned, so its hidden absolute radio no longer belongs to the column
   and no longer stretches its scroll area.

Weighed: a fixed `scroll-margin` alone (the browser's focus scroll does not
move an element that fits in the column, even under a sticky bar), and a
column-level padding in `Colonne.tsx` (another workstream's file, and the
row's height varies from one to three lines). Not taken: the « ouvre » and
« fier » scenes, which the partition's scene table gives to the lobby and
to the controllers and room workstreams.

#### D30 addendum, 2026-11-24, after the review: never on a visible picture

An independent review of the menus work found seven defects; four change
what this entry says.

1. **No menu on a visible picture.** A phone held sideways with a 16:9
   picture and the Pro touch pad (Switch, Switch 2, Xbox 360) leaves two
   148 px bands, below the 150 px a menu needs (`BANDE_MIN`); without a touch
   pad, two 75 px bands. The fallback laid the menu on the sheet's 380 px:
   measured on the bench, it covered 42 % of the live picture at 844×390 and
   48 % at 780×360, while the page painted 60 pictures a second under it, and
   « La salle » (with Aïn's head) sat on one of its lines. The rule of the
   owner (K20: never anything on a live picture) applies to the menu too.
   `placeDuMenu` now tries a side band first, the left one, cut above or
   below « La salle » and the player's label; with none readable (150 px
   wide, 200 px high) it takes the screen's own rectangle (`lieu: "ecran"`)
   and the picture hides there for as long as the menu is open
   (`data-image-sous-menu`, `visibility: hidden`). The picture keeps its size
   and its pixels, the media loop keeps painting underneath, and closing the
   menu shows it again. A spectator's line says so (« Elle revient à la
   fermeture »). The menu's marker is its own: the snow of a lost connection
   sets and clears `IMAGE_CACHEE` of the socle, and the end of one must not
   show a picture the other still hides.
   **Owner decision, 2026-11-25:** accepted as is. On a phone held sideways
   with a 16:9 game, the open menu takes the screen and hides the picture
   until it closes.
2. **A greyed control never keeps the focus.** A fiche aims at its checked
   choice, then its acting button, then « Revenir », only if they take the
   focus; while it reads its saves, the focus waits on its title and moves
   to the checked choice when the answer comes. When « Fermer le jeu » turns
   to « Fermeture du jeu en cours… » under the focus, or the fiche's line
   leaves its tab, the focus goes back into the menu. Before, it fell on
   `<body>`, where Escape did nothing.
3. **The focus ring is whole.** `#menu` scrolls, and a scroll box clips what
   overflows it: the ring (3 px, 2 px outside) lost both sides of every
   full-width line. The menu now keeps 5 px of padding, and the shelf's
   rows too (a cartridge lost one pixel).
4. **« Plus bas » inside the menu** (M11). The menu scrolls in its own box,
   so the column's marker never saw it: Réglages hid eight lines at
   1280×720. The menu has its own sticky marker, outside the tab order.

Weighed for point 1: shrinking the picture to free a band, as the desktop
column does. Rejected: this entry promised that the picture keeps its
rectangle when the menu opens, a resize on every opening moves what the
others watch on that screen, and the room frame (`lib/cadre.ts`) belongs to
another workstream. Covering the picture and saying so (the first version)
is what the review refused.

Also from the review: the effects of the plan now run. A new refusal shakes
the block that writes it at the « tout » level (`secouer`); « Fermer le
jeu » plays the `quitter-partie` transition (iris) on the menu; the page of
whoever closes the room leaves only after the `fermer-salle` transition
(extinction) ends; the shelf's rows have a dithered plank, the pixel arrow
marks the shelf and an idle room's menu, and an open card's cartridge
stands out by 4 px. The Jeux and Réglages tabs, the game card, the saves'
reading key and the column unfolding moved out of `App.tsx` into
`components/menu/`.

Proof: `menu-en-colonne` (a 16:9 view on a second bench), `fermeture-en-cours`,
`anneau-menu` and `plus-bas-menu` in `just focus-navigateur`, red on the
reviewed page cd2d5b3 in `just focus-navigateur-rouge`; `fiche-a-cote` in
`just parcours-navigateur`; the menu of `salle-telephone` now also opens on a
16:9 picture.

**Amended 2026-11-24, at the wave B2 integration: the label the menu avoids.**
The room workstream replaced `Geometrie.etiquetteManette` (a rectangle under
« La salle ») with `Geometrie.etiquette: LieuEtiquette | null`, where only
the `cote` place carries a rectangle (`fente` lives in the pad, `bande` at
the head of the band). `placeDuMenu` read the old field and threw on
`undefined` when the menu opened lying down; four `menu.test.ts` tests went
red at the merge. The menu now avoids the `cote` rectangle, the case the old
field described; a mutant that ignores it turns the lying-down sweep red.
Whether the menu may cover the label in the band is not measured.

Amended 2026-11-24, end of the room's track: it is now. The frame gives the
band label its rectangle too (`LieuEtiquette` « bande », `BANDE_BORD`, the
band's 8 px and 12 px edges read back from `telephone.css` by a test), and
`placeDuMenu` avoids it like the side label. Today's geometry never puts
the two together (the band exists only when the picture spans it), so a
constructed case proves the avoidance, and `salle-telephone`
(`menu-etiquette`) measures the label's letters with the menu open at six
lying-down sizes, with a twin that pushes the label under the menu.

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
for every console and the pad-only hint (mode removed by D47) « 13,6 Mbit/s » (a Dolphin p95 from
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

Amended on 2026-11-23 by D39 (step 4): the drawer and the bottom sheet are
one `FeuilleSalle` with two heights, opened by « La salle » in the room bar;
the mode comes from `modeDuCadre` (`useEnTiroir` is gone), and a fine
pointer below 900 px puts the column under the picture instead of in a
drawer. The safe-area tokens are kept and subtracted by the frame.
Amended again on 2026-11-24 by D39 (end of the room's track): « Touches et
manettes » no longer opens in the enlarged sheet, which covered the picture;
the frame gives it its own place beside the picture, and the sheet closes
when it opens.

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
- (Removed by D47, 2026-11-27.) A pad-only page is never veiled by loading: its loading clears when the lobby
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

Amended 2026-11-24 (manettes, the key settings). Held in hand, the
"Touches et manettes" panel is not a layer of the room sheet: the frame
gives it a rectangle of its own (`Geometrie.reglage`), below the picture
held upright and right of it held sideways, and opening it closes the
sheet. The touch pad is not mounted while it is open, and its place goes to
the panel. The sheet at mid height carries a "Touches et manettes" entry
after the game menu only when its row fits: three rows of two entries fit
in `FEUILLE_MI_MIN`, and each extra row costs 80 px, measured at 390 × 844
(a fourth row took the content from 275 to 347 and 353 px; `lib/feuille.ts`).
Held sideways, its single column would scroll, so the entry lives at the
head of the whole room's column, as the clip already does.

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

**Amended 2026-11-25 (final review of the retro theme): the Dolphin session
folder.** Dolphin's session folder is mounted read-write in its container
(D45). The worker wrote its own choices there with `std::fs::write` and read
them with `read_to_string`, both following links: `chosen-rom`, `chosen-pad`,
`chosen-save`, `chosen-person`, `chosen-setup`, `game-closed`,
`personal-save-mount` and the new-game request. A link left at one of these
names made the worker overwrite a host file with a game name or a person's
address; a named pipe at `chosen-setup` or `chosen-pad` blocked its start
after the lobby had already answered 201. `open_on_order` (D17) had added a
trigger at start and a new read. All of them now go through
`nel3ab_emulator::session_file`: a fresh provisional name created with
`O_CREAT | O_EXCL | O_NOFOLLOW` from the folder's descriptor, renamed over
the wanted name (`renameat` replaces a link or a pipe instead of following
it); reads with `O_NOFOLLOW | O_NONBLOCK` that accept only a regular file of
at most 4 KiB, anything else read as absent, and the new-game request
refused as damaged. Proof: three worker tests (links to seven names, a link
at `game-closed` when the order names a missing game, pipes at four names
under a 3-second deadline), each red on the code before, with the choices
still written as regular files; `personal`'s request test with a link and a
pipe. Not reviewed: the save folders Dolphin writes under `saves/`, and
`personal::mount`'s `create_dir_all` there.

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
- **The catalogue is read through the room folder's descriptor too (D36).**
  `catalogue.read_one` opened `salles_dir/N/catalogue.json` by path, which
  follows a link and blocks on a named pipe, and the Dolphin container mounts
  that folder read-write. The defect predates this track (the catalogue route,
  imports and the profile read the file that way), but this track added three
  readers, among them the list that the lobby page re-reads every five seconds
  without an identity. An independent review on 2026-11-23 showed the list
  titling the last game from a file outside the room folder, and
  `SallesController.etat()` never returning, one thread held per call.
  `read_one` now takes `salles_dir` and the room number and reads through
  `session_salle.dossier` and `session_salle.lire` (`O_NOFOLLOW`,
  `O_NONBLOCK`, regular file only, 8 MiB), so every caller of `freshest` is
  covered, and a room folder that is itself a link is refused. A catalogue set
  aside is logged with its reason. Proof: a link at the file, a link at the
  room folder and a pipe, each with its ordinary twin, at `freshest`; a link
  and a pipe at the list. All five were red on the code before; the pipe tests
  run the call on a thread bounded at five seconds and then open the pipe's
  write end, so the red run fails instead of hanging. Three mutants of
  `session_salle` (no `O_NONBLOCK`, no `O_NOFOLLOW` on the file, none on the
  folder) each fail only their named tests.
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
- **`Emplacement.cle`** gives a personal save slot the key of its game when
  the catalogue links it (Dolphin folder key, or a registered title id), so a
  page can say whether « my save » exists for the game it shows. An unlinked
  slot has none.
- **`POST /api/salles` takes an optional body `{numero}`** (D17, first part).
  A named room is opened, or refused with 409 when it is not closed (open, or
  restarting), 404 when it is not a room; it is never replaced by another
  room, since « reopen room 1 » that opened room 2 would split a group. No
  body keeps the old behaviour. Opening directly on a game (`cle`,
  `sauvegarde`) was left out of that first part: the worker also reads
  `chosen-pad`, the per-game pad setup and a pending new-game request written
  by `remember_choice`, and a room started with only `chosen-rom` could boot a
  Wii game on the wrong controller or replay a stale new-game request.
- **Opening on a game is an order the worker follows (D17, second part).**
  `POST /api/salles {cle, sauvegarde}` (both or neither; `sauvegarde` 0 or 2,
  since only a running worker can check that « all unlocked » has its import)
  writes ONE file, `ouvrir-sur`, next to `game-closed`, both through the room
  folder's descriptor without following a link. The worker takes it at start
  (`nel3ab_emulator::take_open_order`): it removes the file first, so a crash
  cannot replay it over a later choice, then resolves the key against its own
  scan and hands it to `remember_choice` with the pads this room kept for that
  game. That one function still writes the whole set. A key the scan no longer
  has keeps the room on its menu, never on `settings.rom`; the lobby refuses
  it earlier too (422), reading the freshest catalogue just before the start.
  A Switch-group game is refused (409) while another room holds the Switch.
  The identity is the proxy's, bounded like the launch line (64 bytes, no
  blank). « Blank » is Rust's `char::is_whitespace`, the set the worker
  applies to both the order and the launch line (`personnes.BLANCS_RUST`), and
  both lobby checks count bytes. After systemd accepts, `RoomController.lance`
  journals the launch and starts the startup clock, as the two socket paths
  do. `game-closed` stays set with the order: a worker from before this
  change ignores the order and
  opens on its menu. An order left by a refused start, an older opening or a
  closing is removed by the lobby. The order's text is pinned on both sides,
  and its read bound (512) is measured against the longest legal order (339
  bytes). The worker follows the order BEFORE it reads the playback state and
  the chosen game, in one function (`starting_game`) that a test pins: in the
  other order the room would read the `game-closed` marker the lobby set, and
  open on its menu.


### D39: The room frame, and nothing on the picture, 2026-11-23

Status: partly delivered on `chantier/retro-salle` (passes 1 to 5).
Amends D28, D29 and D35 when the steps that change them land; until then
those entries stay in force, except where this entry says otherwise.

Until 2026-11-23, seven layers sat on the game picture or took height from
it: the top-of-picture notice stack (controller plugged, room closing, keyboard
paused), the reduced-picture notice, the 30 % corner buttons of a folded
column, the touch pad (D28 allowed it onto the picture when the black bands
were too narrow), the link state (D29 drew it on the picture's rectangle), and
the controller-learning strip. The « Scotch et feutre » proposal kept the
picture clear by giving every one of them a place around it; the owner kept
that reorganisation and dropped its theme (D37).

Decision:

- **The picture is the only occupant of its rectangle.** Nothing is drawn on
  it, nothing veils it (no opacity, filter or transform on `#screen` or an
  ancestor), nothing moves it during play. One exception may be admitted for
  the link-state work (D40): a still picture may be darkened, lifted on the
  first new frame; a cut connection may show snow instead of the picture.
  Never anything on a live picture, and no layer, cursor or mascot inside
  `[data-zone-jeu]`.
- **One pure function lays the room out.** `front/src/lib/cadre.ts`
  `miseEnPage` returns the whole geometry (screen, posed picture, control
  panel, column, bar, band, touch pad, top band, side bands, phone sheet) from
  what the room knows. It recomputes on a resize, a picture size (the 2 Hz
  snapshot), a setting or a state, never per frame. Four modes: desk (fine
  pointer, 900 px and wider, the threshold of D35 kept rather than the
  mock-up's 760), narrow (fine pointer below 900: picture on top, column
  below, no drawer), portrait and landscape (coarse pointer, or pad-only until D47).
- **The control panel goes under the picture only if the real pose is
  unchanged.** The panel (START places, credit, play time) is 64 to 88 px
  high. It sits under the picture when `lib/fit.place` gives the same size,
  smoothing and integer step with and without it; otherwise it goes to the
  foot of the column. The mock-up's rule, « 64 px free under a picture that
  fills », is wrong for the integer and original sizes, and a fixed 88 px
  panel loses an integer step (640×480 in 1596×1030). Both cases are tests.
- **Nine frame states**, derived from the link state, the page's own launch
  and the room's game by an exhaustive switch: live, still, cut, unreachable,
  restarting, idle, starting, connecting, closed. The root carries them as
  `data-etat`, with `data-mode`, `data-role`, `data-panneau`,
  `data-sans-image`, `data-agrandie`, and the geometry as
  `--cadre-<name>-{gauche,haut,largeur,hauteur}` CSS variables.
- **Notices leave the picture.** The notice stack (`#avisDuCadre`) goes to a
  black band where it fits whole, otherwise to the head of the column, stuck
  to the top of what is visible, otherwise into the flow above the screen
  (`lieuDesAvis`). The corner buttons of a folded column are gone; an
  enlarged picture shows « Image agrandie : Ctrl pour revenir à la salle »
  for three seconds in a black band, or nothing.
- **The desk column names its rows.** `components/Colonne.tsx` replaces
  `Sidebar`: a head (room name and « Quitter la salle », the logo kept small
  per K26), the state block (D40's track), the role block (`#seat`, with
  « Prendre une place » for a spectator), what the people track fills, the
  control panel when it has no room under the picture, then the rows of
  `rangsDeLaColonne` (report, sound, game menu, keys or controller, keep the
  last 45 seconds, enlarge, other settings). The « essentiel » and
  « mesures » tabs are gone: the measures open from the status line of the
  column corner (`Coin.tsx`, `#mesures`), which also hosts the mascot under
  the line. A row that does nothing in a state is absent rather than greyed.
  The column scrolls by itself with a 60 px bottom scroll padding, and a
  sticky « Plus bas » says that more is hidden.
- **An idle room opens nothing by itself.** Until 2026-11-23 a room without
  a game opened its menu for everyone and hid the screen under it. The idle
  screen (`EcranEteint.tsx`, still `#idle-room`) now says « Pas encore de
  jeu. »; whoever chooses the game gets the focus on « Choisir un jeu », the
  only filled button in view, and the others read who chooses. The menu
  stays one gesture away (Escape, or « Menu du jeu » in the column, K23).
  The stage under the text hosts the mascot's waiting scene three times at
  most, stopped by the first gesture or a hidden tab. A spectator's button
  names the place it will get (« Prendre la place 4 »), and stays polite: it
  asks for the first free place rather than taking that one by force.
- **One mascot place at a time, one arbiter.** `ouEstLaMascotte` names the
  place (stage when there is no picture, column corner on the desk, phone
  bar, panel edge for an arrival). `lib/scenes-salle.ts` ranks the tracks
  that play scenes (states, menus, people, controllers, room): a lower scene
  is refused during a higher one, only the states track plays during a fault,
  and only the room plays the first-picture scene.
- **The keys view reads the product's tables, and lights what was sent.**
  `components/VueTouches.tsx` replaces the fold-out keyboard card and takes
  the place of the column rows, like the measurements. « Tes touches au
  clavier » lists the active key profile (`lib/aide-clavier`, now with the
  frame commands of each line); « Ta manette » lists the fifteen controls of
  a standard pad and what each presses in this room. `lib/verification.ts`
  holds no table: it builds a simulated pad with one control pressed and has
  it read by the reader the input loop really calls (`readPad` for Dolphin,
  `readSwitch` with the room's profile for Switch and Xbox 360). A line
  lights when the sent frame carries its command, the controller socket's
  echo is under 2 s old (two echo periods, since the echo leaves every
  second), and, at the keyboard, the focus is in the game zone. The view
  polls the input loop every 50 ms while it is mounted, because the React
  snapshot (2 Hz) misses most 150 ms presses. A line whose commands the
  snapshot does not report has no box at all: today `pressed` carries only
  the Dolphin frame's buttons, so sticks and the whole Pro frame wait for the
  controllers track to add activity (K34). The box says sent, never
  received: the room sends no per-button acknowledgement yet. At first visit
  at the keyboard the column opens on the view; « Revenir » returns to the
  rows and the next visit starts on them. The game zone is named « [game],
  l'image de la partie » and, at the keyboard only, described by a hidden
  sentence (Ctrl, Escape, Tab), so nothing is drawn on the picture.
- **The arcade frame lives in the bands, never on the picture.** The marquee
  (`Fronton.tsx`) shows the game title in the black band above the picture
  when that band is 40 px or more, its bottom at least 2 px above the
  picture; it yields the band to the notice stack while a notice speaks, and
  the column header names the game only when there is no marquee. The side
  decoration (`CoteBorne.tsx`) fills side bands of 72 px or more that do not
  carry the touch pad. The credit (`Credit.tsx`, K02) says « places libres
  N » at the right end of the control panel, counted on the places the
  worker reports, hidden from screen readers since the places already say
  free. The dither (`tramage`) is the game zone's background; the canvas has
  its own opaque background, so the pattern cannot show through before the
  first picture. All are positioned absolutely: the picture's size is the
  same with and without them. The play time (`TempsDeJeu.tsx`) is written
  but renders nothing until the room reports its game's launch time (data
  track, D04); a time counted from the page's arrival would lie. The
  first-picture scene has one caller (K06): `Cadre` cuts the stage and plays
  it on a passage from a no-picture state to `vit`, never on a return from a
  frozen picture (`premiereImage` in `lib/cadre.ts`).

Delivered in pass 1: the pure layout and its sweeps, the arbiter, the column
rows, the idle attention loop, the pad-only latency sentence (removed by D47), the root
attributes and variables, the notice stack off the picture, the corner
buttons removed, and the browser guard (`cadre.mjs`, `just
cadre-navigateur`, red against 03b21c0). Delivered in pass 2 (step 3, desk):
the column, the corner, the control panel under the picture or at the foot
of the column, `Sidebar` removed, and one arbiter instance per room created
by `Cadre` (`useArbitre`). The screen and its stand-ins (idle screen,
loading, link state) now live in a wrapper above the panel, so an overlay on
`inset-0` cannot cover the places. Proofs: `cadre.mjs` steps `meuble-place`,
`une-fois` and `un-plein`, red against the end-of-pass-1 page (0fef99e);
`focus.mjs` step `colonne-deborde` with its in-page twin (scroll padding at
0 hides a stop under « Plus bas »). Delivered in pass 2 (step 5): the idle
screen without an automatic menu, its entry focus, the waiting loop on the
stage, and the numbered take-place button; proofs `cadre.mjs`
`repos-sans-menu` (red against the step-3 page, 3cada57) and
`repos-attention`, `parcours.mjs` `spectateur-prendre`. Delivered in pass 3
(step 6): the keys view for the keyboard and the controller,
`lib/verification.ts`, the game zone's name and description; proofs
`focus.mjs` `touches-cochees` (red on a page whose input loop sends keys out
of the game zone), `agrandir-ctrl` (Ctrl enlarges, Escape opens the menu
without shrinking, F in a Switch room sends R and enlarges nothing) and the
updated `premiere-visite` and `carte-wii`. Delivered in pass 3 (step 7):
the marquee, the side decoration, the credit, the dither and the
first-picture rule; proofs `cadre.mjs` `fronton-bande`, `credit-compte`,
`tramage-hors-image` and `borne-bandes`, each red against the step-6 page
(2cb36ba, fourth block of `just cadre-navigateur-rouge`). Delivered in
pass 4 (step 4, which amends D28 and D35): the room held in hand. In
portrait and landscape every piece is placed absolutely on the rectangle
`miseEnPage` returns: the bar (`BarreSalle`: room, game, the « La salle »
button), the screen, the control panel, the band (`Bande`, which carries the
notice stack on a phone) and the touch pad's own box, under the picture when
held upright and as two side clusters when held sideways. The pad's sizes
come from its real placement: `encombrement` in `lib/faces` searches
`placePad` for the smallest upright height and the smallest side band, and
`placePad` can treat a piece outside its band as a fault (it shrinks its
sticks first). The mock-up's 128 px clusters put B, Z and the gesture on the
picture at 844×390; a GameCube's four buttons need 156 px, so a GameCube at
844×390 now gets 380 of the 390 px of height. The Pro pad needs 348 px of
cluster height to stay in a 140 px band, so clusters run down to the bottom
of the safe area (the pad keeps its own 12 px margin). `FeuilleDuBas` and
`Tiroir` merge into one `FeuilleSalle`: at half height the game gestures
(no darkened backdrop, never on the picture; at least 276 px, measured), and
enlarged the whole column. A fine pointer below 900 px puts the column under
the picture. Until D47, a pad-only page showed `ManetteSeule` (its seat, and whether keys
arrive). Proofs: `faces.test.ts` and `cadre.test.ts` place the real pad in
the frame's box at every sampled size with and without iPhone safe areas,
with a twin replaying the mock-up's boxes; `salle-telephone.mjs` and
`manette-garde.mjs` rewritten for the single sheet, each with a twin key
placed on the picture; `cadre.mjs` `tenu-rien-sur-image`, red against the
step-7 page (cf3bba1, fifth block). A page that chose to watch, held in
hand, has no touch pad (the choice, not a missing seat: the seat arrives
after the first picture, and a pad appearing then moved the picture); the
band carries the take-a-seat button. Step 8, in part: the
alternating effects measurement (`just cadre-mesure`, outside the gate),
two series of four 60 s phases, showed no repeatable cost in headless
Chrome under a foreign load (a trend, not a comparison). Corrected on review
(pass 6): the two arms differed only by the body font (`texte-pixel`). At
1440×900 with the bench's 4:3 picture, neither the pediment nor the cabinet
sides were mounted (no 40 px band above, no 72 px side bands); the pediment
and the dither are on in « sobre » too; the « tout » layers of the socle, the
cursor and the counter were not mounted in the room. The measurement says
nothing about the cost of the pediment, the sides, the dither or the socle's
« tout » layers. Delivered in pass 5:
a real controller no longer gets a notice. The plug notice, which covered L
for five seconds on a phone (audit N1, red against 03b21c0 in
`manette-branchee`), is now a screen-reader line only (`#controller-status`,
`sr-only`). Held in hand, the band says « Ta manette Xbox joue à la place 1. »
with « Vérifier les boutons » and the touch-controls toggle; on automatic, a
plugged controller hides the touch pad (`showsTouchPad`), and an upright
phone without it advises turning (`manette-vraie`). The half-height sheet
carries the clip, except across, where its single column scrolled (458 px of
content for 390). The socle's announcement anchor (`ANCRE_ANNONCE`) sits on
the title line, one at a time. `mascotte-hors-image` and
`vit-figee-immobile` have in-step twins and no red page (no earlier page has
the frame they read). Step 8 is closed with the night and day captures
(`cadre.mjs --clair`). Not yet delivered: the play time wiring (waits for
D04), the stick and Pro activity (waits for K34), the label in the pad's
slot (en-jeu-tactile.5).

Pass 6, after an independent review, nine defects, each seen red first. The
picture guard (`gardeDeLImage`) found elements only by `elementFromPoint`,
which never returns an element without pointer events: a full-window veil at
`pointer-events: none` passed it. Every visible element that paints something
and crosses the picture now gets the pointer for one hit test at nine points
of the intersection; a box that paints nothing (the held pad's box spans the
picture, its keys sit in the bands) is not a fault. Without a bar, the mascot
had no host: `ouEstLaMascotte` said « barre » and only the bar carried
`data-hote="barre"`; « La salle » placed alone across (`#laSalleCote`) and
among the keys (`#laSalleManette`) now carry a 24 px head. A pad forced on at
a fine pointer gets its place outside the picture (see the D28 amendment):
the picture shrinks for whoever chose « toujours » (at 1440×900, 890×668
instead of 1136×852), and nothing touches it. Weighed: keeping the overlay
as a chosen setting, which the owner's rule does not allow without his word;
side bands only, which leave a 16:9 picture at 1440×900 808 px wide where the
pose underneath leaves 1136. « Quitter la salle » plays the
`sortir-salle` transition (K13; mosaic, a fade in « sobre », nothing under
reduced motion), the picture hidden before the first step. The column runs
the socle's ▶ (`activerCurseur`) with a 20 px left margin; the socle's first
placement measures the hidden ▶ as 0 px wide and lands on its target, and a
notice born from the same focus pushed the column, so the column places it
again on the next frame and after each render. The half-height sheet has no
▶: its two-column grid has 4 px gaps and no room left of an entry. The pads
and « La salle » take the label promised to the people site (`libelleSalle`,
`libelle`). `TempsDeJeu` keeps one default clock, so the room's two renders a
second no longer rebuild its display. `cadre-navigateur-rouge` reads the
branch-only reference pages from `spikes/m3-browser-drive/rouges/`, each
checked against the git blob id of its commit's page, so the recipe survives
the integration rewriting this branch. Cost: the page is 249 436 bytes in
brotli; the room uses 13 736 of its 12 000, of which 1 947 are the socle's
transitions and cursor modules, bundled here for the first time.

Weighed: keeping the notices on the picture with a smaller footprint (still
on the picture, which is what the owner ruled out); putting them at the foot
of the column (a sticky foot covered the bottom buttons, and the menu button
was clicked through it in `focus.mjs`); at the head without holding them
during a click (the keyboard notice is born from the click that leaves the
picture, pushed the pressed button down, and the release landed on its
neighbour: `clic-colonne` red without the hold).

**Amended 2026-11-24: the rest of wave A (« salle-suite », pass 1).** What
waited on other tracks is wired on `integration/retro`:

- **Play time.** `Room.partie.depuis_s` (D43) is an age, not a time. The
  page turns it into a start time when the message arrives (`useLancement`)
  and keeps the previous estimate when the new one is less than 2 s away:
  the lobby truncates the age to the second and the message takes a few
  hundred milliseconds, while a new game restarts the worker and its age
  starts again from zero. Nothing is shown when the lobby publishes no
  milestones, when `lance` is not true (the age also counts the time the
  worker serves its menu), or when the page sees no game. It follows the
  credit at the end of the control panel and is hidden in the 72 px held
  row. Weighed: displaying the age as received (it jumps a second back and
  forth from one message to the next, and restarts the counter each time);
  comparing the worker's wall clock with the phone's (two clocks that
  nothing keeps in step).
- **The label in the pad's slot** (en-jeu-tactile.5). Without a control
  panel (375×548 upright), the typed label, its seat number first, sits in
  the widest free passage of the pose, at least 6 px from every key and
  gesture, 64 to 180 px wide, nearest the middle (`fente`, `lib/faces`).
  A centred slot was tried first and found nothing on a GameCube pad whose
  « La salle » gesture holds the middle. Across, the pad's box also spans
  the picture, so the label sits under « La salle ». With the row of
  START buttons, the label is on the player's START and nowhere else.
  (Corrected after the review below: the slot under « La salle » existed
  only in one of the three landscape layouts.)
- **Stick and Pro activity** (K34). The view reads `InputState.activite`
  (wired by the controllers track); the dead readers of `pressed` left in
  `lib/verification` and the tests that still proved the old rule are gone.
- **The half-height sheet gets the ▶.** Its grid keeps 16 px between
  columns and 2 px on the left, and entries shrink to 150 px so two columns
  still fit at 360 px.
- **A panel opened by a button scrolls into view** above the sticky foot,
  like a `<details>` (`aria-expanded` with `aria-controls`), which repairs
  « Copier le lien » after the merge of wave B1.
- `cadre-navigateur` joins the local gate at the owner's request; its red
  control gains a port and a seventh block against 97a2318.

**Amended 2026-11-24, after the review of « salle-suite ».** The frame,
not the page, decides where the player's seat can be read when the panel
does not carry the row of four START buttons (`geo.etiquette`,
`lib/cadre.ts`): the pad's slot upright, under « La salle » across, or at
the head of the band when the panel only shows its lamps. The review had
found neither panel nor label at 568×320, 667×375 and 740×360 on a
GameCube pad and at 932×430 on a Pro pad: the « tete » layout, which often
wins, had no label slot, and a panel under 224 px turns the row into
lamps where no seat is marked. `PANNEAU_RANGEE` (224 px) copies the 200 px
container query of `places.css` plus the held panel's 12 px edges; a test
reads both style sheets. The « tete » layout now takes the 28 px between
« La salle » and the left cluster, at the slot's height (24 px), 6 px from
both on the real pose. No picture size changes. Weighed: preferring
« tete-etiquette » for a player (up to 9 % of picture height on a
GameCube, at 780×360 and 812×375); writing the seat into « La salle »'s
label (already cut to « La … » at 667×375); dropping « nu » when it had no
band (a mutant showed a Pro pad at 640×360 falling to an 8 px wide
picture). The exception left: a landscape window under 370 px high whose
lamp-only panel has neither a band nor 28 px below the row, 2,179 of
424,080 cases in a sweep from 480 to 1,400 px, none of the phone sizes
tested; the frame does not shrink the picture for a label there. In the
held row, the places' help sentence (`.n3-places-role`) is read only to
screen readers: the rule that hid it still named `Seats`' sentence, and
« 2P » covered the player's name at 360 and 390 px.

**Amended 2026-11-24, end of the room's track: the first picture moves
nothing.** The site lead settled what waves B1 and B2 left open.

- **The desk panel is decided on the console's expected format.** At
  1440×900, the black arrival screen put the panel under the screen, and
  the first 4:3 picture moved it to the column, pushing its children down
  by 204 px (`colonne-stable`). The console manifest now gives each
  console a `format` (GameCube and Wii 4:3, Switch, Switch 2 and Xbox 360
  16:9), read by the page only (`formatAttendu`). The frame keeps a base
  from one computation to the next (`baseDuPanneau`): the expected format,
  posed as « remplir » since its real size is unknown, until the first
  natural layout change that finds a picture (window size or safe areas,
  mode, pose setting, column width, a panel opened or closed, Ctrl); the
  real picture after that. The first picture, a state, a seat given after
  it and the pad that follows the seat change nothing; a new console
  starts again from its format. The narrow mode's screen height follows
  the same base. Weighed, from the states workstream: the last format seen
  in the room (wrong for the first game of a session), and a panel
  independent of the format (it would cost a 4:3 picture its height, or
  leave a 16:9 one a fixed empty band). A 16:9 Wii game keeps the 4:3
  place until the next natural change; phones do not follow the base yet.
- **An arrival into a running game shows the game's rows.** With the panel
  held, the column still grew by 196 px at the first picture: sound, keys,
  clip and enlarge appeared only with a picture (`rangsDeLaColonne`). They
  now appear from the arrival when a game runs; a launch still hides them
  (C8).
- **Held in hand, « Touches et manettes » has its place** (`reglageTenu`,
  `Geometrie.reglage`). Upright, everything under the picture, which does
  not move unless less than 280 px would remain; across, a right-hand
  column of 42 % of the width, 300 to 520 px, the picture posed in the rest,
  like the desk widening its column for the panel (K24). The panel, the
  band and the pad are not mounted meanwhile; « La salle » and the bar give
  way across. Until then the panel lived in the enlarged sheet over the
  picture (`place-tenu`, which joins `reglage-navigateur`).
- **The pastille's places** are written in D29's amendment: the bar's slot
  on a phone, the panel on a desk, before « Toutes les touches ».
- **The band label has a rectangle**, which the menu avoids (D30's
  amendment).


### D40: The room's state leaves the picture, and its cover lifts on the first painted image, 2026-11-24

Context. Until this change, the room's state was said on the picture: a
banner over the last image, a curtain on arrival, the light-image offer at
the bottom of the image, the closing notice and the automatic light-image
notice at its top or in the notice pile. D37 and D39 rule that nothing passes
over a live picture. The owner's K20 ruling (24 November 2026) is: snow
replaces the picture of a cut connection; a STOPPED picture may be dimmed,
lifted on the very first new image; nothing ever on a live picture.

Decision. One pure model per render (`lib/etat-modele.ts`) picks ONE state
by priority (full frame, then cut, unreachable, restarting, closing soon,
display stopped, frozen, light image, light-image offer) and says it in three
pieces, each off the picture: a pastille (`#pastilleEtat`, in the notice
pile placed by the room, or tenu en main at the top of the right pad cluster
or in the bar, never on the picture: `lib/etat-place.ts`), a sheet (`#liaison`,
`#rough`, at the head of the column, or in the expanded sheet on a phone),
and the full frame of the cabinet (`#arrivee`) when there is no picture at
all. The column's Signaler row hides while the sheet carries Signaler (K25).
The words live in `lib/liaison-mots.ts`, including the loading sentences the
menus workstream asked for; Aïn's scene per state comes from
`lib/etat-scene.ts` through the room's arbiter, never `premiere-image` (K06).

The cover is a set of tokens on `:root[data-couverture]`
(`media/couverture.ts`): `plein` (the full frame; the game canvas is hidden,
not covered), `neige` (cut connection only, at the levels that have the snow
effect; the canvas is hidden and a noise canvas shows in its rectangle) and
`passee` (a stopped picture at 50 % opacity, at the sheet only, instantly,
because the room's guard refuses any animation that touches the canvas). The
paint loop calls `lever()` right after `this.painted += 1` (`media/video.ts`):
one addition and one comparison when nothing is set, and when something is,
the attribute goes in the same task as the drawing, before the browser renders
the frame. `armer(token, seen)` refuses when an image newer than the one the
state was decided on has already been painted: the snapshot records
`couverture.vues()` with the state (`couvertureVue`). A cover is armed once
per entry into a state, so a frame that lifts it is not covered again at the
next snapshot.

Proof. `etats.mjs premiere-image-coupe` counts each drawing on `#screen` as
it happens and checks, in a microtask before rendering, whether the full
frame still shows (1440x900, 390x844, reduced motion): green on this page,
red on main 03b21c0 (45 to 49 samples of a painted image under the curtain)
and red on a mutant without the `lever()` call (43 to 53).
`pastille-hors-image` measures the frozen-state pastille at + 4 px of the
image at four sizes: red on 03b21c0 at all four. Both join
`etats-navigateur-rouge`. `manette-garde` measures the real closing pastille
placed by `placeDeLaPastille` instead of a copy of the old notice.

Cost: +2 559 bytes brotli (281 760 to 284 319), within the 7 000 envelope;
Bobine stays in the bundle until `Booting.tsx` (menus) and `Ouverture.tsx`
(salon) stop importing it. Not done in this pass: the arrival on short
phones, the closed room's past-tense panel and evening column, the
"what your page sees" fold, the sound cues, and the bar pastille's own slot in
`BarreSalle` (today it covers the room name, which stays in the DOM).

Weighed: lifting the cover from React (up to 500 ms late, the measured
defect); a fade-out on the first image (a live picture under a fading layer);
a 400 ms dimming transition (refused by `vit-figee-immobile`, an animation on
the canvas); the sheet in the phone's band (measured at 390x844: the band
holds the pastille only, and the sheet's buttons fell under the touch pad);
a pastille on the picture when no band, free cluster or bar can hold it
(nowhere is better: the spoken line and the sheet behind "La salle" still
say the state).

Amended 2026-11-24, second pass. The closed room says when and why: the
watch (`media/veille.ts`) reads `fermee_depuis` and `fermee_pour` from
`/api/salles` (K37) and keeps the values of the first "closed" answer of the
series, so the minute said cannot change between probes rounded to the
second; with no time known, the title stays "est fermée" and no time is
made up. Under a lobby the closed screen also links to the play journal
(`/profil#parties`, D12). The frozen-image sheet folds what the page sees
(picture, sound, room, pad echo) under "Ce que ta page voit". Entering a
cut or unreachable state shakes the sheet and plays the error sound, both
gated by the base layer (level "tout", sounds off by default, never while
the game has focus); a sheet mounted later in the opened phone sheet does
not shake. Below 260 px of height the full frame tightens its spacing (at
320x568 it overflowed by 8 px), and the cost line carries `data-texte` so
Aïn does not sit on it. A sheet opened by the pastille gives the focus back
to the pastille on close, not to "La salle".

Proof, second pass: `pastille-mene-au-geste`, `gel-image-passee`,
`coupee-reseau`, `neige-coupee`, `arrivee-sans-image`, `arrivee-courte` and
`colonne-stable` in `etats.mjs`. Each was seen red on a mutant page built
for it, and four of them join the 03b21c0 block of
`etats-navigateur-rouge`. `colonne-stable` is red on this branch: the
command panel sits under the screen without a picture and moves into the
column on the first 4:3 picture at 1440x900 (`panneauAuBureau`, a room
file), pushing the column down 204 px; it was also red on 03b21c0, where the
diagnosis block grew by 22 px. Weight: 284 891 bytes brotli (+528 on the
first pass).

Amended 2026-11-24, third pass. The "coupure" effect (level "tout") is a
fourth cover token: when the full frame first appears in the arrival state,
250 ms of snow under the token "coupure", removed by its timer or lifted with
the rest by the first painted image. The state at the full frame's first
mount decides alone, so a room answering again after a failure never shows
it; nothing at "conseillé" or under reduced motion. A closed room keeps its
seats in the past tense: the command panel shows the four START buttons
unlit with the tag of whoever held each seat, without "toi", crown or mic,
disabled, the group named "Ils ont joué"; the page keeps the seats it saw
before the closing, since what the lobby publishes afterwards may no longer
say who played. Weighed: leaving the live seats (a closed room offered "Place
1, libre : la prendre"). Proof: `coupure-entree` in `etats.mjs`, red on the
page before, with three twins (conseillé, reduced motion, a real cut at
"tout"); `fermee-vraie` reads the panel before and after, the bench then
publishes the room without its players, and a mutant page that forgets the
earlier seats fails on "la salle fermée a perdu qui jouait". Weight: 285 293
bytes brotli (+402 on the second pass). `colonne-stable` stays red, for the
room's track to decide.

Amended 2026-11-24, fourth pass. A closed room's column says "Ce soir dans
la salle N": the game, and the people who were watching at the closing as
typed tags (`CeSoir`, `#ceSoir`), in place of "Ils regardent" and the role
block, which spoke in the present tense ("tu regardes"). The page keeps the
game and the watchers it saw before the closing, like the seats; someone who
arrives afterwards did not watch. The players stay on the panel, and the
link to the logbook stays on the screen, once: the plan put it in the column
too, which would have shown it twice. A fiche gesture that held the keyboard
focus no longer drops it on `<body>` when the fiche leaves (the picture
comes back, the state changes): the fiche checks, before its removal,
whether it holds the focus, and if the focus falls on the document the page
returns it to the game zone (`FicheEtat`, `onFocusPerdu`). A row the person
chose elsewhere keeps its focus. Proof: `fermee-vraie` reads the column
before (a watcher) and after (another person arrives after the closing),
red on the page before and on a wiring mutant without the memory;
`fiche-focus-rendu` in `focus.mjs`, red on the page before (focus on BODY),
with its twin; two new parts of `salle-telephone` (`arrivee-telephone`,
`pastille`: five states, nine sizes, 4:3 and 16:9, no common area with the
picture or any touch key), each red on a mutant made for it. The handheld
pastille still has no place in short portrait (390x664, 375x548), where
"La salle" lives in the touch pad: the driver reports it as "non posée", for
the room's track to decide. Weight: 285 540 bytes brotli (+247 on the third
pass).

Amended 2026-11-24, fifth pass (independent review, seven findings, each
replayed first). Aïn over the first painted image was not reproduced as
painted: the review read the render with a `ResizeObserver` created before
the mascot's, and the browser serves observers in creation order before it
paints. Traced callback by callback, the mascot's observer (`observateurDe`
in `mascotte/rendu.ts`) sees the full frame's plateau collapse when the
"plein" token is lifted and removes the sprite in the same rendering update;
an observer created after it sees nothing at 1440x900, 390x844 and under
reduced motion. No code change; `premiere-image-coupe` now records Aïn's
sprites over the canvas at + 4 px from an observer created after the
mascot's, requires Aïn on the plateau at the last render without a picture,
and is red on a mutant whose mascot no longer observes the plateau (21 to 25
renders). The pastille now carries the night régie: its background is the
cabinet's black in both themes, and by day its counter fell to 1.16:1
(`pastille-contraste`, text 4.5:1, border 3:1, both themes). In the phone's
bar it starts after Aïn's head (`BARRE_TETE_PX`, 50 px), the head being his
home on a phone; `salle-telephone` and `pastille-hors-image` measure the head.
It still covers the room and game names, which stay readable by screen
readers. The extinction starts from black: two black curtains from top and
bottom close on a light line, the line narrows to a point, 650 ms; the old
one opened on an almost white full screen. The full frame's text sits on a
solid plaque above the tube layers, which drew over the title. `extinction`
reads three screenshots with the effect paused at 0, 60 and 90 %, one play,
an untouched canvas, none on restart or at "sobre"; `calques-attente`
hit-tests every text piece with the layers made targetable, reads the
title's contrast by day and by night, and the vignette and roll at "tout"
(the base layer rates them "à doser", so not at "conseillé", unlike the
plan). `je-reste` clicks `#jeReste` and requires one "reste" byte at the
bench and the pastille gone, with a spectator twin; red on a wiring mutant
where "Je reste" does nothing. The etats logic left `App.tsx` for etats
files (`components/useEtatDeLaSalle.ts`, `lib/etat-place.ts`,
`lib/etat-modele.ts`, `components/PlacesAuPasse.tsx`); `Places.tsx`, its
test, `places.css` and `PLACES` are back to the integration branch. The
`App.tsx` change is one wiring commit, the last code commit, followed by the
page; history was not rewritten, because the negative controls read this
branch's pages by commit. Three touches to the people blocks stay in the
wiring and are requested from that track: the role block and "Ils
regardent" fall silent in a closed room, the seats switch to
`PlacesAuPasse`, and the corner line falls silent when a sheet already says
the state. `colonne-stable` stays red (`panneauAuBureau`, a room file that
`chantier/retro-salle-2` does not touch): this branch does not merge until
the room's track decides where the panel goes. Weight: 285 884 bytes brotli
(+344 on the fourth pass: +64 for the three screen fixes, +280 for the
extraction and the past-tense seats).

**Amended 2026-11-24, at the wave B2 integration: one loading sentence.**
Both this workstream and the menus workstream had written the spoken
loading sentence, from the same base. The merge keeps this entry's form
(`phraseDemarrage` in `lib/liaison-mots.ts`, `relance` as `"moi"`,
`{ nom }` or `null`) and carries in what menus measures: `habitude` (the
lobby's measured start habit, D05) and `seuilS` (the threshold the loading
screen crossed, `seuilLong`: the game's 90th percentile when measured,
20 s otherwise). Without them the spoken line said « depuis 20 s » while the
screen waited for the measured threshold. « d'habitude » is said only when
the habit is measured. The room passes `relance: canClose ? "moi" : boss ?
{ nom } : null`. Two menus tests, rewritten to these words, were red on this
entry's body alone (20 s instead of 35, no habit) before the merge.

**Amended 2026-11-25 (final review): the cover lifts on a canvas that has
the picture's format.** Lifting in the paint loop showed the canvas before
React had sized it for the picture: with no picture in the snapshot, `place`
gave a SQUARE, and the first live images were painted stretched in it (13 at
1440x900, 18 at 390x844) until the next snapshot. On `main`, the curtain hid
them. Three changes. `Screen` sizes the empty canvas on the console's
expected format (« remplir », no prescale) and writes which picture its box
is laid out for (`data-boite`, and `data-proportions` when only the aspect
counts). The paint loop lifts the cover only when that box fits the painted
picture (`couverture.boiteJuste`: the exact pixels for « entier » and
« origine », the aspect within 2 % for « remplir »); otherwise the lift
waits, retried right after the snapshot is re-read and on every tick, so a
still picture is not left covered. The session re-reads the snapshot as
soon as a new format is decoded. The same rule covers a « démarrage » cover
lifted on a game of another format. Rejected: keeping only the expected
format, since a GameCube image of 640x528 is 9 % away from 4:3. Proof:
`premiere-image-coupe` reads the rendered box of the canvas against its
pixels at each visible image (45, 43 and 49 off-format readings on the page
of 6e2559f, none after), and still faults a cover kept over a right box; the
lift waits one image, 15 to 17 ms, on the bench whose console announces
16:9 for a 4:3 stream.

### D41: The room's entry screens and the lobby's return address, 2026-11-24

Chantier « salon », first pass. The parts of the salon plan that the room page
and the proxy carry; the lobby's own pages (home, upload, logbook) follow in
the next pass and will extend this entry.

Decision:

- **One drawing for the antechamber.** The three drawings of 2026-09-13
  (`classique`, `cables`, `plan`), their switch on the page and the stored
  choice (`nel3ab:lobby`) are removed. The antechamber is the room's cabinet
  as the lobby's home will show it: console, game, who chooses, who watches,
  then a control panel of four START places. A taken place carries its
  player's typed label at the seat colour; a free one is a button that takes
  it. The first free place is the only filled button, « Prendre la place N »;
  a full room gives the filled button to « Regarder la partie ». A place held
  without a name (`held` true) is not free.
- **A precise place in the address.** `?entrer=jouer&place=N`, N from 1 to 4
  (`lib/entree.ts`), enters to play and asks for THAT place. The worker first
  gives the first free place; once the page holds it, it takes N with
  `session.input.take` if the room still says N is free, then removes `place`
  from the address so a reload does not ask again. `take` displaces whoever
  holds a place, hence the check; the polite `prefer=N` the worker already
  reads would avoid the brief first place, but needs a change in
  `media/input.ts`, which belongs to the manettes chantier.
- **« Qui joue ? » mounts the name field of the personnes chantier**
  (`ChampNom`, `useNom`, K03): a visible label, an always-active button that
  refuses an empty name with its reason.
- **The proxy's redirect names the room (K39).** A closed room sends
  `/?salle=fermee&n=N` for rooms 1 to 3, one line per room like the
  `handle_path` blocks above it; the old redirect stays for a room path that
  names none. A real Caddy serves the installed blocks in
  `control/tests/test_caddyfile.py`, the room ports replaced by a closed one.
  The file on the machine changes only when the owner installs it, so
  `deploy-check` diverges until then.

Consequence: CSS class names of independently owned sheets can collide. The
antechamber's `.n3-borne` was also the room frame's cabinet (`cadre.css`,
`display: none` outside the « borne » effect) and hid the whole cabinet in
Chrome while every jsdom test passed. The antechamber's classes now live under
`n3-avant`, a test refuses any other sheet declaring one, and the browser step
hit-tests the centre of each place.

#### D41, second pass, 2026-11-24: the lobby's own pages

- **One built bundle for the lobby (K17).** The three lobby pages stay
  hand-written HTML served by Python. What they need from `front/` arrives
  as one IIFE, `retro/ain.js`, built by `just ain-salon` from
  `front/src/salon/paquet.ts`: Aïn (`mascotte/salon.ts`, D46) and the socle's
  arcade gestures (`surStart`, `surInactivite`, `initiales`), the test card's
  layers, the curved-screen filter and the pixel pointer, under
  `nel3abSalon`. `retro.py` inserts it through `<!--RETRO:AIN-->` in a
  classic script and refuses a bundle containing a script end tag (`<`
  followed by `/script`). Each page has
  one `data-hote="logo"` around the static logo, hidden once Aïn is painted.
  Weight: 16 222 brotli bytes before, 18 170 after; the lobby loads it apart
  from the room page, which stays at 279 903.
- **The home page is a row of cabinets.** One cabinet per room that is not
  closed: cover or drawn cartridge, game, who chooses and who watches as
  typed labels, four START places. A free place links to
  `?entrer=jouer&place=K`; the advised place is the only filled button and
  the headline names it. A restarting or silent room keeps its cabinet,
  dashed, with no button; only a closed slot offers « Ouvrir la salle N »
  (`POST {numero}`, D17). The gauge is removed. At zero rooms the socle's test
  card fills the row, « Ouvrir une salle » is the only filled button, and
  Enter or a pad's Start opens a room, at zero rooms only. After opening, the
  page stays: the room arrives in the row. Two missed polls freeze the list
  and say its time. `?salle=fermee&n=N` (K39) says what happened to room N.
- **The logbook is a high-score table** grouped by evening (start minus six
  hours), with the D44 companions, the duration as `HH:MM:SS` and the named
  save. The name changes in a modal dialog on the page (`PUT /api/me`).
- **Covers are deposited at the upload page** by the administrator, through
  the D45 routes (`PUT`/`DELETE /api/catalogue/art/{cle}`).
- **Bobine leaves the lobby**: `bobine.py`, its copies and their tests.

Consequence: a jsdom run of the real page proves what the page writes, not
what it draws. `salon-navigateur` serves the assembled pages to Chrome with
simulated APIs and found two defects jsdom passed (a 31 px logo link, a
credit line 37 px wider than a 320 px phone). Its negative control imports
older `control/` trees with `python -S`, because the editable install would
otherwise shadow the archive.

#### D41, third pass, 2026-11-24: the opening, the antechamber's Aïn, the upload shelf

- **The opening draws the room before it arrives.** While the identity and
  the pad settings are pending, `Ouverture` renders the room's rectangles
  from the same geometry (`useGeometrie`, state « connexion », the stored
  column width): the black screen, the panel with four dashed START places,
  the column with « Salle N » and « On ouvre la salle N… », and Aïn's house
  where the room's corner will be, its status line's height reserved. It
  follows the theme (the forced night régie and Bobine are gone); the screen
  stays black. At eight seconds: « nel3ab ne répond pas encore. », a count
  outside the announced region, « Réessayer » as the only filled button, and
  « Entrer en tant que [nom gardé] » or « Entrer quand même ». Aïn plays
  « attente » once at that limit, nothing before or after. In hand, the
  column takes the largest free band around the screen, without a house.
  `front/index.html` carries the same skeleton for the frames before the
  script, with a small classic script that writes the room number and the
  stored column width; the worker hashes every inline script (`script_policy`).
  The skeleton carries none of the room's identifiers (`#side`, `#panneau`):
  a driver waiting for them still waits for the real room.
- **Aïn in the antechamber.** The header logo is his house (`data-hote="logo"`).
  A seat that frees plays « depart » to its START, a seat taken by someone
  else « arrivee »; the first state received plays nothing (`lib/arrivees`).
  Each place carries `start-N`, the panel its floor at its bottom edge, and
  two passage marks to the left of the card route him around « Changer ton
  nom ». Entering, at a place or to watch, goes through the « entrer-salle »
  transition (K13), played on the antechamber only: on the whole page, its
  second half filtered the room mounted in the middle, screen included.
  Amendment to K13: the mosaic yields to the fade there. In headless Chrome
  it delayed the room's first picture by 800 ms (1 295 ms after the seat was
  taken instead of 460, four runs per side, 2026-11-24), while the tiles
  (485 ms) and the fade (483 ms) cost nothing. Without animation the gesture
  leaves at once.
- **The home page's attention loop** lives in the lobby bundle
  (`salon/attention.ts`, `nel3abSalon.surAttention`): « attente » at 2.5 s,
  then every 6 s, three rounds, then « dort ». A skipped round (hidden tab)
  counts, a gesture stops it (hovering is not one), reduced motion never arms
  it. Bundle: 18 304 brotli bytes.
- **The upload page shows the library as a shelf,** above the drop zone: one
  box or cartridge per catalogue game, a free slot first (`place-libre`), the
  board and the floor under it (`etagere-haut`, `etagere-bas`), and the pile
  of uploads not yet stored. Below the zone, the box of the « depot » scene
  crossed the zone's words on its way up and the scene fell back to its key
  pose; above it, the scene plays complete.

Weight of the room page: 279 903 brotli bytes before this pass, 281 661
after (opening skeleton +1 314, antechamber +444 with its transition fix).

Consequence: three checks found what the unit tests passed. `(pointer: fine)`
is not declared by headless Chrome, so the static skeleton's column fell under
the screen (`ouverture-statique`); the skeleton's house sat 44 px higher than
the room's corner until the status line's height was reserved
(`ouverture-sans-saut`); Aïn's complete departure touched « Changer ton nom »
until two passage marks were added (`avant-salle-ain`, whose mutant without
them fails on `#rename`).

#### D41, fourth pass, 2026-11-24: one header, the upload page in words, Aïn's single house

- **One header for the three lobby pages,** placed by `retro.py`: the mark
  `<!--RETRO:BANDEAU /chemin-->` puts `retro/bandeau.html` (logo, the three
  pages, « Tu es », and the script that fills them) and marks the page's own
  link `aria-current`, visible even without the right; `/*__SALON__*/` puts
  `retro/salon.css` (the header's rules and the typed label). Copied into each
  page until then, it had drifted: the upload page had neither « Tu es » nor
  « Changer ton nom », and its « Ton carnet » link stayed hidden from
  everyone, since nothing showed it. On the logbook page the header's link
  opens the rename dialog in place, and the header follows the new name
  (`nel3abBandeau.nom`). An unknown path in the mark raises at start-up.
- **The upload page drops the player colours and the stamps** (plan salon,
  salon-importer#4, #5, #7, #8). The zone says « Pose tes fichiers ici, ou »
  with « Choisir des fichiers » as the only filled button at rest, and
  « Lâche-les : ils se rangent dès qu'ils sont lus. » under a drag. A card
  has no ESTIMATION label: a sentence says where an upload stopped and how to
  resume, or, as an alert, what failed and how to repair (`phraseEnvoi`). The
  console the server recognised is a typed label whose edge carries the
  outcome. Who may upload: « Peuvent déposer » and « Ne peuvent pas », a
  typed label per person, a sentence instead of the TAILNET or DÉJÀ VENU chips
  (`phraseDe`), « Donner le droit » or « Retirer le droit » (`boutonDe`); the
  colour drawn from the address (`priseDe`) is gone. A game stored during the
  visit glides from the top of the pile to its slot in the shelf, 900 ms,
  `transform` only; with reduced motion, or without a pile, it appears in
  150 ms by `opacity`. A verification seen from the page counts as followed,
  even when it began before the page loaded.
- **« Qui joue ? » makes its logo Aïn's house,** at rest, as the antechamber
  does (entree-nom#3, translated for Aïn): no scene while a name is typed.
- **The home page's row enters once** (salon-accueil#15): nothing moves on
  the first render; when the row replaces the « Hors antenne » card after a
  room answers, it fades in over 250 ms, `opacity` only, and not at all with
  reduced motion.
- **Not done, by choice: Aïn lying beside the logbook table** (salon-profil#3).
  The plan wrote it for Quatrou. The logbook page already has Aïn's house in
  its header; a second host would paint a second Aïn on the same page, against
  the owner's ruling that he lives in the logo and leaves it for a scene. The
  « range » scene already takes him to the table. To be confirmed by the owner.
- **Not done: Aïn asleep on the upload pile.** The « dort » scene ends in his
  house; sleeping on the pile's anchor needs a scene variant in
  `front/src/mascotte/scenes-ain.ts`, which belongs to the mascot's work.

New browser checks: `salon-navigateur` gains `depot-zone`, `trousseau`,
`depot-glisse`, `demo`, `courbure` and `rangee-entre`, and its `entete` and
`changer-nom` cover the three pages; `parcours-navigateur` gains `salle-pleine-avant-salle`
(the bench now holds all four seats). `demo` advances Chrome's clock by 31 s
of virtual time (`Emulation.setVirtualTimePolicy`) and then pauses it: the
« advance » policy without a budget kept running between the driver's
gestures. Each is red on the page it replaces, in the `-rouge` recipes.

Weight of the room page: 281 661 brotli bytes before this pass, 281 607
after; the lobby bundle is unchanged.

#### D41, fifth pass, 2026-11-24: the lobby's words come from `mots.ts`

- **The words of the three lobby pages live in `front/src/lib/mots.ts`,**
  in flat tables (`SALON_ENTETE`, `SALON_COMMUN`, `SALON_ACCUEIL`,
  `SALON_DEPOT`, `SALON_CARNET`), so that the charter's guard reads them:
  it only reads strings placed directly in a capitalised constant. A
  sentence with holes is a template, `"Salle {n}, éteinte."`.
  `motsDuSalon()` flattens them into `groupe.cle` keys; it is a function so
  that the room bundle, which never calls it, drops the tables.
- **Delivery mirrors the other copies.** `salon-retro.test.ts` writes and
  compares `retro/mots.json`. `retro.py` requires `<!--RETRO:MOTS-->` in each
  page's head and puts there `retro/mots.js` with the table, which defines
  `nel3abMots(cle, trous)` (unknown key or missing hole throws) and
  `nel3abMots.de(nom)` (elision, checked against `test/elisions.json`). A
  fixed text is `<!--MOT:groupe.cle-->`, replaced HTML-escaped; a template in
  a mark is refused. Every quoted `groupe.cle` in a page's scripts must exist,
  or the lobby fails at start-up; the upload module, placed after assembly,
  is checked by `importer.py` at the same start-up. Its Node tests install
  the same table first (`control/tests/imports/mots_du_salon.mjs`).
- **The charter applied.** « salon » leaves the visible words
  (« l'administrateur de nel3ab », « a déjà un nom ici », « redémarre
  nel3ab »); the home page says `SANS_REPONSE`; the logbook says « ma
  sauvegarde » and elides « la sauvegarde d'Ami »; the upload card's
  buttons start with a capital (Pause, Annuler, Reprendre, Retirer).
  Lexicon gestures are written by reference (`ENTREES.regarder`,
  `SAUVEGARDES`), and the templates that repeat a room function
  (`prendreLaPlace`, `PLACES.aQuelquun`, `chefChoisit`, `pastille`) are
  compared with it.
- **Kept in the upload module, by rule:** the estimate's evidence strings
  (« « HEAD » à 0x100 »), which are byte offsets read in the file, and the
  error messages of a chunk upload that `envoyer` always catches.

Guards: `control/tests/test_mots_salon.py` (marks, keys, holes, dead words,
fixed texts and sentences written in a page, capitalised buttons); on the
sources before this pass it finds 55 fixed texts and 133 sentences.
`salon-navigateur` gains `start` (Enter and a pad's Start at zero rooms, one
request per press), `retour`, `annonce`, `credit` and `carnet-range`; four
are red on 2a98279, and `annonce`, older than every reference page, is red on
a mutant that silences the line.

Weight of the room page: 281 607 brotli bytes before this pass, 281 539
after (minifier only); the lobby bundle is unchanged.

#### D41, review fixes, 2026-11-24: the logo link's name, and a START keeps its focus

- **The header logo link names itself.** On the three lobby pages the logo
  is a link to `/`. Once Aïn is painted, the static logo (`role=img`,
  « nel3ab ») is `display:none` and Aïn's canvas is `aria-hidden`, so the
  link had no accessible name (WCAG 2.4.4 and 4.1.2). It now carries
  `aria-label="<!--MOT:entete.logo-->"`, « nel3ab, les salles », from
  `SALON_ENTETE.logo` in `mots.ts`. A name that must hold is set on the
  element, not drawn from content that can be hidden.
- **`remplirStarts` updates each START in place,** port by port (ring,
  word, name tag, `href`, `data-plein`, `data-ancre`, `aria-label`).
  Rebuilding all four whenever one place or the advised place changed
  dropped a keyboard user's focus to `body`. Only a place that turns from
  free to taken, or back, changes node, because a link becomes a tag.

Guards: `test_accueil.py` marks the focused node with a witness and requires
the same node after the poll (red before the fix and on a mutant that puts
`replaceChildren` back; twin: the focused place itself is taken).
`salon-navigateur` gains `start-focus` and reads the link's name in Chrome's
accessibility tree in `ain-logo`; both are red on 323aa52.

Weight of the room page: 281 539 brotli bytes, byte-identical; only its
stamp changes, since `mots.ts` is an input.


### D42: Touches et manettes: one lesson machine for both frames, flat drawings coloured by seat, 2026-11-23

**Status:** four passes of the `manettes` work site, on
`chantier/retro-manettes`. The panel that replaces the two modal dialogs is
mounted in the column at the fourth; this entry will grow with it.

**The on-demand module is not taken (K38).** The plan proposed a second
artefact, `/reglage.js`, served by the worker and loaded on first opening, to
keep the room page under its 300 000-byte budget. The owner declined it: the
page stays one file (D13 unchanged), and the panel will live in the page,
measured at every pass. After this pass the page weighs 250 627 bytes brotli
(+1 191 on `integration/retro`).

**A passed command keeps its previous binding.** `Lesson.skip()` recorded
nothing and the end of a lesson replaced the whole profile with the answers
alone; since `readPad` does not fall back to the standard layout once a
profile exists, skipping B to keep it erased it. The lesson now lists its
passed steps and `learned(previous)` gives each one the stored profile's
entry, or the standard layout for a standard pad without a profile. An
adapter never configured keeps them unset. A lesson where everything was
passed writes nothing. One exception, found while writing the Pro test: an
input taken by an answer leaves the passed command that held it (answering
A on b3 with Y passed and standard on b3 made b3 press A and Y). The lesson is
a new plan of the pad, and an input does one thing, as a keyboard key already
does (`bindKey`). Weighed: keeping both (the capture's behaviour) leaves a
silent double press; dropping all passed commands (the old behaviour) is
the defect.

**An unplugged pad suspends a lesson instead of cancelling it.** Nothing is
written; the lesson, its answers and its passed steps wait under the pad's
identifier, and only the same pad resumes, with a rest sample taken at the
click. A different pad would learn the rest of a different model.

**One step machine for both frames.** `Pas<K>` (`media/lesson.ts`) holds the
rest taken once, the wait for release, the refusal of a button for a stick
step, the passed list and the resume; `Lesson` writes a GameCube profile and
`LeconPro` a `SwitchDevice`. The Pro lesson has 20 steps, not 24: a
`SwitchDevice` keeps one signed axis per stick axis, so asking « left » after
« right » would overwrite the same entry. The sign comes from the push, as
for Dolphin.

**Lesson events leave the loop outside React.** The React snapshot is read
twice a second (rule 8), too slow for the step marks to come. `surReglage`
and `surLecon` deliver `etape`, `recu` (with the input named as the right-hand
drawing names it), `relache`, `fin`, `suspendu` and, once per page load,
`premiere-manette`. A subscriber that throws cannot stop the input loop.

**The snapshot says what the sent frame presses (K34).** `InputState.activite`
holds the commands the frame can carry and those it carries now, for the
Dolphin frame and the Pro frame, read from what was SENT: a menu or a lesson
sends a neutral frame, and nothing lights then.

**Flat drawings, pressed in the seat's colour.** The controller drawings lose
their volume (gradients, sheen, rim, inner shadow, drop shadow, filters, the
card around them): one flat colour per material from the manettes section of
`regie.css`, the shell at the exact middle of its former gradient, and a
crisp outline in the theme's ink (the one thing that follows the theme). A
pressed piece takes the page's seat colour, the player shade of the other
lightness than the keys, with an object white or black ring of the other
lightness than the shell. One of the two holds 3:1 against the key, its well
and the shell for ten plans and four seats (`lib/manettes-couleurs.test.ts`);
on the purple GameCube the fill alone falls to 1.36:1 and the ring carries
it. Without a seat (spectator, preview) the press is a neutral object colour,
never a player's. A trigger drawn behind the shell is seen against the page,
so its ring takes the theme's ink: `just banc-visuel`, now run for every seat
in both themes, found the GameCube triggers at 1.07:1 by day before that.

**Second pass: the panel, not yet mounted.** `front/src/manettes/` holds the
single panel that replaces `Bindings` and `SwitchBindings`: a region, not a
modal dialog, opened by one entry (`ouvrirReglage(onglet)`, K05) and hosted
by `HoteReglage`, which returns focus to the opener or to a fallback the room
gives when the opener left with the column rows. One "Fermer"; a real tab
list (arrows, Home, End; inert during a lesson); Escape cancels a capture
before it closes. Both frames share the lesson view, the end count and the
resume after an unplug; the Pro frame paints its two drawings in two roots
(`paintPro`), because both name their sticks `a0` and `a2`. Lesson marks are
set by the input loop's events, outside React (`marques.ts`: frame, wider at
4 s, arrow at 8 s, then nothing; corners on the pressed piece for 650 ms; the
next step cuts the running sequence, D5). Drawing inscriptions keep a 9 px
rendered floor or hide (`inscriptions.ts`, Anybody kept, D4). The `fier`
scene goes through the room's arbiter only when the room is live and the
lesson retained something; a pad arriving plays nothing (K09). Placement is
pure for now: `placeDuReglage` (column at a desk, below when narrow or held
upright, right when held sideways, tablets included) and `largeurPanneau`
(46 % of the window, 560 to 700 px, K24); the touch pad is not mounted while
the panel is open. The wiring in `App.tsx` stays the branch's last commit.
The page weighs 251 536 bytes brotli; a trial build that adds the panel
without removing anything weighs 256 998, so the panel costs about 5 460
bytes before the old dialogs and their `index.css` rules leave.

**Third pass: marks on pixel corners, held rows, still unmounted.** Every
drawn piece now carries its own pixel corners and stepped arrow, hidden by
the stylesheet and shown for the chosen piece, the awaited command and the
lesson marks; the felt rings are gone, and pieces left the tab order (the
list acts, the drawing shows; a mouse click still picks the row). A pressed
piece is joined to the awaited command by a dotted line in a layer over both
`svg`. A held command marks its table row (`data-tenu`, a square in the seat
colour) through a `MutationObserver` on the game drawing; to keep that cheap,
the paint loops write `data-lit` and stick transforms only when they change.
The panel also says the first pad seen while open (no scene, K09), draws an
absent pad as a dithered silhouette, offers "Annuler" after deleting a
profile (`InputStream.rendreKeys`, `SwitchInput.rendre`, neither overwriting
a name taken meanwhile), says a copy waiting for the service with "Réessayer
maintenant", shows the Pro numbers through the bench, and takes a state band
from the room (its action then holds the only filled button). Menu sounds
follow the loop's events: a coin for a retained answer, a low tone on unplug.
The page weighs 251 754 bytes brotli; the trial build with the panel weighs
258 610, so the panel costs about 6 860 bytes before the removals.

**Fourth pass: mounted in the column.** The one `App.tsx` wiring commit
replaces the `bindings` state with `useReglage`: the menu entry, "Changer" of
the key view and a new "Toutes les touches" button at the end of the command
panel all call `ouvrirReglage`, through a room helper that closes the modal
menu (it would make the column inert) and opens the enlarged sheet when the
room is held in hand. `HoteReglage` is the column's view; the frame gets
`largeurPanneau` and the column takes the frame's width while the panel is
open. The key view now reads `InputState.activite` for both frames (K34).
The old dialogs only host the multi-player preparation until the menus work
site moves it to the column, so nothing of their weight is removed yet: the
page weighs 258 978 bytes brotli (+7 224). `reglage-navigateur` proves the
placement at desk and narrow sizes, the entries and focus, the Pro activity
and a lesson on a simulated pad; its red twin runs on 9fb659e. Held in hand,
the panel still lives in the enlarged sheet, which covers the picture: the
place under the picture (portrait) and right of it (landscape) needs the
room frame geometry, which belongs to the `salle` work site. The
`place-tenu` step measures it and stays red, outside the gate.
After the wiring commit, without touching `App.tsx` again: the lesson
marks step only under `.fx-paliers` (full level); the step title shows
"03/16" in display digits that roll at the full level (the socle's
`chiffres` and `compteur`); a refused Pro file plays the socle's low tone;
the device row carries the pixel pad icon; and every clickable piece of
the game drawing gets an invisible hit zone aiming at 24 px rendered,
never reaching into a neighbour (`zones.ts`), while a coarse pointer gets
no clickable drawing at all. `padmap-visuel.mjs` serves its preview through
`vite.planche.config.ts`, which has no relay to the room's ports. The page
weighs 259 484 bytes brotli.

**Fifth pass: named colours and a pressed state that holds twice.** The
plans name their key colours (D3 of the plan): a part's `tint` and `ink`
are of type `Couleur`, `var(--manette-<name>)`, so a literal value does not
compile, and the 29 values live in `regie.css` (the unused `TINTS` and
`--manette-teinte-*` are gone). Reading every tinted key exposed pressed
states at 2.3 to 2.7:1, and a first fix that held against the key failed
`banc-visuel.mjs`, which measures the pressed key against its well, shell
or the page. Both thresholds are now one test
(`lib/manettes-couleurs.test.ts`): every part of every plan, with and
without a seat, in both themes, at 3:1 against the key and against its
surroundings, following how `padmap.css` draws it (a flush part has no
ring; a trigger behind the shell takes the theme ink unless it declares
its own). Three keys get `appui: "clair"`: the seat's light tint with a
dark ring, the only pair that holds against a mid tint inside dark
surroundings. Without a seat, the GameCube press becomes a dark object
green with the light ring, and the shared violet is lighter (#8b7cf0).
The callouts "viser" and "secouer" move off the Wiimote's edge and arcs.
The preview becomes the controller planche (two groups, three sizes,
inscription counts, contrast computed by Chrome in the shown theme, 44 px
toggles), checked by `padmap-qc.mjs` with a contrast twin that must fail
on the Xbox alone. At the full level the lesson's end sentence types
itself out through the socle's `annoncerLettres`, and a refused Pro gesture
shakes its notice. The page weighs 260 043 bytes brotli.

**Sixth pass: the part being changed stays on screen.** Changing a row near
the bottom of the table scrolled the drawings out of view (the framed part
measured at -442 px at 1280 × 720). While that part is not wholly visible,
an `IntersectionObserver` on it (`useHorsDeVue`, `manettes/reglage/
Vignette.tsx`) mounts a 64 px thumbnail in the row: the same plan with a
viewBox cropped around the part (`PadMapView recadrer`), clipped to its box
because the drawings let their outline overflow, laid beside the
instruction, and the row kept in view. Without the observer (jsdom, an old
browser) nothing is mounted and the drawing stays the reference. The
`changer-visible` step of `reglage.mjs` proves it at 1280 × 720 and
390 × 844, fails on the previous page (e62f583), and its twin at
1440 × 900 refuses a thumbnail while the drawing is visible. In the Pro
frame, a stick direction (`lx+`) now frames its stick (`pieceDe`), as the
lesson marks already did. `salle-telephone.mjs` measures the panel itself
through `bindings-preview.html?reglage` instead of the dialogs it replaced
outside a preparation, and found three 19 to 24 px controls, now 44 px. A
refused keyboard publication sounds and shakes like a refused Pro gesture.
The page weighs 260 609 bytes brotli.

**The bench paints itself.** "Les nombres de ta manette" read 0.00 for
every button since `main`: `paintWiring` filled the bench on the root of the
two drawings, and the bench lives beside that root in its own `<details>`.
`Bench` now takes `lire()` (the raw gamepad, or `SwitchInput.pad`) and runs
its own frame loop, painting only while its `<details>` is open; `paintWiring`
no longer calls `paintBench`. A button gauge starts from its learned rest
(`restsOf`, now exported from `lib/wiring.ts`), marked by a line and
"repos 0,62"; without a known rest it follows the value. The stamp is an
`afficheur` (`retro/chiffres.ts`) written without rolling, since it changes
every frame. A non-standard adapter opens its numbers (changement 21).
`nombres.test.tsx` failed first on "0.00"; the `nombres` step of
`reglage.mjs` reads 0.65 and the stamp in the built page, and fails on
842e4c9. The page weighs 261 069 bytes brotli.

**The review of 24 November: four findings.** An independent review found
that an answer never showed its marks: the input loop emits `recu` and the
next `etape` in the same call, and the step cut every mark before a frame
was painted. D5 of the plan is amended: the next step cuts the previous
step's marks (frame, wider frame, arrow), not the answer that closed it.
`marques.ts` now runs two sequences: a new answer cuts the previous one, the
end lets the last answer finish, an unplug cuts both. The line goes to the
command the answer names, so "Changer" draws it too, and a stick answer
(`a1-`) finds the stick drawn on the right (`a0`). The tests subscribe to
the real `InputStream` and `SwitchInput`. Second, "Régler pas à pas" and
"Commencer" disappear at their own click and left focus on the document,
where the panel's Escape never arrived: the invite now takes focus on
"Commencer" and cancels alone on Escape, a starting step focuses its title,
and a block that leaves holding focus hands it to "Reprendre", the first
skipped command or "Régler pas à pas", never taking it back from outside the
panel. The panel reads "busy" when the key arrives, since the Pro frame
changes without rendering it. Third, the keyboard profiles and the Pro
frame's notices were written outside `lib/mots.ts`; a rule in
`mots.test.ts` now refuses any sentence under `manettes/` and in
`media/switch.ts`. Fourth, held in hand the panel still covers the live
picture inside the enlarged sheet. Its place needs a slot from
`lib/cadre.ts`, owned by the `salle` work site: below the picture held
upright, right of a narrowed picture held sideways. Only the two comments
that claimed otherwise are corrected here, and `place-tenu` stays red outside
the gate. `reglage.mjs` gains `marques` (read on every frame) and
`focus-pas` (keyboard only), both red on 9b1c8e8. The page weighs 261 286
bytes brotli.

**The end of the work site (24 November, evening).** On
`chantier/retro-fin-manettes`, from `integration/retro` (928bd03). The old
dialogs `Bindings.tsx` and `SwitchBindings.tsx` are removed with their
tests, `usePreparationPro` (the Pro half of the preparation they hosted) and
38 dead classes of `index.css`, all named by `classes.test.ts`, which now
also reads `padmap.css` and `reglage.css`. The preparation is one block for
every console (`Preparation`, menus): its Pro launch sends the Pro pad
(device 4) in one gesture, tested on the block and in `parcours-navigateur`
(`preparation-x360`). Your typed label (D7 of the plan) sits in the legend
of "Ta manette": the seat number in its ink and the `Etiquette` ribbon,
beside the drawing, never on the shell, nothing for a spectator.
"Touches et manettes" has its own row at the head of the column, right
under "Signaler", which stays first (K25), for whoever holds a seat, and an
entry in the room sheet at mid height when its row fits (the sheet never
scrolls; at 375 × 667 during a game a fourth row would, and the entry stays
in the whole room). Held in hand, the panel no longer lives in the enlarged
sheet over the picture (review finding 4): the frame sets
`Geometrie.reglage`, below the picture held upright down to the safe-area
bottom, at the right held sideways (380 px at most, half at most), and the
room mounts it there; a pad-only page (removed by D47) has no picture to spare and no such
rectangle, so the enlarged sheet still carries it there (`manette-seule`,
red on 672dcb6). `placeDuReglage`, a rule nothing read, is gone.
`place-tenu` enters the gate with `rang`, `etiquette` and
`feuille-reglage`; all four fail on their defect on 928bd03. The page
weighs 278 234 bytes brotli (−1 413 on 928bd03).

#### D42 addendum, 2026-11-25: one held place for the panel, the room's

The end-of-track work of the room (dc7f232) and of the controls (29f1486)
each wrote the held place of the panel, from the same decision and the
same base. Two rules cannot both hold, and `lib/cadre.ts` belongs to the
room work site (the partition of the retro theme; D39, amended at the end
of the room's track, describes the kept rule): the final integration keeps
`reglageTenu` and `REGLAGE_TENU`, and drops `REGLAGE_TENU_MIN` and
`REGLAGE_TENU_LARGEUR`. The numbers in the paragraph above change
accordingly. Upright, the picture shrinks only to leave the panel 280 px,
not 240. Sideways, the panel takes 42 % of the width between 300 and
520 px, not 380 px at most and half at most. A pad-only page (removed by D47) receives the
same place under the bar, where its pad is not mounted during the panel,
instead of the enlarged sheet: the frame gives one rule to every held
page, and `manette-seule` only asks that the panel be visible, which both
rules satisfy. The controls keep what is theirs: the column row, the sheet
entry, the label, `reglage.mjs` and its red pages. `reglage-place.test.ts`
now reads `REGLAGE_TENU`; four mutants of `reglageTenu` (the picture keeping
the whole width sideways, the picture not shrinking, the panel 20 px
higher, a pad-only page without a place, until D47) each fail their test. One
`.n3-reglage-tenu` rule remains, in `telephone.css` with the room's other
held places: the copy in `reglage.css` loaded only with the panel's module.

### D43: The worker publishes the milestones of its start, 2026-11-23

The loading screen said « the game started in the room » by guessing: the page
only knows what it paints, and the lobby only knows that the worker accepted a
launch. The worker knows each milestone and did not publish them (plan
« donnees », lot 2).

Decision:

- **`/roms` gains three fields, added when the route is served**, not by the
  library (`nel3ab_transport::browser::jalons`): `depuis_ms`, the wall-clock
  time this worker started its game or menu; `moteur: "lance"` once Dolphin's
  session or an external room's adapter has started; `image_ms`, the wall-clock
  time of the first video packet OFFERED by `BrowserServer::send`, set once by
  a compare-and-swap. A milestone not reached is absent, never `false` or `0`.
  The library's reference strings are unchanged, `mark_idle` keeps the
  milestones since they are not stored in the catalogue, and the frame path
  pays one relaxed atomic load per packet. Adapter rooms (Switch, Xbox 360)
  send their frames through the same `send` (`ingress.rs`), so they are
  covered.
- **Wall clock, on purpose.** The lobby compares these times with its own
  wall-clock launch time on the same machine; the worker's monotonic clock
  means nothing outside its process.
- **`Room.partie {lance, image, depuis_s}`** reads them. A worker that predates
  these fields gives three `None`, never « not started »; a worker that does
  not answer (it is restarting) gives `partie = None` even though the previous
  library stays displayed, because the old game's milestones would claim an
  image for a game that no longer runs.
- **What `image` proves.** A packet left the worker, not that a page painted
  it (rule « A game's frame counter does not prove the picture players see »):
  the sentence is « the room is sending the picture », and the page keeps its
  own count of painted frames.
- **The usual startup time of each game is measured, not assumed (D05).**
  `nel3ab_control.demarrages` starts a clock when the worker accepts a launch
  (`RoomController.lance`, the single entry both socket paths now call) and
  stops it on the first `image_ms` of a NEW worker (`depuis_ms` after the
  launch) running that key. Both ends are wall-clock times on the same machine,
  so the result does not depend on the one-second polling. One JSON line per
  start, with no person in it, in `NEL3AB_DEMARRAGES_FILE` (overridden by the
  autouse test fixture). `Game.demarrage {mediane_s, p90_s, n}` covers the last
  twenty successful starts of that key, and only from five: below that the page
  keeps its constants and does not say « usually ». A launch that comes back
  on another game or on the menu, or without an image after ten minutes, is an
  « abandon » line, never counted; an impossible duration is not written. The
  lobby reads at most the last 4 MiB of that file, from its end: the most
  recent starts are the ones that count. Each line is written to its last byte
  (`write(2)` may write less than it is given), and a line that a full disk or
  a stopped lobby left without its newline gets one before the next, the same
  guard as the play journal: otherwise the next measurement would be glued to
  it and lost with it.
- **« I'm staying » is one byte on the pad socket (D16).** `Reste` (tag `0xE1`,
  next to the echo's `0xE0`, a length no other message of that channel has)
  stamps the seat's last gesture like a non-neutral frame, so the inactivity
  close and the absent-owner rule both see it, and puts nothing in the
  emulator's input. An unknown single byte is ignored and the socket stays
  open (before, any one-byte message reached the pad decoder and closed it). A
  spectator has no pad socket, hence no button. The page method `reste()` in
  `media/input.ts` waits for the controllers track to merge (K34).

**Amended 2026-11-24: the page sends it.** `InputStream.reste()` is in
`media/input.ts` since the controllers track merged into
`integration/retro`. It sends `Reste::TAG` alone on the seat's socket and
returns false without a seat or on a closed socket, so a screen never says
« kept » when nothing left. No screen calls it yet: the closing notice
belongs to the states track.


### D44: The shared logbook: who played, and who watched, 2026-11-24

The owner decided on 2026-11-24 (plan « donnees », D12): the lobby notes who
played and who watched each game, and each person sees in THEIR logbook the
people they played with. Nobody reads anyone else's logbook.

Decision:

- **A watcher writes a « regard »** to the play journal (`parties.py`): a
  session that announces « no pad » opens `regard_debut` (room, game, nickname)
  and closes it with `regard_fin` (seconds, reason) when the game changes, the
  page leaves or is swept as absent, the room closes, or a place is granted. A
  refused place leaves the watcher watching. A repeated announcement keeps the
  same regard. Without an identity, or from a test bench, nothing is written,
  as for a place.
- **Every start line carries the nickname of the moment**, for people who
  never chose one.
- **The list of games reads the other files** (`Parties.tous`) and gives each
  game `avec` (nickname and place of whoever held a place in the same room,
  at the same game, while one of my places ran) and `regardaient` (nicknames
  of the watchers). The current chosen nickname wins over the line's. An
  interval is never extended: a place without a seen end counts for an
  instant, and only touches if it starts during one of mine. No hash nor
  address leaves the lobby; the profile, games and saves readings do not open
  the other files.
- **Cost.** Measured on lgf on 2026-11-24 with twenty files of 5,000 lines
  (19.8 MB, years of evenings): 0.74 s to read them, 1.7 s for a page of fifty
  games compared naively, 0.87 s once presences are indexed by room and game
  and scanned backwards with a running latest end. On a thread, for the games
  list only. The journal started on 2026-11-21 and holds a few lines per person.

Rejected: a whole-house table of every evening (option C of the plan), not
proposed without explicit consent.

**Amended 2026-11-25 (final review): a regard opens only on an intention to
watch.** The room page opens the lobby socket as soon as the identity is
known, on the antechamber too, which shows no picture. `useLobby` announced
« no pad » on connecting and every second, and the lobby opened a regard:
someone left on the antechamber entered every player's « regardaient » and
the welcome page's `regardent`. The page now announces nothing until the
room has called `seat` (« Regarder », « Rendre ma place », or the pad the
worker gave); the lobby keeps such a person as arriving (`seat_pending`).
The lobby is unchanged, so an older page still announces. Proof:
`room.test.tsx` mounts the hook without `seat()` and requires no emission
(red before), and `test_carnet_commun.py` holds the lobby's side: a
connected page that announces nothing is neither in `regardaient` nor in
`regardent`, and « no pad » puts it in both.


### D45: Game pictures without an open room, 2026-11-23

A room serves each game's picture at `/r/N/art/{index}.png` while it runs, from
memory. The retro screens want the picture where no room runs: the lobby's
shelf, a closed room's card, the logbook. The lobby cannot decode a GameCube
banner itself (RGB5A3, the worker's job), and the banner cache holds raw
`.bnr` blobs, not PNG (plan « donnees », finding M3). The owner chose on
2026-11-23: pictures come from the owner's own game files or from an image the
owner drops, and nothing is downloaded.

Decision:

- **The worker writes the PNG it already serves**, at each scan, into
  `art/<sha256 of the key>.png` beside `catalogue.json`
  (`nel3ab_emulator::write_art_files`, called after the library file). A game
  without a picture gets no file; the file of a game that left the library,
  lost its picture or outgrew one MiB (`ART_MAX_BYTES`, the bound of the
  dropped-image reader) is removed. An identical picture is not rewritten.
  Only names of that shape are ever removed. A failure is logged and the room
  plays.
- **Named by the SHA-256 of the key**, recomputed by the lobby. A key is a
  file name with spaces, accents or a leading dot; the hash is 64 plain
  characters and the key is never joined to a path. Both sides pin the same
  `sha256sum` values in a test.
- **No link is followed (D36).** The Dolphin container mounts the session
  folder read-write. The worker opens `art` with `O_NOFOLLOW` from the session
  folder's descriptor, writes each picture under a fresh name (`O_EXCL`) and
  renames it over the old one, which replaces a link instead of following it,
  and lists the folder through its descriptor. The lobby opens the room
  folder, `art` and the picture each with `O_NOFOLLOW`, non-blocking, regular
  files only, one MiB at most.
- **`GET /api/catalogue/art/{cle}`** serves `image/png` with
  `X-Content-Type-Options: nosniff`, without an identity, like the catalogue.
  It reads the room that wrote the FRESHEST catalogue, and only for a game
  that catalogue says has a picture: a file left behind for a game now said
  without one stays silent. The file must start with the PNG signature; strict
  decoding stays in the worker. Every absence is the same 404.
- **The owner drops an image, the lobby writes it beside the game.**
  `PUT /api/catalogue/art/{cle}` (the PNG itself as the body) and `DELETE`,
  for the administrator only, write or remove `<game>.nel3ab.png` in the first
  game folder of `NEL3AB_ROM_DIR` that holds that file as a regular file (the
  worker's scan keeps nothing else, so a link of the same name in an earlier
  folder is not the game), for a game the
  freshest catalogue lists. The body is read in pieces and cut above one MiB
  (413); the lobby checks the signature and the PNG header (one to 1024 pixels
  a side, the worker's bound) and leaves full decoding to the worker. The file
  is written under a fresh name through the folder's descriptor, to the last
  byte even when `write(2)` writes less than it was given, then renamed
  over the old one. A game whose name leaves no room for the image name and
  its temporary name within 255 bytes is refused. The picture appears at the
  next start of a room, which scans the library.
- **For GameCube and Wii, a dropped image now wins over the banner**
  (`banner::dropped_picture`), with the same bounds as the Switch and Xbox 360
  sidecar reader (one MiB, 1024 a side, a complete decode). It keeps the
  banner's publisher and sentence, and gives a Wii game that was never played
  its first picture. Switch and Xbox 360 already read that same file name.


### D46: The mascot is Aïn, the 3 of the logo, played by a planner that reads the page, 2026-11-23

D37 left the mascot abstract: screens ask for a SCENE (`jouer(scene, {hote})`)
and one renderer, `mascotte/rendu.ts`, decides how to play it. The owner chose
Aïn on 2026-11-23 from a playable proposal (`da/ain/`): the 3 of the logo,
alive, one round eye (in arabizi the 3 writes the letter ʿayn, « eye »), two
red feet and the logo's stepped relief. He lives in the logo and leaves it for
his scenes.

Decision:

- **One renderer, the same API.** `rendu.ts` now plugs Aïn into `jouer()`;
  the socle's signature is unchanged and gains one optional field,
  `contexte` (the player, the variant), passed on by the room arbiter
  (`lib/scenes-salle.ts`, still the only arbiter, K10). Three ids join the
  common scenes (`spectateur`, `attente-chargement`, `hoquet`); the salon
  variants keep their scene's id and are chosen by the host (a logo outside
  any `[data-cadre]`). 17 room scenes and 10 salon scenes.
- **His home is the logo at the foot of the column** (K26), on the phone his
  head alone in the bar. The logo leaves the column header; the coin paints it
  at mount. While he is out, his place in the logo is dotted.
- **The planner reads the page, not coordinates.** Every scene asks for
  anchors (`[data-ancre]`), floors (`[data-sol]`) and reads forbidden zones at
  its start, in window pixels: the painted game picture plus 4 px, status
  lines and controls, the words of the event (`[data-texte]`). Each track is
  sampled every 12 ms; an arc that touches is lowered, a track that still
  touches refuses the plan, and the scene falls back to its short version,
  then an animated pose in the logo, then the key pose. A missing anchor is a
  fallback too, never an error: the full versions appear as the other
  workstreams place their anchors (`start-N`, `prise`, the floor marks).
- **Nothing runs between two scenes.** One `requestAnimationFrame` loop per
  scene, stopped with it; at rest Aïn is a canvas painted once. A scene
  yields (jumps to its end) after two frames more than 50 ms apart.
  Reduced motion and level Sobre show the key pose; level Tout adds the eye
  that follows the pointer outside the picture and a reaction to a click.
- **The black screen is his stage until the first picture.** On the plateau
  he plays large while no picture of the current game is painted; the first
  picture cuts him in the same task, and an observer of `data-sans-image`
  cuts him even when nobody asked.
- **Weight.** About 13 kB brotli in the room page (249 436 to 261 523
  bytes, the removed placeholder coin included), against the 8 kB envelope
  of the partition: the owner accepted taking the difference from the
  reserve.
- **The sprite layer has no box.** It is a fixed point at the top left of
  the window; a full-window layer painted nothing but covered the picture
  for the guards that hit-test every box.
- **One Aïn per room.** A scene that starts in one home first brings Aïn
  back from any other home of the same room. While he plays on the black
  screen, the logo of the corner shows his place dotted (`data-dehors`).
- **The board holds every anchor.** `planche.html` replaces Bobine's board:
  drawings, key poses, and a room, a black screen and a lounge that carry
  every anchor the scenes ask for. `just planche-garde` requires the full
  version of every room and lounge scene there, no sprite box on the
  picture, a control or a word, and no animation frame requested by Aïn
  for two seconds after a scene (measured: 0, against 26 in 400 ms during
  one). `cadre-navigateur` step `ain-immobile` measures the same in the real
  page, where the pad pump requests 62 frames a second of its own.
- **The lounge gets a bundle, not a copy of the page.** `just ain-salon`
  builds `src/mascotte/salon.ts` into one IIFE without React,
  `control/nel3ab_control/api/routes/retro/ain.js` (15 237 bytes brotli),
  with a stamp over every module the build read (`ain.SOURCES`);
  `salon.test.ts` refuses a stale or heavier bundle. The lounge workstream
  wires it into its pages (D41).

Rejected: keeping the arbiter of the proposal beside K10 (two arbiters would
disagree on ranks); positions written in the scenes (every layout of
`lib/cadre.ts` would need its own); WAAPI keyframes per scene (a planner
cannot check a path it does not compute).

#### D46 amendment, 2026-11-24: what the planner checked must stay true

An independent review found that the planner's check held only for the
layout it read at the start of a scene. Aïn's sprites live in window
coordinates, in a fixed layer; nothing moved them afterwards. After
`endort`, Ctrl enlarged the live picture under the « Z » bubble, which stayed
there with no time limit; after `decroche`, a narrower window left Aïn outside
the window and the logo empty. The guard step looked only during
`[data-scene]`, so it never saw either. Decision:

- **Every layout change re-reads the scene** (`rendu.ts`, `rajuster`): the
  window, any scroll (captured on the document), the room root's `style`,
  `data-agrandie` and `data-sans-image`, a `ResizeObserver` on each home and
  on the game zone, and a `MutationObserver` on what React adds or rewrites
  in the room. When Aïn shows nothing outside his logo, it returns at once.
  Otherwise, if the logo or the picture moved, or if Aïn, his bubble or an
  object now touches a zone, the scene is cut and Aïn returns home; one who
  waited outside comes back with the key pose of his scene while the state
  lasts. The bubble at home is placed again, or hides when the logo leaves
  what is visible. A home that React unmounts destroys its layer.
- **The key pose is shown in full.** It re-reads the page before placing its
  bubble (the mount-time layout put it where nothing could show it). On the
  black screen, which has no logo, Aïn stands still at his place with his
  bubble, and the corner logo shows his place dotted. What scenes measured
  from the logo is measured, on the black screen, from Aïn himself (a
  virtual logo whose 3 he is).
- **A pose ends with its outage.** When the room lives again (`data-etat`
  back to `vit`), the air, bubble and objects of the outage are cleared and a
  running scene is cut; K06 still plays nothing.
- **The home stays in view.** Beside the picture, the corner sticks to the
  foot of what is visible (`position: sticky`) and the column keeps its
  161 px as bottom scroll padding. K26 (the logo at the foot of the column)
  is unchanged. What scrolls under that foot is hidden, so the planner cuts
  every control and word by the home's sticky ancestor; without that cut,
  every corner scene was refused at 1280 × 720 and 1440 × 900. A `<details>`
  of the column that opens beside the picture scrolls into view, above the
  corner: « Rendre ma place » fell under it.
- **The words of the black screen are the event's.** Its title and phrase
  carry `data-texte`; a control placed inside the game zone (« Choisir un
  jeu ») counts as an obstacle.
- **The drivers' hook exists only in a driven browser** (`navigator.webdriver`):
  it plays without the room's arbiter.
- **Weight.** The room page goes from 261 613 to 262 790 bytes brotli
  (+1 177), the lounge bundle from 15 237 to 16 222 (+985, ceiling 16 800).
  Nothing is removed in this change.

The six floor marks the full versions ask for in the room (`toque`, `siege`,
`rattrape`, `public`, `fiche-sol`, `branche`) and the `panneau` floor are not
placed by this change. They belong on the floors of the salle's control panel;
until the salle places them, those full versions fall back and `data-refus`
says so.

#### D46 addendum, 2026-11-24 night: a START is its round, and a place's words are walls

The integration of the people and mascot workstreams (wave B1) put
`start-N` on each whole place button. The planner does not treat an anchor's
element as an obstacle, so nothing on the place was protected: the name is
written flush with the top of the button, and the short `depart` set the
player's tag astride that top edge, on « 2P libre », at 1280 × 720,
1440 × 900 and 390 × 844. The guard step had seen it, but a twin's
precondition thrown before the verdict hid the three faults for two waves.
Decision:

- **The `start-N` anchor is the START round** (`.rt-bouton-start`), where Aïn
  stands, beside the name and not on it. One anchor per VISIBLE place: on a
  phone, when the container query swaps the row for the four lamps, the
  hidden places carry none (`useRangeeVisible`, read at mount and on each
  resize); the lamps carry none either. The closed room's places
  (`PlacesAuPasse`) follow the same rule.
- **A control that carries an anchor as one of its parts is not a wall**,
  like the anchor's own element; the anchor of a home (the head inside « La
  salle ») does not count, so that button stays a wall. Its words are walls:
  the place number, the name or « libre », « toi », « 3P prêt ! », and the
  names under « Ils regardent » carry `data-texte` (`Etiquette` takes `mot`).
- **The tag of `depart` rests on top of the START**, in both versions,
  never astride it; with a word just above, the planner refuses it.
- **Scenes of people say whose they are.** `usePlaces` passes
  `contexte: { joueur }` to the arbiter for an arrival and a departure, and
  an empty context for someone who starts watching.
- **The step reports what it saw.** In `mascotte-hors-image`, a failing twin
  gives the verdict of the faults already seen and is a precondition only
  when the probe saw none; the twin on the words waits for scenes to end
  instead of requiring a quiet page 300 ms after entry; where and how many
  scenes played is counted from the step's own scenes, not from the entry.
  In `ain-immobile`, a window that starts during a scene is discarded.
  `just mascotte-navigateur-rouge` gains the page of 4ecbc23, which must fail
  `mascotte-hors-image` on its defect.
- **The corner's logo names the site** (`role="img"`, « nel3ab », from
  `mots.ts`), as the column header's logo did before it moved down.
- **The players' dark tints are tokens.** Letters 5 to 8 of Aïn's palette,
  the first step of a relief in a player's colour, read
  `--joueur-1-sombre` to `--joueur-4-sombre`, a « chantier mascotte »
  section of `regie.css` (and its lounge copy): object colours set once for
  both themes, each at least 3:1 against Aïn's yellow body (5.16, 4.71,
  3.65 and 3.93:1), against 1.46:1 for player 3's own yellow. The board
  (`planche.tsx`) writes no colour of its own either.
- **The 27 phrases of the proposal stay out of the scenes.** A scene has no
  words of its own: each screen says its event in its own words (`mots.ts`,
  `liaison-mots.ts`), and `jouer()` only passes them to the announcement
  region. This answers the review's remark that they were missing.

Cost, observed in `mascotte-hors-image` on 2026-11-24: on the black screen
(1440 × 900 at rest), the full `arrivee` and `fier` now touch the words of
the event (at 768 and 960 ms) and fall back to their short versions; they
played in full before, when no name was marked (whether they covered one is
not established: at that size the places sit below the window, where the
probe does not look). With a picture, at 1280 × 720
and 1440 × 900, both were already refused by the status line (`#mesures`),
and on the phone only short versions play. The full `depart` still waits
for the `panneau` floor. The room page weighs 279 823 bytes brotli after
this change (279 647 before, +176; a rebuild varies by a few hundred
bytes), the lounge bundle 18 327 (18 304 before).

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

### D47: The pad-only mode is removed, and a stopped session stays stopped, 2026-11-27

On 2026-11-26 the owner's room page switched to « manette seule », which the
owner had not meant to choose. One path, read in the code and not
reproduced: the menu row was a radio group, which changes on a left or right
arrow, from the keyboard or from the controller. The browser kept the choice
(`nel3ab:padonly`). On a desk nothing said why the picture was black:
the notice needed the held-in-hand panel. Coming back to the picture rebuilt
the media session, and the old one, already stopped, was restarted in the
same instant: an `App` effect still called `video.start()` and
`sound.setIdle(false)` on it, and its sound wake-up listener, still attached,
restarted its sound on the click. The volume set only the new session, so at
0 % the old one kept playing. Evidence: the worker's journal counted two
pages listening and two watching for one page, from 23:44:33 to 23:53:53 UTC,
while the lobby saw one visit and the page reported its own sound closed from
23:49:30. On the `etats-navigateur` bench, the round trip left two picture
sockets open. `media/session-fin.test.ts` reopens the picture through
`video.start()` and the sound through a click on a stopped session.

Decision (the owner, 2026-11-27): the mode is removed entirely. Weighed:
keeping it on touch devices only, changed by an explicit confirmation, with a
« Remettre l'image » button. What is given up: 13.6 Mbit/s per device beside
a television (a Dolphin p95 of 2026-08-19). The page stops reading the key and
erases it at boot (`oublierManetteSeule`). The lobby no longer records the
`manette` flag an older tab still sends. Gone with it: the menu row,
`ManetteSeule` and its latency sentence, the `seule` role and geometry of
`lib/cadre`, the loading and veil exceptions, the link state's `manetteSeule`
signal and `Session.padOnly`. `useSession` builds one session per page.

Whatever rebuilds a session later, a stopped one stays stopped.
`Session.stop()` calls `VideoStream.fermer()`, after which `start` does
nothing; `stop` stays a pause, used when the room is idle. `SoundStream.stop()`
is final for `start` and `connect`. Each guard has its own failing line in
`session-fin.test.ts`, and its twin pauses and resumes a live session. The
browser proof is the `sourdine-une-session` step: a device that kept « oui »
gets one picture socket and one sound socket, the menu has no such row, and
the column's mute closes the only sound socket while the picture stays. It is
red on the page of 6ad0415. `colonne.mjs` (`just browser-colonne`) needed the
mode to show a column without pictures; its checks moved to the
`colonne-tiree` step on the bench, which sends pictures. That step found the
volume figure 12 px outside a 256 px column on the page in service, fixed by
letting the slider shrink (`min-w-0`). The first overflow now comes at
192 px, so 256 px is a choice and no longer a measured floor.

### D48: The page's jitter margin grows on bursts, capped 30 ms above its start, 2026-11-27

The page drops a decoded picture for two opposite reasons. A queue overflow
says the schedule is too late for the queue: on 2026-08-17, growing the
margin made it worse. Catching up a picture that arrived after its time says
the schedule is too early. Since 2026-09-09 both drops went into one counter,
and a single drop in a window stopped the margin from growing. On 2026-11-26
a remote player's page (Firefox 160 on a Mac, through Tailscale) kept its
margin on its 3 ms floor for 4 min 21 s, with 515 empty-queue episodes and
460 pictures never shown, while the capture held a regular 60 pictures a
second. These are findings VID-1 and DON-1 of the read-only audit of the
Switch 1 chain (2026-11-27).

Weighed:

1. Keep the rule. The margin then depends on the luck of a window without
   any drop.
2. Separate the two drops, with no bound. The audit's simulation gives a
   margin of 54 to 64 ms and a median delay at the glass of 85 to 143 ms.
3. Separate the two drops and cap what a catch-up lets the margin add. The
   owner chose this on 2026-11-27: « lisse, retard plafonné » (smooth, with a
   capped delay).
4. A « reactive or smooth » setting for each player. Postponed until an
   evening shows that players feel the difference.

Decision: option 3. A catch-up no longer blocks the margin. On starvation the
margin grows up to 36 ms (its 6 ms start plus 30), and without starvation it
comes down. An overflow still blocks it, as on 2026-08-17. Above 36 ms the
margin follows the old rule, computed from the same windows. The automatic
switch to the half format is decided on the margin the old rule would have
set. The old rule stays behind `?marge=ancienne`, so one page can be compared
with itself blind, and the page's ten-second report names the rule in
service (`marge`). On a screen twice as fast as the source (120 Hz for 60
pictures a second), a picture one period late is now shown for one tick
instead of dropped.

Consequences. On a bursty link the schedule can take up to 30 ms more. In
simulation, with 130 ms held back once a second for 30 s, drops fall from
126 to 78 and the longest stop from 142 to 133 ms, while starvation episodes
stay at 56 and the schedule rises from 81 to 113 ms. The cap does not cover a
130 ms hole, so the audit's target of fewer than 0.5 starvations a second is
not reached. On the states bench (headless Chrome at 60 Hz, bursts of 100 to
150 ms) the margin reaches 36 ms, and stays at 3 or 4 ms on the page of
b5f21f8. A simulation and a bench are not an evening: the gain for the eye is
not proven. It is judged at the owner's, on the remote player's link, in
alternating phases between the default page and `?marge=ancienne`.

The cap is one constant, `CATCHUP_SLACK_MAX` in `front/src/media/clock.ts`.
The margin's step is a pure function in the same file, `pasDeMarge`, and a
test checks that the half format switches in the same window as under the
old rule. The branch report had called the opposite mutant equivalent. The
review found a sequence of windows where that mutant switched one window
later, at window 29 instead of 28.

### D49: The page can give back the sound delay of a burst, but only under `?son=rendre`, 2026-11-27

The page places each sound chunk right after the previous one. The real
queue came back to its target only through a gap. After a stop followed by
its burst, the delay stayed for the whole session: 320 ms in the sound bench
after a 300 ms stop, while the report's `son.avance`, which is the target of
the next re-anchoring, read 10. A sound card slightly slower than the room
did the same, up to the 500 ms bound of the scheduler (audit finding SON-1).

Weighed:

1. Keep the rule. The sound stays late on the picture, and the lip-sync
   option carries that delay over to the picture.
2. Re-anchor at once when the queue exceeds its target. Each re-anchoring is
   a sound gap.
3. Cut gradually, with a fade, what the smallest queue of the last two
   seconds holds above the lead.
4. Resample the sound slightly in an AudioWorklet. Gentler to the ear, much
   more code: postponed.

Decision: option 3 is written but off by default (review of 2026-11-27). The
cut runs only when the room's address carries `?son=rendre`, read by
`rendreDeLAdresse` in `front/src/media/sound.ts`. It starts 10 ms above the
lead and cuts one chunk in five at most. It keeps 2 ms of the cut chunk,
faded out, and fades the next chunk in over 2 ms. No cut leaves the queue
under the lead. The page reads the smallest queue rather than the mean, so it
never cuts what the jitter needs. The report writes the real queue
(`son.file`) and the sound given back (`son.rendu`), null while the cut is
off. The two address flags combine: `?marge=ancienne&son=rendre`.

Why off. On a link whose stalls come back with different sizes, the cut also
gives back the margin that the next, longer stall would have used, and that
stall becomes a gap. The first negative twin was a link with ±8 ms of jitter
and no stall. In the sound bench, in simulated time over ten minutes, stalls
of 100 to 160 ms every 0.7 to 1.3 s made 31 sound gaps with the cut and 2
without it. Every 3 to 10 s they made 37 against 2, and every 10 to 40 s,
33 against 1, while the median queue fell only by 15 to 20 ms. The remote
player's link stalled 117 to 166 ms in every ten-second window on
2026-11-26, and that player's sound had no gap for six minutes. Regular 130 ms stalls,
the only shape the first tests knew, cost no extra gap. Three other settings
were tried in the same bench: the smallest queue read over 10 s to 5 min, a
pause after a gap, and 30 s of calm before any cut. Each keeps extra gaps
somewhere, or lets the clock drift climb back to 171 ms. These shapes of
stall are invented. The real shape of that link is not known yet; `son.file`
will show it.

Consequences. By default the sound keeps the delay of a burst, as before
2026-11-27, and does not cut on stalls. Under `?son=rendre` it comes back
within seconds to its lead: in the bench, from 320 to 24 ms in two
two-second windows, and a sound card 500 ppm slower than the room stays
between 14 and 22 ms for six minutes instead of climbing to 190. Every stall
longer than the earlier ones then becomes a gap. What the ear hears of a cut
is not measured. The choice is the owner's, on a real evening, in alternating
phases with and without `?son=rendre`, reading `son.trous`, `son.file` and
`son.rendu`, then listening. A test (`son-hoquets.test.ts`) fails if the cut
comes back on by default: 8 gaps in two minutes, against 2.

### D50: A Switch pad is a level, but a button edge holds one picture, 2026-11-27

Since the 64-deep input queue became one slot per port (logbook, § 6.13),
each seat keeps only its newest state, and the Switch pads thread hands only
that one to `pads.py`. That is right for a stick. On 2026-11-26 the remote
player's frames reached the worker in bursts: 18 % of picture intervals
received no frame (audit finding ENT-1). A press and its release in one burst
left only the release in the slot, or reached the virtual pad microseconds
apart, and the game reads its pad once a picture (ENT-2). A test measured
27 to 31 µs of press on the pad.

Decision. The slot also keeps two masks: the buttons that went down and the
buttons that went up in the states nobody took (`browser::Unread`). The
Switch pads thread (`transport::edges`) tells a lost edge, and keeps every
button in its new state for at least `HOLD`, 20 ms, before it follows the
page. A rescued edge waits too, until the previous edge of the same button
has held for `HOLD`; each seat keeps a mask of owed edges for that. Rescued
at once, a release cut the press before it to 5 ms, which the game could miss
(review of 2026-11-27). One pending state per seat and a few masks, never a
queue: two lost edges of the same button merge into one if the first is not
told yet, and a triple edge in one read (press, release, press) is still
lost. The thread wakes at the due time instead of its 50 ms idle wait.
Sticks stay last-wins. Dolphin is unchanged.

Weighed. A queue of states would keep every edge, but a burst after a gap
would become a delay that piles up. Sending both states back to back does
not help: they reach uinput within microseconds. Lengthening presses only
would lose a release between two presses, and a double tap would read as
one.

Cost. A press shorter than 20 ms reaches the game as 20 ms. A new press less
than 20 ms after a release waits up to 20 ms. 20 ms is one picture at 60 Hz
plus a margin: chosen, not measured. The worker still sends `pads.py` one
state per received frame, identical or not: `pads.py` releases a seat left
one second without a state, and the repeats keep a held button down. The
worker's line « salle externe » counts the edges rescued (`pads_rescued`)
and deferred (`pads_deferred`). Not yet run: `just switch-controls-test` on
the kernel's virtual devices, and the probe program that draws every button,
with 20 taps of 3 ms in one TCP segment, old worker against new, A B B A.

### D51: The black box pauses briefly per freeze, gives each page its start-up, keeps a summary per game and reads only cheap files, 2026-11-27

On the night of 2026-11-26, at 00:33:15 Paris time, the black box took a
« gel » capture of 33,386 ms: Smash was loading, and the page was waiting for
its first picture. That capture opened a five-minute pause, and the game's
only real freeze, 543 ms at 00:36:14, was not captured. Without the false
capture, the real 1,488 ms gap of 00:33:23 would have silenced it until
00:38:23: the pause itself was the defect. The samples said nothing of
thread waits, memory, the graphics card's neighbours or the kernel. The
slowest game of six weeks, Mario Tennis for two on 2026-10-30, had lost its
samples and page measures after seven days.

Decision:

1. A gap measured before a game's first picture is a start-up
   (« démarrage »), page by page. Each page closes its own start-up with its
   first window of pictures, within thirty seconds of the room's; a page that
   arrives mid-game has none. The loading gap that stays among a page's last
   six hundred intervals stays a start-up, written once. A start-up is
   written in the samples, without capture and without pause.
2. A freeze silences its room for one minute (`boite_noire_pause_gel_s`). A
   cadence drop keeps its five minutes. The same freeze takes one capture
   only, even when it lasts or stays visible in several windows of the page.
   A window without a picture continues a freeze only if the wait was
   already running at the end of the previous window.
3. At the end of each game a summary is written in `parties/` and never
   swept. What was not measured is written « non mesuré ». Samples and
   captures stay seven days, configurable (`NEL3AB_BOITE_NOIRE_JOURS`).
4. The two-second sample reads only files whose cost is measured. Process
   descriptors are read at capture only (`gpu-detenteurs.json`), and the
   driver's fdinfo statistics never.
5. Two phases on different kernels are not compared
   (`lire.comparer_phases`, `just boite-noire <day> --phases a-b,c-d`), and
   neither is a phase whose samples do not name their kernel.
6. A process whose descriptor links are refused counts as unreadable, never
   as holding nothing.

Rejected:

- Keep five minutes and exclude only the start-up. Replayed on the evening,
  the real 1,488 ms gap still silenced the freeze of 00:36:14.
- Ignore the first sixty seconds of a game. The real 1.5 s gap of 00:33:23
  was lost.
- Close the start-up for the whole room at the first page. Replayed with
  three pages, the second and third made a 33 s « gel » capture, and the
  real 1,488 ms gap was silenced.
- Keep samples longer. Page measures leave after seven days anyway, and the
  summary is enough to compare two evenings.
- Read fdinfo at every sample. Its cost is not qualified (rule 4 of
  CLAUDE.md).

Consequences. A real freeze in the first window of pictures of each page is
no longer captured. A summary weighs about 2 KiB for seven minutes and grows
by about 12 KiB per hour of play, estimated on invented windows. An evening
that freezes without pause takes up to one capture per minute and per room,
2 to 5 MB each. A freeze seen by several pages still takes a page capture,
then a room capture 2 to 4 s later: that scope rule is older than this
decision and is not settled. A sample costs 18.4 to 18.9 ms in median,
measured with a 123-thread stand-in process at rest, under the 30 ms bound.
The refusal behind item 6 is read in the kernel's code
(`proc_pid_readlink` calls `ptrace_may_access`), not yet observed under the
service, which holds CAP_DAC_READ_SEARCH. The summary names no person,
address or visit. None of this runs before the owner restarts
`nel3ab-boite-noire` with no room open.

### D52: Ryubing is configured by its command line, not by Config.json, 2026-11-27

Without a window, Ryubing reads Config.json only when it is given
`--use-main-config` (HeadlessRyujinx.cs:148-151); otherwise its configuration
comes from its command line alone. On 2026-11-26 its log said
« BackendThreading set to: On », then « Backend Threading (Auto): True ». The
`backend_threading: On` written on 2026-09-16 into the template and the
thirteen Switch saves never took effect. On Vulkan, Auto already means a
render thread, so players lost nothing. But a measurement that changed
Config.json would have compared two identical arms.

Decision. The room writes `--vsync-mode`, `--backend-threading` and
`--memory-manager-mode`, read from `switch.json` (`vsync_mode`,
`backend_threading`, `memory_manager_mode`). The defaults are the values in
effect that night: Switch, Auto, HostMapped. An unknown value stops the room
before any container starts; the names are case sensitive, as the engine's
parser is. Custom is refused while the room does not set
`--custom-refresh-rate`. The room does not pass `--use-main-config`.

Reasons. The thirteen Config.json files have drifted (versions 70 and 73),
and with `--use-main-config` the room would depend on each of them. A
measurement through Config.json would compare two identical arms.

Consequence. A new engine setting enters through `switch.json` and
`ENGINE_SETTINGS` (`docker/switch-room.py`), with its test. The proof of its
effect is the engine's own log line at the next start, not the command line.
That line has not been read yet: it waits for the next real start.

### D53: A capture's start-up and its relaunches, 2026-11-27

wlroots gives each new recorder one copy of what the screen already shows,
then nothing until the screen changes. On 2026-11-26 that copy, Sway's empty
output 4.5 s after the click, was taken for Smash's first picture.
`demarrages.jsonl` wrote 4.5 s for a start of about 38 s, and the 30-second
guard, counted from that copy, killed a healthy capture 3 s before the first
picture, while Smash loaded its shaders. On 2026-11-21, 36 relaunches of the
Xbox 360 room's capture in 21 minutes stayed invisible to the rule « three
failures in one minute ».

Decision. A recorder's first packet is neither sent to the worker nor counted
by the 30-second guard. The capture asks for a key frame at once and resumes
sending at the first IDR picture. Until the second packet the bound is
`START_LIMIT`, 90 s from the recorder's start; then 30 s without a packet
fail, as before. The recorder's process state is read at every check, so a
stopped recorder (state T) is named within 0.35 s. The sound keeps its 30 s
from the start: parec has no such copy.

The capture exits with 3 (`NOTHING_SHOWN`) when it sent no game picture, and
with 4 (`SHOWN_THEN_FAILED`) after a failure that follows a game picture. The
room stops after three failures in one minute, or, once a game picture was
shown, after three failures in a row without a picture between them. Only 4
arms the second rule. Any other code breaks the series without arming it.
Code 1 is not used for this: python3 also exits with 1 on an uncaught
exception, before any picture, and docker exec exits with 125 to 127, or 128
plus a signal.

Weighed. Starting the recorder only when Sway shows the game's window: not
kept, it adds a dependency on Sway's tree and leaves the copy of a mid-game
restart. Counting the first picture at 30 packets in one second: not kept, a
still first screen never gives them. Keeping the announced frozen picture
instead of stopping the room: left to the owner.

Costs. A mid-game restart loses one picture. A recorder alive but blocked
before its second packet is seen only at 90 s. A game that never draws
restarts its capture every 90 s without end. With the 90 s bound, a real
freeze stops the room about 3.5 minutes after it: the capture exits with 4,
then twice with 3. Not yet seen in a real room: three normal starts of
Smash and one of Mario Tennis, with no « no complete packet » line and 30 to
45 s written for Smash.

### D54: A new shader is waited for, never skipped, 2026-11-27

The owner asked for a game that stays steady with or without shaders being
compiled, at the pace of a console, without speeding the game up. The bench
of 27 November (`spikes/switch-room/banc-stabilite/`) dated every captured
picture and what Ryubing was doing at that moment, on the attract demo of
Mario Kart 8 Deluxe, which plays races on random tracks without a controller.

Without a new shader, the demo is steady: about six 10-second windows in ten
lose no picture, and what is lost falls on a track load (about 200 to 280 ms). With new shaders, a cold start loses about 900 pictures in under
five minutes. Each new program costs about 5 ms of translation on the GPU
thread and about 11.5 ms of driver compilation, and the render thread waits
for it (`ryubing-shader-probe.patch`, 564 programs measured).

Decision. Ryubing keeps waiting for a program that is being compiled. The
room does not skip the draws of a program that is not ready.

Reasons. Skipping them (`ryubing-async-shaders.patch`, `NEL3AB_ASYNC_SHADERS`)
cut the stalls of more than 25 ms from 151 to 70 on a cold start, but the
first demo race of that run stayed black for about 30 s, logo drawn, loading
icon absent, while the next race drew normally: a draw made once was skipped,
and what it set up stayed wrong. A second pair, with a picture every 3 s,
drew both races of the skipping arm, so the fault is intermittent. The
skipping arm also logged 40 « Background pipeline compile missed on draw »
against 0, because a later first draw comes in another state, and that
pipeline is then compiled on the render thread anyway. A console never shows
a missing or black scene; a stall at a first encounter is the lesser harm.

Rejected by measurement on the same bench, cold, Mario Kart 8 Deluxe:
`DOTNET_TieredCompilation=0` (translation 5.9 ms per program against 5.2) and
`DOTNET_TieredPGO=0` (5.35 ms); pipelines compiled without optimisation
(`ryubing-pipeline-noopt.patch`, 9.9 ms against 11.5, no fewer lost pictures,
and the cache would keep the less efficient shaders). Pinning the emulator to
cores was not tried: the whole engine used 1.6 cores during the demo, and its
threads waited less than 1 % of the time for a core.

Consequence. What steadies a game is a cache that has already seen its
content: each game's shader and driver caches are shared by its slots and
kept between games (`cache_mounts`), so each first encounter is paid once on
this machine. Warming a cache before players meet the content is the lever
left, and it writes production caches: the owner's decision.
