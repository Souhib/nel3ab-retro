#!/usr/bin/env bash
# Essai Xbox 360 AVEC un jeu: Xenia Edge seul, 120 s sous le Sway de la salle,
# sans réseau, sans droits, avec la seule carte graphique, une capture toutes
# les 30 s. Le jeu est monté en LECTURE SEULE: la quarantaine n'est pas touchée.
#
#   bash spikes/xbox360/lancer-jeu.sh <dossier des paquets dépaquetés> <jeu> <dossier de sortie>
#
# Le dossier des paquets est le même que pour lancer.sh (edge/root). Le jeu est
# un disque Xbox 360 du propriétaire, par exemple un fichier resté dans la
# quarantaine de la page de dépôt.
set -uo pipefail
D=${1:?dossier des paquets}
JEU=${2:?jeu}
E=${3:?dossier de sortie}
ICI=$(cd "$(dirname "$0")" && pwd)
if pgrep -x nel3ab-worker >/dev/null; then echo "Une salle est ouverte: essai annulé." >&2; exit 1; fi
test -r "$JEU" || { echo "jeu introuvable: $JEU" >&2; exit 1; }
rm -rf "${E:?}/jeu" && mkdir -p "$E/jeu"
timeout 240 docker run --rm --name xenia-essai-jeu --network none \
    --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=512 \
    --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /dev/dri/renderD128)" \
    --device=/dev/dri/renderD128 --shm-size=2g \
    -v "$D/edge/root:/xenia:ro" -v "$JEU:/jeu/jeu.iso:ro" -v "$E/jeu:/salle" \
    -v "$ICI/dedans-jeu.sh:/dedans.sh:ro" \
    --entrypoint bash nel3ab/switch-prototype:2026-09-08-recovery /dedans.sh 120
for t in 30 60 90 120; do
    echo "  ${t} s: $(wc -l < "$E/jeu/processus-${t}s.txt" 2>/dev/null || echo 0) processus, capture $( [ -s "$E/jeu/capture-${t}s.png" ] && echo oui || echo non)"
done
grep -m6 -i -E "vulkan device|title_id|loading module" "$E/jeu/xenia.log" 2>/dev/null | cut -c1-160
echo "Résultats dans $E/jeu"
