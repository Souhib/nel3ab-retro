"""Reconnaître un fichier sans le relire en entier: l'empreinte rapide.

Un jeu pèse jusqu'à 24 Gio. Le navigateur doit pouvoir dire « c'est le même
fichier qu'hier » avant de renvoyer quoi que ce soit, et le salon doit pouvoir
dire « ce fichier est déjà dans la bibliothèque » sans relire 76 Gio.

L'empreinte rapide est le SHA-256 de trois choses mises bout à bout:

- les 4 premiers Mio du fichier (ou tout le fichier s'il est plus petit);
- les 4 derniers Mio, sans recouvrir les premiers;
- la taille du fichier, sur 8 octets gros-boutistes.

Elle ne prouve pas que deux fichiers sont identiques: deux images qui ne
diffèrent qu'en leur milieu ont la même. Elle sert à RETROUVER un envoi et à
repérer un doublon probable. L'empreinte complète, calculée sur tout le fichier
à la fin de l'envoi, reste la seule preuve. La page calcule la même chose dans
`importer.js`, et un essai fait tourner les deux sur les mêmes octets.
"""

import hashlib
import os
import re

from nel3ab_control.imports.identifier import Lecteur

#: Combien d'octets au début, puis à la fin.
BOUT = 4 * 1024 * 1024

FORME = re.compile(r"^[0-9a-f]{64}$")


def empreinte_rapide(lire: Lecteur, taille: int) -> str:
    """L'empreinte rapide d'un fichier de `taille` octets, en hexadécimal."""
    calcul = hashlib.sha256()
    tete = min(taille, BOUT)
    calcul.update(lire(0, tete))
    queue = max(tete, taille - BOUT)
    calcul.update(lire(queue, taille - queue))
    calcul.update(taille.to_bytes(8, "big"))
    return calcul.hexdigest()


def lecteur_fd(fd: int) -> Lecteur:
    """Lit un fichier ouvert sans bouger sa position, comme le ferait `pread`."""

    def lire(decalage: int, longueur: int) -> bytes:
        morceaux = []
        while longueur > 0:
            lus = os.pread(fd, min(longueur, 1 << 20), decalage)
            if not lus:
                break
            morceaux.append(lus)
            decalage += len(lus)
            longueur -= len(lus)
        return b"".join(morceaux)

    return lire
