"""Le registre des importeurs nommés depuis la page: ce qu'il garde, ce qu'il refuse."""

import json
from pathlib import Path

import pytest

from nel3ab_control.imports.droits import (
    Registre,
    RegistreIllisible,
    adresse,
    droit_de,
    peut_importer,
)
from nel3ab_control.settings import Settings


def reglages(importeurs: list[str]) -> Settings:
    return Settings(admin="souhib@example.com", importeurs=importeurs)


async def test_un_nom_donne_est_ecrit_en_600_et_relu_par_le_salon_suivant(tmp_path: Path) -> None:
    fichier = tmp_path / "etat" / "importeurs.json"
    registre = Registre(fichier)
    assert registre.nommes() == frozenset()
    assert not registre.illisible

    await registre.nommer("  Vincent@Example.com ")
    await registre.nommer("alice@github")

    assert (fichier.stat().st_mode & 0o777) == 0o600
    assert json.loads(fichier.read_text()) == {
        "importeurs": ["alice@github", "vincent@example.com"]
    }
    assert Registre(fichier).nommes() == {"alice@github", "vincent@example.com"}


async def test_un_nom_repris_disparait_du_fichier(tmp_path: Path) -> None:
    fichier = tmp_path / "importeurs.json"
    registre = Registre(fichier)
    await registre.nommer("vincent@example.com")
    await registre.nommer("alice@github")

    await registre.retirer("VINCENT@example.com")

    assert Registre(fichier).nommes() == {"alice@github"}


@pytest.mark.parametrize(
    "contenu",
    [
        "{ tronqué",
        '["vincent@example.com"]',
        '{"importeurs": "vincent@example.com"}',
        '{"importeurs": [3]}',
        '{"importeurs": ["pas une adresse"]}',
        '{"autre": []}',
    ],
)
async def test_un_fichier_illisible_ne_donne_rien_et_n_est_jamais_ecrase(
    tmp_path: Path, contenu: str
) -> None:
    fichier = tmp_path / "importeurs.json"
    fichier.write_text(contenu)
    registre = Registre(fichier)

    assert registre.illisible
    assert registre.nommes() == frozenset()
    with pytest.raises(RegistreIllisible):
        await registre.nommer("vincent@example.com")
    with pytest.raises(RegistreIllisible):
        await registre.retirer("vincent@example.com")
    assert fichier.read_text() == contenu, "le fichier illisible reste tel quel"


async def test_un_fichier_vide_de_noms_est_lisible(tmp_path: Path) -> None:
    """Le jumeau: une liste vide n'est pas une liste illisible."""
    fichier = tmp_path / "importeurs.json"
    fichier.write_text('{"importeurs": []}')

    registre = Registre(fichier)

    assert not registre.illisible
    await registre.nommer("vincent@example.com")
    assert registre.nommes() == {"vincent@example.com"}


async def test_une_ecriture_ratee_laisse_le_droit_tel_qu_il_etait(tmp_path: Path) -> None:
    """Le disque d'abord, la mémoire ensuite: un échec ne donne rien en douce."""
    ferme = tmp_path / "en-lecture-seule"
    ferme.mkdir()
    registre = Registre(ferme / "importeurs.json")
    assert not registre.illisible, "un fichier absent se lit: personne"
    ferme.chmod(0o500)
    try:
        with pytest.raises(OSError):
            await registre.nommer("vincent@example.com")
    finally:
        ferme.chmod(0o700)

    assert registre.nommes() == frozenset()
    assert not (ferme / "importeurs.json").exists()


@pytest.mark.parametrize(
    ("texte", "attendu"),
    [
        (" Vincent@Example.com ", "vincent@example.com"),
        ("alice@github", "alice@github"),
        ("bob@passkey", "bob@passkey"),
    ],
)
def test_une_adresse_de_tailscale_est_acceptee_et_normalisee(texte: str, attendu: str) -> None:
    assert adresse(texte) == attendu


@pytest.mark.parametrize(
    "texte",
    [
        "",
        "   ",
        "sans-arobase",
        "a@b@c",
        "un nom@example.com",
        "a/b@example.com",
        "a\x00@x",
        "@x",
        "a@",
    ],
)
def test_ce_qui_n_est_pas_une_adresse_est_refuse(texte: str) -> None:
    with pytest.raises(ValueError):
        adresse(texte)


def test_une_adresse_trop_longue_est_refusee() -> None:
    with pytest.raises(ValueError):
        adresse("a" * 129 + "@example.com")


async def test_le_droit_dit_d_ou_il_vient(tmp_path: Path) -> None:
    registre = Registre(tmp_path / "importeurs.json")
    await registre.nommer("alice@github")
    settings = reglages(importeurs=["Config@Example.com"])

    assert droit_de("SOUHIB@example.com", settings, registre) == "administrateur"
    assert droit_de("config@example.com", settings, registre) == "configuration"
    assert droit_de("alice@github", settings, registre) == "nomme"
    assert droit_de("vincent@example.com", settings, registre) == "aucun"
    assert droit_de(None, settings, registre) == "aucun"
    assert droit_de("  ", settings, registre) == "aucun"
    assert peut_importer("alice@github", settings, registre)
    assert not peut_importer("alice@github", settings), "sans registre, pas de nommés"
