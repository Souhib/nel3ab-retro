# Relever une manette sur une photo

Les dessins de manettes du configurateur (`front/src/lib/padmap.ts`) sont
relevés sur des photos vues de dessus, le 21 novembre 2026. Ce dossier garde les
outils et les mesures, pour corriger un dessin ou en ajouter un. Les photos ne
sont pas dans le dépôt : elles ne servent qu'à mesurer, et le dessin final ne
contient ni photo ni logo.

## Les photos

Toutes viennent de Wikimedia Commons. Le premier nom est celui de la page
`File:` ; il suffit pour les retrouver.

| Manette | Fichier Commons | Licence | Ce qui en vient |
|---|---|---|---|
| GameCube | `GameCube controller.png` | CC BY-SA 3.0 | silhouette et tous les boutons, extraits automatiquement |
| DualSense | `Playstation 5 DualSense controller in Midnight Black, 2026-02-07 (front).jpg` | voir la page | silhouette extraite, boutons lus |
| DualSense blanche | `KontrolerDualSense.jpg` | voir la page | forme de la plaque noire, à l'œil |
| Xbox Series | `Xbox Series Controller Carbon Black.jpg` | CC BY-SA 4.0 | tout, lu sur la grille |
| Wiimote | `Nintendo Wii Remote Plus (white) - front view.jpg` | voir la page | place des boutons |
| Nunchuk | `Wii nunchuk controller side.jpg` | voir la page | profil, stick, C et Z, lus sur la grille |
| Guitare | `Guitar Hero 3 guitar for the Wii.jpg` | voir la page | corps, manche, frettes, lus sur la grille |
| Manette Pro | `Nintendo Switch Pro Controller Zelda.jpg` | voir la page | tout, lu sur la grille |

## Deux façons de relever

**Extraire automatiquement**, quand le fond est uni (GameCube sur noir,
DualSense sur blanc). `contour.py` sépare la manette du fond, garde la plus
grande tache et rend sa silhouette en points régulièrement espacés.
`trous.py` rend les trous de ce masque : sur la GameCube, ce sont exactement les
boutons et les sticks. `taches.py` trouve les boutons par leur couleur.

```
uv run --no-project --with opencv-python-headless --with numpy python contour.py PHOTO dark-bg gc 21 64
uv run --no-project --with opencv-python-headless --with numpy python trous.py gc-mask.png 80 70 0.11386 4 3
python3 lisse.py gc-pts.json 80 70 0.11386 1 4 3
```

Les quatre nombres sont l'origine de la photo, l'échelle, puis le décalage dans
le repère du dessin (100 de large).

**Lire sur une grille**, quand le fond est chargé. Le granit sous la manette
Xbox a mis en échec les deux extractions essayées, par seuil puis par texture.
`grille-photo.mjs` (dans `spikes/m3-browser-drive`, pour Puppeteer) pose une
grille chiffrée tous les 20 pixels sur la photo. On y lit les points du
contour et le centre des boutons ; `xbox.py`, `nunchuk.py`, `guitare.py` et
`switch-pro.py` gardent ces lectures et les convertissent.

## Symétrie

Une photo n'est jamais prise exactement à la verticale. Sur la DualSense, le
centre des sticks et celui de la silhouette différaient de deux unités. Les
manettes symétriques sont donc relevées sur leur moitié gauche, puis
retournées : `sym.py` pour la silhouette, `mirrorX` dans `padmap.ts` pour les
gâchettes et les plaques. Pour la DualSense, trois points de l'encoche du
bouton L1 ont été descendus avant la symétrie (indices 71, 0 et 1 de
`ds-pts.json`, de 9, 10 et 6 pixels).

## Vérifier

Après une retouche, dans cet ordre :

1. `cd front && npx vitest run src/lib/padmap.test.ts` : chaque pièce se vise et
   reste dans son cadre ;
2. `just padmap-visuel` : dans un vrai navigateur, chaque pièce est sur la coque,
   chaque gâchette dépasse, le vibrato touche et dépasse ;
3. `just banc-visuel` : silhouette et touche appuyée à 3:1 au moins ;
4. `just reglage-navigateur` : le panneau tient ses dessins, ses zones de clic
   et ses marques (`browser-configuration`, qui mesurait l'ancien dialogue, est
   retiré avec lui le 24 novembre 2026) ;
5. `node padmap-carte.mjs <id> <sortie> "?sim"` pour regarder une manette de
   près, touches tenues.
