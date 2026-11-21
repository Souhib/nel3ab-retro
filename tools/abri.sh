#!/usr/bin/env bash
# Copie chiffrée des sauvegardes de jeu hors de la machine, sur le NAS.
#
# Jusqu'au 21 novembre 2026, les progressions des joueurs n'existaient qu'en un
# seul exemplaire, sur le disque de lgf. Un disque mort emportait tout.
#
# POURQUOI restic. Le partage du NAS s'appelle « Public »: une copie lisible y
# serait lisible par toute la maison. restic chiffre tout ce qu'il écrit, ne
# recopie pas un fichier déjà envoyé (les neuf gigaoctets des emplacements
# Switch se partagent l'essentiel de leurs fichiers système), et sait relire
# ses propres données pour prouver qu'elles se restaurent (`restic check
# --read-data-subset`). Un tar chiffré par gpg aurait été restaurable sans
# outil particulier, mais il aurait recopié neuf gigaoctets à chaque passage.
#
# Un enregistrement de profileur (`perf.data`) n'est pas une sauvegarde, et
# certains appartiennent à root: le premier passage réel, le 21 novembre, a
# échoué sur l'un d'eux après avoir pourtant écrit son instantané.
#
# CE QUI EST COPIÉ: les sauvegardes (`~/.local/state/nel3ab`), la configuration
# (`~/.config/nel3ab`), le gabarit Switch et l'état Switch 2. CE QUI NE L'EST PAS:
# les caches de shaders, les dossiers d'essai `test-switch2-*`, les binaires des
# déploiements, et les ROM elles-mêmes (76 Go, qui se récupèrent à leur source).
#
# Les tubes nommés (`*.fifo`) sont enregistrés comme des tubes, sans être lus:
# un lecteur qui en ouvre un reste bloqué tant que personne n'écrit dedans.
#
# Variables, toutes remplaçables pour les tests (`just abri-test`):
#   NEL3AB_ABRI_DEPOT       le dépôt restic
#   NEL3AB_ABRI_SECRET      le fichier du mot de passe, lisible de son seul
#                           propriétaire
#   NEL3AB_ABRI_SOURCES     les dossiers copiés, séparés par « : »
#   NEL3AB_ABRI_ELAGUER     « oui » pour appliquer la rétention après la copie
#   NEL3AB_ABRI_VERIFIER    « oui » pour relire une part des données envoyées
#   NEL3AB_ABRI_PART        la part relue par la vérification, 1/16 par défaut
#   NEL3AB_ABRI_ETAT        le fichier où le dernier passage écrit son issue
#
# Codes de sortie: ceux de restic (1 erreur, 3 fichier illisible) passent tels
# quels; ce script rend 20 pour un mot de passe absent ou trop ouvert, 21 pour
# un NAS absent, 22 pour des sources toutes absentes. Ils ne recouvrent pas
# ceux de restic: le 21 novembre, un 3 du script et un 3 de restic se
# confondaient dans le journal.
set -euo pipefail

depot="${NEL3AB_ABRI_DEPOT:-/mnt/nas/nel3ab-abri/restic}"
secret="${NEL3AB_ABRI_SECRET:-$HOME/.config/nel3ab-abri/mot-de-passe}"
sources="${NEL3AB_ABRI_SOURCES:-$HOME/.local/state/nel3ab:$HOME/.config/nel3ab:$HOME/.local/share/nel3ab/switch/template:$HOME/.local/share/nel3ab/switch2}"

etat="${NEL3AB_ABRI_ETAT:-$HOME/.local/state/nel3ab-abri/etat.json}"

# Une copie qui échoue en silence pendant des semaines ne protège rien. Chaque
# passage écrit donc son issue, réussie ou non, là où le salon peut la lire.
debut=$(date -u +%FT%TZ)
issue() {
    local code=$?
    mkdir -p "$(dirname "$etat")"
    printf '{"debut":"%s","fin":"%s","code":%d}\n' "$debut" "$(date -u +%FT%TZ)" "$code" > "$etat.tmp"
    mv "$etat.tmp" "$etat"
}
trap issue EXIT

# Un mot de passe que d'autres comptes peuvent lire ne protège plus la copie:
# mieux vaut refuser de partir que chiffrer avec une clé publique.
if [ ! -f "$secret" ]; then
    echo "abri: mot de passe absent: $secret" >&2
    exit 20
fi
if [ "$(stat -c %a "$secret")" != 600 ]; then
    echo "abri: $secret doit être en 600, il est en $(stat -c %a "$secret")" >&2
    exit 20
fi

export RESTIC_REPOSITORY="$depot"
export RESTIC_PASSWORD_FILE="$secret"

# Le NAS est monté à la demande (autofs). Un point de montage absent ne doit
# pas faire écrire le dépôt sur le disque local, qui est justement celui qu'on
# protège: on exige que le parent du dépôt existe déjà.
if [ ! -d "$(dirname "$depot")" ]; then
    echo "abri: le dossier parent du dépôt n'existe pas: $(dirname "$depot")" >&2
    exit 21
fi
if [ ! -f "$depot/config" ]; then
    restic init --repository-version 2
fi

IFS=: read -r -a dossiers <<< "$sources"
presents=()
for dossier in "${dossiers[@]}"; do
    [ -e "$dossier" ] && presents+=("$dossier")
done
if [ "${#presents[@]}" -eq 0 ]; then
    echo "abri: aucune source présente dans $sources" >&2
    exit 22
fi

restic --retry-lock 30m backup --one-file-system --tag nel3ab --host lgf \
    --exclude '**/.cache' \
    --exclude '**/mesa_shader_cache' \
    --exclude '**/radv_builtin_shaders' \
    --exclude '**/perf.data*' \
    --exclude "$HOME/.local/state/nel3ab/test-switch2-*" \
    --exclude "$HOME/.local/state/nel3ab/switch/*/cache" \
    --exclude "$HOME/.local/state/nel3ab/switch/*/mesa" \
    --exclude "$HOME/.local/state/nel3ab/switch2/*/cache" \
    --exclude "$HOME/.local/state/nel3ab/deployments/*/nel3ab-worker" \
    "${presents[@]}"

# La rétention: deux jours heure par heure, un mois jour par jour, trois mois
# semaine par semaine, deux ans mois par mois. Une partie abîmée le samedi et
# remarquée le mardi doit encore avoir sa version du vendredi.
if [ "${NEL3AB_ABRI_ELAGUER:-non}" = oui ]; then
    restic --retry-lock 30m forget --tag nel3ab --host lgf --prune \
        --keep-hourly 48 --keep-daily 31 --keep-weekly 13 --keep-monthly 24
fi
# Relire une part des données envoyées, pas seulement l'index: un dépôt dont
# l'index est sain peut encore porter des paquets illisibles.
if [ "${NEL3AB_ABRI_VERIFIER:-non}" = oui ]; then
    restic --retry-lock 30m check --read-data-subset="${NEL3AB_ABRI_PART:-1/16}"
fi
