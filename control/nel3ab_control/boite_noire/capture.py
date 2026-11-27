"""Ce qu'on prend quand une salle ralentit, et de temps en temps pour comparer.

# Ce qu'une capture contient

- un profil `perf` des fils les plus occupés de l'émulateur, pendant dix secondes;
- le compte des objets GPU créés pendant ces mêmes dix secondes;
- le journal du worker et les mesures des pages des trois dernières minutes;
- les processus qui tiennent la carte graphique (`gpu-detenteurs.json`), lus par
  le nom de leurs descripteurs, jamais par les statistiques du pilote;
- pour une chute dans une salle servie par un adaptateur (Switch, Switch 2,
  Xbox 360), l'image affichée à cet instant, sur l'affichage que la salle a
  écrit dans `display.json`;
- seulement si on le demande, l'allocateur de la mémoire vidéo et les objets GPU
  de chaque processus: le 14 septembre 2026, chaque lecture de ces fichiers du
  debugfs a arrêté l'image d'une partie en cours pendant une centaine de ms.

Le profil est aussitôt RÉSUMÉ en texte. Le 14 septembre 2026, les profils pris
sous le noyau 6.8 n'ont plus pu se relire sous le 7.0: `perf` résout les symboles
du noyau avec celui qui tourne, et rendait 0 % pour une fonction qui en prenait
16. Un résumé écrit au moment de la capture reste vrai après une mise à jour.

# Les captures périodiques

Un profil pris seulement pendant les chutes ne dit pas ce qui a CHANGÉ. Les mêmes
mesures prises quand tout va bien, toutes les dix minutes de partie, sont la
moitié qui permet de comparer.

# Aucune ne doit gêner la partie

Dix secondes à 199 échantillons par seconde sur trois fils, et chaque commande a
un délai au-delà duquel elle est abandonnée. Une commande qui échoue écrit son
code dans `capture.json` et la capture continue: un profil manquant vaut mieux
qu'une boîte noire arrêtée.
"""

import json
import os
import re
import subprocess  # lancer perf, journalctl et docker est le travail de ce module
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from nel3ab_control.boite_noire.releve import Racines
from nel3ab_control.consoles import CONSOLES

#: Ce qu'on compte pendant une capture, côté noyau.
#:
#: Les créations d'objets GPU disent la charge que Ryujinx met à l'allocateur;
#: les travaux soumis à l'ordonnanceur du GPU et les appels de soumission disent
#: si la carte reçoit encore du travail pendant un gel. Le 16 septembre 2026, un
#: gel a été mesuré sans aucun reset GPU dans le noyau: ces deux compteurs sont
#: ce qui reste pour savoir si la file du GPU s'arrête ou si personne ne la
#: remplit.
TRACES = (
    "amdgpu:amdgpu_bo_create",
    "amdgpu:amdgpu_sched_run_job",
    "amdgpu:amdgpu_cs_ioctl",
)

#: Lance une commande, écrit sa sortie dans un fichier, et rend son code de sortie.
Lanceur = Callable[[Sequence[str], Path, float], int]

#: Combien de temps de journaux on garde avec une capture.
AVANT = timedelta(minutes=3)

#: Où la salle dit le nom de son affichage, dans son conteneur. `supervise.py`
#: l'écrit une fois Sway prêt, sous Wayland comme sous Xwayland: c'est l'affichage
#: de Sway, que `grim` lit, et les fenêtres X de Xenia y sont composées.
AFFICHAGE = "/run-data/display.json"

#: La forme d'un nom d'affichage Wayland. Il est posé dans une commande `sh -c`:
#: tout autre texte est refusé plutôt qu'échappé.
NOM_AFFICHAGE = re.compile(r"wayland-[0-9]{1,4}")


def affichage(texte: str) -> str | None:
    """Le nom de l'affichage que `display.json` donne, ou rien."""
    try:
        lu = json.loads(texte)
    except ValueError:
        return None
    nom = lu.get("display") if isinstance(lu, dict) else None
    return nom if isinstance(nom, str) and NOM_AFFICHAGE.fullmatch(nom) else None


def lancer(argv: Sequence[str], sortie: Path, delai: float) -> int:
    """Le vrai lanceur. Rend -1 si la commande n'a pas pu tourner ou a dépassé son délai."""
    try:
        with sortie.open("wb") as fichier:
            fini = subprocess.run(  # noqa: S603 - arguments construits ici, jamais depuis une page
                list(argv), stdout=fichier, stderr=subprocess.STDOUT, timeout=delai, check=False
            )
    except (OSError, subprocess.TimeoutExpired):
        return -1
    return fini.returncode


#: Ce qu'un descripteur doit viser pour tenir la carte: ses nœuds DRM, ou ROCm.
NOEUDS_GPU = ("/dev/dri/", "/dev/kfd")

#: Ce que `gpu-detenteurs.json` ne peut pas dire, écrit à côté de ce qu'il dit.
NOTE_DETENTEURS = (
    "Lus par le nom des descripteurs de chaque processus, jamais par fdinfo. Les "
    "processus d'un autre utilisateur, root compris (ollama), ne sont pas lisibles: "
    "ils sont comptés dans « illisibles ». Ceux qui passent par ROCm se voient dans "
    "« voisins_gpu.kfd » des relevés."
)


def detenteurs_gpu(proc: Path) -> dict[str, Any]:
    """Les processus qui tiennent un nœud de la carte, et combien n'ont pas pu se lire.

    Une capture seulement, jamais un relevé: parcourir les descripteurs de toute la
    machine n'a pas sa place toutes les deux secondes. Un processus qui disparaît
    pendant la lecture est sauté.
    """
    detenteurs: list[dict[str, Any]] = []
    illisibles = 0
    try:
        pids = sorted(int(nom) for nom in os.listdir(proc) if nom.isdigit())
    except OSError:
        pids = []
    for pid in pids:
        dossier = proc / str(pid) / "fd"
        try:
            descripteurs = os.listdir(dossier)
        except PermissionError:
            illisibles += 1
            continue
        except OSError:
            continue
        noeuds: set[str] = set()
        for fd in descripteurs:
            try:
                cible = os.readlink(dossier / fd)
            except OSError:
                continue
            if cible.startswith(NOEUDS_GPU):
                noeuds.add(cible)
        if noeuds:
            try:
                nom = (proc / str(pid) / "comm").read_text(encoding="utf-8").strip()
            except OSError:
                nom = ""
            detenteurs.append({"pid": pid, "nom": nom or None, "noeuds": sorted(noeuds)})
    return {"detenteurs": detenteurs, "illisibles": illisibles, "note": NOTE_DETENTEURS}


def lignes_recentes(texte: str, depuis: datetime) -> list[str]:
    """Les lignes d'un journal JSONL écrites depuis `depuis`, telles quelles."""
    gardees: list[str] = []
    for ligne in texte.splitlines():
        try:
            quand = datetime.fromisoformat(json.loads(ligne).get("quand", ""))
        except (ValueError, AttributeError, TypeError):
            continue
        if quand.tzinfo is not None and quand >= depuis:
            gardees.append(ligne)
    return gardees


class Capteur:
    """Prend une capture complète dans un dossier daté."""

    def __init__(
        self,
        dossier: Path,
        racines: Racines | None = None,
        journal_salon: Path | None = None,
        secondes: int = 10,
        frequence: int = 199,
        lanceur: Lanceur = lancer,
        debugfs: bool = False,
    ) -> None:
        self._dossier = dossier
        self._r = racines or Racines()
        self._journal_salon = journal_salon
        self._secondes = secondes
        self._frequence = frequence
        self._lanceur = lanceur
        #: Copier l'allocateur de la mémoire vidéo et les objets GPU. Non par défaut:
        #: le 14 septembre 2026, chaque copie coupait l'image d'une partie en cours
        #: une centaine de millisecondes (voir `Settings.boite_noire_debugfs_en_partie`).
        self._debugfs = debugfs

    def capturer(
        self,
        raison: str,
        moteur: dict[str, Any],
        quand: datetime,
        details: dict[str, Any],
        avant: Callable[[Path], Any] | None = None,
    ) -> Path:
        salle = moteur.get("salle")
        nom = (
            quand.strftime("%Y-%m-%dT%H-%M-%S") + (f"-salle{salle}" if salle else "") + f"-{raison}"
        )
        dossier = self._dossier / nom
        dossier.mkdir(parents=True, exist_ok=True)
        # Le tampon du `perf` roulant D'ABORD, avant tout le reste: il contient les
        # secondes qui PRÉCÈDENT, c'est-à-dire le gel lui-même. Tout ce qui suit
        # décrit une machine déjà repartie, ce qui était le défaut des captures du
        # 16 septembre 2026.
        if avant is not None:
            avant(dossier)
        codes: dict[str, int] = {}
        # Qui tient la carte, au plus près du gel: juste après le tampon.
        (dossier / "gpu-detenteurs.json").write_text(
            json.dumps(detenteurs_gpu(self._r.proc), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # Les fils les plus occupés du dernier relevé, pas des noms écrits en dur:
        # Ryujinx et Dolphin n'appellent pas leur fil de rendu pareil.
        fils = [str(un["tid"]) for un in moteur.get("fils", [])[:3] if un.get("cpu_pct", 0) >= 5]
        # Un gel d'une seule page est celui de sa liaison: le profil de l'émulateur
        # décrirait une salle qui allait bien, et coûte à la partie en cours.
        if details.get("portee") == "page":
            fils = []
        pendant: dict[str, tuple[list[str], Path]] = {
            "allocations": (
                [
                    *("perf", "stat", "-e", ",".join(TRACES)),
                    *("-p", str(moteur["pid"]), "--", "sleep", str(self._secondes)),
                ],
                dossier / "allocations.txt",
            ),
        }
        if fils:
            pendant["profil"] = (
                [
                    *("perf", "record", "-F", str(self._frequence), "-g", "-t", ",".join(fils)),
                    # Ryujinx a près de cent fils: le délai par défaut en laissait sans
                    # nom, et leurs échantillons sans symboles (premier banc).
                    *("--proc-map-timeout", "5000"),
                    *("-o", str(dossier / "rendu.perf.data"), "--", "sleep", str(self._secondes)),
                ],
                dossier / "perf-record.log",
            )
        # En même temps: le compte et le profil doivent couvrir les mêmes secondes.
        with ThreadPoolExecutor(max_workers=len(pendant)) as parallele:
            futurs = {
                cle: parallele.submit(self._lanceur, argv, sortie, self._secondes + 30)
                for cle, (argv, sortie) in pendant.items()
            }
            codes.update({cle: futur.result() for cle, futur in futurs.items()})
        if codes.get("profil") == 0:
            codes["resume"] = self._lanceur(
                [
                    *("perf", "report", "-i", str(dossier / "rendu.perf.data"), "--stdio"),
                    *("--no-children", "--sort", "dso,sym", "-g", "none"),
                ],
                dossier / "rendu.txt",
                120,
            )

        for source in ("amdgpu_vram_mm", "amdgpu_gem_info") if self._debugfs else ():
            try:
                (dossier / f"{source}.txt").write_bytes((self._r.dri / source).read_bytes())
            except OSError:
                codes[source] = -1

        # Ce que l'ÉMULATEUR dit de lui-même. Le 16 septembre 2026, Ryujinx
        # écrivait « GPU processing thread is too slow » juste avant un gel, et
        # personne ne lisait ce journal. Les lignes des manettes sont écartées:
        # elles représentent 436 lignes sur 450 et noieraient le reste.
        conteneur = moteur.get("conteneur")
        if conteneur:
            codes["emulateur"] = self._lanceur(
                ["docker", "logs", "--since", "3m", "--timestamps", str(conteneur)],
                dossier / "emulateur.log",
                self._secondes,
            )
        unite = f"nel3ab-worker@{salle}" if salle else "nel3ab-worker@*"
        codes["worker"] = self._lanceur(
            [
                "journalctl",
                "-u",
                unite,
                "--since",
                "-3min",
                "--no-pager",
                "-o",
                "short-iso-precise",
            ],
            dossier / "worker.log",
            30,
        )
        self._pages(dossier, quand)
        # L'écran, pour une CHUTE seulement: une capture périodique n'a rien à montrer
        # qu'on ne sache, et `grim` tourne dans le conteneur du jeu. En PNG et au plus
        # bas: le `grim` de l'image est compilé sans JPEG (« jpeg support disabled »,
        # premier banc du 14 septembre 2026).
        # Les rôles des consoles servies par un adaptateur, lus dans le manifeste:
        # leur jeu tourne dans un compositeur Sway, que `grim` sait lire.
        if (
            raison == "chute"
            and moteur.get("moteur") in CONSOLES.roles_with_a_screen()
            and moteur.get("conteneur")
        ):
            self._ecran(str(moteur["conteneur"]), dossier, codes)

        (dossier / "capture.json").write_text(
            json.dumps(
                {
                    "quand": quand.isoformat(timespec="milliseconds"),
                    "raison": raison,
                    "details": details,
                    "moteur": moteur,
                    "fils_profiles": [int(tid) for tid in fils],
                    "debugfs": self._debugfs,
                    "codes": codes,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        return dossier

    def _ecran(self, conteneur: str, dossier: Path, codes: dict[str, int]) -> None:
        """L'image de l'affichage que la salle a écrit, et rien sans lui.

        `wayland-1` était supposé jusqu'au 22 novembre 2026. Un affichage lu
        plutôt que supposé ne capture jamais l'écran d'un autre compositeur; un
        affichage illisible laisse la capture sans image, avec son code.
        """
        lu = dossier / "affichage.json"
        codes["affichage"] = self._lanceur(
            ["docker", "exec", conteneur, "cat", AFFICHAGE], lu, self._secondes
        )
        if codes["affichage"] != 0:
            return
        try:
            nom = affichage(lu.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            nom = None
        if nom is None:
            codes["affichage"] = -1
            return
        codes["ecran"] = self._lanceur(
            [
                *("docker", "exec", conteneur, "sh", "-c"),
                f"WAYLAND_DISPLAY={nom} XDG_RUNTIME_DIR=/tmp/nel3ab-runtime "
                "nice -n 19 grim -t png -l 1 -",
            ],
            dossier / "ecran.png",
            15,
        )

    def _pages(self, dossier: Path, quand: datetime) -> None:
        if self._journal_salon is None:
            return
        fichier = self._journal_salon / f"{quand.date().isoformat()}.jsonl"
        try:
            texte = fichier.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        gardees = lignes_recentes(texte, quand - AVANT)
        (dossier / "pages.jsonl").write_text(
            "".join(ligne + "\n" for ligne in gardees), encoding="utf-8"
        )
