"""La relecture: la machine et les pages sur la même tranche de dix secondes."""

import json
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from nel3ab_control.boite_noire.lire import captures, charger, tranches

PARIS = timezone(timedelta(hours=2))
T0 = datetime(2026, 9, 14, 0, 33, 0, tzinfo=PARIS)


def _releve(secondes: float, fil_pct: float, blocs: int | None = None) -> dict:
    ligne = {
        "quand": (T0 + timedelta(seconds=secondes)).isoformat(),
        "quoi": "relevé",
        "moteurs": [
            {
                "pid": 1,
                "cpu_pct": 190.0,
                "fils": [{"nom": "GUI.RenderLoop", "cpu_pct": fil_pct}],
                "objets_gpu": {"objets": 11273},
            }
        ],
        "gpu": {"occupe_pct": 40, "horloge": "700Mhz"},
        "capteurs": {"k10temp/Tctl": 81.2},
        "cpu": {"mhz": [3840, 3860]},
        "boite_noire": {"cpu_pct": 1.0},
    }
    if blocs is not None:
        ligne["allocateur_vram"] = {"blocs_libres": blocs}
    return ligne


def _page(secondes: float, cadence: float, visite: str, banc: bool = False) -> dict:
    return {
        "quand": (T0 + timedelta(seconds=secondes)).isoformat(),
        "quoi": "mesures",
        "visite": visite,
        "banc": banc,
        "vu": {"jeuHz": cadence},
    }


def test_la_machine_et_les_pages_se_rangent_sur_la_meme_tranche() -> None:
    releves = [_releve(1, 88.0), _releve(3, 93.0, blocs=6457)]
    pages = [_page(2, 39, "a"), _page(4, 43, "b"), _page(6, 41, "c"), _page(7, 12, "d", banc=True)]

    (tranche,) = tranches(releves, pages)

    assert tranche["quand"] == T0
    assert tranche["pages"] == {"mediane": 41, "min": 39, "pages": 3}
    assert tranche["fil"] == {"nom": "GUI.RenderLoop", "cpu_pct": 93.0}
    assert tranche["blocs"] == 6457
    assert tranche["objets"] == 11273
    assert tranche["tctl"] == 81.2
    assert tranche["mhz"] == 3850.0
    assert tranche["horloge"] == "700Mhz"
    assert tranche["boite_noire_pct"] == 1.0


def test_deux_tranches_restent_separees_et_la_plage_filtre() -> None:
    releves = [_releve(1, 50.0), _releve(12, 60.0), _releve(25, 70.0)]

    toutes = tranches(releves, [])
    assert [t["quand"].second for t in toutes] == [0, 10, 20]

    plage = tranches(releves, [], debut=time(0, 33, 10), fin=time(0, 33, 15))
    assert [t["fil"]["cpu_pct"] for t in plage] == [60.0]


def test_une_page_sans_cadence_ou_hors_jeu_ne_fait_pas_de_tranche() -> None:
    pages = [
        _page(1, 0, "a"),
        {**_page(2, 40, "b"), "quoi": "arrivée"},
        {**_page(3, 40, "c"), "quand": "2026-09-14T00:33:03"},
    ]
    assert tranches([], pages) == []


def test_le_chargement_saute_les_lignes_cassees(tmp_path: Path) -> None:
    fichier = tmp_path / "2026-09-14.jsonl"
    fichier.write_text(
        json.dumps(_releve(1, 50.0))
        + "\npas du json\n[1]\n"
        + json.dumps({"quoi": "sans heure"})
        + "\n"
    )
    assert [ligne["quoi"] for ligne in charger(fichier)] == ["relevé"]
    assert charger(tmp_path / "absent.jsonl") == []


def test_les_captures_du_jour_se_listent_meme_incompletes(tmp_path: Path) -> None:
    bonne = tmp_path / "2026-09-14T00-35-00-salle1-chute"
    bonne.mkdir()
    (bonne / "capture.json").write_text(json.dumps({"raison": "chute", "details": {"mediane": 39}}))
    (tmp_path / "2026-09-14T00-45-00-periodique").mkdir()
    (tmp_path / "2026-09-13T23-00-00-periodique").mkdir()

    trouvees = captures(tmp_path, date(2026, 9, 14))

    assert [capture["dossier"] for capture in trouvees] == [
        "2026-09-14T00-35-00-salle1-chute",
        "2026-09-14T00-45-00-periodique",
    ]
    assert trouvees[0]["raison"] == "chute"
    assert trouvees[1]["incomplete"] is True
    assert captures(tmp_path / "absent", date(2026, 9, 14)) == []
