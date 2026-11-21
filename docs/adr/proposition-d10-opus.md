# Proposed amendment to D10: live sound in Opus

Status: **proposed 2026-09-23, not accepted.** It enters
[ADR 0001](0001-architecture.md) under D10 only once the owner accepts it. Until
then D10 stands as written: live sound travels as raw PCM.

## What D10 decided, and the condition it set

D10 (2026-08-14) kept live sound as signed 16-bit PCM, 48 kHz, stereo: 1.5 Mbit/s
per listener. It weighed Opus, which carries the same sound in about a tenth of
that, and refused it for what a codec adds on both ends: a dependency and an
encode stage in the worker, and a second decoder in the page, when the first one
(the video decoder) had already cost days of wedges, stalls and starvation, each
needing a watchdog and a recovery path.

It named its own condition for reopening: "somebody playing over a link where
1.5 Mbit/s is a material share of what is available."

## Why the condition is met

Measured on 2026-09-22, the evening Hyde's picture froze repeatedly:

- In the reduced format, sound was **44 %** of what reached Hyde. The half-size
  picture had shrunk; the sound had not.
- The link bench of 2026-09-23 (`just banc-liaison`) shows why that share
  matters on a lossy link. Over TCP, throughput falls roughly as one over the
  round trip times the square root of the loss rate: about 3 Mbit/s at 1 % loss
  and 40 ms. At that ceiling, 1.5 Mbit/s of sound is half the link. Sound rides
  its own socket (`/sound`), not the picture's, so it does not block the picture
  inside one connection; the two connections share the same narrow link, and
  each takes roughly its share of it. Whether removing the sound's share
  actually helps the picture is measured before any code (see "Before any
  code").
- Microphones added a second, upward cost: 768 kbit/s of mono PCM per open
  microphone, on the direction a home connection is weakest.

## What changes

1. **Downward, the worker encodes the room's sound once in Opus** and sends the
   same packets to every Opus listener, as the picture is framed once and shared.
   Settings, to be confirmed on the bench rather than taken from here:
   10 ms frames (the current chunk), 96 kbit/s stereo, the low-delay
   application mode, constant frame size, no in-band FEC.
   - FEC stays off: the transport is TCP, which never delivers a packet with a
     hole, so redundancy would only add bytes (study of 2026-09-22).
2. **The page decodes with WebCodecs `AudioDecoder`** and schedules the decoded
   frames on the same hardware clock as today. Only the source of the samples
   changes, not the scheduling, which is where the lip-sync work lives.
3. **PCM remains, as a fallback and not as a second mode to maintain by hand.**
   The page asks for Opus only when `AudioDecoder.isConfigSupported` says yes,
   and falls back to PCM after a decoder error it cannot recover from. The worker
   encodes Opus only while at least one Opus listener is connected, as the half
   format is encoded only while someone watches it.
4. **Clips do not change.** The worker keeps the PCM it receives from Dolphin in
   the clip ring before encoding; the downloadable clip is still produced from
   that PCM as today.
5. **Upward (microphone) is a second, separate step.** The page encodes with
   `AudioEncoder`, and the worker decodes to PCM before the clip ring, which
   mixes PCM. It follows the downward step, and only after the ten microphone
   defects of 2026-09-23 are committed.

## How the encoder is reached

Two ways were weighed:

| | Through the existing `encoder::av` shim | Through a Rust crate (`opus` or `audiopus`) |
|---|---|---|
| New dependency | none: the system `libavcodec` already carries `libopus` (checked 2026-09-23, `ffmpeg -encoders`) | the crate, and `libopus-dev` on this machine and on the CI runner |
| `unsafe` | inside the module rule 2 already allows, with its `SAFETY` comments and its layout test | inside the crate, none of ours |
| Cost | two C functions in the shim, open and encode, plus a decoder for the microphone | a build dependency CI does not have today |

The proposal is the shim: no new module crosses rule 2, and no new package
enters the machine or the runner. Adding a fourth `unsafe` module is not needed
and is not proposed.

## What it costs, stated plainly

- **A second decoder in the page**, the exact risk D10 refused. It gets the
  watchdog the video decoder has: an error or a decoder that stops producing is
  closed and rebuilt, and repeated failure falls back to PCM.
- **Latency.** In the low-delay mode, Opus adds its frame plus a short look-ahead
  (a few milliseconds) on top of today's 10 ms chunk. To be measured with the
  existing lip-sync driver, not assumed.
- **CPU.** One encode per 10 ms per room, on the worker. To be measured against
  the frame loop, alternating, since the machine drifts (rule 4).

## What Opus does NOT buy here

The plan of 2026-09-23 said that Opus conceals a lost chunk. That is true of the
codec and **not available through WebCodecs**: `AudioDecoder` has no call that
asks it to conceal a missing packet. Over TCP a chunk is never lost anyway, only
late, and a late chunk remains a gap as it is today. The gain is the bytes, and
through them the room the picture gets on a narrow link, not concealment.

## Before any code

The gain is an argument, not a measurement. The clip bench can measure it for
the price of a PCM sound stream in the bench worker: the picture on a narrow
lossy link with the room's PCM sound, against the same link without it (Opus
would carry about a fifteenth of it), alternating. If the picture does not
improve clearly, this proposal is withdrawn.

**Measured 2026-09-23 on the clip bench**, 3 Mbit/s, 1 % loss, 20 ms jitter, the
same clip every run (2.4 Mbit/s of picture), balanced order S N N S S N N S (two
starts failed and are left out):

| | With PCM sound | Without sound |
|---|---|---|
| Pictures received per second | 17.8, 27.0, 20.8 | 38.1, 41.8, 39.9 |
| Broken chains | 5, 2, 2 | 0, 0, 0 |
| Missed pictures | 918, 857, 413 | 0, 0, 0 |
| Sound gaps | 42, 36, 53 | (no sound) |

On a link that cannot carry both, the PCM sound halves the picture and accounts
for every broken chain. The bench says yes. A real evening, where a person on a
weak link alternates the mute (which now closes the sound socket), says whether
the same holds outside the bench: `just soiree <date>` prints the comparison.

## Done when

- Downward sound falls under **0.15 Mbit/s** per listener, measured in the
  worker's log.
- Sound gaps do not increase on the bench, compared by alternating PCM and Opus.
  The clip bench replays video only today; it needs the clip's sound as well
  before this comparison is possible.
- The picture-to-sound offset measured by `lipsync.mjs` does not move.
- The encoder's CPU cost is recorded.

## What would prove it wrong, and undo it

- More sound gaps, or decoder failures the watchdog cannot absorb, on a real
  evening.
- A lip-sync offset that moves and cannot be corrected by scheduling.
- A link where the saving does not change what the picture receives.

Any of these returns the page to PCM without touching the worker: the fallback
in point 3 is the undo.
