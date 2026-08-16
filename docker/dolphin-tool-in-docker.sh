#!/usr/bin/env bash
# Stands in for `dolphin-tool` on a host that has no Dolphin installed.
#
# The same trick as `dolphin-in-docker.sh` next door, for a much smaller job:
# the worker asks this to pull `opening.bnr` out of a disc image, and everything
# it needs is one file to read and one directory to write.
#
# Two details are worth stating rather than reading back out of the flags:
#
# 1. **The mounts come from the arguments**, so there is nothing for a caller to
#    configure, forget, or disagree with. The disc is mounted read-only at its
#    own path, which is also what makes `-i` work without translation.
# 2. **`--user`**, so the extracted file belongs to whoever ran this. Without it
#    Docker writes as root, and the cache directory fills with files the worker
#    cannot replace when a disc changes.
#
# No GPU, no /dev/dri, no shared memory: this reads a file and exits. Everything
# `dolphin-in-docker.sh` needs for a running game is absent here on purpose.
set -euo pipefail

args=("$@")
input=""
output=""
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    -i | --input) input="${args[i + 1]:-}" ;;
    -o | --output) output="${args[i + 1]:-}" ;;
  esac
done

[ -n "$input" ] || { echo "dolphin-tool-in-docker: no -i in arguments" >&2; exit 64; }
[ -n "$output" ] || { echo "dolphin-tool-in-docker: no -o in arguments" >&2; exit 64; }

exec docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$(dirname "$input"):$(dirname "$input"):ro" \
  -v "$output:$output" \
  --entrypoint dolphin-tool \
  "${NEL3AB_DOLPHIN_IMAGE:-nel3ab/dolphin:dev}" \
  "$@"
