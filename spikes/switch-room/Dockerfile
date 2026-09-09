# Prototype only. Reuse the installed Dolphin userspace so the GPU driver and
# FFmpeg match the existing room; record the resulting image ID in every run.
FROM nel3ab/dolphin:dev
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth x11-utils xdotool libsdl2-dev libopenal1 libicu74 libssl3t64 \
    libfontconfig1 libxrender1 libxinerama1 libxcursor1 libxkbcommon-x11-0 \
    libxcb-cursor0 libxcb-icccm4 libxcb-keysyms1 libxcb-shape0 libxcb-xinerama0 \
    pulseaudio pulseaudio-utils python3 python3-evdev python3-numpy \
    ffmpeg curl ca-certificates procps p7zip-full cage xwayland grim wf-recorder mesa-va-drivers \
 && rm -rf /var/lib/apt/lists/*
# Optional measurement of the emulator's Vulkan presentations, independently
# of the compositor capture cadence. Disabled unless SWITCH_PROFILE=1.
RUN apt-get update && apt-get install -y --no-install-recommends mangohud \
 && rm -rf /var/lib/apt/lists/*
# Sway exposes a window-close request through its private IPC socket. Cage's
# SIGTERM tears down the display before Ryubing has disposed the running game.
RUN apt-get update && apt-get install -y --no-install-recommends sway \
 && rm -rf /var/lib/apt/lists/*
ENTRYPOINT []
CMD ["bash"]
