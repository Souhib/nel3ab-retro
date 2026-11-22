"""La forme du titre de chaque console, et les exemples que le worker relit aussi.

Les vecteurs viennent de `consoles/titres-vecteurs.json`. L'essai Rust
`the_title_vectors_shared_with_the_salon_hold` (`core/crates/emulator/src/disc.rs`)
les passe à `Console::valid_title`, celui-ci à `consoles.titre_valide`. La règle
est écrite une fois de chaque côté: la changer d'un seul côté fait échouer
l'essai de ce côté.
"""

import json
from pathlib import Path

import pytest

from nel3ab_control import consoles
from nel3ab_control.consoles import CONSOLES, FORMES_TITRE, MANIFESTE, titre_valide

VECTEURS_FICHIER = MANIFESTE.with_name("titres-vecteurs.json")


def lire_vecteurs() -> list[dict]:
    brut = json.loads(VECTEURS_FICHIER.read_text(encoding="utf-8"))
    assert brut["version"] == 1
    return brut["vecteurs"]


VECTEURS = lire_vecteurs()


def desaccords(vecteurs: list[dict]) -> list[str]:
    """Chaque vecteur que la règle du salon ne suit pas, nommé.

    Une liste plutôt qu'un `assert` par vecteur: le jumeau négatif doit pouvoir
    exiger QUEL vecteur a été vu, et pas seulement qu'un essai a échoué.
    """
    trouves = []
    for vecteur in vecteurs:
        console, titre, valide = vecteur["console"], vecteur["titre"], vecteur["valide"]
        dit = titre_valide(console, titre)
        if dit != valide:
            trouves.append(f"{console} {titre!r}: vecteur {valide}, salon {dit}")
    return trouves


def test_le_fichier_couvre_chaque_console_dans_les_deux_sens() -> None:
    """Une boucle sur une liste lue passe sans rien vérifier si la liste est vide.

    Chaque console du manifeste, et « ? », a au moins un vecteur. Chaque console
    qui porte un titre en a un accepté, un refusé, et un refusé qui est le titre
    accepté d'une AUTRE console: le jumeau qui a manqué le 21 novembre 2026.
    """
    assert len(VECTEURS) >= 20
    codes = {vecteur["console"] for vecteur in VECTEURS}
    assert codes == {one.code for one in CONSOLES.consoles} | {"?"}
    for code in FORMES_TITRE:
        acceptes = {v["titre"] for v in VECTEURS if v["console"] == code and v["valide"]}
        refuses = {v["titre"] for v in VECTEURS if v["console"] == code and not v["valide"]}
        d_ailleurs = {v["titre"] for v in VECTEURS if v["console"] != code and v["valide"]}
        assert acceptes, code
        assert refuses & d_ailleurs, f"{code}: aucun titre d'une autre console refusé"


@pytest.mark.parametrize(
    "vecteur", VECTEURS, ids=lambda vecteur: f"{vecteur['console']}-{vecteur['titre']!r}"
)
def test_chaque_vecteur_donne_la_reponse_du_worker(vecteur: dict) -> None:
    assert titre_valide(vecteur["console"], vecteur["titre"]) is vecteur["valide"]


def test_les_vecteurs_et_la_regle_du_salon_s_accordent() -> None:
    assert desaccords(VECTEURS) == []


def test_un_vecteur_change_d_un_seul_cote_est_nomme() -> None:
    """Le jumeau: un contrôle qui ne verrait rien passerait aussi l'essai du dessus."""
    inverse = [dict(vecteur) for vecteur in VECTEURS]
    sonic = next(v for v in inverse if (v["console"], v["titre"]) == ("x360", "534507D6"))
    sonic["valide"] = False
    assert desaccords(inverse) == ["x360 '534507D6': vecteur False, salon True"]


def test_une_forme_differente_d_un_seul_cote_est_vue(monkeypatch: pytest.MonkeyPatch) -> None:
    """La règle recopiée en 16 chiffres, celle d'avant le 22 novembre 2026, échoue ici."""
    monkeypatch.setitem(consoles.FORMES_TITRE, "x360", consoles.FormeTitre(16))
    vus = desaccords(VECTEURS)
    assert "x360 '534507D6': vecteur True, salon False" in vus
    assert "x360 '0100BDE00862A000': vecteur False, salon True" in vus


def test_seule_une_console_inscrite_par_fiche_porte_un_titre() -> None:
    """La même règle que le worker: `emulator::switch::registered` exige un titre
    valide, et le disque d'une console de Dolphin répond lui-même."""
    assert set(FORMES_TITRE) == {
        one.code for one in CONSOLES.consoles if one.registration == "sidecar"
    }
    # Le jumeau: une console sans fiche n'a pas de forme.
    assert consoles.forme_titre("gc") is None
    assert consoles.forme_titre("?") is None


@pytest.mark.parametrize("titre", [None, 0x534507D6, b"534507d6", ["534507d6"]])
def test_un_titre_qui_n_est_pas_un_texte_est_refuse(titre: object) -> None:
    assert not titre_valide("x360", titre)


@pytest.mark.parametrize(
    ("titre", "attendu"),
    [
        ("534507d6", True),
        ("534507D6", False),
        # Que des chiffres: `"00000000".islower()` est faux, et le titre est bon.
        ("00000000", True),
    ],
)
def test_les_minuscules_du_worker_se_demandent_a_part(titre: str, attendu: bool) -> None:
    assert titre_valide("x360", titre, minuscules=True) is attendu
    assert titre_valide("x360", titre), "sans la demande, la casse est acceptée"


def test_le_fichier_est_lu_par_l_essai_rust_aussi() -> None:
    """Sans cette lecture, le fichier ne lierait plus les deux langages."""
    disc = Path(__file__).resolve().parents[2] / "core/crates/emulator/src/disc.rs"
    assert 'include_str!("../../../../consoles/titres-vecteurs.json")' in disc.read_text(
        encoding="utf-8"
    )
