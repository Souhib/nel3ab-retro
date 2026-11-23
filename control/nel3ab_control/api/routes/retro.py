"""Le thème rétro dans les pages du salon (ADR D37).

Les pages du salon (accueil, dépôt, carnet) sont du HTML écrit à la main, sans
la page React de la salle. Elles reçoivent au démarrage ce que la salle porte:
la feuille des effets, le script qui pose le réglage de l'appareil avant la
première image, l'icône d'onglet et le logo. Les trois fichiers de `retro/`
sont écrits depuis les modules de la salle et comparés par
`front/src/lib/salon-retro.test.ts`: une seule source pour les deux.

Une page marque l'endroit de chaque pièce:

- ``/*__EFFETS__*/`` dans son ``<style>``, après ``/*__REGIE__*/``;
- ``<!--RETRO:EN-TETE-->`` dans son ``<head>``, avant le ``<style>``: le
  script doit tourner avant que le corps se peigne;
- ``<!--RETRO:LOGO-->`` là où le nom du service s'affiche;
- ``<!--RETRO:REGLAGE-->`` là où la page propose le réglage des effets (le pied
  de l'accueil): trois niveaux et les sons de menu, la même clé que la salle.

Le remplacement se fait une fois, au chargement de la page. Une marque restée
dans une page servie lève une erreur au démarrage du salon plutôt que
d'afficher un commentaire à la place du logo.
"""

from pathlib import Path

DOSSIER = Path(__file__).parent / "retro"

#: Les marques, et le fichier qui les remplace.
MARQUES = {
    "/*__EFFETS__*/": "effets.css",
    "<!--RETRO:EN-TETE-->": "en-tete.html",
    "<!--RETRO:LOGO-->": "logo.svg",
    "<!--RETRO:REGLAGE-->": "reglage.html",
}


def piece(nom: str) -> str:
    """Le contenu d'une pièce de `retro/`, sans la fin de ligne finale."""
    return (DOSSIER / nom).read_text(encoding="utf-8").rstrip("\n")


def garnir(page: str) -> str:
    """Remplace les marques du thème rétro dans une page.

    L'en-tête et la feuille sont attendus dans chaque page; le logo et le
    réglage, là où la page les demande. Une page sans en-tête ni feuille est une page qui
    s'afficherait sans le réglage de l'appareil: c'est une erreur.
    """
    for marque in ("/*__EFFETS__*/", "<!--RETRO:EN-TETE-->"):
        if marque not in page:
            raise ValueError(f"page du salon sans la marque {marque}")
    for marque, fichier in MARQUES.items():
        page = page.replace(marque, piece(fichier))
    restes = [marque for marque in MARQUES if marque in page]
    if restes:
        raise ValueError(f"marques du thème rétro restées dans la page: {restes}")
    return page
