"""Ce qu'une salle montre à la liste du salon."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class DernierJeu(BaseModel):
    """Le dernier jeu qu'une salle a lancé, d'après son propre dossier."""

    cle: str = Field(description="Sa clé, son nom de fichier (ADR D23).")
    titre: str = Field(description="Son titre, tel que la bibliothèque le nomme.")
    quand: datetime = Field(
        description=(
            "Quand il a été CHOISI (l'écriture du choix par le worker), pas quand "
            "la partie s'est terminée: « lancé jeudi soir », pas « joué jeudi soir »."
        )
    )


class SiegeVu(BaseModel):
    """Une manette d'une salle, telle que l'accueil la montre."""

    port: int = Field(ge=1, le=4, description="Le numéro de la manette.")
    nom: str | None = Field(
        default=None,
        description=(
            "Le pseudo de qui l'a annoncée au salon, ou rien. Jamais l'adresse: "
            "un pseudo vide se dit « quelqu'un »."
        ),
    )
    tenu: bool | None = Field(
        default=None,
        description=(
            "Vrai quand le worker la dit tenue à sa dernière lecture, faux quand "
            "il la dit libre, rien tant qu'il n'a rien dit."
        ),
    )


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
    redemarre: bool = Field(
        default=False,
        description=(
            "Vrai quand systemd relance son worker: il est sorti, pour un "
            "changement de jeu ou un plantage, et revient dans deux secondes. "
            "Une salle qui redémarre n'est pas ouverte, et pas fermée non "
            "plus: une page qui la voit tomber ne doit pas la dire fermée."
        ),
    )
    chemin: str = Field(
        description="Sous quelle adresse la rejoindre, par exemple `/r/1/`.",
    )
    jeu: str | None = Field(
        default=None,
        description=(
            "Le jeu qui tourne, ou rien quand la salle est sur son menu. Pour une "
            "salle qui redémarre, le jeu qui revient, lu dans son dossier. Rien "
            "veut aussi dire « on n'a pas su »: `repond` faux dit une salle "
            "allumée mais muette."
        ),
    )
    cle: str | None = Field(
        default=None,
        description=(
            "La clé du jeu qui tourne, son nom de fichier (ADR D23), lue avec "
            "`jeu`. Rien avec lui, et rien pour un worker qui ne la publie pas."
        ),
    )
    console: str | None = Field(
        default=None,
        description=(
            "Le code de la console du jeu qui tourne (`consoles/consoles.json`). "
            "Rien sans jeu, et rien quand le disque n'a pas dit sa console: « ? » "
            "ne se publie pas comme une console."
        ),
    )
    dernier_jeu: DernierJeu | None = Field(
        default=None,
        description=(
            "Le dernier jeu que cette salle a lancé, lu dans son dossier "
            "(`chosen-rom`), ouverte ou non. Il reste le même quand la salle "
            "revient sur son menu. Rien quand elle n'a jamais lancé de jeu, ou "
            "quand ce jeu n'est plus dans la bibliothèque."
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
    chef: str | None = Field(
        default=None,
        description=(
            "Le pseudo de qui choisit le jeu dans cette salle: le chef retenu "
            "après une reprise, sinon le premier arrivé identifié encore là. "
            "Rien pour une salle qui n'est pas ouverte, et pour une salle où "
            "personne n'a d'identité (tenir une manette y suffit alors)."
        ),
    )
    sieges: list[SiegeVu] | None = Field(
        default=None,
        description=(
            "Chaque manette, qui l'a annoncée et si le worker la dit tenue, tirés "
            "de ce que le salon suit déjà pour la salle, sans question de plus au "
            "worker. Vide pour une salle qui n'est pas ouverte. Rien pour une "
            "salle ouverte où personne n'est connecté au salon: il ne suit pas "
            "ses places, et une dernière lecture vieille de plusieurs minutes "
            "dirait des manettes tenues qui ne le sont plus."
        ),
    )
    regardent: list[str] = Field(
        default_factory=list,
        description=(
            "Qui est dans la salle sans tenir de manette et l'a dit (spectateur), "
            "une fois par personne. Quelqu'un qui vient d'arriver et attend sa "
            "manette n'y est pas. Vide pour une salle qui n'est pas ouverte."
        ),
    )
    ouverte_depuis: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Depuis combien de SECONDES cette salle est ouverte, d'après le "
            "repère que le salon pose quand il l'ouvre. Survit aux changements "
            "de jeu. Jusqu'au 23 novembre 2026, ce champ disait le temps depuis "
            "la dernière relance du worker, c'est-à-dire depuis le dernier "
            "changement de jeu: c'est maintenant `jeu_depuis`. Rien pour une "
            "salle fermée, pour une salle ouverte sans passer par le salon, et "
            "pour une salle ouverte avant ce repère. Rien ne s'affiche pas: une "
            "salle « ouverte depuis 0 seconde » serait une absence déguisée en "
            "mesure."
        ),
    )
    jeu_depuis: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Depuis combien de SECONDES le worker de cette salle tourne sans être "
            "sorti, lu dans systemd: le temps du jeu en cours, ou du menu. Il "
            "repart à chaque changement de jeu, puisque le worker sort pour "
            "changer de jeu et que systemd le relance. Rien quand la salle n'est "
            "pas ouverte ou que systemd ne le dit pas."
        ),
    )
    repond: bool | None = Field(
        default=None,
        description=(
            "Vrai quand la salle allumée a répondu à la question de son jeu, "
            "faux quand systemd la dit allumée et qu'elle n'a rien répondu "
            "d'exploitable: une salle allumée mais muette. Rien quand on n'a pas "
            "demandé: salle fermée, salle qui redémarre, ou salon sans client "
            "(les essais). Faux n'est pas « sur son menu »: `jeu` est alors "
            "rien aussi, mais pour une autre raison."
        ),
    )
    fermee_depuis: int | None = Field(
        default=None,
        ge=0,
        description=(
            "Depuis combien de SECONDES cette salle est fermée, lu dans systemd. "
            "Rien pour une salle ouverte ou qui redémarre, et pour une salle "
            "jamais démarrée depuis le démarrage de la machine."
        ),
    )
    fermee_pour: Literal["inactivite", "arret", "panne"] | None = Field(
        default=None,
        description=(
            "Pourquoi elle est fermée: « inactivite » (personne n'a touché au "
            "jeu pendant une demi-heure, le worker sort avec le code 42), "
            "« arret » (quelqu'un l'a fermée), « panne » (tout le reste). Qui "
            "l'a fermée n'est pas publié. Rien quand `fermee_depuis` est rien."
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


class OuvrirSalle(BaseModel):
    """Ce qu'une demande d'ouverture peut préciser (D17). Tout est facultatif."""

    numero: int | None = Field(
        default=None,
        ge=1,
        description=(
            "Ouvrir CETTE salle: « Ouvrir la salle 3 », « Rouvrir la salle 1 ». "
            "Refusé (409) si elle n'est pas fermée: une salle qui redémarre n'est "
            "pas libre. Sans numéro, le premier emplacement libre."
        ),
    )
