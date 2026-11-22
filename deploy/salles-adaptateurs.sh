#!/usr/bin/env bash
# Les salles lancent-elles des adaptateurs qui existent, avec un python3 qui les
# importe ? Rend 0 si oui, 1 sinon, et nomme la salle et la cause.
#
# Deux trous que `deploy-check` ne voyait pas, parce qu'il compare des fichiers
# d'unité et pas ce que systemd en fait.
#
#  - Un ajout d'unité (`nel3ab-worker@N.service.d/*.conf`) peut remplacer
#    l'adaptateur d'une console par `NEL3AB_<CONSOLE>_ADAPTER` (le `script_env`
#    du manifeste, lu par le worker dans son environnement). C'est ainsi que le
#    canari du socle se branche sur une salle (docs/xbox360.md). Un tel ajout est
#    NOMMÉ ici tant qu'il existe, et devient rouge si le fichier visé n'existe
#    plus : cette salle ne lancerait alors plus aucun jeu de la console. Le
#    21 novembre 2026, un ajout d'un autre projet sur le salon était passé de la
#    même façon sous les yeux de `deploy-check`.
#  - Le worker lance `python3 <script>` par le PATH de son unité (external.rs),
#    pas par celui de ce shell. On le cherche donc dans l'Environment de l'unité,
#    sinon dans celui du gestionnaire (`systemctl show-environment`), et on
#    importe avec lui chaque enveloppe, sans lancer de salle : son `principal`
#    est derrière `if __name__ == "__main__"`.
#
# Limite : une variable posée par `EnvironmentFile=` n'apparaît pas dans
# `systemctl show -p Environment`, et n'est donc pas vue ici.
#
# Lancé depuis la racine du dépôt, par son propriétaire, sans sudo. Les essais
# donnent leurs propres réponses de systemd (control/tests/test_deploiement.py).
set -uo pipefail
cd "$(dirname "$0")/.."
depot=$(pwd)
faux=0
# Les salles que le salon démarre : celles de la règle sudo.
salles=${NEL3AB_SALLES_ESSAI:-$(sed -n 's/.*systemctl start nel3ab-worker@\([0-9]*\).*/\1/p' deploy/nel3ab-salles.sudoers | sort -un)}
gestionnaire=${NEL3AB_GESTIONNAIRE_ESSAI-$(systemctl show-environment 2>/dev/null)}
# code, script et variable de remplacement de chaque console externe.
consoles=$(python3 -I -c '
import json, sys
for console in json.load(open(sys.argv[1]))["consoles"]:
    forme = console["form"]
    if forme["kind"] == "external":
        print(console["code"], forme["script"], forme["script_env"])
' consoles/consoles.json) || { echo "  consoles/consoles.json illisible"; exit 1; }

# Les affectations d'un Environment au format de systemd, une par ligne.
affectations() {
    printf '%s' "$1" | python3 -I -c 'import shlex, sys; print("\n".join(shlex.split(sys.stdin.read())))'
}

valeur() {
    printf '%s\n' "$2" | sed -n "s/^$1=//p" | tail -1
}

for salle in $salles; do
    unite="nel3ab-worker@$salle"
    environnement=$(affectations "${NEL3AB_ENVIRONMENT_ESSAI-$(systemctl show "$unite" -p Environment --value 2>/dev/null)}")
    dossier=${NEL3AB_DOSSIER_ESSAI-$(systemctl show "$unite" -p WorkingDirectory --value 2>/dev/null)}
    [ -d "$dossier" ] || dossier="$depot/core"
    chemin=$(valeur PATH "$environnement")
    [ -n "$chemin" ] || chemin=$(valeur PATH "$(affectations "$gestionnaire")")
    [ -n "$chemin" ] || chemin=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    python=$(PATH="$chemin" command -v python3 || true)
    if [ -z "$python" ]; then
        echo "  $unite: aucun python3 dans le PATH de l'unité ($chemin)"
        faux=1
        continue
    fi
    connues=$(printf '%s\n' "$consoles" | awk '{print $3}')
    for variable in $(printf '%s\n' "$environnement" | sed -n 's/^\(NEL3AB_[A-Z0-9_]*_ADAPTER\)=.*/\1/p' | sort -u); do
        if ! printf '%s\n' "$connues" | grep -qx "$variable"; then
            echo "  $unite: $variable ne remplace l'adaptateur d'aucune console (script_env du manifeste)"
            faux=1
        fi
    done
    while read -r code script variable; do
        remplace=$(valeur "$variable" "$environnement")
        if [ -n "$remplace" ]; then
            if [ ! -f "$remplace" ]; then
                echo "  $unite: $variable vise un fichier absent ($remplace): aucun jeu $code ne démarrerait"
                faux=1
                continue
            fi
            echo "  $unite: $variable remplace l'adaptateur $code par $remplace"
            script=$remplace
        else
            script="$depot/$script"
        fi
        # L'environnement d'un service: rien du shell, sauf ce que l'unité pose.
        if ! sortie=$(cd "$dossier" && env -i PATH="$chemin" HOME="$(valeur HOME "$environnement")" \
            timeout 60 "$python" -B -c '
import importlib.util, os, sys
chemin = sys.argv[1]
# Ce que Python pose pour `python3 <script>`: le dossier réel du script.
sys.path[0] = os.path.dirname(os.path.realpath(chemin))
spec = importlib.util.spec_from_file_location("enveloppe", chemin)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
' "$script" 2>&1); then
            echo "  $unite: $script ne s'importe pas avec $python:"
            printf '%s\n' "$sortie" | tail -3 | sed 's/^/      /'
            faux=1
        fi
    done <<< "$consoles"
done
exit "$faux"
