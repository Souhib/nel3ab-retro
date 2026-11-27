#!/usr/bin/env bash
# A B B A : A = avant l'audit (b5f21f8), B = après (fb5bcb4).
set -uo pipefail
D=$(dirname "$0"); OUT=$D/phases.txt; : > "$OUT"
A=$HOME/nel3ab-chantiers/mesure-avant; B=$HOME/nel3ab-chantiers/switch1-integration
uname -r >> "$OUT"
for bras in A B B A; do
  [ "$bras" = A ] && repo=$A || repo=$B
  bash "$D/phase.sh" "$bras" "$repo" 215 "$OUT" || echo "ECHEC phase $bras" >> "$OUT"
  sleep 5
done
echo "fin campagne $(date -u +%FT%T.%3NZ)" >> "$OUT"
