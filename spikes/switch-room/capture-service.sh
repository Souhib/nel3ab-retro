#!/usr/bin/env bash
# ExecStop signals the process inside Docker, then waits for its capture lock.
# Restart only the capture, preserving the emulator, browser seats and clips.
# Three starts per minute bound a persistent failure; an explicit stop never
# restarts. One second leaves time for the failed writer to release its lock.
set -euo pipefail
systemd-run --user --unit=nel3ab-switch-capture --collect \
  --property='ExecStop=/usr/bin/docker exec nel3ab-switch-ryubing-lab python3 /probe/capture_control.py stop' \
  --property=Restart=on-failure --property=RestartSec=1 \
  --property=StartLimitIntervalSec=60 --property=StartLimitBurst=3 \
  --property=TimeoutStopSec=15 \
  /usr/bin/docker exec nel3ab-switch-ryubing-lab python3 /probe/capture.py
