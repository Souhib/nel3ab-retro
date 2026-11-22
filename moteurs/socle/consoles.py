"""Les consoles externes, telles que le socle en a besoin pour lancer une salle.

POURQUOI une table ici, et pas une lecture de `consoles/consoles.json`. Le
manifeste change souvent pour la page et le salon. S'il était lu au lancement,
un manifeste faux arrêterait toutes les salles externes, alors que la règle de
l'ADR D22 veut l'inverse: « a bad manifest stops the gate instead of a room ».
Le worker suit déjà cette règle avec son enum compilé (`disc.rs`). Le socle la
suit de la même façon: cette table est écrite à la main, et
`moteurs/socle/test_consoles.py` la compare au manifeste dans les deux sens.

Le libellé sert au message de refus (« Invalid Xbox 360 title or save slot »):
c'est celui des adaptateurs d'aujourd'hui, et le banc doré le fige.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Console:
    code: str
    label: str
    #: Le dossier `moteurs/<engine>/` qui la sert.
    engine: str
    #: Le chemin que le worker lance (`form.script` du manifeste).
    script: str
    #: La variable qui remplace ce chemin pour une salle (`form.script_env`).
    script_env: str
    #: La variable qui nomme sa configuration (`form.config_env`).
    config_env: str
    players: int
    extensions: tuple[str, ...]


CONSOLES: dict[str, Console] = {
    console.code: console
    for console in (
        Console(
            "switch",
            "Switch",
            "ryubing",
            "docker/switch-room.py",
            "NEL3AB_SWITCH_ADAPTER",
            "NEL3AB_SWITCH_CONFIG",
            4,
            ("xci", "nsp"),
        ),
        Console(
            "switch2",
            "Switch 2",
            "eden",
            "docker/switch2-room.py",
            "NEL3AB_SWITCH2_ADAPTER",
            "NEL3AB_SWITCH2_CONFIG",
            1,
            ("nup",),
        ),
        Console(
            "x360",
            "Xbox 360",
            "xenia",
            "docker/xbox360-room.py",
            "NEL3AB_XBOX360_ADAPTER",
            "NEL3AB_XBOX360_CONFIG",
            4,
            ("iso",),
        ),
    )
}


def externe(code: str) -> Console:
    """La console externe de ce code, ou un refus qui le nomme."""
    try:
        return CONSOLES[code]
    except KeyError:
        raise ValueError(f"aucune console externe {code!r}") from None
