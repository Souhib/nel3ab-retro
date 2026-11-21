"""Bobine dans les pages du salon.

Les pages servies par le salon (accueil, import, profil) sont du HTML écrit à
la main, sans la page React de la salle. Elles reçoivent le même personnage et
la même feuille, recopiés par `front/src/bobine/statique.test.tsx`, qui échoue
si la copie n'est plus celle que le composant produit.

Une page marque l'endroit de la feuille par ``/*__BOBINE__*/`` dans son
``<style>``, et chaque dessin par ``<!--BOBINE:tenue:pose-->``. Le remplacement
se fait une fois, au chargement de la page: une marque inconnue lève une erreur
au démarrage du salon plutôt qu'un trou dans une page servie.
"""

import re
from pathlib import Path

DOSSIER = Path(__file__).parent / "bobine"

#: Ce que Bobine peut tenir, tel que le composant les dessine.
TENUES = ("aucune", "fiche", "loupe", "tampon", "cartouche", "disque", "carte")
#: Les poses que la feuille anime.
POSES = (
    "repos",
    "marche",
    "porte",
    "pousse",
    "salue",
    "dort",
    "souffle",
    "essuie",
    "loupe",
    "tire",
)

_MARQUE = re.compile(r"<!--BOBINE:([a-z]+):([a-z]+)-->")


def feuille() -> str:
    """La feuille de Bobine, à poser dans un ``<style>``."""
    return (DOSSIER / "bobine.css").read_text(encoding="utf-8")


def dessin(tenue: str = "aucune", pose: str = "repos") -> str:
    """Le dessin SVG de Bobine, dans une tenue et une pose connues."""
    if tenue not in TENUES:
        raise ValueError(f"tenue inconnue pour Bobine: {tenue}")
    if pose not in POSES:
        raise ValueError(f"pose inconnue pour Bobine: {pose}")
    svg = (DOSSIER / f"bobine-{tenue}.svg").read_text(encoding="utf-8").strip()
    return svg.replace('data-pose="repos"', f'data-pose="{pose}"', 1)


def garnir(page: str) -> str:
    """Remplace les marques d'une page par la feuille et les dessins."""
    garnie = page.replace("/*__BOBINE__*/", feuille())
    return _MARQUE.sub(lambda trouve: dessin(trouve.group(1), trouve.group(2)), garnie)
