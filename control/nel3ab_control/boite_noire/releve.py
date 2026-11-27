"""Un relevé de la machine: ce qu'un instant dit, et ce qui a changé depuis le précédent.

Ce module est la seule partie de la boîte noire qui ouvre des fichiers système, et
il n'en écrit aucun. Chaque chemin part d'une `Racines`, pour qu'un test lui donne
un faux `/proc` et un faux `/sys` dans un dossier temporaire: le relevé se prouve
alors sans GPU, sans émulateur et sans droits.

# Ce qu'il retient, et pourquoi

Ce qui a manqué le 13 septembre 2026, dans l'ordre où il a fallu le chercher:

- le processeur par cœur, sa fréquence et sa température: la première hypothèse
  était la chaleur;
- chaque fil de l'émulateur, avec son cœur et ses préemptions forcées: le goulot
  était `GUI.RenderLoop`, saturé à 93 %, qui n'attendait jamais un cœur libre;
- le GPU, son palier d'horloge, son profil d'énergie et sa puissance: il restait
  à 700 MHz sous le profil VIDEO;
- l'allocateur de la mémoire vidéo et les objets GPU de chaque processus: c'était
  la cause;
- le bridage du conteneur, la pression, les octets disque et réseau: écartés un
  par un, et un relevé les écarte d'un coup d'oeil.

Chaque ligne dit aussi ce qu'elle a coûté (`boite_noire`), mesuré et pas supposé.

# Un processus peut disparaître entre deux lectures

Une partie qui se ferme, un fil qui se termine: un fichier de `/proc` lu une
milliseconde trop tard n'existe plus. Chaque lecture manquée est une valeur
absente, jamais une exception.
"""

import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from nel3ab_control.boite_noire import lecture
from nel3ab_control.consoles import CONSOLES

#: Les moteurs, par le nom court que le noyau donne à leur processus (quinze
#: caractères au plus: `dolphin-emu-nogui` devient `dolphin-emu-nog`).
#: Eden is the Switch 2 adapter's process name. Missing it marked a real game
#: idle and allowed debugfs reads during Zelda on 2026-11-07. Those reads can
#: stall rendering; this list also governs their exclusion, not just metrics.
#:
#: Lus dans le manifeste des consoles depuis le 21 novembre 2026 (ADR D22): une
#: console jouable dont le moteur n'a aucun nom de processus y est refusée, donc
#: l'oubli du 7 novembre ne peut plus se reproduire en silence.
MOTEURS = CONSOLES.processes()

#: Ce qui entoure une partie et peut lui prendre du processeur ou de la mémoire
#: vidéo: le worker, les deux enregistreurs de la capture Switch, le compositeur,
#: le son, et le serveur X que Sway démarre pour Xenia (`NEL3AB_SWAY_X11`). Depuis
#: le 21 novembre 2026, l'image d'une salle Xbox 360 passe par Xwayland avant
#: Sway; il manquait ici, et un relevé ne disait rien de ce qu'il coûtait.
#: `Xwayland` est le nom de l'exécutable que wlroots lance (paquet `xwayland`
#: de l'image), donc celui que le noyau garde dans `comm`.
ENTOURAGE = ("nel3ab-worker", "nel3ab-wf-recor", "sway", "Xwayland", "pulseaudio", "parec")

#: Les voisins qui peuvent prendre la carte d'une partie, par le nom de leur
#: processus et celui de leur parent. Jellyfin transcode en VAAPI et en Vulkan sur
#: renderD128, la carte des salles: le 23 novembre 2026 de 19:44 à 21:33 UTC, en
#: soirée, et les 10 et 11 novembre un transcodage avait fait passer Zelda (Switch 2)
#: de 30 à 13-17 images par seconde. Un `ffmpeg` qui n'est pas son enfant n'est
#: pas suivi. ollama, l'autre voisin, se lit dans `Racines.kfd`. On ne touche ni
#: à l'un ni à l'autre: on les nomme.
VOISINS = {"ffmpeg": "jellyfin"}

#: Les interfaces réseau dont le débit se garde. Les ponts et les paires `veth`
#: de Docker se comptent par dizaines sur cette machine et ne disent rien d'une
#: partie qu'`enp6s0` et `tailscale0` ne disent pas déjà.
IGNOREES = ("lo", "veth", "br-")

#: Tous les combien de secondes relire le nom de chaque processus, pas seulement
#: celui des nouveaux. Voir `Releveur._scanner`.
RELIRE_NOMS_S = 30.0


@dataclass(frozen=True)
class Racines:
    """Où lire la machine. Les valeurs par défaut sont celles de lgf."""

    proc: Path = Path("/proc")
    carte: Path = Path("/sys/class/drm/card0/device")
    hwmon: Path = Path("/sys/class/hwmon")
    dri: Path = Path("/sys/kernel/debug/dri/0")
    cgroup: Path = Path("/sys/fs/cgroup")
    docker: Path = Path("/var/lib/docker/containers")
    #: Un dossier par processus qui tient la carte par ROCm (`/dev/kfd`), nommé par
    #: son pid. Lisible par tous, root compris: c'est par lui qu'on voit ollama.
    kfd: Path = Path("/sys/class/kfd/kfd/proc")


@dataclass
class _Instant:
    """Ce qu'une lecture a vu, avant tout calcul d'écart."""

    t: float
    cpu: dict[str, tuple[int, int]]
    processus: dict[int, dict[str, Any]] = field(default_factory=dict)
    fils: dict[int, dict[int, dict[str, Any]]] = field(default_factory=dict)
    cgroups: dict[int, dict[str, int]] = field(default_factory=dict)
    disque: dict[int, tuple[int, int]] = field(default_factory=dict)
    reseau: dict[str, tuple[int, int]] = field(default_factory=dict)
    soi: int | None = None
    #: Les compteurs de mémoire de `/proc/vmstat` (`lecture.VMSTAT_GARDES`).
    vmstat: dict[str, int] = field(default_factory=dict)
    #: Par genre, les moyennes sur dix secondes et les totaux en microsecondes.
    pression: dict[str, dict[str, float]] = field(default_factory=dict)
    pression_totale: dict[str, dict[str, int]] = field(default_factory=dict)
    #: Le `cpu.pressure` du cgroup de chaque moteur, en totaux.
    cgroups_pression: dict[int, dict[str, int]] = field(default_factory=dict)


def _lire(chemin: Path) -> str | None:
    """Le texte d'un fichier, ou rien s'il ne se lit pas.

    Par `os.open` et `os.read` plutôt que `Path.read_text`, pour que le
    `schedstat` de chaque fil ne rallonge pas le relevé. Mesuré le 27 novembre
    2026 sur lgf au repos, un processus de 123 fils pris pour moteur, en huit
    tours alternés de vingt-cinq relevés, deux fois: médiane d'un relevé 18,9 ms
    avant ce changement, 22,0 et 22,3 ms avec le `schedstat` lu par `read_text`,
    18,5 et 18,4 ms ainsi. Le relevé reste sous les 30 ms qu'on s'est fixés.
    """
    try:
        fd = os.open(chemin, os.O_RDONLY | os.O_CLOEXEC)
    except OSError:
        return None
    try:
        morceaux: list[bytes] = []
        while morceau := os.read(fd, 65536):
            morceaux.append(morceau)
    except OSError:
        return None
    finally:
        os.close(fd)
    return b"".join(morceaux).decode("utf-8", errors="replace")


class Releveur:
    """Prend des relevés successifs et rend, pour chacun, une ligne prête à écrire."""

    def __init__(
        self,
        racines: Racines | None = None,
        horloge: Callable[[], float] = time.monotonic,
        soi: int | None = None,
        tics_par_seconde: int | None = None,
        fils_gardes: int = 24,
    ) -> None:
        self._r = racines or Racines()
        self._horloge = horloge
        self._soi = os.getpid() if soi is None else soi
        self._hz = tics_par_seconde or os.sysconf("SC_CLK_TCK")
        self._fils_gardes = fils_gardes
        self._precedent: _Instant | None = None
        #: Le nom et la salle de chaque conteneur, lus une fois: `config.v2.json`
        #: ne change pas pendant la vie d'un conteneur.
        self._conteneurs: dict[str, dict[str, Any] | None] = {}
        #: Le rôle de chaque pid vu, `None` pour ceux qui n'intéressent pas le relevé.
        self._roles: dict[int, str | None] = {}
        self._dernier_scan = float("-inf")

    def moteur_en_cours(self) -> bool:
        """Un émulateur tourne-t-il? Sert à choisir le pas entre deux relevés."""
        return any(role in MOTEURS.values() for role in self._scanner().values())

    def prendre(self, avec_allocateur: bool = True) -> dict[str, Any]:
        """Un relevé, et ses écarts avec le précédent.

        `avec_allocateur` lit en plus `amdgpu_vram_mm` et `amdgpu_gem_info`. Ces deux
        fichiers ne sont pas gratuits: le 14 septembre 2026, lire le premier prenait
        environ 35 ms dans le noyau, qui parcourait 362 651 blocs libres, sans doute
        sous le verrou que l'émulateur prend mille fois par seconde. La boucle ne les
        lit donc qu'une fois par minute, et pendant les captures.
        """
        debut = self._horloge()
        instant = self._instant(debut)
        ligne = self._absolus(instant, avec_allocateur)
        precedent = self._precedent
        if precedent is None:
            ligne["premier"] = True
        else:
            self._ecarts(ligne, precedent, instant)
        self._precedent = instant
        ligne.setdefault("boite_noire", {})["duree_ms"] = round((self._horloge() - debut) * 1000, 1)
        return ligne

    # -- lecture ---------------------------------------------------------------

    def _scanner(self) -> dict[int, str]:
        """Les processus qui intéressent un relevé, par pid, avec leur rôle.

        Le nom d'un processus n'est lu que pour un pid NOUVEAU, et relu pour tous
        toutes les trente secondes. Le 14 septembre 2026, relire les 380 `comm` de la
        machine à chaque relevé prenait 59 % du temps d'un relevé (cProfile sur trente
        relevés: 473 ms sur 804). Les trente secondes rattrapent un processus qui
        change de nom par `exec` sans changer de pid.
        """
        try:
            pids = {int(nom) for nom in os.listdir(self._r.proc) if nom.isdigit()}
        except OSError:
            return {}
        maintenant = self._horloge()
        tout_relire = maintenant - self._dernier_scan >= RELIRE_NOMS_S
        if tout_relire:
            self._dernier_scan = maintenant
        for pid in [pid for pid in self._roles if pid not in pids]:
            del self._roles[pid]
        for pid in pids:
            if tout_relire or pid not in self._roles:
                nom = (_lire(self._r.proc / str(pid) / "comm") or "").strip()
                self._roles[pid] = (
                    MOTEURS.get(nom)
                    or (nom if nom in ENTOURAGE else None)
                    or (self._voisin(pid, nom) if nom in VOISINS else None)
                )
        return {pid: role for pid, role in self._roles.items() if role is not None}

    def _voisin(self, pid: int, nom: str) -> str | None:
        """« jellyfin/ffmpeg » pour un `ffmpeg` enfant de Jellyfin, sinon rien.

        Une lecture de `stat` et une de `comm` de plus, pour un processus `ffmpeg`
        nouveau seulement: le coût du relevé ne bouge pas sans transcodage.
        """
        pere = lecture.parent(_lire(self._r.proc / str(pid) / "stat") or "")
        if pere is None:
            return None
        nom_pere = (_lire(self._r.proc / str(pere) / "comm") or "").strip()
        return f"{nom_pere}/{nom}" if nom_pere == VOISINS[nom] else None

    def _instant(self, t: float) -> _Instant:
        instant = _Instant(t=t, cpu=lecture.temps_cpu(_lire(self._r.proc / "stat") or ""))
        instant.reseau = {
            nom: valeurs
            for nom, valeurs in lecture.reseau(_lire(self._r.proc / "net/dev") or "").items()
            if not nom.startswith(IGNOREES)
        }
        soi = lecture.fil(_lire(self._r.proc / str(self._soi) / "stat") or "")
        instant.soi = soi["tics"] if soi else None
        instant.vmstat = lecture.vmstat(_lire(self._r.proc / "vmstat") or "")
        for genre in ("cpu", "memory", "io"):
            texte = _lire(self._r.proc / "pressure" / genre) or ""
            instant.pression[genre] = lecture.pression(texte)
            instant.pression_totale[genre] = lecture.pression_totale(texte)
        for pid, role in self._scanner().items():
            base = self._r.proc / str(pid)
            etat = lecture.fil(_lire(base / "stat") or "")
            if etat is None:
                continue
            instant.processus[pid] = {"role": role, "tics": etat["tics"]}
            if role not in MOTEURS.values():
                continue
            instant.fils[pid] = self._fils(base)
            chemin = lecture.cgroup_du_processus(_lire(base / "cgroup") or "")
            if chemin:
                instant.processus[pid]["cgroup"] = chemin
                dossier = self._r.cgroup / chemin.lstrip("/")
                compteurs = lecture.cpu_stat(_lire(dossier / "cpu.stat") or "")
                if compteurs:
                    instant.cgroups[pid] = compteurs
                # L'attente de processeur du conteneur seul: celle de la machine
                # mélange tous ses services.
                pression = lecture.pression_totale(_lire(dossier / "cpu.pressure") or "")
                if pression:
                    instant.cgroups_pression[pid] = pression
            disque = lecture.io_processus(_lire(base / "io") or "")
            if disque:
                instant.disque[pid] = disque
        return instant

    def _fils(self, base: Path) -> dict[int, dict[str, Any]]:
        fils: dict[int, dict[str, Any]] = {}
        try:
            taches = list((base / "task").iterdir())
        except OSError:
            return fils
        for tache in taches:
            if not tache.name.isdigit():
                continue
            etat = lecture.fil(_lire(tache / "stat") or "", _lire(tache / "status") or "")
            if etat:
                file_ns = lecture.attente_en_file_ns(_lire(tache / "schedstat") or "")
                if file_ns is not None:
                    etat["file_ns"] = file_ns
                fils[int(tache.name)] = etat
        return fils

    def _conteneur(self, chemin_cgroup: str) -> dict[str, Any] | None:
        identifiant = lecture.conteneur_du_cgroup(chemin_cgroup)
        if identifiant is None:
            return None
        if identifiant not in self._conteneurs:
            texte = _lire(self._r.docker / identifiant / "config.v2.json")
            self._conteneurs[identifiant] = lecture.conteneur(texte) if texte else None
        return self._conteneurs[identifiant]

    # -- ce qu'un instant dit seul ---------------------------------------------

    def _absolus(self, instant: _Instant, avec_allocateur: bool) -> dict[str, Any]:
        r = self._r
        meminfo = _lire(r.proc / "meminfo") or ""
        ligne: dict[str, Any] = {
            "cpu": {
                "mhz": lecture.frequences(_lire(r.proc / "cpuinfo") or ""),
                "charge": (_lire(r.proc / "loadavg") or "").split()[:3],
            },
            "memoire_dispo_mio": lecture.memoire_disponible_mio(meminfo),
            "pression": instant.pression,
            "capteurs": self._capteurs(),
            "gpu": self._gpu(),
        }
        sales = lecture.pages_sales_mio(meminfo)
        if sales:
            ligne["pages_sales_mio"] = sales
        # Le noyau qui tourne. Le 26 novembre 2026, le 7.0.0-44 attendait un
        # redémarrage: deux phases de part et d'autre ne se distingueraient pas
        # sans ce champ, et `lire.comparer_phases` les refuse.
        noyau = (_lire(r.proc / "sys/kernel/osrelease") or "").strip()
        if noyau:
            ligne["noyau"] = noyau
        objets: dict[int, dict[str, int]] = {}
        if avec_allocateur:
            allocateur = lecture.allocateur_vram(_lire(r.dri / "amdgpu_vram_mm") or "")
            if allocateur:
                ligne["allocateur_vram"] = allocateur
            objets = lecture.objets_gpu(_lire(r.dri / "amdgpu_gem_info") or "")
        moteurs: list[dict[str, Any]] = []
        entourage: dict[str, dict[str, Any]] = {}
        voisins = self._voisins_gpu()
        for pid, infos in instant.processus.items():
            if infos["role"] == "jellyfin/ffmpeg":
                voisins["jellyfin_ffmpeg"].append({"pid": pid})
            elif infos["role"] in MOTEURS.values():
                moteur: dict[str, Any] = {"pid": pid, "moteur": infos["role"]}
                if "cgroup" in infos:
                    conteneur = self._conteneur(infos["cgroup"])
                    if conteneur:
                        moteur["conteneur"] = conteneur["nom"]
                        moteur["salle"] = conteneur["salle"]
                if pid in objets:
                    moteur["objets_gpu"] = objets[pid]
                moteur["nombre_fils"] = len(instant.fils.get(pid, {}))
                moteurs.append(moteur)
            else:
                role = entourage.setdefault(infos["role"], {"processus": 0})
                role["processus"] += 1
                if pid in objets:
                    role["objets_gpu"] = role.get("objets_gpu", 0) + objets[pid]["objets"]
        ligne["moteurs"] = moteurs
        ligne["entourage"] = entourage
        ligne["voisins_gpu"] = voisins
        return ligne

    def _voisins_gpu(self) -> dict[str, list[dict[str, Any]]]:
        """Qui d'autre que nel3ab peut tenir la carte: ROCm, et les transcodages.

        `kfd` liste les processus ROCm, root compris, et manque quand le dossier ne
        se lit pas: un dossier illisible ne se dit pas vide. Les processus qui
        tiennent renderD128 sans ROCm ne se voient qu'à la capture, par leurs
        descripteurs, et ceux de root, comme ollama, n'y sont pas lisibles.
        """
        voisins: dict[str, list[dict[str, Any]]] = {}
        try:
            pids = sorted(int(nom) for nom in os.listdir(self._r.kfd) if nom.isdigit())
        except OSError:
            pids = None
        if pids is not None:
            voisins["kfd"] = [
                {"pid": pid, "nom": (_lire(self._r.proc / str(pid) / "comm") or "").strip() or None}
                for pid in pids
            ]
        voisins["jellyfin_ffmpeg"] = []
        return voisins

    def _capteurs(self) -> dict[str, float]:
        """Les températures (°C), puissances (W) et ventilateurs (tr/min) de chaque puce."""
        capteurs: dict[str, float] = {}
        try:
            puces = sorted(self._r.hwmon.iterdir())
        except OSError:
            return capteurs
        for puce in puces:
            nom = (_lire(puce / "name") or puce.name).strip()
            try:
                fichiers = sorted(puce.iterdir())
            except OSError:
                continue
            for fichier in fichiers:
                if not fichier.name.endswith("_input") and fichier.name != "power1_average":
                    continue
                valeur = (_lire(fichier) or "").strip()
                if not valeur.lstrip("-").isdigit():
                    continue
                # `power1_average` n'a pas de suffixe `_input`: ramené à `power1`, pour que
                # la clé dise « amdgpu/power1_w » et pas « amdgpu/power1_average_w ».
                prefixe = fichier.name.removesuffix("_input").removesuffix("_average")
                etiquette = (_lire(puce / f"{prefixe}_label") or prefixe).strip()
                if prefixe.startswith("temp"):
                    capteurs[f"{nom}/{etiquette}"] = round(int(valeur) / 1000, 1)
                elif prefixe.startswith("power"):
                    capteurs[f"{nom}/{etiquette}_w"] = round(int(valeur) / 1_000_000, 1)
                elif prefixe.startswith("fan"):
                    capteurs[f"{nom}/{etiquette}_tr_min"] = float(int(valeur))
                elif prefixe.startswith("freq"):
                    capteurs[f"{nom}/{etiquette}_mhz"] = round(int(valeur) / 1_000_000, 1)
        return capteurs

    def _gpu(self) -> dict[str, Any]:
        carte = self._r.carte

        def entier(nom: str) -> int | None:
            texte = (_lire(carte / nom) or "").strip()
            return int(texte) if texte.isdigit() else None

        gpu: dict[str, Any] = {
            "occupe_pct": entier("gpu_busy_percent"),
            "horloge": lecture.niveau_actif(_lire(carte / "pp_dpm_sclk") or ""),
            "horloge_memoire": lecture.niveau_actif(_lire(carte / "pp_dpm_mclk") or ""),
            "profil": lecture.profil_actif(_lire(carte / "pp_power_profile_mode") or ""),
            "niveau": (_lire(carte / "power_dpm_force_performance_level") or "").strip() or None,
        }
        for cle, nom in (("vram_mio", "mem_info_vram_used"), ("gtt_mio", "mem_info_gtt_used")):
            octets = entier(nom)
            gpu[cle] = octets // 1_048_576 if octets is not None else None
        return gpu

    # -- ce qui a changé depuis le relevé précédent ----------------------------

    def _ecarts(self, ligne: dict[str, Any], avant: _Instant, apres: _Instant) -> None:
        duree = apres.t - avant.t
        if duree <= 0:
            return
        ligne["intervalle_s"] = round(duree, 3)
        ligne["cpu"]["occupation"] = lecture.occupation(avant.cpu, apres.cpu)
        ligne["reseau_kio_s"] = {
            nom: [
                round((recus - avant.reseau[nom][0]) / 1024 / duree, 1),
                round((envoyes - avant.reseau[nom][1]) / 1024 / duree, 1),
            ]
            for nom, (recus, envoyes) in apres.reseau.items()
            if nom in avant.reseau
        }
        if avant.soi is not None and apres.soi is not None:
            ligne.setdefault("boite_noire", {})["cpu_pct"] = self._pct(apres.soi - avant.soi, duree)
        # Le temps volé, en écarts par relevé. Un compteur absent d'une des deux
        # lectures reste absent: zéro voudrait dire « rien ne s'est passé ».
        memoire = _ecarts_communs(avant.vmstat, apres.vmstat)
        if memoire:
            ligne["vmstat"] = memoire
        pression = {
            genre: {
                cle: round(valeur / 1000, 1)
                for cle, valeur in _ecarts_communs(
                    avant.pression_totale.get(genre, {}), totaux
                ).items()
            }
            for genre, totaux in apres.pression_totale.items()
        }
        if any(pression.values()):
            ligne["pression_ms"] = {genre: ms for genre, ms in pression.items() if ms}
        for moteur in ligne["moteurs"]:
            pid = moteur["pid"]
            if pid in avant.processus:
                moteur["cpu_pct"] = self._pct(
                    apres.processus[pid]["tics"] - avant.processus[pid]["tics"], duree
                )
            moteur["fils"] = self._fils_ecarts(
                avant.fils.get(pid, {}), apres.fils.get(pid, {}), duree
            )
            if pid in avant.cgroups and pid in apres.cgroups:
                a, b = avant.cgroups[pid], apres.cgroups[pid]
                moteur["cgroup"] = {
                    "cpu_pct": round(
                        (b.get("usage_usec", 0) - a.get("usage_usec", 0)) / 1e4 / duree, 1
                    ),
                    "brides": b.get("nr_throttled", 0) - a.get("nr_throttled", 0),
                    "bride_ms": round(
                        (b.get("throttled_usec", 0) - a.get("throttled_usec", 0)) / 1000, 1
                    ),
                }
            attendu = _ecarts_communs(
                avant.cgroups_pression.get(pid, {}), apres.cgroups_pression.get(pid, {})
            )
            if attendu:
                moteur["cgroup_pression_ms"] = {
                    cle: round(valeur / 1000, 1) for cle, valeur in attendu.items()
                }
            if pid in avant.disque and pid in apres.disque:
                moteur["disque_kio_s"] = [
                    round((apres.disque[pid][i] - avant.disque[pid][i]) / 1024 / duree, 1)
                    for i in (0, 1)
                ]
        for voisin in ligne["voisins_gpu"]["jellyfin_ffmpeg"]:
            pid = voisin["pid"]
            if pid in avant.processus:
                voisin["cpu_pct"] = self._pct(
                    apres.processus[pid]["tics"] - avant.processus[pid]["tics"], duree
                )
        for role, infos in ligne["entourage"].items():
            total = sum(
                apres.processus[pid]["tics"] - avant.processus[pid]["tics"]
                for pid, etat in apres.processus.items()
                if etat["role"] == role and pid in avant.processus
            )
            infos["cpu_pct"] = self._pct(total, duree)

    def _fils_ecarts(
        self,
        avant: dict[int, dict[str, Any]],
        apres: dict[int, dict[str, Any]],
        duree: float,
    ) -> list[dict[str, Any]]:
        """Les fils les plus occupés, avec leur cœur et leurs préemptions par seconde.

        `file_ms_s` dit combien de millisecondes par seconde le fil a attendu un
        cœur alors qu'il était prêt (`run_delay`). Une préemption forcée compte
        les fois; ce nombre compte le temps.
        """
        fils: list[dict[str, Any]] = []
        for tid, etat in apres.items():
            if tid not in avant:
                continue
            un: dict[str, Any] = {
                "nom": etat["nom"],
                "tid": tid,
                "cpu_pct": self._pct(etat["tics"] - avant[tid]["tics"], duree),
                "coeur": etat["coeur"],
                "preemptions_s": round(
                    (etat["preemptions"] - avant[tid]["preemptions"]) / duree, 1
                ),
                "attentes_s": round((etat["attentes"] - avant[tid]["attentes"]) / duree, 1),
            }
            if "file_ns" in etat and "file_ns" in avant[tid]:
                un["file_ms_s"] = round((etat["file_ns"] - avant[tid]["file_ns"]) / 1e6 / duree, 1)
            fils.append(un)
        fils.sort(key=lambda un: -un["cpu_pct"])
        return fils[: self._fils_gardes]

    def _pct(self, tics: int, duree: float) -> float:
        return round(100 * tics / self._hz / duree, 1)


def _ecarts_communs(avant: dict[str, int], apres: dict[str, int]) -> dict[str, int]:
    """L'écart de chaque compteur lu dans les deux relevés, et d'aucun autre."""
    return {cle: valeur - avant[cle] for cle, valeur in apres.items() if cle in avant}
