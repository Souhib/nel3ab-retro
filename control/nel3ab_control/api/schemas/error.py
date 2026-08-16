"""Errors this service raises on purpose, as opposed to those it suffers."""

from fastapi import HTTPException, status


class WorkerUnreachable(HTTPException):
    """The worker is not answering, so the room cannot be described."""

    def __init__(self, url: str) -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"the worker at {url} is not answering",
        )


class SeatTaken(HTTPException):
    """Somebody else claims that pad."""

    def __init__(self, port: int) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"pad {port} is already claimed",
        )
