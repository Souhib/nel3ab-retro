"""Le résumé d'une partie, écrit à sa fin et gardé sans limite.

# Pourquoi

Les relevés, les captures et les mesures des pages s'effacent après sept jours.
Le 27 novembre 2026, il n'y avait eu que deux parties Switch 1 en six semaines,
et la plus lente, Mario Tennis Aces le 30 octobre, avait perdu ses relevés et
les mesures de ses pages: seul le journal du worker restait pour la comparer à
celle du 26 novembre (constat DON-12). Un résumé de quelques Kio par partie,
jamais balayé, garde ce qui permet de comparer une soirée à une autre.

# Ce qu'il dit

- la capture, d'après les fenêtres de 5 s que la capture d'une salle Switch
  écrit dans le journal de son worker (`spikes/switch-room/capture.py`): les
  images par seconde, les fenêtres dont le pire écart dépasse 34, 50, 100 et
  250 ms, avec l'heure de leur fin, et les pires écarts;
- les pages, d'après le journal du salon: les mesures, les images jetées et
  affamées, la réserve (`horaire`), le pire écart reçu;
- le jeu, la salle, le moteur, le début, la fin, le noyau.

Ce qui n'a pas été mesuré s'écrit « non mesuré », jamais zéro: une partie
Dolphin, que le worker encode lui-même, n'a aucune fenêtre de capture, et des
zéros y diraient « aucun trou ». Un `journalctl` qui échoue laisse sa raison.

# Ce qu'il ne dit pas

Qui jouait. Il suit les règles du carnet de jeu: ni nom, ni adresse, ni visite.
Seul le nombre de pages reste.
"""

import json
import re
import subprocess  # lire le journal du worker est le travail de ce module
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, tzinfo
from pathlib import Path
from statistics import median
from typing import Any

#: La durée d'une fenêtre de la capture: elle écrit son rapport toutes les cinq
#: secondes (`report_at = now + 5`, `spikes/switch-room/capture.py`).
FENETRE_S = 5.0

#: Les seuils des fenêtres comptées. 34 ms est deux images à 60 par seconde: une
#: image manquée. 50, 100 et 250 sont ceux de l'audit du 27 novembre 2026.
SEUILS_MS = (34, 50, 100, 250)

#: Combien de pires écarts on garde, avec leur heure.
PIRES = 6

#: Combien de temps après la fin d'une partie le résumé attend: la capture écrit
#: sa dernière fenêtre en s'arrêtant, et le salon la dernière mesure d'une page
#: jusqu'à dix secondes après.
DELAI = timedelta(seconds=15)

#: Combien avant le premier relevé qui voit le moteur on lit le journal. Le
#: moteur paraît au plus un pas de relevé (2 s) après son départ, et la capture
#: écrit sa première fenêtre cinq secondes au moins après le sien: deux secondes
#: couvrent la partie sans reprendre les dernières fenêtres de la précédente.
AVANT = timedelta(seconds=2)

NON_MESURE = "non mesuré"

#: Lance une commande et rend son code, sa sortie et ses erreurs.
Lecteur = Callable[[Sequence[str], float], tuple[int, str, str]]

_LIGNE = re.compile(r"^(\S+) \S+ \S+: (\{.*\})\s*$")


@dataclass(frozen=True)
class Partie:
    """Une partie finie, telle que les relevés l'ont vue."""

    salle: int
    moteur: str
    debut: datetime
    fin: datetime
    noyau: str | None = None
    #: Le début de la partie suivante dans la même salle, si elle a déjà commencé:
    #: le journal n'est pas lu au-delà.
    suivante: datetime | None = None


@dataclass(frozen=True)
class Fenetre:
    """Une fenêtre de la capture: son heure de fin, ses images, son pire écart."""

    fin: datetime
    images: int
    pire_ms: float


def lire_commande(argv: Sequence[str], delai: float) -> tuple[int, str, str]:
    """Le vrai lecteur. Rend -1 et la raison si la commande n'a pas pu tourner."""
    try:
        fini = subprocess.run(  # noqa: S603 - arguments construits ici, jamais depuis une page
            list(argv), capture_output=True, text=True, timeout=delai, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as erreur:
        return -1, "", str(erreur)
    return fini.returncode, fini.stdout, fini.stderr


def fenetres_capture(texte: str) -> list[Fenetre]:
    """Les fenêtres PLEINES de la capture dans un journal `short-iso-precise`.

    Le demi-format a ses propres fenêtres, quand une page le demande: les compter
    aussi doublerait les images. Une ligne sans écarts n'est pas une fenêtre.
    """
    fenetres: list[Fenetre] = []
    for ligne in texte.splitlines():
        trouve = _LIGNE.match(ligne)
        if not trouve:
            continue
        try:
            fin = datetime.fromisoformat(trouve.group(1))
            rapport = json.loads(trouve.group(2))
        except ValueError:
            continue
        if not isinstance(rapport, dict) or rapport.get("half") is not False:
            continue
        images, ecarts = rapport.get("frames"), rapport.get("gap_ms")
        if (
            fin.tzinfo is None
            or isinstance(images, bool)
            or not isinstance(images, int)
            or not isinstance(ecarts, list)
            or len(ecarts) != 3
            or not isinstance(ecarts[2], int | float)
        ):
            continue
        fenetres.append(Fenetre(fin, images, float(ecarts[2])))
    return sorted(fenetres, key=lambda fenetre: fenetre.fin)


def resume_capture(fenetres: list[Fenetre], zone: tzinfo) -> dict[str, Any] | str:
    """Les images par seconde et les trous de la capture, ou « non mesuré »."""
    if not fenetres:
        return NON_MESURE

    def heure(fenetre: Fenetre) -> str:
        return fenetre.fin.astimezone(zone).strftime("%H:%M:%S")

    duree = (fenetres[-1].fin - fenetres[0].fin).total_seconds() + FENETRE_S
    pires = sorted(fenetres, key=lambda fenetre: -fenetre.pire_ms)[:PIRES]
    return {
        "fenetres": len(fenetres),
        "fenetre_s": FENETRE_S,
        "images_s": round(sum(fenetre.images for fenetre in fenetres) / duree, 2),
        "au_dessus_ms": {
            str(seuil): {
                "fenetres": len(dessus := [f for f in fenetres if f.pire_ms > seuil]),
                "fins": [heure(fenetre) for fenetre in dessus],
            }
            for seuil in SEUILS_MS
        },
        "pires": [{"ms": fenetre.pire_ms, "fin": heure(fenetre)} for fenetre in pires],
    }


def _nombre(valeur: object) -> float | None:
    if isinstance(valeur, bool) or not isinstance(valeur, int | float):
        return None
    return float(valeur)


def _entier_ou_reel(valeur: float) -> float | int:
    return int(valeur) if float(valeur).is_integer() else valeur


def resume_pages(
    lignes: list[dict[str, Any]], salle: int, debut: datetime, fin: datetime
) -> tuple[dict[str, Any] | str, str]:
    """Ce que les pages de la salle ont mesuré pendant la partie, et son jeu.

    Une mesure couvre les dix secondes qui la précèdent: celles finies après le
    premier relevé qui voit le moteur, et jusqu'à `DELAI` après le dernier.
    """
    mesures: list[dict[str, Any]] = []
    for ligne in lignes:
        vu, de_la_salle = ligne.get("vu"), ligne.get("salle")
        if (
            ligne.get("quoi") != "mesures"
            or ligne.get("banc")
            or not isinstance(vu, dict)
            or not isinstance(de_la_salle, dict)
            or de_la_salle.get("numéro") != salle
        ):
            continue
        try:
            quand = datetime.fromisoformat(str(ligne.get("quand")))
        except ValueError:
            continue
        if quand.tzinfo is not None and debut < quand <= fin + DELAI:
            mesures.append(ligne)
    if not mesures:
        return NON_MESURE, NON_MESURE
    jeux = Counter(str(m["salle"].get("jeu")) for m in mesures if m["salle"].get("jeu"))
    jeu = jeux.most_common(1)[0][0] if jeux else NON_MESURE

    def valeurs(cle: str) -> list[float]:
        return [v for m in mesures if (v := _nombre(m["vu"].get(cle))) is not None]

    pires = []
    for mesure in mesures:
        arrivees = mesure["vu"].get("arrivées")
        pire = _nombre(arrivees[2]) if isinstance(arrivees, list) and len(arrivees) == 3 else None
        attente = _nombre(mesure["vu"].get("attente"))
        if pire is not None or attente is not None:
            pires.append(max(pire or 0.0, attente or 0.0))
    recues = [
        vues / duree
        for m in mesures
        if (vues := _nombre(m["vu"].get("vues"))) is not None
        and (duree := _nombre(m["vu"].get("s")))
    ]
    horaire = valeurs("horaire")
    pages: dict[str, Any] = {
        "mesures": len(mesures),
        "pages": len({m.get("visite") for m in mesures}),
    }
    # Chaque champ seulement s'il a été écrit: une page d'avant le 14 septembre
    # 2026 n'a ni arrivées ni attente, et un zéro y mentirait.
    for cle, nom in (("jetées", "jetees"), ("affamées", "affamees")):
        if lus := valeurs(cle):
            pages[nom] = _entier_ou_reel(sum(lus))
    if horaire:
        pages["horaire_ms"] = {
            "mediane": _entier_ou_reel(median(horaire)),
            "max": _entier_ou_reel(max(horaire)),
        }
    if pires:
        pages["pire_arrivee_ms"] = _entier_ou_reel(max(pires))
    if recues:
        pages["recues_s_mediane"] = round(median(recues), 1)
    return pages, jeu


def _lignes(dossier: Path, debut: datetime, fin: datetime, zone: tzinfo) -> list[dict[str, Any]]:
    """Les lignes du journal du salon des jours que la partie couvre."""
    jours = {debut.astimezone(zone).date(), (fin + DELAI).astimezone(zone).date()}
    lignes: list[dict[str, Any]] = []
    for jour in sorted(jours):
        try:
            texte = (dossier / f"{jour.isoformat()}.jsonl").read_text(
                encoding="utf-8", errors="replace"
            )
        except OSError:
            continue
        for brute in texte.splitlines():
            try:
                ligne = json.loads(brute)
            except ValueError:
                continue
            if isinstance(ligne, dict):
                lignes.append(ligne)
    return lignes


class Resumeur:
    """Écrit le résumé d'une partie finie dans un fichier JSON par partie."""

    def __init__(
        self,
        dossier: Path,
        journal_salon: Path,
        zone: tzinfo,
        lecteur: Lecteur = lire_commande,
    ) -> None:
        self._dossier = dossier
        self._journal_salon = journal_salon
        self._zone = zone
        self._lecteur = lecteur

    def resumer(self, partie: Partie) -> Path | None:
        """Le chemin du résumé écrit, ou rien si le disque l'a refusé."""
        debut, fin = partie.debut.astimezone(self._zone), partie.fin.astimezone(self._zone)
        jusqu_a = fin + DELAI
        if partie.suivante is not None:
            jusqu_a = min(jusqu_a, partie.suivante)
        code, sortie, erreur = self._lecteur(
            [
                *("journalctl", "-u", f"nel3ab-worker@{partie.salle}"),
                *("--since", f"@{(debut - AVANT).timestamp():.3f}"),
                *("--until", f"@{jusqu_a.timestamp():.3f}"),
                *("--no-pager", "-o", "short-iso-precise"),
            ],
            60,
        )
        capture: dict[str, Any] | str
        if code != 0:
            raison = (erreur.strip().splitlines() or [""])[-1]
            capture = f"{NON_MESURE}: journalctl a rendu {code}: {raison}"
        else:
            capture = resume_capture(fenetres_capture(sortie), self._zone)
        pages, jeu = resume_pages(
            _lignes(self._journal_salon, debut, fin, self._zone), partie.salle, debut, fin
        )
        resume = {
            "salle": partie.salle,
            "moteur": partie.moteur,
            "jeu": jeu,
            "debut": debut.isoformat(timespec="seconds"),
            "fin": fin.isoformat(timespec="seconds"),
            "duree_s": round((fin - debut).total_seconds()),
            "noyau": partie.noyau or "non noté",
            "capture": capture,
            "pages": pages,
        }
        chemin = self._dossier / f"{debut.strftime('%Y-%m-%dT%H-%M-%S')}-salle{partie.salle}.json"
        try:
            self._dossier.mkdir(parents=True, exist_ok=True)
            chemin.write_text(json.dumps(resume, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            return None
        return chemin
