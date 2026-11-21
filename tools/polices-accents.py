"""Remonter et épaissir les accents d'Anybody dans les sous-ensembles du salon.

Le 21 novembre 2026, les pages du salon affichaient « tout debloque » et
« precedente » sous 17 px, dans Chrome sous Linux à l'échelle 1. Les accents
sont bien dans les fichiers, comme glyphes composés (`e` + `acute`), mais le bas
de l'aigu ne dépasse le haut du `e` que de 30 unités sur 2000. Sans consignes
de rendu dans la police, l'outil de lissage du système colle cet accent sur
la ligne du `e`, où il se fond dans la lettre. Décomposer les glyphes n'a rien
changé (essayé le même jour); remonter l'accent de 70 unités l'a fait
réapparaître de 12 à 16 px, et l'élargir de 24 unités de chaque côté le rend
moins pâle.

La licence OFL d'Anybody permet de modifier la police; elle ne déclare pas de
nom réservé. Le script refuse un dessin qui n'a pas le nombre de points
attendu, pour ne pas déformer en silence un autre sous-ensemble.

    uv run --with fonttools --with brotli python tools/polices-accents.py ENTREE SORTIE
"""

import sys

from fontTools.ttLib import TTFont

D = 24  # unités sur 2000 par cadratin, de chaque côté d'un bord horizontal
LEVE = 70  # remontée de chaque accent, en unités sur 2000
src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
glyf = font["glyf"]


def epaissit(nom, attendus):
    """Elargit chaque bord horizontal d'un trait: gauche -D, droite +D.

    Les points intérieurs d'un chevron (le creux sous la pointe) vont dans
    l'autre sens, pour que les deux branches s'épaississent aussi.
    """
    g = glyf[nom]
    pts = [tuple(p) for p in g.getCoordinates(glyf)[0]]
    if len(pts) != attendus:
        raise SystemExit(f"{nom}: {len(pts)} points au lieu de {attendus}")
    bas = min(y for _, y in pts)
    haut = max(y for _, y in pts)
    nouveaux = []
    for x, y in pts:
        if y in (bas, haut):
            rang = sorted(px for px, py in pts if py == y)
            if len(rang) == 2:
                nouveaux.append((x - D if x == rang[0] else x + D, y))
            else:  # quatre pieds de chevron: extérieurs dehors, intérieurs dedans
                i = rang.index(x)
                nouveaux.append((x + (-D, D // 2, -(D // 2), D)[i], y))
        else:
            nouveaux.append((x, y - D))  # le creux sous la pointe descend
    nouveaux = [(x, y + LEVE) for x, y in nouveaux]
    g.coordinates = type(g.coordinates)(nouveaux)
    g.recalcBounds(glyf)


# Un fichier déjà corrigé ne doit pas l'être deux fois: l'accent monterait de
# 140 unités. Le bas de l'aigu d'origine est à 1216 (400), 1212 (600), 1208
# (700) environ; corrigé, il passe au-dessus de 1270.
glyf["acute"].recalcBounds(glyf)
if glyf["acute"].yMin > 1250:
    raise SystemExit(f"{src}: accents déjà remontés, rien à faire")

epaissit("acute", 4)
epaissit("grave", 4)
epaissit("glyph00206", 7)
font.flavor = "woff2"
font.save(dst)
print("ok", dst.split("/")[-1])
