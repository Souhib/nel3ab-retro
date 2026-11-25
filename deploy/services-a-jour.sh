#!/usr/bin/env bash
# Le PÉRIMÉ : un service qui tourne depuis AVANT la dernière modification du
# code qu'il exécute. Rend 0 si aucun, 1 sinon, et nomme le service et le
# fichier le plus récent.
#
# Le 22 septembre 2026, le salon tournait depuis le 14 et ignorait l'événement
# « qualité » ajouté le 16 : une semaine de propositions de format réduit
# perdues sans un signal. Les boucles de `deploy-check` comparent des fichiers
# entre eux ; celle-ci compare un fichier à ce qui tourne.
#
# Le code qu'il EXÉCUTE, lu dans son unité, et pas celui de l'arbre d'où l'on
# lance ce contrôle. Le salon et la boîte noire exécutent le WorkingDirectory
# de leur unité : `python -m` y cherche `nel3ab_control` avant son
# environnement, et `consoles.py` lit le manifeste à côté de ce dossier, une
# fois, à l'import. Une salle exécute le binaire de son ExecStart. Jusqu'au
# 25 novembre 2026, ce contrôle lisait l'arbre courant : depuis un worktree, il
# rougissait pour toute branche qui touche au salon, sur un code qu'aucun
# service n'exécute, et il restait vert depuis un worktree aux fichiers
# anciens alors que `main` avait changé après le démarrage.
#
# L'heure de modification plutôt que celle du dernier commit : le code
# installé peut ne pas être commité, et git ne réécrit un fichier que si son
# contenu change, donc un changement de branche sans effet sur le code ne
# rougit pas. Caddy n'est pas suivi : `systemctl reload` recharge sa
# configuration sans changer l'heure de démarrage, et `deploy-check` compare
# déjà son fichier.
#
# Limite : l'environnement Python de l'ajout Souverain porte sa propre copie de
# `nel3ab_control`, figée le 11 novembre 2026. Elle ne sert pas tant que le
# dossier de l'unité reste le premier du chemin d'import ; une option qui
# l'en retirerait (`-P`, `PYTHONSAFEPATH`) ferait tourner cette copie, et ce
# contrôle ne le verrait pas.
#
# Lancé depuis la racine du dépôt, par son propriétaire, sans sudo. Les essais
# mettent leur propre `systemctl` en tête du PATH (control/tests/test_deploiement.py).
set -uo pipefail
cd "$(dirname "$0")/.."
depot=$(pwd -P)
faux=0
ailleurs=""

# « secondes chemin » du fichier le plus récent. Les sources seules : le
# service écrit lui-même ses `.pyc` en tournant, et les compter le déclarerait
# périmé par son propre démarrage. Les pages du salon (HTML, modules, feuilles,
# dessins, polices) et le manifeste des consoles comptent aussi : le salon les
# assemble UNE fois, à son démarrage. Le 21 novembre 2026, une page de dépôt
# changée seule ne rougissait rien.
plus_recent() {
    find "$@" \( -name '*.py' -o -name pyproject.toml -o -name uv.lock -o -name '*.html' -o -name '*.mjs' \
        -o -name '*.css' -o -name '*.svg' -o -name '*.woff2' -o -name consoles.json \) -printf '%T@ %p\n' \
        | sort -n | tail -1
}

# perime UNITE "secondes chemin"
perime() {
    local unite="$1" recent="$2" horodatage depuis quand fichier
    horodatage=$(systemctl show "$unite" -p ActiveEnterTimestamp --value)
    # `date -d ""` rend minuit du jour : une heure vide passerait pour une heure.
    if [ -z "$horodatage" ] || ! depuis=$(date -d "$horodatage" +%s 2>/dev/null); then
        echo "  $unite: heure de démarrage illisible (« $horodatage »)"
        faux=1
        return
    fi
    quand=${recent%% *}
    quand=${quand%%.*}
    fichier=${recent#* }
    if [ -z "$quand" ] || [ "$quand" -gt "$depuis" ]; then
        echo "  tourne avec un code plus ancien que celui qu'elle exécute: $unite (démarrée $(date -d "@$depuis" '+%F %T'), $fichier du $(date -d "@$quand" '+%F %T'))"
        faux=1
    fi
}

actif() {
    [ "$(systemctl show "$1" -p ActiveState --value)" = active ]
}

for unite in nel3ab-control.service nel3ab-boite-noire.service; do
    actif "$unite" || continue
    dossier=$(systemctl show "$unite" -p WorkingDirectory --value)
    if [ -z "$dossier" ] || [ ! -d "$dossier/nel3ab_control" ]; then
        echo "  $unite: $dossier/nel3ab_control absent, le code qu'elle exécute est introuvable"
        faux=1
        continue
    fi
    dossier=$(cd "$dossier" && pwd -P)
    racine=$(dirname "$dossier")
    sources=("$dossier/nel3ab_control")
    manque=0
    for fichier in "$dossier/pyproject.toml" "$dossier/uv.lock" "$racine/consoles/consoles.json"; do
        if [ ! -f "$fichier" ]; then
            echo "  $unite: $fichier absent, le code qu'elle exécute est incomplet"
            manque=1
        fi
        sources+=("$fichier")
    done
    if [ "$manque" -eq 1 ]; then
        faux=1
        continue
    fi
    perime "$unite" "$(plus_recent "${sources[@]}")"
    [ "$racine" = "$depot" ] || ailleurs="$racine"
done

for salle in $(systemctl list-units --no-legend --state=active 'nel3ab-worker@*.service' | awk '{print $1}' | sed 's/^●[[:space:]]*//'); do
    binaire=$(systemctl show "$salle" -p ExecStart --value | sed -n 's/.*path=\([^ ;]*\).*/\1/p' | head -1)
    if [ -z "$binaire" ] || [ ! -f "$binaire" ]; then
        echo "  $salle: binaire introuvable (« $binaire »)"
        faux=1
        continue
    fi
    perime "$salle" "$(stat -c '%Y %n' "$binaire")"
done

# Vert depuis un worktree veut dire « ce qui tourne a le code de main », pas
# « cette branche tourne » : elle ne comptera qu'après la fusion et la mise en
# service (deploy/mettre-en-service.sh, qui finit par ce contrôle).
if [ -n "$ailleurs" ]; then
    echo "  ce dépôt ($depot) n'est pas celui que les services exécutent ($ailleurs): son code ne compte qu'après la fusion et la mise en service"
fi
exit "$faux"
