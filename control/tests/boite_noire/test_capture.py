"""Une capture, avec un faux lanceur: les commandes et les fichiers, sans `perf` ni GPU."""

import json
import os
import threading
from collections.abc import Sequence
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from nel3ab_control.boite_noire import capture
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


#: Ce que `supervise.py` écrit dans `/run-data/display.json` quand Sway est prêt.
AFFICHAGE = '{"display": "wayland-1", "pid": 4242}'


class FauxLanceur:
    """Retient chaque commande et écrit une sortie reconnaissable.

    Une lecture de `display.json` rend `affichage`, ou échoue comme `cat` sur un
    fichier absent quand il vaut rien.
    """

    def __init__(
        self, codes: dict[str, int] | None = None, affichage: str | None = AFFICHAGE
    ) -> None:
        self.commandes: list[list[str]] = []
        self.codes = codes or {}
        self.affichage = affichage
        self._verrou = threading.Lock()

    def __call__(self, argv: Sequence[str], sortie: Path, delai: float) -> int:
        with self._verrou:
            self.commandes.append(list(argv))
        if argv[-1] == "/run-data/display.json":
            if self.affichage is None:
                sortie.write_text("cat: /run-data/display.json: No such file or directory\n")
                return 1
            sortie.write_text(self.affichage)
            return 0
        sortie.write_text(f"sortie de {argv[0]} {argv[1]}\n")
        return self.codes.get(argv[1], 0)


def ecrans(lanceur: FauxLanceur) -> list[list[str]]:
    """Les commandes `grim` lancées dans un conteneur."""
    return [
        argv for argv in lanceur.commandes if argv[:2] == ["docker", "exec"] and "grim" in argv[-1]
    ]


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
    # Un faux `/proc` vide: la capture lit les descripteurs de chaque processus.
    (tmp_path / "proc").mkdir()
    return Capteur(
        tmp_path / "captures",
        Racines(dri=dri, proc=tmp_path / "proc"),
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


def test_le_gel_d_une_seule_page_ne_profile_pas_l_emulateur(tmp_path: Path) -> None:
    """Le reste de la capture, journaux et pages, dit ce qui est arrivé à la page;
    le profil de l'émulateur décrirait une salle qui allait bien."""
    lanceur = FauxLanceur()
    details = {"cause": "gel", "portee": "page", "page": "42fec406"}
    dossier = _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, details)

    assert not any(argv[:2] == ["perf", "record"] for argv in lanceur.commandes)
    assert any(argv[:2] == ["perf", "stat"] for argv in lanceur.commandes)
    assert any(argv[0] == "journalctl" for argv in lanceur.commandes)
    assert json.loads((dossier / "capture.json").read_text())["fils_profiles"] == []


def test_un_gel_de_salle_profile_l_emulateur(tmp_path: Path) -> None:
    """Le jumeau, avec les mêmes fils occupés."""
    lanceur = FauxLanceur()
    details = {"cause": "gel", "portee": "salle", "page": None}
    _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, details)

    assert any(argv[:2] == ["perf", "record"] for argv in lanceur.commandes)


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


@pytest.mark.parametrize("engine", ["switch", "switch2", "x360"])
def test_la_capture_garde_l_allocateur_le_worker_les_pages_et_l_ecran(
    tmp_path: Path, engine: str
) -> None:
    lanceur = FauxLanceur()
    capteur = _capteur(tmp_path, lanceur, debugfs=True)
    dossier = capteur.capturer("chute", {**RYUJINX, "moteur": engine}, QUAND, {"mediane": 40.0})

    assert (dossier / "amdgpu_vram_mm.txt").read_text().startswith("chunk_size")
    assert (dossier / "amdgpu_gem_info.txt").exists()
    (journal,) = [argv for argv in lanceur.commandes if argv[0] == "journalctl"]
    assert journal[journal.index("-u") + 1] == "nel3ab-worker@1"
    pages = (dossier / "pages.jsonl").read_text().splitlines()
    assert [json.loads(ligne)["n"] for ligne in pages] == ["récente"]
    (emulateur,) = [argv for argv in lanceur.commandes if argv[:2] == ["docker", "logs"]]
    assert emulateur[-1] == "nel3ab-switch-room-switch-kjwatM"
    assert (dossier / "emulateur.log").exists()
    affichage, ecran = [argv for argv in lanceur.commandes if argv[:2] == ["docker", "exec"]]
    assert affichage == [
        *("docker", "exec", "nel3ab-switch-room-switch-kjwatM"),
        *("cat", "/run-data/display.json"),
    ]
    assert ecran[2] == "nel3ab-switch-room-switch-kjwatM"
    assert ecran[-1].startswith("WAYLAND_DISPLAY=wayland-1 ")
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
    assert not any(argv[:2] == ["docker", "exec"] for argv in lanceur.commandes)
    # Mais son journal de conteneur est pris: Dolphin aussi se plaint de lui-même.
    (emulateur,) = [argv for argv in lanceur.commandes if argv[:2] == ["docker", "logs"]]
    assert emulateur[-1] == "nel3ab-dolphin-2"
    (journal,) = [argv for argv in lanceur.commandes if argv[0] == "journalctl"]
    assert journal[journal.index("-u") + 1] == "nel3ab-worker@*"


def test_un_debugfs_illisible_se_note_sans_arreter_la_capture(tmp_path: Path) -> None:
    lanceur = FauxLanceur()
    (tmp_path / "proc").mkdir()
    capteur = Capteur(
        tmp_path / "captures",
        Racines(dri=tmp_path / "absent", proc=tmp_path / "proc"),
        lanceur=lanceur,
        debugfs=True,
    )
    dossier = capteur.capturer("chute", RYUJINX, QUAND, {})

    codes = json.loads((dossier / "capture.json").read_text())["codes"]
    assert codes["amdgpu_vram_mm"] == -1
    assert not (dossier / "pages.jsonl").exists()
    # La capture lit les descripteurs des processus des `Racines` qu'on lui donne,
    # pas ceux de la machine qui fait tourner l'essai.
    lu = json.loads((dossier / "gpu-detenteurs.json").read_text(encoding="utf-8"))
    assert (lu["detenteurs"], lu["illisibles"]) == ([], 0)


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


@pytest.mark.parametrize("engine", ["switch", "switch2", "x360"])
def test_une_capture_periodique_ne_prend_pas_l_ecran(tmp_path: Path, engine: str) -> None:
    """`grim` tourne dans le conteneur du jeu: seulement quand il y a une chute à montrer."""
    lanceur = FauxLanceur()
    dossier = _capteur(tmp_path, lanceur).capturer(
        "periodique", {**RYUJINX, "moteur": engine}, QUAND, {}
    )

    assert not any(argv[:2] == ["docker", "exec"] for argv in lanceur.commandes)
    assert not (dossier / "ecran.png").exists()
    # Le journal de l'émulateur, lui, est pris à chaque capture: c'est là que
    # Ryujinx écrit « GPU processing thread is too slow ».
    assert (dossier / "emulateur.log").exists()


@pytest.mark.parametrize("engine", ["switch", "x360"])
def test_l_ecran_se_prend_sur_l_affichage_que_la_salle_a_ecrit(tmp_path: Path, engine: str) -> None:
    """`wayland-1` était supposé: le nom vient de `display.json`, écrit par
    `supervise.py` une fois Sway prêt, sous Wayland comme sous Xwayland."""
    lanceur = FauxLanceur(affichage='{"display": "wayland-2", "pid": 4242}')
    dossier = _capteur(tmp_path, lanceur).capturer(
        "chute", {**RYUJINX, "moteur": engine}, QUAND, {}
    )

    (ecran,) = ecrans(lanceur)
    assert ecran[-1].startswith("WAYLAND_DISPLAY=wayland-2 XDG_RUNTIME_DIR=/tmp/nel3ab-runtime ")
    assert "wayland-1" not in ecran[-1]
    assert (dossier / "ecran.png").exists()
    codes = json.loads((dossier / "capture.json").read_text())["codes"]
    assert (codes["affichage"], codes["ecran"]) == (0, 0)


@pytest.mark.parametrize(
    "affichage",
    [
        # Sway pas encore prêt, ou la salle déjà arrêtée: pas de fichier.
        None,
        "pas du json",
        '["wayland-1"]',
        '{"pid": 4242}',
        # Un nom qui sortirait de la commande `sh -c` où il est posé.
        '{"display": "wayland-1; rm -rf ~", "pid": 4242}',
        '{"display": "../wayland-1", "pid": 4242}',
    ],
)
def test_sans_affichage_lisible_l_ecran_n_est_pas_pris_et_la_capture_continue(
    tmp_path: Path, affichage: str | None
) -> None:
    """Les jumeaux: `grim` sur un affichage supposé capturait un autre écran, ou rien."""
    lanceur = FauxLanceur(affichage=affichage)
    dossier = _capteur(tmp_path, lanceur).capturer("chute", RYUJINX, QUAND, {})

    assert ecrans(lanceur) == []
    assert not (dossier / "ecran.png").exists()
    codes = json.loads((dossier / "capture.json").read_text())["codes"]
    assert codes["affichage"] != 0
    assert "ecran" not in codes
    assert (dossier / "worker.log").exists(), "le reste de la capture est pris"


# --- Qui tient la carte au moment d'une capture ----------------------------------
#
# Le 22 novembre 2026, de 15:25 à 15:27 UTC, la carte était occupée à 93-98 %
# sans aucun moteur nel3ab, et rien ne disait par qui. Jellyfin (même
# utilisateur) se lit par ses descripteurs; ollama tourne en root et ne se lit
# pas: la capture le compte, et le relevé le voit par `/sys/class/kfd`.


def _processus(proc: Path, pid: int, nom: str, liens: dict[int, str]) -> None:
    (proc / str(pid) / "fd").mkdir(parents=True)
    (proc / str(pid) / "comm").write_text(f"{nom}\n")
    for fd, cible in liens.items():
        (proc / str(pid) / "fd" / str(fd)).symlink_to(cible)


def test_la_capture_nomme_les_processus_qui_tiennent_la_carte(tmp_path: Path) -> None:
    assert os.geteuid() != 0, "en root, le dossier fermé se lirait quand même"
    lanceur = FauxLanceur()
    capteur = _capteur(tmp_path, lanceur)
    proc = tmp_path / "proc"
    _processus(proc, 4242, "Ryujinx", {7: "/dev/dri/renderD128", 8: "/dev/null"})
    _processus(proc, 5001, "ffmpeg", {3: "/dev/dri/renderD128", 4: "/dev/dri/card0"})
    _processus(proc, 5002, "bash", {0: "/dev/pts/3"})
    _processus(proc, 3913, "ollama", {})
    (proc / "3913" / "fd").chmod(0)
    try:
        dossier = capteur.capturer("chute", RYUJINX, QUAND, {"cause": "gel"})
    finally:
        (proc / "3913" / "fd").chmod(0o700)

    lu = json.loads((dossier / "gpu-detenteurs.json").read_text(encoding="utf-8"))
    assert lu["detenteurs"] == [
        {"pid": 4242, "nom": "Ryujinx", "noeuds": ["/dev/dri/renderD128"]},
        {"pid": 5001, "nom": "ffmpeg", "noeuds": ["/dev/dri/card0", "/dev/dri/renderD128"]},
    ]
    assert lu["illisibles"] == 1
    assert "root" in lu["note"]


def test_des_descripteurs_listes_mais_illisibles_sont_comptes_illisibles(tmp_path: Path) -> None:
    """Le service tourne avec CAP_DAC_READ_SEARCH (`deploy/nel3ab-boite-noire.service`):
    elle ouvre le dossier `fd` d'un processus de root, mais le noyau refuse de lire
    où mène chaque lien sans droit de tracer ce processus. Un dossier qu'on liste
    sans pouvoir y entrer donne le même refus. Sauté, ollama sortait « ni détenteur
    ni illisible »: le fichier disait alors que personne d'autre ne tenait la carte."""
    assert os.geteuid() != 0, "en root, le dossier fermé se lirait quand même"
    capteur = _capteur(tmp_path, FauxLanceur())
    proc = tmp_path / "proc"
    _processus(proc, 3913, "ollama", {5: "/dev/kfd", 6: "/dev/dri/renderD128"})
    _processus(proc, 5001, "ffmpeg", {3: "/dev/dri/renderD128"})
    # Le jumeau: un descripteur fermé entre la liste et la lecture (ENOENT dans le
    # vrai `/proc`; ici un fichier qui n'est pas un lien) se saute sans rendre son
    # processus illisible.
    (proc / "5001" / "fd" / "9").write_text("")
    (proc / "3913" / "fd").chmod(0o400)
    try:
        assert sorted(os.listdir(proc / "3913" / "fd")) == ["5", "6"], "la liste se lit"
        dossier = capteur.capturer("chute", RYUJINX, QUAND, {})
    finally:
        (proc / "3913" / "fd").chmod(0o700)

    lu = json.loads((dossier / "gpu-detenteurs.json").read_text(encoding="utf-8"))
    assert [un["pid"] for un in lu["detenteurs"]] == [5001]
    assert lu["illisibles"] == 1


def test_un_nom_de_processus_coupe_au_milieu_d_un_accent_ne_perd_pas_la_capture(
    tmp_path: Path,
) -> None:
    """Le noyau coupe `comm` à quinze octets, au milieu d'un caractère s'il le faut:
    « Enregistreurs-écran » s'y arrête sur le premier octet du « é ». Lu en UTF-8
    strict, ce nom levait une erreur avant le profil, et toute la capture était
    perdue pour un détenteur au nom accentué."""
    capteur = _capteur(tmp_path, FauxLanceur())
    proc = tmp_path / "proc"
    _processus(proc, 5003, "x", {3: "/dev/dri/renderD128"})
    (proc / "5003" / "comm").write_bytes("Enregistreurs-écran".encode()[:15] + b"\n")
    assert (proc / "5003" / "comm").read_bytes().endswith(b"\xc3\n"), "un octet seul à la fin"

    dossier = capteur.capturer("chute", RYUJINX, QUAND, {})

    lu = json.loads((dossier / "gpu-detenteurs.json").read_text(encoding="utf-8"))
    assert [un["pid"] for un in lu["detenteurs"]] == [5003]
    assert lu["detenteurs"][0]["nom"].startswith("Enregistreurs-")
    assert (dossier / "worker.log").exists(), "le reste de la capture est pris"


def test_sans_detenteur_la_liste_est_vide_et_le_fichier_present(tmp_path: Path) -> None:
    """Le jumeau: personne ne tient la carte, et cela se dit."""
    dossier = _capteur(tmp_path, FauxLanceur()).capturer("chute", RYUJINX, QUAND, {})

    lu = json.loads((dossier / "gpu-detenteurs.json").read_text(encoding="utf-8"))
    assert (lu["detenteurs"], lu["illisibles"]) == ([], 0)


def test_les_detenteurs_ne_se_lisent_jamais_dans_fdinfo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Le nom du descripteur, pas les statistiques du pilote, dont le coût n'est pas
    qualifié (CLAUDE.md, règle 4)."""
    capteur = _capteur(tmp_path, FauxLanceur())
    _processus(tmp_path / "proc", 5001, "ffmpeg", {3: "/dev/dri/renderD128"})
    (tmp_path / "proc" / "5001" / "fdinfo").mkdir()
    (tmp_path / "proc" / "5001" / "fdinfo" / "3").write_text("drm-engine-gfx: 1 ns\n")
    ouverts: list[str] = []
    vrais = (os.listdir, Path.read_text, Path.open)

    def liste(chemin: Any) -> list[str]:
        ouverts.append(str(chemin))
        return vrais[0](chemin)

    def lit(chemin: Path, *args: Any, **kwargs: Any) -> str:
        ouverts.append(str(chemin))
        return vrais[1](chemin, *args, **kwargs)

    monkeypatch.setattr(capture.os, "listdir", liste)
    monkeypatch.setattr(Path, "read_text", lit)
    dossier = capteur.capturer("chute", RYUJINX, QUAND, {})

    lu = json.loads((dossier / "gpu-detenteurs.json").read_text(encoding="utf-8"))
    assert [un["pid"] for un in lu["detenteurs"]] == [5001]
    assert not [chemin for chemin in ouverts if "fdinfo" in Path(chemin).parts], ouverts
