"""The room, read and changed. No logic here: that is the controller's job."""

from fastapi import APIRouter, status

from nel3ab_control.api.schemas.room import Room
from nel3ab_control.dependencies import RoomsDep

router = APIRouter(prefix="/api", tags=["room"])


@router.get("/room", response_model=Room)
async def read_room(rooms: RoomsDep) -> Room:
    """What is loaded, what else could be, and who claims which pad."""
    return await rooms.describe()


@router.post("/room/seats/{port}", status_code=status.HTTP_204_NO_CONTENT)
async def claim_seat(port: int, player: str, rooms: RoomsDep) -> None:
    """Records that a player claims a pad.

    The worker decides who really holds it; this is the name to show beside it.
    """
    rooms.claim(port, player)
