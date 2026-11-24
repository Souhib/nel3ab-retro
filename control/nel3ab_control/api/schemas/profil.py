"""Ce que le profil montre à la personne qui le demande, et à elle seule.

Rien ici ne porte d'adresse, de chemin, de nom de dossier ni d'empreinte. Les
`id` sont les jetons tirés au hasard par le journal des parties, qui ne disent
rien de personne. Une absence reste une absence (`None`), jamais un zéro: une
durée inconnue n'est pas une partie de zéro seconde.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

#: Dans quelle sauvegarde une partie s'est écrite, vue par la personne qui demande.
#:
#: « mienne » : la sienne, parce qu'elle a lancé le jeu. « du_lanceur » : celle
#: de quelqu'un d'autre, qui a lancé (« joué chez »). « commune » : tout
#: débloqué, à tout le monde. « neuve » : la partie neuve partagée d'un lancement
#: sans identité. « inconnue » : le jeu tournait avant que le salon le sache.
SauvegardeVue = Literal["mienne", "du_lanceur", "commune", "neuve", "inconnue"]


class ConsoleVue(BaseModel):
    """Une console, telle que le manifeste la décrit (ADR D22)."""

    code: str = Field(description="Son code, « gc », « switch »… ou « ? » si inconnue.")
    label: str = Field(description="Son nom à l'écran.")
    media: Literal["disc", "cartridge", "card"] | None = Field(
        default=None, description="Ce qu'on glisse dedans. Rien pour une console inconnue."
    )
    experimental: bool = False
    rang: int | None = Field(
        default=None,
        description=(
            "Sa place dans le manifeste. La page en tire la couleur de sa bande: "
            "une console ajoutée au manifeste a sa couleur sans toucher la page."
        ),
    )


class ResumeSauvegarde(BaseModel):
    """Une sauvegarde personnelle, d'après ses fichiers. Rien n'y est ouvert."""

    derniere_ecriture: datetime | None = Field(
        description="Le fichier le plus récemment écrit. Rien pour un dossier encore vide."
    )
    octets: int = Field(ge=0, description="La taille des fichiers de la partie elle-même.")
    versions: int = Field(
        ge=0,
        description="Les parties précédentes gardées à chaque « partie neuve ».",
    )
    copies: int = Field(
        ge=0,
        description="Les copies automatiques que l'adaptateur Switch fait à chaque partie.",
    )


class Chez(BaseModel):
    """Un lanceur chez qui la personne a joué, dans SA sauvegarde."""

    pseudo: str
    parties: int = Field(ge=0)
    secondes: int = Field(ge=0)


class Dernier(BaseModel):
    titre: str
    console: ConsoleVue
    quand: datetime


class Profil(BaseModel):
    """La première page du carnet."""

    pseudo: str
    depuis: datetime | None = Field(
        description=(
            "La première ligne du journal des parties de cette personne. Le journal "
            "commence le 21 novembre 2026: ce qui précède n'est pas noté."
        )
    )
    jeux: int = Field(ge=0, description="Combien de jeux différents joués, menu exclu.")
    parties: int = Field(ge=0)
    secondes: int = Field(ge=0, description="Le temps de jeu connu, parties en cours comprises.")
    inconnues: int = Field(
        ge=0, description="Les parties dont la fin n'a pas été vue: leur durée n'est pas comptée."
    )
    sauvegardes: int = Field(ge=0, description="Combien de sauvegardes personnelles existent.")
    dernier: Dernier | None = None


class JeuProfil(BaseModel):
    """Un jeu joué: une tranche sur l'étagère."""

    titre: str
    console: ConsoleVue
    premiere_fois: datetime
    derniere_fois: datetime
    secondes: int = Field(ge=0)
    parties: int = Field(ge=0)
    lancements: int = Field(ge=0, description="Combien de fois cette personne l'a lancé.")
    en_cours: bool = False
    chez: list[Chez] = Field(
        default_factory=list,
        description="Les lanceurs chez qui elle a joué à ce jeu, dans leur sauvegarde.",
    )
    communes: int = Field(ge=0, description="Les parties jouées sur « tout débloqué ».")
    sauvegarde: ResumeSauvegarde | None = Field(
        default=None,
        description=(
            "Sa sauvegarde personnelle de ce jeu. Rien quand elle n'existe pas, ou "
            "quand le salon ne sait pas la relier au jeu (Switch: le catalogue ne "
            "publie pas encore l'identifiant du titre)."
        ),
    )


class Compagnon(BaseModel):
    """Quelqu'un qui tenait une place dans la même salle, au même jeu, en même temps (D12)."""

    nom: str = Field(description="Son pseudo actuel, ou celui qu'il avait ce soir-là.")
    place: int = Field(
        ge=1, description="La place qu'il tenait, la première vue pendant la partie."
    )


class Partie(BaseModel):
    """Une partie: des places tenues de suite, au même jeu, dans la même salle.

    Une reconnexion de moins de deux minutes ne fait pas une nouvelle partie, et
    deux onglets de la même personne ne comptent pas double.
    """

    id: str = Field(description="Un jeton opaque, celui de la première place de la partie.")
    salle: int
    titre: str
    console: ConsoleVue
    debut: datetime
    fin: datetime | None = Field(
        description="Rien tant qu'elle dure, ou si la fin n'a pas été vue."
    )
    secondes: int = Field(ge=0)
    complete: bool = Field(description="Faux quand une de ses places n'a pas de fin connue.")
    en_cours: bool = False
    sauvegarde: SauvegardeVue
    lance_par: str | None = Field(
        default=None,
        description="Le pseudo de qui a lancé, quand ce n'est pas la personne elle-même.",
    )
    avec: list[Compagnon] = Field(
        default_factory=list,
        description=(
            "Ceux qui ont joué avec elle: une place tenue dans la même salle, au même "
            "jeu, pendant la partie (carnet commun, D12). Rangés par place."
        ),
    )
    regardaient: list[str] = Field(
        default_factory=list,
        description=(
            "Les pseudos de ceux qui regardaient sans place pendant la partie, dans "
            "l'ordre de leur arrivée. Vide pour une partie d'avant le 24 novembre 2026."
        ),
    )


class PageParties(BaseModel):
    parties: list[Partie]
    suivant: str | None = Field(description="Le curseur de la page suivante, ou rien à la fin.")


class Emplacement(BaseModel):
    """Une sauvegarde personnelle trouvée sur le disque: une carte mémoire."""

    titre: str = Field(
        description="Le titre du jeu, ou ce que le disque en dit quand il n'est pas relié."
    )
    console: ConsoleVue
    relie: bool = Field(description="Vrai quand le salon a reconnu le jeu dans le catalogue.")
    cle: str | None = Field(
        default=None,
        description=(
            "La clé du jeu de cette sauvegarde, son nom de fichier (ADR D23), pour "
            "qu'une page sache si « ma sauvegarde » existe pour le jeu qu'elle "
            "montre. Rien quand l'emplacement n'est pas relié au catalogue, ou "
            "quand le jeu y est connu sans clé (worker d'avant le 21 novembre 2026)."
        ),
    )
    sauvegarde: ResumeSauvegarde
