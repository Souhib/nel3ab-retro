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
    bindings_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/bindings.json",
        description=(
            "Où sont gardés les réglages de manette de chacun. Sous la personne "
            "et pas sous la machine: une manette apprise au salon n'a aucune "
            "raison d'être réapprise au bureau."
        ),
    )
    room_bindings_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/room-bindings.json",
        description="La configuration de RÉFÉRENCE de la salle, celle que tout le monde reçoit.",
    )
    admin: str = Field(
        default="",
        description=(
            "L'adresse de la seule personne qui peut publier la référence de la salle. "
            "Vide veut dire personne, et une salle sans référence se comporte comme avant."
        ),
    )
    journal_dir: Path = Field(
        default=Path.home() / ".local/state/nel3ab/sessions",
        description=(
            "Où les séances sont écrites, un fichier JSONL par jour. À côté des "
            "pseudos et pour la même raison: hors du dépôt, et hors de /tmp, où "
            "un redémarrage de la machine effacerait la trace de la soirée "
            "qu'on veut justement relire le lendemain."
        ),
    )
    journal_days: int = Field(
        default=2,
        description=(
            "Combien de jours de séances on garde. Deux: le besoin est de "
            "regarder au plus tard le lendemain d'une plainte, et un journal "
            "qu'on ne relit pas est un fichier qui grossit."
        ),
    )
    journal_zone: str = Field(
        default="Europe/Paris",
        description=(
            "Sur quelle horloge le journal écrit ses heures. Celle des joueurs "
            "et pas celle de la machine, qui tourne en UTC: une plainte parle "
            "de « 16 h 43 », et un journal qui répond 14:43 ne se relit pas."
        ),
    )
    worker_control: str = Field(
        default="127.0.0.1:8101",
        description=(
            "Où dire au worker qui décide du jeu. Un autre port que celui des "
            "pages, et que le proxy ne relaie pas: c'est ce qui empêche un "
            "navigateur de se déclarer propriétaire."
        ),
    )
