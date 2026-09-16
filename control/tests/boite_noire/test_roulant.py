"""Le `perf` roulant: ce qu'il lance, quand il repart, et ce qu'un gel en tire.

La règle du module est qu'un profil manquant ne casse jamais une capture. Chaque
essai a donc son jumeau: celui qui rend un fichier, et celui qui rend `None` sans
lever.
"""

import signal
from pathlib import Path
from typing import Any

from nel3ab_control.boite_noire.roulant import Roulant

RYUJINX: dict[str, Any] = {
    "pid": 4242,
    "moteur": "switch",
    "salle": 1,
    "fils": [
        {"nom": "GUI.RenderLoop", "tid": 4250, "cpu_pct": 91.0},
        {"nom": "GPU.MainThread", "tid": 4251, "cpu_pct": 56.0},
        {"nom": "<MainThread>", "tid": 4243, "cpu_pct": 28.0},
        {"nom": "<TaskExec1>", "tid": 4260, "cpu_pct": 19.0},
    ],
}


class FauxProcessus:
    """Un `perf` qui ne fait rien, sauf écrire un vidage quand on le signale."""

    def __init__(self, argv: list[str], vivant: bool = True) -> None:
        self.argv = argv
        self.pid = 9100
        self.arrete = False
        self._vivant = vivant

    def poll(self) -> int | None:
        return None if self._vivant and not self.arrete else 0

    def terminate(self) -> None:
        self.arrete = True

    def wait(self, timeout: float | None = None) -> int:
        return 0


class Machine:
    """Le lanceur et le signaleur, avec leur trace."""

    def __init__(self, dossier: Path, ecrit: bool = True) -> None:
        self.dossier = dossier
        self.lances: list[FauxProcessus] = []
        self.signaux: list[tuple[int, int]] = []
        self._ecrit = ecrit

    def lancer(self, argv: list[str]) -> FauxProcessus:
        processus = FauxProcessus(argv)
        self.lances.append(processus)
        return processus

    def signaler(self, pid: int, quel: int) -> None:
        self.signaux.append((pid, quel))
        if self._ecrit:
            (self.dossier / "roulant.perf.data.2026091623261845").write_bytes(b"profil")


def _roulant(tmp_path: Path, machine: Machine, attente: float = 0.2) -> Roulant:
    return Roulant(
        tmp_path / "roulant",
        lanceur=machine.lancer,
        signaleur=machine.signaler,
        attente_s=attente,
    )


def test_il_suit_le_processus_de_l_emulateur(tmp_path: Path) -> None:
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)

    roulant.suivre(RYUJINX)

    (lance,) = machine.lances
    assert lance.argv[:3] == ["perf", "record", "--overwrite"]
    assert "--switch-output=signal" in lance.argv
    # Le PROCESSUS et pas ses fils: le trio de tête change de composition à
    # chaque relevé, et le suivre relançait `perf` dix-sept fois par minute.
    assert lance.argv[lance.argv.index("-p") + 1] == "4242"
    assert "-t" not in lance.argv
    assert lance.argv[lance.argv.index("-o") + 1].endswith("roulant.perf.data")
    # Le tampon tient sous `perf_event_mlock_kb`, 516 Kio sur cette machine:
    # au-dessus, `perf` refuse de démarrer et le service se croit armé pour rien.
    assert int(lance.argv[lance.argv.index("-m") + 1]) * 4 <= 516
    assert roulant.suivi() == 4242
    # Rien n'est écrit tant qu'aucun gel ne le demande.
    assert list((tmp_path / "roulant").glob("roulant.perf.data*")) == []


def test_il_ne_relance_rien_tant_que_les_fils_ne_changent_pas(tmp_path: Path) -> None:
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)

    roulant.suivre(RYUJINX)
    roulant.suivre(RYUJINX)

    assert len(machine.lances) == 1


def test_des_fils_qui_changent_ne_relancent_rien(tmp_path: Path) -> None:
    """Le jumeau du précédent, et il vient d'une vraie panne mesurée le 17 septembre
    2026: la composition du trio de tête change à chaque relevé, et la suivre faisait
    repartir `perf` dix-sept fois par minute, tampon neuf à chaque fois."""
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)

    roulant.suivre(RYUJINX)
    roulant.suivre({**RYUJINX, "fils": [{"nom": "autre", "tid": 9999, "cpu_pct": 80.0}]})

    assert len(machine.lances) == 1


def test_un_perf_mort_est_recolte_et_remplace(tmp_path: Path) -> None:
    """Sans récolte, un `perf` qui refuse de démarrer laisse un zombie par tour."""
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)
    roulant.suivre(RYUJINX)
    machine.lances[0].terminate()  # il meurt de lui-même

    roulant.suivre(RYUJINX)

    assert len(machine.lances) == 2
    assert machine.lances[1].arrete is False


def test_un_changement_de_jeu_relance_l_enregistrement(tmp_path: Path) -> None:
    """Les fils meurent avec la partie: un `perf` qui suivrait les anciens ne
    rapporterait plus rien, et son silence ressemblerait à une machine calme."""
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)

    roulant.suivre(RYUJINX)
    roulant.suivre({**RYUJINX, "pid": 7000})

    assert len(machine.lances) == 2
    assert machine.lances[0].arrete is True
    assert roulant.suivi() == 7000


def test_un_moteur_sans_numero_de_processus_n_enregistre_rien(tmp_path: Path) -> None:
    """Le jumeau: sans processus à suivre, `perf` refuserait de démarrer, et un
    enregistreur qu'on croit armé est pire que pas d'enregistreur."""
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)

    roulant.suivre({**RYUJINX, "pid": None})

    assert machine.lances == []
    assert roulant.suivi() is None


def test_un_gel_range_le_tampon_dans_la_capture(tmp_path: Path) -> None:
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)
    roulant.suivre(RYUJINX)

    rendu = roulant.vider(tmp_path / "capture")

    assert machine.signaux == [(9100, signal.SIGUSR2)]
    assert rendu == tmp_path / "capture" / "avant.perf.data"
    assert rendu is not None and rendu.read_bytes() == b"profil"
    # Et le tampon n'est plus dans le dossier roulant: un vidage ne se range pas deux fois.
    assert list((tmp_path / "roulant").glob("roulant.perf.data.*")) == []


def test_un_perf_qui_ne_vide_rien_rend_rien_sans_faire_attendre(tmp_path: Path) -> None:
    """Le jumeau, et il porte sur la règle du module: la capture continue."""
    machine = Machine(tmp_path / "roulant", ecrit=False)
    roulant = _roulant(tmp_path, machine, attente=0.1)
    roulant.suivre(RYUJINX)

    assert roulant.vider(tmp_path / "capture") is None
    assert machine.signaux == [(9100, signal.SIGUSR2)]


def test_sans_enregistrement_en_cours_il_n_y_a_rien_a_vider(tmp_path: Path) -> None:
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)

    assert roulant.vider(tmp_path / "capture") is None
    assert machine.signaux == []


def test_arreter_termine_le_processus_et_oublie_ses_fils(tmp_path: Path) -> None:
    machine = Machine(tmp_path / "roulant")
    roulant = _roulant(tmp_path, machine)
    roulant.suivre(RYUJINX)

    roulant.arreter()

    assert machine.lances[0].arrete is True
    assert roulant.suivi() is None
    # Deux arrêts de suite ne lèvent pas: le service en appelle un à chaque tour
    # où personne ne joue.
    roulant.arreter()
