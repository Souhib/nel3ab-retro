#!/usr/bin/env bash
# photos.sh SORTIE_PHASE PERIODE NOMBRE : photos d'écran du moteur de la phase.
set -uo pipefail
OUT=$1; P=$2; N=$3
for i in $(seq 1 120); do
  M=$(grep -o 'moteur=.*' "$OUT/garde.txt" 2>/dev/null | cut -d= -f2)
  [ -n "$M" ] && break; sleep 1
done
for k in $(seq 1 "$N"); do
  sleep "$P"
  D=$(docker exec "$M" cat /run-data/display.json 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin)["display"])' 2>/dev/null) || continue
  docker exec -e XDG_RUNTIME_DIR=/tmp/nel3ab-runtime -e WAYLAND_DISPLAY="$D" "$M" grim -s 0.25 /run-data/photo.png 2>>"$OUT/photos.err" \
    && docker cp "$M:/run-data/photo.png" "$OUT/photo-$(printf %03d $((k*P))).png" >/dev/null 2>&1
done
