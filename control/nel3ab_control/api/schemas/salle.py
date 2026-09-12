"""Ce qu'une salle montre à la liste du salon."""

from pydantic import BaseModel, Field


class Salle(BaseModel):
    """Une salle, vue de la liste.

    Maigre par principe: un champ n'apparaît ici que quand le salon sait le
    REMPLIR. Déclarer un champ qu'on ne remplit pas encore le ferait afficher
    comme une absence, et une absence affichée est indiscernable d'un zéro vrai.
    Ce projet a déjà commis cette faute quatre fois.

    C'est ce qui a longtemps tenu `jeu` et les présents dehors. `jeu` est entré
    le jour où le salon a su le demander à la salle. Les présents entrent
    maintenant, et pour une autre raison: le salon ne les demande à personne, il
    les tient lui-même, puisque c'est à lui que les pages se connectent. Ce qu'il
    en dit est donc vrai de première main, même quand une salle ne répond plus.

    Deux champs entrent en pouvant valoir « rien », et c'est une exception
    RAISONNÉE plutôt qu'un oubli. Ce qui rendait la règle nécessaire est qu'une
    absence finit affichée comme un zéro. Ici l'absence ne s'affiche pas du
    tout: la page qui lit ces deux champs tait la ligne au lieu d'écrire 0.
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
    gens: list[str] = Field(
        default_factory=list,
        description=(
            "Qui est dans la salle, par son pseudo, une fois par personne et "
            "non une fois par onglet. Vide veut dire « personne », jamais « on "
            "n'a pas pu savoir »: le salon tient lui-même cette liste. Une "
            "salle fermée n'a personne, par construction."
        ),
    )
    ouverte_depuis: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Depuis combien de SECONDES cette salle tourne, ou rien quand "
            "systemd ne le dit pas. Rien ne s'affiche pas: une salle « ouverte "
            "depuis 0 seconde » serait une absence déguisée en mesure."
        ),
    )
    places: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Combien de manettes personne ne tient, demandé à la salle. Rien "
            "quand elle ne répond pas, jamais quatre: annoncer libre une salle "
            "pleine y enverrait du monde pour rien. Ce n'est pas « quatre moins "
            "les présents »: on peut regarder une partie sans tenir de manette."
        ),
    )
