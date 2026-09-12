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
local: check gpu-test clip-audio-test switch-saves-test switch-capture-test

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
    for unit in deploy/*.service deploy/Caddyfile; do
        case "$unit" in
            *.service) installe="/etc/systemd/system/$(basename "$unit")" ;;
            *Caddyfile) installe="/etc/caddy/Caddyfile" ;;
        esac
        if [ ! -f "$installe" ]; then
            echo "  absente de la machine: $(basename "$unit")"; faux=1; continue
        fi
        if ! diff -q "$unit" "$installe" >/dev/null; then
            echo "  diverge: $(basename "$unit")"
            diff "$unit" "$installe" | sed 's/^/      /'
            faux=1
        fi
    done
    # L'autre sens: une unité posée à la main sur la machine, sans copie ici.
    # Le 12 septembre 2026, nel3ab-cpu-performance tournait depuis la veille et
    # aucune boucle ne la voyait, parce que celle du dessus part du dépôt.
    for installe in /etc/systemd/system/nel3ab-*.service; do
        [ -e "$installe" ] || continue
        if [ ! -f "deploy/$(basename "$installe")" ]; then
            echo "  installée sans copie au dépôt: $(basename "$installe")"; faux=1
        fi
    done
    if [ "$faux" -eq 0 ]; then echo "les unités installées sont celles du dépôt"; else exit 1; fi

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
saves:
    #!/usr/bin/env bash
    set -euo pipefail
    racine="${NEL3AB_SESSION_DIR:-$HOME/.local/state/nel3ab/session}"/saves
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
save-import jeu emplacement fichier:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier="${NEL3AB_SESSION_DIR:-$HOME/.local/state/nel3ab/session}"/saves/{{jeu}}/{{emplacement}}
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
    cp "{{fichier}}" "$dossier/"
    echo "  posé: $(basename "{{fichier}}") dans {{jeu}}/{{emplacement}}"

# Remet un emplacement à neuf, pour de vrai.
#
# « Neuve » cesse de l'être dès qu'on a joué une heure dessus. Sans ce geste, le
# mot ment au bout d'une soirée.
save-reset jeu emplacement:
    #!/usr/bin/env bash
    set -euo pipefail
    dossier="${NEL3AB_SESSION_DIR:-$HOME/.local/state/nel3ab/session}"/saves/{{jeu}}/{{emplacement}}
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
wii-save-import export dossier:
    python3 tools/wii-save-decode.py {{export}} {{dossier}}

# La page et la salle sont-elles d\'accord sur ce qui peut être transporté ? Le
# demi-format n'existe pas pour toutes les tailles d'image, et c'est un vrai
# encodeur devant un vrai jeu qui le dit.
formats-test:
    cd spikes/m3-browser-drive && node formats.mjs

# Les réglages de manette suivent-ils la personne ? Demande le worker ET le plan
# de contrôle en marche, et une identité, donc le proxy devant.
manettes-test:
    cd spikes/m3-browser-drive && node manettes.mjs

saves-test:
    cd spikes/m3-browser-drive && node saves.mjs

# Les plans de manette: chaque pièce sur son boîtier, et une image à regarder.
#
# Ici et pas dans `check` parce qu'il faut un vrai rendu: `getBBox` et
# `isPointInFill` n'existent pas dans jsdom, et l'oeil ne se triche pas. Le
# premier script vérifie la GÉOMÉTRIE (rien ne pend hors de la coque), le second
# écrit une capture dans /tmp/padmap-visuel.png pour la regarder. Ne compile
# rien, ne parle à aucune salle: l'aperçu est servi par Vite tout seul.
padmap-visuel:
    cd spikes/m3-browser-drive && node padmap-visuel.mjs

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

# Le même écran, mais contre la VRAIE salle et sa page déployée.
#
# Les deux ne regardent pas la même chose et c'est le point: `banc-visuel` voit
# l'arbre de travail par Vite, celui-ci voit la page compilée dans le binaire du
# worker. Quand les deux divergent, c'est qu'on a oublié de reconstruire.
banc-reel:
    cd spikes/m3-browser-drive && node banc.mjs http://localhost:8100/ /tmp/banc-reel.png

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
    cd spikes/m3-browser-drive && node switch-cadence.mjs http://127.0.0.1:8100 {{seconds}} full && node switch-cadence.mjs http://127.0.0.1:8100 {{seconds}} half

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
    cd spikes/m3-browser-drive && node switch-reaction.mjs http://127.0.0.1:8100 {{trials}} {{port}} {{screen}}

# La sieste, jouée en vrai: la salle s'endort, on la réveille, et on lit ce que
# le worker en a écrit.
#
# Ici et pas dans `check` parce que c'est une COURSE entre le fil qui dégèle et
# celui qui encode, elle se joue en quelques millisecondes autour de
# `docker unpause`, et aucun test unitaire ne peut la voir. Il faut un vrai
# conteneur, un vrai émulateur et une minute de patience: exactement la même
# raison que `gpu-test`.
nap-test:
    cd spikes/m3-browser-drive && node nap.mjs

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
check: fmt-check lint test control front readouts-check contract-check front-check

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

# Does the page survive its decoder dying? Needs the worker RUNNING and streaming
# (`systemctl start nel3ab-worker`), because the failure only exists against a
# live stream: a decoder that is fed nothing cannot be caught refusing anything.
#
# Not part of `local`: it drives a real Chrome against a real session, so it is
# the recipe to run when the page changes rather than on every commit.
browser-recovery:
    cd spikes/m3-browser-drive && node wedge.mjs http://localhost:8100/ 6

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
    cd spikes/m3-browser-drive && node padmenu.mjs

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
    cd spikes/m3-browser-drive && node bindings.mjs http://localhost:8100/

# Ce que la page rend, sur une minute, sans rien redémarrer.
#
# Le banc redémarre la session, donc il ne peut pas tourner pendant que
# quelqu'un joue. Celui-ci n'est qu'un spectateur de plus: il mesure le côté
# navigateur, qui est la moitié qu'un changement de page peut dégrader.
browser-watch seconds="60":
    cd spikes/m3-browser-drive && node watch.mjs http://localhost:8100/ {{seconds}}

# Does the page survive being switched away from? Needs the worker RUNNING.
# Opens a second tab to push the first one into the background, which is how a
# person does it, and asserts that nothing is decoded for a screen that is not
# asking. Watching the decoder's backlog instead would pass on a machine whose
# decoder is fast enough to keep up with work nobody wanted — this one is.
browser-background:
    cd spikes/m3-browser-drive && node backgrounded.mjs http://localhost:8100/ 30

# Does a controller survive its player switching away, and only that? Needs the
# worker RUNNING. Backgrounds a real tab for longer than the ping deadline, then
# closes one. The unit tests pin the server's side of this; only a real browser
# can answer whether Chrome pongs while a tab is throttled, and the whole design
# rests on it doing so.
browser-seats:
    cd spikes/m3-browser-drive && node seat-kept.mjs http://localhost:8100/ 25

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
    cd spikes/m3-browser-drive && node claim.mjs http://localhost:8100/

# Does sound come out, at the rate it was recorded at, and does the page play it?
# Needs the worker RUNNING. The first check reads the stream the way the page
# does and looks at the samples; the second drives the page's own playback with
# autoplay forced on, which is the only thing it fakes.
browser-sound:
    cd spikes/m3-browser-drive && node sound.mjs http://localhost:8100/ 20
    cd spikes/m3-browser-drive && node playback.mjs http://localhost:8100/ 12

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
    cd spikes/m3-browser-drive && node audio-budget.mjs http://localhost:8100/ {{seconds}}

# The two ways of building the audio context, one after the other on the same
# stream. Prints what each costs; whether either buzzes is a question for ears.
browser-rates:
    cd spikes/m3-browser-drive && node rates.mjs http://localhost:8100/

# Does the lip-sync box move the picture when it is clicked, rather than twenty
# seconds later? Needs the worker RUNNING.
browser-lipsync:
    cd spikes/m3-browser-drive && node lipsync.mjs http://localhost:8100/

# Do the numbers stay beside the picture, without scrolling, at the widths people
# actually use? Needs the worker RUNNING.
browser-layout:
    cd spikes/m3-browser-drive && node layout.mjs

# Does the library show the names a person reads, and none of the file clutter?
# Needs the worker RUNNING.
browser-library:
    cd spikes/m3-browser-drive && node library.mjs

# Taking a socket somebody is playing on: two clicks to do it, and the player it
# was taken from is told and left unplugged rather than quietly moved. Needs the
# worker RUNNING and ONE free port — not an empty room.
browser-steal:
    cd spikes/m3-browser-drive && node steal.mjs http://localhost:8100/

# Changing the game from the page. RESTARTS THE SESSION, which is the feature,
# so it must not be run while somebody is playing something they care about.
#
# What it pins is the SEQUENCE, not the outcome: one click must arm and boot
# nothing. A test that only checked "the game changed" would pass just as well on
# a page that switched on the first click, and what is being confirmed is the end
# of everybody else's game.
# Le contraste EFFECTIF de chaque texte, dans les trois coques.
#
# Ici et pas dans `check` parce qu'il faut un vrai rendu: l'opacité s'accumule
# sur les ancêtres, le fond vient du premier ancêtre qui en peint un, et le
# produit des deux n'apparaît dans aucun des fichiers où on l'écrit. Le 2
# septembre 2026 il a trouvé 196 textes sous le seuil, dont l'état des quatre
# manettes dans la colonne — ce qu'on regarde le plus souvent de la page.
#
# N'ARRÊTE PAS la partie: il ouvre le menu, il ne lance rien.
browser-contraste:
    cd spikes/m3-browser-drive && node contraste.mjs http://localhost:8100/

# Ce que la page MONTRE pendant un changement de jeu.
#
# RESTARTS THE SESSION. Ici et pas dans `check` parce que ce qui est vérifié est
# une IMAGE à l'écran: le défaut du 31 août 2026 laissait tous les compteurs
# cohérents et montrait l'ancien jeu figé cinq secondes et demie. Aucun essai
# unitaire ne peut voir ça, et c'est exactement pourquoi ce fichier existe.
browser-loading:
    cd spikes/m3-browser-drive && node loading.mjs http://localhost:8100/

browser-games:
    cd spikes/m3-browser-drive && node games.mjs http://localhost:8100/

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
    cd control && uv run ruff check --config pyproject.toml ../docker/switch-room.py ../docker/switch-saves.py ../docker/switch-dlc.py ../docker/test_switch_room.py ../docker/test_switch_dlc.py
    cd control && uv run ruff format --check --config pyproject.toml ../docker/switch-room.py ../docker/switch-saves.py ../docker/switch-dlc.py ../docker/test_switch_room.py ../docker/test_switch_dlc.py

# Four isolated browsers and real GC/Wii/Switch engines. Requires the private
# NEL3AB_TEST_SWITCH_CONFIG; optional NEL3AB_TEST_SWITCH_SAVE tests unlocked saves.
# No installed room, controller port or persistent save is used by this driver.
switch-room-test rom:
    cargo build --manifest-path core/Cargo.toml -p nel3ab-worker
    node spikes/m3-browser-drive/switch-room.mjs '{{rom}}'

# Catalogue local et trois menus, sans émulateur lancé ni salle installée touchée.
catalogue-test:
    cargo build --manifest-path core/Cargo.toml -p nel3ab-worker
    node spikes/m3-browser-drive/catalogue.mjs
