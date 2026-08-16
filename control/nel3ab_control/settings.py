"""What the control plane needs to know, and where it comes from."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration, from the environment or a `.env` beside the service.

    Every value has a default that works on the machine this runs on, because a
    control plane that will not start without a file is one more thing between a
    person and their game.
    """

    model_config = SettingsConfigDict(env_prefix="NEL3AB_", env_file=".env", extra="ignore")

    room_name: str = Field(default="Salon", description="What the single room is called.")
    worker_url: str = Field(
        default="http://127.0.0.1:8100",
        description="Where the worker serves its library and its media sockets.",
    )
    worker_public_url: str = Field(
        default="",
        description=(
            "What a BROWSER should use to reach the worker. Empty means the same "
            "origin as the page, which is the case behind the Tailscale proxy."
        ),
    )
    state_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/people.json",
        description=(
            "Où les pseudos sont gardés. Hors du dépôt et hors de /tmp: un pseudo "
            "doit survivre à un redémarrage du service ET de la machine, "
            "contrairement aux places, qui meurent avec le processus."
        ),
    )
