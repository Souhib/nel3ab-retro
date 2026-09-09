#!/usr/bin/env bash
# Runs inside the private prototype container, never against a live room.
set -euo pipefail
export HOME=/run-data/home
export XDG_RUNTIME_DIR=/tmp/nel3ab-runtime
export XDG_CONFIG_HOME=$HOME/.config
export XDG_CACHE_HOME=$HOME/.cache
export DISPLAY=:99
export PULSE_SERVER=unix:$XDG_RUNTIME_DIR/pulse/native
export SDL_AUDIODRIVER=pulseaudio
export ALSOFT_DRIVERS=pulse
export LC_ALL=C.UTF-8
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
# A stopped container can retain locks whose PID now belongs to another process.
# This entrypoint owns this display and sound server in its private namespace.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 "$XDG_RUNTIME_DIR/pulse/pid"
if [ "${DISPLAY_BACKEND:-x11}" = x11 ]; then
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp > /run-data/xvfb.log 2>&1 &
xpid=$!
trap 'kill "$xpid" 2>/dev/null || true' EXIT
for attempt in {1..100}; do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.05
done
xdpyinfo >/dev/null
fi
pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=file:/run-data/pulse.log \
  --load="module-null-sink sink_name=nel3ab format=s16le rate=48000 channels=2"
pactl set-default-sink nel3ab
if [ "${DISPLAY_BACKEND:-x11}" = wayland ]; then
  unset DISPLAY
  export WLR_BACKENDS=headless
  export WLR_RENDERER=gles2
  export WLR_RENDER_DRM_DEVICE=/dev/dri/renderD128
  export SDL_VIDEODRIVER=wayland
  export QT_QPA_PLATFORM=wayland
  export XDG_SESSION_TYPE=wayland
  if [ "${SWITCH_COMPOSITOR:-sway}" = cage ]; then
    # Eden's AppImage needs Cage's Xwayland. This isolated display is the first
    # Wayland socket in the container, as in the original Eden experiment.
    echo '{"display":"wayland-0"}' > /run-data/display.json
    exec cage -- "$@"
  fi
  exec python3 /probe/supervise.py "$@"
fi
exec "$@"
