"""`compilations-switch.py`, lancé comme on le lance: `python3`, des fichiers, `--json`.

Les entrées sont celles de la partie de Smash du 26 novembre 2026, réduites et
sans identité (`echantillons/compilations-2026-11-26/`):

- `mesa_ns.txt`: l'heure, à la nanoseconde, des 120 entrées Mesa écrites pendant
  la partie; l'essai en refait des fichiers datés dans un cache jetable;
- `moteur.log`: des lignes du journal de Ryubing, dont « Loading 10682 shaders »
  et les deux avertissements de 00:03:33;
- `docker.log`: des lignes de la copie `docker logs --timestamps` de la capture
  de 00:33:15, d'avant et d'après la remise à zéro du chronomètre;
- `releves.jsonl`: les relevés de la boîte noire, réduits au fil de décompression;
- le journal du worker vient de `control/tests/boite_noire/echantillons`.

Lancer: `python3 tools/test_compilations_switch.py`, sans dépendance.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

DEPOT = Path(__file__).resolve().parents[1]
OUTIL = DEPOT / "tools" / "compilations-switch.py"
ECHANTILLONS = DEPOT / "tools" / "echantillons" / "compilations-2026-11-26"
WORKER = DEPOT / "control/tests/boite_noire/echantillons/worker_2026-11-26_salle1.log"
#: `stat` de `shared.toc` le 27 novembre 2026: 86 040 octets, écrit à 23:38:41,153657643.
TOC_OCTETS, TOC_ECRIT_NS = 86_040, 1_795_736_321_153_657_643
#: Et celui d'`index`, modifié pendant la partie, qui ne compte pas.
INDEX_NS = 1_795_736_305_560_206_000


class Outil(unittest.TestCase):
    def setUp(self) -> None:
        dossier = tempfile.TemporaryDirectory()
        self.addCleanup(dossier.cleanup)
        self.tmp = Path(dossier.name)
        self.mesa = self.tmp / "mesa"
        for rang, ligne in enumerate((ECHANTILLONS / "mesa_ns.txt").read_text().split()):
            fichier = self.mesa / f"{rang % 256:02x}" / f"entree-{rang}"
            fichier.parent.mkdir(parents=True, exist_ok=True)
            fichier.write_bytes(b"x")
            os.utime(fichier, ns=(int(ligne), int(ligne)))
        for nom in ("index", "marker"):
            (self.mesa / nom).write_bytes(b"x")
            os.utime(self.mesa / nom, ns=(INDEX_NS, INDEX_NS))
        self.toc = self.tmp / "shared.toc"
        self.toc.write_bytes(b"\0" * TOC_OCTETS)
        os.utime(self.toc, ns=(TOC_ECRIT_NS, TOC_ECRIT_NS))
        self.moteur = self.tmp / "Ryujinx_1.3.3+475615f_2026-11-26_23-32-33.log"
        self.moteur.write_text((ECHANTILLONS / "moteur.log").read_text(encoding="utf-8"))

    def lancer(self, *autres: str, worker: Path = WORKER) -> subprocess.CompletedProcess[str]:
        return subprocess.run(  # noqa: S603 - l'outil du dépôt, arguments fixes
            [
                *(sys.executable, str(OUTIL), "--json", "--zone", "UTC"),
                *("--journal-worker", str(worker), "--mesa", str(self.mesa)),
                *("--toc", str(self.toc), "--journal-moteur", str(self.moteur)),
                *("--releves", str(ECHANTILLONS / "releves.jsonl")),
                *autres,
            ],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    def resultat(self, *autres: str, worker: Path = WORKER) -> dict[str, Any]:
        docker = ("--heures-docker", str(ECHANTILLONS / "docker.log"))
        fini = self.lancer(*docker, *autres, worker=worker)
        self.assertEqual(fini.returncode, 0, fini.stderr)
        return json.loads(fini.stdout)

    def fenetre(self, resultat: dict[str, Any], fin: str) -> dict[str, Any]:
        trouvees = [une for une in resultat["fenetres"] if une["fin"] == fin]
        self.assertEqual(len(trouvees), 1, fin)
        return trouvees[0]

    def test_la_fenetre_du_gel_de_545_ms_compte_sept_entrees_et_deux_avertissements(
        self,
    ) -> None:
        """La fenêtre finie à 23:36:11: 7 entrées Mesa, « too slow » à 23:36:07,132
        et « missed on draw » à 23:36:07,472.

        Elle n'est PAS étiquetée « chargement »: le relevé où le fil de
        décompression prend 16,3 % finit à 00:36:05,792 (heure des joueurs), 0,36 s
        avant le début de cette fenêtre; c'est la fenêtre d'avant, finie à
        23:36:06, qui l'est. Le plan du chantier 3 attendait les deux étiquettes
        ici: un relevé qui ne chevauche pas la fenêtre ne la décrit pas."""
        resultat = self.resultat()

        une = self.fenetre(resultat, "23:36:11")
        compte = (une["pire_ms"], une["mesa"], une["lents"], une["manques"])
        self.assertEqual(compte, (545.5, 7, 1, 1))
        self.assertEqual(une["etiquettes"], ["compilation"])
        self.assertEqual(self.fenetre(resultat, "23:36:06")["etiquettes"], ["chargement"])

    def test_la_fenetre_finie_a_23_39_06_est_un_chargement_sans_compilation(self) -> None:
        """Le trou de 383 ms de fin de match: le rapport de jeu, pas un shader."""
        une = self.fenetre(self.resultat(), "23:39:06")

        compte = (une["pire_ms"], une["mesa"], une["lents"], une["manques"])
        self.assertEqual(compte, (383.4, 0, 0, 0))
        self.assertEqual(une["etiquettes"], ["chargement"])

    def test_une_fenetre_calme_n_a_aucune_etiquette(self) -> None:
        """Le jumeau: 23:35:01, en combat, sans écriture ni décompression."""
        une = self.fenetre(self.resultat(), "23:35:01")

        compte = (une["mesa"], une["lents"], une["manques"], une["etiquettes"])
        self.assertEqual(compte, (0, 0, 0, []))

    def test_les_comptes_de_la_partie(self) -> None:
        """120 entrées Mesa dans 8 fenêtres; 69 programmes Ryubing nouveaux, le dernier
        écrit à 23:38:41,153 (constat RYU-1, vérifié le 27 novembre 2026). Sur les 84
        fenêtres, 11 sont « chargement », dont les deux du démarrage: les 9 de DON-9."""
        resultat = self.resultat()

        self.assertEqual(resultat["mesa_pendant"], 120)
        avec = [une["fin"] for une in resultat["fenetres"] if une["mesa"]]
        rafales = ["23:36:11", "23:36:31", "23:36:36", "23:37:11"]
        rafales += ["23:37:51", "23:37:56", "23:38:26", "23:38:41"]
        self.assertEqual(avec, rafales)
        chargement = [u["fin"] for u in resultat["fenetres"] if "chargement" in u["etiquettes"]]
        self.assertEqual(len(resultat["fenetres"]), 84)
        self.assertEqual(len(chargement), 11)
        self.assertEqual(chargement[:2], ["23:33:10", "23:33:15"])
        self.assertIn("23:33:50", chargement)
        toc = {"au_depart": 10682, "a_la_fin": 10751, "nouveaux": 69}
        self.assertEqual(resultat["toc"], {**toc, "derniere_ecriture": "23:38:41.153"})
        self.assertIs(self.fenetre(resultat, "23:38:41").get("toc_derniere_ecriture"), True)
        # 23:32:33,786 à la milliseconde, comme l'audit. La copie entière donne
        # 33,785574; les cinquante lignes gardées ici, 33,785607.
        t0 = {"heure": "2026-11-26T23:32:33.785607+00:00", "source": "docker"}
        self.assertEqual(resultat["t0"], t0)

    def test_sans_copie_docker_l_heure_vient_du_nom_du_journal(self) -> None:
        """À la seconde près, et dit comme tel. Ce soir-là, l'erreur de 0,79 s laisse
        encore les deux avertissements dans la bonne fenêtre."""
        fini = self.lancer()
        self.assertEqual(fini.returncode, 0, fini.stderr)
        resultat = json.loads(fini.stdout)

        t0 = {"heure": "2026-11-26T23:32:33+00:00", "source": "nom du fichier, à la seconde"}
        self.assertEqual(resultat["t0"], t0)
        une = self.fenetre(resultat, "23:36:11")
        self.assertEqual((une["lents"], une["manques"]), (1, 1))

    def test_une_copie_docker_d_une_autre_partie_est_refusee(self) -> None:
        """Le jumeau du chronomètre: une copie qui ne partage pas dix lignes avec le
        journal du moteur ne donne pas son heure."""
        autre = self.tmp / "autre.log"
        autre.write_text(
            "".join(
                f"2026-11-20T20:00:{seconde:02d}.000000000Z 00:00:{seconde:02d}.000 |I| autre\n"
                for seconde in range(20)
            )
        )

        fini = self.lancer("--heures-docker", str(autre))

        self.assertEqual(fini.returncode, 2, fini.stdout)
        self.assertIn("autre partie", fini.stderr)

    def test_une_partie_sans_lignes_de_capture_ecrit_non_mesure(self) -> None:
        """Mario Party 4 sur Dolphin, juste après: le worker l'encode lui-même et
        n'écrit aucune fenêtre. « non mesuré », jamais une liste vide ni des zéros."""
        dolphin = self.tmp / "dolphin.log"
        lignes = [
            ligne
            for ligne in WORKER.read_text(encoding="utf-8").splitlines()
            if ligne >= "2026-11-26T23:40:12"
        ]
        self.assertGreater(len(lignes), 10, "la précondition: des lignes du worker")
        dolphin.write_text("".join(ligne + "\n" for ligne in lignes))

        resultat = self.resultat(worker=dolphin)

        self.assertEqual(resultat["fenetres"], "non mesuré")
        self.assertNotIn("mesa_pendant", resultat)

    def test_la_zone_ne_change_que_l_affichage(self) -> None:
        for zone, attendu in (("UTC", "23:36:11"), ("Europe/Paris", "00:36:11")):
            with self.subTest(zone=zone):
                resultat = self.resultat("--zone", zone)
                fins = [une["fin"] for une in resultat["fenetres"] if une["mesa"] == 7]
                self.assertEqual(fins, [attendu])

    def test_l_horodatage_du_toc_est_bien_celui_du_27_novembre(self) -> None:
        """La précondition des essais: la constante est l'heure lue par `stat`."""
        ecrit = datetime.fromtimestamp(TOC_ECRIT_NS / 1e9, UTC)
        lu = ecrit.isoformat(timespec="milliseconds")
        self.assertEqual(lu, "2026-11-26T23:38:41.153+00:00")


if __name__ == "__main__":
    unittest.main()
