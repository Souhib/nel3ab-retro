"""The real lobby in a separate process, with its registry pinned before startup."""

from nel3ab_control import app as application
from nel3ab_control.api.controllers.salles import SalleInconnue
from nel3ab_control.api.controllers.salons import Salons
from nel3ab_control.settings import Settings


class PrivateSalons(Salons):
    def _reglages(self, numero: int) -> Settings:
        if numero != 1:
            raise SalleInconnue(numero)
        # The normal registry derives 8110/8111 from the room number and
        # discards worker_url/worker_control. That reached the installed address
        # in the first isolated driver on 2026-11-07, despite private settings.
        return self._settings


class NoServices:
    """No route in this fixture may start or stop an installed systemd unit."""

    def __init__(self, *args, **kwargs):
        pass

    def __getattr__(self, name):
        raise RuntimeError("Installed service lifecycle is disabled in this test lobby")


# Only this child interpreter is changed. Installed services import the normal
# application module in their own process. Inject before lifespan constructs
# the registry and before its background seat watcher starts.
application.Salons = PrivateSalons
application.SallesController = NoServices
settings = Settings()
if settings.worker_control in {f"127.0.0.1:{port}" for port in (8101, 8111, 8121, 8131)}:
    raise ValueError("An isolated lobby requires its private worker control address")
app = application.create_app(settings)
