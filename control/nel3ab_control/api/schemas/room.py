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
    people: list[Person] = Field(
        default_factory=list,
        description=(
            "Tout le monde dans la salle, spectateurs compris. Les places ne "
            "disent que ceux qui jouent, et une salle où quelqu'un regarde sans "
            "manette avait l'air vide."
        ),
    )
    media_url: str = Field(
        description=(
            "Where the browser opens its own video, sound and pad sockets. Empty "
            "means the page's own origin."
        )
    )
