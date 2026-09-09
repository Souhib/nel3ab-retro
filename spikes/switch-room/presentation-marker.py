#!/usr/bin/env python3
"""Temporary solid-colour window to measure the prototype's capture delay.

Run only inside its private compositor. Closing stdin removes the window and
restores the game. Times bracket SDL's presentation, not the emulator's input.
"""
# The compositor socket is private to the container; stdout is the marker
# timing protocol consumed by measure-presentation.mjs, not a debug dump.
# ruff: noqa: S108, T201

import ctypes as c
import json
import os
import select
import sys
import time
from pathlib import Path

os.environ["XDG_RUNTIME_DIR"] = "/tmp/nel3ab-runtime"
os.environ["WAYLAND_DISPLAY"] = json.loads(Path("/run-data/display.json").read_text())["display"]
os.environ["SDL_VIDEODRIVER"] = "wayland"
sdl = c.CDLL("libSDL2-2.0.so.0")
for name, args, result in [
    ("SDL_Init", [c.c_uint], c.c_int),
    ("SDL_CreateWindow", [c.c_char_p, c.c_int, c.c_int, c.c_int, c.c_int, c.c_uint], c.c_void_p),
    ("SDL_SetWindowFullscreen", [c.c_void_p, c.c_uint], c.c_int),
    ("SDL_CreateRenderer", [c.c_void_p, c.c_int, c.c_uint], c.c_void_p),
    ("SDL_SetRenderDrawColor", [c.c_void_p, c.c_ubyte, c.c_ubyte, c.c_ubyte, c.c_ubyte], c.c_int),
    ("SDL_RenderClear", [c.c_void_p], c.c_int),
    ("SDL_RenderPresent", [c.c_void_p], None),
    ("SDL_DestroyRenderer", [c.c_void_p], None),
    ("SDL_DestroyWindow", [c.c_void_p], None),
    ("SDL_PollEvent", [c.c_void_p], c.c_int),
]:
    function = getattr(sdl, name)
    function.argtypes, function.restype = args, result
if sdl.SDL_Init(0x20) != 0:
    raise RuntimeError("SDL video initialization failed")
window = sdl.SDL_CreateWindow(b"nel3ab capture measurement", 0, 0, 1280, 720, 4)
renderer = sdl.SDL_CreateRenderer(window, -1, 1) if window else None
if not renderer:
    sdl.SDL_Quit()
    raise RuntimeError("SDL marker window failed")
sdl.SDL_SetWindowFullscreen(window, 0x1001)
try:
    color = [0, 0, 0]
    print(json.dumps({"ready": True}), flush=True)
    while True:
        changed = bool(select.select([sys.stdin], [], [], 1 / 60)[0])
        if changed:
            line = sys.stdin.readline()
            if not line:
                break
            color = json.loads(line)
            if len(color) != 3 or any(type(v) is not int or not 0 <= v <= 255 for v in color):
                raise ValueError("expected three colour bytes")
        event = c.create_string_buffer(64)
        while sdl.SDL_PollEvent(event):
            pass
        sdl.SDL_SetRenderDrawColor(renderer, *color, 255)
        sdl.SDL_RenderClear(renderer)
        before = time.time_ns() / 1e6
        sdl.SDL_RenderPresent(renderer)
        if changed:
            print(
                json.dumps({"color": color, "before": before, "after": time.time_ns() / 1e6}),
                flush=True,
            )
finally:
    sdl.SDL_DestroyRenderer(renderer)
    sdl.SDL_DestroyWindow(window)
    sdl.SDL_Quit()
