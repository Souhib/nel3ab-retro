#!/usr/bin/env python3
"""Give the emulator its window-close event before taking its display away."""

# Commands come from our CLI launcher and private compositor, never the network.
# Pass argument arrays without a shell; the emulator path is an operator choice.
# ruff: noqa: S603

import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


def wait_game(child, close_window, stopping, timeout=30, healthy=lambda: True):
    """Keep abnormal exits and forced shutdowns visible to Docker and the report.

    Thirty seconds is a recovery ceiling for this prototype, not a measured
    save duration. It bounds a wedged game; expiry is explicitly a failure.
    """
    requested = None
    acknowledged = False
    forced = False
    while child.poll() is None:
        if not healthy():
            forced = True
            child.kill()
            break
        if stopping.is_set():
            if requested is None:
                requested = time.monotonic()
            if not acknowledged:
                acknowledged = close_window(child.pid)
            if time.monotonic() - requested >= timeout:
                forced = True
                child.kill()
                break
        # The event stays set during shutdown; Event.wait would then busy-loop.
        time.sleep(0.1)
    status = child.wait()
    return {
        "exit_code": status if status >= 0 else 128 - status,
        "stop_requested": requested is not None,
        "window_closed": acknowledged,
        "forced": forced,
        "stop_seconds": None if requested is None else time.monotonic() - requested,
    }


def refresh_hz(environ):
    """The compositor rate the room chose, 60 unless SWITCH_REFRESH_HZ says otherwise.

    This is the rate at which Sway composes on the server, not what players see:
    the game still presents its own 60 or 30 images a second, and the recorder
    copies each one when it arrives. A faster rate only shortens the wait between
    the emulator handing over an image and Sway composing it: 8.5 ms median at
    60 Hz on the test program (2026-09-10), half a period on average.
    """
    text = environ.get("SWITCH_REFRESH_HZ", "60")
    if not text.isdigit() or not 30 <= int(text) <= 240:
        raise ValueError(f"SWITCH_REFRESH_HZ must be a whole number from 30 to 240, not {text!r}")
    return int(text)


def sway_config(width=1280, height=720, refresh_hz=60):
    """The compositor's configuration. Pure, so its one load-bearing line can be pinned.

    The refresh rate is written. Without it, wlroots gives a headless output a
    refresh of zero and composes "when it can", which depends on machine load:
    the real room held 31.5 frames per second on the Looney Tunes title screen,
    almost all in two-period gaps (234 of 249), while an identical probe with an
    explicit 60 Hz held 58.9 (452 of 470 at one period), at the same moment on
    the same machine. Measured 2026-09-09 from the /video stream, as the page
    reads it. The recorder's `-B 60` only declares a rate; this line imposes it.
    """
    return (
        f"output HEADLESS-1 mode {width}x{height}@{refresh_hz}Hz\n"
        "default_border none\n"
        "focus_follows_mouse no\n"
        'for_window [app_id=".*"] fullscreen enable\n'
        "seat seat0 hide_cursor 1\n"
        "xwayland disable\n"
    )


def main():
    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    runtime = Path(os.environ["XDG_RUNTIME_DIR"])
    display_file = Path("/run-data/display.json")
    display_file.unlink(missing_ok=True)
    config = runtime / "sway.conf"
    config.write_text(sway_config(refresh_hz=refresh_hz(os.environ)))
    # Profiling belongs to the game, not the compositor.
    compositor_env = {k: v for k, v in os.environ.items() if not k.startswith("MANGOHUD")}
    with Path("/run-data/sway.log").open("w") as log:
        compositor = subprocess.Popen(
            ["/usr/bin/sway", "--config", str(config)], env=compositor_env, stdout=log, stderr=log
        )
        try:
            # This only bounds compositor startup. No game has started yet.
            deadline = time.monotonic() + 15
            while True:
                sockets = list(runtime.glob("sway-ipc.*.sock"))
                displays = [p for p in runtime.glob("wayland-*") if p.is_socket()]
                if compositor.poll() is not None:
                    raise RuntimeError("Sway stopped before opening its display; see sway.log")
                if len(sockets) == len(displays) == 1:
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError("Sway did not open its private display in 15 seconds")
                time.sleep(0.05)
            env = dict(os.environ, SWAYSOCK=str(sockets[0]), WAYLAND_DISPLAY=displays[0].name)

            def ipc(command):
                result = subprocess.run(
                    ["/usr/bin/swaymsg", "-r", command], env=env, capture_output=True, timeout=2
                )
                replies = json.loads(result.stdout) if result.returncode == 0 else []
                return bool(replies) and all(entry.get("success", False) for entry in replies)

            def close_window(pid):
                try:
                    return ipc(f'[pid="{pid}"] kill')
                except (OSError, subprocess.TimeoutExpired, ValueError):
                    return False

            with subprocess.Popen(sys.argv[1:], env=env) as child:
                temporary = display_file.with_suffix(".tmp")
                temporary.write_text(json.dumps({"display": displays[0].name, "pid": child.pid}))
                temporary.replace(display_file)
                report = wait_game(
                    child, close_window, stopping, healthy=lambda: compositor.poll() is None
                )
                Path("/run-data/lifecycle.json").write_text(json.dumps(report, indent=2) + "\n")
                sys.stdout.write(json.dumps({"emulator_shutdown": report}) + "\n")
                return report["exit_code"]
        finally:
            # The child has exited before the display is removed. SIGTERM here
            # affects only Sway; no display disconnect can race the game's save.
            if compositor.poll() is None:
                compositor.terminate()
                try:
                    compositor.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    compositor.kill()
                    compositor.wait()
            display_file.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
