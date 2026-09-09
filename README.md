# Nel3ab Retro

Self-hosted **retro cloud-gaming rooms**. A host opens a room, picks a console and
a game; up to four players join **from their browser**, each with their own
controller. Emulation runs server-side on the GPU.

> Status, **2026-09-09**: one room with GameCube/Wii through Dolphin and Switch
> through a separate Ryubing adapter. Four browser players share the game, with
> controller preparation, personal profiles, spectators and clips with audio.
> Tailscale supplies identity and network access; this is still a private room,
> not an internet-facing service with signed player tokens.
>
> The decisions live in [`docs/adr/0001-architecture.md`](docs/adr/0001-architecture.md).
> The story, in French and for a human, is
> [`docs/carnet-de-bord.md`](docs/carnet-de-bord.md) — also served as a site with
> search and navigation, `just docs-deploy`. Start a new session with the
> [dated project state](docs/etat-du-projet.md), including remaining work and
> the distinction between deployed changes and the Git history.

## Why it exists

The original survey found no existing stack for the required Dolphin GPU export
and shared browser room. The project gives players one emulated console with
four inputs, rather than a desktop per client. Viewers can choose a full or
reduced video stream. Dolphin exports GPU frames directly; the Switch adapter
captures a private display and has different performance limits.

## Layout

| Path | What | Language |
|---|---|---|
| `core/crates/protocol` | Wire types shared by every component | Rust |
| `core/crates/emulator` | Dolphin lifecycle, named-pipe input and external-engine registration | Rust |
| `core/crates/encoder`  | dma-buf → VAAPI, zero-copy (M2) | Rust |
| `core/crates/transport`| WebCodecs over a plain socket, video + sound + input (M3, ADR D9) | Rust |
| `core/crates/worker`   | The binary — orchestration only | Rust |
| `control/`             | Identity, presence, preparation, recovery and personal settings | Python / FastAPI |
| `front/`               | Menus, controller configuration and browser media modules | TypeScript |
| `docker/switch-room.py` | Switch process lifecycle and private save slots | Python |
| `spikes/switch-room/`   | Switch experiments, pinned patches and capture/controller runtime used by the room | Python / Rust / C# / C |

## Development

```bash
just          # quality + GPU + audio clip + Switch save and capture tests
just check    # Rust, Python, frontend and generated contracts; CI's quality job
just gpu-test # the tests only a machine with a GPU can run
just fix     # auto-format and auto-fix
just audit   # advisories + licences (blocking)
just docs    # build the documentation site (strict: dead links fail it)
```

Requires the toolchain pinned in `rust-toolchain.toml`; `rustup` installs it
automatically.
CI also runs documentation and Rust dependency checks in separate jobs. A local
quality pass does not imply those jobs or the GPU tests passed. The
[controller note](docs/ecran-manettes.md) and [Switch guide](docs/switch-room.md)
describe the additional browser and machine checks for their paths.

## Milestones

| | Goal | Testable without |
|---|---|---|
| **M1** | Drive Dolphin headless through named pipes | video, network |
| **M2** | Capture → VAAPI → a valid MP4 on disk | network |
| **M3** | Stream to a browser, gamepad round-trip | — |
| **M4** | Rooms, accounts, library | — |

M1, M2 and M3 are done and measured. What M3 delivered beyond its goal: sound,
four seats, and a pad that learns an unknown controller instead of guessing.
The current room implements part of M4: identity, names, ownership, a catalogue
and shared preparation. Multiple independent rooms and public access remain
future work. The milestone plans retain their original experiments and are
marked historical; they are not the current deployment instructions.

## Legal

You must supply your own game dumps. No copyrighted content ships with this
project. AGPL-3.0-only.
