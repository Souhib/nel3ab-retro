#!/usr/bin/env bash
# Arrête, dans l'ordre de la salle, toute salle de banc restée ouverte : un
# conteneur qui ne monte qu'une racine /tmp/nel3ab-banc-*, jamais une salle de
# production (qui monte ~/.local/state/nel3ab).
set -uo pipefail
for n in $(docker ps --format '{{.Names}}' | grep -v -- '-pads$'); do
  m=$(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null)
  case "$m" in *"/.local/state/nel3ab"*) continue ;; esac
  echo "$m" | grep -q '/tmp/nel3ab-banc-' || continue
  echo "arrêt de $n"
  docker exec "$n" python3 /probe/capture_control.py stop || true
  docker stop --timeout 40 "$n" >/dev/null && docker rm "$n" >/dev/null
  docker stop --timeout 5 "$n-pads" >/dev/null 2>&1 && docker rm "$n-pads" >/dev/null 2>&1
done
