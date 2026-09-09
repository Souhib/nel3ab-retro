#!/usr/bin/env bash
# SIGTERM reaches our supervisor, which requests window closure and waits.
set -euo pipefail
engine=${1:-ryubing}
case "$engine" in ryubing|eden) ;; *) exit 2 ;; esac
container="nel3ab-switch-$engine-lab"
docker stop --timeout 40 "$container"
status=$(docker inspect -f '{{.State.ExitCode}}' "$container")
if [ "$status" != 0 ]; then
  echo "Prototype emulator stopped abnormally (exit $status). Read its logs and lifecycle.json." >&2
  exit 1
fi
