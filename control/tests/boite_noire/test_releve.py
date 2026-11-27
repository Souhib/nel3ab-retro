"""Le relevé, contre un faux `/proc` et un faux `/sys`.

Sans GPU, sans émulateur et sans droits: la machine est un dossier temporaire
dont chaque fichier imite le format réel (voir `echantillons/`). Deux relevés
successifs, avec des compteurs qui avancent d'une quantité connue, prouvent les
écarts au dixième près.
"""

import json
from datetime import UTC
from pathlib import Path
from unittest.mock import Mock

import pytest

from nel3ab_control.boite_noire.declencheur import Declencheur, Suiveur
from nel3ab_control.boite_noire.releve import Racines, Releveur
from nel3ab_control.boite_noire.service import BoiteNoire
from nel3ab_control.journal import Journal
from nel3ab_control.settings import Settings

ECHANTILLONS = Path(__file__).parent / "echantillons"
DOCKER_ID = "c0" * 32
RYUJINX, RENDU, AUTRE_FIL = 4242, 4250, 4251
WORKER, TIERS, SOI = 900, 700, 1


def _ecrire(chemin: Path, texte: str) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(texte, encoding="utf-8")


def _stat(pid: int, nom: str, tics: int, coeur: int = 0) -> str:
    # utime au rang 11, stime au rang 12, cœur au rang 36 après la parenthèse.
    champs = ["S"] + ["0"] * 10 + [str(tics), "0"] + ["0"] * 23 + [str(coeur)]
    return f"{pid} ({nom}) " + " ".join(champs) + "\n"


class Machine:
    """Une fausse lgf, dont on fait avancer les compteurs entre deux relevés."""

    def __init__(self, racine: Path) -> None:
        self.r = Racines(
            proc=racine / "proc",
            carte=racine / "carte",
            hwmon=racine / "hwmon",
            dri=racine / "dri",
            cgroup=racine / "cgroup",
            docker=racine / "docker",
        )
        p = self.r.proc
        _ecrire(p / "cpuinfo", (ECHANTILLONS / "cpuinfo.txt").read_text())
        _ecrire(p / "loadavg", "3.10 3.33 3.19 3/900 12345\n")
        _ecrire(p / "meminfo", (ECHANTILLONS / "meminfo.txt").read_text())
        for genre in ("cpu", "memory", "io"):
            _ecrire(p / "pressure" / genre, "some avg10=1.95 avg60=1.40 avg300=1.25 total=1\n")
        _ecrire(p / "sys/kernel/pid_max", "4194304\n")
        # Ryujinx dans son conteneur, avec deux fils.
        _ecrire(p / str(RYUJINX) / "comm", "Ryujinx\n")
        _ecrire(p / str(RYUJINX) / "cgroup", f"0::/system.slice/docker-{DOCKER_ID}.scope\n")
        _ecrire(p / str(WORKER) / "comm", "nel3ab-worker\n")
        _ecrire(p / str(TIERS) / "comm", "bash\n")
        _ecrire(p / str(SOI) / "comm", "python3\n")
        _ecrire(
            self.r.docker / DOCKER_ID / "config.v2.json",
            '{"Name": "/nel3ab-switch-room-switch-kjwatM", "Config": {"Labels": '
            '{"nel3ab.room-root": "/home/souhib/.local/state/nel3ab/salles/1"}}}',
        )
        c = self.r.carte
        _ecrire(c / "gpu_busy_percent", "42\n")
        _ecrire(c / "pp_dpm_sclk", "0: 500Mhz \n1: 700Mhz *\n2: 2765Mhz \n")
        _ecrire(c / "pp_dpm_mclk", "0: 96Mhz \n3: 1094Mhz *\n")
        _ecrire(c / "pp_power_profile_mode", " 0 BOOTUP_DEFAULT :\n 3          VIDEO*:\n")
        _ecrire(c / "power_dpm_force_performance_level", "auto\n")
        _ecrire(c / "mem_info_vram_used", str(667 * 1_048_576) + "\n")
        _ecrire(c / "mem_info_gtt_used", str(116 * 1_048_576) + "\n")
        _ecrire(self.r.hwmon / "hwmon0" / "name", "k10temp\n")
        _ecrire(self.r.hwmon / "hwmon0" / "temp1_input", "81250\n")
        _ecrire(self.r.hwmon / "hwmon0" / "temp1_label", "Tctl\n")
        _ecrire(self.r.hwmon / "hwmon1" / "name", "amdgpu\n")
        _ecrire(self.r.hwmon / "hwmon1" / "power1_average", "23000000\n")
        _ecrire(self.r.hwmon / "hwmon1" / "freq1_input", "696000000\n")
        _ecrire(self.r.hwmon / "hwmon1" / "freq1_label", "sclk\n")
        _ecrire(
            self.r.dri / "amdgpu_vram_mm", (ECHANTILLONS / "amdgpu_vram_mm_7.0.txt").read_text()
        )
        _ecrire(
            self.r.dri / "amdgpu_gem_info",
            f"pid  {RYUJINX} command Ryujinx:\n\t\t0x1:  4096 byte VRAM VISIBLE\n"
            f"\t\t0x2:  4096 byte GTT\npid  {WORKER} command nel3ab-worker:\n"
            "\t\t0x1:  65536 byte VRAM\n",
        )
        self.avancer(0)

    def avancer(self, pas: int) -> None:
        """Fait avancer tous les compteurs: `pas` fois une quantité connue."""
        p = self.r.proc
        # Le cœur 0 passe 100 tics par pas dont 25 au repos: 75 % occupé.
        _ecrire(
            p / "stat",
            f"cpu  {100 * pas} 0 0 {1000 + 25 * pas} 0 0 0 0 0 0\n"
            f"cpu0 {75 * pas} 0 0 {25 * pas} 0 0 0 0 0 0\n",
        )
        _ecrire(p / str(RYUJINX) / "stat", _stat(RYUJINX, "Ryujinx", 180 * pas))
        _ecrire(
            p / str(RYUJINX) / "task" / str(RENDU) / "stat",
            _stat(RENDU, "GUI.RenderLoop", 93 * pas, 5),
        )
        _ecrire(
            p / str(RYUJINX) / "task" / str(RENDU) / "status",
            f"voluntary_ctxt_switches:\t{293 * pas}\nnonvoluntary_ctxt_switches:\t{8 * pas}\n",
        )
        _ecrire(
            p / str(RYUJINX) / "task" / str(AUTRE_FIL) / "stat",
            _stat(AUTRE_FIL, "GPU.MainThread", 55 * pas, 2),
        )
        _ecrire(p / str(RYUJINX) / "task" / str(AUTRE_FIL) / "status", "")
        _ecrire(p / str(RYUJINX) / "io", f"read_bytes: {1024 * 10 * pas}\nwrite_bytes: 0\n")
        _ecrire(p / str(WORKER) / "stat", _stat(WORKER, "nel3ab-worker", 9 * pas))
        _ecrire(p / str(TIERS) / "stat", _stat(TIERS, "bash", 1000 * pas))
        _ecrire(p / str(SOI) / "stat", _stat(SOI, "python3", 1 * pas))
        _ecrire(
            p / "net/dev",
            "Inter-|   Receive\n face |bytes\n"
            f"  enp6s0: {1024 * 50 * pas} 0 0 0 0 0 0 0 {1024 * 20 * pas} 0 0 0 0 0 0 0\n"
            f" veth1234: {999 * pas} 0 0 0 0 0 0 0 {999 * pas} 0 0 0 0 0 0 0\n",
        )
        _ecrire(
            self.r.cgroup / f"system.slice/docker-{DOCKER_ID}.scope" / "cpu.stat",
            f"usage_usec {1_800_000 * pas}\nnr_throttled {2 * pas}\nthrottled_usec {5000 * pas}\n",
        )


class Horloge:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def _deux_releves(tmp_path: Path) -> tuple[Machine, dict, dict]:
    machine = Machine(tmp_path)
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    premier = releveur.prendre()
    machine.avancer(1)
    horloge.t += 1.0
    return machine, premier, releveur.prendre()


def test_le_premier_releve_se_dit_premier_et_n_invente_pas_d_ecarts(tmp_path: Path) -> None:
    _, premier, _ = _deux_releves(tmp_path)

    assert premier["premier"] is True
    assert "occupation" not in premier["cpu"]
    assert "fils" not in premier["moteurs"][0]


def test_le_moteur_se_rattache_a_son_conteneur_et_a_sa_salle(tmp_path: Path) -> None:
    _, _, second = _deux_releves(tmp_path)

    (moteur,) = second["moteurs"]
    assert moteur["pid"] == RYUJINX
    assert moteur["moteur"] == "switch"
    assert moteur["conteneur"] == "nel3ab-switch-room-switch-kjwatM"
    assert moteur["salle"] == 1
    assert moteur["objets_gpu"] == {"objets": 2, "octets": 8192, "vram": 1, "gtt": 1}


def test_les_fils_du_moteur_se_rangent_du_plus_occupe_au_moins_occupe(tmp_path: Path) -> None:
    _, _, second = _deux_releves(tmp_path)

    rendu, gpu = second["moteurs"][0]["fils"]
    assert rendu == {
        "nom": "GUI.RenderLoop",
        "tid": RENDU,
        "cpu_pct": 93.0,
        "coeur": 5,
        "preemptions_s": 8.0,
        "attentes_s": 293.0,
    }
    assert gpu["nom"] == "GPU.MainThread"
    assert gpu["cpu_pct"] == 55.0


def test_les_ecarts_se_calculent_sur_l_intervalle_reel(tmp_path: Path) -> None:
    _, _, second = _deux_releves(tmp_path)
    (moteur,) = second["moteurs"]

    assert second["intervalle_s"] == 1.0
    assert second["cpu"]["occupation"]["cpu0"] == 75.0
    assert moteur["cpu_pct"] == 180.0
    assert moteur["cgroup"] == {"cpu_pct": 180.0, "brides": 2, "bride_ms": 5.0}
    assert moteur["disque_kio_s"] == [10.0, 0.0]
    assert second["reseau_kio_s"] == {"enp6s0": [50.0, 20.0]}
    assert second["entourage"]["nel3ab-worker"] == {
        "processus": 1,
        "objets_gpu": 1,
        "cpu_pct": 9.0,
    }


def test_un_processus_etranger_n_entre_pas_dans_le_releve(tmp_path: Path) -> None:
    """Le jumeau: `bash` brûle 1000 % dans la fausse machine et n'apparaît nulle part."""
    _, _, second = _deux_releves(tmp_path)

    assert [moteur["pid"] for moteur in second["moteurs"]] == [RYUJINX]
    assert set(second["entourage"]) == {"nel3ab-worker"}


@pytest.mark.parametrize(
    ("comm", "suivi"),
    [
        # Le serveur X que Sway démarre pour Xenia depuis le 21 novembre 2026
        # (`NEL3AB_SWAY_X11`): l'image de la salle Xbox 360 passe par lui.
        ("Xwayland", True),
        ("sway", True),
        # Les jumeaux: un autre serveur X, et un nom voisin, ne sont pas suivis.
        ("Xorg", False),
        ("Xwayland-test", False),
    ],
)
def test_l_entourage_suit_le_serveur_x_de_la_salle_xbox_360(
    tmp_path: Path, comm: str, suivi: bool
) -> None:
    machine = Machine(tmp_path)
    proche = 800
    _ecrire(machine.r.proc / str(proche) / "comm", f"{comm}\n")
    _ecrire(machine.r.proc / str(proche) / "stat", _stat(proche, comm, 0))
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    releveur.prendre()
    _ecrire(machine.r.proc / str(proche) / "stat", _stat(proche, comm, 12))
    machine.avancer(1)
    horloge.t += 1.0

    entourage = releveur.prendre()["entourage"]

    assert (comm in entourage) is suivi, entourage
    assert entourage.get(comm, {}).get("cpu_pct") == (12.0 if suivi else None)
    assert "nel3ab-worker" in entourage, "le reste de l'entourage est toujours là"


@pytest.mark.parametrize(
    ("comm", "role"),
    [
        ("eden-cli", "switch2"),
        # Xenia Edge, registered on 2026-11-21 when the Xbox 360 became playable.
        ("xenia_edge", "x360"),
    ],
)
def test_an_adapter_engine_is_an_active_game_and_never_reads_the_gpu_allocator(
    tmp_path: Path, comm: str, role: str
) -> None:
    """A real scanner must protect an Eden or Xenia game, not only a mocked engine list."""
    machine = Machine(tmp_path / "machine")
    _ecrire(machine.r.proc / str(RYUJINX) / "comm", f"{comm}\n")
    clock = Horloge()
    reader = Releveur(machine.r, horloge=clock, soi=SOI, tics_par_seconde=100)
    assert reader.moteur_en_cours()
    settings = Settings(
        worker_url="http://127.0.0.1:1",
        worker_control="127.0.0.1:1",
        journal_dir=tmp_path / "sessions",
        boite_noire_dir=tmp_path / "blackbox",
    )
    journal = Journal(settings.boite_noire_dir / "releves", 7, "UTC")
    blackbox = BoiteNoire(
        settings,
        reader,
        Mock(),
        journal,
        Suiveur(settings.journal_dir, UTC),
        Declencheur(),
        Mock(),
        horloge=clock,
    )
    assert blackbox.tour() == settings.boite_noire_pas_partie_s
    log = next((settings.boite_noire_dir / "releves").glob("*.jsonl"))
    line = json.loads(log.read_text().splitlines()[0])
    assert "allocateur_vram" not in line
    assert line["moteurs"][0]["moteur"] == role
    assert line["moteurs"][0]["salle"] == 1
    # The negative twin: a shell left in the same container is not a game.
    _ecrire(machine.r.proc / str(RYUJINX) / "comm", "bash\n")
    clock.t += 61
    assert not reader.moteur_en_cours()
    assert blackbox.tour() == settings.boite_noire_pas_repos_s
    assert "allocateur_vram" in json.loads(log.read_text().splitlines()[-1])


def test_le_gpu_et_les_capteurs_se_lisent(tmp_path: Path) -> None:
    _, _, second = _deux_releves(tmp_path)

    assert second["gpu"] == {
        "occupe_pct": 42,
        "horloge": "700Mhz",
        "horloge_memoire": "1094Mhz",
        "profil": "VIDEO",
        "niveau": "auto",
        "vram_mio": 667,
        "gtt_mio": 116,
    }
    assert second["capteurs"] == {
        "k10temp/Tctl": 81.2,
        "amdgpu/power1_w": 23.0,
        "amdgpu/sclk_mhz": 696.0,
    }
    assert second["allocateur_vram"]["libre_efface_mio"] == 895


def test_la_boite_noire_dit_ce_qu_elle_a_coute(tmp_path: Path) -> None:
    _, _, second = _deux_releves(tmp_path)

    assert second["boite_noire"]["cpu_pct"] == 1.0
    assert second["boite_noire"]["duree_ms"] == 0.0


def test_un_debugfs_illisible_retire_l_allocateur_sans_casser_le_releve(tmp_path: Path) -> None:
    machine = Machine(tmp_path)
    (machine.r.dri / "amdgpu_vram_mm").unlink()
    (machine.r.dri / "amdgpu_gem_info").unlink()

    ligne = Releveur(machine.r, horloge=Horloge(), soi=SOI, tics_par_seconde=100).prendre()

    assert "allocateur_vram" not in ligne
    assert "objets_gpu" not in ligne["moteurs"][0]
    assert ligne["gpu"]["horloge"] == "700Mhz"


def test_un_moteur_qui_disparait_entre_deux_releves_ne_casse_rien(tmp_path: Path) -> None:
    machine = Machine(tmp_path)
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    releveur.prendre()

    (machine.r.proc / str(RYUJINX) / "stat").unlink()
    horloge.t += 1.0
    second = releveur.prendre()

    assert second["moteurs"] == []
    assert releveur.moteur_en_cours() is True  # le `comm` reste: le processus finit de mourir


def test_sans_emulateur_il_n_y_a_pas_de_moteur_en_cours(tmp_path: Path) -> None:
    machine = Machine(tmp_path)
    (machine.r.proc / str(RYUJINX) / "comm").write_text("bash\n")

    assert Releveur(machine.r, horloge=Horloge(), soi=SOI).moteur_en_cours() is False


def test_sans_allocateur_le_releve_ne_lit_pas_le_debugfs(tmp_path: Path) -> None:
    """La lecture coûteuse est à la demande; le reste du relevé ne change pas."""
    machine = Machine(tmp_path)
    releveur = Releveur(machine.r, horloge=Horloge(), soi=SOI, tics_par_seconde=100)

    ligne = releveur.prendre(avec_allocateur=False)

    assert "allocateur_vram" not in ligne
    assert "objets_gpu" not in ligne["moteurs"][0]
    assert ligne["gpu"]["horloge"] == "700Mhz"
    assert "allocateur_vram" in releveur.prendre(avec_allocateur=True)


def test_un_moteur_lance_entre_deux_releves_est_vu_au_suivant(tmp_path: Path) -> None:
    """Le cache des noms ne doit pas rendre aveugle à une partie qui commence."""
    machine = Machine(tmp_path)
    (machine.r.proc / str(RYUJINX) / "comm").write_text("bash\n")
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    assert releveur.prendre()["moteurs"] == []

    nouveau = machine.r.proc / "5555"
    (nouveau / "task").mkdir(parents=True)
    (nouveau / "comm").write_text("dolphin-emu-nog\n")
    (nouveau / "stat").write_text(_stat(5555, "dolphin-emu-nog", 10))
    horloge.t += 2.0

    assert [moteur["moteur"] for moteur in releveur.prendre()["moteurs"]] == ["dolphin"]


def test_un_processus_qui_change_de_nom_sans_changer_de_pid_est_vu_sous_trente_secondes(
    tmp_path: Path,
) -> None:
    """Le jumeau du cache: un `exec` garde le pid, et le nom finit par être relu."""
    machine = Machine(tmp_path)
    (machine.r.proc / str(RYUJINX) / "comm").write_text("bash\n")
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    releveur.prendre()

    (machine.r.proc / str(RYUJINX) / "comm").write_text("Ryujinx\n")
    horloge.t += 2.0
    assert releveur.prendre()["moteurs"] == []
    horloge.t += 30.0
    assert [moteur["pid"] for moteur in releveur.prendre()["moteurs"]] == [RYUJINX]


# --- Le temps volé -------------------------------------------------------------
#
# Le 26 novembre 2026, rien dans un relevé ne disait si un fil de Ryujinx avait
# attendu un cœur, ni si la machine avait compacté sa mémoire pendant un trou: un
# gel causé par la machine ressemblait à un gel du jeu.


def _voler(machine: Machine, file_ns: int, compact: int, pression_us: int) -> None:
    """Les compteurs du temps volé, à une valeur connue."""
    p = machine.r.proc
    _ecrire(
        p / str(RYUJINX) / "task" / str(RENDU) / "schedstat",
        f"{93 * 10_000_000} {file_ns} 4242\n",
    )
    _ecrire(
        p / "vmstat",
        f"nr_free_pages 1423206\npswpin 488907\nallocstall_normal 300\n"
        f"allocstall_movable 15653\npgmajfault 19387135\ncompact_stall {compact}\n"
        "thp_fault_fallback 3966\n",
    )
    for genre in ("cpu", "memory", "io"):
        _ecrire(
            p / "pressure" / genre,
            f"some avg10=1.95 avg60=1.40 avg300=1.25 total={pression_us}\n"
            f"full avg10=0.00 avg60=0.00 avg300=0.00 total={pression_us // 2}\n",
        )
    _ecrire(
        machine.r.cgroup / f"system.slice/docker-{DOCKER_ID}.scope" / "cpu.pressure",
        f"some avg10=0.01 avg60=0.35 avg300=0.47 total={2 * pression_us}\n"
        f"full avg10=0.01 avg60=0.33 avg300=0.42 total={pression_us}\n",
    )


def _deux_releves_voles(tmp_path: Path) -> tuple[Machine, dict, dict]:
    """Deux relevés à deux secondes d'écart, avec le temps volé qui avance."""
    machine = Machine(tmp_path)
    _voler(machine, file_ns=1_000_000_000, compact=10, pression_us=4_000_000)
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    premier = releveur.prendre()
    machine.avancer(1)
    _voler(machine, file_ns=1_050_000_000, compact=13, pression_us=4_250_000)
    horloge.t += 2.0
    return machine, premier, releveur.prendre()


def test_l_attente_en_file_d_un_fil_se_dit_en_ms_par_seconde(tmp_path: Path) -> None:
    """50 ms d'attente en deux secondes: 25 ms par seconde."""
    _, _, second = _deux_releves_voles(tmp_path)

    rendu = next(fil for fil in second["moteurs"][0]["fils"] if fil["tid"] == RENDU)
    assert rendu["file_ms_s"] == 25.0


def test_un_fil_sans_schedstat_lisible_n_a_pas_d_attente_en_file(tmp_path: Path) -> None:
    """Le jumeau: le second fil n'a pas de `schedstat`, et un champ absent n'est pas 0."""
    machine, _, second = _deux_releves_voles(tmp_path)
    gpu = next(fil for fil in second["moteurs"][0]["fils"] if fil["tid"] == AUTRE_FIL)
    assert "file_ms_s" not in gpu

    # Et un `schedstat` qui devient illisible ne rend pas zéro non plus.
    _ecrire(machine.r.proc / str(RYUJINX) / "task" / str(RENDU) / "schedstat", "illisible\n")
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    releveur.prendre()
    horloge.t += 2.0
    rendu = next(f for f in releveur.prendre()["moteurs"][0]["fils"] if f["tid"] == RENDU)
    assert "file_ms_s" not in rendu


def test_les_compactions_de_la_memoire_se_comptent_par_releve(tmp_path: Path) -> None:
    _, premier, second = _deux_releves_voles(tmp_path)

    assert "vmstat" not in premier
    assert second["vmstat"] == {
        "compact_stall": 3,
        "allocstall_normal": 0,
        "allocstall_movable": 0,
        "pgmajfault": 0,
        "pswpin": 0,
        "thp_fault_fallback": 0,
    }


def test_la_pression_se_dit_en_ms_attendues_pendant_le_releve(tmp_path: Path) -> None:
    """`total=` compte des microsecondes depuis le démarrage: 250 000 µs de plus
    font 250 ms d'attente pendant le relevé, pour la machine comme pour le
    conteneur du moteur."""
    _, _, second = _deux_releves_voles(tmp_path)

    assert second["pression_ms"] == {
        "cpu": {"some": 250.0, "full": 125.0},
        "memory": {"some": 250.0, "full": 125.0},
        "io": {"some": 250.0, "full": 125.0},
    }
    assert second["moteurs"][0]["cgroup_pression_ms"] == {"some": 500.0, "full": 250.0}


def test_sans_ces_fichiers_le_releve_ne_dit_rien_du_temps_vole(tmp_path: Path) -> None:
    """Le jumeau des trois précédents: la machine des autres essais n'a ni vmstat ni
    schedstat ni `cpu.pressure` de conteneur, et sa pression n'a qu'une ligne
    `some`, dont le total ne bouge pas. Le zéro de `some` est mesuré; `full`, qui
    n'est pas écrit, reste absent."""
    _, _, second = _deux_releves(tmp_path)

    assert "vmstat" not in second
    assert second["pression_ms"] == {genre: {"some": 0.0} for genre in ("cpu", "memory", "io")}
    assert "cgroup_pression_ms" not in second["moteurs"][0]
    assert all("file_ms_s" not in fil for fil in second["moteurs"][0]["fils"])


def test_un_compteur_lu_seulement_au_second_releve_n_a_pas_d_ecart(tmp_path: Path) -> None:
    """Le jumeau des écarts: un compteur que la première lecture n'a pas vu n'a pas
    d'écart. Compter depuis zéro rendrait ici 56 369 compactions et une pression
    de toute la vie de la machine en deux secondes."""
    machine = Machine(tmp_path)
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    _ecrire(machine.r.proc / "vmstat", "pswpin 488907\n")
    releveur.prendre()
    machine.avancer(1)
    _voler(machine, file_ns=1_050_000_000, compact=56369, pression_us=4_250_000)
    horloge.t += 2.0

    second = releveur.prendre()

    assert second["vmstat"] == {"pswpin": 0}
    # La ligne `full` n'existait pas à la première lecture: seul `some` a un écart.
    assert second["pression_ms"] == {genre: {"some": 4250.0} for genre in ("cpu", "memory", "io")}
    assert "cgroup_pression_ms" not in second["moteurs"][0]
    rendu = next(fil for fil in second["moteurs"][0]["fils"] if fil["tid"] == RENDU)
    assert "file_ms_s" not in rendu


def test_les_pages_sales_se_relevent_a_chaque_releve(tmp_path: Path) -> None:
    machine = Machine(tmp_path)
    _ecrire(machine.r.proc / "meminfo", (ECHANTILLONS / "meminfo_sale.txt").read_text())

    ligne = Releveur(machine.r, horloge=Horloge(), soi=SOI, tics_par_seconde=100).prendre()

    assert ligne["pages_sales_mio"] == {"sales": 114, "ecriture": 0}


# --- Le noyau -------------------------------------------------------------------
#
# Le noyau 7.0.0-44 a été installé le 26 novembre 2026 et attend un redémarrage.
# Deux phases de part et d'autre de ce redémarrage ne se distingueraient pas: un
# autre amdgpu et un autre ordonnanceur, et rien dans le relevé ne le disait.


def test_chaque_releve_note_son_noyau(tmp_path: Path) -> None:
    machine = Machine(tmp_path)
    _ecrire(machine.r.proc / "sys/kernel/osrelease", "7.0.0-43-generic\n")
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)

    premier = releveur.prendre()
    machine.avancer(1)
    horloge.t += 2.0
    second = releveur.prendre()

    assert (premier["noyau"], second["noyau"]) == ("7.0.0-43-generic", "7.0.0-43-generic")


def test_un_noyau_illisible_reste_absent(tmp_path: Path) -> None:
    """Le jumeau: sans `osrelease`, pas de champ, et pas un noyau inventé."""
    _, premier, second = _deux_releves(tmp_path)

    assert "noyau" not in premier
    assert "noyau" not in second


def test_un_pid_disparu_est_oublie(tmp_path: Path) -> None:
    import shutil

    machine = Machine(tmp_path)
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    assert releveur.moteur_en_cours() is True

    shutil.rmtree(machine.r.proc / str(RYUJINX))
    horloge.t += 2.0
    assert releveur.moteur_en_cours() is False
