"""Bobine posé dans les pages du salon."""

import pytest

from nel3ab_control.api.routes import bobine


def test_une_page_recoit_la_feuille_et_le_dessin_demande() -> None:
    page = "<style>/*__BOBINE__*/</style><div><!--BOBINE:loupe:loupe--></div>"
    garnie = bobine.garnir(page)
    assert "/*__BOBINE__*/" not in garnie
    assert "<!--BOBINE" not in garnie
    assert ".bob-led" in garnie
    assert 'data-pose="loupe"' in garnie
    assert "bob-verre" in garnie


def test_une_page_sans_marque_reste_identique() -> None:
    assert bobine.garnir("<p>rien</p>") == "<p>rien</p>"


@pytest.mark.parametrize(("tenue", "pose"), [("chapeau", "repos"), ("fiche", "vole")])
def test_une_marque_inconnue_leve_au_lieu_de_laisser_un_trou(tenue: str, pose: str) -> None:
    with pytest.raises(ValueError, match="inconnue"):
        bobine.garnir(f"<!--BOBINE:{tenue}:{pose}-->")


def test_chaque_tenue_declaree_a_son_dessin() -> None:
    for tenue in bobine.TENUES:
        assert bobine.dessin(tenue).startswith("<svg")
