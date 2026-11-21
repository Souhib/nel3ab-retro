"""Déposer un jeu: le protocole, ses refus, et qui a le droit de l'utiliser.

Chaque essai a sa quarantaine et ses dossiers de jeux dans un dossier jetable
(voir `settings` dans conftest): aucun ne lit ni n'écrit la bibliothèque de la
machine. L'empreinte rapide attendue est recalculée ICI, sans le code du
salon, pour qu'une erreur de ce code ne puisse pas se recopier dans l'essai.
"""

import hashlib
import json
import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control import identity
from nel3ab_control.api.controllers.imports import ImportsController
from nel3ab_control.imports.rangement import fiche_switch
from tests.conftest import SOUHIB, VINCENT
from tests.imports import fabrique as f
from tests.imports.protocole import GC, MIO, annoncer, empreinte, envoyer, finir, quarantaine


@pytest.fixture(autouse=True)
def personne_sans_en_tete(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sans en-tête d'identité, personne: jamais une question au vrai tailscaled."""

    async def personne(address: str, socket: str = "") -> None:
        return None

    monkeypatch.setattr(identity, "whois", personne)


@pytest.fixture
def roms(app: FastAPI) -> Path:
    racine = Path(app.state.settings.rom_dir.split(":")[0]).parent
    for dossier in app.state.settings.rom_dir.split(":"):
        Path(dossier).mkdir(parents=True, exist_ok=True)
    return racine


def trouves(racine: Path, motif: str) -> list[Path]:
    """Chaque fichier sous `racine` dont le nom répond à `motif`, où qu'il soit."""
    return sorted(p.relative_to(racine) for p in racine.rglob(motif))


@pytest.fixture
def imports(app: FastAPI) -> ImportsController:
    controleur: ImportsController = app.state.imports
    return controleur


# ── Qui peut importer ──────────────────────────────────────────────────────


async def test_sans_identite_chaque_route_d_import_rend_401(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    ident = "0" * 32
    for methode, chemin in [
        ("GET", "/api/imports"),
        ("POST", "/api/imports"),
        ("GET", f"/api/imports/{ident}"),
        ("PUT", f"/api/imports/{ident}?decalage=0"),
        ("POST", f"/api/imports/{ident}/fin"),
        ("DELETE", f"/api/imports/{ident}"),
    ]:
        reponse = await client.request(methode, chemin, json={})
        assert reponse.status_code == 401, (methode, chemin, reponse.status_code)
    assert not quarantaine(app).exists(), "un refus ne doit rien avoir créé"


async def test_une_identite_qui_n_est_pas_admise_rend_403(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    reponse = await annoncer(client, GC, qui=VINCENT)

    assert reponse.status_code == 403
    assert not quarantaine(app).exists()


async def test_l_administrateur_peut_importer(client: httpx.AsyncClient, roms: Path) -> None:
    reponse = await annoncer(client, GC)

    assert reponse.status_code == 201
    assert reponse.json()["decalage"] == 0


async def test_une_adresse_listee_parmi_les_importeurs_peut_importer(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    """La liste passe en minuscules, comme l'identité: une majuscule n'exclut personne."""
    app.state.settings.importeurs = ["  Vincent@Example.com "]

    assert (await annoncer(client, GC, qui=VINCENT)).status_code == 201


async def test_les_droits_disent_non_sans_identite_et_sans_refus(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    non = {"peut_importer": False, "administrateur": False}
    assert (await client.get("/api/imports/droits")).json() == non
    assert (await client.get("/api/imports/droits", headers=VINCENT)).json() == non
    assert (await client.get("/api/imports/droits", headers=SOUHIB)).json() == {
        "peut_importer": True,
        "administrateur": True,
    }
    app.state.settings.importeurs = ["vincent@example.com"]
    assert (await client.get("/api/imports/droits", headers=VINCENT)).json() == {
        "peut_importer": True,
        "administrateur": False,
    }


async def test_une_adresse_d_administrateur_vide_n_admet_personne(
    client: httpx.AsyncClient, app: FastAPI
) -> None:
    app.state.settings.admin = ""
    app.state.settings.importeurs = ["", "  "]

    assert (await annoncer(client, GC)).status_code == 403


async def test_un_envoi_d_une_autre_personne_lui_reste_cache(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    app.state.settings.importeurs = ["vincent@example.com"]
    ident = (await annoncer(client, GC, qui=VINCENT)).json()["id"]
    app.state.settings.admin = "quelquun@example.com"

    assert (await client.get(f"/api/imports/{ident}", headers=SOUHIB)).status_code == 403
    app.state.settings.importeurs = ["vincent@example.com", "souhib@example.com"]
    assert (await client.get(f"/api/imports/{ident}", headers=SOUHIB)).status_code == 404


def test_les_routes_d_import_ne_sont_pas_dans_le_contrat(app: FastAPI) -> None:
    """La page de dépôt n'est pas la salle: son client TypeScript n'en a pas besoin."""
    chemins = app.openapi()["paths"]

    assert not [chemin for chemin in chemins if "import" in chemin]
    assert "/api/salles" in chemins, "le jumeau: les routes de la salle y restent"


# ── Le chemin heureux, et la reprise ───────────────────────────────────────


async def test_un_jeu_gamecube_envoye_en_morceaux_est_range_sous_son_titre(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    ident = (await annoncer(client, GC, nom="n'importe quoi.nsp")).json()["id"]
    assert await envoyer(client, ident, GC) == len(GC)

    fini = await finir(client, imports, ident)

    assert fini["etat"] == "termine"
    [element] = fini["elements"]
    assert (element["console"], element["format"], element["etat"]) == ("gc", "iso", "range")
    assert element["destination"] == "gc/Super Essai Melee.iso"
    assert "prochaine ouverture de salle" in element["message"]
    range_ = roms / "gc" / "Super Essai Melee.iso"
    assert range_.read_bytes() == GC
    assert not (quarantaine(app) / ident / "fichier").exists(), "la quarantaine est vidée"
    assert "source" not in element, "un nom du serveur ne sort jamais"


async def test_une_page_rechargee_reprend_au_decalage_du_serveur(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]
    await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x300], headers=SOUHIB
    )

    # Même fichier redéposé: même empreinte rapide, même taille.
    reprise = await annoncer(client, GC)
    assert reprise.status_code == 409
    detail = reprise.json()["detail"]
    assert (detail["raison"], detail["id"], detail["decalage"]) == ("en-cours", ident, 0x300)

    await envoyer(client, ident, GC, debut=detail["decalage"])
    fini = await finir(client, imports, ident)
    assert fini["elements"][0]["etat"] == "range"
    assert (roms / "gc" / "Super Essai Melee.iso").read_bytes() == GC


async def test_un_salon_redemarre_reprend_l_envoi_et_relit_l_empreinte_sur_le_disque(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]
    await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x400], headers=SOUHIB
    )

    # Un nouveau contrôleur sur la même quarantaine: le salon a redémarré, et
    # l'empreinte calculée au fil des morceaux est perdue avec l'ancien.
    app.state.imports = neuf = ImportsController(app.state.settings)
    lu = await client.get(f"/api/imports/{ident}", headers=SOUHIB)
    assert lu.json()["decalage"] == 0x400

    await envoyer(client, ident, GC, debut=0x400)
    fini = await finir(client, neuf, ident)
    assert fini["elements"][0]["etat"] == "range"
    assert neuf.quarantaine.charger()[0].sha256 == hashlib.sha256(GC).hexdigest()


async def test_un_decalage_faux_est_refuse_avec_le_vrai(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]
    await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x100], headers=SOUHIB
    )

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0x80}, content=GC[0x80:0x180], headers=SOUHIB
    )

    assert reponse.status_code == 409
    assert reponse.json()["detail"]["decalage"] == 0x100
    assert (quarantaine(app) / ident / "fichier").stat().st_size == 0x100


async def test_le_bon_decalage_fait_avancer_le_fichier_de_la_longueur_du_corps(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    """Le jumeau du précédent."""
    ident = (await annoncer(client, GC)).json()["id"]

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x123], headers=SOUHIB
    )

    assert reponse.status_code == 200
    assert reponse.json()["decalage"] == 0x123
    assert (quarantaine(app) / ident / "fichier").read_bytes() == GC[:0x123]


async def test_un_morceau_de_plus_de_32_mio_est_refuse_avant_d_etre_lu(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    grand = b"\0" * (64 * MIO)
    ident = (await annoncer(client, grand)).json()["id"]
    lus = 0

    async def corps() -> AsyncIterator[bytes]:
        nonlocal lus
        for _ in range(4):
            lus += 1
            yield b"\0" * 1024

    reponse = await client.put(
        f"/api/imports/{ident}",
        params={"decalage": 0},
        content=corps(),
        headers={**SOUHIB, "Content-Length": str(32 * MIO + 1)},
    )

    assert reponse.status_code == 413
    assert (quarantaine(app) / ident / "fichier").stat().st_size == 0
    assert (await client.get(f"/api/imports/{ident}", headers=SOUHIB)).json()["decalage"] == 0


async def test_un_morceau_de_32_mio_tout_juste_passe(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    """Le jumeau: la limite elle-même est admise."""
    grand = b"\1" * (32 * MIO + 10)
    ident = (await annoncer(client, grand)).json()["id"]

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=grand[: 32 * MIO], headers=SOUHIB
    )

    assert reponse.status_code == 200
    assert reponse.json()["decalage"] == 32 * MIO


async def test_un_morceau_qui_depasse_la_taille_annoncee_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC + b"\0", headers=SOUHIB
    )

    assert reponse.status_code == 413
    assert (quarantaine(app) / ident / "fichier").stat().st_size == 0


async def test_un_morceau_sans_content_length_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]

    async def corps() -> AsyncIterator[bytes]:
        yield GC[:0x100]

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=corps(), headers=SOUHIB
    )

    assert reponse.status_code == 411
    assert (quarantaine(app) / ident / "fichier").stat().st_size == 0


async def test_un_corps_plus_court_que_son_content_length_garde_ce_qui_est_arrive(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]

    async def corps() -> AsyncIterator[bytes]:
        yield GC[:0x80]

    reponse = await client.put(
        f"/api/imports/{ident}",
        params={"decalage": 0},
        content=corps(),
        headers={**SOUHIB, "Content-Length": "256"},
    )

    assert reponse.status_code == 400
    assert reponse.json()["detail"]["decalage"] == 0x80
    assert (quarantaine(app) / ident / "fichier").read_bytes() == GC[:0x80]


async def test_terminer_un_envoi_incomplet_est_refuse(
    client: httpx.AsyncClient, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]

    reponse = await client.post(f"/api/imports/{ident}/fin", headers=SOUHIB)

    assert reponse.status_code == 409
    assert reponse.json()["detail"]["raison"] == "incomplet"


# ── Doublons, abandon ──────────────────────────────────────────────────────


async def test_un_fichier_deja_dans_la_bibliotheque_est_refuse_a_l_annonce(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    (roms / "wii" / "Un autre nom.iso").write_bytes(GC)

    reponse = await annoncer(client, GC)

    assert reponse.status_code == 409
    assert reponse.json()["detail"] == {
        "raison": "deja-la",
        "message": "ce fichier est déjà dans la bibliothèque: « wii/Un autre nom.iso »",
        "fichier": "wii/Un autre nom.iso",
    }
    assert not any(quarantaine(app).glob("*/fichier"))


async def test_un_fichier_de_meme_taille_mais_different_n_est_pas_un_doublon(
    client: httpx.AsyncClient, roms: Path
) -> None:
    """Le jumeau: seule l'empreinte décide, la taille ne fait que choisir qui relire."""
    (roms / "gc" / "Autre.iso").write_bytes(GC[:-1] + b"\0")

    assert (await annoncer(client, GC)).status_code == 201


async def test_un_envoi_en_cours_chez_quelqu_un_d_autre_est_refuse_sans_son_identifiant(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    app.state.settings.importeurs = ["vincent@example.com"]
    await annoncer(client, GC)

    reponse = await annoncer(client, GC, qui=VINCENT)

    assert reponse.status_code == 409
    detail = reponse.json()["detail"]
    assert detail["raison"] == "en-cours"
    assert "id" not in detail


async def test_abandonner_efface_la_quarantaine_de_l_envoi(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]
    await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x100], headers=SOUHIB
    )

    assert (await client.delete(f"/api/imports/{ident}", headers=SOUHIB)).status_code == 204

    assert not (quarantaine(app) / ident).exists()
    assert (await client.get(f"/api/imports/{ident}", headers=SOUHIB)).status_code == 404
    # Et le même fichier peut repartir de zéro.
    assert (await annoncer(client, GC)).status_code == 201


async def test_abandonner_un_envoi_range_laisse_le_jeu_dans_la_bibliotheque(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]
    await envoyer(client, ident, GC)
    await finir(client, imports, ident)

    assert (await client.delete(f"/api/imports/{ident}", headers=SOUHIB)).status_code == 204

    assert (roms / "gc" / "Super Essai Melee.iso").read_bytes() == GC


# ── Le disque et ses plafonds ──────────────────────────────────────────────


async def test_un_envoi_qui_ferait_passer_le_disque_sous_la_marge_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    app.state.settings.imports_marge = 1000
    imports.espace_libre = lambda chemin: 1000 + len(GC) - 1

    reponse = await annoncer(client, GC)

    assert reponse.status_code == 507
    assert reponse.json()["detail"]["raison"] == "disque"
    assert not list(quarantaine(app).iterdir()), "aucun dossier d'envoi créé"


async def test_un_envoi_qui_laisse_tout_juste_la_marge_passe(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    """Le jumeau, à l'octet près."""
    app.state.settings.imports_marge = 1000
    imports.espace_libre = lambda chemin: 1000 + len(GC)

    assert (await annoncer(client, GC)).status_code == 201


async def test_un_morceau_est_refuse_quand_le_disque_se_remplit_en_route(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]
    app.state.settings.imports_marge = 10**12
    imports.espace_libre = lambda chemin: 10**12

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x100], headers=SOUHIB
    )

    assert reponse.status_code == 507
    assert (quarantaine(app) / ident / "fichier").stat().st_size == 0


async def test_un_envoi_plus_gros_que_le_plafond_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    app.state.settings.imports_max = len(GC) - 1

    assert (await annoncer(client, GC)).status_code == 413


async def test_la_quarantaine_pleine_refuse_le_suivant(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    autre = GC[:-1] + b"\1"
    app.state.settings.imports_total = len(GC) + len(autre) - 1
    assert (await annoncer(client, GC)).status_code == 201

    reponse = await annoncer(client, autre)

    assert reponse.status_code == 507
    assert reponse.json()["detail"]["raison"] == "quarantaine-pleine"


# ── Ce que le navigateur ne peut pas faire ─────────────────────────────────


async def test_un_lien_symbolique_plante_dans_la_quarantaine_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, roms: Path, tmp_path: Path
) -> None:
    victime = tmp_path / "victime.txt"
    victime.write_bytes(b"ne pas toucher")
    ident = (await annoncer(client, GC)).json()["id"]
    donnees = quarantaine(app) / ident / "fichier"
    donnees.unlink()
    donnees.symlink_to(victime)

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x100], headers=SOUHIB
    )

    assert reponse.status_code == 409
    assert reponse.json()["detail"]["raison"] == "abimee"
    assert victime.read_bytes() == b"ne pas toucher"


async def test_un_lien_dur_plante_dans_la_quarantaine_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, roms: Path, tmp_path: Path
) -> None:
    """`O_NOFOLLOW` ne voit pas un lien dur: c'est l'inode retenu qui l'arrête."""
    victime = tmp_path / "victime.txt"
    victime.write_bytes(b"ne pas toucher")
    ident = (await annoncer(client, GC)).json()["id"]
    donnees = quarantaine(app) / ident / "fichier"
    donnees.unlink()
    os.link(victime, donnees)

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x100], headers=SOUHIB
    )

    assert reponse.status_code == 409
    assert victime.read_bytes() == b"ne pas toucher"


async def test_un_dossier_d_envoi_remplace_par_un_lien_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, roms: Path, tmp_path: Path
) -> None:
    ailleurs = tmp_path / "ailleurs"
    ailleurs.mkdir()
    ident = (await annoncer(client, GC)).json()["id"]
    dossier = quarantaine(app) / ident
    (dossier / "fichier").rename(ailleurs / "fichier")
    (dossier / "etat.json").rename(ailleurs / "etat.json")
    dossier.rmdir()
    dossier.symlink_to(ailleurs)

    reponse = await client.put(
        f"/api/imports/{ident}", params={"decalage": 0}, content=GC[:0x100], headers=SOUHIB
    )

    assert reponse.status_code == 409
    assert (ailleurs / "fichier").stat().st_size == 0


@pytest.mark.parametrize(
    "nom", ["../../../../evasion.iso", "/etc/evasion.iso", "..\\..\\evasion.iso", "../"]
)
async def test_un_nom_annonce_avec_des_remontees_ne_sort_jamais_des_dossiers(
    client: httpx.AsyncClient,
    app: FastAPI,
    imports: ImportsController,
    roms: Path,
    tmp_path: Path,
    nom: str,
) -> None:
    """Sans titre dans le disque, le nom annoncé sert de repli: nettoyé, jamais suivi."""
    sans_titre = f.iso_nintendo(wii=False, identifiant="GZLE01", titre="") + b"\x11" * 0x100
    ident = (await annoncer(client, sans_titre, nom=nom)).json()["id"]
    await envoyer(client, ident, sans_titre)

    fini = await finir(client, imports, ident)

    [element] = fini["elements"]
    assert element["etat"] == "range"
    dossier, fichier = element["destination"].split("/")
    assert dossier == "gc"
    assert fichier in ("evasion.iso", "GZLE01.iso")
    assert (roms / "gc" / fichier).read_bytes() == sans_titre
    touches = trouves(tmp_path, "*evasion*")
    assert touches in ([], [Path("roms/gc/evasion.iso")])
    assert sorted(p.name for p in quarantaine(app).iterdir() if p.is_dir()) == [ident]


async def test_un_titre_de_disque_avec_des_remontees_ne_sort_jamais_du_dossier(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, tmp_path: Path
) -> None:
    # Deux remontées depuis `roms/gc` tombent à la racine du dossier jetable:
    # une évasion y serait VUE par `trouves`, au lieu d'écrire hors de l'essai.
    piege = f.iso_nintendo(wii=False, identifiant="GALE01", titre="../../piege") + b"\1" * 64
    ident = (await annoncer(client, piege)).json()["id"]
    await envoyer(client, ident, piege)

    fini = await finir(client, imports, ident)

    assert fini["elements"][0]["destination"] == "gc/piege.iso"
    assert trouves(tmp_path, "piege*") == [Path("roms/gc/piege.iso")]


@pytest.mark.parametrize("ident", ["../etc", "ABCDEF", "0" * 31, "g" * 32])
async def test_un_identifiant_impossible_rend_404(
    client: httpx.AsyncClient, roms: Path, ident: str
) -> None:
    reponse = await client.get(f"/api/imports/{ident}", headers=SOUHIB)

    assert reponse.status_code == 404


# ── Ce que le serveur redétecte ────────────────────────────────────────────


async def test_un_texte_nomme_iso_reste_en_quarantaine_comme_inconnu(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    texte = f.texte()
    ident = (await annoncer(client, texte, nom="Zelda.iso")).json()["id"]
    await envoyer(client, ident, texte)

    fini = await finir(client, imports, ident)

    assert fini["elements"][0]["etat"] == "inconnu"
    assert fini["elements"][0]["libelle"] == "inconnu, gardé en quarantaine"
    assert (quarantaine(app) / ident / "fichier").read_bytes() == texte
    assert not list((roms / "gc").iterdir())


async def test_une_empreinte_annoncee_fausse_fait_refuser_le_fichier(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    ident = (await annoncer(client, GC, empreinte_annoncee="ab" * 32)).json()["id"]
    await envoyer(client, ident, GC)

    fini = await finir(client, imports, ident)

    assert fini["elements"][0]["etat"] == "refuse"
    assert not list((roms / "gc").iterdir())


async def test_sans_cle_un_jeu_switch_attend_une_confirmation_et_n_est_pas_range(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    app.state.settings.rom_dir += f":{roms / 'switch'}"
    (roms / "switch").mkdir()
    nsp = f.pfs0(["a.nca", "b.cnmt.nca", "0100bde00862a0000000000000000004.tik"])
    ident = (await annoncer(client, nsp, nom="tennis.nsp")).json()["id"]
    await envoyer(client, ident, nsp)

    fini = await finir(client, imports, ident)

    [element] = fini["elements"]
    assert (element["console"], element["etat"], element["libelle"]) == (
        "switch",
        "a-confirmer",
        "à confirmer",
    )
    assert "clé d'en-tête" in element["message"]
    assert "NEL3AB_SWITCH_KEYS" in element["message"]
    assert "0100bde00862a000" in element["message"]
    assert not list((roms / "switch").iterdir())


# ── La Switch, avec une clé d'en-tête tirée au hasard ──────────────────────

#: Un jeu inventé, sa mise à jour et un contenu additionnel.
JEU_SWITCH = 0x0100ABCDEF012000


@pytest.fixture
def cle_switch(app: FastAPI, roms: Path, tmp_path: Path) -> bytes:
    """Une clé jetable, écrite comme un `prod.keys`, et le dossier `switch`."""
    cle = os.urandom(32)
    (tmp_path / "prod.keys").write_text(f.prod_keys(cle))
    app.state.settings.switch_keys = tmp_path / "prod.keys"
    app.state.settings.rom_dir += f":{roms / 'switch'}"
    (roms / "switch").mkdir()
    return cle


def nsp_switch(cle: bytes, programme: int = JEU_SWITCH, meta: int = JEU_SWITCH) -> bytes:
    return f.pfs0_avec(
        [
            ("aa.nca", f.nca(cle, f.TYPE_PROGRAM, programme)),
            ("bb.cnmt.nca", f.nca(cle, f.TYPE_META, meta)),
            (f"{meta:016x}0000000000000004.tik", b"ticket"),
        ]
    )


async def deposer(
    client: httpx.AsyncClient, imports: ImportsController, octets: bytes, nom: str
) -> dict:
    ident = (await annoncer(client, octets, nom=nom)).json()["id"]
    await envoyer(client, ident, octets, morceau=0x4000)
    return await finir(client, imports, ident)


def inscrire(dossier: Path, nom: str, titre: str, octets: bytes = b"jeu deja la") -> None:
    """Un jeu déjà dans la bibliothèque, avec sa fiche écrite à la main."""
    (dossier / nom).write_bytes(octets)
    (dossier / f"{nom}.nel3ab.json").write_text(
        json.dumps({"console": "switch", "name": nom.rsplit(".", 1)[0], "title": titre})
    )


async def test_un_jeu_switch_lu_avec_la_cle_est_range_avec_sa_fiche(
    client: httpx.AsyncClient,
    app: FastAPI,
    imports: ImportsController,
    roms: Path,
    cle_switch: bytes,
) -> None:
    nsp = nsp_switch(cle_switch)

    fini = await deposer(client, imports, nsp, "Super Essai Kart [0100ABCDEF012000][v0].nsp")

    [element] = fini["elements"]
    assert (element["etat"], element["destination"], element["identifiant"]) == (
        "range",
        "switch/Super Essai Kart.nsp",
        "0100ABCDEF012000",
    )
    assert element["titre"] == "Super Essai Kart"
    assert element["details"]["contenu"] == "jeu"
    jeu = roms / "switch" / "Super Essai Kart.nsp"
    fiche = roms / "switch" / "Super Essai Kart.nsp.nel3ab.json"
    assert jeu.read_bytes() == nsp
    assert fiche.read_bytes() == fiche_switch("Super Essai Kart", JEU_SWITCH).octets
    assert json.loads(fiche.read_text())["title"] == "0100ABCDEF012000"
    assert fiche.stat().st_mode & 0o777 == 0o644
    assert sorted(p.name for p in (roms / "switch").iterdir()) == [jeu.name, fiche.name]
    assert not trouves(quarantaine(app), "fichier"), "rangé, il a quitté la quarantaine"
    assert cle_switch.hex() not in json.dumps(fini)


async def test_une_carte_switch_lue_avec_la_cle_est_rangee_en_xci(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, cle_switch: bytes
) -> None:
    carte = f.xci_avec(
        [
            ("aa.nca", f.nca(cle_switch, f.TYPE_PROGRAM, JEU_SWITCH)),
            ("bb.cnmt.nca", f.nca(cle_switch, f.TYPE_META, JEU_SWITCH)),
        ],
        zone_cle=True,
    )

    fini = await deposer(client, imports, carte, "Essai Tennis.xci")

    assert fini["elements"][0]["destination"] == "switch/Essai Tennis.xci"
    assert (roms / "switch" / "Essai Tennis.xci.nel3ab.json").is_file()


async def test_le_meme_titre_deja_inscrit_est_un_doublon(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, cle_switch: bytes
) -> None:
    """La salle range les sauvegardes Switch par titre: deux fichiers les partageraient."""
    inscrire(roms / "switch", "Ancien nom.nsp", "0100abcdef012000")
    avant = sorted((roms / "switch").iterdir())

    fini = await deposer(client, imports, nsp_switch(cle_switch), "Super Essai Kart.nsp")

    [element] = fini["elements"]
    assert element["etat"] == "doublon"
    assert "0100ABCDEF012000" in element["message"]
    assert "switch/Ancien nom.nsp" in element["message"]
    assert sorted((roms / "switch").iterdir()) == avant


async def test_une_fiche_orpheline_du_meme_titre_n_inscrit_rien_et_ne_bloque_pas(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, cle_switch: bytes
) -> None:
    """Le jumeau du doublon: une fiche sans son jeu n'inscrit rien pour le worker."""
    (roms / "switch" / "Parti.nsp.nel3ab.json").write_text(
        json.dumps({"console": "switch", "name": "Parti", "title": "0100ABCDEF012000"})
    )

    fini = await deposer(client, imports, nsp_switch(cle_switch), "Super Essai Kart.nsp")

    assert fini["elements"][0]["etat"] == "range"


async def test_une_fiche_orpheline_du_meme_nom_n_est_jamais_remplacee(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, cle_switch: bytes
) -> None:
    orpheline = roms / "switch" / "Super Essai Kart.nsp.nel3ab.json"
    orpheline.write_text("la fiche de quelqu'un")

    fini = await deposer(client, imports, nsp_switch(cle_switch), "Super Essai Kart.nsp")

    [element] = fini["elements"]
    assert element["etat"] == "doublon"
    assert "rien n'a été remplacé" in element["message"]
    assert orpheline.read_text() == "la fiche de quelqu'un"
    assert sorted(p.name for p in (roms / "switch").iterdir()) == [orpheline.name]


async def test_une_mise_a_jour_reste_de_cote_et_nomme_son_jeu(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, cle_switch: bytes
) -> None:
    inscrire(roms / "switch", "Super Essai Kart.nsp", "0100ABCDEF012000")
    avant = sorted((roms / "switch").iterdir())
    maj = nsp_switch(cle_switch, programme=JEU_SWITCH, meta=JEU_SWITCH | 0x800)

    fini = await deposer(client, imports, maj, "Super Essai Kart [v65536].nsp")

    [element] = fini["elements"]
    assert (element["etat"], element["libelle"], element["titre"]) == (
        "mise-a-jour",
        "mise à jour, gardée de côté",
        "Super Essai Kart",
    )
    assert "Mise à jour de « Super Essai Kart » (0100ABCDEF012000)" in element["message"]
    assert "0100ABCDEF012800" in element["message"]
    assert sorted((roms / "switch").iterdir()) == avant


async def test_un_contenu_additionnel_reste_de_cote_meme_sans_son_jeu(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path, cle_switch: bytes
) -> None:
    ajout = f.pfs0_avec(
        [
            ("dd.nca", f.nca(cle_switch, f.TYPE_PUBLIC_DATA, JEU_SWITCH + 0x1001)),
            ("ee.cnmt.nca", f.nca(cle_switch, f.TYPE_META, JEU_SWITCH + 0x1001)),
        ]
    )

    fini = await deposer(client, imports, ajout, "Super Essai Kart DLC.nsp")

    [element] = fini["elements"]
    assert (element["etat"], element["libelle"]) == (
        "contenu-additionnel",
        "contenu additionnel, gardé de côté",
    )
    assert "absent de la bibliothèque" in element["message"]
    assert not list((roms / "switch").iterdir())


async def test_avec_une_autre_cle_le_jeu_est_refuse_et_rien_n_est_inscrit(
    client: httpx.AsyncClient,
    app: FastAPI,
    imports: ImportsController,
    roms: Path,
    cle_switch: bytes,
) -> None:
    nsp = nsp_switch(os.urandom(32))

    fini = await deposer(client, imports, nsp, "Super Essai Kart.nsp")

    [element] = fini["elements"]
    assert element["etat"] == "refuse"
    assert "clé d'en-tête fausse" in element["message"]
    assert not list((roms / "switch").iterdir())
    assert trouves(quarantaine(app), "fichier"), "le fichier reste en quarantaine"
    etats = "".join(p.read_text() for p in quarantaine(app).rglob("etat.json"))
    assert cle_switch.hex() not in etats + json.dumps(fini)


async def test_un_fichier_de_cles_regle_mais_absent_garde_l_ancien_chemin(
    client: httpx.AsyncClient,
    app: FastAPI,
    imports: ImportsController,
    roms: Path,
    cle_switch: bytes,
) -> None:
    app.state.settings.switch_keys = roms / "absent.keys"

    fini = await deposer(client, imports, nsp_switch(cle_switch), "Super Essai Kart.nsp")

    [element] = fini["elements"]
    assert element["etat"] == "a-confirmer"
    assert "ne se lit pas" in element["message"]
    assert not list((roms / "switch").iterdir())


async def test_un_jeu_xbox_360_est_reconnu_mais_pas_range(
    client: httpx.AsyncClient, imports: ImportsController, roms: Path
) -> None:
    xex = f.xex(0x4D5307E6)
    ident = (await annoncer(client, xex, nom="default.xex")).json()["id"]
    await envoyer(client, ident, xex)

    fini = await finir(client, imports, ident)

    assert (fini["elements"][0]["console_libelle"], fini["elements"][0]["libelle"]) == (
        "Xbox 360",
        "reconnu, pas encore jouable",
    )


async def test_la_liste_rend_les_envois_de_la_personne(
    client: httpx.AsyncClient, roms: Path
) -> None:
    ident = (await annoncer(client, GC)).json()["id"]

    liste = (await client.get("/api/imports", headers=SOUHIB)).json()

    assert [envoi["id"] for envoi in liste] == [ident]


def ecrire_catalogue(
    app: FastAPI, cle: str, console: str = "gc", title_id: str | None = None
) -> None:
    """Le catalogue qu'une salle écrit à son démarrage (ADR D24), avec un seul jeu."""
    salle = app.state.settings.salles_dir / "1"
    salle.mkdir(parents=True)
    jeu = {"key": cle, "name": "Un jeu", "console": console, "art": False, "title_id": title_id}
    (salle / "catalogue.json").write_text(
        json.dumps({"version": 1, "scanned_ms": 1, "roms": [jeu]}), encoding="utf-8"
    )


async def test_un_nom_deja_au_catalogue_des_salles_est_refuse(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    """Le catalogue couvre aussi un dossier que le worker balaie et que le salon ignore."""
    ecrire_catalogue(app, "Super Essai Melee.iso")
    ident = (await annoncer(client, GC)).json()["id"]
    await envoyer(client, ident, GC)

    fini = await finir(client, imports, ident)

    assert fini["elements"][0]["etat"] == "doublon"
    assert "catalogue des salles" in fini["elements"][0]["message"]
    assert not list((roms / "gc").iterdir())


async def test_un_catalogue_qui_ne_nomme_pas_ce_jeu_ne_bloque_rien(
    client: httpx.AsyncClient, app: FastAPI, imports: ImportsController, roms: Path
) -> None:
    """Le jumeau du précédent."""
    ecrire_catalogue(app, "Autre jeu.iso")
    ident = (await annoncer(client, GC)).json()["id"]
    await envoyer(client, ident, GC)

    assert (await finir(client, imports, ident))["elements"][0]["etat"] == "range"


@pytest.mark.parametrize(("titre", "etat"), [("0100abcdef012000", "doublon"), (None, "range")])
async def test_un_titre_switch_deja_au_catalogue_des_salles_est_un_doublon(
    client: httpx.AsyncClient,
    app: FastAPI,
    imports: ImportsController,
    roms: Path,
    cle_switch: bytes,
    titre: str | None,
    etat: str,
) -> None:
    """Le catalogue voit un dossier que le salon ignore; le jumeau n'y porte aucun titre."""
    ecrire_catalogue(app, "Ailleurs.nsp", console="switch", title_id=titre)

    fini = await deposer(client, imports, nsp_switch(cle_switch), "Super Essai Kart.nsp")

    [element] = fini["elements"]
    assert element["etat"] == etat
    assert ("« Ailleurs.nsp »" in element["message"]) == (etat == "doublon")
    assert bool(list((roms / "switch").iterdir())) == (etat == "range")


async def test_une_page_d_un_autre_site_ne_peut_pas_annoncer_un_envoi(
    client: httpx.AsyncClient, app: FastAPI, roms: Path
) -> None:
    """La garde d'origine de l'application couvre aussi l'import."""
    reponse = await client.post(
        "/api/imports",
        json={"nom": "jeu.iso", "taille": len(GC), "empreinte_rapide": empreinte(GC)},
        headers={**SOUHIB, "Origin": "https://ailleurs.example"},
    )

    assert reponse.status_code == 403
    assert not quarantaine(app).exists()
