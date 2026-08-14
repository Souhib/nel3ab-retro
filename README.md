# Nel3ab Retro

Self-hosted **retro cloud-gaming rooms**. A host opens a room, picks a console and
a game; up to four players join **from their browser**, each with their own
controller. Emulation runs server-side on the GPU.

> Status: **M3 done.** Video, sound and four controllers, played in a browser
> over a private network. **Nothing authenticates anybody yet** — that is M4's
> first job, and it is the reason this is not exposed to the internet.
>
> The decisions live in [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md).
> The story, in French and for a human, is
> [`docs/carnet-de-bord.md`](docs/carnet-de-bord.md) — also served as a site with
> search and navigation, `just docs-deploy`.

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
| `core/crates/transport`| WebCodecs over a plain socket, video + sound + input (M3, ADR D9) | Rust |
| `core/crates/worker`   | The binary — orchestration only | Rust |
| `api/`                 | Rooms, accounts, library (M4) | Python / FastAPI |
| `front/`               | Web client (M4) | TypeScript |

## Development

```bash
just         # the gate before a commit: check + gpu-test
just check   # fmt + clippy + tests — exactly what CI runs
just gpu-test# the tests only a machine with a GPU can run
just fix     # auto-format and auto-fix
just audit   # advisories + licences (blocking)
just docs    # build the documentation site (strict: dead links fail it)
```

Requires the toolchain pinned in `rust-toolchain.toml`; `rustup` installs it
automatically.

## Milestones

| | Goal | Testable without |
|---|---|---|
| **M1** | Drive Dolphin headless through named pipes | video, network |
| **M2** | Capture → VAAPI → a valid MP4 on disk | network |
| **M3** | Stream to a browser, gamepad round-trip | — |
| **M4** | Rooms, accounts, library | — |

M1, M2 and M3 are done and measured. What M3 delivered beyond its goal: sound,
four seats, and a pad that learns an unknown controller instead of guessing.

## Legal

You must supply your own game dumps. No copyrighted content ships with this
project. AGPL-3.0-only.
