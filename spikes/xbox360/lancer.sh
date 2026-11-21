#!/usr/bin/env bash
# Essai Xbox 360 sans jeu: Xenia Edge puis Xenia Canary, chacun 25 s sous un
# Sway sans écran, dans l'image de la salle Switch, sans réseau, sans droits,
# avec la seule carte graphique. Aucun service vivant n'est touché.
#
#   bash spikes/xbox360/lancer.sh <dossier des paquets dépaquetés> <dossier de sortie>
#
# Le dossier des paquets contient edge/root et canary/root: chaque AppImage
# vérifiée contre l'empreinte publiée (voir essai-sans-jeu-2026-11-21.json),
# puis dépaquetée SANS être exécutée, par
#   unsquashfs -o 944632 -d <x>/root <x>/<fichier>.AppImage
# (944632 est la fin de l'en-tête ELF de l'AppImage, lue dans ses sections).
set -uo pipefail
D=${1:?dossier des paquets}
E=${2:?dossier de sortie}
ICI=$(cd "$(dirname "$0")" && pwd)
if pgrep -x nel3ab-worker >/dev/null; then
    echo "Une salle est ouverte: essai annulé." >&2
    exit 1
fi
for quoi in edge canary; do
    rm -rf "${E:?}/$quoi" && mkdir -p "$E/$quoi"
    echo "== $quoi"
    timeout 120 docker run --rm --name "xenia-essai-$quoi" --network none \
        --cap-drop=ALL --security-opt=no-new-privileges --pids-limit=512 \
        --user "$(id -u):$(id -g)" --group-add "$(stat -c %g /dev/dri/renderD128)" \
        --device=/dev/dri/renderD128 --shm-size=2g \
        -v "$D/$quoi/root:/xenia:ro" -v "$E/$quoi:/salle" -v "$ICI/dedans.sh:/dedans.sh:ro" \
        --entrypoint bash nel3ab/switch-prototype:2026-09-08-recovery /dedans.sh "$quoi" 25
    echo "   processus vivants à 25 s: $(wc -l < "$E/$quoi/processus.txt" 2>/dev/null || echo 0)"
    echo "   capture: $( [ -s "$E/$quoi/capture.png" ] && echo oui || echo non)"
    grep -m3 -i -E "Vulkan device|driverName" "$E/$quoi/xenia.log" 2>/dev/null | cut -c1-160
done
echo "Résultats dans $E"
