#!/usr/bin/env python3
"""Horodate chaque bouton d'une manette virtuelle, dans l'horloge monotone.

Le noyau date chaque événement d'entrée au moment où le pilote uinput le reçoit.
Par défaut il le date en temps réel ; `EVIOCSCLOCKID` demande l'horloge monotone,
celle du compositeur, de ffmpeg, de Node (`process.hrtime`) et de .NET
(`Stopwatch`). Toutes les étapes de la chaîne se comparent alors sans recaler
aucune horloge.

Lecteur seulement : il n'attrape pas la manette (`EVIOCGRAB`), donc Ryujinx lit
les mêmes événements que sans lui. Écrit une ligne JSON par bouton.

    sudo python3 horloge-manette.py /dev/input/event42 > boutons.jsonl
"""
import fcntl
import json
import os
import struct
import sys

EVIOCSCLOCKID = 0x400445A0  # _IOW('E', 0xa0, int)
CLOCK_MONOTONIC = 1
EV_KEY = 1
# struct input_event sur 64 bits : timeval (deux long), type, code, valeur.
EVENT = struct.Struct("llHHi")

fd = os.open(sys.argv[1], os.O_RDONLY)
fcntl.ioctl(fd, EVIOCSCLOCKID, struct.pack("i", CLOCK_MONOTONIC))
while True:
    data = os.read(fd, EVENT.size * 64)
    for offset in range(0, len(data), EVENT.size):
        sec, usec, kind, code, value = EVENT.unpack_from(data, offset)
        if kind == EV_KEY:
            print(json.dumps({"t_us": sec * 1_000_000 + usec, "code": code, "value": value}), flush=True)
