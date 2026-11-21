#!/usr/bin/env bash
# Runs INSIDE the trial container: headless Sway, Xenia Edge on one game,
# a capture every 30 s. Usage: dedans-jeu.sh <seconds>
set -uo pipefail
duree=${1:-120}
export HOME=/salle/home XDG_RUNTIME_DIR=/tmp/rt
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
export WLR_BACKENDS=headless WLR_RENDERER=gles2 WLR_RENDER_DRM_DEVICE=/dev/dri/renderD128
export WLR_LIBINPUT_NO_DEVICES=1 XDG_SESSION_TYPE=wayland SDL_JOYSTICK_DISABLE_UDEV=1
cat > /tmp/sway.cfg <<CFG
output HEADLESS-1 resolution 1280x720
default_border none
exec env GDK_BACKEND=wayland LD_LIBRARY_PATH=/xenia/usr/lib /xenia/usr/bin/xenia_edge /jeu/jeu.iso --storage_root=/salle/donnees --log_file=/salle/xenia.log --gpu=vulkan --apu=nop --hid=sdl --discord=false > /salle/emulateur.out 2>&1
CFG
sway -c /tmp/sway.cfg > /salle/sway.log 2>&1 &
sway_pid=$!
t=0
while [ "$t" -lt "$duree" ]; do
    sleep 30
    t=$((t + 30))
    sock=$(ls "$XDG_RUNTIME_DIR" | grep -E '^wayland-[0-9]+$' | head -1)
    WAYLAND_DISPLAY=$sock grim "/salle/capture-${t}s.png" 2>> /salle/sway.log
    pgrep -a xenia > "/salle/processus-${t}s.txt"
done
kill "$sway_pid" 2>/dev/null
sleep 2
pkill -f xenia_ 2>/dev/null
exit 0
