"""Who is playing, which here is a name and nothing else."""

from pydantic import BaseModel, Field

NAME_MAX = 24


class Identity(BaseModel):
    """A person, as this service knows them.

    There is no account and no password: rooms are private and shared with people
    already on the network. The name exists so a seat can say "Souhib" rather than
    "player 2" (ADR D12).
    """

    name: str = Field(min_length=1, max_length=NAME_MAX)


class Session(Identity):
    """An identity with the token the page keeps."""

    id: str = Field(description="Opaque, per browser, so a reconnection is recognised.")


class Me(BaseModel):
    """Qui le service croit avoir en face.

    `login` vient du proxy et n'est pas modifiable; `name` est choisi et l'est.
    Un `login` nul veut dire « aucun proxy devant », donc aucune identité: la
    page retombe alors sur un prénom gardé dans le navigateur.
    """

    login: str | None = Field(
        default=None, description="L'adresse que Tailscale garantit, ou rien."
    )
    name: str = Field(description="Le pseudo, choisi et modifiable.")
    display: str = Field(
        default="", description="Le nom que le fournisseur d'identité affiche, pour information."
    )


class Person(BaseModel):
    """Quelqu'un dans la salle, qu'il tienne une manette ou non."""

    name: str
    login: str | None = None
    seat: int | None = Field(default=None, description="La manette qu'il tient, s'il en tient une.")
