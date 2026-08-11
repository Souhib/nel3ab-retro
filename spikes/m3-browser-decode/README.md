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

## What to read off it

- **`isConfigSupported`** — a no here ends Option B on the spot.
- **the count of decoded access units** — anything short of all of them means
  the grouping or the stream is wrong, and it says which.
- **the canvas.** Melee's memory-card dialog, or the claim is hollow. Every
  hollow claim in M2 was one nobody had looked at.

The decode latency it prints is a *throughput* figure — the whole file is
submitted at once. Glass-to-glass is experiment 2 and needs a live stream.
