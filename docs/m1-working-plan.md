# M1 — Drive Dolphin headless through named pipes

Working document. **Read this before touching anything**: it carries research and
operational lessons that cost real hours to learn, and it is written so a session
starting fresh **on the server** can begin immediately.

---

## 0. Where we are

**M0 is done and pushed.** Workspace, quality gates, CI, ADR. `just check` is
green (fmt + clippy `pedantic`/`nursery` with `-D warnings` + 15 tests).

**M1 delivers**: the `emulator` crate — spawn Dolphin headless, create the input
FIFOs, write the ASCII protocol, and prove the game reacts.
**No video, no network, no GPU capture.** Those are M2 and M3 on purpose: this
milestone must be provable on its own.

---

**Approaches already tried and rejected** live in
[`docs/adr/0001-architecture.md`](adr/0001-architecture.md) under *Rejected
alternatives* — read it before proposing uinput, a browser-desktop stack, or
writing an emulator.

## 1. Research already done — do NOT re-derive it

### 1.1 Named pipes (the whole point of M1)

Dolphin compiles a pipe input backend into **every Unix build**
(`if(UNIX) add_definitions(-DUSE_PIPES=1)`), mainline.

```ini
# GCPadNew.ini
[GCPad1]
Device = Pipe/0/p1
```

ASCII protocol, newline-terminated, written to the FIFO:

```
PRESS A          RELEASE A
SET L 1.0        SET MAIN 0.5 0.5     # 0.5 0.5 == centre
```

**Why this and not uinput**: a pipe binds by **file name**. Player 2 is player 2
because we named the file `p2` — not because an enumeration happened to hold that
order. Four identical virtual pads under evdev are distinguished only by an
integer that changes on hotplug; that single fact produced most of the input pain
we hit before this project existed.

Constraints, all confirmed:
- FIFOs must exist **before** Dolphin starts (`mkfifo` first, then spawn).
- Mainline opens them `O_NONBLOCK` → **no frame-sync guarantee**. Acceptable
  here: the last input wins, and the next frame is ~8 ms away.
- GameCube-shaped inputs only — no Wiimote pointer/motion.
- Keep **one persistent write fd per pipe**. Reopening per write is a syscall on
  the hot path and races the reader.

### 1.2 Headless flags

```bash
dolphin-emu-nogui -p headless -v Vulkan -e /path/to/game.rvz
```

- **`-p headless` is mandatory, explicitly.** Without `-p`, the Linux fallback is
  `x11 → fbdev → headless` with **no retry**, and `PlatformX11::Init()` calls
  `XOpenDisplay(nullptr)` — which fails on a server with no display. The symptom
  is a startup error that looks like a build problem and is not.
- **Rendering stays complete in headless**; only *presentation* is short-circuited
  (`Presenter::Present()` returns early). EFB, XFB, shaders and draws all run.
  This is what makes M2 possible later.
- Vulkan headless needs **neither a surface nor a swapchain**
  (`enable_surface = wsi.type != WindowSystemType::Headless`), which is cleaner
  than `VK_EXT_headless_surface` and works on any conformant driver.
- **Precedent**: `libmelee` / `slippi-ai` have run mainline headless Dolphin
  instances in parallel for years. This path is well travelled.

### 1.3 Dolphin must be built from source

Verified on lgf 2026-08-10:
- **No `dolphin-emu` apt package** on this release (`Candidate: (none)`).
- The Games-on-Whales AppImage **does not contain `dolphin-emu-nogui`** — only
  the GUI binary.

`docker/Dockerfile.dolphin` builds it with `ENABLE_QT=OFF ENABLE_NOGUI=ON` and
ends with `test -x .../dolphin-emu-nogui` so the build **fails loudly** if that
flag ever stops producing the binary.

---

## 2. Unknowns to resolve FIRST (risk-first ordering)

Do these before writing crate code. Each is cheap and can invalidate the plan.

1. **Does the Dolphin build succeed with our flag set?** The `test -x` answers it.
   Budget ~20-40 min on a Ryzen 5 3600. It caches, so it is a one-time cost.
2. **Do pipes work on a headless instance?** A documented *input-gate* bug exists
   in the GUI/X11 world: hotkeys and browser pads die together when the render
   window never gains focus. Pipes should bypass the focus path entirely — but
   **verify it, do not assume it**. This is the single biggest risk to M1.
3. **What exactly must `GCPadNew.ini` contain** for a pipe device? Establish the
   minimal working file and commit it as a fixture.
4. **Does `-p headless` still produce frames we can capture in M2?** Research says
   yes. Confirm cheaply now (e.g. a frame-dump flag) rather than discovering it
   two weeks later.

---

## 3. The server (lgf) — everything you need, and what not to break

### Access
```bash
ssh souhib@192.168.1.33          # LAN IP, key id_rsa
```
⚠️ **Use the LAN IP, not the Tailscale one** (`100.104.234.37`): the tailnet
address intermittently triggers a Tailscale-SSH re-auth that breaks
non-interactive scripts with exit 255.

### Already installed (2026-08-10)
- Rust **1.97.1** + clippy + rustfmt (rustup, `~/.cargo/bin`)
- `build-essential pkg-config clang cmake libva-dev libdrm-dev libssl-dev libudev-dev`
- Docker, with a large existing stack

### Hardware
- **AMD RX 6650 XT** (RDNA2, `radeonsi`/`radv`), `/dev/dri/renderD128`
- VAAPI via Mesa 25.0.7 — **H.264 and HEVC in hardware; NO AV1 encode**
  (that needs RDNA3+; verified: `no such element factory "vaav1enc"`)
- Ryzen 5 3600 (6c/12t), 62 GB RAM, 1.7 TB free

### Test ROMs (already on the server, provided by the owner)
```
~/roms/gc/melee-ntsc.rvz    # NTSC — use THIS one (59.94 Hz)
~/roms/gc/melee.rvz         # PAL — 50 Hz, do not use for timing work
```

### ⚠️ Do not disturb — this is a live server
| Service | Holds |
|---|---|
| **Wolf** (cloud gaming) | ports 47984/47989/48010, `/dev/uinput`, `/dev/dri` |
| **MoonlightWeb** | ports 48443/48080 |
| **Traefik** | 80/443 (public), 8443 (tailnet admin), 8444 (guests) |
| Jellyfin, Sonarr, Radarr, Bazarr, qBittorrent | NFS `/mnt/nas` |
| Beszel, Uptime Kuma | monitoring |

- **The GPU is shared with Wolf.** For any latency or encode measurement, make
  sure no Wolf session is live, or the numbers are meaningless.
- **`ufw` is active.** A container reaching a host service needs an explicit rule
  (`ufw allow from 172.16.0.0/12 to any port <p> proto tcp`). This silently
  *drops* — the symptom is a hang and a gateway timeout, never a refusal.

---

## 4. Plan

| Step | Deliverable | Proves |
|---|---|---|
| 1 | Build the Dolphin image on lgf | the binary exists and runs |
| 2 | Manual smoke test: headless + Melee + a hand-written FIFO | **pipes drive a headless instance** (risk #2) |
| 3 | `emulator` crate: FIFO creation, persistent writers, `InputFrame` → ASCII | the crate encodes correctly, unit-testable with a temp FIFO and no Dolphin |
| 4 | Process lifecycle: spawn, health, shutdown, cleanup | no orphan process, no leaked FIFO |
| 5 | Integration test behind a feature flag | the whole chain, on real hardware |

Steps 3 and 4 are **pure library code and testable without Dolphin** — write the
unit tests against a temporary FIFO first, then let step 5 be the only part that
needs the server.

### Definition of done
- `just check` green.
- An integration test that starts Dolphin headless on Melee, sends a sequence,
  and asserts an **observable effect** — not merely that no error was returned.
- The manual verification procedure written down here.
- No `unwrap`/`expect` outside tests; every error typed with `thiserror`.

---

## 5. Traps already paid for — do not step in them again

- **A stray `enum.py` in `/tmp` shadows the standard library.** Python adds the
  script's directory to `sys.path`, so any `python3` run from that directory
  breaks with `module 'enum' has no attribute 'global_enum'`. Never name a helper
  script after a stdlib module.
- **`ssh host ~/script` expands `~` on the LOCAL machine.** Use absolute paths.
- **Wolf rewrites its own `config.toml`** and may reflow a single-line array into
  many lines. **Parse it, never `sed` a line number** — doing so left orphan lines
  and crash-looped Wolf.
- **Do not restart every media container at once**: it triggers simultaneous
  library rescans over NFS and stalls the machine for minutes.
- **Quote heredocs and avoid nested quotes in `ssh '...'`** — write a script to a
  file and `scp` it. Inline quoting cost several failed runs.
- Prefer `timeout` on every remote command: a hung NFS or a slow `docker exec`
  otherwise blocks the whole session.

---

## 6. Standards reminder (see `CLAUDE.md`)

- No rule without its reason, and the reason is **measured**.
- A negative twin for every positive assertion; red-first for every bug fix.
- Make invalid states unrepresentable before writing a runtime check.
- The binary orchestrates; behaviour lives in library crates.
- The worker must not panic — a panic kills a live game session.
- Conventional Commits with an emoji. **Never** add AI attribution.
