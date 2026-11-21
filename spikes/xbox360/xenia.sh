#!/usr/bin/env bash
# Lance Xenia Edge DANS le conteneur de la salle, sous le Sway de supervise.py.
#
# Trois choses autour de l'émulateur, pour qu'un essai se relise après coup:
#  - l'ordre des manettes: SDL les prend dans l'ordre de SDL_JOYSTICK_DEVICE,
#    donc la place 1 de la salle reste le joueur 1 de la console;
#  - le journal horodaté: Xenia n'écrit pas l'heure, mais une ligne par
#    seconde porte son compteur d'images (f:...). horodate.py ajoute l'heure à
#    chaque ligne, ce qui donne les images par seconde du jeu;
#  - des captures d'écran à intervalle fixe, si la salle en demande
#    (NEL3AB_CAPTURES_S, 0 pour aucune). En PNG: le grim de l'image ne sait
#    pas écrire de JPEG (« jpeg support disabled », 21 novembre 2026), et ses
#    erreurs vont dans captures/grim.log au lieu de disparaître.
#
# Xenia passe par X11 (Xwayland, que supervise.py démarre avec Sway). En
# Wayland, Xenia Edge demande chaque image par un drapeau que deux fils se
# partagent sans verrou: le 21 novembre 2026, l'image de Sonic s'est figée au
# bout de 40 secondes alors que le jeu tournait encore à 60 images par seconde.
#
# `exec` garde le numéro de processus: supervise.py ferme la fenêtre de CE
# processus par Sway, et la boîte noire le reconnaît à son nom, xenia_edge.
set -euo pipefail
pads_dir=${NEL3AB_PADS_DIR:-/pads}
run_data=${NEL3AB_RUN_DATA:-/run-data}
xenia=${NEL3AB_XENIA:-/emulator/usr/bin/xenia_edge}
here=$(cd "$(dirname "$0")" && pwd)
: "${DISPLAY:?Xenia passe par Xwayland: DISPLAY doit venir de supervise.py (NEL3AB_SWAY_X11=1)}"

SDL_JOYSTICK_DEVICE=$(python3 -c 'import json, sys; print(":".join(json.load(open(sys.argv[1]))))' "$pads_dir/devices.json")
export SDL_JOYSTICK_DEVICE
export SDL_JOYSTICK_DISABLE_UDEV=1
export SDL_AUDIO_DRIVER=pulseaudio
export GDK_BACKEND=x11
export LD_LIBRARY_PATH=${NEL3AB_XENIA_LIBS:-/emulator/usr/lib}

mkdir -p "$run_data/xenia" "$run_data/captures"
captures=${NEL3AB_CAPTURES_S:-0}
if [ "$captures" -gt 0 ]; then
    (
        while sleep "$captures"; do
            grim -t png -l 3 "$run_data/captures/$(date -u +%Y%m%dT%H%M%SZ).png" \
                2>> "$run_data/captures/grim.log" || true
        done
    ) &
fi

fifo=$(mktemp -u "${XDG_RUNTIME_DIR:-/tmp}/xenia-out.XXXXXX")
mkfifo "$fifo"
python3 "$here/horodate.py" "$run_data/xenia-horodate.log" < "$fifo" &
exec "$xenia" "$@" > "$fifo" 2>&1
