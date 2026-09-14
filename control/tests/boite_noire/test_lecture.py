"""Les formats de la machine, lus sur des extraits RÉELS de lgf.

Les échantillons de `echantillons/` ont été copiés sur la machine le 14 septembre
2026, sous le noyau 7.0, sauf l'allocateur du 6.8 et `amdgpu_gem_info`, recopiés
tels qu'ils avaient été affichés pendant l'enquête du 13 septembre. Un format
inventé pour un test ne prouve que la fonction lit ce qu'on imagine; un format
relevé prouve qu'elle lit ce que le noyau écrit. Le palier `S: 0Mhz *` du GPU au
repos n'aurait jamais été imaginé, et il cassait la première version.
"""

from pathlib import Path

from nel3ab_control.boite_noire import lecture

ECHANTILLONS = Path(__file__).parent / "echantillons"


def _texte(nom: str) -> str:
    return (ECHANTILLONS / nom).read_text(encoding="utf-8")


def _section(nom_fichier: str, section: str) -> str:
    """Une section `== nom` d'un échantillon qui en regroupe plusieurs."""
    blocs = _texte(nom_fichier).split("== ")
    (bloc,) = [bloc for bloc in blocs if bloc.split("\n", 1)[0].strip() == section]
    return bloc.split("\n", 1)[1]


def test_le_temps_de_chaque_coeur_se_lit_et_l_attente_disque_compte_comme_repos() -> None:
    temps = lecture.temps_cpu(_texte("proc_stat.txt"))

    assert sorted(temps) == sorted(["cpu"] + [f"cpu{n}" for n in range(12)])
    # cpu0: user+nice+system+idle+iowait+irq+softirq+steal, et idle+iowait.
    assert temps["cpu0"] == (2260948, 2231202)


def test_les_lignes_qui_ne_sont_pas_des_coeurs_sont_ignorees() -> None:
    assert "intr" not in lecture.temps_cpu(_texte("proc_stat.txt"))
    assert lecture.temps_cpu("cpu0 un deux trois\n") == {}


def test_l_occupation_se_calcule_entre_deux_lectures() -> None:
    avant = {"cpu0": (1000, 800), "cpu1": (1000, 800)}
    apres = {"cpu0": (1100, 850), "cpu1": (1000, 800), "cpu2": (50, 10)}

    # cpu0: 100 tics écoulés dont 50 au repos. cpu1: rien d'écoulé, pas de
    # division par zéro. cpu2: absent avant, pas de valeur inventée.
    assert lecture.occupation(avant, apres) == {"cpu0": 50.0}


def test_les_frequences_se_lisent_dans_l_ordre_des_coeurs() -> None:
    assert lecture.frequences(_texte("cpuinfo.txt")) == [4102, 3278, 1723]


def test_la_pression_dit_some_et_full() -> None:
    assert lecture.pression(_section("pressure.txt", "io")) == {"some": 0.04, "full": 0.04}
    assert lecture.pression(_section("pressure.txt", "cpu")) == {"some": 0.0, "full": 0.0}
    assert lecture.pression("rien de tel\n") == {}


def test_la_memoire_disponible_est_en_mio() -> None:
    assert lecture.memoire_disponible_mio(_texte("meminfo.txt")) == 61618192 // 1024
    assert lecture.memoire_disponible_mio("MemFree: 12 kB\n") is None


def test_le_reseau_se_lit_par_interface_sans_les_en_tetes() -> None:
    reseau = lecture.reseau(_texte("net_dev.txt"))

    assert reseau["enp6s0"] == (153963821, 170589049)
    assert reseau["tailscale0"] == (1693842, 1621200)
    assert not any("Inter" in nom or "face" in nom for nom in reseau)


def test_le_palier_de_veille_du_gpu_se_lit_aussi() -> None:
    """Le défaut que l'échantillon a trouvé: au repos, le palier s'appelle « S »."""
    assert lecture.niveau_actif(_section("gpu_sysfs.txt", "pp_dpm_sclk")) == "0Mhz"
    assert lecture.niveau_actif(_section("gpu_sysfs.txt", "pp_dpm_mclk")) == "96Mhz"
    assert lecture.niveau_actif("0: 500Mhz \n1: 700Mhz *\n2: 2765Mhz \n") == "700Mhz"


def test_sans_palier_marque_il_n_y_a_pas_de_palier() -> None:
    assert lecture.niveau_actif("0: 500Mhz \n1: 700Mhz \n") is None


def test_le_profil_d_energie_choisi_se_lit() -> None:
    profils = _section("gpu_sysfs.txt", "pp_power_profile_mode")

    assert lecture.profil_actif(profils) == "BOOTUP_DEFAULT"
    assert lecture.profil_actif(" 3          VIDEO*:\n") == "VIDEO"
    # Le jumeau: la ligne VIDEO sans étoile, telle qu'elle est dans l'échantillon.
    assert lecture.profil_actif(" 3          VIDEO :\n") is None


def test_l_allocateur_du_noyau_7_dit_aussi_la_memoire_deja_effacee() -> None:
    etat = lecture.allocateur_vram(_texte("amdgpu_vram_mm_7.0.txt"))

    assert etat["total_mio"] == 8176
    assert etat["libre_mio"] == 8160
    assert etat["libre_efface_mio"] == 895
    assert etat["blocs_libres"] == 362651
    assert etat["blocs_par_ordre"]["0"] == 119136
    assert etat["blocs_par_ordre"]["20"] == 0


def test_l_allocateur_du_noyau_6_8_n_a_pas_de_memoire_effacee() -> None:
    """Le format sert d'étiquette: sans `clear_free`, le relevé vient d'un 6.8."""
    etat = lecture.allocateur_vram(_texte("amdgpu_vram_mm_6.8.txt"))

    assert etat["total_mio"] == 8176
    assert "libre_efface_mio" not in etat
    assert etat["blocs_libres"] == 26


def test_un_allocateur_illisible_ne_rend_rien() -> None:
    assert lecture.allocateur_vram("Permission denied\n") == {}


def test_les_objets_gpu_s_additionnent_par_processus_et_par_placement() -> None:
    objets = lecture.objets_gpu(_texte("amdgpu_gem_info.txt"))

    # Ryujinx apparaît deux fois, une par fichier ouvert: ses objets s'ajoutent.
    assert objets[2360247] == {"objets": 4, "octets": 81920, "vram": 2, "gtt": 1}
    assert objets[2360343] == {"objets": 1, "octets": 2097152, "vram": 1, "gtt": 0}


def test_cpu_access_required_n_est_pas_un_placement() -> None:
    """Le jumeau: le premier mot après la taille décide, pas un mot plus loin."""
    ligne = "pid  7 command x:\n\t\t0x1:  4096 byte VRAM VISIBLE CPU_ACCESS_REQUIRED\n"
    assert lecture.objets_gpu(ligne)[7] == {"objets": 1, "octets": 4096, "vram": 1, "gtt": 0}


def test_un_fil_se_lit_avec_son_coeur_et_ses_preemptions() -> None:
    fil = lecture.fil(_texte("task_stat.txt"), _texte("task_status.txt"))

    assert fil == {
        "nom": "tailscaled",
        "tics": 73 + 82,
        "coeur": 4,
        "preemptions": 316,
        "attentes": 31834,
    }


def test_un_nom_de_fil_peut_contenir_des_parentheses() -> None:
    champs = " ".join(["R"] + ["0"] * 10 + ["5", "6"] + ["0"] * 23 + ["3"])
    fil = lecture.fil(f"12 (GUI.(Render)) {champs}")

    assert fil is not None
    assert fil["nom"] == "GUI.(Render)"
    assert (fil["tics"], fil["coeur"]) == (11, 3)


def test_un_fil_illisible_ne_rend_rien() -> None:
    assert lecture.fil("12 (court) R 1 2") is None
    assert lecture.fil("") is None


def test_les_octets_disque_d_un_processus_se_lisent() -> None:
    texte = "rchar: 99\nwchar: 98\nread_bytes: 4096\nwrite_bytes: 8192\n"
    assert lecture.io_processus(texte) == (4096, 8192)
    # Le jumeau: `rchar` et `wchar` comptent aussi les tuyaux et les sockets, pas le disque.
    assert lecture.io_processus("rchar: 99\nwchar: 98\n") is None


def test_le_chemin_du_cgroup_se_lit() -> None:
    assert lecture.cgroup_du_processus("0::/system.slice/nel3ab-control.service\n") == (
        "/system.slice/nel3ab-control.service"
    )
    assert lecture.cgroup_du_processus("12:cpu:/ancien\n") is None


def test_le_conteneur_se_lit_dans_le_cgroup() -> None:
    identifiant = "ab" * 32
    assert lecture.conteneur_du_cgroup(f"0::/system.slice/docker-{identifiant}.scope\n") == (
        identifiant
    )
    assert lecture.conteneur_du_cgroup("0::/user.slice/user-1000.slice\n") is None


def test_le_bridage_se_lit_dans_cpu_stat() -> None:
    compteurs = lecture.cpu_stat(_texte("cgroup_cpu_stat.txt"))

    assert compteurs["nr_throttled"] == 0
    assert compteurs["usage_usec"] == 2816956


def test_la_salle_d_un_conteneur_dolphin_vient_de_son_nom() -> None:
    config = '{"Name": "/nel3ab-dolphin-2", "Config": {"Labels": {}}}'
    assert lecture.conteneur(config) == {"nom": "nel3ab-dolphin-2", "salle": 2}


def test_la_salle_d_un_conteneur_switch_vient_de_son_etiquette() -> None:
    config = (
        '{"Name": "/nel3ab-switch-room-switch-kjwatM", "Config": {"Labels": '
        '{"nel3ab.room-root": "/home/souhib/.local/state/nel3ab/salles/1"}}}'
    )
    assert lecture.conteneur(config) == {"nom": "nel3ab-switch-room-switch-kjwatM", "salle": 1}


def test_un_conteneur_hors_salle_n_a_pas_de_salle() -> None:
    assert lecture.conteneur('{"Name": "/traefik", "Config": {"Labels": {}}}') == {
        "nom": "traefik",
        "salle": None,
    }
    # Le jumeau du nom: « nel3ab-dolphin-2x » n'est pas la salle 2.
    assert lecture.conteneur('{"Name": "/nel3ab-dolphin-2x"}') == {
        "nom": "nel3ab-dolphin-2x",
        "salle": None,
    }
    assert lecture.conteneur("pas du json") is None
    assert lecture.conteneur("[1, 2]") is None
