"""What a room looks like on the wire."""

from pydantic import BaseModel, Field

from nel3ab_control.api.schemas.player import Person


class Game(BaseModel):
    """One game the room can run."""

    index: int = Field(
        description="Its position in the worker's library, which is how it is asked for."
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
            "Quelle console ce disque demande, lue sur le disque: « gc », « wii », "
            "ou « ? » quand le disque n'a pas répondu. La page s'en sert pour ne "
            "pas proposer un choix qui ne déciderait rien: un jeu Wii n'a pas de "
            "carte mémoire, donc pas deux emplacements de sauvegarde. « ? » n'est "
            "pas « gc »: proposer un choix qui ne fait rien est pire que ne pas "
            "le proposer."
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


class Room(BaseModel):
    """The room, as a page needs to render it."""

    name: str
    game: Game | None = Field(default=None, description="What is loaded right now.")
    library: list[Game]
    seats: list[Seat]
    owner: Person | None = Field(
        default=None,
        description=(
            "Qui décide du jeu: le premier arrivé encore présent. Nul quand "
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
