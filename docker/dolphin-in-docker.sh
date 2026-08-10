#!/usr/bin/env bash
# Stands in for `dolphin-emu-nogui` on a host that has no Dolphin installed.
#
# The integration test spawns THIS as the emulator binary. Everything the
# `emulator` crate does — mkfifo, write the config, open the write end, SIGTERM —
# happens on the host filesystem, and the container reaches the same files
# through a bind mount.
#
# Three details make that transparent rather than approximate:
#
# 1. **The mounts are derived from the arguments the crate already passes.** It
#    reads `--user` and `--exec` out of "$@" rather than taking them from the
#    environment, so there is nothing for a caller to set, forget, or disagree
#    with — and nothing that would tempt the test into `std::env::set_var`,
#    which is `unsafe` in edition 2024 and forbidden here.
# 2. **Each is mounted at its own host path**, so `--user` and `--exec` need no
#    translation and the test exercises the real arguments.
# 3. **`exec`**, so this shell is REPLACED by the docker client rather than
#    becoming its parent. Without it the crate's SIGTERM would kill the shell and
#    leave the container running — the exact orphan the crate is written to
#    avoid. `docker run` proxies signals to PID 1, so with `exec` the SIGTERM
#    reaches Dolphin itself.
set -euo pipefail

args=("$@")
user_dir=""
game=""
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[i]}" in
    --user) user_dir="${args[i + 1]:-}" ;;
    --exec) game="${args[i + 1]:-}" ;;
  esac
done

[ -n "$user_dir" ] || { echo "dolphin-in-docker: no --user in arguments" >&2; exit 64; }
[ -n "$game" ] || { echo "dolphin-in-docker: no --exec in arguments" >&2; exit 64; }

# --shm-size is NOT optional: Docker defaults /dev/shm to 64 MiB and Dolphin's
# emulated-memory arena is larger, so it dies of SIGBUS (exit 135) with no log
# line at all. Verified on lgf, 2026-08-10.
exec docker run --rm \
  --shm-size=2g \
  --device /dev/dri \
  --user "$(id -u):$(id -g)" \
  --group-add "$(getent group render | cut -d: -f3)" \
  -e HOME="$user_dir" \
  -v "$user_dir:$user_dir" \
  -v "$(dirname "$game"):$(dirname "$game"):ro" \
  "${NEL3AB_DOLPHIN_IMAGE:-nel3ab/dolphin:dev}" \
  "$@"
