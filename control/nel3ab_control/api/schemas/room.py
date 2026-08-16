"""What a room looks like on the wire."""

from pydantic import BaseModel, Field

from nel3ab_control.api.schemas.player import Person


class Game(BaseModel):
    """One game the room can run."""

    index: int = Field(
        description="Its position in the worker's library, which is how it is asked for."
    )
    name: str = Field(description="What to call it on screen.")


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
