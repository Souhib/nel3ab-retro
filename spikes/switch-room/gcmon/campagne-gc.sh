#!/usr/bin/env bash
# Campagne A/B du ramasse-miettes de Ryubing sur Smash (28 novembre 2026).
# A : réglages actuels. B : DOTNET_gcServer=1, 4 tas, fils non épinglés.
# Chaque phase : phase.sh (salle privée, cache réel copié), gcmon dans le
# conteneur (toutes les pauses, un nettoyage complet provoqué toutes les 30 s
# à partir de 120 s), la mémoire du conteneur toutes les 10 s.
# Exécuter une COPIE figée (bash relit un script par position d'octet).
#
# campagne-gc.sh SORTIE "A B B A" DUREE
set -uo pipefail
SORTIE=$1; ORDRE=$2; DUREE=${3:-420}
ICI=$(cd "$(dirname "$0")" && pwd)
REPO=${REPO:?une copie de travail avec crochets.patch posé et son worker construit}
BANC=$REPO/spikes/switch-room/banc-stabilite
GCMON=${GCMON:?le binaire publié de gcmon (README)}
ROM="$HOME/roms/switch/Super Smash Bros. Ultimate.nsp"; TITRE=01006a800016e000
GRAINE=$HOME/.local/state/nel3ab/switch/$TITRE
JSON_A='{"banc_env": {}}'
JSON_B='{"banc_env": {"DOTNET_gcServer": "1", "DOTNET_GCHeapCount": "4", "DOTNET_GCNoAffinitize": "1"}}'
mkdir -p "$SORTIE"
journal(){ echo "$(date -u +%FT%T) $*" | tee -a "$SORTIE/campagne.txt"; }

# La boîte noire profile tout émulateur qui tourne : arrêtée pendant la campagne,
# seulement si aucune salle de production ne tourne, et relancée à toute sortie.
BN_ETAIT=$(systemctl is-active nel3ab-boite-noire.service || true)
relancer_bn(){ [ "$BN_ETAIT" = active ] && sudo -n systemctl start nel3ab-boite-noire.service; journal "boîte noire : $(systemctl is-active nel3ab-boite-noire.service || true) (avant : $BN_ETAIT)"; }
trap relancer_bn EXIT
for n in $(docker ps --format '{{.Names}}'); do
  if docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null | grep -q '/.local/state/nel3ab/'; then
    journal "REFUS : la salle de production $n tourne"; exit 2
  fi
done
[ "$BN_ETAIT" = active ] && sudo -n systemctl stop nel3ab-boite-noire.service
journal "boîte noire : $(systemctl is-active nel3ab-boite-noire.service || true)"

n=0
for bras in $ORDRE; do
  n=$((n+1)); ETIQ="$bras$n"
  case $bras in A) JSON=$JSON_A;; B) JSON=$JSON_B;; *) journal "bras inconnu $bras"; exit 2;; esac
  OUT="$SORTIE/$ETIQ"; mkdir -p "$OUT"
  journal "phase $ETIQ $JSON"
  MAJ=1 setsid bash "$BANC/phase.sh" "$ETIQ" "$REPO" "$ROM" "$TITRE" "$DUREE" "$SORTIE" "$GRAINE" "$JSON" \
    > "$OUT/phase.out" 2>&1 < /dev/null &
  P=$!
  MOTEUR=""
  for i in $(seq 1 240); do
    MOTEUR=$(grep -h '^moteur=' "$OUT/garde.txt" 2>/dev/null | head -1 | cut -d= -f2)
    [ -n "$MOTEUR" ] && break; sleep 0.5
  done
  if [ -z "$MOTEUR" ]; then journal "phase $ETIQ : pas de moteur"; wait "$P"; continue; fi
  journal "moteur $MOTEUR"
  docker cp "$GCMON" "$MOTEUR:/tmp/gcmon" >/dev/null
  ID=$(docker inspect -f '{{.Id}}' "$MOTEUR")
  ( while docker inspect "$MOTEUR" >/dev/null 2>&1; do
      echo "$(date -u +%FT%T) $(cat /sys/fs/cgroup/system.slice/docker-$ID.scope/memory.current 2>/dev/null)"; sleep 10
    done ) > "$OUT/memoire.txt" &
  M=$!
  # gcmon attend que l'émulateur ait publié sa prise ; il refuse (code 3) avant.
  GDUREE=$((DUREE - 40))
  for i in $(seq 1 60); do
    docker exec "$MOTEUR" /tmp/gcmon "$GDUREE" 120 30 > "$OUT/gc.jsonl" 2> "$OUT/gc.err"
    code=$?
    [ "$code" != 3 ] && break
    sleep 2
  done
  journal "gcmon $ETIQ code $code, essais $i"
  wait "$P"; journal "phase $ETIQ code $?"
  kill "$M" 2>/dev/null; wait "$M" 2>/dev/null
  bash "$BANC/nettoyer.sh" >> "$OUT/nettoyer.txt" 2>&1 || true
done
journal "fin"
