"""Le journal des parties: une ligne quand une place commence, une quand elle finit.

Le contrôleur de salle est piloté directement, avec une horloge de papier: les
durées sont alors exactes, et chaque chemin qui rend une place est essayé avec
la raison qu'il doit écrire.
"""

import json
import os
import stat
from pathlib import Path

import httpx
import pytest

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.controllers.tablee import Tablee
from nel3ab_control.api.ws.handlers import _joueur
from nel3ab_control.parties import Fin, JeuJoue, Parties, Sauvegarde, sauvegarde_de
from nel3ab_control.personnes import empreinte
from nel3ab_control.settings import Settings

ALICE = "alice@example.com"
BENOIT = "benoit@example.com"
MARIO = JeuJoue(cle="Mario Kart Double Dash.rvz", console="gc", titre="Mario Kart Double Dash")
SMASH = JeuJoue(cle="Super Smash Bros Melee.rvz", console="gc", titre="Super Smash Bros Melee")


class Horloge:
    """Une horloge monotone qu'on avance à la main."""

    def __init__(self) -> None:
        self.maintenant = 1000.0

    def __call__(self) -> float:
        return self.maintenant


@pytest.fixture
def parties(tmp_path: Path) -> Parties:
    return Parties(tmp_path / "parties")


@pytest.fixture
def horloge() -> Horloge:
    return Horloge()


@pytest.fixture
def salle(parties: Parties, horloge: Horloge) -> RoomController:
    """La salle 1, son journal et son horloge, sans worker: rien n'y est vérifié."""
    rooms = RoomController(Settings(), httpx.AsyncClient(), 1, parties)
    rooms.tablee = Tablee(1, parties, horloge)
    return rooms


def lignes(parties: Parties, login: str) -> list[dict]:
    return parties.lire(login)


def test_personal_state_is_isolated() -> None:
    """Le garde de `conftest`: les réglages par défaut ne visent pas le vrai dossier."""
    reglages = Settings()
    vrai = Path.home() / ".local/state/nel3ab"
    for dossier in (reglages.parties_dir, reglages.personal_save_root):
        assert not dossier.is_relative_to(vrai), dossier
    assert not reglages.switch_config.is_relative_to(Path.home() / ".config/nel3ab")


def test_une_place_tenue_ecrit_son_debut_puis_sa_fin_et_sa_duree(
    salle: RoomController, parties: Parties, horloge: Horloge
) -> None:
    salle.tablee.jeu(MARIO)
    salle.claim(2, "sid-alice", "Alice", login=ALICE)
    horloge.maintenant += 754.25
    salle.release("sid-alice", Fin.DECONNECTEE)

    debut, fin = lignes(parties, ALICE)
    assert debut["quoi"] == "place_debut"
    assert (debut["salle"], debut["place"]) == (1, 2)
    assert debut["jeu"] == {"cle": MARIO.cle, "console": "gc", "titre": MARIO.titre}
    assert fin["quoi"] == "place_fin"
    assert fin["id"] == debut["id"]
    assert fin["secondes"] == 754.2
    assert fin["raison"] == "deconnectee"


def test_sans_identite_la_place_existe_mais_rien_n_est_ecrit(
    salle: RoomController, parties: Parties
) -> None:
    """Le jumeau: une page sans proxy tient sa manette, sans fichier à qui l'attribuer."""
    salle.claim(1, "sid-anonyme", "quelqu'un")
    assert salle.seats()[0].player == "quelqu'un"
    assert salle.seats()[0].premiere is None
    assert not parties.dossier.exists()


def test_une_page_de_banc_n_ecrit_pas_au_nom_de_qui_la_pilote() -> None:
    """Mes pilotes prennent de vraies places, souvent sous ma propre identité."""
    assert _joueur({"login": ALICE, "banc": True}) is None
    assert _joueur({"login": ALICE, "banc": False}) == ALICE
    assert _joueur({"login": None}) is None


def test_chaque_chemin_qui_rend_une_place_ecrit_sa_raison(
    salle: RoomController, parties: Parties
) -> None:
    salle.tablee.jeu(MARIO)
    salle.claim(1, "a", "Alice", login=ALICE)
    salle.watch("a")
    salle.claim(1, "b", "Alice", login=ALICE)
    salle.free(1)
    salle.claim(1, "c", "Alice", login=ALICE)
    salle.forget_absent(set())
    salle.claim(1, "d", "Alice", login=ALICE)
    salle.claim(3, "d", "Alice", login=ALICE)
    salle.tablee.fermee()

    raisons = [ligne["raison"] for ligne in lignes(parties, ALICE) if ligne["quoi"] == "place_fin"]
    assert raisons == ["quittee", "remplacee", "deconnectee", "quittee", "salle_fermee"]
    debuts = [ligne for ligne in lignes(parties, ALICE) if ligne["quoi"] == "place_debut"]
    assert [ligne["place"] for ligne in debuts] == [1, 1, 1, 1, 3]
    # Une réaffirmation de la même prise n'est pas une nouvelle place.
    assert len({ligne["id"] for ligne in debuts}) == 5


def test_une_prise_perdue_apres_un_lancement_a_perdu_son_jeu_pas_sa_place(
    salle: RoomController, parties: Parties
) -> None:
    """Le worker redémarre à chaque lancement et redonne toutes les prises.

    Sans lancement, une prise reprise par le worker est passée à quelqu'un
    d'autre: c'est le jumeau.
    """
    ancien, neuf, autre = "0" * 32 + "-1", "1" * 32 + "-2", "2" * 32 + "-3"
    salle.tablee.jeu(MARIO)
    salle.observe_seats([ancien, None, None, None])
    salle.claim(1, "a", "Alice", ancien, login=ALICE)
    salle.observe_seats([autre, None, None, None])
    salle.observe_seats([ancien, None, None, None])
    salle.claim(1, "a", "Alice", ancien, login=ALICE)
    salle.tablee.lance(BENOIT, "Benoît", SMASH, 2)
    salle.observe_seats([neuf, None, None, None])

    raisons = [ligne["raison"] for ligne in lignes(parties, ALICE) if ligne["quoi"] == "place_fin"]
    assert raisons == ["remplacee", "jeu_change"]


def test_un_changement_de_jeu_coupe_la_place_et_la_reprend_sur_le_nouveau(
    salle: RoomController, parties: Parties, horloge: Horloge
) -> None:
    salle.tablee.jeu(MARIO)
    salle.claim(2, "a", "Alice", login=ALICE)
    horloge.maintenant += 60
    salle.tablee.jeu(SMASH)
    horloge.maintenant += 30
    salle.tablee.jeu(None)

    vues = [
        (ligne["quoi"], (ligne.get("jeu") or {}).get("titre")) for ligne in lignes(parties, ALICE)
    ]
    assert vues == [
        ("place_debut", MARIO.titre),
        ("place_fin", None),
        ("place_debut", SMASH.titre),
        ("place_fin", None),
        ("place_debut", None),
    ]
    fins = [ligne for ligne in lignes(parties, ALICE) if ligne["quoi"] == "place_fin"]
    assert [(fin["secondes"], fin["raison"]) for fin in fins] == [
        (60.0, "jeu_change"),
        (30.0, "jeu_change"),
    ]
    # Le même jeu relu n'est pas un changement.
    salle.tablee.jeu(None)
    assert len(lignes(parties, ALICE)) == 5


def test_la_premiere_place_dans_une_salle_est_marquee_et_la_suivante_non(
    tmp_path: Path, parties: Parties, horloge: Horloge
) -> None:
    une = RoomController(Settings(), httpx.AsyncClient(), 1, parties)
    deux = RoomController(Settings(), httpx.AsyncClient(), 2, parties)
    une.claim(1, "a", "Alice", login=ALICE)
    assert une.seats()[0].premiere is True
    une.release("a", Fin.QUITTEE)
    assert une.seats()[0].premiere is None
    une.claim(1, "a2", "Alice", login=ALICE)
    assert une.seats()[0].premiere is False
    # Une autre salle est une autre première fois.
    deux.claim(3, "a3", "Alice", login=ALICE)
    assert deux.seats()[2].premiere is True
    # Et quelqu'un d'autre dans la même salle aussi.
    une.claim(2, "b", "Benoît", login=BENOIT)
    assert une.seats()[1].premiere is True

    # Un salon qui redémarre relit le fichier: la salle 1 n'est plus une première.
    relu = RoomController(Settings(), httpx.AsyncClient(), 1, Parties(tmp_path / "parties"))
    relu.claim(1, "a4", "Alice", login=ALICE)
    assert relu.seats()[0].premiere is False


def test_un_journal_illisible_ne_fait_pas_inventer_une_premiere_fois(
    tmp_path: Path, parties: Parties
) -> None:
    """Le fichier est un dossier: on ne sait pas, et la page garde sa mémoire."""
    parties.chemin(ALICE).mkdir(parents=True)
    rooms = RoomController(Settings(), httpx.AsyncClient(), 1, parties)
    rooms.claim(1, "a", "Alice", login=ALICE)
    assert rooms.seats()[0].premiere is None


def test_la_sauvegarde_est_celle_de_qui_a_lance_sauf_tout_debloque(
    salle: RoomController, parties: Parties
) -> None:
    """Décision de Souhib du 21 novembre 2026, lue dans les lignes de chacun."""
    salle.tablee.lance(BENOIT, "Benoît", MARIO, 2)
    salle.tablee.jeu(MARIO)
    salle.claim(1, "a", "Alice", login=ALICE)
    salle.claim(2, "b", "Benoît", login=BENOIT)
    salle.tablee.lance(ALICE, "Alice", SMASH, 1)
    salle.tablee.jeu(SMASH)

    alice = [ligne for ligne in lignes(parties, ALICE) if ligne["quoi"] == "place_debut"]
    assert alice[0]["lance"] == {"empreinte": empreinte(BENOIT), "pseudo": "Benoît"}
    assert alice[0]["sauvegarde"] == "lanceur"
    assert alice[1]["lance"] == {"empreinte": empreinte(ALICE), "pseudo": "Alice"}
    assert alice[1]["sauvegarde"] == "commune"
    lancements = [ligne for ligne in lignes(parties, ALICE) if ligne["quoi"] == "lancement"]
    assert [
        (ligne["jeu"]["titre"], ligne["emplacement"], ligne["sauvegarde"]) for ligne in lancements
    ] == [(SMASH.titre, "tout débloqué", "commune")]
    assert lignes(parties, BENOIT)[0]["quoi"] == "lancement"


def test_un_jeu_qui_tournait_avant_le_salon_n_a_pas_de_lanceur_invente(
    salle: RoomController, parties: Parties
) -> None:
    salle.tablee.lance(BENOIT, "Benoît", SMASH, 2)
    salle.tablee.jeu(MARIO)
    salle.claim(1, "a", "Alice", login=ALICE)
    debut = lignes(parties, ALICE)[0]
    assert debut["lance"] is None
    assert debut["sauvegarde"] == "inconnue"


@pytest.mark.parametrize(
    ("emplacement", "login", "attendue"),
    [
        (0, ALICE, Sauvegarde.LANCEUR),
        (2, ALICE, Sauvegarde.LANCEUR),
        (1, ALICE, Sauvegarde.COMMUNE),
        (1, None, Sauvegarde.COMMUNE),
        (0, None, Sauvegarde.NEUVE),
        (2, None, Sauvegarde.NEUVE),
        # Une adresse sans rien de lisible n'a pas de dossier personnel.
        (2, "...", Sauvegarde.NEUVE),
        (None, ALICE, Sauvegarde.INCONNUE),
    ],
)
def test_la_sauvegarde_suit_la_regle_du_worker(
    emplacement: int | None, login: str | None, attendue: Sauvegarde
) -> None:
    assert sauvegarde_de(emplacement, login) == attendue


def test_deux_adresses_au_meme_nom_lisible_ont_deux_journaux(
    salle: RoomController, parties: Parties
) -> None:
    salle.claim(1, "a", "Alex", login="alex+test@example.com")
    salle.claim(2, "b", "Alex", login="alex-test@example.com")
    assert parties.chemin("alex+test@example.com") != parties.chemin("alex-test@example.com")
    assert len(parties.lire("alex+test@example.com")) == 1
    assert len(parties.lire("alex-test@example.com")) == 1


def test_le_fichier_ne_dit_rien_de_l_adresse_et_n_est_lisible_que_par_son_proprietaire(
    salle: RoomController, parties: Parties
) -> None:
    salle.tablee.lance(ALICE, "Alice", MARIO, 2)
    salle.tablee.jeu(MARIO)
    salle.claim(1, "a", "Alice", login=ALICE)
    salle.claim(2, "b", "Benoît", login=BENOIT)
    for chemin in parties.dossier.iterdir():
        assert "alice" not in chemin.name
        assert "example" not in chemin.read_text(encoding="utf-8")
        assert stat.S_IMODE(os.stat(chemin).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(parties.dossier).st_mode) == 0o700


def test_un_disque_qui_refuse_ne_fait_pas_tomber_la_salle(tmp_path: Path) -> None:
    bloque = tmp_path / "pas-un-dossier"
    bloque.write_text("occupé")
    parties = Parties(bloque)
    rooms = RoomController(Settings(), httpx.AsyncClient(), 1, parties)
    rooms.claim(1, "a", "Alice", login=ALICE)
    rooms.release("a", Fin.DECONNECTEE)
    assert rooms.seats()[0].player is None
    assert parties.dropped == 2


def test_une_ligne_coupee_par_un_arret_est_sautee_et_n_emporte_pas_la_suivante(
    parties: Parties,
) -> None:
    parties.ecrire(ALICE, "lancement", salle=1)
    with parties.chemin(ALICE).open("a", encoding="utf-8") as fichier:
        fichier.write('{"v": 1, "quand": "2026-11-21T21:00:00+01:00", "quoi": "place_d')
    parties.ecrire(ALICE, "lancement", salle=2)
    assert [ligne["salle"] for ligne in parties.lire(ALICE)] == [1, 2]


def test_un_tube_a_la_place_du_fichier_ne_bloque_pas_la_lecture(parties: Parties) -> None:
    """Un lecteur qui OUVRE un tube nommé attend un écrivain pour toujours."""
    parties.dossier.mkdir(parents=True)
    os.mkfifo(parties.chemin(ALICE))
    assert parties.lire(ALICE) == []
    assert parties.deja_assis(ALICE, 1) is None


def test_une_ligne_d_un_autre_format_est_ignoree(parties: Parties) -> None:
    parties.dossier.mkdir(parents=True)
    parties.chemin(ALICE).write_text(
        json.dumps(
            {"v": 2, "quand": "2026-11-21T21:00:00+01:00", "quoi": "place_debut", "salle": 1}
        )
        + "\n",
        encoding="utf-8",
    )
    assert parties.lire(ALICE) == []
    assert parties.deja_assis(ALICE, 1) is False
