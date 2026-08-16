"""Lobby sockets."""

# The handlers import is a SIDE EFFECT: they register themselves against `sio`,
# so they must be imported after it exists and before the app is served. Ruff
# sorts these two lines together, which is why the ordering is not load-bearing.
from nel3ab_control.api.ws import handlers  # noqa: F401
from nel3ab_control.api.ws.server import sio, socketio_app

__all__ = ["sio", "socketio_app"]
