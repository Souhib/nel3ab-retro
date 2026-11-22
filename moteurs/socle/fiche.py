"""La fiche d'un moteur, `moteurs/<nom>/moteur.json`, lue et validée.

Cinq champs seulement, chacun avec ce qui le lit. Un champ que rien ne lit
pourrait être faux sans qu'aucun essai n'échoue; les autres (sauvegardes,
caches, versions...) arriveront avec leur premier lecteur.

- `name`: le nom du dossier, et un moteur du manifeste. Lu par C1.
- `executable`: chemin dans le dossier du moteur; son nom est le processus de
  la boîte noire. Lu par C1, C8, et l'adaptateur au lancement.
- `display`: `wayland`, ou `x11` par Xwayland (`NEL3AB_SWAY_X11=1`). Lu par C7
  et l'adaptateur.
- `pad_layout`: `switch` (X et Y échangés) ou `xbox` (pads.py). Lu par C3 et
  l'adaptateur.
- `why`: une raison par champ qui s'écarte du cas commun. Lu par `lire`, ici.

`lire` refuse une fiche mal formée. Elle ne compare RIEN au manifeste des
consoles: une salle ne le lit jamais (ADR D22, règle 6). Que l'exécutable donne
un processus connu de la boîte noire est vérifié par C1, dans un essai.
"""

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

CLES = ("name", "executable", "display", "pad_layout", "why")
AFFICHAGES = ("wayland", "x11")
DISPOSITIONS = ("switch", "xbox")
NOM = r"[a-z][a-z0-9-]{0,31}"
#: Quinze caractères: ce que le noyau garde du nom d'un processus (/proc/<pid>/comm).
NOM_NOYAU_MAX = 15
#: Une fiche tient en quelques lignes; la même borne que `unlocked::state_root`.
TAILLE_MAX = 65_536


class FicheInvalideError(ValueError):
    """La fiche ne décrit pas un moteur que le socle sait lancer."""


@dataclass(frozen=True)
class Fiche:
    name: str
    executable: PurePosixPath
    display: str
    pad_layout: str
    why: Mapping[str, str]

    @property
    def process(self) -> str:
        """Le nom que la boîte noire lit dans /proc/<pid>/comm."""
        return self.executable.name[:NOM_NOYAU_MAX]


def relatif(valeur: object) -> PurePosixPath:
    """Un chemin sous le dossier du moteur: relatif, sans `..` ni segment vide."""
    if not isinstance(valeur, str) or not valeur:
        raise FicheInvalideError("executable doit être un chemin non vide")
    if valeur.startswith("/"):
        raise FicheInvalideError(f"executable doit être relatif au dossier du moteur: {valeur!r}")
    parties = valeur.split("/")
    if any(partie in ("", ".", "..") for partie in parties):
        raise FicheInvalideError(f"executable ne doit avoir ni '..', ni '.', ni '//': {valeur!r}")
    return PurePosixPath(valeur)


def depuis(brut: object, dossier: str) -> Fiche:
    """Une fiche déjà décodée, trouvée dans `moteurs/<dossier>/`."""
    if not isinstance(brut, dict):
        raise FicheInvalideError("une fiche est un objet JSON")
    manquantes = [cle for cle in CLES if cle not in brut]
    inconnues = sorted(set(brut) - set(CLES))
    if manquantes or inconnues:
        raise FicheInvalideError(f"clés manquantes {manquantes}, clés inconnues {inconnues}")
    name = brut["name"]
    if not isinstance(name, str) or not re.fullmatch(NOM, name) or name != dossier:
        raise FicheInvalideError(f"name doit être le nom de son dossier {dossier!r}, pas {name!r}")
    executable = relatif(brut["executable"])
    if brut["display"] not in AFFICHAGES:
        raise FicheInvalideError(f"display vaut {AFFICHAGES}, pas {brut['display']!r}")
    if brut["pad_layout"] not in DISPOSITIONS:
        raise FicheInvalideError(f"pad_layout vaut {DISPOSITIONS}, pas {brut['pad_layout']!r}")
    why = brut["why"]
    if not isinstance(why, dict):
        raise FicheInvalideError("why associe un champ à sa raison")
    for champ, raison in why.items():
        if champ not in CLES or champ in ("name", "why"):
            raise FicheInvalideError(f"why parle d'un champ que la fiche n'a pas: {champ!r}")
        if not isinstance(raison, str) or not raison.strip():
            raise FicheInvalideError(f"why.{champ} doit dire sa raison")
    # Xwayland s'écarte de la règle des salles: la raison est exigée par la machine.
    if brut["display"] == "x11" and "display" not in why:
        raise FicheInvalideError("display x11 demande sa raison dans why.display")
    return Fiche(name, executable, brut["display"], brut["pad_layout"], dict(why))


def lire(chemin: Path) -> Fiche:
    """La fiche du fichier `chemin`, ou un refus qui le nomme."""
    try:
        if chemin.stat().st_size > TAILLE_MAX:
            raise FicheInvalideError(f"plus de {TAILLE_MAX} octets")
        return depuis(json.loads(chemin.read_text(encoding="utf-8")), chemin.parent.name)
    except (OSError, ValueError) as erreur:
        raise FicheInvalideError(f"{chemin}: {erreur}") from erreur
