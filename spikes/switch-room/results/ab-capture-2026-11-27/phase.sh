#!/usr/bin/env bash
# Une phase : une salle Switch privée lance Smash avec le worker d'un bras,
# pendant DUREE secondes, puis s'arrête. Session, état et sauvegardes jetables ;
# l'état reçoit une COPIE du cache de shaders de Smash, pour que les deux bras
# partent chauds de la même façon. Rien n'est écrit sous ~/.local/state.
set -euo pipefail
BRAS=$1; REPO=$2; DUREE=$3; SORTIE=$4
TITRE=01006a800016e000
ROOT=$(mktemp -d /tmp/nel3ab-ab-XXXXXX)
mkdir -p "$ROOT/session" "$ROOT/etat/$TITRE" "$ROOT/perso" "$ROOT/art"
cp -a "$HOME/.local/state/nel3ab/switch/$TITRE/cache" "$ROOT/etat/$TITRE/cache"
cp -a "$HOME/.local/state/nel3ab/switch/$TITRE/mesa" "$ROOT/etat/$TITRE/mesa"
python3 - "$HOME/.config/nel3ab/switch.json" "$ROOT" <<'PY'
import json,sys
c=json.load(open(sys.argv[1])); c["state"]=sys.argv[2]+"/etat"
json.dump(c,open(sys.argv[2]+"/switch-config.json","w"))
PY
port(){ python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
MEDIA=$(port); CONTROL=$(port)
export NEL3AB_CONTAINER="nel3ab-ab-$(basename "$ROOT" | tr 'A-Z' 'a-z')"
export NEL3AB_ROM="$HOME/roms/switch/Super Smash Bros. Ultimate.nsp"
export NEL3AB_ROM_DIR="$HOME/roms/switch"
export NEL3AB_SWITCH_CONFIG="$ROOT/switch-config.json"
export NEL3AB_SESSION_DIR="$ROOT/session" NEL3AB_PERSONAL_SAVE_ROOT="$ROOT/perso" NEL3AB_ART_DIR="$ROOT/art"
export NEL3AB_BIND="127.0.0.1:$MEDIA" NEL3AB_CONTROL_BIND="127.0.0.1:$CONTROL" NEL3AB_WORKER_CONTROL="127.0.0.1:$CONTROL"
export NEL3AB_PLAYERS=4
garde(){ echo "$1 $(date -u +%FT%T.%3NZ) ffmpeg=$(pgrep -c ffmpeg || true) kfd=$(ls /sys/class/kfd/kfd/proc 2>/dev/null | wc -l) ci=$(pgrep -fc '[R]unner[.]Worker' || true) psi_cpu=\"$(head -1 /proc/pressure/cpu)\""; }
garde "debut $BRAS $ROOT" >> "$SORTIE"
"$REPO/core/target/debug/nel3ab-worker" > "$ROOT/worker.log" 2>&1 &
W=$!
trap 'kill -TERM $W 2>/dev/null || true' INT TERM
sleep "$DUREE"
garde "fin $BRAS $ROOT" >> "$SORTIE"
kill -TERM "$W"
for i in $(seq 1 60); do kill -0 "$W" 2>/dev/null || break; sleep 1; done
kill -0 "$W" 2>/dev/null && { echo "ALERTE worker vivant après 60 s" >> "$SORTIE"; kill -KILL "$W"; }
reste=$(docker ps --format '{{.Names}}' | grep -c "^$NEL3AB_CONTAINER" || true)
echo "arret $BRAS $(date -u +%FT%T.%3NZ) conteneurs_restants=$reste" >> "$SORTIE"
