"""Le relevé, contre un faux `/proc` et un faux `/sys`.

Sans GPU, sans émulateur et sans droits: la machine est un dossier temporaire
dont chaque fichier imite le format réel (voir `echantillons/`). Deux relevés
successifs, avec des compteurs qui avancent d'une quantité connue, prouvent les
écarts au dixième près.
"""

from pathlib import Path

from nel3ab_control.boite_noire.releve import Racines, Releveur

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


def test_un_pid_disparu_est_oublie(tmp_path: Path) -> None:
    import shutil

    machine = Machine(tmp_path)
    horloge = Horloge()
    releveur = Releveur(machine.r, horloge=horloge, soi=SOI, tics_par_seconde=100)
    assert releveur.moteur_en_cours() is True

    shutil.rmtree(machine.r.proc / str(RYUJINX))
    horloge.t += 2.0
    assert releveur.moteur_en_cours() is False
