#!/usr/bin/env bash
# Une phase du banc de stabilité : une salle Switch privée (ports libres, état,
# session et sauvegardes jetables) lance un jeu avec le worker de REPO pendant
# DUREE secondes, avec le relevé image par image de la capture et
# l'échantillonneur des fils. Rien n'est écrit sous ~/.local/state.
#
# phase.sh ETIQUETTE REPO ROM TITRE DUREE SORTIE GRAINE [CONFIG_JSON]
#   REPO : une copie de travail où crochets.patch est posé, et son worker construit
#     (`cargo build -p nel3ab-worker` dans core/) ; jamais l'arbre principal.
#   GRAINE : un dossier qui contient cache/ et mesa/ (copiés), ou « froid ».
#   CONFIG_JSON : clés ajoutées à la copie de switch.json, par exemple
#     '{"banc_env": {"DOTNET_GCgen0size": "0x4000000"}}'
set -euo pipefail
ETIQ=$1; REPO=$2; ROM=$3; TITRE=$4; DUREE=$5; SORTIE=$6; GRAINE=$7; EXTRA=${8:-'{}'}
ICI=$(cd "$(dirname "$0")" && pwd)
# Les crochets du banc (crochets.patch) ne vont jamais dans l'arbre principal :
# le worker de la salle relit ses scripts depuis cet arbre à chaque partie.
if [ "$(git -C "$REPO" rev-parse --show-toplevel)" = "$(git -C "$REPO" worktree list | head -1 | cut -d' ' -f1)" ]; then
  echo "phase.sh : $REPO est l'arbre principal ; prendre une copie de travail avec crochets.patch" >&2; exit 2
fi
grep -q banc_env "$REPO/docker/switch-room.py" && grep -q NEL3AB_CAPTURE_TRACE "$REPO/spikes/switch-room/capture.py" || {
  echo "phase.sh : crochets.patch n'est pas posé dans $REPO" >&2; exit 2; }
# Une salle de banc restée ouverte fausserait la mesure : si la session qui la
# lançait meurt d'un SIGKILL, ni le worker ni ce script ne l'arrêtent (une salle
# est restée six heures ouverte le 27 novembre 2026). nettoyer.sh les arrête.
for n in $(docker ps --format '{{.Names}}'); do
  if docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null | grep -q '/tmp/nel3ab-banc-'; then
    echo "phase.sh : la salle de banc $n tourne encore ; lancer nettoyer.sh" >&2; exit 2
  fi
done
OUT="$SORTIE/$ETIQ"; mkdir -p "$OUT"
ROOT=$(mktemp -d /tmp/nel3ab-banc-XXXXXX)
mkdir -p "$ROOT/session" "$ROOT/etat/$TITRE" "$ROOT/perso" "$ROOT/art"
if [ "$GRAINE" != froid ]; then
  cp -a "$GRAINE/cache" "$ROOT/etat/$TITRE/cache"
  cp -a "$GRAINE/mesa" "$ROOT/etat/$TITRE/mesa"
fi
# MAJ=1 : l'emplacement neuf reçoit le gabarit de la salle et, lus dans
# l'emplacement neuf réel, le choix de mise à jour et les contenus additionnels
# du jeu (jamais une sauvegarde).
if [ "${MAJ:-0}" = 1 ]; then
  GABARIT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["template"])' "$HOME/.config/nel3ab/switch.json")
  cp -a "$GABARIT" "$ROOT/etat/$TITRE/neuve.data"
  mkdir -p "$ROOT/etat/$TITRE/neuve"; mv "$ROOT/etat/$TITRE/neuve.data" "$ROOT/etat/$TITRE/neuve/data"
  mkdir -p "$ROOT/etat/$TITRE/neuve/data/games/$TITRE"
  for f in updates.json dlc.json; do
    src="$HOME/.local/state/nel3ab/switch/$TITRE/neuve/data/games/$TITRE/$f"
    [ -f "$src" ] && cp "$src" "$ROOT/etat/$TITRE/neuve/data/games/$TITRE/$f"
  done
fi
python3 - "$HOME/.config/nel3ab/switch.json" "$ROOT" "$EXTRA" <<'PY'
import json, sys
c = json.load(open(sys.argv[1])); c["state"] = sys.argv[2] + "/etat"
extra = json.loads(sys.argv[3])
env = {"NEL3AB_CAPTURE_TRACE": "1", **extra.pop("banc_env", {})}
c.update(extra); c["banc_env"] = env
json.dump(c, open(sys.argv[2] + "/switch-config.json", "w"), indent=1)
PY
cp "$ROOT/switch-config.json" "$OUT/switch-config.json"
port(){ python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
MEDIA=$(port); CONTROL=$(port)
export NEL3AB_CONTAINER="nel3ab-banc-$(basename "$ROOT" | tr 'A-Z' 'a-z')"
export NEL3AB_ROM="$ROM" NEL3AB_ROM_DIR="$(dirname "$ROM")"
export NEL3AB_SWITCH_CONFIG="$ROOT/switch-config.json"
export NEL3AB_SESSION_DIR="$ROOT/session" NEL3AB_PERSONAL_SAVE_ROOT="$ROOT/perso" NEL3AB_ART_DIR="$ROOT/art"
export NEL3AB_BIND="127.0.0.1:$MEDIA" NEL3AB_CONTROL_BIND="127.0.0.1:$CONTROL" NEL3AB_WORKER_CONTROL="127.0.0.1:$CONTROL"
export NEL3AB_PLAYERS=4 NEL3AB_EMPTY_AFTER_SECS=7200
garde(){ echo "$1 $(date -u +%FT%T.%3NZ) mono=$(python3 -c 'import time;print(round(time.monotonic(),3))') ffmpeg=$(pgrep -c ffmpeg || true) kfd=$(ls /sys/class/kfd/kfd/proc 2>/dev/null | wc -l) ci=$(pgrep -fc '[R]unner[.]Worker' || true) salles=$(for n in $(docker ps --format '{{.Names}}'); do docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null | grep -q '/.local/state/nel3ab' && echo "$n"; done | wc -l) psi_cpu=\"$(head -1 /proc/pressure/cpu)\""; }
garde "debut $ETIQ $ROOT" >> "$OUT/garde.txt"
DEBUT=$(python3 -c 'import time;print(time.monotonic())')
FIN=$(python3 -c "print($DEBUT + $DUREE)")
"$REPO/core/target/debug/nel3ab-worker" > "$ROOT/worker.log" 2>&1 &
W=$!
arreter(){
  kill -TERM "$W" 2>/dev/null || true
  for i in $(seq 1 90); do kill -0 "$W" 2>/dev/null || break; sleep 1; done
  kill -0 "$W" 2>/dev/null && { echo "ALERTE worker vivant après 90 s" >> "$OUT/garde.txt"; kill -KILL "$W"; }
  true
}
# Toute sortie, même sur une erreur, arrête le worker et attend sa salle.
trap arreter EXIT
# Le conteneur du moteur porte le préfixe de NEL3AB_CONTAINER, sans « -pads ».
MOTEUR=""
for i in $(seq 1 120); do
  MOTEUR=$(docker ps --format '{{.Names}}' | grep "^nel3ab-switch-" | grep -v -- '-pads$' | while read -r n; do
    r=$(docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$n" 2>/dev/null || true)
    case " $r" in *" $ROOT/etat/"*) echo "$n";; esac; done | head -1 || true)
  [ -n "$MOTEUR" ] && break
  sleep 0.5
done
echo "moteur=$MOTEUR" >> "$OUT/garde.txt"
TOC="$ROOT/etat/$TITRE/cache/shader/shared.toc"
taskset -c 11 python3 "$ICI/echantillons.py" "$MOTEUR" "$TOC" "$OUT/echantillons.jsonl" "$FIN" 2> "$OUT/echantillons.err" &
E=$!
python3 -c "import time; time.sleep(max(0, $FIN - time.monotonic()))"
garde "fin $ETIQ $ROOT" >> "$OUT/garde.txt"
wait "$E" || echo "echantillonneur code $?" >> "$OUT/garde.txt"
arreter
reste=$(docker ps --format '{{.Names}}' | grep -c "^$NEL3AB_CONTAINER" || true)
echo "arret $ETIQ $(date -u +%FT%T.%3NZ) conteneurs_restants=$reste" >> "$OUT/garde.txt"
cp "$ROOT/worker.log" "$OUT/worker.log"
SLOT=$(find "$ROOT/etat/$TITRE" -maxdepth 2 -name full-trace.txt -printf '%h\n' | head -1)
[ -n "$SLOT" ] && cp "$SLOT/full-trace.txt" "$OUT/full-trace.txt"
[ -n "$SLOT" ] && find "$SLOT" -path '*Logs*' -name 'Ryujinx_*.log' -exec cp {} "$OUT/" \;
[ -n "$SLOT" ] && [ -f "$SLOT/emulator.log" ] && cp "$SLOT/emulator.log" "$OUT/emulator.log"
find "$ROOT/etat/$TITRE/mesa" -type f ! -name index ! -name marker -printf '%T@ %s\n' | sort -n > "$OUT/mesa-mtimes.txt" || true
stat -c '%s' "$TOC" > "$OUT/toc-fin.txt" 2>/dev/null || true
echo "$ROOT" > "$OUT/racine.txt"
