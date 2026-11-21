#!/usr/bin/env bash
# Le salon et la boîte noire s'importent-ils avec l'interpréteur que systemd
# lance VRAIMENT ? Rend 0 si oui, 1 sinon, et dit lequel a échoué.
#
# Pourquoi pas le `.venv` du dépôt: le 21 novembre 2026, un ajout d'un autre
# projet (`nel3ab-control.service.d/90-souverain.conf`) remplaçait la commande
# du salon par son propre environnement Python, figé le 11 novembre. La
# dépendance ajoutée le matin même (`cryptography`) était dans le `.venv` du
# dépôt, pas dans celui-là. `deploy-check` comparait les fichiers d'unité et
# passait; le salon a échoué dix-huit démarrages de suite, une cinquantaine
# de secondes. On lit donc la commande effective, ajouts compris.
#
# Lancé depuis la racine du dépôt, par son propriétaire (jamais root: un
# import peut écrire un cache Python sous le dossier du dépôt).
set -uo pipefail
cd "$(dirname "$0")/../control"
faux=0
for paire in "nel3ab-control:nel3ab_control.app" "nel3ab-boite-noire:nel3ab_control.boite_noire"; do
    unite=${paire%%:*}
    module=${paire#*:}
    # Un essai donne sa propre commande, au format de `systemctl show`, pour
    # exercer le refus sans toucher aux services (control/tests/test_deploiement.py).
    commande=${NEL3AB_EXECSTART_ESSAI:-$(systemctl show "$unite" -p ExecStart --value 2>/dev/null)}
    python=$(printf '%s' "$commande" | sed -n 's/.*path=\([^ ;]*\).*/\1/p' | head -1)
    # `uv run` synchronise le `.venv` du dépôt avant de lancer: c'est lui qui sert.
    case "$python" in
        */uv) python=.venv/bin/python ;;
    esac
    if [ -z "$python" ] || [ ! -x "$python" ]; then
        echo "  $unite: interpréteur introuvable (« $python »)"
        faux=1
        continue
    fi
    if ! sortie=$(timeout 120 "$python" -c "import $module" 2>&1); then
        echo "  $unite ne s'importe pas avec $python:"
        printf '%s\n' "$sortie" | tail -3 | sed 's/^/      /'
        faux=1
    fi
done
exit "$faux"
