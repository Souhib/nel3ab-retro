"""Les racines des sauvegardes d'adaptateur, dérivées du manifeste et non recopiées.

Le carnet de jeu (`tests/api/test_profil.py`) prouve le parcours sur de vrais
dossiers. Ici, le lien entre les trois listes qui doivent s'accorder: les
consoles externes du manifeste, le sous-arbre de leur partie (`PARTIE`) et le
réglage qui nomme leur configuration. La Xbox 360 manquait aux deux dernières
jusqu'au 22 novembre 2026, et rien ne le disait.
"""

import dataclasses
import json
from pathlib import Path

import pytest

from nel3ab_control.consoles import CONSOLES
from nel3ab_control.sauvegardes import PARTIE, racines
from nel3ab_control.settings import Settings

EXTERNES = [one for one in CONSOLES.consoles if one.form == "external"]


def test_chaque_console_d_adaptateur_a_sa_partie_et_son_reglage(settings: Settings) -> None:
    assert [one.code for one in EXTERNES] == ["switch", "switch2", "x360"]
    assert set(PARTIE) == {"dolphin"} | {one.code for one in EXTERNES}
    assert set(racines(settings)) == {one.code for one in EXTERNES}
    assert settings.configuration_adaptateur("NEL3AB_XBOX360_CONFIG") == settings.xbox360_config


def test_une_console_ajoutee_au_manifeste_sans_son_reglage_se_voit(settings: Settings) -> None:
    """Le jumeau: une console de plus, dont le salon n'a pas la configuration."""
    x360 = CONSOLES.console("x360")
    assert x360 is not None
    autre = dataclasses.replace(x360, code="fake", config_env="NEL3AB_FAKE_CONFIG")
    manifeste = dataclasses.replace(CONSOLES, consoles=(*CONSOLES.consoles, autre))

    with pytest.raises(LookupError, match="NEL3AB_FAKE_CONFIG"):
        racines(settings, manifeste)


@pytest.mark.parametrize(
    "variable",
    [
        # Un réglage qui n'est pas une configuration, une variable sans le
        # préfixe du salon, et une configuration que le salon ne connaît pas.
        "NEL3AB_STATE_FILE",
        "SWITCH_CONFIG",
        "NEL3AB_ABSENT_CONFIG",
    ],
)
def test_seul_le_reglage_d_une_configuration_repond(settings: Settings, variable: str) -> None:
    with pytest.raises(LookupError):
        settings.configuration_adaptateur(variable)


def test_la_racine_vient_de_la_configuration_et_seulement_d_un_chemin_absolu(
    settings: Settings, tmp_path: Path
) -> None:
    settings.xbox360_config.write_text(json.dumps({"state": str(tmp_path / "etat")}))
    settings.switch_config.write_text(json.dumps({"state": "relatif/etat"}))

    trouvees = racines(settings)

    assert trouvees["x360"] == tmp_path / "etat"
    # Les jumeaux: un chemin relatif, et une configuration absente.
    assert trouvees["switch"] is None
    assert trouvees["switch2"] is None
