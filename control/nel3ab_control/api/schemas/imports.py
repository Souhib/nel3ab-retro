"""Ce que la page de dépôt envoie, et ce qu'elle reçoit."""

from typing import Literal

from pydantic import BaseModel, Field

#: La taille la plus grande d'un morceau. Caddy compte ses limites en MB
#: DÉCIMAUX: 65MB font 65 000 000 octets, moins qu'un morceau de 64 Mio
#: (67 108 864). 32 Mio restent bien en dessous de toute limite qu'on poserait
#: devant, et laissent un morceau passer en moins de 15 s à 20 Mbit/s.
MORCEAU_MAX = 32 * 1024 * 1024


class DemandeEnvoi(BaseModel):
    """Un envoi qu'on commence, ou qu'on reprend."""

    nom: str = Field(
        min_length=1,
        max_length=255,
        description="Le nom du fichier chez celui qui l'envoie. Affiché, jamais un chemin.",
    )
    taille: int = Field(gt=0, description="La taille exacte du fichier, en octets.")
    empreinte_rapide: str = Field(
        pattern=r"^[0-9a-f]{64}$",
        description="SHA-256 des 4 premiers Mio, des 4 derniers et de la taille.",
    )


class ElementVu(BaseModel):
    """Un fichier traité, tel que la page le montre."""

    nom: str
    taille: int
    console: str | None
    console_libelle: str
    format: str
    titre: str
    identifiant: str
    drapeaux: list[str]
    preuve: str
    details: dict[str, str]
    etat: str
    libelle: str
    message: str
    destination: str


class EnvoiVu(BaseModel):
    """Un envoi, tel que la page le suit."""

    id: str
    nom: str
    taille: int
    decalage: int
    etat: Literal["envoi", "verification", "termine", "erreur"]
    libelle: str
    message: str
    elements: list[ElementVu]
    morceau_max: int = MORCEAU_MAX


class Droits(BaseModel):
    """Ce que la page d'accueil a besoin de savoir pour montrer le lien."""

    peut_importer: bool
    #: Vrai pour l'administrateur seul: la page de dépôt lui montre alors la
    #: liste des personnes. L'API la refuse à tout autre, ce drapeau ne garde rien.
    administrateur: bool = False


class PersonneVue(BaseModel):
    """Une personne qui a accès au salon, et son droit de déposer."""

    login: str
    #: Le nom que donne le fournisseur d'identité, vide s'il n'en donne pas.
    nom: str
    #: Le pseudo choisi dans le salon, absent pour qui n'est jamais venu.
    pseudo: str | None
    #: Où on l'a vue: « tailnet » (tailscaled la connaît), « salon » (elle a un pseudo).
    sources: list[Literal["tailnet", "salon"]]
    appareils: int
    en_ligne: bool
    #: Vrai quand elle n'arrive que par un partage de la machine.
    partage: bool
    droit: Literal["administrateur", "configuration", "nomme", "aucun"]


class Personnes(BaseModel):
    """La liste de l'administrateur."""

    personnes: list[PersonneVue]
    #: Faux quand tailscaled n'a pas répondu: la liste ne montre alors que les
    #: personnes déjà venues et les droits, et la page le dit.
    tailnet: bool
    #: Faux quand le fichier des importeurs ne se lit pas: rien ne s'y écrit.
    registre_lisible: bool
