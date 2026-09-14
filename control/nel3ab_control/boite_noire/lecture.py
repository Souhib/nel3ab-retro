"""Ce que la machine dit d'elle-même, lu dans ses fichiers texte.

Des fonctions pures: un texte entre, des nombres sortent. Rien ici n'ouvre de
fichier, pour que chaque format se teste sur un extrait réel de cette machine
(`tests/boite_noire/echantillons`) plutôt que sur la machine elle-même.

Un format inconnu rend `None` ou un dictionnaire vide, jamais une exception. La
boîte noire tourne pendant les parties, et une ligne qu'elle ne sait pas lire ne
doit ni l'arrêter ni gêner le jeu. Ce qui manque se voit dans le relevé, par
l'absence de la valeur.
"""

import json
import re
from typing import Any

#: Les unités qu'écrit l'allocateur de la mémoire vidéo, ramenées au Mio.
_EN_MIO = {"KiB": 1 / 1024, "MiB": 1.0, "GiB": 1024.0}


def temps_cpu(texte: str) -> dict[str, tuple[int, int]]:
    """Par cœur, le temps total et le temps inoccupé, en tics depuis le démarrage.

    L'attente de disque compte comme inoccupée: un cœur qui attend le disque ne
    calcule pas.
    """
    resultat: dict[str, tuple[int, int]] = {}
    for ligne in texte.splitlines():
        if not ligne.startswith("cpu"):
            continue
        champs = ligne.split()
        try:
            valeurs = [int(valeur) for valeur in champs[1:9]]
        except ValueError:
            continue
        if len(valeurs) < 5:
            continue
        resultat[champs[0]] = (sum(valeurs), valeurs[3] + valeurs[4])
    return resultat


def occupation(
    avant: dict[str, tuple[int, int]], apres: dict[str, tuple[int, int]]
) -> dict[str, float]:
    """L'occupation de chaque cœur entre deux lectures, en pour cent."""
    resultat: dict[str, float] = {}
    for coeur, (total, repos) in apres.items():
        if coeur not in avant:
            continue
        total_avant, repos_avant = avant[coeur]
        ecoule = total - total_avant
        if ecoule <= 0:
            continue
        resultat[coeur] = round(100 * (ecoule - (repos - repos_avant)) / ecoule, 1)
    return resultat


def frequences(cpuinfo: str) -> list[int]:
    """La fréquence de chaque cœur, en MHz, dans l'ordre de `/proc/cpuinfo`."""
    return [int(float(valeur)) for valeur in re.findall(r"^cpu MHz\s*:\s*([\d.]+)", cpuinfo, re.M)]


def pression(texte: str) -> dict[str, float]:
    """La part des dix dernières secondes passée à attendre, `some` et `full`."""
    resultat: dict[str, float] = {}
    for ligne in texte.splitlines():
        trouve = re.match(r"^(some|full)\s+avg10=([\d.]+)", ligne)
        if trouve:
            resultat[trouve.group(1)] = float(trouve.group(2))
    return resultat


def memoire_disponible_mio(meminfo: str) -> int | None:
    """Ce que le noyau peut encore donner sans évincer, en Mio."""
    trouve = re.search(r"^MemAvailable:\s+(\d+)\s+kB", meminfo, re.M)
    return int(trouve.group(1)) // 1024 if trouve else None


def reseau(texte: str) -> dict[str, tuple[int, int]]:
    """Par interface, les octets reçus et envoyés depuis le démarrage."""
    resultat: dict[str, tuple[int, int]] = {}
    for ligne in texte.splitlines():
        nom, deux_points, reste = ligne.partition(":")
        champs = reste.split()
        if not deux_points or len(champs) < 9:
            continue
        try:
            resultat[nom.strip()] = (int(champs[0]), int(champs[8]))
        except ValueError:
            continue
    return resultat


def niveau_actif(texte: str) -> str | None:
    """Le palier d'horloge en cours dans `pp_dpm_sclk` ou `pp_dpm_mclk`, « 700Mhz ».

    Le palier s'appelle par un numéro, SAUF au repos sous le noyau 7.0, où il
    s'écrit `S: 0Mhz *`, « S » pour veille. Relevé sur cette machine le 14 septembre
    2026; la première version n'acceptait qu'un numéro et rendait `None` au repos.
    """
    for ligne in texte.splitlines():
        if ligne.rstrip().endswith("*"):
            trouve = re.match(r"^\s*\w+:\s*(\S+)", ligne)
            return trouve.group(1) if trouve else None
    return None


def profil_actif(texte: str) -> str | None:
    """Le profil d'énergie que le pilote a choisi, « VIDEO » ou « 3D_FULL_SCREEN »."""
    trouve = re.search(r"^\s*\d+\s+([A-Z0-9_]+)\s*\*", texte, re.M)
    return trouve.group(1) if trouve else None


def allocateur_vram(texte: str) -> dict[str, Any]:
    """L'état de l'allocateur de la mémoire vidéo, tel que `amdgpu_vram_mm` l'écrit.

    Les blocs libres sont ce qui a ralenti Mario Tennis sous le noyau 6.8, qui les
    parcourait en liste. Le 7.0 sépare en plus la mémoire déjà effacée
    (`clear_free`): ses nombres de blocs ne se comparent pas à ceux du 6.8, et la
    présence de cette valeur dit sous quel format le relevé a été pris.
    """
    resultat: dict[str, Any] = {}
    trouve = re.search(
        r"total:\s*(\d+)MiB,\s*free:\s*(\d+)MiB(?:,\s*clear_free:\s*(\d+)MiB)?", texte
    )
    if trouve:
        resultat["total_mio"] = int(trouve.group(1))
        resultat["libre_mio"] = int(trouve.group(2))
        if trouve.group(3) is not None:
            resultat["libre_efface_mio"] = int(trouve.group(3))
    blocs: dict[int, int] = {}
    libres_mio = 0.0
    for ordre, taille, unite, nombre in re.findall(
        r"^order-\s*(\d+)\s+free:\s*([\d.]+)\s*([KMG]iB),\s*blocks:\s*(\d+)", texte, re.M
    ):
        blocs[int(ordre)] = int(nombre)
        libres_mio += float(taille) * _EN_MIO[unite]
    if blocs:
        resultat["blocs_libres"] = sum(blocs.values())
        resultat["blocs_par_ordre"] = {str(ordre): blocs[ordre] for ordre in sorted(blocs)}
    return resultat


def objets_gpu(texte: str) -> dict[int, dict[str, int]]:
    """Par processus, les objets GPU qu'il tient, d'après `amdgpu_gem_info`.

    Un même processus apparaît une fois par fichier ouvert sur le GPU: ses objets
    s'additionnent. Le placement est le premier mot après la taille, `VRAM` ou
    `GTT`; `CPU_ACCESS_REQUIRED` plus loin sur la ligne n'en est pas un.
    """
    resultat: dict[int, dict[str, int]] = {}
    courant: dict[str, int] | None = None
    for ligne in texte.splitlines():
        processus = re.match(r"^pid\s+(\d+)\s+command\s", ligne)
        if processus:
            courant = resultat.setdefault(
                int(processus.group(1)), {"objets": 0, "octets": 0, "vram": 0, "gtt": 0}
            )
            continue
        objet = re.match(r"^\s+0x[0-9a-f]+:\s+(\d+)\s+byte\s+(\w+)", ligne)
        if objet and courant is not None:
            courant["objets"] += 1
            courant["octets"] += int(objet.group(1))
            if objet.group(2) == "VRAM":
                courant["vram"] += 1
            elif objet.group(2) == "GTT":
                courant["gtt"] += 1
    return resultat


def fil(stat: str, status: str = "") -> dict[str, Any] | None:
    """Un fil d'exécution: son nom, son temps processeur, son cœur, ses préemptions.

    Le nom est entre les PREMIÈRE et DERNIÈRE parenthèses: Ryujinx nomme ses fils
    « <MainThread> » ou « GUI.RenderLoop », et un nom peut contenir une parenthèse.
    Les préemptions forcées disent qu'un fil voulait calculer et qu'on lui a pris
    son cœur; les attentes, qu'il a rendu la main de lui-même.
    """
    try:
        nom = stat[stat.index("(") + 1 : stat.rindex(")")]
        champs = stat[stat.rindex(")") + 2 :].split()
        tics = int(champs[11]) + int(champs[12])
        coeur = int(champs[36])
    except (ValueError, IndexError):
        return None
    forcees = re.search(r"^nonvoluntary_ctxt_switches:\s+(\d+)", status, re.M)
    rendues = re.search(r"^voluntary_ctxt_switches:\s+(\d+)", status, re.M)
    return {
        "nom": nom,
        "tics": tics,
        "coeur": coeur,
        "preemptions": int(forcees.group(1)) if forcees else 0,
        "attentes": int(rendues.group(1)) if rendues else 0,
    }


def io_processus(texte: str) -> tuple[int, int] | None:
    """Les octets qu'un processus a lus et écrits sur le disque, d'après `/proc/<pid>/io`."""
    lus = re.search(r"^read_bytes:\s+(\d+)", texte, re.M)
    ecrits = re.search(r"^write_bytes:\s+(\d+)", texte, re.M)
    if not lus or not ecrits:
        return None
    return int(lus.group(1)), int(ecrits.group(1))


def cgroup_du_processus(texte: str) -> str | None:
    """Le chemin du cgroup unifié d'un processus, « /system.slice/docker-….scope »."""
    trouve = re.search(r"^0::(/\S*)", texte, re.M)
    return trouve.group(1) if trouve else None


def conteneur_du_cgroup(texte: str) -> str | None:
    """L'identifiant Docker d'un processus, lu dans son `/proc/<pid>/cgroup`."""
    trouve = re.search(r"docker-([0-9a-f]{64})\.scope", texte)
    return trouve.group(1) if trouve else None


def cpu_stat(texte: str) -> dict[str, int]:
    """Les compteurs d'un `cpu.stat` de cgroup, dont le bridage (`nr_throttled`)."""
    resultat: dict[str, int] = {}
    for ligne in texte.splitlines():
        champs = ligne.split()
        if len(champs) == 2 and champs[1].isdigit():
            resultat[champs[0]] = int(champs[1])
    return resultat


def conteneur(config: str) -> dict[str, Any] | None:
    """Le nom d'un conteneur et sa salle, d'après son `config.v2.json`.

    La salle se lit de deux façons, parce que les deux moteurs ne se nomment pas
    pareil: Dolphin porte `nel3ab-dolphin-N`, la Switch porte l'étiquette
    `nel3ab.room-root`, qui pointe dans `…/salles/N/`. Un conteneur qui n'est à
    aucune salle garde son nom et une salle `None`.
    """
    try:
        donnees = json.loads(config)
    except ValueError:
        return None
    if not isinstance(donnees, dict):
        return None
    nom = str(donnees.get("Name") or "").lstrip("/")
    reglages = donnees.get("Config")
    etiquettes = reglages.get("Labels") if isinstance(reglages, dict) else None
    salle = None
    dolphin = re.fullmatch(r"nel3ab-dolphin-(\d+)", nom)
    if dolphin:
        salle = int(dolphin.group(1))
    elif isinstance(etiquettes, dict):
        racine = re.search(r"/salles/(\d+)(?:/|$)", str(etiquettes.get("nel3ab.room-root") or ""))
        if racine:
            salle = int(racine.group(1))
    return {"nom": nom, "salle": salle}
