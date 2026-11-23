# Shared recipes for humans and CI. The quality job calls `check`; CI also scans
# secrets and runs separate docs and supply-chain jobs. `check` alone does not
# prove the whole pipeline. Use `docs` for prose and `audit` for Rust dependencies.
#
# That promise was broken once: CI set `RUSTFLAGS: -D warnings` in the workflow
# while the justfile passed it only to clippy, so `just check` went green locally
# on code that failed the pipeline on a dead-code warning. Setting it here is what
# keeps the code-quality checks aligned: strictness belongs to the recipe, not to one
# caller of it.
export RUSTFLAGS := "-D warnings"

default: local

# THE GATE BEFORE A COMMIT, on a machine that has the GPU.
#
# `check` is shared with CI; `gpu-test` needs this machine's GPU. CI runs
# on a GitHub runner with no GPU, so everything M2 built — the dma-buf import,
# the compute pass, the encode — is invisible to it. A green pipeline therefore
# says nothing about the half of this project that matters most, and running
# those tests has to be somebody's habit rather than a hope.
#
# It is the DEFAULT recipe for that reason: `just` with no argument runs the
# whole gate, so forgetting takes an extra word rather than fewer.
#
# The way to make CI cover this is a self-hosted runner on lgf. Worth doing when
# more than one person commits; until then a rule that costs one command is
# cheaper than a runner to maintain.
# Le MP4 demande ffmpeg et ffprobe, disponibles ici et absents de CI.
# Depuis le 2026-09-06, la porte locale décode aussi sa piste audio : ffprobe
# seul laissait passer les clips muets puisqu'il ne vérifiait que l'image.
#
# `deploy-check` entre dans la porte le 13 septembre 2026, et ICI plutôt que
# dans `check`: `check` est partagé avec la CI, qui n'a aucun
# `/etc/systemd/system/nel3ab-*` et le déclarerait rouge pour rien. `local`, lui,
# est déjà la porte de CETTE machine, comme le GPU, ffmpeg et la Switch.
#
# Il existait et personne ne le lançait. Le 13 septembre 2026 j'ai supprimé une
# unité morte et corrigé `nel3ab-rebar.service` dans le dépôt sans le déployer:
# la machine a gardé 37 minutes une référence vers un fichier disparu (09h53 à
# 10h31, lu sur les mtime des deux copies), la porte est restée verte, et la
# dérive a été retrouvée à la main. Un contrôle que rien n'appelle ne protège
# de rien.
#
# `focus-navigateur` et `etats-navigateur` y entrent le 22 novembre 2026. Ce
# sont les seules preuves du focus, du clavier et des états de la liaison dans
# un vrai navigateur (jsdom n'a ni dialogue modal ni focus réel), et la
# relecture du chantier du focus a trouvé que rien ne les lançait: une
# régression passait la porte sans bruit. Elles demandent Chrome (puppeteer) et
# ffmpeg, déjà exigé par `clip-audio-test`, et servent la page committée sur un
# port de 5400 à 5499, sans rien de vivant. Leur prix, mesuré le jour même:
# 1 min 25 s et 4 min 35 s, dont près de trois minutes pour les deux étapes de
# `etats-navigateur` qui attendent une proposition de format réduit.
#
# `parcours-navigateur` y entre le même jour, après la relecture du chantier
# « parcours et mots »: cinq mutants d'`App.tsx` (l'entrée lue dans l'adresse,
# l'adresse réécrite, le lien d'invitation, la sortie, la fermeture de la
# salle) laissaient tous les essais verts, et les parcours qui les auraient vus
# vivaient hors du dépôt. Un banc du même genre (Chrome, ffmpeg, rien de
# vivant), pour 24 s mesurées le 22 novembre.
#
# `salle-telephone` et `manette-garde` y entrent le même jour, après la
# relecture de la salle au doigt: elles vivaient hors de toute porte alors que
# trois bancs du même genre y étaient, et une régression de la manette ou du
# tiroir passait sans bruit. Même prix de nature (Chrome, rien de vivant, Vite
# sans relais sur 5446 et 5437), et mesuré le 22 novembre 2026 sur cette
# machine: 112 s et 48 s.
local: check gpu-test clip-audio-test switch-saves-test switch-capture-test xbox360-test abri-test deploy-check focus-navigateur etats-navigateur parcours-navigateur salle-telephone manette-garde

# La copie chiffrée des sauvegardes sur le NAS (docs/abri.md), éprouvée contre un
# faux dossier personnel et un dépôt jetable: restauration à l'identique,
# exclusions, tubes nommés, et un refus pour chaque façon de mal tourner.
# Demande restic, installé sur lgf et absent de la CI.
abri-test:
    tools/test_abri.sh

# La planche de Bobine: chaque pose et chaque scène, rejouables à la main, sans
# salle ni salon. Sa configuration Vite n'a AUCUN mandataire vers les ports de
# la salle, contrairement à `npm run dev`: une planche ne touche rien de vivant.
planche port="5391":
    cd front && npx vite --config vite.planche.config.ts --port {{port}}

# The control plane's own gate, which is its owner's: ruff, ty, pytest, driven by
# poe exactly as LaTabdhir and Majlisna drive theirs.
control:
    cd control && uv run poe check

# The page's own gate: types, lints, unit tests. Same shape as the other two.
front:
    cd front && npm run typecheck && npm run lint && npm run format:check && npm test

# Is the TypeScript client still the one this API describes?
#
# Two links, and both are regenerated from their source rather than trusted:
# FastAPI writes `control/openapi.json` from its own routes, and Hey API writes
# `front/src/client` from that document (ADR D6). A field renamed in Python and
# not regenerated here would reach the browser as `undefined`, in the one place
# nothing checks types at run time.
#
# Diffing works for these, unlike for the page: a JSON dump and a code generator
# both give the same bytes for the same input. The page cannot be checked this
# way because its minifier does not (see `front-check`).
#
# `front/package.json` contraint `js-yaml` à `^4.3.2`, et la raison vit ici
# parce que le JSON ne porte pas de commentaire. Le générateur embarque une
# version vulnérable à une explosion de temps de calcul sur des ancres YAML;
# elle ne lit que notre propre `openapi.json`, qui est du JSON, donc rien n'est
# atteignable. Ce qui coûtait était le chiffre: `npm audit` annonçait quatre
# alertes hautes, et une alerte qu'on apprend à ignorer est une alerte perdue.
# La correction que npm proposait était de RECULER `@hey-api/openapi-ts` de deux
# versions majeures; la contrainte fait mieux pour moins cher. Vérifié le 30 août
# 2026: la page construite est identique à l'octet près, seule sa marque change.
contract-check:
    cd control && uv run poe openapi
    cd front && npx openapi-ts
    git diff --exit-code --stat control/openapi.json front/src/client

# Builds the page into the worker's source tree, where `include_str!` reads it,
# and stamps it with a hash of what it was built from.
front-build:
    cd front && npm run build && node stamp.mjs

# Les unités installées sont-elles celles du dépôt ?
#
# Ce dépôt garde ses trois unités systemd sous `deploy/`, et rien ne vérifiait
# qu'elles ressemblent à ce qui tourne. Les deux ont divergé pendant douze
# jours: le premier audit avait sorti le répertoire de session de `/tmp`, la
# correction avait été appliquée sur la machine, et personne ne l'avait
# committée. Le dépôt disait donc encore `/tmp`.
#
# Ça s'est payé le 30 août 2026. En corrigeant autre chose j'ai réinstallé
# l'unité depuis le dépôt, ce qui a ramené le répertoire de session dans `/tmp`
# sans un mot: la vibration a cessé de passer, parce que le worker écoutait un
# tube ailleurs. Une demi-heure pour comprendre.
#
# Dans les DEUX sens, délibérément. Une dérive ne dit pas d'elle-même quel côté
# a raison, et un contrôle qui ne regarderait qu'un sens laisserait exactement
# le cas qui vient de se produire.
deploy-check:
    #!/usr/bin/env bash
    set -euo pipefail
    faux=0
    for unit in deploy/*.service deploy/*.timer deploy/Caddyfile deploy/*.sudoers; do
        case "$unit" in
            *.service|*.timer) installe="/etc/systemd/system/$(basename "$unit")" ;;
            *Caddyfile) installe="/etc/caddy/Caddyfile" ;;
            *.sudoers) installe="/etc/sudoers.d/$(basename "$unit" .sudoers)" ;;
        esac
        if [ ! -e "$installe" ]; then
            echo "  absente de la machine: $(basename "$unit")"; faux=1; continue
        fi
        # Une règle sudo est lisible de root seul, par construction. La lire
        # avec sudo plutôt que la déclarer non vérifiable: un contrôle qui passe
        # sans rien regarder est pire que pas de contrôle du tout.
        if [ -r "$installe" ]; then
            ecart=$(diff "$unit" "$installe" || true)
        elif sudo -n cat "$installe" >/dev/null 2>&1; then
            ecart=$(sudo -n cat "$installe" | diff "$unit" - || true)
        else
            echo "  illisible sans droits: $(basename "$unit")"; faux=1; continue
        fi
        if [ -n "$ecart" ]; then
            echo "  diverge: $(basename "$unit")"
            echo "$ecart" | sed 's/^/      /'
            faux=1
        fi
    done
    # L'autre sens: une unité posée à la main sur la machine, sans copie ici.
    # Le 12 septembre 2026, nel3ab-cpu-performance tournait depuis la veille et
    # aucune boucle ne la voyait, parce que celle du dessus part du dépôt.
    for installe in /etc/systemd/system/nel3ab-*.service /etc/systemd/system/nel3ab-*.timer; do
        [ -e "$installe" ] || continue
        if [ ! -f "deploy/$(basename "$installe")" ]; then
            echo "  installée sans copie au dépôt: $(basename "$installe")"; faux=1
        fi
    done
    # Le FANTÔME: une unité que systemd a encore en mémoire alors que son fichier
    # a disparu du disque. Le 16 septembre 2026, une unité supprimée pendant
    # qu'elle tournait est restée active, et les deux boucles du dessus, qui
    # partent de fichiers, ne pouvaient pas la voir.
    for charge in $(systemctl list-units --all --no-legend 'nel3ab-*.service' | awk '{print $1}' | sed 's/^●[[:space:]]*//'); do
        fragment=$(systemctl show "$charge" -p FragmentPath --value 2>/dev/null || true)
        if [ -z "$fragment" ] || [ ! -e "$fragment" ]; then
            echo "  chargée par systemd sans fichier sur le disque: $charge"; faux=1
        fi
    done
    # Le PÉRIMÉ: une unité qui tourne depuis AVANT la dernière modification du
    # code qu'elle exécute. Le 22 septembre 2026, le salon tournait depuis le 14 et
    # ignorait l'événement « qualité » ajouté le 16: une semaine de propositions de
    # format réduit perdues sans un signal. Les trois boucles du dessus comparent
    # des fichiers entre eux; celle-ci compare un fichier à ce qui tourne.
    #
    # L'heure de modification plutôt que celle du dernier commit: le code installé
    # peut ne pas être commité, et git ne réécrit un fichier que si son contenu
    # change, donc un changement de branche sans effet sur le code ne rougit pas.
    # Caddy n'est pas suivi: `systemctl reload` recharge sa configuration sans
    # changer l'heure de démarrage, et la première boucle compare déjà le fichier.
    perime() {
        local unite="$1" code="$2"
        [ "$(systemctl show "$unite" -p ActiveState --value)" = active ] || return 0
        local depuis
        depuis=$(date -d "$(systemctl show "$unite" -p ActiveEnterTimestamp --value)" +%s)
        if [ "$code" -gt "$depuis" ]; then
            echo "  tourne avec un code plus ancien que le dépôt: $unite (démarrée $(date -d "@$depuis" '+%F %T'), code du $(date -d "@$code" '+%F %T'))"
            faux=1
        fi
    }
    # Les sources seules: le service écrit lui-même ses `.pyc` en tournant, et les
    # compter le déclarerait périmé par son propre démarrage. Les pages du salon
    # (HTML, modules, feuilles, dessins, polices) et le manifeste des consoles
    # comptent aussi: le salon les assemble UNE fois, à son démarrage. Le
    # 21 novembre 2026, une page de dépôt changée seule ne rougissait rien.
    controle=$(find control/nel3ab_control control/pyproject.toml control/uv.lock consoles/consoles.json \
        \( -name '*.py' -o -name pyproject.toml -o -name uv.lock -o -name '*.html' -o -name '*.mjs' \
           -o -name '*.css' -o -name '*.svg' -o -name '*.woff2' -o -name consoles.json \) -printf '%T@\n' \
        | cut -d. -f1 | sort -n | tail -1)
    perime nel3ab-control.service "$controle"
    perime nel3ab-boite-noire.service "$controle"
    worker=core/target/release/nel3ab-worker
    if [ -e "$worker" ]; then
        for salle in $(systemctl list-units --no-legend --state=active 'nel3ab-worker@*.service' | awk '{print $1}' | sed 's/^●[[:space:]]*//'); do
            perime "$salle" "$(stat -c %Y "$worker")"
        done
    fi
    # Les anciennes portes `.ts.net` ne font que renvoyer vers nel3ab.app, par
    # les deux sites de boucle locale du Caddyfile. Une porte qui servirait de
    # nouveau une page à côté du nom de domaine est ce que le 21 novembre 2026 a
    # retiré: deux adresses, dont une sans les gardes de l'autre.
    if command -v tailscale >/dev/null; then
        portes=$(tailscale serve status --json 2>/dev/null | python3 -c '
    import json, sys
    attendu = {"8443": "http://127.0.0.1:8098", "8444": "http://127.0.0.1:8097"}
    web = (json.load(sys.stdin) or {}).get("Web") or {}
    for port, cible in attendu.items():
        trouve = [v.get("Handlers") for k, v in web.items() if k.endswith(":" + port)]
        if trouve != [{"/": {"Proxy": cible}}]:
            print(f"  la porte .ts.net:{port} ne renvoie pas seulement vers {cible}: {trouve}")
    ' || echo "  tailscale serve illisible")
        if [ -n "$portes" ]; then echo "$portes"; faux=1; fi
        # Et par la VRAIE porte, avec le nom que tailscaled relaie: un essai sur
        # 127.0.0.1 passait le 21 novembre 2026 pendant que la porte rendait une
        # page vide.
        if ! bash deploy/anciennes-portes.sh >/dev/null; then
            bash deploy/anciennes-portes.sh | grep -v '^   ok' || true
            faux=1
        fi
    fi
    # Les fichiers d'unité peuvent être identiques et le salon quand même ne pas
    # démarrer: le 21 novembre 2026, un ajout d'un autre projet lançait le salon
    # dans son propre environnement Python, où manquait une dépendance du matin.
    # On importe donc le salon avec l'interpréteur que systemd lance vraiment.
    if ! bash deploy/salon-importable.sh; then faux=1; fi
    # Les salles, de la même façon: un ajout d'unité peut remplacer l'adaptateur
    # d'une console (le canari du socle, docs/xbox360.md). Il est nommé tant qu'il
    # existe, et rouge si son fichier n'existe plus. Chaque adaptateur est importé
    # avec le python3 que le PATH de l'unité donne au worker.
    if ! bash deploy/salles-adaptateurs.sh; then faux=1; fi
    if [ "$faux" -eq 0 ]; then echo "les unités installées sont celles du dépôt, et tournent avec son code"; else exit 1; fi

# Vérifie les pistes du MP4 et décode réellement son audio, sans Dolphin ni salle.
clip-audio-test:
    cd core && cargo test -p nel3ab-transport the_exported_mp4 -- --ignored

# Le clip des trente dernières secondes, demandé à la vraie salle.
#
# Ici et pas dans `check` parce que ce qu'on vérifie est qu'un FICHIER s'ouvre.
# Le worker recopie des unités d'accès dans un conteneur MP4, et une erreur là
# ne donne pas une erreur: elle donne un fichier que rien ne lit. Seul ffprobe,
# sur un vrai clip, peut le dire.
#
# Il faut donc une salle qui tourne, quarante-cinq secondes de jeu derrière une
# image-clé, et ffmpeg sur la machine. La CI n'a rien de tout ça.
clip-test:
    cd spikes/m3-browser-drive && node clip.mjs

# Ce que chaque jeu a comme sauvegardes, et ce qu'elles pèsent.
#
# Le numéro de salle n'est pas décoratif: depuis la bascule multi-salles,
# chaque salle a ses propres sauvegardes sous `salles/N`. Ces trois recettes
# visaient `session/`, le répertoire unique d'avant, que plus aucun worker
# n'alimente. Le 2026-09-13, `session/` n'avait pas bougé depuis la veille
# quand `salles/1` était réécrit la nuit même: `just saves` montrait donc un
# inventaire figé, et `just save-import` déposait un fichier là où aucun
# émulateur ne le lit. Ni l'un ni l'autre ne donnait d'erreur.
saves salle="1":
    #!/usr/bin/env bash
    set -euo pipefail
    racine="${NEL3AB_SESSION_DIR:-$HOME/.local/state/nel3ab/salles/{{salle}}}"/saves
    [ -d "$racine" ] || { echo "aucune sauvegarde pour l'instant"; exit 0; }
    for jeu in "$racine"/*/; do
        echo "$(basename "$jeu")"
        for emplacement in neuve debloquee; do
            dossier="$jeu$emplacement"
            if [ -d "$dossier" ]; then
                n=$(find "$dossier" -name '*.gci' | wc -l)
                poids=$(du -sh "$dossier" 2>/dev/null | cut -f1)
                printf '    %-11s %s fichier(s), %s\n' "$emplacement" "$n" "$poids"
            else
                printf '    %-11s vide\n' "$emplacement"
            fi
        done
    done

# Pose un fichier de sauvegarde dans l'emplacement d'un jeu.
#
#   just save-import mario-kart-double-dash-retro-track-grand-prix-iso debloquee ~/tout.gci
#
# Le nom du jeu est celui que `just saves` affiche, et il vient du nom de
# fichier de la ROM. L'ancien contenu de l'emplacement est écarté plutôt
# qu'effacé: une sauvegarde qu'on remplace est une sauvegarde que quelqu'un
# voudra peut-être revoir.
save-import jeu emplacement fichier salle="1":
    #!/usr/bin/env bash
    set -euo pipefail
    dossier="${NEL3AB_SESSION_DIR:-$HOME/.local/state/nel3ab/salles/{{salle}}}"/saves/{{jeu}}/{{emplacement}}
    case "{{emplacement}}" in
        neuve|debloquee) ;;
        *) echo "emplacement inconnu: {{emplacement}} (neuve ou debloquee)"; exit 1 ;;
    esac
    [ -f "{{fichier}}" ] || { echo "fichier introuvable: {{fichier}}"; exit 1; }
    mkdir -p "$dossier"
    if compgen -G "$dossier/*.gci" > /dev/null; then
        vieux="$dossier/remplacees-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$vieux" && mv "$dossier"/*.gci "$vieux"/
        echo "  ancien contenu écarté dans $(basename "$vieux")"
    fi
    rm -f "$dossier/unlocked.json"
    cp "{{fichier}}" "$dossier/"
    if [ "{{emplacement}}" = debloquee ]; then
        python3 tools/save-unlocked.py "$dossier" "$(basename "{{fichier}}")" --source "{{fichier}}"
    fi
    echo "  posé: $(basename "{{fichier}}") dans {{jeu}}/{{emplacement}}"

# Remet un emplacement à neuf, pour de vrai.
#
# « Neuve » cesse de l'être dès qu'on a joué une heure dessus. Sans ce geste, le
# mot ment au bout d'une soirée.
save-reset jeu emplacement salle="1":
    #!/usr/bin/env bash
    set -euo pipefail
    dossier="${NEL3AB_SESSION_DIR:-$HOME/.local/state/nel3ab/salles/{{salle}}}"/saves/{{jeu}}/{{emplacement}}
    [ -d "$dossier" ] || { echo "rien à vider"; exit 0; }
    n=$(find "$dossier" -maxdepth 1 -name '*.gci' | wc -l)
    find "$dossier" -maxdepth 1 -name '*.gci' -delete
    echo "  $n sauvegarde(s) effacée(s) dans {{jeu}}/{{emplacement}}"

# Les deux sauvegardes, jouées en vrai contre la salle.
#
# Ici et pas dans `check` parce que ce qu'on vérifie est un état du DISQUE après
# un vrai redémarrage: le worker fait pointer le dossier de carte de Dolphin
# vers l'emplacement choisi, et une erreur là ne donne pas une erreur. Elle
# donne une partie qui écrase la mauvaise sauvegarde, ce qui ne se voit qu'une
# fois trop tard.
# Ouvre un `data.bin` de Wii et pose son contenu dans un emplacement.
#
# Ce qui circule pour une Wii est un export CHIFFRÉ de console, pas un fichier de
# sauvegarde. Dolphin sait l'importer par son interface graphique, que cette
# machine n'a pas. La clé est publique et le format documenté: voir l'en-tête de
# `tools/wii-save-decode.py`, qui dit aussi les deux endroits où la documentation
# ne colle pas à ce qu'on trouve dans les fichiers.
#
# `just saves` dit quels emplacements existent.
wii-save-import export dossier unlocked="false":
    python3 tools/wii-save-decode.py {{export}} {{dossier}} {{if unlocked == "true" { "--unlocked" } else { "" }}}

# La page et la salle sont-elles d\'accord sur ce qui peut être transporté ? Le
# demi-format n'existe pas pour toutes les tailles d'image, et c'est un vrai
# encodeur devant un vrai jeu qui le dit.
# REDÉMARRE la salle, deux fois, avec sudo. Il visait `nel3ab-worker` et
# `~/.local/state/nel3ab/session/`, tous deux morts depuis la bascule
# multi-salles: les deux gestes étaient sans effet et la mesure suivante ne
# portait sur rien. Les deux se déduisent maintenant de l'adresse.
formats-test url="http://127.0.0.1:8110/":
    cd spikes/m3-browser-drive && node formats.mjs "{{url}}"

# Les réglages de manette suivent-ils la personne ? Demande le worker ET le plan
# de contrôle en marche, et une identité, donc le proxy devant.
manettes-test:
    cd spikes/m3-browser-drive && node manettes.mjs

# Demande NEL3AB_URL et pointe le PROXY: ce pilote lit le jeu en cours par
# `/api/room`, une route du SALON. Le worker seul sert la page à cette
# adresse, donc `JSON.parse` y recevait `<!doctype html>` et le pilote
# mourait avant sa première assertion utile.
saves-test:
    @test -n "${NEL3AB_URL:-}" || { echo "NEL3AB_URL manquant: ce pilote lit le jeu en cours par /api/room, que seul le salon sert."; echo "  Donner l adresse du proxy: NEL3AB_URL=https://<domaine>/r/<N>/ just saves-test"; exit 1; }
    cd spikes/m3-browser-drive && node saves.mjs "$NEL3AB_URL"

# Les plans de manette: chaque pièce sur son boîtier, et une image à regarder.
#
# Ici et pas dans `check` parce qu'il faut un vrai rendu: `getBBox` et
# `isPointInFill` n'existent pas dans jsdom, et l'oeil ne se triche pas. Le
# premier script vérifie la GÉOMÉTRIE (rien ne pend hors de la coque), le second
# écrit une capture dans /tmp/padmap-visuel.png pour la regarder. Ne compile
# rien, ne parle à aucune salle: l'aperçu est servi par Vite tout seul.
padmap-visuel:
    cd spikes/m3-browser-drive && node padmap-visuel.mjs

# La garde de la manette tactile, sur l'arbre de travail.
#
# À sept tailles d'écran et dans quatre salles (GameCube en 4:3 et 16:9,
# Switch, Xbox 360), le centre et les quatre bords de chaque touche reçoivent
# cette touche, un vrai appui arrive au pavé sous son nom, et aucun geste de
# page n'est à moins de 12 px d'une touche de jeu. Avec une bande noire de
# 130 px, rien ne mord sur l'image, gestes compris ; l'avis de fermeture reste
# au-dessus du pavé ; chaque inscription tient 4,5:1 dans les deux régies,
# nuit et jour, qui doivent donner deux panneaux différents.
# Écrite après l'audit du 22 novembre 2026, où taper R sur un iPhone cachait
# la manette. Hors de `check` parce qu'elle demande Chrome; dans `local`. Vite
# sert la page sans relais vers la salle, sur le port 5437 (MANETTE_GARDE_PORT
# pour un autre).
manette-garde out="/tmp/manette-garde":
    cd spikes/m3-browser-drive && node manette-garde.mjs {{out}}

# La salle sur téléphone et tablette, sur l'arbre de travail.
#
# À 375x667, 390x844, 430x932, 844x390, 932x430 et 768x1024, au doigt et avec
# les zones sûres d'un iPhone simulées, puis à 1440x900 à la souris: un seul
# « ••• » ouvre la feuille du bas, la feuille ouvre le tiroir de la salle, et
# chaque fonction de la colonne s'y joint au doigt (places, demander,
# signaler, diagnostic, spectateurs, quitter); rien ne déborde ni ne se
# recouvre; sans API plein écran, la feuille propose l'écran d'accueil sans
# erreur; l'entrée de la salle tient en haut en paysage; le réglage des touches
# prend tout l'écran tenu en travers; la page CONSTRUITE pose le thème choisi
# avant sa première image. Écrite après l'audit du 22 novembre 2026 (P5, M6,
# M8, M9, M10, M11, E2). Depuis sa relecture, le même jour: toutes les cibles
# du tiroir à 44 px, le bouton qui le referme une fois défilé, le focus rendu,
# la manette « toujours » sur un grand écran, Ctrl sous le menu, une page
# « manette seule » pendant un chargement, la demande de place et la reprise
# hors du « ••• » et de l'encoche, le fond du menu jusqu'aux bords, le
# configurateur Pro et la préparation en paysage, et la page construite servie
# avec la politique du worker. Un faux salon (une socket qui répond à la
# poignée de main d'engine.io) lui laisse envoyer une annonce. Hors de `check`
# parce qu'elle demande Chrome; dans `local`. Vite sert la page sans relais,
# avec une fausse session média (`salle-telephone.session.ts`), sur le port
# 5446 (SALLE_TELEPHONE_PORT).
salle-telephone out="/tmp/salle-telephone":
    cd spikes/m3-browser-drive && node salle-telephone.mjs {{out}}

# Le banc d'essai, regardé et mesuré.
#
# Ici et pas dans `check` pour la même raison que l'aperçu des plans: ce qui se
# juge ici ne se mesure pas en jsdom — un chiffre qui déborde de sa case, une
# jauge trop fine pour se voir. Le contraste, lui, EST mesuré, et il l'est ici
# plutôt que par `browser-contraste`: celui-là tape le worker en vie, donc la
# page compilée dans son binaire, et ne voit pas un écran pas encore déployé.
# Vite sert l'aperçu tout seul, aucune salle n'est touchée.
banc-visuel:
    cd spikes/m3-browser-drive && node banc-visuel.mjs /tmp/banc-visuel.png

# La mise en page que l'audit visuel du 22 novembre 2026 a corrigée: le
# dialogue Switch centré, la légende de la jauge de l'accueil sur un téléphone,
# les cases de la préparation sous leur titre, et l'image noire dans les deux
# régies. Hors de `check` pour la même raison que le banc: jsdom ne pose rien.
# Son propre Vite sans relais, l'accueil assemblé par les modules du salon:
# aucune salle ni aucun salon n'est touché.
regie-visuel:
    cd spikes/m3-browser-drive && node regie-mise-en-page.mjs

# Le même écran, mais contre la VRAIE salle et sa page déployée.
#
# Les deux ne regardent pas la même chose et c'est le point: `banc-visuel` voit
# l'arbre de travail par Vite, celui-ci voit la page compilée dans le binaire du
# worker. Quand les deux divergent, c'est qu'on a oublié de reconstruire.
banc-reel:
    cd spikes/m3-browser-drive && node banc.mjs http://localhost:8110/ /tmp/banc-reel.png

# Changer d'extension de Wiimote sans relancer le jeu.
#
# Ici et pas dans `check` parce que ça demande un vrai jeu Wii, l'image Dolphin
# et une minute: c'est une manip, pas un essai. Elle prouve que Dolphin échange
# l'extension en cours de partie sur ordre extérieur, et elle ne prouve PAS que
# le jeu accepte l'échange à ce moment-là — voir son README, qui dit pourquoi la
# distinction compte.
#
# Elle tourne dans son propre conteneur. Sans ça elle tue la salle en cours, ce
# qui est arrivé.
manette-a-chaud:
    python3 spikes/m5-manette-a-chaud/extension-a-chaud.py

# Le chemin COMPLET: un clic dans la page change l'extension, sans rien relancer.
#
# `manette-a-chaud` prouve que Dolphin échange sur ordre extérieur; celle-ci
# prouve que l'ordre part de la page et arrive jusqu'à lui, c'est-à-dire les cinq
# couches entre les deux qu'aucun essai unitaire ne traverse.
#
# L'observable qui compte est l'identifiant du processus Dolphin: sans lui, un
# redémarrage donnerait les mêmes lignes de journal et passerait pour une
# réussite. La salle doit tourner sur un jeu Wii réglé en Wiimote; le pilote le
# dit et s'arrête plutôt que de passer à vide.
manette-depuis-la-page:
    python3 spikes/m5-manette-a-chaud/depuis-la-page.py

# La cadence réelle du flux Switch, lue par WebSocket comme la page la lit.
#
# Ici et pas dans `check` parce qu'il faut une salle Switch qui tourne. Range
# les écarts entre images en périodes de 16,67 ms: une source à 60 donne tout
# en « 1 », une sortie Sway sans taux de rafraîchissement tout en « 2 ». C'est
# la mesure qui a trouvé le 31,5 images par seconde du 9 septembre 2026.
switch-cadence seconds="8":
    cd spikes/m3-browser-drive && node switch-cadence.mjs http://127.0.0.1:8110 {{seconds}} full && node switch-cadence.mjs http://127.0.0.1:8110 {{seconds}} half

# De l'appui à l'image sur le chemin Switch, mesuré de l'extérieur: une trame
# entre par `/input`, et l'on chronomètre la première image qui a changé sur
# `/video`. Changé se lit en décodant, jamais à la taille des images: une image
# clé périodique passait pour une réponse (1,5 ms annoncées le 10 septembre).
#
# Ici et pas dans `check` parce qu'il faut une salle Switch qui tourne, et
# ffmpeg. `screen=menu` part du menu principal de Looney Tunes (Bas, puis Haut):
# le plancher. `screen=titre` part de l'écran de titre (L+R, puis B): un plafond,
# fondu du jeu compris. Chaque appui est comparé à un témoin sans appui, et la
# série est refusée si les témoins se contredisent. Prend la place demandée: à
# lancer quand personne ne joue. Le worker mesure en même temps sa propre part
# sous « input_to_frame » dans son journal.
switch-reaction screen="menu" trials="5" port="1":
    cd spikes/m3-browser-drive && node switch-reaction.mjs http://127.0.0.1:8110 {{trials}} {{port}} {{screen}}

# La sieste, jouée en vrai: la salle s'endort, on la réveille, et on lit ce que
# le worker en a écrit.
#
# Ici et pas dans `check` parce que c'est une COURSE entre le fil qui dégèle et
# celui qui encode, elle se joue en quelques millisecondes autour de
# `docker unpause`, et aucun test unitaire ne peut la voir. Il faut un vrai
# conteneur, un vrai émulateur et une minute de patience: exactement la même
# raison que `gpu-test`.
# Le conteneur et l'unité portent le NUMÉRO de la salle depuis la bascule
# multi-salles: l'unité pose `NEL3AB_CONTAINER=nel3ab-dolphin-%i`, et le
# worker ne retombe sur `nel3ab-dolphin` que si cette variable manque.
#
# Ce pilote cherchait l'ancien nom, et `journalctl -u nel3ab-worker`
# l'ancienne unité, morte depuis que les salles sont trois. Le 13 septembre
# 2026 j'ai vu `docker inspect nel3ab-dolphin` rendre « no such object » et
# j'en ai conclu à tort que le conteneur manquait à la machine: il tournait,
# sous le nom `nel3ab-dolphin-1`. Les deux noms se déduisent maintenant de
# l'adresse, et le pilote REFUSE s'il n'y arrive pas.
#
# Les horloges en jeu, lues dans `crates/emulator/src/nap.rs`: le gel vient
# après une minute de salle vide (`GRACE`), le jeu se ferme après trois
# (`EMPTY_AFTER`), et la salle après trente (`CLOSE_AFTER`). La fenêtre
# utile fait donc deux minutes, et ce pilote la traverse plusieurs fois.
nap-test url="http://127.0.0.1:8110/":
    cd spikes/m3-browser-drive && node nap.mjs "{{url}}"

# Is the committed page the one these sources produce?
#
# The page is a build artefact that is committed, so `cargo build` never needs
# node. That trade has one failure mode: a change to `front/src` that nobody
# rebuilt, shipping a binary with yesterday's page in it.
#
# Compares the stamp rather than the HTML. Rebuilding and diffing the file was
# the first attempt and it fails on unchanged sources: the minifier renames a
# handful of locals differently between two runs of the same input. A check that
# is red for no reason is a check people learn to skip.
front-check:
    cd front && node stamp.mjs --check

# Tout ce que la page calcule doit être affiché quelque part.
#
# Trois pannes de la semaine du 2026-08-17 ont coûté une soirée chacune, et les
# trois se sont résolues sur un chiffre que la page tenait déjà sans le montrer.
# Un compteur qu'on ne montre pas ne sert à personne le jour où il faut chercher.
readouts-check:
    cd front && node audit-readouts.mjs

# Relire une soirée: qui est venu, quand, sur quelle manette, pendant quel jeu.
#
# Existe parce que le 16 août 2026 on m'a demandé de retrouver une séance de
# 16 h 43 et qu'il n'y avait rien à lire. Le salon tient maintenant un journal de
# deux jours; ceci le rend lisible.
#
#   just sessions                     aujourd'hui
#   just sessions 2026-08-16          ce jour-là
#   just sessions 2026-08-16 kitaru   seulement ce qui le concerne
sessions *args:
    cd control && uv run python sessions.py {{args}}

# Relire la boîte noire: la machine et les pages sur la même tranche de dix
# secondes, puis les captures prises quand la cadence chutait.
#
#   just boite-noire                          aujourd'hui
#   just boite-noire 2026-09-14               ce jour-là
#   just boite-noire 2026-09-14 00:15-00:40   seulement cette plage
boite-noire *args:
    cd control && uv run python boite_noire.py {{args}}

# Shared code-quality checks. GPU, audio clip, Switch adapter, docs and dependency
# checks have separate recipes; this one is called by CI's quality job.
# L'ordre compte, et il a coûté trois commits rouges.
#
# `front-check` passe EN DERNIER, après `contract-check`. Ce dernier régénère le
# client TypeScript sous `front/src`, donc une empreinte vérifiée avant lui
# décrit un état que la porte elle-même vient de changer: la vérification passait
# au vert puis devenait fausse dans la même commande, et le commit suivant
# partait avec une marque périmée.
#
# Vérifier en dernier veut dire vérifier ce qui sera commité.
#
# `salles-dore` et `moteurs-test` y entrent le 22 novembre 2026, sur décision du
# propriétaire: les adaptateurs des salles externes n'étaient éprouvés par
# aucune recette de `check`, donc par aucune CI. Ils demandent `/usr/bin/python3`,
# ni Docker ni carte.
check: fmt-check lint test control salles-dore moteurs-test front readouts-check contract-check front-check

# Le socle des salles externes et ses modules de moteur (moteurs/README.md).
#
# Sous `/usr/bin/python3`, l'interpréteur que le worker lance, et pas sous le
# venv du salon: une dépendance qui n'existe que là-bas passerait ici sinon.
# `test_regles.py` importe en plus chaque module sous `-I -S`. PLC0415 refuse
# un import dans le corps d'une fonction: une salle lit tout son code au
# démarrage, et un import paresseux lirait au moment de l'arrêt une version
# plus récente de l'arbre principal.
moteurs-test:
    /usr/bin/python3 -B -m unittest discover -s moteurs -t . -p 'test_*.py'
    cd control && uv run ruff check --config pyproject.toml --extend-select PLC0415 ../moteurs
    cd control && uv run ruff format --check --config pyproject.toml ../moteurs

# Les commandes Docker de chaque salle externe, figées scénario par scénario.
#
# Chaque scénario lance le VRAI script de la salle dans un `/usr/bin/python3`
# neuf, comme le worker, et compare ses commandes, son erreur et l'arbre de son
# emplacement à `docker/dore/<scénario>.json`. Une migration d'adaptateur doit
# les garder inchangés. Trois passages: sous le compte de la machine, sous un
# autre compte (la CI ne tourne pas sous 1000:1000), et sur une copie de ce que
# les scripts lisent. Mesuré le 22 novembre 2026 sur cette machine (12 fils):
# 50 scénarios, dont les 18 de la Xbox 360 aussi par le canari, et treize
# mutants, en 5,4 à 5,9 s sur quatre lancements alternés avec la version qui
# lançait les passages et les mutants l'un après l'autre (6,1 à 6,3 s). Un autre
# chantier pilotait un navigateur, charge moyenne 4 à 5,6: un plafond, pas une
# mesure au repos. Avant la relecture, le banc (deux passages, neuf mutants)
# prenait 3,8 s à une charge de 0,5.
salles-dore:
    python3 docker/test_salles_dore.py
    cd control && uv run ruff check --config pyproject.toml ../docker/test_salles_dore.py ../docker/dore
    cd control && uv run ruff format --check --config pyproject.toml ../docker/test_salles_dore.py ../docker/dore

# Réécrit le doré et affiche chaque ligne qui change.
#
# Refuse tant qu'un autre fichier est modifié dans l'arbre: un commit qui change
# le doré ne fait que ça, avec sa raison. Sans ce refus, une migration qui casse
# une commande se « réparerait » en réécrivant le doré dans le même commit.
salles-dore-ecrire:
    #!/usr/bin/env bash
    set -euo pipefail
    autres=$( {
        git status --porcelain --untracked-files=no -- . ':(exclude)docker/dore'
        git status --porcelain --untracked-files=all -- docker moteurs spikes/switch-room spikes/xbox360 ':(exclude)docker/dore'
    } | sort -u)
    if [ -n "$autres" ]; then
        echo "refusé: d'autres fichiers que docker/dore/ sont modifiés. Les committer d'abord, ou les mettre de côté:"
        printf '%s\n' "$autres" | sed 's/^/    /'
        exit 1
    fi
    python3 docker/test_salles_dore.py --ecrire

# Auto-fix pass for development. Mirrors `poe fix`.
# Le formatage automatique, des DEUX côtés.
#
# La page était absente d'ici, et son absence a coûté quatre commits rouges: à
# formater le front à la main par `npx oxfmt src`, on reformate aussi
# `front/src/client`, que le projet exclut exprès parce que son style appartient
# au générateur. L'étape suivante le régénère, l'empreinte de la page décrit
# alors des octets qui n'existent plus, et CI refuse un commit dont la porte
# locale était verte.
#
# `npm run format` passe les fichiers d'exclusion. Une recette qui le fait à
# votre place est une recette qu'on n'oublie pas.
fix:
    cd core && cargo fmt --all
    cd core && cargo clippy --workspace --all-targets --fix --allow-dirty
    cd front && npm run format

fmt-check:
    cd core && cargo fmt --all --check

# `-D warnings` makes every lint blocking: a warning IS a failure.
#
# `--all-features` so the gated code is linted too — the GPU FFI and the hardware
# integration tests. Code nobody lints is code nobody checks.
#
# This needs build-time tools (`libavcodec-dev libavutil-dev libva-dev
# glslang-tools`) but not a GPU: clippy analyses without linking, yet the build
# script compiles real C and a real shader, and cannot be talked out of wanting
# real headers and a real compiler. CI installs them for exactly this recipe.
# It went red once for want of that line.
lint:
    cd core && cargo clippy --workspace --all-targets --all-features -- -D warnings

test:
    cd core && cargo test --workspace --all-targets

# The tests that need the GPU on this machine. NOT part of `check`, because CI
# has no GPU and a test that cannot run must not report a pass.
#
# `vaapi` compiles the GPU FFI and needs only headers; `gpu-tests` runs what
# needs a real device. They were one flag until the worker started depending on
# `vaapi` for real: Cargo unifies features across a workspace, so `cargo test
# --workspace` began running GPU tests on the CI runner.
gpu-test:
    cd core && sg render -c 'cargo test -p nel3ab-encoder --features gpu-tests'

# Les états de la salle dans un vrai navigateur, contre un banc simulé.
#
# Écrite après le 21 novembre 2026: l'image est restée figée vingt minutes, le
# son continuait, et la page n'a rien dit. La règle vit dans une fonction pure
# (`front/src/media/liaison.ts`), mais la relecture adverse du lendemain a
# trouvé cinq défauts qu'elle ne voyait qu'avec une vraie page: un jeu qui
# repart à 45 images par seconde restait « figé », une socket muette faisait
# dire « L'image est revenue. », un 502 passait pour le site, une salle qui
# redémarre se disait fermée, une liaison qui cale ne se voyait plus rien
# proposer. Chaque étape en rejoue un avec son jumeau (`etats.mjs`).
#
# Le banc sert la page COMMITTÉE et vérifie l'empreinte de ce qu'il sert. Un
# salon et une salle simulés, sur un port de 5400 à 5499: aucune salle vivante,
# aucun émulateur. Le flux est un vrai H.264, fabriqué ici par ffmpeg plutôt
# que committé (1,6 Mo). Hors de `check`: Chrome, ffmpeg et cinq minutes.
#
#   just etats-navigateur                          toutes les étapes
#   just etats-navigateur --etapes gel-dit         une seule
#   just etats-navigateur --captures /tmp/etats    avec les captures
etats-navigateur *args:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    cd spikes/m3-browser-drive
    node etats.mjs --page ../../core/crates/worker/src/page/index.html --flux "$dossier/flux.h264" {{args}}

# Le contrôle négatif du précédent: les pages d'avant doivent échouer sur le
# DÉFAUT de chaque étape, pas sur une précondition. 8b58526 est la page d'avant
# le chantier, e5d6edf celle que la relecture a refusée. Une étape qui passe
# sur l'une d'elles ne prouve rien.
etats-navigateur-rouge:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    git show 8b58526:core/crates/worker/src/page/index.html > "$dossier/avant.html"
    git show e5d6edf:core/crates/worker/src/page/index.html > "$dossier/refusee.html"
    cd spikes/m3-browser-drive
    node etats.mjs --page "$dossier/avant.html" --flux "$dossier/flux.h264" \
        --etapes gel-dit,chargement-menu,gel-sans-proposition,lien-qui-cale \
        --rouge-attendu gel-dit,chargement-menu,gel-sans-proposition,lien-qui-cale
    node etats.mjs --page "$dossier/refusee.html" --flux "$dossier/flux.h264" \
        --etapes reprise-45,socket-muette,relais-502,redemarrage,arrivee-refusee,lien-qui-cale \
        --rouge-attendu reprise-45,socket-muette,relais-502,redemarrage,arrivee-refusee,lien-qui-cale

# Les parcours de la salle, dans un vrai navigateur.
#
# Écrite le 22 novembre 2026 après la relecture du chantier « parcours et
# mots »: l'entrée dans l'adresse et l'adresse qui suit la place, le
# rechargement, l'invitation, la sortie unique, la fermeture de la salle par le
# chef, le verbe du chef et la reprise de son rôle, les noms de console d'une
# préparation GameCube et Xbox 360, « ma sauvegarde » pour qui lance, les
# cibles au doigt et les places de l'avant-salle. Chaque étape a son jumeau
# (`parcours.mjs`).
#
# Le banc sert la page COMMITTÉE et vérifie l'empreinte de ce qu'il sert: un
# salon et une salle simulés sur un port de 5400 à 5499 (`parcours-banc.mjs`),
# aucune salle vivante, aucun émulateur. Hors de `check`: Chrome et ffmpeg.
#
#   just parcours-navigateur                          toutes les étapes
#   just parcours-navigateur --etapes invitation      une seule
#   just parcours-navigateur --captures /tmp/p        avec les captures
parcours-navigateur *args:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    cd spikes/m3-browser-drive
    node parcours.mjs --page ../../core/crates/worker/src/page/index.html --flux "$dossier/flux.h264" {{args}}

# Le contrôle négatif du précédent: chaque étape doit échouer sur son DÉFAUT,
# pas sur une précondition. 528e870 est la page d'avant le chantier: tout y
# rougit sauf `place-suit-adresse`, qui suppose l'entrée dans l'adresse et y
# tombe sur sa précondition. e851a64 est la page que la relecture a refusée:
# seules y rougissent les quatre étapes de ses défauts, les autres y passent,
# et c'est ce qu'elles doivent faire.
parcours-navigateur-rouge:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    git show 528e870:core/crates/worker/src/page/index.html > "$dossier/avant.html"
    git show e851a64:core/crates/worker/src/page/index.html > "$dossier/refusee.html"
    cd spikes/m3-browser-drive
    etapes=entree-adresse,rechargement,invitation,quitter,fermer-salle,menu-chef,preparation-gamecube,preparation-x360,lanceur-ma-sauvegarde,cibles-tactiles,avant-salle-places
    node parcours.mjs --page "$dossier/avant.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    etapes=place-suit-adresse,menu-chef,cibles-tactiles,avant-salle-places
    node parcours.mjs --page "$dossier/refusee.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"

# Le focus, le clavier et les menus de la salle, dans un vrai navigateur.
#
# Écrite le 22 novembre 2026 après l'audit d'accessibilité: Entrée sur un
# bouton de la colonne partait au jeu comme START, Entrée sur « reprendre »
# ouvrait le dossier sous le curseur du menu, le menu ne prenait pas le focus,
# et sur un téléphone la moitié de ses rubriques sortait de l'écran. jsdom ne
# voit rien de tout ça: il faut un vrai focus et une vraie activation. Chaque
# étape a son jumeau, dont « Entrée dans la zone de jeu envoie START », lu dans
# les trames que reçoit le banc (`focus.mjs`).
#
# Le même banc que `etats-navigateur`: la page COMMITTÉE, un salon et une salle
# simulés sur un port de 5400 à 5499. Hors de `check`, que la CI partage: Chrome,
# ffmpeg et une minute et demie. Dans `local` depuis la relecture du
# 22 novembre 2026: une preuve que rien n'appelle ne garde rien.
#
#   just focus-navigateur                          toutes les étapes
#   just focus-navigateur --etapes menu-modal      une seule
#   just focus-navigateur --captures /tmp/focus    avec les captures
focus-navigateur *args:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    cd spikes/m3-browser-drive
    node focus.mjs --page ../../core/crates/worker/src/page/index.html --flux "$dossier/flux.h264" {{args}}

# Le contrôle négatif du précédent: la page d'avant ce chantier (f4b90c5) doit
# échouer sur le DÉFAUT de chaque étape, pas sur une précondition. Les jumeaux
# (`entree-jeu`, `menu-entree-curseur`) n'y sont pas: ils passent sur les deux
# pages, et c'est ce qu'ils doivent faire.
#
# Puis la page de la première version (55047a9), que sa relecture du même jour
# a trouvée fausse: liste écrasée sur une tablette, libellés coupés à 320 px,
# sortie de la Switch hors de l'écran, avis du menu sur la sortie, anneau
# permanent sur l'image, clavier perdu après un clic sur la colonne, avis du
# clavier sous la proposition. Chaque étape ajoutée par la relecture doit y
# échouer sur son défaut. `entree-sans-clic` et `tab-retour` passent sur
# 55047a9, qui avait déjà ce câblage: elles rougissent sur f4b90c5 et contre
# les mutants qui le retirent (carnet, 22 novembre 2026).
focus-navigateur-rouge:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    git show f4b90c5:core/crates/worker/src/page/index.html > "$dossier/avant.html"
    git show 55047a9:core/crates/worker/src/page/index.html > "$dossier/relue.html"
    cd spikes/m3-browser-drive
    etapes=entree-colonne,entree-jeu-pro,menu-entree-focus,menu-modal,curseur-focus,aides-clavier,aides-manette,premiere-visite,rubriques,telephone,noms,entree-sans-clic,tab-retour,surcouche,coques-telephone
    node focus.mjs --page "$dossier/avant.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    etapes=telephone,tablette,coques-telephone,surcouche,anneau,clic-colonne,avis-haut,carte-wii,connexion-telephone
    node focus.mjs --page "$dossier/relue.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"

# ==== chantier salle ====
# Le cadre de la salle, dans un vrai navigateur: rien ne se pose sur l'image ni
# ne la voile, à sept tailles de bureau et au niveau d'effets « tout », en
# partie, avec la fermeture proche annoncée, avec le clavier rendu à la
# colonne, et l'image agrandie par Ctrl (`cadre.mjs`, chantier salle du
# 23 novembre 2026). Même banc que `parcours-navigateur` (Chrome, ffmpeg, rien
# de vivant, port 5478).
#
#   just cadre-navigateur                         toutes les étapes
#   just cadre-navigateur --etapes agrandie       une seule
#   just cadre-navigateur --captures /tmp/cadre   avec les captures
cadre-navigateur *args:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    cd spikes/m3-browser-drive
    node cadre.mjs --page ../../core/crates/worker/src/page/index.html --flux "$dossier/flux.h264" {{args}}

# Ce que coûtent les effets (étape 8 du chantier salle) : quatre phases de
# 60 s en alternance, sobre, tout, sobre, tout, sur la page committée et le
# banc H.264, images peintes par seconde et plus long écart. Hors de la porte:
# quatre minutes de mesure, à lancer sur une machine au repos (aucune autre
# porte, aucun profileur), dont la charge est écrite à chaque phase.
cadre-mesure:
    just cadre-navigateur --etapes mesure-effets

# Le contrôle négatif du précédent: la page de 03b21c0, d'avant le chantier,
# doit échouer sur le DÉFAUT de chaque étape (la pile des avis sur l'image, les
# boutons de coin d'une colonne repliée, la manette « toujours » posée sur
# l'image à la souris), pas sur une précondition. La garde elle-même
# (`garde-voit`) doit rester verte sur cette page: elle ne dépend pas du cadre.
#
# Les étapes nouvelles du chantier lisent aussi des pages de la branche du
# chantier (0fef99e, 3cada57, 2cb36ba, cf3bba1, acfa4c7). Ces commits ne vivent
# que sur `chantier/retro-salle`, que l'intégration refait : leurs pages sont
# gardées dans le dépôt (`spikes/m3-browser-drive/rouges/`, relecture du
# 23 novembre 2026), chacune avec l'empreinte git de la page de son commit
# (`EMPREINTES`), vérifiée avant usage. Une copie changée arrête la recette.
cadre-navigateur-rouge:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    rouges="$(pwd)/spikes/m3-browser-drive/rouges"
    while read -r empreinte commit fichier; do
        lue=$(git hash-object "$rouges/$fichier")
        if [ "$lue" != "$empreinte" ]; then
            echo "$fichier n'est plus la page de $commit ($lue au lieu de $empreinte)" >&2
            exit 1
        fi
    done < "$rouges/EMPREINTES"
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    git show 03b21c0:core/crates/worker/src/page/index.html > "$dossier/avant.html"
    cd spikes/m3-browser-drive
    node cadre.mjs --page "$dossier/avant.html" --flux "$dossier/flux.h264" --etapes garde-voit
    # manette-branchee: l'avis de branchement de cette page couvre L.
    # souris-toujours: la manette « toujours » se pose sur l'image à la souris.
    # sortir-salle: Quitter part sans la transition « sortir-salle » (K13).
    etapes=rien-sur-image,agrandie,manette-branchee,souris-toujours,sortir-salle
    node cadre.mjs --page "$dossier/avant.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    # La page de la fin du passage 1 (0fef99e) a déjà le cadre, mais ni le
    # panneau de commande ni la colonne nouvelle: elle doit tomber sur le
    # panneau absent de l'écran et sur les onglets restés là.
    etapes=meuble-place,une-fois
    node cadre.mjs --page "$rouges/salle-0fef99e.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    # La page de la colonne du bureau (3cada57) ouvre encore son menu d'office
    # dans une salle au repos.
    etapes=repos-sans-menu
    node cadre.mjs --page "$rouges/salle-3cada57.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    # Quatrième bloc (étape 7): la page de l'étape 6 (2cb36ba) n'a ni
    # fronton, ni crédit, ni trame, ni décor de borne; chaque étape doit y
    # rougir sur son défaut, pas sur le jumeau de son balayage.
    etapes=fronton-bande,credit-compte,tramage-hors-image,borne-bandes
    node cadre.mjs --page "$rouges/salle-2cb36ba.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    # Cinquième bloc (étape 4): la page de l'étape 7 (cf3bba1) pose la
    # manette tactile par-dessus l'écran; tenue en main, elle doit rougir sur
    # les touches posées sur l'image, pas sur une manette absente.
    etapes=tenu-rien-sur-image
    node cadre.mjs --page "$rouges/salle-cf3bba1.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
    # Sixième bloc (passage 5): la page de la fin du passage 4 (acfa4c7) garde
    # ses touches à l'écran devant une vraie manette, sa bande ne dit pas
    # quelle manette joue, sa feuille à mi-hauteur n'a pas le clip, et ni son
    # fronton, ni sa colonne, ni sa barre ne portent l'ancre de l'annonce.
    # Passage 6: sans barre (844×390, 375×548), aucune scène de la mascotte
    # n'y joue, faute d'hôte dans « La salle ».
    etapes=manette-branchee,manette-vraie,feuille-clip,fronton-bande,tenu-rien-sur-image,mascotte-hors-image
    node cadre.mjs --page "$rouges/salle-acfa4c7.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
# ==== fin salle ====

# ==== manettes ====
# « Touches et manettes » dans un vrai navigateur (chantier manettes, L7) : le
# panneau prend la place de la colonne sans toucher l'image (bureau et
# fenêtre étroite), « Toutes les touches » ouvre le clavier et Échap rend le
# focus, la vue de la manette suit la trame Pro (K34), et le pas à pas tourne
# sur une manette simulée. La page COMMITTÉE, le banc des parcours, une
# manette Xbox simulée ; rien de vivant, port 5482.
#
#   just reglage-navigateur                        les étapes de la porte
#   just reglage-navigateur --etapes place-tenu    hors porte : tenu en main
#   just reglage-navigateur --captures <dossier>   avec les captures
reglage-navigateur *args:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    cd spikes/m3-browser-drive
    node reglage.mjs --page ../../core/crates/worker/src/page/index.html --flux "$dossier/flux.h264" {{args}}

# Le contrôle négatif : la page de la base du chantier (9fb659e, sur
# integration/retro) ouvre l'ancien dialogue modal par-dessus l'image, n'a pas
# « Toutes les touches », ne suit pas la trame Pro dans la vue de la manette,
# et ne monte aucun panneau dans la colonne. Chaque étape doit y rougir sur
# son défaut, pas sur une précondition.
reglage-navigateur-rouge:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier=$(mktemp -d)
    trap 'rm -rf "$dossier"' EXIT
    ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x480:rate=60 \
        -frames:v 180 -c:v libx264 -profile:v baseline -preset ultrafast -tune zerolatency \
        -g 60 -bf 0 -x264-params aud=1:repeat-headers=1 -f h264 "$dossier/flux.h264"
    git show 9fb659e:core/crates/worker/src/page/index.html > "$dossier/avant.html"
    cd spikes/m3-browser-drive
    etapes=place,entrees,activite-pro,pas-a-pas
    node reglage.mjs --page "$dossier/avant.html" --flux "$dossier/flux.h264" \
        --etapes "$etapes" --rouge-attendu "$etapes"
# ==== fin manettes ====

# Does the page survive its decoder dying? Needs the worker RUNNING and streaming
# (`systemctl start nel3ab-worker@1`), because the failure only exists against a
# live stream: a decoder that is fed nothing cannot be caught refusing anything.
#
# Not part of `local`: it drives a real Chrome against a real session, so it is
# the recipe to run when the page changes rather than on every commit.
browser-recovery:
    cd spikes/m3-browser-drive && node wedge.mjs http://localhost:8110/ 6

# Le propriétaire de la salle: le premier arrivé, et la passation quand il part.
#
# Demande une salle VIDE, et s'abstient sinon: quelqu'un qui joue à côté n'est
# pas un défaut.
browser-owner:
    cd spikes/m3-browser-drive && node owner.mjs

# La manette conduit-elle le menu, et rien ne descend-il au jeu pendant ?
#
# Manette simulée: ce qui est vérifié est le câblage entre la boucle d'entrée et
# la croix, pas un pilote USB.
browser-padmenu:
    cd spikes/m3-browser-drive && node padmenu.mjs http://127.0.0.1:8110/

# Demander la manette de quelqu'un, et la lui voir céder ou refuser.
#
# Deux pages à travers le VRAI proxy: la négociation traverse le salon, qui ne
# sait qui tient quoi que parce que le proxy dit qui est qui.
browser-swap:
    cd spikes/m3-browser-drive && node swap.mjs

# L'identité, de bout en bout, à travers le VRAI proxy.
#
# Contre l'adresse tailscale et pas localhost: c'est le proxy qui écrit
# l'identité, donc mesurer ailleurs mesurerait son absence. Ça veut dire que
# cet essai ne tourne QUE sur la machine qui sert la salle.
browser-identity:
    cd spikes/m3-browser-drive && node identity.mjs

# L'antisèche dit-elle vrai, et la réassignation tient-elle ?
#
# La manette est SIMULÉE, en remplaçant `navigator.getGamepads`: ce qui est
# vérifié est la traduction et la réassignation, pas le pilote USB. Brancher une
# vraie DualSense sur le serveur pour tester l'affichage d'un nom serait un
# montage que personne ne peut rejouer.
browser-bindings:
    cd spikes/m3-browser-drive && node bindings.mjs http://localhost:8110/

# Ce que la page rend, sur une minute, sans rien redémarrer.
#
# Le banc redémarre la session, donc il ne peut pas tourner pendant que
# quelqu'un joue. Celui-ci n'est qu'un spectateur de plus: il mesure le côté
# navigateur, qui est la moitié qu'un changement de page peut dégrader.
browser-watch seconds="60":
    cd spikes/m3-browser-drive && node watch.mjs http://localhost:8110/ {{seconds}}

# Ce qu'une soirée de jeu a montré, personne par personne: images, gels, format,
# trous de son, sourdine contre son, propositions de format réduit, captures de
# la boîte noire et chaînes cassées. Ne lance rien, relit ce que la machine garde.
soiree jour depuis="":
    python3 tools/soiree.py {{jour}} {{ if depuis == "" { "" } else { "--depuis " + depuis } }}

# Une page derrière une liaison dégradée: débit, perte et gigue, pour de vrai.
#
# `just banc-liaison 6 1 20` mesure le profil « Hyde »: 6 Mbit/s, 1 % de perte,
# 20 ms de gigue. `0` veut dire « pas de limite » pour le débit.
#
# Deux sources d'images:
#
# - un CLIP (`just banc-liaison 0 1 20 1 60 /chemin/clip.mp4`): le banc lance son
#   propre worker, sur des ports et des dossiers jetables, qui rejoue le clip en
#   boucle à travers le vrai encodeur. Les mêmes images à chaque passage, donc
#   des mesures qui se comparent. Aucune salle n'est touchée. C'est la source à
#   préférer pour comparer deux versions;
# - une SALLE ouverte avec un jeu, et PERSONNE dedans: le banc est un spectateur
#   de plus. `node spikes/m3-browser-drive/lancer-jeu.mjs https://nel3ab.app/r/1/`
#   lance un jeu. Le 23 septembre 2026, l'écran de démonstration allait de 0,8 à
#   25 Mbit/s selon la minute: une fenêtre sur deux n'a rien mesuré.
#
# # Pourquoi un espace réseau et pas `throttle.mjs`
#
# Un relais TCP en espace utilisateur ne peut pas perdre un paquet: la perte y
# devient un retard, et le blocage en tête de ligne qu'elle provoque dans TCP,
# qui est le cas de Hyde, n'apparaît jamais. `tc netem` perd dans le noyau.
#
# Il ne touche QUE la paire virtuelle `n3b-h`/`n3b-n` créée ici, jamais `lo` ni
# une interface de la machine: une perte posée sur `lo` frapperait le salon, le
# proxy et chaque salle en même temps.
#
# Le navigateur reste côté machine et vise l'espace du banc, où un relais le
# renvoie vers la salle par une socket Unix (voir `relais-banc.mjs`). Dans
# l'autre sens, le pare-feu de la machine refusait la connexion, et Chrome lancé
# dans l'espace du banc échouait en `ERR_NETWORK_CHANGED`.
#
# # Les réglages qui ne sont pas mesurés
#
# - La file de netem tient cent millisecondes au débit demandé, au moins
#   cinquante paquets. Une box réelle en tient souvent plus; c'est un choix, pas
#   une mesure de la liaison de Hyde.
# - La gigue suit une loi normale. Avec un débit, netem garde l'ordre des
#   paquets; le sens montant reçoit donc un débit large, 100 Mbit/s, pour que sa
#   gigue ne les réordonne pas non plus.
# - Les deux relais ajoutent des tampons entre le worker et la liaison, comme
#   le proxy en service, mais pas forcément de la même taille.
banc-liaison mbit perte gigue salle="1" seconds="60" clip="":
    #!/usr/bin/env bash
    set -euo pipefail
    # Un démarrage sur quatre environ échouait en deux secondes, sans dire où, le
    # 23 septembre 2026. La prochaine fois, il le dira.
    trap 'echo "banc-liaison: échec à la ligne $LINENO: $BASH_COMMAND" >&2' ERR
    salle={{salle}}; port="81${salle}0"; relais=18110
    clip="{{clip}}"
    if [ -n "$clip" ]; then
        # Le worker du banc: rien d'une vraie salle, ni ses ports, ni son
        # dossier, ni son adresse de contrôle (CLAUDE.md, règle 7).
        [ -f "$clip" ] || { echo "pas de clip: $clip"; exit 1; }
        jetable=$(mktemp -d)
        mkdir -p "$jetable/session" "$jetable/roms" "$jetable/art"
        read -r port controle < <(python3 -c 'import socket
    ports = []
    for _ in range(2):
        s = socket.socket(); s.bind(("127.0.0.1", 0)); ports.append(s)
    print(*(s.getsockname()[1] for s in ports))')
        journal_banc="$jetable/worker.log"
        sg render -c "echo \$\$ > '$jetable/pid'; exec env NEL3AB_BANC_SON='${NEL3AB_BANC_SON:-1}' NEL3AB_BANC_CLIP='$clip' NEL3AB_BIND=127.0.0.1:$port NEL3AB_CONTROL_BIND=127.0.0.1:$controle \
            NEL3AB_SESSION_DIR='$jetable/session' NEL3AB_ROM_DIR='$jetable/roms' NEL3AB_ART_DIR='$jetable/art' \
            NEL3AB_SWITCH_LOCK='$jetable/switch.lock' '$PWD/core/target/release/nel3ab-worker'" \
            > "$journal_banc" 2>&1 &
        worker_pid=$!
        for _ in $(seq 50); do
            grep -q "banc: un clip rejoué" "$journal_banc" 2>/dev/null && break
            kill -0 "$worker_pid" 2>/dev/null || { cat "$journal_banc"; exit 1; }
            sleep 0.2
        done
        grep -q "banc: un clip rejoué" "$journal_banc" || { echo "le worker du banc n'a pas démarré"; cat "$journal_banc"; exit 1; }
    else
    etat=$(curl -s -m3 http://127.0.0.1:8200/api/salles)
    python3 - "$etat" "$salle" <<'VERIF'
    import json, sys
    salles = {s["numero"]: s for s in json.loads(sys.argv[1])}
    s = salles.get(int(sys.argv[2]))
    if not s or not s["ouverte"] or not s["jeu"]:
        sys.exit(f"la salle {sys.argv[2]} n'est pas ouverte avec un jeu")
    if s["gens"]:
        sys.exit(f"la salle {sys.argv[2]} a du monde: {len(s['gens'])} page(s). Le banc attend qu'elle soit vide.")
    VERIF
    fi
    ns=n3banc; hote=n3b-h; banc=n3b-n
    passage=$(mktemp -u "${XDG_RUNTIME_DIR:-/tmp}/n3banc.XXXXXX")
    # Le réseau seul, pour effacer les restes d'un passage interrompu au début
    # du suivant. Le worker du banc n'en fait pas partie: au premier essai, ce
    # ménage de départ tuait le worker qu'on venait de lancer.
    nettoyer_reseau() {
        for pid in ${relais_pids:-}; do sudo -n kill "$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
        sudo -n ip netns pids "$ns" 2>/dev/null | xargs -r sudo -n kill 2>/dev/null || true
        sudo -n ip netns del "$ns" 2>/dev/null || true
        sudo -n ip link del "$hote" 2>/dev/null || true
        # La suppression d'une paire virtuelle se termine APRÈS la commande: deux
        # passages enchaînés échouaient une fois sur trois en recréant `n3b-h`.
        for _ in $(seq 20); do ip link show "$hote" >/dev/null 2>&1 || break; sleep 0.1; done
        rm -f "$passage"
    }
    nettoyer() {
        if [ -n "${worker_pid:-}" ]; then
            # `sg` passe par un shell qui se remplace par le worker (`exec`), et
            # ce shell a écrit son numéro: c'est celui du worker.
            if [ -s "$jetable/pid" ]; then kill "$(cat "$jetable/pid")" 2>/dev/null || true; fi
            wait "$worker_pid" 2>/dev/null || true
        fi
        for pid in ${relais_pids:-}; do sudo -n kill "$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true; done
        sudo -n ip netns pids "$ns" 2>/dev/null | xargs -r sudo -n kill 2>/dev/null || true
        sudo -n ip netns del "$ns" 2>/dev/null || true
        sudo -n ip link del "$hote" 2>/dev/null || true
        rm -f "$passage"
        if [ -n "${jetable:-}" ]; then rm -rf "$jetable"; fi
    }
    trap nettoyer EXIT
    nettoyer_reseau
    sudo -n ip netns add "$ns"
    sudo -n ip link add "$hote" type veth peer name "$banc"
    sudo -n ip link set "$banc" netns "$ns"
    sudo -n ip addr add 10.203.0.1/30 dev "$hote"
    sudo -n ip link set "$hote" up
    sudo -n ip -n "$ns" addr add 10.203.0.2/30 dev "$banc"
    sudo -n ip -n "$ns" link set "$banc" up
    # Le sens descendant, celui de l'image, sort de l'espace du banc vers le
    # navigateur: débit, perte et gigue.
    descendant=(netem)
    if [ "{{mbit}}" != 0 ]; then
        paquets=$(python3 -c "print(max(50, int({{mbit}} * 1e6 / 8 * 0.1 / 1514)))")
        descendant+=(rate "{{mbit}}mbit" limit "$paquets")
    elif [ "{{gigue}}" != 0 ]; then
        # Sans débit, la gigue de netem RÉORDONNE les paquets, et TCP retransmet
        # pour rien: 600 Ko mettaient 3,8 s sous 20 ms de gigue, contre 0,01 s
        # sans. Un débit large garde l'ordre sans rien plafonner.
        descendant+=(rate 1000mbit)
    fi
    [ "{{perte}}" != 0 ] && descendant+=(loss "{{perte}}%")
    [ "{{gigue}}" != 0 ] && descendant+=(delay "{{gigue}}ms" "{{gigue}}ms" distribution normal)
    sudo -n ip netns exec "$ns" tc qdisc add dev "$banc" root "${descendant[@]}"
    # Le sens montant, celui des accusés TCP et des manettes: la même perte et
    # la même gigue, sans plafond qui compte.
    montant=(netem rate 100mbit)
    [ "{{perte}}" != 0 ] && montant+=(loss "{{perte}}%")
    [ "{{gigue}}" != 0 ] && montant+=(delay "{{gigue}}ms" "{{gigue}}ms" distribution normal)
    sudo -n tc qdisc add dev "$hote" root "${montant[@]}"
    echo "descendant: ${descendant[*]}"
    echo "montant:    ${montant[*]}"
    cd spikes/m3-browser-drive
    node relais-banc.mjs "unix:$passage" "127.0.0.1:$port" & relais_pids="$!"
    sleep 0.5
    sudo -n ip netns exec "$ns" "$(command -v node)" relais-banc.mjs "10.203.0.2:$relais" "unix:$passage" &
    relais_pids="$relais_pids $!"
    sleep 0.5
    debut=$(date -u '+%F %T')
    mesure=$(node banc-liaison.mjs "http://10.203.0.2:${relais}/" {{seconds}})
    if [ -n "$clip" ]; then
        worker=$(cat "$journal_banc")
        # Gardé pour relecture: le dossier jetable disparaît avec le banc.
        cp "$journal_banc" "${XDG_RUNTIME_DIR:-/tmp}/banc-liaison-dernier-worker.log"
    else
        worker=$(journalctl -u "nel3ab-worker@${salle}" --since "$debut" --utc -o cat --no-pager)
    fi
    python3 - "$mesure" "$worker" <<'RESUME'
    import json, sys
    page = json.loads(sys.argv[1].strip().splitlines()[-1])
    cumul = {"chaines_cassees": 0, "images_manquees": 0, "images_jetees": 0, "file_max": 0,
             "abandons": 0}
    debits = []
    # Seulement les relevés émis PENDANT la fenêtre de la page. Le premier essai
    # comptait aussi la connexion: une chaîne cassée au démarrage et ses 599
    # images d'attente de clé s'ajoutaient à une fenêtre à 59,9 images/s. Un
    # relevé couvre les dix secondes qui le précèdent, donc le premier retenu
    # peut encore en déborder un peu.
    debut = page.pop("debut").replace("Z", "+00:00")
    for ligne in sys.argv[2].splitlines():
        try:
            lu = json.loads(ligne)
        except ValueError:
            continue
        champs = lu.get("fields", {})
        if lu.get("timestamp", "").replace("Z", "+00:00") < debut:
            continue
        # Le débit du flux pendant la fenêtre. Il suit la scène, de 0,8 à
        # 25 Mbit/s sur une démonstration: deux mesures ne se comparent qu'avec lui.
        # « streaming » dans une salle, « banc: débit » dans le worker du banc.
        if champs.get("message") in ("streaming", "banc: débit") and "megabits_per_second" in champs:
            debits.append(champs["megabits_per_second"])
        # Une écriture bloquée plus de deux secondes: le worker coupe la socket et
        # la page se reconnecte. Pire qu'une chaîne cassée, et le banc ne la
        # comptait pas: une file de deux « ne cassait rien » à 3 Mbit/s tout en
        # ne livrant que 35 images sur 50 (23 septembre 2026).
        if champs.get("message") == "the viewer's connection gave up":
            cumul["abandons"] += 1
        if champs.get("message") != "ce spectateur ne suit pas":
            continue
        cumul["chaines_cassees"] += champs.get("breaks_now", 0)
        cumul["images_manquees"] += champs.get("missed_now", 0)
        cumul["images_jetees"] += champs.get("dropped_now", 0)
        cumul["file_max"] = max(cumul["file_max"], champs.get("depth", 0))
    # La moyenne des relevés « streaming », un toutes les dix secondes.
    cumul["flux_mbit_s"] = round(sum(debits) / len(debits), 1) if debits else None
    print(json.dumps({**page, **cumul}, ensure_ascii=False))
    RESUME

# Does the page survive being switched away from? Needs the worker RUNNING.
# Opens a second tab to push the first one into the background, which is how a
# person does it, and asserts that nothing is decoded for a screen that is not
# asking. Watching the decoder's backlog instead would pass on a machine whose
# decoder is fast enough to keep up with work nobody wanted — this one is.
browser-background:
    cd spikes/m3-browser-drive && node backgrounded.mjs http://localhost:8110/ 30

# Does a controller survive its player switching away, and only that? Needs the
# worker RUNNING. Backgrounds a real tab for longer than the ping deadline, then
# closes one. The unit tests pin the server's side of this; only a real browser
# can answer whether Chrome pongs while a tab is throttled, and the whole design
# rests on it doing so.
browser-seats:
    cd spikes/m3-browser-drive && node seat-kept.mjs http://localhost:8110/ 25

# L'accueil montre-t-il vraiment les salles ouvertes, et elles seules ?
#
# La page se construit dans le navigateur à partir de `/api/salles`: lire son
# source ne prouve rien de ce qu'elle affiche. Ce pilote la charge pour de bon
# et compare son rendu à ce que le salon déclare. Contre le salon EN DIRECT:
# c'est la page qu'on vérifie, pas le routage.
salon-accueil:
    cd spikes/m3-browser-drive && node salon-accueil.mjs

# La liste du salon est-elle MISE À JOUR, ou refaite à chaque tour ?
#
# Elle se reconstruisait entièrement toutes les cinq secondes: chaque carte
# était remplacée par un noeud neuf, donc l'animation d'apparition repartait et
# le focus du clavier retombait sur le corps de la page. Lire le source ne le
# prouve pas: ce pilote pose un témoin sur la carte et regarde s'il survit à
# deux tours de sondage.
#
# Il OUVRE une salle et la referme: c'est le seul moyen d'avoir une carte à
# regarder, et la machine est rendue telle qu'elle était.
#
# Vérifié falsifiable le 12 septembre 2026 en réintroduisant `replaceChildren`
# seul, `--rang` gardé: c'est bien l'assertion du témoin qui mord.
salon-reconciliation:
    cd spikes/m3-browser-drive && node reconciliation.mjs

# Des IMAGES des quatre écrans d'une salle, pour les regarder au lieu de les
# décrire.
#
# Écrit le 12 septembre 2026 pendant la revue de l'interface, et gardé parce
# qu'il a servi tout de suite: les captures ont montré que trois langages
# visuels distincts cohabitaient (l'arrivée et le salon en blocs bordés gris,
# le menu XMB fini et soigné, l'écran « aucun jeu » avec un bouton arrondi qui
# n'existe nulle part ailleurs). Aucune lecture du code ne montrait ça.
#
# Ce n'est PAS un essai: il n'affirme rien et ne peut pas échouer. Il produit de
# quoi juger, ce qui est un autre métier.
#
# La salle doit déjà tourner. `just salon-reconciliation` montre comment en
# ouvrir une et la refermer proprement.
capture-salle url="http://127.0.0.1:8110/" dossier="/tmp/nel3ab-captures":
    cd spikes/m3-browser-drive && node capture-salle.mjs "{{url}}" "{{dossier}}"

# La salle prévient-elle À L'ÉCRAN avant de fermer, et le clic la fait-il taire ?
#
# Le journal disait déjà « la salle fermera bientôt », mais un journal ne
# prévient personne. Ce pilote ouvre la page dans un vrai navigateur, entre dans
# la salle, et attend que le bandeau arrive tout seul. Délais raccourcis par
# l'environnement; la règle de la salle désertée est mise hors de portée.
avertissement-fermeture:
    cd spikes/m3-browser-drive && node avertissement-fermeture.mjs

# Deux salles peuvent-elles faire tourner un jeu Switch en même temps ?
#
# Elles ne doivent pas: Ryubing coûte bien plus cher que Dolphin. La règle ne
# peut pas vivre dans le salon, puisqu'une page demande son jeu au worker
# directement; elle vit là où le jeu démarre. Ce pilote monte deux vraies
# salles avec le même verrou et un faux adaptateur: la première joue, la seconde
# reste sur son menu, vivante, et dit pourquoi.
une-seule-switch:
    cd spikes/m3-browser-drive && node une-seule-switch.mjs

# Une salle servie sous un préfixe se comporte-t-elle normalement ?
#
# Le salon prendra la racine du domaine et chaque salle vivra sous `/r/<n>/`.
# Ce pilote monte un worker, un proxy qui imite `handle_path` de Caddy, et
# charge la page dans un vrai navigateur sous ce préfixe. Il refuse toute
# requête qui repart à la racine, WebSockets comprises: une adresse oubliée
# passerait inaperçue jusqu'au jour de la bascule.
prefixe-de-salle:
    cd spikes/m3-browser-drive && node prefixe-de-salle.mjs

# Une salle que personne ne touche se ferme-t-elle vraiment ?
#
# Lance un VRAI worker dans un dossier jetable, délai raccourci par
# l'environnement, et attend qu'il s'arrête tout seul. Vérifier la règle en
# mémoire ne prouverait pas le branchement: c'est la boucle d'images qui doit
# voir l'arrêt demandé. Le jumeau négatif, délai long, doit survivre.
#
# Ne vise aucun conteneur: une sieste ne peut donc pas geler une salle vivante.
salle-inactive:
    cd spikes/m3-browser-drive && node salle-inactive.mjs

# Les noms des places suivent-ils qui les tient, après un rechargement ?
#
# Contre la salle COMPLÈTE, par le proxy: c'est le désaccord entre le worker,
# qui attribue les ports, et le plan de contrôle, qui porte les noms, qu'on
# vient mesurer. Taper le worker en direct donnerait une salle sans noms, donc
# un pilote qui passe en ne vérifiant rien.
places:
    cd spikes/m3-browser-drive && node places.mjs

# Can a person take the controller back from a page that is merely open? Needs
# the worker RUNNING and NOBODY else holding a port — the test says so rather
# than passing vacuously.
browser-claim:
    cd spikes/m3-browser-drive && node claim.mjs http://localhost:8110/

# Does sound come out, at the rate it was recorded at, and does the page play it?
# Needs the worker RUNNING. The first check reads the stream the way the page
# does and looks at the samples; the second drives the page's own playback with
# autoplay forced on, which is the only thing it fakes.
browser-sound:
    cd spikes/m3-browser-drive && node sound.mjs http://localhost:8110/ 20
    cd spikes/m3-browser-drive && node playback.mjs http://localhost:8110/ 12

# Where the audio latency goes, poste by poste, on the client's side of the wire.
# Needs the worker RUNNING. Give it 60 s or more: the page's lead decays one
# millisecond per clean second, so a short look reports where it STARTED rather
# than where it lives.
#
# The server's pipe is counted in these numbers, and was not always: the worker
# dates each chunk back by the pipe's depth. Without that the sound declared
# itself fresher than it was, and the offset the page reported was 7 ms where the
# truth was 54 — which is why the "line the picture up with the sound" control
# looked inert. It was compensating by the wrong number, not failing to work.
audio-budget seconds="60":
    cd spikes/m3-browser-drive && node audio-budget.mjs http://localhost:8110/ {{seconds}}

# The two ways of building the audio context, one after the other on the same
# stream. Prints what each costs; whether either buzzes is a question for ears.
browser-rates:
    cd spikes/m3-browser-drive && node rates.mjs http://localhost:8110/

# Does the lip-sync box move the picture when it is clicked, rather than twenty
# seconds later? Needs the worker RUNNING.
browser-lipsync:
    cd spikes/m3-browser-drive && node lipsync.mjs http://localhost:8110/

# Une page qui tient une manette réannonce-t-elle sa place, sans marteler ?
#
# Demande NEL3AB_URL et pointe le PROXY: l'annonce `seat` part vers le salon,
# que le worker ne porte pas. Branché en direct sur le worker, ce pilote refuse
# au lieu de passer à vide.
#
# Il mesurait autre chose avant le 13 septembre 2026: il comptait
# `counters().attempts`, qui vaut les TRAMES D'ENTRÉE envoyées, en croyant y
# lire des demandes de place. Et son scénario, « une page refusée redemande »,
# n'existe pas: le code appelle `refused` une page qui regarde PAR CHOIX, et
# rien ne rejette personne. Le détail est dans l'en-tête du pilote.
browser-polite:
    @test -n "${NEL3AB_URL:-}" || { echo "NEL3AB_URL manquant: l'annonce « seat » passe par le salon."; echo "  Donner l'adresse du proxy: NEL3AB_URL=https://<domaine>/r/<N>/ just browser-polite"; exit 1; }
    cd spikes/m3-browser-drive && node polite.mjs "$NEL3AB_URL"

# Tout ce qui se juge en REGARDANT, en une commande. Needs the worker RUNNING.
#
# Ces quatre-là partagent une propriété que `just check` n'a pas: ils ouvrent un
# vrai navigateur sur une vraie salle. `check` ne peut pas les accueillir, la CI
# n'ayant ni salle ni GPU, et c'est la même raison que `gpu-test`.
#
# Ils existent parce que la barrière ne surveille NI les tailles de texte NI les
# superpositions. Les deux défauts visuels du 13 septembre 2026 — un bouton
# coupé en « Modifier cette comman », une entrée de menu imprimée en travers de
# l'icône d'un rayon — ont été trouvés en regardant des captures, pas en lançant
# `just check`, qui était verte les deux fois.
#
# En DÉPENDANCES et non par des `just` imbriqués, comme `check` lui-même.
browser-visuel: browser-layout browser-contraste browser-debordement browser-superposition browser-lobby

# La colonne se voit-elle à travers la bande des rayons ? Needs the worker RUNNING.
#
# Le XMB fait défiler la colonne sous un croisement fixe, et `z-10` met la
# rangée devant. Mais l'ordre de peinture n'est pas l'opacité: la rangée n'a
# aucun fond, si bien qu'une entrée qui remonte se voyait au travers. Le
# 13 septembre 2026, « volume » croisait l'icône du rayon sur 32×17 px.
#
# Le critère est l'opacité EFFECTIVE du masque là où une encre de la colonne
# croise la bande. Six critères ont été essayés avant, et cinq ne pouvaient pas
# échouer; la comparaison de pixels a été abandonnée parce que basculer la
# visibilité change la composition. Le détail est dans l'en-tête du pilote.
#
# Ce filet est BORNÉ: il juge le remède en place, un masque. Un remède par fond
# opaque le ferait crier à tort.
browser-superposition url="http://127.0.0.1:8110/":
    cd spikes/m3-browser-drive && node superposition.mjs "{{url}}"

# Qu'est-ce qui est COUPÉ dans le panneau des touches ? Needs the worker RUNNING.
#
# Ce panneau est une boîte de hauteur fixe dont le contenu ne défile pas hors
# préparation: ce qui y grossit trop se coupe sans prévenir. `capture-salle` le
# disait déjà et s'en remettait à l'oeil, qui rate la moitié des cas.
#
# Le 13 septembre 2026, passer l'échelle de texte de 12 à 15 px a coupé
# « Modifier cette commande » en « Modifier cette comman », et AUCUN garde n'a
# bronché: ni `browser-layout` (qui regarde la colonne face à l'image), ni
# `browser-contraste` (qui regarde des rapports de luminance), ni `just check`,
# où rien ne surveille une taille de texte. Seule une capture l'a montré.
#
# Visite les TROIS onglets: le premier jet n'en voyait qu'un et rendait un vert
# partiel. Ne signale pas les dépassements verticaux de 2 px, qui sont la boîte
# de ligne d'un titre en `line-height: 1` et ne rognent rien.
browser-debordement url="http://127.0.0.1:8110/":
    cd spikes/m3-browser-drive && node debordement.mjs "{{url}}"

# Do the numbers stay beside the picture, without scrolling, at the widths people
# actually use? Needs the worker RUNNING.
browser-layout:
    cd spikes/m3-browser-drive && node layout.mjs http://127.0.0.1:8110/

# La colonne de droite se tire-t-elle entre ses bornes, et l'image suit-elle ?
#
# Contre un worker JETABLE ouvert sans jeu: aucun conteneur, aucune carte
# graphique, aucune salle réelle touchée. Le worker de développement est
# reconstruit d'abord, sinon il servirait la page d'hier.
browser-colonne:
    cd core && cargo build -p nel3ab-worker
    cd spikes/m3-browser-drive && node colonne.mjs

# Does the library show the names a person reads, and none of the file clutter?
# Needs the worker RUNNING.
browser-library:
    cd spikes/m3-browser-drive && node library.mjs http://127.0.0.1:8110/

# Taking a socket somebody is playing on: two clicks to do it, and the player it
# was taken from is told and left unplugged rather than quietly moved. Needs the
# worker RUNNING and ONE free port — not an empty room.
browser-steal:
    cd spikes/m3-browser-drive && node steal.mjs http://localhost:8110/

# Changing the game from the page. RESTARTS THE SESSION, which is the feature,
# so it must not be run while somebody is playing something they care about.
#
# What it pins is the SEQUENCE, not the outcome: one click must arm and boot
# nothing. A test that only checked "the game changed" would pass just as well on
# a page that switched on the first click, and what is being confirmed is the end
# of everybody else's game.
# Le contraste EFFECTIF de chaque texte: trois coques, puis les deux régies
# (nuit et jour, chacune suivie par le système puis choisie contre lui), avec
# le sélecteur, le panneau des touches et les commandes posées sur l'image.
#
# Ici et pas dans `check` parce qu'il faut un vrai rendu: l'opacité s'accumule
# sur les ancêtres, le fond vient du premier ancêtre qui en peint un, et le
# produit des deux n'apparaît dans aucun des fichiers où on l'écrit. Le 2
# septembre 2026 il a trouvé 196 textes sous le seuil, dont l'état des quatre
# manettes dans la colonne — ce qu'on regarde le plus souvent de la page.
#
# Les régies ne tournent que sur la coque PS3, et c'est délibéré: les coques
# Wii et Switch peignent des couleurs de console EN DUR et ne bougent pas d'un
# thème à l'autre. Le sélecteur, lui, n'était visité par aucun écran alors que
# c'est lui qui empilait cinq opacités brutes.
#
# N'ARRÊTE PAS la partie: il ouvre le menu, il ne lance rien. Pour les sources
# de l'arbre de travail sans aucune salle: un Vite SANS relais
# (`vite.planche.config.ts`), puis `node contraste.mjs http://127.0.0.1:<port>/
# --simule`, qui répond lui-même aux API et coupe toute autre requête.
browser-contraste:
    cd spikes/m3-browser-drive && node contraste.mjs http://localhost:8110/

# Le contraste et les coupures de la page d'ENTRÉE, ses trois dessins.
#
# Un pilote à part parce que `browser-contraste` et `browser-debordement`
# entrent tous les deux dans la salle avant de mesurer: la page qu'on voit
# AVANT d'entrer n'était vue par aucun garde. Les rapports écrits dans l'en-tête
# du dessin « câbles » le 13 septembre 2026 étaient donc des calculs sur des
# couleurs choisies, pas des mesures dans un rendu.
#
# N'ENTRE PAS dans la salle et ne lance rien: il lit la page d'accueil de la
# salle, à trois dessins et deux largeurs.
browser-lobby url="http://localhost:8110/":
    cd spikes/m3-browser-drive && node lobby-visuel.mjs "{{url}}"

# Ce que la page MONTRE pendant un changement de jeu.
#
# RESTARTS THE SESSION. Ici et pas dans `check` parce que ce qui est vérifié est
# une IMAGE à l'écran: le défaut du 31 août 2026 laissait tous les compteurs
# cohérents et montrait l'ancien jeu figé cinq secondes et demie. Aucun essai
# unitaire ne peut voir ça, et c'est exactement pourquoi ce fichier existe.
# Demande NEL3AB_URL, et pointe le PROXY: changer de jeu passe par le salon,
# que le proxy aiguille vers 8200. Branché sur le worker en direct, ce pilote
# obtient la page, les manettes et l'image, envoie sa demande de préparation
# dans le vide, et conclut que le jeu n'a pas démarré. Vérifié le 13 septembre
# 2026: /r/1/roms rend la bibliothèque, /roms rend le 404 du salon.
# L'adresse n'est pas écrite ici parce que ce dépôt est public (voir open.mjs).
browser-loading:
    @test -n "${NEL3AB_URL:-}" || { echo "NEL3AB_URL manquant: ce pilote change de JEU, ce qui passe par le salon."; echo "  Le worker seul (localhost:8110) sert la page mais pas /socket.io, donc la demande n arrive jamais."; echo "  Donner l adresse du proxy: NEL3AB_URL=https://<domaine>/r/<N>/ just browser-loading"; exit 1; }
    cd spikes/m3-browser-drive && node loading.mjs "$NEL3AB_URL"

# Demande NEL3AB_URL, et pointe le PROXY: changer de jeu passe par le salon,
# que le proxy aiguille vers 8200. Branché sur le worker en direct, ce pilote
# obtient la page, les manettes et l'image, envoie sa demande de préparation
# dans le vide, et conclut que le jeu n'a pas démarré. Vérifié le 13 septembre
# 2026: /r/1/roms rend la bibliothèque, /roms rend le 404 du salon.
# L'adresse n'est pas écrite ici parce que ce dépôt est public (voir open.mjs).
browser-games:
    @test -n "${NEL3AB_URL:-}" || { echo "NEL3AB_URL manquant: ce pilote change de JEU, ce qui passe par le salon."; echo "  Le worker seul (localhost:8110) sert la page mais pas /socket.io, donc la demande n arrive jamais."; echo "  Donner l adresse du proxy: NEL3AB_URL=https://<domaine>/r/<N>/ just browser-games"; exit 1; }
    cd spikes/m3-browser-drive && node games.mjs "$NEL3AB_URL"

# One benchmark run of the shipped chain: release worker under systemd, the real
# Dolphin container, the real GPU, a real headless Chrome watching. RESTARTS THE
# SESSION, so it must not be run while somebody is playing.
#
# Takes about three minutes: 45 s of warm-up so shader compilation and the
# display schedule have settled, then 90 s measured. Writes the raw result to
# bench/results/ and prints the distributions.
bench label="baseline":
    node bench/run.mjs {{label}}

# The whole chain against a real Dolphin and a real ROM. Minutes, not seconds.
end-to-end:
    cd core && sg render -c 'cargo test -p nel3ab-encoder --features gpu-tests,dolphin-integration --test dolphin_frames_become_h264 -- --nocapture'

# Advisories + licences. Blocking, unlike an informational audit.
audit:
    cd core && cargo deny check

# Undefined behaviour in the pointer and slice arithmetic around the FFI.
#
# It pointed at `nel3ab-protocol` and was therefore theatre twice over: that
# crate carries `#![forbid(unsafe_code)]`, so there is no undefined behaviour of
# ours for Miri to find in it, and the recipe was RED anyway — proptest calls
# `getcwd`, which Miri's isolation refuses. A check that cannot fail and does
# not run is worse than no check.
#
# This recipe selects `nel3ab-encoder` without `vaapi`, so it does not compile
# the GPU FFI modules. The two flags keep its CPU-only tests runnable:
#
#   -Zmiri-disable-isolation   proptest reads the filesystem to persist failing
#                              seeds; isolation blocks that and aborts the run.
#   --skip frame_source        Miri implements AF_INET and AF_INET6 only, so the
#                              tests that bind a Unix socket cannot run under it.
#
# What remains is the H.264 bitstream writer and wire parsers. This does not
# exercise the unsafe arithmetic inside the feature-gated FFI modules or foreign
# libva/Vulkan calls; a green result is not a proof of the GPU boundary.
miri:
    cd core && MIRIFLAGS=-Zmiri-disable-isolation cargo +nightly miri test \
        -p nel3ab-encoder --lib -- --skip frame_source

# The API reference, generated from the Rust source.
doc:
    cd core && cargo doc --workspace --no-deps --document-private-items

# The prose site: the carnet, the ADR and the working plans, built by Zensical
# from the same files the repository already keeps.
#
# `--strict` is the point of this recipe, not a flourish. It fails the build on a
# link or an anchor that resolves to nothing, which is the one kind of rot a
# long document acquires silently: a section gets renamed, every link to it
# dies, and nothing says so until a reader clicks. It caught two on its first
# run.
#
# Needs the tool once: `uv tool install zensical`.
docs:
    zensical build --strict

# Rebuild the files Caddy already serves from `site/` under `/docs`, then show
# the address. No service restart or Tailscale configuration change is needed.
# Markdown can be newer than the site until this build runs; serving one output
# directory avoids a second copy, not the need to rebuild. A reader can encounter
# incomplete output during the build, so this is only the private prose site.
docs-deploy: docs
    @echo "${NEL3AB_SITE_URL:-https://nel3ab.app/docs/}"

# Rebuild on every change, with a local preview. For writing, not for publishing.
docs-watch:
    zensical serve

# Le configurateur réel dans Chromium, avec une manette simulée et sans salle.
# Démarrer `npm run dev -- --host 127.0.0.1 --port 5202` dans front au préalable.
browser-configuration:
    cd spikes/m3-browser-drive && node configuration-ui.mjs

# Préparation collective et profils personnels dans l'aperçu isolé, sans lancer de jeu.
browser-preparation:
    cd spikes/m3-browser-drive && node preparation-ui.mjs

# Page, salon, worker et Dolphin dans une salle temporaire. Disque Mario Kart Wii
# requis. Ports, conteneur et sauvegardes propres à l'essai ; le binaire de
# développement est construit, jamais celui que systemd lancera en production.
preparation-test rom:
    cd core && cargo build -p nel3ab-worker
    node spikes/m3-browser-drive/preparation-room.mjs {{quote(rom)}}

# Même salle jetable, avec une vraie page d'avant le protocole de reçus.
# Prouve le besoin d'actualisation et le retour des noms après celle-ci.
seat-migration-test rom:
    cd core && cargo build -p nel3ab-worker
    NEL3AB_TEST_LEGACY_PAGE=1 node spikes/m3-browser-drive/preparation-room.mjs {{quote(rom)}}

# Salle jetable : fermeture, repos persistant et lancement Wii collectif depuis les menus.
idle-room-test rom:
    cd core && cargo build -p nel3ab-worker
    NEL3AB_TEST_IDLE_ROOM=1 node spikes/m3-browser-drive/preparation-room.mjs {{quote(rom)}}

# Chef spectateur absent, refus, reprise de manette et attribution périmée.
# Le délai de réponse est réel ; les trois pages et le jeu sont isolés de la salle.
recovery-test rom:
    cd core && cargo build -p nel3ab-worker
    NEL3AB_TEST_RECOVERY=1 node spikes/m3-browser-drive/preparation-room.mjs {{quote(rom)}}

# Quatre joueurs, départs, reconnexions réseau et préparation Wii. Salle isolée.
room-churn-test rom:
    cd core && cargo build -p nel3ab-worker
    cd spikes/m3-browser-drive && NEL3AB_TEST_CHURN=1 node preparation-room.mjs {{quote(rom)}}

# SIGTERM éveillé/endormi, producteur muet et orphelin. Salle isolée et GPU réel.
resilience-test rom:
    cd core && cargo build -p nel3ab-worker
    cd spikes/m3-browser-drive && NEL3AB_TEST_RESILIENCE=1 node preparation-room.mjs {{quote(rom)}}

# Deux flux pleins et un réduit, sous un plafond TCP mesuré. Salle isolée.
network-room-test rom:
    node spikes/m3-browser-drive/limited-link-test.mjs
    cd core && cargo build -p nel3ab-worker
    cd spikes/m3-browser-drive && NEL3AB_TEST_NETWORK=1 node preparation-room.mjs {{quote(rom)}}

# Capture Switch utilisée par la salle : preuves sans ROM, GPU ou état persistant.
# Les pilotes qui arrêtent la capture restent explicites et décrits dans son README.
switch-capture-test:
    python3 -m unittest discover -s spikes/switch-room -p 'test_*.py'

# La salle Xbox 360 sans émulateur ni carte: profils chiffrés comme Xenia,
# plan de lancement, lanceur du conteneur avec un faux Xenia, lecteur de
# cadence. Ce qui reste à prouver se voit au premier lancement réel (profil
# chargé, plein écran, manettes, son) dans le journal de l'emplacement.
# Le module moteurs/xenia et le canari docker/xbox360-room-socle.py, qu'aucune
# salle ne lance tant que le propriétaire ne l'a pas branché (docs/xbox360.md).
xbox360-test:
    python3 -m unittest discover -s docker -p 'test_xbox360_*.py'
    python3 -m unittest discover -s spikes/xbox360 -p 'test_*.py'
    /usr/bin/python3 -B -m unittest moteurs.xenia.test_adaptateur
    cd control && uv run ruff check --config pyproject.toml ../docker/xbox360-room.py ../docker/xbox360-room-socle.py ../docker/test_xbox360_room.py ../spikes/xbox360/horodate.py ../spikes/xbox360/releve.py ../spikes/xbox360/test_releve.py ../spikes/xbox360/test_xenia_sh.py
    cd control && uv run ruff check --config pyproject.toml --extend-select PLC0415 ../moteurs/xenia
    cd control && uv run ruff format --check --config pyproject.toml ../docker/xbox360-room.py ../docker/xbox360-room-socle.py ../docker/test_xbox360_room.py ../spikes/xbox360/horodate.py ../spikes/xbox360/releve.py ../spikes/xbox360/test_releve.py ../spikes/xbox360/test_xenia_sh.py ../moteurs/xenia

# Relit une partie Xbox 360 jouée: images par seconde du jeu, par fenêtre de
# 5 s, depuis le journal horodaté que xenia.sh écrit dans l'emplacement, puis
# ce que la capture de la salle a reçu pendant la même partie (journal du
# worker de la salle). Le 21 novembre 2026, le compteur du jeu seul donnait
# 59,5 images/s pendant que l'image des joueurs était figée.
# Exemple: just xbox360-releve ~/.local/state/nel3ab/xbox360/534507d6/neuve
# Une partie précédente est dans history/, à côté de l'emplacement.
xbox360-releve emplacement salle="1":
    #!/usr/bin/env bash
    set -euo pipefail
    journal={{quote(emplacement)}}/xenia-horodate.log
    read -r debut fin < <(python3 spikes/xbox360/releve.py --bornes "$journal")
    capture=$(mktemp)
    trap 'rm -f "$capture"' EXIT
    journalctl -u nel3ab-worker@{{salle}} --since "@$debut" --until "@$fin" \
        -o short-iso-precise --no-pager > "$capture"
    python3 spikes/xbox360/releve.py "$journal" --capture "$capture"

# Commandes, profils et vibrations de quatre périphériques virtuels jetables.
# Un retour de vibration refusé doit laisser les boutons répondre. Aucun émulateur
# ni ROM ; exige Docker et /dev/uinput, avec les droits du conteneur installé.
switch-controls-test:
    bash spikes/switch-room/bridge/build-page.sh
    cargo build --manifest-path spikes/switch-room/bridge/Cargo.toml
    cargo test --manifest-path core/Cargo.toml -p nel3ab-transport ingress --lib
    node spikes/switch-room/check-setup-layout.mjs
    node spikes/switch-room/check-controls.mjs

# Pure adapter file operations, including save restore and refusal of live slots,
# and add-on listing from NSP files built with a test key.
switch-saves-test:
    python3 -m unittest discover -s docker -p 'test_switch_*.py'
    python3 -m unittest discover -s docker -p 'test_personal_*.py'
    python3 -m unittest discover -s spikes/switch2-room -p 'test_*.py'
    cd control && uv run ruff check --config pyproject.toml ../docker/switch-room.py ../docker/switch2-room.py ../docker/switch-saves.py ../docker/switch-dlc.py ../docker/test_switch_room.py ../docker/test_switch_2_room.py ../docker/test_switch_dlc.py ../docker/test_switch_unlocked.py ../docker/test_switch_liens.py ../docker/test_personal_saves.py ../tools/save-unlocked.py
    cd control && uv run ruff format --check --config pyproject.toml ../docker/switch-room.py ../docker/switch2-room.py ../docker/switch-saves.py ../docker/switch-dlc.py ../docker/test_switch_room.py ../docker/test_switch_2_room.py ../docker/test_switch_dlc.py ../docker/test_switch_unlocked.py ../docker/test_switch_liens.py ../docker/test_personal_saves.py ../tools/save-unlocked.py
    cd control && uv run ruff check --config pyproject.toml ../spikes/switch2-room/lobby.py ../spikes/switch2-room/measure.py ../spikes/switch2-room/test_measure.py ../spikes/switch2-room/gpu_clients.py ../spikes/switch2-room/test_gpu_clients.py
    cd control && uv run ruff format --check --config pyproject.toml ../spikes/switch2-room/lobby.py ../spikes/switch2-room/measure.py ../spikes/switch2-room/test_measure.py ../spikes/switch2-room/gpu_clients.py ../spikes/switch2-room/test_gpu_clients.py

# Four isolated browsers and real GC/Wii/Switch engines. Requires the private
# NEL3AB_TEST_SWITCH_CONFIG; optional NEL3AB_TEST_SWITCH_SAVE tests unlocked saves.
# No installed room, controller port or persistent save is used by this driver.
switch-room-test rom:
    cargo build --manifest-path core/Cargo.toml -p nel3ab-worker
    node spikes/m3-browser-drive/switch-room.mjs '{{rom}}'

# Registered user-supplied NUP, private config and disposable state only.
switch2-room-test rom:
    cargo build --manifest-path core/Cargo.toml -p nel3ab-worker
    node spikes/switch2-room/room.mjs {{quote(rom)}}

# Catalogue local et trois menus, sans émulateur lancé ni salle installée touchée.
catalogue-test:
    cargo build --manifest-path core/Cargo.toml -p nel3ab-worker
    node spikes/m3-browser-drive/catalogue.mjs

# Four console menus, real receipt reader, synthetic saves, no emulator started.
save-options-test:
    cargo build --manifest-path core/Cargo.toml -p nel3ab-worker
    node spikes/m3-browser-drive/save-options.mjs
