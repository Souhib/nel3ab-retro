# Driving the browser half without a human

The worker's page can only be judged in a browser, and lgf has none. This runs a
real one **on the server**, headless, against `localhost` — which also sidesteps
the secure-context problem: WebCodecs needs one, and `http://` on a LAN IP is not
one, while `http://localhost` is.

```sh
npm install puppeteer          # Chrome for Testing; ~180 MB, downloaded once
node drive.mjs http://localhost:8100/ 20
NO_INPUT=1 SHOT=control.png node drive.mjs http://localhost:8100/ 20
```

It reports what the page says about itself, samples the canvas for distinct
colours, and leaves a screenshot to **look at** — which is the check every hollow
claim in this project turned out to be missing.

## The control matters more than the run

The first comparison here was wrong in a way worth remembering. Two runs against
the **same** worker: one pressing keys, one not. Both showed the game past its
opening dialog, which looked like proof that input worked — and proved nothing,
because the second run inherited the emulator state the first had changed.

Redone with a fresh Dolphin per arm, same duration:

| | frames | what was on screen |
|---|---|---|
| no keys | 1141 | the memory-card dialog, unmoved |
| keys | 1119 | dialog dismissed, the intro playing |

M1 measured that this dialog never changes on its own — 7037 byte-identical
frames — so a screen that has moved past it *is* the evidence, provided the run
started from the same place.

## What it does not measure

`localhost` is not a network. The arrival-to-glass figures the page prints
(p50 0.6 ms, p95 2.4 ms on this loop) are transit-free by construction. A number
from here is a floor for the browser half, and says nothing about Wi-Fi.

`node_modules/` is not committed; nothing in the worker depends on this.

## Deux pilotes qui sont partis dans les tests unitaires

`padmap.mjs` et `lesson.mjs` conduisaient un vrai Chrome contre un vrai worker
pour vérifier deux choses **pures**: la correspondance entre un bouton de manette
et un bit du protocole, et la machine à états qui apprend une manette inconnue.

Depuis que la boucle média est en modules TypeScript, ces deux-là sont
`front/src/media/pad.test.ts` et `front/src/media/lesson.test.ts`. Ils font les
mêmes assertions, tournent en quelques millisecondes au lieu de vingt secondes,
ne demandent ni GPU ni session, et surtout ne demandent plus à la page d'ouvrir
une porte de test dont eux seuls se servaient.

Ce n'est pas une règle générale contre les pilotes de navigateur: ce qui reste
ici vérifie des choses qu'aucun test unitaire ne peut voir, comme un décodeur qui
meurt, un onglet qu'on met en arrière-plan, ou deux pages qui se disputent une
manette.

## Franchir l'écran de salle

La page demande un prénom, puis montre la salle avant d'y entrer. Chaque pilote
passe donc par `open.mjs`: `seedName` écrit le prénom là où la page le range,
`enterRoom` clique le bouton. Le clic plutôt qu'un drapeau caché: un chemin
d'essai qui contourne l'écran ne prouve rien de l'écran.
