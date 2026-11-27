#!/usr/bin/env bash
# Une campagne alternée du banc :
#   campagne.sh SORTIE REPO ORDRE DUREE ROM TITRE GRAINE_A JSON_A GRAINE_B JSON_B
# ORDRE, par exemple « A B B A ». Chaque bras a sa graine (un dossier avec cache/
# et mesa/, ou « froid ») et sa configuration (clés de switch.json et banc_env).
# MAJ=1 dans l'environnement : le jeu tourne avec sa mise à jour (voir phase.sh).
set -uo pipefail
ICI=$(cd "$(dirname "$0")" && pwd)
OUT=$1; REPO=$2; ORDRE=$3; DUREE=$4; ROM=$5; TITRE=$6; GA=$7; JA=$8; GB=$9; JB=${10}
mkdir -p "$OUT/scripts"
# Une copie figée des scripts : bash relit un script par position d'octet, et
# une retouche pendant une phase lui ferait exécuter des lignes décalées
# (27 novembre 2026).
cp "$ICI/phase.sh" "$ICI/echantillons.py" "$OUT/scripts/"
{
  echo "campagne ordre=[$ORDRE] duree=$DUREE titre=$TITRE maj=${MAJ:-0}"
  echo "A graine=$GA config=$JA"
  echo "B graine=$GB config=$JB"
} > "$OUT/campagne.txt"
i=0
for bras in $ORDRE; do
  i=$((i + 1))
  if [ "$bras" = A ]; then g=$GA; j=$JA; else g=$GB; j=$JB; fi
  bash "$OUT/scripts/phase.sh" "$i-$bras" "$REPO" "$ROM" "$TITRE" "$DUREE" "$OUT" "$g" "$j" \
    || echo "ECHEC phase $i-$bras" >> "$OUT/campagne.txt"
  sleep 5
done
echo "fin $(date -u +%FT%T.%3NZ)" >> "$OUT/campagne.txt"
