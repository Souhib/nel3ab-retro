"""L'hôte n'écrit et ne copie jamais à travers un lien posé dans l'emplacement.

Le conteneur du moteur monte l'emplacement en écriture (`-v {slot}:/run-data`)
sous le compte de l'hôte. Un moteur compromis (un jeu piégé et une faille de
l'émulateur) peut y laisser un lien vers un fichier de l'hôte qu'il ne voit
pas. Avant le 22 novembre 2026, le socle écrivait alors `docker logs` dans ce
fichier par `emulator.log`, vidait la cible de `running.lock` au lancement
suivant, et la copie Xenia ramenait dans le montage les fichiers visés par un
lien.

Chaque essai pose un lien vers un fichier ou un dossier HORS de l'emplacement,
puis vérifie que sa cible est intacte. Son jumeau: le même fichier ordinaire
reste écrit comme avant.
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from moteurs.socle import emplacement, salle
from moteurs.socle.lancement import EngineLaunch
from moteurs.xenia import adaptateur

CLE = bytes(range(16))
GARDE = "contenu de l'hote, a garder\n"


class Hote:
    """Un dossier de l'hôte hors de l'emplacement, et ses témoins."""

    def __init__(self, racine: Path) -> None:
        self.dossier = racine / "hote"
        self.dossier.mkdir()

    def fichier(self, nom: str) -> Path:
        temoin = self.dossier / nom
        temoin.write_text(GARDE)
        return temoin

    def intact(self, temoin: Path) -> bool:
        return temoin.read_text() == GARDE


def nouvel_emplacement(racine: Path) -> Path:
    slot = racine / "state/534507d6/neuve"
    slot.mkdir(parents=True)
    return slot


class Primitives(unittest.TestCase):
    def test_un_fichier_ordinaire_est_cree_ou_remplace(self):
        with tempfile.TemporaryDirectory() as temporaire:
            slot = nouvel_emplacement(Path(temporaire))
            (slot / "a.log").write_text("hier\n")
            with emplacement.ouvrir_sans_lien(slot, "a.log") as fichier:
                fichier.write("aujourd'hui\n")
            with emplacement.ouvrir_sans_lien(slot, "x", "y", "b.bin", mode="wb") as fichier:
                fichier.write(b"\x00\x01")
            self.assertEqual((slot / "a.log").read_text(), "aujourd'hui\n")
            self.assertEqual((slot / "x/y/b.bin").read_bytes(), b"\x00\x01")

    def test_un_lien_a_la_place_du_fichier_ou_d_un_dossier_est_refuse(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            hote, slot = Hote(racine), nouvel_emplacement(racine)
            temoin = hote.fichier("rc")
            (slot / "a.log").symlink_to(temoin)
            (slot / "x").symlink_to(hote.dossier)
            # Un lien vers un fichier qui n'existe pas encore: il serait créé.
            (slot / "pendant").symlink_to(hote.dossier / "nouveau")
            for chemin in (("a.log",), ("x", "b.log"), ("pendant",)):
                with (
                    self.subTest(chemin=chemin),
                    self.assertRaises(OSError),
                    emplacement.ouvrir_sans_lien(slot, *chemin) as fichier,
                ):
                    fichier.write("ecrit par l'hote\n")
            self.assertTrue(hote.intact(temoin))
            self.assertEqual(sorted(p.name for p in hote.dossier.iterdir()), ["rc"])

    def test_un_tube_nomme_est_refuse_sans_attendre(self):
        with tempfile.TemporaryDirectory() as temporaire:
            slot = nouvel_emplacement(Path(temporaire))
            os.mkfifo(slot / "emulator.log")
            with self.assertRaises(OSError), emplacement.ouvrir_sans_lien(slot, "emulator.log"):
                pass

    def test_neuf_refuse_un_fichier_ou_un_lien_existant(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            hote, slot = Hote(racine), nouvel_emplacement(racine)
            (slot / "lien").symlink_to(hote.dossier / "absent")
            (slot / "ordinaire").write_text("garde\n")
            for nom in ("lien", "ordinaire"):
                with (
                    self.subTest(nom=nom),
                    self.assertRaises(FileExistsError),
                    emplacement.ouvrir_sans_lien(slot, nom, neuf=True),
                ):
                    pass
            self.assertFalse((hote.dossier / "absent").exists())
            self.assertEqual((slot / "ordinaire").read_text(), "garde\n")

    def test_sans_lien_refuse_un_lien_sur_le_chemin_et_pas_un_niveau_absent(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            hote, slot = Hote(racine), nouvel_emplacement(racine)
            (slot / "xenia").symlink_to(hote.dossier)
            with self.assertRaises(OSError):
                emplacement.sans_lien(slot, "xenia", "content")
            # Les jumeaux: un niveau absent, puis un vrai dossier.
            self.assertEqual(emplacement.sans_lien(slot, "data", "bis"), slot / "data/bis")
            (slot / "data/bis").mkdir(parents=True)
            self.assertEqual(emplacement.sans_lien(slot, "data", "bis"), slot / "data/bis")

    def test_dossier_sans_lien_cree_chaque_niveau_et_refuse_un_lien(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            hote, slot = Hote(racine), nouvel_emplacement(racine)
            self.assertTrue(emplacement.dossier_sans_lien(slot, "a", "b").is_dir())
            (slot / "backups").symlink_to(hote.dossier)
            with self.assertRaises(OSError):
                emplacement.dossier_sans_lien(slot, "backups", "copie")
            self.assertEqual(sorted(hote.dossier.iterdir()), [])


class Verrou(unittest.TestCase):
    def test_le_verrou_ne_vide_pas_la_cible_d_un_lien(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            hote, slot = Hote(racine), nouvel_emplacement(racine)
            temoin = hote.fichier("fichier-important")
            (slot / "running.lock").symlink_to(temoin)
            with self.assertRaises(OSError), emplacement.tenu(slot):
                pass
            self.assertTrue(hote.intact(temoin))

    def test_le_jumeau_un_verrou_ordinaire_d_hier_est_repris(self):
        with tempfile.TemporaryDirectory() as temporaire:
            slot = nouvel_emplacement(Path(temporaire))
            (slot / "running.lock").write_text("hier\n")
            with emplacement.tenu(slot):
                self.assertEqual((slot / "running.lock").read_text(), "")


class Arret(unittest.TestCase):
    """`serve` jusqu'à son arrêt, avec un faux Docker: les trois journaux de l'hôte."""

    JOURNAUX = ("exit.json", "emulator.log", "pads.log")

    def servir(self, racine: Path, slot: Path) -> tuple[list[tuple], OSError | None]:
        pads = racine / "runtime/room-switch-essai"
        pads.mkdir(parents=True)
        appels: list[tuple] = []

        def faux_run(*args, **options):
            appels.append(args)
            if args[:2] == ("docker", "run") and args[4].endswith("-pads"):
                (pads / "devices.json").write_text(json.dumps(["/dev/null"] * 4))
            sortie = options.get("stdout")
            if args[:2] == ("docker", "logs") and hasattr(sortie, "write"):
                sortie.write(f"journal de {args[2]}\n")
            return SimpleNamespace(stdout='{"ExitCode":0}', returncode=0)

        vrai_stat = os.stat

        def faux_stat(chemin, *args, **options):
            if chemin == "/dev/dri/renderD128":
                return SimpleNamespace(st_gid=44)
            return vrai_stat(chemin, *args, **options)

        lecture, ecriture = os.pipe()
        os.close(ecriture)
        plan = EngineLaunch([], [], ["moteur"], 1)
        config = {"image": "image", "engine": str(racine)}
        with (
            os.fdopen(lecture) as entree,
            patch.object(salle, "run", faux_run),
            patch.object(salle.subprocess, "run", lambda *a, **k: None),
            patch.object(salle.os, "stat", faux_stat),
            patch.object(sys, "stdin", entree),
        ):
            try:
                salle.serve(config, racine / "jeu.iso", slot, pads, plan, lambda s: None)
            except OSError as erreur:
                return appels, erreur
        return appels, None

    def test_aucun_journal_n_est_ecrit_a_travers_un_lien(self):
        for nom in self.JOURNAUX:
            with self.subTest(journal=nom), tempfile.TemporaryDirectory() as temporaire:
                racine = Path(temporaire)
                hote, slot = Hote(racine), nouvel_emplacement(racine)
                temoin = hote.fichier(nom)
                (slot / nom).symlink_to(temoin)
                appels, erreur = self.servir(racine, slot)
                self.assertIsInstance(erreur, OSError)
                self.assertTrue(hote.intact(temoin), (slot / nom).resolve().read_text())
                # Les deux conteneurs sont quand même retirés.
                self.assertIn(("docker", "rm", "nel3ab-switch-room-switch-essai"), appels)
                self.assertIn(("docker", "rm", "nel3ab-switch-room-switch-essai-pads"), appels)

    def test_le_jumeau_les_journaux_ordinaires_sont_ecrits(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            slot = nouvel_emplacement(racine)
            for nom in self.JOURNAUX:
                (slot / nom).write_text("hier\n")
            self.assertIsNone(self.servir(racine, slot)[1])
            self.assertEqual((slot / "exit.json").read_text(), '{"ExitCode":0}')
            self.assertEqual(
                (slot / "emulator.log").read_text(),
                "journal de nel3ab-switch-room-switch-essai\n",
            )
            self.assertEqual(
                (slot / "pads.log").read_text(),
                "journal de nel3ab-switch-room-switch-essai-pads\n",
            )


class Xenia(unittest.TestCase):
    def test_un_profil_n_est_jamais_ecrit_a_travers_un_lien(self):
        identifiant = f"{adaptateur.PLAYERS[0][0]:016X}"
        profil = ("xenia", "content", identifiant, adaptateur.DASHBOARD, adaptateur.PROFILE_TYPE)
        for niveau in range(len(profil) + 2):
            with self.subTest(niveau=niveau), tempfile.TemporaryDirectory() as temporaire:
                racine = Path(temporaire)
                hote, slot = Hote(racine), nouvel_emplacement(racine)
                parties = [*profil, identifiant, "Account"][: niveau + 1]
                lien = slot.joinpath(*parties)
                lien.parent.mkdir(parents=True, exist_ok=True)
                # Un dossier visé pour les niveaux intermédiaires, un fichier
                # absent pour `Account`: l'ancien code l'aurait créé.
                lien.symlink_to(hote.dossier if parties[-1] != "Account" else hote.dossier / "A")
                if parties[-1] == "Account":
                    # Un lien à la place d'`Account` compte comme un profil présent.
                    adaptateur.profiles(slot, CLE)
                    self.assertTrue(lien.is_symlink())
                else:
                    with self.assertRaises(OSError):
                        adaptateur.profiles(slot, CLE)
                self.assertEqual(sorted(hote.dossier.iterdir()), [])

    def test_le_jumeau_les_profils_absents_sont_ecrits_et_les_presents_gardes(self):
        with tempfile.TemporaryDirectory() as temporaire:
            slot = nouvel_emplacement(Path(temporaire))
            xuids = adaptateur.profiles(slot, CLE)
            comptes = sorted(slot.rglob("Account"))
            self.assertEqual(len(comptes), 4)
            comptes[0].write_bytes(b"un profil existant")
            self.assertEqual(adaptateur.profiles(slot, CLE), xuids)
            self.assertEqual(comptes[0].read_bytes(), b"un profil existant")
            self.assertEqual(adaptateur.read_account(comptes[1].read_bytes(), CLE), "Joueur 2")

    def test_la_copie_garde_un_lien_comme_un_lien_et_ne_lit_rien_de_l_hote(self):
        with tempfile.TemporaryDirectory() as temporaire:
            racine = Path(temporaire)
            hote, slot = Hote(racine), nouvel_emplacement(racine)
            hote.fichier("cle")
            content = slot / "xenia/content"
            (content / "E03/partie").mkdir(parents=True)
            (content / "E03/partie/SAVE").write_bytes(b"partie")
            (content / "lien").symlink_to(hote.dossier)
            copie = adaptateur.backup(slot)
            self.assertTrue((copie / "content/lien").is_symlink())
            self.assertFalse((copie / "content/lien").resolve().is_relative_to(slot))
            # Le jumeau: la vraie sauvegarde est copiée.
            self.assertEqual((copie / "content/E03/partie/SAVE").read_bytes(), b"partie")

    def test_la_copie_refuse_un_lien_sur_son_chemin(self):
        for lien in ("xenia", "backups"):
            with self.subTest(lien=lien), tempfile.TemporaryDirectory() as temporaire:
                racine = Path(temporaire)
                hote, slot = Hote(racine), nouvel_emplacement(racine)
                hote.fichier("cle")
                if lien == "xenia":
                    (hote.dossier / "content").mkdir()
                    (slot / "xenia").symlink_to(hote.dossier)
                else:
                    (slot / "xenia/content/E03").mkdir(parents=True)
                    (slot / "backups").symlink_to(hote.dossier)
                avant = sorted(p.relative_to(hote.dossier) for p in hote.dossier.rglob("*"))
                with self.assertRaises(OSError):
                    adaptateur.backup(slot)
                apres = sorted(p.relative_to(hote.dossier) for p in hote.dossier.rglob("*"))
                self.assertEqual(apres, avant)
                self.assertFalse((slot / "backups").is_dir() and lien == "xenia")


if __name__ == "__main__":
    unittest.main()
