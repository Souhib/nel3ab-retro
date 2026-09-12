"""Ce qu'une salle montre à la liste du salon."""

from pydantic import BaseModel, Field


class Salle(BaseModel):
    """Une salle, vue de la liste.

    Volontairement maigre: le jeu en cours et les personnes présentes ne sont
    PAS ici tant que le salon ne va pas les demander à la salle elle-même.
    Déclarer un champ qu'on ne remplit pas encore le ferait afficher comme une
    absence, et une absence affichée est indiscernable d'un zéro vrai. Ce projet
    a déjà commis cette faute quatre fois.
    """

    numero: int = Field(ge=1, description="Le numéro de la salle, celui de son unité.")
    ouverte: bool = Field(description="Vrai quand son worker tourne.")
    chemin: str = Field(
        description="Sous quelle adresse la rejoindre, par exemple `/r/1/`.",
    )
    jeu: str | None = Field(
        default=None,
        description=(
            "Le jeu qui tourne, ou rien quand la salle est sur son menu. Rien "
            "veut dire « aucun jeu », jamais « on n'a pas pu demander »: une "
            "salle injoignable est décrite comme fermée, pas comme vide."
        ),
    )
    switch: bool = Field(
        default=False,
        description=(
            "Vrai quand ce jeu est un jeu Switch. Une seule salle à la fois "
            "peut en faire tourner un, donc la liste doit le montrer plutôt "
            "que de laisser quelqu'un se faire refuser après coup."
        ),
    )
