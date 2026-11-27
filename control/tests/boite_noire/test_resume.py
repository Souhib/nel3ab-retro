"""Le résumé de chaque partie, rejoué sur la soirée du 26 novembre 2026.

Deux parties Switch 1 en six semaines, et la plus lente, Mario Tennis Aces le
30 octobre, a perdu ses relevés et les mesures de ses pages: on les garde sept
jours (constat DON-12). Un résumé de quelques Kio, écrit à la fin de chaque
partie et jamais effacé, garde ce qui permet de comparer une soirée à une autre.

Les lignes sont les vraies. Le journal du worker de la salle 1, de 23:32 à
23:41 UTC (`echantillons/worker_2026-11-26_salle1.log`), sans les lignes qui
portent un chemin personnel ou le nom d'une sauvegarde; les mesures des pages
de la même partie, sans identité (`sessions_2026-11-27_smash.jsonl`). Ils
passent par la vraie boucle du service, toutes les deux secondes, avec un faux
`journalctl` qui applique `--since` et `--until` comme le vrai.
"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from nel3ab_control.boite_noire import resume
from nel3ab_control.boite_noire.declencheur import Declencheur, Suiveur
from nel3ab_control.boite_noire.resume import Resumeur
from nel3ab_control.boite_noire.service import BoiteNoire
from nel3ab_control.journal import Journal, _zone
from nel3ab_control.settings import Settings
from tests.boite_noire.test_service import Executeur, FauxCapteur

ECHANTILLONS = Path(__file__).parent / "echantillons"
JOURNAL_WORKER = ECHANTILLONS / "worker_2026-11-26_salle1.log"
PAGES = ECHANTILLONS / "sessions_2026-11-27_smash.jsonl"
PARIS = _zone("Europe/Paris")
DEBUT = datetime(2026, 11, 27, 0, 32, 20, tzinfo=PARIS)

#: Les deux moteurs de la soirée, tels que les relevés de la boîte noire les ont
#: vus: Ryujinx de 00:32:33 à 00:40:10, puis Dolphin pour Mario Party 4.
SMASH = {"pid": 2781000, "moteur": "switch", "salle": 1, "fils": [{"tid": 1, "cpu_pct": 78}]}
MARIO_PARTY = {"pid": 2797844, "moteur": "dolphin", "salle": 1, "fils": [{"tid": 2, "cpu_pct": 60}]}
VIES = [
    (
        SMASH,
        datetime(2026, 11, 27, 0, 32, 33, tzinfo=PARIS),
        datetime(2026, 11, 27, 0, 40, 10, tzinfo=PARIS),
    ),
    (
        MARIO_PARTY,
        datetime(2026, 11, 27, 0, 40, 14, tzinfo=PARIS),
        datetime(2026, 11, 27, 0, 40, 57, tzinfo=PARIS),
    ),
]


class ReleveurDuSoir:
    """Les moteurs vivants à l'heure de la boucle, avec le noyau de ce soir-là."""

    def __init__(self, horloge: dict[str, datetime]) -> None:
        self._horloge = horloge

    def _vivants(self) -> list[dict[str, Any]]:
        t = self._horloge["t"]
        return [moteur for moteur, debut, fin in VIES if debut <= t <= fin]

    def moteur_en_cours(self) -> bool:
        return bool(self._vivants())

    def prendre(self, avec_allocateur: bool = True) -> dict[str, Any]:
        return {"moteurs": self._vivants(), "noyau": "7.0.0-43-generic"}


class FauxJournalctl:
    """`journalctl -u <unité> --since @<s> --until @<s>`, aussi strict que le vrai.

    Il refuse une autre commande, une autre unité, une date sans `@`, et ne rend
    que les lignes de la plage demandée.
    """

    def __init__(self, texte: str, code: int = 0, erreur: str = "") -> None:
        self.texte = texte
        self.code = code
        self.erreur = erreur
        self.appels: list[list[str]] = []

    def __call__(self, argv: Sequence[str], delai: float) -> tuple[int, str, str]:
        self.appels.append(list(argv))
        assert argv[0] == "journalctl" and argv[argv.index("-u") + 1] == "nel3ab-worker@1"
        assert argv[argv.index("-o") + 1] == "short-iso-precise"
        depuis = argv[argv.index("--since") + 1]
        jusqu_a = argv[argv.index("--until") + 1]
        assert depuis.startswith("@") and jusqu_a.startswith("@"), argv
        bas, haut = float(depuis[1:]), float(jusqu_a[1:])
        gardees = [
            ligne
            for ligne in self.texte.splitlines()
            if bas <= datetime.fromisoformat(ligne.split(" ", 1)[0]).timestamp() <= haut
        ]
        return self.code, "".join(ligne + "\n" for ligne in gardees), self.erreur


def _rejouer(tmp_path: Path, journalctl: FauxJournalctl) -> list[dict[str, Any]]:
    reglages = Settings(journal_dir=tmp_path / "sessions", boite_noire_dir=tmp_path / "bn")
    reglages.journal_dir.mkdir(parents=True)
    (reglages.journal_dir / "2026-11-27.jsonl").write_text(PAGES.read_text(encoding="utf-8"))
    horloge = {"t": DEBUT}
    resumeur = Resumeur(
        reglages.boite_noire_dir / "parties", reglages.journal_dir, PARIS, lecteur=journalctl
    )
    boite = BoiteNoire(
        reglages,
        ReleveurDuSoir(horloge),
        FauxCapteur(),
        Journal(reglages.boite_noire_dir / "releves", 7, "Europe/Paris"),
        Suiveur(reglages.journal_dir, PARIS),
        Declencheur(),
        Executeur(),
        horloge=lambda: (horloge["t"] - DEBUT).total_seconds(),
        murale=lambda: horloge["t"],
        resumeur=resumeur,
    )
    while horloge["t"] <= datetime(2026, 11, 27, 0, 42, 0, tzinfo=PARIS):
        boite.tour()
        horloge["t"] += timedelta(seconds=2)
    return [
        json.loads(fichier.read_text(encoding="utf-8"))
        for fichier in sorted((reglages.boite_noire_dir / "parties").glob("*.json"))
    ]


def _smash(tmp_path: Path) -> dict[str, Any]:
    resumes = _rejouer(tmp_path, FauxJournalctl(JOURNAL_WORKER.read_text(encoding="utf-8")))
    (smash,) = [un for un in resumes if un["moteur"] == "switch"]
    return smash


def test_le_resume_de_smash_retrouve_les_chiffres_du_26_novembre(tmp_path: Path) -> None:
    """58,86 images par seconde, et 28, 22, 10 et 6 fenêtres de capture de 5 s
    au-dessus de 34, 50, 100 et 250 ms, sur 84: les chiffres de l'audit, refaits
    depuis le journal du worker le 27 novembre 2026."""
    smash = _smash(tmp_path)

    capture = smash["capture"]
    assert capture["fenetres"] == 84
    assert capture["images_s"] == 58.86
    assert {seuil: un["fenetres"] for seuil, un in capture["au_dessus_ms"].items()} == {
        "34": 28,
        "50": 22,
        "100": 10,
        "250": 6,
    }
    assert capture["au_dessus_ms"]["250"]["fins"] == [
        "00:33:10",
        "00:33:15",
        "00:33:50",
        "00:36:11",
        "00:39:06",
        "00:39:26",
    ]
    assert [pire["ms"] for pire in capture["pires"][:3]] == [1482.8, 545.9, 545.5]
    assert (smash["salle"], smash["jeu"], smash["noyau"]) == (
        1,
        "Super Smash Bros. Ultimate",
        "7.0.0-43-generic",
    )


def test_le_resume_garde_ce_que_les_pages_ont_vu(tmp_path: Path) -> None:
    pages = _smash(tmp_path)["pages"]

    # Les fenêtres de 10 s finies pendant la partie, de 00:33:13 à 00:39:24. Celle de
    # 00:32:33 finit avant que le moteur ne paraisse, et n'en est pas.
    assert pages["mesures"] == 38
    assert pages["pages"] == 1
    assert pages["pire_arrivee_ms"] == 33386
    assert (pages["jetees"], pages["affamees"]) == (648, 574)
    assert pages["horaire_ms"] == {"mediane": 83.5, "max": 121}
    assert pages["recues_s_mediane"] == 59.8


def test_une_partie_sans_lignes_de_capture_ecrit_non_mesure(tmp_path: Path) -> None:
    """Le jumeau: Mario Party 4 sur Dolphin, de 00:40:14 à 00:40:57. Le worker
    l'encode lui-même et n'écrit aucune fenêtre de capture, et ses pages n'ont
    envoyé aucune mesure: « non mesuré », jamais des zéros."""
    resumes = _rejouer(tmp_path, FauxJournalctl(JOURNAL_WORKER.read_text(encoding="utf-8")))

    (mario_party,) = [un for un in resumes if un["moteur"] == "dolphin"]
    assert mario_party["capture"] == "non mesuré"
    assert mario_party["pages"] == "non mesuré"
    assert mario_party["jeu"] == "non mesuré"


def test_un_journal_illisible_laisse_sa_raison(tmp_path: Path) -> None:
    """Le second jumeau: `journalctl` échoue, et sa raison reste dans le résumé."""
    journalctl = FauxJournalctl("", code=1, erreur="Failed to open journal: Permission denied\n")

    smash = next(un for un in _rejouer(tmp_path, journalctl) if un["moteur"] == "switch")

    assert smash["capture"].startswith("non mesuré")
    assert "Permission denied" in smash["capture"]


def test_un_resume_ne_dit_ni_qui_ni_quelle_page(tmp_path: Path) -> None:
    """Le résumé suit les règles du carnet de jeu: ni nom, ni adresse, ni visite."""
    texte = json.dumps(_smash(tmp_path), ensure_ascii=False)

    for interdit in ("Joueur", "joueur@", "1bf05734", "socket"):
        assert interdit not in texte


def test_un_resume_pese_quelques_kio(tmp_path: Path) -> None:
    _smash(tmp_path)
    (fichier,) = [un for un in (tmp_path / "bn" / "parties").glob("*.json") if "salle1" in un.name][
        :1
    ]

    assert fichier.stat().st_size < 8 * 1024


def test_les_resumes_ne_sont_jamais_balayes(tmp_path: Path) -> None:
    """Les relevés et les captures partent après sept jours; un résumé reste."""
    _smash(tmp_path)
    reglages = Settings(journal_dir=tmp_path / "sessions", boite_noire_dir=tmp_path / "bn")
    avant = sorted(p.name for p in (reglages.boite_noire_dir / "parties").iterdir())
    horloge = {"t": DEBUT + timedelta(days=100)}
    boite = BoiteNoire(
        reglages,
        ReleveurDuSoir(horloge),
        FauxCapteur(),
        Journal(reglages.boite_noire_dir / "releves", 7, "Europe/Paris"),
        Suiveur(reglages.journal_dir, PARIS),
        Declencheur(),
        Executeur(),
        murale=lambda: horloge["t"],
    )
    boite.tour()

    assert sorted(p.name for p in (reglages.boite_noire_dir / "parties").iterdir()) == avant
    assert len(avant) == 2


def test_la_fenetre_de_capture_se_lit_dans_une_ligne_du_journal() -> None:
    ligne = (
        "2026-11-26T23:36:11.152017+00:00 lgf nel3ab-worker[2781040]: "
        '{"half": false, "capture_age_ms": 4.1, "frames": 274, "gap_ms": [16.6, 17.6, 545.5]}'
    )
    (fenetre,) = resume.fenetres_capture(ligne)

    assert fenetre.fin == datetime(2026, 11, 26, 23, 36, 11, 152017, tzinfo=UTC)
    assert (fenetre.images, fenetre.pire_ms) == (274, 545.5)


@pytest.mark.parametrize(
    "ligne",
    [
        # Une capture qui n'a pas encore d'écarts: pas de fenêtre.
        "2026-11-26T23:32:32.342672+00:00 lgf nel3ab-worker[1]: "
        '{"half": false, "capture_age_ms": 58.71}',
        # Le demi-format a ses propres fenêtres: les compter doublerait les images.
        "2026-11-26T23:33:10.8+00:00 lgf nel3ab-worker[1]: "
        '{"half": true, "frames": 9, "gap_ms": [1, 2, 3]}',
        "2026-11-26T23:33:05.3+00:00 lgf nel3ab-worker[1]: RuntimeError: full: no complete packet",
        "pas une ligne de journal",
    ],
)
def test_ce_qui_n_est_pas_une_fenetre_pleine_n_en_est_pas_une(ligne: str) -> None:
    assert resume.fenetres_capture(ligne) == []


def test_les_essais_n_ecrivent_pas_dans_la_vraie_boite_noire() -> None:
    """Le garde de `conftest`: un essai qui construit `Settings()` sans nommer la
    boîte noire n'écrit pas ses résumés dans le vrai dossier."""
    vrai = Path.home() / ".local/state/nel3ab"
    assert not Settings().boite_noire_dir.is_relative_to(vrai)


def _fenetres_de(debut: datetime, nombre: int, pire: float) -> str:
    """Des fenêtres de capture toutes les cinq secondes, au format du journal."""
    return "".join(
        f"{(debut + timedelta(seconds=5 * rang)).astimezone(UTC).isoformat()} lgf "
        f'nel3ab-worker[9]: {{"half": false, "frames": 300, "gap_ms": [16.6, 17.0, {pire}]}}\n'
        for rang in range(nombre)
    )


def _deux_parties_de_suite(tmp_path: Path, suivante: datetime | None) -> dict[str, Any]:
    """Une partie Switch finie à 00:40:10, et la suivante dans la même salle qui
    commence 4 s plus tard: ses fenêtres tombent dans les 15 s d'attente."""
    fin = datetime(2026, 11, 27, 0, 40, 10, tzinfo=PARIS)
    texte = _fenetres_de(fin - timedelta(seconds=60), 12, 20.0)
    texte += _fenetres_de(fin + timedelta(seconds=9), 3, 900.0)
    (tmp_path / "sessions").mkdir()
    resumeur = Resumeur(tmp_path / "parties", tmp_path / "sessions", PARIS, FauxJournalctl(texte))
    partie = resume.Partie(
        1, "switch", fin - timedelta(seconds=62), fin, "7.0.0-43-generic", suivante
    )

    chemin = resumeur.resumer(partie)

    assert chemin is not None
    return json.loads(chemin.read_text(encoding="utf-8"))


def test_le_journal_s_arrete_au_debut_de_la_partie_suivante(tmp_path: Path) -> None:
    suivante = datetime(2026, 11, 27, 0, 40, 14, tzinfo=PARIS)

    capture = _deux_parties_de_suite(tmp_path, suivante)["capture"]

    assert capture["fenetres"] == 12
    assert capture["au_dessus_ms"]["250"]["fenetres"] == 0


def _mesure_de_page(quand: datetime, jeu: str, pire: int) -> dict[str, Any]:
    """Une mesure de page de la salle 1, au format du 21 novembre 2026."""
    return {
        "quand": quand.isoformat(timespec="milliseconds"),
        "quoi": "mesures",
        "visite": "8f852a84",
        "banc": False,
        "salle": {"numéro": 1, "jeu": jeu},
        "vu": {"s": 10, "vues": 600, "jeuHz": 60, "arrivées": [16, 30, pire], "attente": 5},
    }


def _pages_de_deux_parties(tmp_path: Path, suivante: datetime | None) -> dict[str, Any]:
    """Smash finie à 00:40:10, ses pages encore là, et Mario Party qui charge juste
    après dans la même salle: la page écrit le trou de son chargement 6 s après la
    fin de Smash, dans les 15 s d'attente du résumé."""
    fin = datetime(2026, 11, 27, 0, 40, 10, tzinfo=PARIS)
    lignes = [
        _mesure_de_page(fin - timedelta(seconds=10 * rang), "Super Smash Bros. Ultimate", 120)
        for rang in (3, 2, 1, 0)
    ]
    lignes.append(_mesure_de_page(fin + timedelta(seconds=6), "Mario Party 4", 30000))
    (tmp_path / "sessions").mkdir()
    (tmp_path / "sessions" / "2026-11-27.jsonl").write_text(
        "".join(json.dumps(ligne, ensure_ascii=False) + "\n" for ligne in lignes)
    )
    resumeur = Resumeur(tmp_path / "parties", tmp_path / "sessions", PARIS, FauxJournalctl(""))
    partie = resume.Partie(
        1, "switch", fin - timedelta(seconds=62), fin, "7.0.0-43-generic", suivante
    )

    chemin = resumeur.resumer(partie)

    assert chemin is not None
    return json.loads(chemin.read_text(encoding="utf-8"))


def test_les_pages_s_arretent_au_debut_de_la_partie_suivante(tmp_path: Path) -> None:
    """Le trou du chargement de Mario Party n'est pas le pire de Smash. Rouge avant:
    `pire_arrivee_ms` valait 30 000 et `mesures` 5."""
    suivante = datetime(2026, 11, 27, 0, 40, 14, tzinfo=PARIS)

    resume_smash = _pages_de_deux_parties(tmp_path, suivante)

    assert resume_smash["jeu"] == "Super Smash Bros. Ultimate"
    assert (resume_smash["pages"]["mesures"], resume_smash["pages"]["pire_arrivee_ms"]) == (4, 120)


def test_sans_partie_suivante_les_pages_courent_jusqu_au_delai(tmp_path: Path) -> None:
    """Le jumeau: sans partie suivante connue, la mesure des 15 s compte."""
    resume_smash = _pages_de_deux_parties(tmp_path, None)

    assert (resume_smash["pages"]["mesures"], resume_smash["pages"]["pire_arrivee_ms"]) == (
        5,
        30000,
    )


def test_sans_partie_suivante_le_journal_court_jusqu_au_delai(tmp_path: Path) -> None:
    """Le jumeau: sans partie suivante connue, les fenêtres des 15 s comptent, ici
    celles qu'on a posées pour la prouver."""
    capture = _deux_parties_de_suite(tmp_path, None)["capture"]

    # Celles finies 9 et 14 s après la fin; celle de 19 s est hors délai.
    assert capture["fenetres"] == 14
    assert capture["au_dessus_ms"]["250"]["fenetres"] == 2
