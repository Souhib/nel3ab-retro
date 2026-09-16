"""Quand la boîte noire décide qu'une salle chute, et quand elle doit se taire.

Le déclencheur est ce qui remplace « refaire une soirée »: s'il ne se déclenche
pas, le profil qui aurait expliqué la chute n'existe pas; s'il se déclenche trop,
il remplit le disque et prend du processeur à une partie déjà lente. Chaque
règle a donc son jumeau.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from nel3ab_control.boite_noire.declencheur import Chute, Declencheur, Suiveur

PARIS = timezone(timedelta(hours=2))
DEBUT = datetime(2026, 9, 14, 0, 30, 0, tzinfo=PARIS)


def _mesure(
    secondes: float,
    cadence: float | None,
    visite: str = "8f852a84",
    salle: int | None = 1,
    jeu: str | None = "Mario Tennis Aces",
    banc: bool = False,
    gel_ms: float | None = None,
) -> dict[str, Any]:
    etat: dict[str, Any] = {"jeu": jeu, "présents": 4, "places": {}}
    if salle is not None:
        etat["numéro"] = salle
    return {
        "quand": (DEBUT + timedelta(seconds=secondes)).isoformat(timespec="milliseconds"),
        "quoi": "mesures",
        "visite": visite,
        "banc": banc,
        "vu": {"jeuHz": cadence, **({"arrivées": [16, 22, gel_ms]} if gel_ms is not None else {})},
        "salle": etat,
    }


def _declencheur(*lignes: dict[str, Any]) -> Declencheur:
    declencheur = Declencheur()
    for ligne in lignes:
        declencheur.lire(ligne)
    return declencheur


def test_trois_mesures_lentes_font_une_chute() -> None:
    declencheur = _declencheur(_mesure(0, 42), _mesure(10, 38), _mesure(20, 44))

    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == [
        Chute(salle=1, mediane=42.0, mesures=3, pages=1, jeu="Mario Tennis Aces")
    ]


def test_deux_mesures_lentes_ne_suffisent_pas() -> None:
    """Une page qui recharge envoie une mauvaise mesure; il en faut trois."""
    declencheur = _declencheur(_mesure(0, 30), _mesure(10, 30))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=15)) == []


def test_une_cadence_au_seuil_n_est_pas_une_chute() -> None:
    declencheur = _declencheur(_mesure(0, 50), _mesure(10, 50), _mesure(20, 50))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == []


def test_la_mediane_ignore_une_page_isolee() -> None:
    """Trois pages fluides et une lente: la salle ne chute pas."""
    declencheur = _declencheur(
        _mesure(0, 60, "a"), _mesure(1, 60, "b"), _mesure(2, 60, "c"), _mesure(3, 20, "d")
    )
    assert declencheur.evaluer(DEBUT + timedelta(seconds=5)) == []


def test_les_mesures_trop_vieilles_sortent_de_la_fenetre() -> None:
    declencheur = _declencheur(_mesure(0, 40), _mesure(40, 40), _mesure(50, 40))
    # À 55 s, la mesure de 0 s a plus de trente secondes: il n'en reste que deux.
    assert declencheur.evaluer(DEBUT + timedelta(seconds=55)) == []


def test_une_salle_signalee_se_tait_cinq_minutes_puis_peut_l_etre_encore() -> None:
    declencheur = _declencheur(_mesure(0, 40), _mesure(10, 40), _mesure(20, 40))
    assert len(declencheur.evaluer(DEBUT + timedelta(seconds=25))) == 1

    for secondes in (60, 70, 80):
        declencheur.lire(_mesure(secondes, 40))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=85)) == []

    for secondes in (330, 340, 350):
        declencheur.lire(_mesure(secondes, 40))
    assert len(declencheur.evaluer(DEBUT + timedelta(seconds=355))) == 1


def test_deux_salles_se_jugent_separement() -> None:
    declencheur = _declencheur(
        *(_mesure(s, 40, salle=1) for s in (0, 10, 20)),
        *(_mesure(s, 60, salle=2) for s in (0, 10, 20)),
    )
    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=25))
    assert chute.salle == 1


def test_un_journal_sans_numero_de_salle_juge_quand_meme() -> None:
    """Les lignes écrites avant l'ajout du numéro restent utilisables."""
    declencheur = _declencheur(*(_mesure(s, 40, salle=None) for s in (0, 10, 20)))
    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=25))
    assert chute.salle is None


def test_les_pilotes_d_essai_et_les_pages_sans_jeu_ne_comptent_pas() -> None:
    declencheur = _declencheur(
        *(_mesure(s, 20, banc=True) for s in (0, 10, 20)),
        *(_mesure(s, 20, jeu=None) for s in (1, 11, 21)),
        *(_mesure(s, None) for s in (2, 12, 22)),
        *(_mesure(s, 0) for s in (3, 13, 23)),
    )
    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == []


def test_les_lignes_qui_ne_sont_pas_des_mesures_sont_ignorees() -> None:
    declencheur = Declencheur()
    declencheur.lire({"quoi": "arrivée", "quand": DEBUT.isoformat()})
    declencheur.lire({**_mesure(0, 40), "quand": "pas une date"})
    declencheur.lire({**_mesure(0, 40), "quand": "2026-09-14T00:30:00"})
    declencheur.lire({**_mesure(0, 40), "vu": {"jeuHz": True}})
    assert declencheur.evaluer(DEBUT + timedelta(seconds=5)) == []


def _ecrire(fichier: Path, texte: str | bytes) -> None:
    donnees = texte.encode("utf-8") if isinstance(texte, str) else texte
    with fichier.open("ab") as ouvert:
        ouvert.write(donnees)


def test_une_seconde_sans_image_est_une_chute_meme_a_soixante_images_par_seconde() -> None:
    """Le défaut du 16 septembre 2026: deux joueurs signalent des mini-freezes, la
    médiane reste à 60, et rien n'est capturé. Un trou d'une seconde sur dix ne
    déplace pas une médiane."""
    declencheur = _declencheur(
        _mesure(0, 60, gel_ms=26), _mesure(10, 60, gel_ms=1176), _mesure(20, 60, gel_ms=31)
    )

    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == [
        Chute(
            salle=1,
            mediane=60.0,
            mesures=3,
            pages=1,
            jeu="Mario Tennis Aces",
            cause="gel",
            gel_ms=1176.0,
        )
    ]


def test_un_ecart_ordinaire_entre_deux_images_n_est_pas_un_gel() -> None:
    """Le jumeau. Les fenêtres saines du 16 septembre tenaient sous 100 ms; un seuil
    qui rougirait devant 90 ms capturerait toute la soirée."""
    declencheur = _declencheur(
        _mesure(0, 60, gel_ms=90), _mesure(10, 60, gel_ms=122), _mesure(20, 60, gel_ms=499)
    )

    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == []


def test_un_gel_suffit_a_lui_seul_sans_attendre_trois_mesures() -> None:
    """Une page qui vient d'arriver et qui gèle doit être capturée tout de suite: la
    règle des trois mesures protège une MÉDIANE, pas un trou mesuré."""
    declencheur = _declencheur(_mesure(0, 60, gel_ms=760))

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=5))
    assert (chute.cause, chute.gel_ms, chute.mesures) == ("gel", 760.0, 1)


def test_une_cadence_tombee_l_emporte_sur_un_gel() -> None:
    """Quand les deux règles parlent, « le jeu tourne à 40 » explique mieux qu'un trou."""
    declencheur = _declencheur(
        _mesure(0, 40, gel_ms=900), _mesure(10, 38, gel_ms=900), _mesure(20, 42, gel_ms=900)
    )

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=25))
    assert (chute.cause, chute.gel_ms, chute.mediane) == ("cadence", None, 40.0)


def test_un_gel_signale_fait_taire_la_salle_cinq_minutes_lui_aussi() -> None:
    """Sinon une soirée qui gèle toutes les deux minutes remplit le disque."""
    declencheur = _declencheur(_mesure(0, 60, gel_ms=800))
    assert len(declencheur.evaluer(DEBUT + timedelta(seconds=5))) == 1

    declencheur.lire(_mesure(60, 60, gel_ms=800))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=65)) == []

    declencheur.lire(_mesure(400, 60, gel_ms=800))
    assert len(declencheur.evaluer(DEBUT + timedelta(seconds=405))) == 1


def test_une_page_d_avant_le_14_septembre_ne_gele_jamais() -> None:
    """Le jumeau des lignes anciennes: sans le champ `arrivées`, il n'y a rien à lire,
    et un zéro ne doit pas se lire comme un gel."""
    declencheur = _declencheur(_mesure(0, 60), _mesure(10, 60), _mesure(20, 60))

    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == []


def test_le_suiveur_part_de_la_fin_et_rend_seulement_les_ajouts(tmp_path: Path) -> None:
    """Une boîte noire qui redémarre ne rejoue pas la soirée."""
    fichier = tmp_path / "2026-09-14.jsonl"
    _ecrire(fichier, '{"quoi": "ancienne"}\n')
    suiveur = Suiveur(tmp_path, PARIS)

    assert suiveur.nouvelles(DEBUT) == []
    _ecrire(fichier, '{"quoi": "nouvelle"}\n')
    assert suiveur.nouvelles(DEBUT) == [{"quoi": "nouvelle"}]
    assert suiveur.nouvelles(DEBUT) == []


def test_une_ligne_a_moitie_ecrite_attend_sa_fin(tmp_path: Path) -> None:
    fichier = tmp_path / "2026-09-14.jsonl"
    fichier.write_text("")
    suiveur = Suiveur(tmp_path, PARIS)
    suiveur.nouvelles(DEBUT)

    ligne = '{"pseudo": "Clément"}\n'.encode()
    coupure = ligne.index("é".encode()) + 1  # au milieu du caractère accentué
    _ecrire(fichier, ligne[:coupure])
    assert suiveur.nouvelles(DEBUT) == []
    _ecrire(fichier, ligne[coupure:])
    assert suiveur.nouvelles(DEBUT) == [{"pseudo": "Clément"}]


def test_au_changement_de_jour_le_nouveau_fichier_se_lit_depuis_le_debut(tmp_path: Path) -> None:
    (tmp_path / "2026-09-14.jsonl").write_text("")
    suiveur = Suiveur(tmp_path, PARIS)
    suiveur.nouvelles(DEBUT)

    _ecrire(tmp_path / "2026-09-15.jsonl", '{"quoi": "minuit passé"}\n')
    lendemain = datetime(2026, 9, 15, 0, 0, 5, tzinfo=PARIS)
    assert suiveur.nouvelles(lendemain) == [{"quoi": "minuit passé"}]


def test_un_fichier_remplace_par_un_plus_long_se_relit(tmp_path: Path) -> None:
    """Le défaut que ce test a trouvé: la première version jugeait à la taille.

    Remplacé par un fichier plus LONG, le journal était lu à partir de l'ancienne
    position, au milieu d'une ligne, et la ligne nouvelle était perdue.
    """
    fichier = tmp_path / "2026-09-14.jsonl"
    _ecrire(fichier, '{"quoi": "a"}\n{"quoi": "b"}\n')
    suiveur = Suiveur(tmp_path, PARIS)
    suiveur.nouvelles(DEBUT)

    remplacant = tmp_path / "remplacant"
    remplacant.write_text('pas du json\n[1]\n{"quoi": "c"}\n{"quoi": "d"}\n')
    remplacant.replace(fichier)
    assert suiveur.nouvelles(DEBUT) == [{"quoi": "c"}, {"quoi": "d"}]


def test_un_fichier_tronque_sur_place_se_relit(tmp_path: Path) -> None:
    fichier = tmp_path / "2026-09-14.jsonl"
    _ecrire(fichier, '{"quoi": "a"}\n{"quoi": "b"}\n')
    suiveur = Suiveur(tmp_path, PARIS)
    suiveur.nouvelles(DEBUT)

    fichier.write_text('{"quoi": "c"}\n')
    assert suiveur.nouvelles(DEBUT) == [{"quoi": "c"}]


def test_un_journal_cree_apres_le_demarrage_se_lit_depuis_le_debut(tmp_path: Path) -> None:
    """La boîte noire démarre avant la première partie du jour: rien n'est perdu."""
    suiveur = Suiveur(tmp_path, PARIS)
    assert suiveur.nouvelles(DEBUT) == []

    _ecrire(tmp_path / "2026-09-14.jsonl", '{"quoi": "première"}\n')
    assert suiveur.nouvelles(DEBUT) == [{"quoi": "première"}]


def test_un_journal_absent_ne_rend_rien(tmp_path: Path) -> None:
    assert Suiveur(tmp_path / "absent", PARIS).nouvelles(DEBUT) == []
