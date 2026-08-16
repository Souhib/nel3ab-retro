"""The room, read and changed. No logic here: that is the controller's job."""

from fastapi import APIRouter, status

from nel3ab_control.api.schemas.player import Identity
from nel3ab_control.api.schemas.room import Room
from nel3ab_control.dependencies import PeopleDep, RoomsDep

router = APIRouter(prefix="/api", tags=["room"])


@router.get("/room", response_model=Room)
async def read_room(rooms: RoomsDep, people: PeopleDep) -> Room:
    """What is loaded, what else could be, who claims which pad, and who is here."""
    return await rooms.describe(people)


@router.post("/room/seats/{port}", status_code=status.HTTP_204_NO_CONTENT)
async def claim_seat(port: int, claim: Identity, rooms: RoomsDep) -> None:
    """Records that a player claims a pad.

    The worker decides who really holds it; this is the name to show beside it.

    The name travels in the BODY, not in a query string. It is not a secret, but
    a URL is written to every log between a browser and here, and a name is still
    a person. The lobby socket already passes it that way, and an endpoint that
    disagreed with the socket beside it would be a rule nobody could state.
    """
    rooms.claim(port, claim.name)
