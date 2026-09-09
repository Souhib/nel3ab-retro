#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
engine=${1:?usage: launch.sh ryubing|eden [game.nro|game.nsp|game.xci]}
case "$engine" in ryubing|eden) ;; *) exit 2 ;; esac
memory=${SWITCH_MEMORY_MODE:-HostMapped}
case "$memory" in
  SoftwarePageTable|HostMapped|HostMappedUnsafe) ;;
  *) echo 'Unknown SWITCH_MEMORY_MODE' >&2; exit 2 ;;
esac
lab=${SWITCH_LAB:-/tmp/nel3ab-switch-lab}
game=$(realpath "${2:-guest/nel3ab-probe.nro}")
run="$lab/$engine-lab"
engine_dir=${SWITCH_ENGINE_DIR:-$lab/$engine}
if [ "$engine" = ryubing ]; then
  engine_dir=${SWITCH_ENGINE_DIR:-$lab/ryubing-patched}
  if [ ! -x "$engine_dir/publish/Ryujinx" ]; then
    echo 'Build the headless fixes with spikes/switch-room/build-ryubing.sh first.' >&2
    exit 1
  fi
fi
mkdir -p "$run/home" "$run/data/profiles/controller"
args=(--network none --cap-drop ALL --security-opt no-new-privileges --user "$(id -u):$(id -g)"
  --device /dev/dri/renderD128 --group-add "$(stat -c %g /dev/dri/renderD128)" --shm-size "${SWITCH_SHM_SIZE:-8g}"
  -e DISPLAY_BACKEND=wayland -v "$engine_dir:/emulator:ro" -v "$run:/run-data"
  -v "$PWD:/probe:ro" -v "$lab/pads:/pads")
if [ "${SWITCH_AUDIO_PROBE:-0}" = 1 ]; then
  args+=(-e NEL3AB_AUDIO_PROBE=1)
fi
if [ "${SWITCH_PROFILE:-0}" = 1 ]; then
  mkdir -p "$run/performance"
  args+=(-e MANGOHUD=1
    -e MANGOHUD_CONFIG=no_display,autostart_log=1,log_interval=100,output_folder=/run-data/performance)
fi
while IFS= read -r device; do args+=(--device "$device"); done < <(
  python3 -c 'import json,sys; print(*json.load(open(sys.argv[1])),sep="\n")' "$lab/pads/devices.json"
)
input="/game/input.${game##*.}"
args+=(-v "$game:$input:ro")
if [ "${game##*.}" = nro ]; then
  # Ryubing 1.3.3 opens homebrew with FileMode.Open (read/write by default).
  # Keep the source immutable and let that loader open a private test copy.
  cp "$game" "$run/guest.nro"
  input=/run-data/guest.nro
fi
if [ "$engine" = ryubing ]; then
  cp ryubing-pro-controller.json "$run/data/profiles/controller/nel3ab.json"
  command=(/emulator/publish/Ryujinx --no-gui --root-data-dir /run-data/data --fullscreen
    --memory-manager-mode "$memory" --graphics-backend Vulkan --ignore-controller-applet)
  for i in {1..4}; do
    command+=("--input-id-$i" "$((i-1))-00000003-045e-0000-8e02-000014010000" "--input-profile-$i" nel3ab)
  done
  command+=("$input")
else
  # Keep Eden's measured Xwayland path; the SDL shutdown patch is Ryubing-only.
  args+=(-e SWITCH_COMPOSITOR=cage)
  command=(/emulator/AppDir/AppRun -f -g "$input")
fi
# A duplicate name is an error. Never remove an existing process implicitly.
# 2026-09-08: HostMapped filled all 512 MiB of /dev/shm and exited 134. The
# same game boots with 8 GiB available and uses 3.56 GiB at its title screen.
# This is a tmpfs ceiling, not an eager allocation. Ryubing backs the guest's
# 4 GiB RAM here; SoftwarePageTable hid this quota fault at a performance cost.
docker run -d --name "nel3ab-switch-$engine-lab" "${args[@]}" \
  "${SWITCH_IMAGE:-nel3ab/switch-prototype:2026-09-08-recovery}" bash /probe/runtime.sh "${command[@]}"
