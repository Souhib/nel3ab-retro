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
