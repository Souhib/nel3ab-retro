"""Le nom du dossier personnel, recalculé par le salon, et celui du worker.

Les vecteurs viennent de `core/crates/emulator/person-key-vectors.json`, que
l'essai Rust `les_vecteurs_partages_avec_le_salon_tiennent` relit aussi. Le
premier vecteur et la paire en collision viennent des essais Rust d'avant
(`la_sauvegarde_d_une_personne_porte_son_nom`,
`distinct_logins_cannot_collide_when_their_readable_names_match`).
"""

import json
import re
from pathlib import Path

import pytest

from nel3ab_control import personnes

RACINE = Path(__file__).resolve().parents[2]
VECTEURS = json.loads(
    (RACINE / "core/crates/emulator/person-key-vectors.json").read_text(encoding="utf-8")
)["vecteurs"]


def test_le_fichier_de_vecteurs_n_est_pas_vide() -> None:
    """Une boucle sur une liste lue passe sans rien vérifier si la liste est vide."""
    assert len(VECTEURS) >= 10
    assert any(vecteur["dossier"] is None for vecteur in VECTEURS)
    assert any(vecteur["dossier"] is not None for vecteur in VECTEURS)


@pytest.mark.parametrize("vecteur", VECTEURS, ids=lambda vecteur: repr(vecteur["login"]))
def test_chaque_vecteur_donne_le_dossier_du_worker(vecteur: dict[str, str | None]) -> None:
    login = vecteur["login"]
    assert isinstance(login, str)
    assert personnes.dossier_personnel(login) == vecteur["dossier"]
    assert personnes.empreinte(login) == vecteur["empreinte"]


def test_le_premier_vecteur_est_celui_de_l_essai_rust_d_origine() -> None:
    """Recopié de `saves.rs`, ligne de `la_sauvegarde_d_une_personne_porte_son_nom`."""
    assert personnes.dossier_personnel("souhib@example.com") == (
        "joueur-souhib-example-com-b2bc049f29d07e45c04b3aa21b12a5614796b19f59b68528367019150f8f2e8c"
    )


def test_deux_adresses_au_meme_nom_lisible_ne_partagent_pas_un_dossier() -> None:
    """La paire en collision des essais Rust: même préfixe, deux empreintes."""
    plus = personnes.dossier_personnel("alex+test@example.com")
    tiret = personnes.dossier_personnel("alex-test@example.com")
    assert plus is not None
    assert tiret is not None
    assert plus.startswith("joueur-alex-test-example-com-")
    assert tiret.startswith("joueur-alex-test-example-com-")
    assert plus != tiret


def test_une_adresse_illisible_n_a_pas_de_dossier_et_un_nettoyage_qui_garde_l_unicode_diverge() -> (
    None
):
    """Deux pièges épinglés: l'Unicode et les séparateurs que Rust ne coupe pas.

    Le jumeau de chaque vecteur: un nettoyage par `str.isalnum` garderait le
    `é`, et une coupe par `str.strip` retirerait `\\x1f`. Les deux donneraient
    un autre dossier que le worker.
    """
    assert personnes.dossier_personnel("...") is None
    assert personnes.cle("élodie") == "lodie"
    naif = "".join(c.lower() if c.isalnum() else "-" for c in "élodie").strip("-")
    assert naif != personnes.cle("élodie")
    assert personnes.empreinte("\x1funit@example.com") != personnes.empreinte("unit@example.com")
    assert "\x1funit@example.com".strip() == "unit@example.com"


@pytest.mark.parametrize("adaptateur", ["docker/switch-room.py", "docker/switch-saves.py"])
def test_les_adaptateurs_switch_acceptent_chaque_dossier_calcule(adaptateur: str) -> None:
    """Les adaptateurs ne recalculent pas le nom: ils le vérifient par `SLOT`.

    Le motif est lu dans leur source, pas recopié ici: un motif resserré là-bas
    doit faire échouer cet essai, puisque le salon chercherait alors un dossier
    que l'adaptateur refuse de créer.
    """
    source = (RACINE / adaptateur).read_text(encoding="utf-8")
    trouve = re.search(r'^SLOT = r"(.+)"$', source, re.MULTILINE)
    assert trouve is not None, f"motif SLOT introuvable dans {adaptateur}"
    motif = trouve.group(1)
    dossiers = [vecteur["dossier"] for vecteur in VECTEURS if vecteur["dossier"]]
    assert dossiers
    for dossier in dossiers:
        assert re.fullmatch(motif, dossier), dossier
    # Le jumeau: le motif refuse bien un nom qui sortirait de son dossier.
    assert not re.fullmatch(motif, "joueur-../ailleurs")


def test_le_plus_long_dossier_tient_sous_la_limite_des_noms() -> None:
    """24 caractères lisibles, un tiret et 64 d'empreinte: 96 avec `joueur-`."""
    dossier = personnes.dossier_personnel("a" * 300 + "@example.com")
    assert dossier is not None
    assert len(dossier) == len("joueur-") + 24 + 1 + 64
