# Nel3ab Retro

Self-hosted **retro cloud-gaming rooms**. A host opens a room, picks a console and
a game; up to four players join **from their browser**, each with their own
controller. Emulation runs server-side on the GPU.

> Status: **M0 — skeleton.** No session logic yet. See
> [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md).

## Why it exists

No open-source project combines libretro/Dolphin with **hardware GPU cores** and
**zero-copy VAAPI on AMD**. Existing streaming stacks give you one desktop per
client; this one gives you **one game, four players, one video stream**.

## Layout

| Path | What | Language |
|---|---|---|
| `core/crates/protocol` | Wire types shared by every component | Rust |
| `core/crates/emulator` | Dolphin lifecycle + named-pipe input (M1) | Rust |
| `core/crates/encoder`  | dma-buf → VAAPI, zero-copy (M2) | Rust |
| `core/crates/transport`| WebRTC media + input channel (M3) | Rust |
| `core/crates/worker`   | The binary — orchestration only | Rust |
| `api/`                 | Rooms, accounts, library (M4) | Python / FastAPI |
| `front/`               | Web client (M4) | TypeScript |

## Development

```bash
just check   # fmt + clippy + tests — what CI runs
just fix     # auto-format and auto-fix
just test
just audit   # advisories + licences (blocking)
```

Requires the toolchain pinned in `rust-toolchain.toml`; `rustup` installs it
automatically.

## Milestones

| | Goal | Testable without |
|---|---|---|
| **M1** | Drive Dolphin headless through named pipes | video, network |
| **M2** | Capture → VAAPI → a valid MP4 on disk | network |
| **M3** | WebRTC to a browser, gamepad round-trip | — |
| **M4** | Rooms, accounts, library | — |

M1 + M2 are the real test of the idea: ~3 weeks to know whether it stands up.

## Legal

You must supply your own game dumps. No copyrighted content ships with this
project. AGPL-3.0-only.
