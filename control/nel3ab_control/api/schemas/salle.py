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
