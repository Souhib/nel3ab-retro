#!/usr/bin/env bash
# Dans le conteneur d'essai: un Sway sans écran, un émulateur, une capture.
# Usage: dedans.sh <edge|canary> <seconds>
set -uo pipefail
quoi=$1
duree=${2:-25}
export HOME=/salle/home
export XDG_RUNTIME_DIR=/tmp/rt
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
export WLR_BACKENDS=headless WLR_RENDERER=gles2 WLR_RENDER_DRM_DEVICE=/dev/dri/renderD128
export WLR_LIBINPUT_NO_DEVICES=1 XDG_SESSION_TYPE=wayland
export SDL_JOYSTICK_DISABLE_UDEV=1
case "$quoi" in
  edge)
    cmd="env GDK_BACKEND=wayland LD_LIBRARY_PATH=/xenia/usr/lib /xenia/usr/bin/xenia_edge --storage_root=/salle/donnees --log_file=/salle/xenia.log --gpu=vulkan --apu=nop --hid=sdl --discord=false"
    ;;
  canary)
    cmd="env GDK_BACKEND=x11 LD_LIBRARY_PATH=/xenia/usr/lib /xenia/usr/bin/xenia_canary --storage_root=/salle/donnees --log_file=/salle/xenia.log --gpu=vulkan --apu=nop --hid=sdl --discord=false"
    ;;
  *) echo "edge ou canary" >&2; exit 2 ;;
esac
cat > /tmp/sway.cfg <<EOF
output HEADLESS-1 resolution 1280x720
default_border none
xwayland enable
exec $cmd > /salle/emulateur.out 2>&1
EOF
sway -c /tmp/sway.cfg > /salle/sway.log 2>&1 &
sway_pid=$!
sleep "$duree"
sock=$(ls "$XDG_RUNTIME_DIR" | grep -E '^wayland-[0-9]+$' | head -1)
WAYLAND_DISPLAY=$sock grim /salle/capture.png 2>> /salle/sway.log
WAYLAND_DISPLAY=$sock SWAYSOCK=$(ls "$XDG_RUNTIME_DIR"/sway-ipc.* 2>/dev/null | head -1) swaymsg -t get_tree > /salle/arbre.json 2>/dev/null
pgrep -a xenia > /salle/processus.txt
kill "$sway_pid" 2>/dev/null
sleep 2
pkill -f xenia_ 2>/dev/null
exit 0
