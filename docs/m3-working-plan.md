# M3 — Get the stream into a browser, and the buttons back out

Working document, same contract as [`m2-working-plan.md`](m2-working-plan.md):
research that cost real hours lives here so the next session does not re-derive
it, and **the risky unknown is settled by experiment before any crate code is
written**.

---

## 0. Where we start

M1 and M2 are done and measured. Input reaches a headless Dolphin; the rendered
frame leaves it without ever touching the CPU and comes back as H.264 for
**0.017 of a core** and about **1.3 ms** of GPU time per frame.

What M3 owes: those bytes arriving in a browser, and 13 bytes of pad state
arriving back, both fast enough that a player cannot feel the round trip.

**M3 delivers**: a browser tab showing the game and driving it. Not the room
UI, not authentication, not four players negotiating slots — that is M4.

---

## 1. The decision M3 exists to make

Everything else in M3 follows from one fork, and it is genuinely open:

> **Do we speak WebRTC, or do we send H.264 over a plain transport and decode it
> with WebCodecs?**

Both put our existing bitstream on a screen. They differ in what they hand us for
free and what they make us build.

### Option A — WebRTC

The standard answer for low-latency video to a browser. `webrtc-rs` in process,
or GStreamer's `webrtcsink` out of it.

**What it gives us**: packet loss recovery (NACK, and FEC if asked), congestion
control that actually backs off, NAT traversal, and a DataChannel for the pad
that inherits the same path. All of it battle-tested by every video call on the
planet.

**What it costs**: SDP negotiation, ICE, DTLS, SRTP, RTP packetisation of our
stream — a large surface we do not control, in front of an encoder we now do
control precisely. And a jitter buffer whose depth is the browser's decision,
not ours, which is the one thing this project has been unwilling to accept
anywhere else.

### Option B — WebCodecs over WebTransport or WebSocket

Send the Annex B bytes we already produce. The page feeds them to
`VideoDecoder`, which is the same hardware decoder WebRTC would have used.

**What it gives us**: we keep control of *when* a frame is submitted, which is
the property D7 fought to keep on the encode side. No SDP, no ICE, no RTP. The
server side is a socket and a loop.

**What it costs**: everything WebRTC gave us for free. Loss means a broken
picture until the next IDR unless we build recovery. Congestion control is ours.
And it needs HTTPS, which this deployment has anyway through Traefik.

### Why this is not obvious

The usual argument for WebRTC is loss and NAT. **Neither is the situation this
project is in.** It is self-hosted, reached over a LAN or Tailscale, by a handful
of people the host knows. A protocol built for a lossy internet path between
strangers is solving somebody else's problem — and charging us a jitter buffer
for it.

Against that: "our network is good" is an assumption, and this project's whole
method is to distrust those. Wi-Fi drops packets. A phone on 5G would too.

So the decision needs evidence, not a preference.

---

## 2. The experiment that settles it

Two questions, in order. The first can kill Option B in minutes, which is why it
comes first.

### Experiment 1 — does a browser decode **our** bytes?

Not "does WebCodecs decode H.264" — that is documented. The question is whether
it decodes the exact stream `encoder::av` produces: ffmpeg's SPS/PPS, no
B-frames, `async_depth=1`, an IDR every 60 frames.

A page that opens a WebSocket, receives the recorded stream from the end-to-end
test, feeds it to `VideoDecoder`, and draws the frames. If it refuses the
configuration or produces nothing, Option B is dead and we stop reading about it.

**Ran 2026-08-11. It passes, and without repackaging.**

```
125 NAL units: {1:118, 5:2, 6:1, 7:2, 8:2}
grouped into 120 access units, 2 of them key
SPS says the codec is avc1.640c1f
Annex B, as the encoder emits it: decoded 120 of 120 access units
first frame after 40.0 ms
```

Melee's memory-card dialog on the canvas, looked at. So the browser takes the
bytes `encoder::av` already produces — no length prefixing, no `description`, no
reshaping. The avcC fallback the page carries was never needed.

**Two numbers from that run must not be quoted as latency.** The page prints
`p50 178 ms, max 303 ms` submit-to-output, and that is *throughput*: the whole
file is handed over in a tight loop, so every frame's figure includes queueing
behind all the frames submitted before it. It says the decoder chewed 120 frames
in about a third of a second. It says nothing about how long one frame takes.
The 40 ms to first frame is real, and is a one-off: decoder configuration and
hardware init.

It also took a wrong turn worth keeping. The first version of the page grouped
access units by starting a new one only when a non-slice NAL followed a slice,
so 118 consecutive P-slices went over as **one chunk of 118 frames**, and the
decoder answered `EncodingError: The given encoding is not supported`. It was
right about its own input. Fixed from a measurement — this stream has no
access-unit delimiters and exactly as many slices as frames — not from
reasoning.

### Experiment 2 — what does each option actually cost in latency?

Only if experiment 1 passes. The same page, with a timestamp travelling beside
each frame, against a WebRTC path carrying the same stream. Measured on the same
network, in the same browser, back to back.

The number that decides it is **glass-to-glass**, not decode time: how long from
the encoder handing us bytes to the pixel being on screen.

### What would make the answer WebRTC regardless

Written down now, before the measurement, so it cannot be rationalised later:

- WebCodecs refuses our stream, or needs it reshaped in a way that costs latency;
- the loss behaviour on a real Wi-Fi client is visibly worse and no cheap fix
  exists;
- the glass-to-glass difference is under a couple of milliseconds — at which
  point the free NACK and congestion control are simply worth more.

---

## 3. The other half nobody should forget

Video is the loud half. **The pad is the half that decides whether it feels
right**, and it is 13 bytes at 60 Hz — nothing, by bandwidth.

Whatever carries it must not be head-of-line blocked behind a video frame. That
is an argument the two options do not split evenly:

- WebRTC gives a DataChannel that can be unordered and unreliable, which is
  exactly right for pad state — a dropped frame of input is better than a late
  one.
- WebSocket is TCP and **will** block the pad behind a video packet it is
  retransmitting. WebTransport datagrams would not.

So if Option B wins on video, the pad probably still wants WebTransport rather
than WebSocket, and that has to be part of the same measurement rather than an
afterthought.

M1 already made this cheap: the wire format is
[`nel3ab_protocol::InputFrame`], 13 bytes, and `encode_delta` already collapses
a burst into the smallest legal set of commands.

---

## 4. What is NOT in M3

- The room UI, slot negotiation, authentication — M4.
- More than one player. The protocol supports four; proving four at once is a
  load question and belongs after the transport is chosen.
- Adaptive bitrate. The encoder is fixed-QP today. Rate control comes when
  there is a real network to react to, and not before there is a measurement
  saying which direction to react in.

---

## 5. The order to work in

1. **Run experiment 1.** A page, a socket, and the recorded stream from
   `/tmp/nel3ab-dolphin-chain.h264`. Nothing else gets designed until it answers.
2. **Record the decision as an ADR entry** — D9 — with what was measured, the
   same way D5, D7 and D8 were.
3. Then, and only then, the transport crate: `crates/transport` exists and is
   empty.
4. The pad path, measured on its own. A latency number for video says nothing
   about input if they travel differently.
5. End to end, in a browser, with a controller, and **played** — the equivalent
   of looking at the decoded frame in M2. A number is not a verdict about feel.

---

## 6. Traps carried over

- **`just check` before pushing, and watch the run.** Twice in M2 a push went out
  red; both times the failure was visible beforehand.
- **A test that cannot fail is worse than none.** M2 produced three tests that
  read the right thing in the wrong place. For a network, the shape to watch is
  a test that passes because both ends agree on the same mistake.
- **Look at the result.** Every claim in M2 that turned out hollow was one
  nobody had looked at — the all-black frame, the 99.6 %-wrong readback, the
  packet-size assertion. A stream that "arrives" is not a stream that plays.
