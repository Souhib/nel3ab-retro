"""Errors this service raises on purpose, as opposed to those it suffers."""

from fastapi import HTTPException, status


class WorkerUnreachable(HTTPException):
    """The worker is not answering, so the room cannot be described."""

    def __init__(self, url: str) -> None:
        super().__init__(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"the worker at {url} is not answering",
        )


class NoSuchSeat(HTTPException):
    """Ce numéro n'est pas une place de cette salle.

    Distinct de `SeatTaken`: là-bas la place existe et quelqu'un l'occupe, ici
    elle n'a jamais existé. Les confondre dirait à quelqu'un qu'il doit attendre
    une manette que la salle n'a pas.
    """

    def __init__(self, port: int) -> None:
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"la place {port} n'existe pas dans cette salle",
        )


class SeatTaken(HTTPException):
    """Somebody else claims that pad."""

    def __init__(self, port: int) -> None:
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"pad {port} is already claimed",
        )
