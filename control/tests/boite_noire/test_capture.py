"""Une capture, avec un faux lanceur: les commandes et les fichiers, sans `perf` ni GPU."""

import json
import threading
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nel3ab_control.boite_noire.capture import Capteur, lignes_recentes
from nel3ab_control.boite_noire.releve import Racines

PARIS = timezone(timedelta(hours=2))
QUAND = datetime(2026, 9, 14, 0, 36, 28, tzinfo=PARIS)

RYUJINX = {
    "pid": 4242,
    "moteur": "switch",
    "conteneur": "nel3ab-switch-room-switch-kjwatM",
    "salle": 1,
    "fils": [
        {"nom": "GUI.RenderLoop", "tid": 4250, "cpu_pct": 93.0},
        {"nom": "GPU.MainThread", "tid": 4251, "cpu_pct": 55.0},
        {"nom": "<MainThread>", "tid": 4243, "cpu_pct": 27.0},
        {"nom": "<TaskExec1>", "tid": 4244, "cpu_pct": 17.0},
    ],
}


class FauxLanceur:
    """Retient chaque commande et écrit une sortie reconnaissable."""

    def __init__(self, codes: dict[str, int] | None = None) -> None:
        self.commandes: list[list[str]] = []
        self.codes = codes or {}
        self._verrou = threading.Lock()

    def __call__(self, argv: Sequence[str], sortie: Path, delai: float) -> int:
        with self._verrou:
            self.commandes.append(list(argv))
        sortie.write_text(f"sortie de {argv[0]} {argv[1]}\n")
        return self.codes.get(argv[1], 0)


def _capteur(tmp_path: Path, lanceur: FauxLanceur, debugfs: bool = False) -> Capteur:
    dri = tmp_path / "dri"
    dri.mkdir()
    (dri / "amdgpu_vram_mm").write_text("chunk_size: 4KiB, total: 8176MiB, free: 8160MiB\n")
    (dri / "amdgpu_gem_info").write_text("pid  4242 command Ryujinx:\n")
    salon = tmp_path / "sessions"
    salon.mkdir()
    lignes = [
        {"quand": (QUAND - timedelta(minutes=5)).isoformat(), "quoi": "mesures", "n": "vieille"},
        {"quand": (QUAND - timedelta(minutes=1)).isoformat(), "quoi": "mesures", "n": "récente"},
    ]
    (salon / "2026-09-14.jsonl").write_text(
        "".join(json.dumps(ligne, ensure_ascii=False) + "\n" for ligne in lignes) + "pas du json\n"
    )
    return Capteur(
        tmp_path / "captures",
        Racines(dri=dri),
        journal_salon=salon,
        lanceur=lanceur,
        debugfs=debugfs,
    )


def test_une_capture_profile_les_trois_fils_les_plus_occupes(tmp_path: Path) -> None:
    lanceur = FauxLanceur()
    dossier = _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, {"mediane": 40.0})

    assert dossier.name == "2026-09-14T00-36-28-salle1-chute"
    (profil,) = [argv for argv in lanceur.commandes if argv[:2] == ["perf", "record"]]
    assert profil[profil.index("-t") + 1] == "4250,4251,4243"
    assert profil[profil.index("-F") + 1] == "199"
    assert profil[profil.index("--proc-map-timeout") + 1] == "5000"
    (compte,) = [argv for argv in lanceur.commandes if argv[:2] == ["perf", "stat"]]
    assert compte[compte.index("-p") + 1] == "4242"


def test_le_profil_est_resume_en_texte_au_moment_de_la_capture(tmp_path: Path) -> None:
    """La leçon du noyau changé: un profil brut ne se relit plus après une mise à jour."""
    lanceur = FauxLanceur()
    dossier = _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, {})

    assert any(argv[:2] == ["perf", "report"] for argv in lanceur.commandes)
    assert (dossier / "rendu.txt").exists()


def test_un_profil_rate_n_est_pas_resume_et_la_capture_continue(tmp_path: Path) -> None:
    lanceur = FauxLanceur(codes={"record": 1})
    dossier = _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, {})

    assert not any(argv[:2] == ["perf", "report"] for argv in lanceur.commandes)
    meta = json.loads((dossier / "capture.json").read_text())
    assert meta["codes"]["profil"] == 1
    assert (dossier / "worker.log").exists()


def test_la_capture_garde_l_allocateur_le_worker_les_pages_et_l_ecran(tmp_path: Path) -> None:
    lanceur = FauxLanceur()
    capteur = _capteur(tmp_path, lanceur, debugfs=True)
    dossier = capteur.capturer("chute", RYUJINX, QUAND, {"mediane": 40.0})

    assert (dossier / "amdgpu_vram_mm.txt").read_text().startswith("chunk_size")
    assert (dossier / "amdgpu_gem_info.txt").exists()
    (journal,) = [argv for argv in lanceur.commandes if argv[0] == "journalctl"]
    assert journal[journal.index("-u") + 1] == "nel3ab-worker@1"
    pages = (dossier / "pages.jsonl").read_text().splitlines()
    assert [json.loads(ligne)["n"] for ligne in pages] == ["récente"]
    (ecran,) = [argv for argv in lanceur.commandes if argv[0] == "docker"]
    assert ecran[2] == "nel3ab-switch-room-switch-kjwatM"
    assert ecran[-1].endswith("nice -n 19 grim -t png -l 1 -")
    assert (dossier / "ecran.png").exists()
    meta = json.loads((dossier / "capture.json").read_text())
    assert meta["raison"] == "chute"
    assert meta["details"] == {"mediane": 40.0}
    assert meta["fils_profiles"] == [4250, 4251, 4243]
    assert meta["debugfs"] is True


def test_sans_fil_occupe_il_n_y_a_pas_de_profil_mais_le_reste_est_pris(tmp_path: Path) -> None:
    """Le jumeau: un émulateur au repos n'a rien à profiler, le compte se prend quand même."""
    lanceur = FauxLanceur()
    calme = {**RYUJINX, "fils": [{"nom": "x", "tid": 1, "cpu_pct": 2.0}]}
    dossier = _capteur(tmp_path, lanceur).capturer("periodique", calme, QUAND, {})

    assert not any(argv[:2] == ["perf", "record"] for argv in lanceur.commandes)
    assert any(argv[:2] == ["perf", "stat"] for argv in lanceur.commandes)
    assert json.loads((dossier / "capture.json").read_text())["fils_profiles"] == []


def test_dolphin_n_a_pas_d_ecran_et_une_salle_inconnue_lit_tous_les_workers(tmp_path: Path) -> None:
    lanceur = FauxLanceur()
    dolphin = {"pid": 7, "moteur": "dolphin", "conteneur": "nel3ab-dolphin-2", "salle": None}
    dossier = _capteur(tmp_path, lanceur).capturer("periodique", dolphin, QUAND, {})

    assert dossier.name == "2026-09-14T00-36-28-periodique"
    assert not any(argv[0] == "docker" for argv in lanceur.commandes)
    (journal,) = [argv for argv in lanceur.commandes if argv[0] == "journalctl"]
    assert journal[journal.index("-u") + 1] == "nel3ab-worker@*"


def test_un_debugfs_illisible_se_note_sans_arreter_la_capture(tmp_path: Path) -> None:
    lanceur = FauxLanceur()
    capteur = Capteur(
        tmp_path / "captures", Racines(dri=tmp_path / "absent"), lanceur=lanceur, debugfs=True
    )
    dossier = capteur.capturer("chute", RYUJINX, QUAND, {})

    codes = json.loads((dossier / "capture.json").read_text())["codes"]
    assert codes["amdgpu_vram_mm"] == -1
    assert not (dossier / "pages.jsonl").exists()


def test_seules_les_lignes_recentes_et_datees_sont_gardees() -> None:
    texte = "\n".join(
        [
            json.dumps({"quand": "2026-09-14T00:30:00+02:00"}),
            json.dumps({"quand": "2026-09-14T00:35:00+02:00"}),
            json.dumps({"quand": "2026-09-14T00:35:00"}),
            "[1]",
            "pas du json",
        ]
    )
    gardees = lignes_recentes(texte, QUAND - timedelta(minutes=3))
    assert [json.loads(ligne)["quand"] for ligne in gardees] == ["2026-09-14T00:35:00+02:00"]


def test_par_defaut_la_capture_ne_touche_pas_au_debugfs(tmp_path: Path) -> None:
    """Le jumeau mesuré: chaque copie coupait l'image d'une partie en cours de 100 ms."""
    lanceur = FauxLanceur()
    dossier = _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, {})

    assert not (dossier / "amdgpu_vram_mm.txt").exists()
    assert not (dossier / "amdgpu_gem_info.txt").exists()
    meta = json.loads((dossier / "capture.json").read_text())
    assert meta["debugfs"] is False
    assert "amdgpu_vram_mm" not in meta["codes"]


def test_une_capture_periodique_ne_prend_pas_l_ecran(tmp_path: Path) -> None:
    """`grim` tourne dans le conteneur du jeu: seulement quand il y a une chute à montrer."""
    lanceur = FauxLanceur()
    dossier = _capteur(tmp_path, lanceur).capturer("periodique", RYUJINX, QUAND, {})

    assert not any(argv[0] == "docker" for argv in lanceur.commandes)
    assert not (dossier / "ecran.png").exists()
