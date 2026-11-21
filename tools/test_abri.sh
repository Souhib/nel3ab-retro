#!/usr/bin/env bash
# Éprouve `tools/abri.sh` contre un faux HOME et un dépôt jetable.
#
# Le test passe par les sources et les exclusions PAR DÉFAUT du script, en
# déplaçant HOME: une liste de sources fournie par le test prouverait la
# mécanique de restic, pas ce que la machine copie vraiment.
#
# Chaque refus a son jumeau: un mot de passe absent, lisible par d'autres, un
# dépôt sans parent, un mauvais mot de passe, un paquet abîmé. Une copie qui
# réussit doit se RESTAURER à l'identique; un fichier présent dans le dépôt ne
# prouve rien tant qu'on ne l'a pas relu.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/abri.sh"
racine=$(mktemp -d)
trap 'chmod -R u+w "$racine" 2>/dev/null; rm -rf "$racine"' EXIT
export HOME="$racine/home"
etat="$HOME/.local/state/nel3ab-abri/etat.json"
echecs=0

attendu() {  # attendu <code> <libellé> <commande...>
    local voulu="$1" libelle="$2"; shift 2
    local obtenu=0
    "$@" >"$racine/sortie" 2>&1 || obtenu=$?
    if [ "$obtenu" -ne "$voulu" ]; then
        echo "ÉCHEC: $libelle: code $obtenu au lieu de $voulu"
        sed 's/^/    /' "$racine/sortie" | tail -15
        echecs=$((echecs + 1))
    else
        echo "ok: $libelle"
    fi
}
vrai() {  # vrai <libellé> <test...>
    local libelle="$1"; shift
    if "$@"; then echo "ok: $libelle"; else echo "ÉCHEC: $libelle"; echecs=$((echecs + 1)); fi
}
code_ecrit() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["code"])' "$etat"; }

etat_dir="$HOME/.local/state/nel3ab"
mkdir -p "$etat_dir/personal-saves/jeu-a" "$etat_dir/salles/1/.cache/mesa_shader_cache" \
    "$etat_dir/test-switch2-AbCdEf" "$etat_dir/switch/0100aa/cache" \
    "$etat_dir/switch/0100aa/joueur-a/data" "$etat_dir/switch2/0400bb/cache" \
    "$etat_dir/deployments/20260101T000000Z" "$HOME/.config/nel3ab" \
    "$HOME/.local/share/nel3ab/switch/template/system" "$HOME/.local/share/nel3ab/nx2-lab"
head -c 200000 /dev/urandom > "$etat_dir/personal-saves/jeu-a/carte.gci"
head -c 50000 /dev/urandom > "$etat_dir/switch/0100aa/joueur-a/data/save.bin"
echo '{"pseudo":"test"}' > "$etat_dir/people.json"
echo '{}' > "$HOME/.config/nel3ab/switch.json"
echo gabarit > "$HOME/.local/share/nel3ab/switch/template/system/prod.keys.absent"
head -c 10000 /dev/urandom > "$etat_dir/salles/1/.cache/mesa_shader_cache/x"
head -c 10000 /dev/urandom > "$etat_dir/test-switch2-AbCdEf/gros"
head -c 10000 /dev/urandom > "$etat_dir/switch/0100aa/cache/x"
head -c 10000 /dev/urandom > "$etat_dir/switch2/0400bb/cache/x"
head -c 10000 /dev/urandom > "$etat_dir/deployments/20260101T000000Z/nel3ab-worker"
echo garde > "$etat_dir/deployments/20260101T000000Z/manifest.json"
head -c 10000 /dev/urandom > "$HOME/.local/share/nel3ab/nx2-lab/hors-champ"
mkdir -p "$etat_dir/diagnostics/banc"
head -c 10000 /dev/urandom > "$etat_dir/diagnostics/banc/perf.data"
chmod 000 "$etat_dir/diagnostics/banc/perf.data"
# Un tube que personne n'écrit: le lire bloquerait la copie pour toujours.
mkfifo "$etat_dir/salles/1/rumble.fifo"

export NEL3AB_ABRI_DEPOT="$racine/nas/restic"
secret="$HOME/.config/nel3ab-abri/mot-de-passe"

# Refus 1: pas de mot de passe. L'issue est écrite quand même.
mkdir -p "$racine/nas"
attendu 20 "refuse sans mot de passe" timeout 60 "$script"
vrai "l'échec sans mot de passe est écrit dans l'état" [ "$(code_ecrit)" = 20 ]

# Refus 2: un mot de passe lisible par d'autres comptes.
mkdir -p "$(dirname "$secret")"
head -c 32 /dev/urandom | base64 > "$secret"
chmod 644 "$secret"
attendu 20 "refuse un mot de passe en 644" timeout 60 "$script"
chmod 600 "$secret"

# Refus 3: le parent du dépôt n'existe pas (NAS non monté).
NEL3AB_ABRI_DEPOT="$racine/nas-absent/restic" attendu 21 "refuse un dépôt sans parent" timeout 60 "$script"
vrai "aucun dépôt n'est créé à sa place" [ ! -e "$racine/nas-absent" ]

# La copie. Le délai attrape un tube lu par erreur.
attendu 0 "première copie" timeout 120 "$script"
vrai "la réussite est écrite dans l'état" [ "$(code_ecrit)" = 0 ]
export RESTIC_REPOSITORY="$NEL3AB_ABRI_DEPOT" RESTIC_PASSWORD_FILE="$secret"
premier=$(restic snapshots --json | python3 -c 'import json,sys; print(json.load(sys.stdin)[-1]["short_id"])')

restaure="$racine/restaure"
restic restore latest --target "$restaure" >/dev/null
r="$restaure$HOME"
for f in .local/state/nel3ab/personal-saves/jeu-a/carte.gci \
         .local/state/nel3ab/switch/0100aa/joueur-a/data/save.bin \
         .local/state/nel3ab/people.json .config/nel3ab/switch.json \
         .local/state/nel3ab/deployments/20260101T000000Z/manifest.json \
         .local/share/nel3ab/switch/template/system/prod.keys.absent; do
    vrai "restauré à l'identique: $f" cmp -s "$HOME/$f" "$r/$f"
done
for f in .local/state/nel3ab/salles/1/.cache/mesa_shader_cache/x \
         .local/state/nel3ab/test-switch2-AbCdEf/gros \
         .local/state/nel3ab/switch/0100aa/cache/x \
         .local/state/nel3ab/switch2/0400bb/cache/x \
         .local/state/nel3ab/deployments/20260101T000000Z/nel3ab-worker \
         .local/share/nel3ab/nx2-lab/hors-champ \
         .local/state/nel3ab/diagnostics/banc/perf.data; do
    vrai "exclu: $f" [ ! -e "$r/$f" ]
done
vrai "le tube est restauré comme un tube" [ -p "$r/.local/state/nel3ab/salles/1/rumble.fifo" ]

# Une deuxième version, puis la première doit rester lisible.
cp "$etat_dir/personal-saves/jeu-a/carte.gci" "$racine/ancienne.gci"
head -c 200000 /dev/urandom > "$etat_dir/personal-saves/jeu-a/carte.gci"
attendu 0 "deuxième copie" timeout 120 "$script"
restic restore "$premier" --target "$racine/avant" \
    --include "$HOME/.local/state/nel3ab/personal-saves" >/dev/null
vrai "la version précédente reste restaurable" \
    cmp -s "$racine/ancienne.gci" "$racine/avant$HOME/.local/state/nel3ab/personal-saves/jeu-a/carte.gci"

# Refus 4: une sauvegarde illisible fait échouer le passage (code 3 de
# restic), même si l'instantané est écrit. Un profileur illisible, lui, est
# exclu au-dessus et ne fait rien échouer.
head -c 100 /dev/urandom > "$etat_dir/personal-saves/jeu-a/illisible.gci"
chmod 000 "$etat_dir/personal-saves/jeu-a/illisible.gci"
attendu 3 "une sauvegarde illisible fait échouer le passage" timeout 120 "$script"
vrai "l'échec de lecture est écrit dans l'état" [ "$(code_ecrit)" = 3 ]
rm -f "$etat_dir/personal-saves/jeu-a/illisible.gci"

# Refus 5: un mauvais mot de passe n'ouvre pas le dépôt.
mauvais="$racine/mauvais"; head -c 32 /dev/urandom | base64 > "$mauvais"; chmod 600 "$mauvais"
attendu 1 "un mauvais mot de passe n'ouvre rien" env RESTIC_PASSWORD_FILE="$mauvais" restic snapshots
vrai "le mot de passe n'apparaît nulle part en clair dans le dépôt" \
    bash -c "! grep -rqF -- \"\$(cat '$secret')\" '$NEL3AB_ABRI_DEPOT'"
vrai "une sauvegarde n'apparaît nulle part en clair dans le dépôt" \
    bash -c "! grep -rqF -- 'pseudo' '$NEL3AB_ABRI_DEPOT'"

# Entretien complet: rétention et relecture de toutes les données.
NEL3AB_ABRI_ELAGUER=oui NEL3AB_ABRI_VERIFIER=oui NEL3AB_ABRI_PART=1/1 \
    attendu 0 "rétention et relecture d'un dépôt sain" timeout 300 "$script"

# Refus 6: un paquet abîmé doit faire échouer la relecture.
paquet=$(find "$NEL3AB_ABRI_DEPOT/data" -type f | head -1)
chmod u+w "$paquet"
printf 'abime' | dd of="$paquet" bs=1 seek=100 conv=notrunc status=none
NEL3AB_ABRI_VERIFIER=oui NEL3AB_ABRI_PART=1/1 \
    attendu 1 "la relecture voit un paquet abîmé" timeout 300 "$script"
vrai "l'échec de relecture est écrit dans l'état" [ "$(code_ecrit)" = 1 ]

if [ "$echecs" -ne 0 ]; then echo "$echecs échec(s)"; exit 1; fi
echo "la copie chiffrée se restaure, exclut les caches et refuse ce qu'elle doit refuser"
