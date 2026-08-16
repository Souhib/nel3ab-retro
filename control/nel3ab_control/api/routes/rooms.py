"""The room, read and changed. No logic here: that is the controller's job."""

from fastapi import APIRouter

from nel3ab_control.api.schemas.room import Room
from nel3ab_control.dependencies import PeopleDep, RoomsDep

router = APIRouter(prefix="/api", tags=["room"])


@router.get("/room", response_model=Room)
async def read_room(rooms: RoomsDep, people: PeopleDep) -> Room:
    """What is loaded, what else could be, who claims which pad, and who is here."""
    return await rooms.describe(people)
