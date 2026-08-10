#!/usr/bin/env bash
# Manual verification that a named pipe drives a HEADLESS Dolphin instance.
#
# This is M1's risk-first step: a documented input-gate bug exists in the
# GUI/X11 world where hotkeys and pads die together when the render window never
# gains focus. Pipes should bypass the focus path entirely — this script is how
# we stopped assuming that and checked.
#
# It deliberately uses hand-written config and raw shell rather than the
# `emulator` crate, so a failure here is Dolphin's and not ours.
#
# Usage: docker/smoke-pipes.sh [seconds]
set -euo pipefail

SECONDS_TO_RUN="${1:-45}"
SESSION="${HOME}/nel3ab-smoke"
ROMS="${HOME}/roms/gc"
IMAGE="nel3ab/dolphin:dev"
CONTAINER="nel3ab-smoke"
RENDER_GID="$(getent group render | cut -d: -f3)"

# Logs are dumped before removal: a container removed on a failure path takes
# the only diagnosis with it.
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
rm -rf "$SESSION"
mkdir -p "$SESSION/Config" "$SESSION/Pipes"

# The FIFO must exist BEFORE Dolphin starts: it scans this directory exactly
# once, during input-backend init, and never rescans.
mkfifo -m 600 "$SESSION/Pipes/p1"

cat > "$SESSION/Config/GCPadNew.ini" <<'EOF'
[GCPad1]
Device = Pipe/0/p1
Buttons/A = `Button A`
Buttons/B = `Button B`
Buttons/X = `Button X`
Buttons/Y = `Button Y`
Buttons/Z = `Button Z`
Buttons/Start = `Button START`
D-Pad/Up = `Button D_UP`
D-Pad/Down = `Button D_DOWN`
D-Pad/Left = `Button D_LEFT`
D-Pad/Right = `Button D_RIGHT`
Triggers/L = `Button L`
Triggers/R = `Button R`
Main Stick/Up = `Axis MAIN Y +`
Main Stick/Down = `Axis MAIN Y -`
Main Stick/Left = `Axis MAIN X -`
Main Stick/Right = `Axis MAIN X +`
Main Stick/Dead Zone = 0.0
C-Stick/Up = `Axis C Y +`
C-Stick/Down = `Axis C Y -`
C-Stick/Left = `Axis C X -`
C-Stick/Right = `Axis C X +`
C-Stick/Dead Zone = 0.0
Triggers/L-Analog = `Axis L +`
Triggers/R-Analog = `Axis R +`
Options/Always Connected = True
EOF

cat > "$SESSION/Config/Dolphin.ini" <<'EOF'
[Core]
SIDevice0 = 6
SIDevice1 = 0
SIDevice2 = 0
SIDevice3 = 0

[DSP]
Backend = No Audio Output

[Analytics]
Enabled = False
PermissionAsked = True

[Interface]
ConfirmStop = False
EOF

echo "==> starting headless Dolphin (${SECONDS_TO_RUN}s)"
# --shm-size is NOT optional. Docker defaults /dev/shm to 64 MiB; Dolphin's
# emulated-memory arena is backed by shared memory and larger than that, so it
# dies of SIGBUS (exit 135) the moment it touches the mapping. It produces NO
# log line and NO message — the user directory is created, the Vulkan shader
# cache is populated, and then the process is simply gone. Measured 2026-08-10.
docker run -d --name "$CONTAINER" \
  --device /dev/dri --shm-size=2g \
  --user "$(id -u):$(id -g)" --group-add "$RENDER_GID" \
  -e HOME=/session \
  -v "$SESSION:/session" -v "$ROMS:/roms:ro" \
  "$IMAGE" \
  --platform headless \
  --user /session \
  --video_backend Vulkan \
  --config Graphics.Settings.DumpFrames=True \
  --exec /roms/melee-ntsc.rvz >/dev/null

# `-p headless` is passed explicitly: without it the platform falls through
# x11 -> fbdev -> headless by NAME MATCH ONLY, with no retry, and PlatformX11
# calls XOpenDisplay(nullptr), which fails on a machine with no display.

set +e
python3 - "$SESSION" "$SECONDS_TO_RUN" <<'PYEOF'
import errno, os, sys, time

session, run_for = sys.argv[1], int(sys.argv[2])
fifo = os.path.join(session, "Pipes", "p1")

# Opening a FIFO write-only + non-blocking raises ENXIO while no reader is
# attached. That turns "has Dolphin opened the pipe?" into a syscall instead of
# a guess, and it is exactly what the emulator crate does.
deadline = time.monotonic() + 60
fd = None
while time.monotonic() < deadline:
    try:
        fd = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
        break
    except OSError as exc:
        if exc.errno != errno.ENXIO:
            raise
        time.sleep(0.1)

if fd is None:
    print("FAIL: Dolphin never opened the read end of the FIFO", flush=True)
    sys.exit(1)

print(f"OK: Dolphin attached to the pipe after {60 - (deadline - time.monotonic()):.1f}s", flush=True)

def send(line):
    os.write(fd, (line + "\n").encode())

# Full state first: Dolphin's initial pad state is only accidentally neutral.
for token in ("A B X Y Z L R START D_UP D_DOWN D_LEFT D_RIGHT").split():
    send(f"RELEASE {token}")
send("SET MAIN 0.5 0.5")
send("SET C 0.5 0.5")
send("SET L 0.0")
send("SET R 0.0")

# Melee sits on an intro movie, then a "Press Start" screen. Mash START and A
# across the whole window so we cross whichever screen we happen to be on.
end = time.monotonic() + run_for
n = 0
while time.monotonic() < end:
    for token in ("START", "A"):
        send(f"PRESS {token}")
        time.sleep(0.05)
        send(f"RELEASE {token}")
        time.sleep(0.05)
    n += 1
    time.sleep(0.3)

print(f"sent {n} START/A press-release cycles", flush=True)
os.close(fd)
PYEOF
PIPE_STATUS=$?
set -e

echo "==> pipe driver exit: $PIPE_STATUS"
echo "==> container still running: $(docker inspect -f '{{.State.Running}}' "$CONTAINER")"
echo "==> frame dump:"
ls -la "$SESSION/Dump/Frames/" 2>/dev/null || echo "   (no Dump/Frames directory)"
echo "==> last log lines:"
docker logs --tail 30 "$CONTAINER" 2>&1 || true
