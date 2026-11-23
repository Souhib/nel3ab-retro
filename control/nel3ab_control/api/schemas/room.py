"""What a room looks like on the wire."""

from typing import Literal

from pydantic import BaseModel, Field

from nel3ab_control.api.controllers.preparation import Preparation
from nel3ab_control.api.schemas.player import Person
from nel3ab_control.api.schemas.salle import DernierJeu
from nel3ab_control.consoles import CONSOLES


class GameGuide(BaseModel):
    players: int | None = Field(default=None, ge=1, le=8)
    multiplayer: str = ""
    devices: list[str] = Field(default_factory=list)
    checked: str | None = None
    allowed: list[int]
    source: str
    note: str
    actions: dict[str, dict[str, str]]


class Game(BaseModel):
    """One game the room can run."""

    guide: GameGuide | None = None

    index: int = Field(
        description=(
            "Its position in the worker's library. Valid only for the library it "
            "came with: a file that sorts earlier moves every position after it."
        )
    )
    key: str | None = Field(
        default=None,
        description=(
            "La clé du jeu: son nom de fichier, ce qu'une page envoie pour le lancer "
            "(ADR D23). Elle désigne encore ce jeu quand la liste a changé. Nulle "
            "pour un worker d'avant le 21 novembre 2026, qui ne la publiait pas."
        ),
    )
    name: str = Field(description="What to call it on screen.")
    maker: str | None = Field(
        default=None,
        description=(
            "Qui l'a fait, tel que le disque le dit lui-même. Nul quand le "
            "disque n'a pas donné sa jaquette."
        ),
    )
    about: str | None = Field(
        default=None,
        description=(
            "La phrase que l'éditeur a écrite sur le disque. Peut contenir un "
            "retour à la ligne: ces textes ont été mis en page sur deux lignes."
        ),
    )
    console: str = Field(
        default="?",
        description=(
            "Quelle console ce disque demande, lue sur le disque ou sur sa fiche: "
            + ", ".join(f"« {one.code} »" for one in CONSOLES.consoles)
            + " (consoles/consoles.json), ou « ? » quand le disque n'a pas répondu. "
            "La page s'en sert pour ne pas proposer un choix qui ne déciderait rien: "
            "un jeu Wii n'a pas de carte mémoire, donc pas deux emplacements de "
            "sauvegarde. « ? » n'est pas « gc »: proposer un choix qui ne fait rien "
            "est pire que ne pas le proposer."
        ),
    )
    art: bool = Field(
        default=False,
        description=(
            "Vrai quand le worker sert une image pour ce jeu, à /art/{index}.png. "
            "Un booléen plutôt qu'une adresse: le chemin appartient au worker, "
            "et le recopier ici en ferait une deuxième vérité à tenir à jour."
        ),
    )


class Seat(BaseModel):
    """One of the room's pads, and who claims it."""

    port: int = Field(ge=1, le=4)
    player: str | None = Field(
        default=None, description="The name of whoever claims it, if anybody."
    )
    held: bool | None = Field(
        default=None, description="Occupation lue chez le worker, ou inconnue sur un ancien worker."
    )
    claim: str | None = Field(
        default=None,
        description="Repère de l'attribution actuelle. Ce n'est ni un nom ni un secret.",
    )
    premiere: bool | None = Field(
        default=None,
        description=(
            "Vrai quand la personne qui tient cette prise n'avait jamais tenu de "
            "place dans cette salle, d'après le journal des parties. Gardé tant "
            "qu'elle tient la prise. Rien quand le salon ne sait pas: sans "
            "identité, page de banc ou journal illisible. La page retombe alors "
            "sur sa propre mémoire."
        ),
    )


class LancementVu(BaseModel):
    """Qui a lancé le jeu qui tourne, et dans quelle sauvegarde il écrit."""

    par: Person = Field(
        description=(
            "Qui a lancé: son pseudo, et son repère quand il a une identité. "
            "Jamais son adresse ni son empreinte. `moi` est vrai pour sa page."
        )
    )
    sauvegarde: Literal["lanceur", "commune", "neuve", "inconnue"] = Field(
        description=(
            "« lanceur »: la sauvegarde personnelle de qui a lancé; « commune »: "
            "tout débloqué, à tout le monde; « neuve »: la partie neuve partagée "
            "(lancement sans identité); « inconnue »: lancé par un chemin qui ne "
            "dit pas la sauvegarde."
        )
    )


class Room(BaseModel):
    """The room, as a page needs to render it."""

    preparation: Preparation | None = None
    name: str
    game: Game | None = Field(default=None, description="What is loaded right now.")
    library: list[Game]
    dernier_jeu: DernierJeu | None = Field(
        default=None,
        description=(
            "Le dernier jeu que cette salle a lancé, lu dans son dossier "
            "(`chosen-rom`), titré par la bibliothèque du worker. Il reste le "
            "même quand la salle revient sur son menu. Rien quand elle n'a "
            "jamais lancé de jeu, ou quand ce jeu n'est plus dans sa bibliothèque."
        ),
    )
    seats: list[Seat]
    lancement: LancementVu | None = Field(
        default=None,
        description=(
            "Qui a lancé le jeu qui tourne et sur quelle sauvegarde, pour une page "
            "qui arrive ou recharge pendant la partie. Rien quand le salon ne l'a "
            "pas vu (le jeu tournait avant son redémarrage, ou a changé ensuite "
            "sans passer par lui): la page dit alors « sauvegarde inconnue »."
        ),
    )
    owner: Person | None = Field(
        default=None,
        description=(
            "Le chef choisi après une reprise, sinon le premier arrivé encore connecté. Nul quand "
            "personne n'a d'identité, et la salle retombe alors sur sa règle "
            "d'avant, où tenir une manette suffit."
        ),
    )
    people: list[Person] = Field(
        default_factory=list,
        description=(
            "Tout le monde dans la salle, spectateurs compris. Les places ne "
            "disent que ceux qui jouent, et une salle où quelqu'un regarde sans "
            "manette avait l'air vide."
        ),
    )
    ask_lasts: float = Field(
        default=10.0,
        description=(
            "Combien de secondes une demande de manette attend une réponse. "
            "Publié pour que le compte à rebours de la page soit le vrai, et "
            "non un nombre recopié qui finirait par ne plus correspondre."
        ),
    )
    media_url: str = Field(
        description=(
            "Where the browser opens its own video, sound and pad sockets. Empty "
            "means the page's own origin."
        )
    )

    def vue_par(self, repere: str | None) -> "Room":
        """La même salle, telle que la voit la personne de ce repère.

        Seul `moi` change d'une page à l'autre. Le reste est décrit une fois,
        puis recopié: décrire la salle pour chaque page redemanderait la
        bibliothèque au worker autant de fois qu'il y a de pages.
        """

        def marque(person: Person) -> Person:
            return person.model_copy(update={"moi": repere is not None and person.id == repere})

        return self.model_copy(
            update={
                "owner": marque(self.owner) if self.owner else None,
                "people": [marque(person) for person in self.people],
                "lancement": self.lancement.model_copy(update={"par": marque(self.lancement.par)})
                if self.lancement
                else None,
            }
        )
