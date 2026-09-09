#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
lab=${SWITCH_LAB:-/tmp/nel3ab-switch-lab}
mkdir -p "$lab/pads"
if docker container inspect nel3ab-switch-pads-probe >/dev/null 2>&1; then
  echo 'The prototype pad container already exists. Stop and remove it before recreating devices.' >&2
  exit 1
fi
rm -f "$lab/pads/devices.json" "$lab/pads/pads.sock"
# CHOWN assigns only the newly created device nodes to this user. DAC_OVERRIDE
# permits writing the mounted user's private command directory. The device
# cgroup grants /dev/uinput alone; physical event nodes cannot be opened.
docker run -d --name nel3ab-switch-pads-probe --network none --cap-drop ALL \
  --cap-add CHOWN --cap-add DAC_OVERRIDE --security-opt no-new-privileges \
  --device /dev/uinput -e "HOST_UID=$(id -u)" -v /dev/input:/dev/input \
  -v "$lab/pads:/run-data" -v "$PWD:/probe:ro" \
  nel3ab/switch-prototype:2026-09-07 python3 /probe/pads.py
# Container creation precedes uinput device creation. Wait for the actual
# socket, not a fixed delay, or Docker may mount yesterday's device numbers.
for attempt in {1..100}; do
  if [ -S "$lab/pads/pads.sock" ] && [ -s "$lab/pads/devices.json" ]; then exit 0; fi
  sleep 0.05
done
docker logs nel3ab-switch-pads-probe >&2
exit 1
