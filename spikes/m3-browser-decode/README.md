# M3 experiment 1 — does a browser decode OUR bytes?

The question that can kill Option B of [`../../docs/m3-working-plan.md`](../../docs/m3-working-plan.md)
in minutes, so it runs before anything is designed.

Not "does WebCodecs decode H.264" — that is documented. Whether it decodes the
**exact** stream `encoder::av` produces: ffmpeg's SPS/PPS, no B-frames,
`async_depth=1`, an IDR every 60 frames. `stream.h264` is not a sample; it is
what the end-to-end test recorded out of a running Dolphin.

There is no browser on lgf, so this one is opened by hand.

```sh
cd spikes/m3-browser-decode
python3 -m http.server 8099 --bind 0.0.0.0
# then open http://192.168.1.33:8099/ from a machine that has a browser
```

WebCodecs needs a secure context. `http://` on a LAN IP is **not** one in
Chrome — use `localhost` via an SSH tunnel if the page reports `VideoDecoder`
missing:

```sh
ssh -L 8099:localhost:8099 lgf     # then open http://localhost:8099/
```

## The first run was wrong, and the decoder was right

`decoder error: EncodingError: The given encoding is not supported.`

Not the browser's fault and not the stream's. The page's access-unit grouping
only started a new unit when a **non-slice** NAL followed a slice — so the 118
consecutive P-slices were handed over as **one chunk containing 118 frames**.

Measured on the stream rather than reasoned about: there are no access-unit
delimiters, and there are exactly as many slices as frames. One slice per
picture, so each slice CLOSES a unit and carries whatever parameter sets came
before it. Checked offline before asking for a browser again — 120 units, 2 of
them key, each with exactly one slice, both IDRs carrying SPS+PPS.

The lesson is the M2 one in a new costume: a component that says "not supported"
is usually right about its own input.

## Annex B first, then avcC

The page now tries both packagings. Annex B is what the encoder emits and costs
nothing; avcC is the length-prefixed form with the parameter sets moved into a
`description`, sent once.

Trying both is what makes a "no" actionable. Repackaging is a length prefix and
no latency, so **"needs avcC" is a completely different answer from
"unusable"** — and a page that only tried one could not tell them apart.

## What to read off it

- **`isConfigSupported`** — a no here ends Option B on the spot.
- **the count of decoded access units** — anything short of all of them means
  the grouping or the stream is wrong, and it says which.
- **the canvas.** Melee's memory-card dialog, or the claim is hollow. Every
  hollow claim in M2 was one nobody had looked at.

The decode latency it prints is a *throughput* figure — the whole file is
submitted at once. Glass-to-glass is experiment 2 and needs a live stream.
