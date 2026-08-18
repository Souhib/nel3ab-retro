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

# The frame socket, when the caller asked for one. `-e NAME` without a value
# passes the variable through from this shell, which inherited it from the
# `emulator` crate — so nothing here has to know the path, and the test never
# has to call the unsafe `set_var`. The socket itself lives under `--user`,
# which is already mounted at the same path on both sides.
frame_socket_env=()
if [ -n "${NEL3AB_FRAME_SOCKET:-}" ]; then
  frame_socket_env=(-e NEL3AB_FRAME_SOCKET)
fi

# --shm-size is NOT optional: Docker defaults /dev/shm to 64 MiB and Dolphin's
# emulated-memory arena is larger, so it dies of SIGBUS (exit 135) with no log
# line at all. Verified on lgf, 2026-08-10.
# Le conteneur porte un NOM, et le nom sert deux fois.
#
# D'abord pour pouvoir le mettre en pause quand la salle se vide: `docker pause`
# demande un nom, et le processus que ce script devient est le client docker, pas
# Dolphin, donc un signal ne suffirait pas.
#
# Ensuite, et c'est le plus important, pour pouvoir RAMASSER ce qui traîne. Un
# conteneur en pause ne peut pas recevoir de signal: si le worker meurt pendant
# une pause, il resterait gelé pour toujours et le worker suivant en lancerait un
# second à côté. Ce dépôt a déjà payé douze heures d'émulateur orphelin qui
# volait les entrées. On efface donc l'ancien avant d'en lancer un neuf, et cette
# ligne rend la salle plus sûre qu'elle ne l'était sans pause du tout.
container="${NEL3AB_CONTAINER:-nel3ab-dolphin}"
docker rm -f "$container" >/dev/null 2>&1 || true

exec docker run --rm \
  --name "$container" \
  --shm-size=2g \
  "${frame_socket_env[@]}" \
  --device /dev/dri \
  --user "$(id -u):$(id -g)" \
  --group-add "$(getent group render | cut -d: -f3)" \
  -e HOME="$user_dir" \
  -v "$user_dir:$user_dir" \
  -v "$(dirname "$game"):$(dirname "$game"):ro" \
  "${NEL3AB_DOLPHIN_IMAGE:-nel3ab/dolphin:dev}" \
  "$@"
