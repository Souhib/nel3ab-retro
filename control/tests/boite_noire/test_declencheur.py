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


# Les relevés réels du 22 septembre 2026 entre 23:24:43 et 23:25:13, salle 1, Mario
# Power Tennis: (secondes depuis 23:24:43, visite, pire écart en ms). Seule la page
# de Hyde a gelé 8,9 s; les deux autres recevaient leurs images à 19 et 29 ms près
# au même instant. La boîte noire avait pris une capture complète, profil de
# l'émulateur compris, pour une liaison.
HYDE_23_25 = [
    (0.0, "24290938", 24),
    (0.8, "42fec406", 75),
    (1.0, "d00dbdca", 25),
    (10.0, "24290938", 20),
    (10.8, "42fec406", 52),
    (11.0, "d00dbdca", 27),
    (20.0, "24290938", 25),
    (20.8, "42fec406", 65),
    (21.0, "d00dbdca", 25),
    (30.0, "24290938", 19),
    (30.9, "42fec406", 8954),
    (31.0, "d00dbdca", 29),
]


def test_le_gel_d_une_seule_page_parmi_trois_est_celui_de_la_page() -> None:
    declencheur = _declencheur(*(_mesure(t, 60, visite=v, gel_ms=g) for t, v, g in HYDE_23_25))

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=32))
    assert (chute.cause, chute.portee, chute.page, chute.gel_ms) == (
        "gel",
        "page",
        "42fec406",
        8954.0,
    )


def test_deux_pages_gelees_dans_la_meme_fenetre_font_un_gel_de_salle() -> None:
    """Le jumeau: les mêmes relevés, avec une seconde page gelée à la même seconde."""
    releves = [(t, v, 1210 if (v, t) == ("d00dbdca", 31.0) else g) for t, v, g in HYDE_23_25]
    declencheur = _declencheur(*(_mesure(t, 60, visite=v, gel_ms=g) for t, v, g in releves))

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=32))
    assert (chute.cause, chute.portee, chute.page) == ("gel", "salle", None)


def test_une_page_seule_qui_gele_ne_peut_pas_accuser_sa_liaison() -> None:
    """Sans autre page pour comparer, rien ne dit que la salle allait bien: on prend
    la capture complète plutôt que de manquer le profil d'un vrai gel."""
    declencheur = _declencheur(_mesure(0, 60, gel_ms=30), _mesure(10, 60, gel_ms=900))

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=12))
    assert (chute.portee, chute.page) == ("salle", None)


def test_un_gel_de_page_ne_fait_pas_taire_un_gel_de_salle() -> None:
    """La pause de cinq minutes sépare les deux portées: une liaison qui tousse ne
    doit pas couvrir la vraie chute de la salle qui la suit."""
    declencheur = _declencheur(*(_mesure(t, 60, visite=v, gel_ms=g) for t, v, g in HYDE_23_25))
    assert [c.portee for c in declencheur.evaluer(DEBUT + timedelta(seconds=32))] == ["page"]

    for visite in ("24290938", "d00dbdca"):
        declencheur.lire(_mesure(60, 60, visite=visite, gel_ms=1500))
    assert [c.portee for c in declencheur.evaluer(DEBUT + timedelta(seconds=61))] == ["salle"]


def test_un_gel_de_salle_fait_taire_les_gels_de_page_qui_suivent() -> None:
    """Le jumeau: la capture de salle couvre déjà les pages, une seconde serait de trop."""
    declencheur = _declencheur(
        _mesure(0, 60, visite="a", gel_ms=1500), _mesure(0, 60, visite="b", gel_ms=1500)
    )
    assert [c.portee for c in declencheur.evaluer(DEBUT + timedelta(seconds=1))] == ["salle"]

    declencheur.lire(_mesure(60, 60, visite="a", gel_ms=30))
    declencheur.lire(_mesure(60, 60, visite="b", gel_ms=1500))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=61)) == []


# --- Le seuil suit le plafond du jeu -----------------------------------------
#
# Le 11 novembre 2026, Zelda sur Switch 2 était plafonné à 30 images par seconde
# et la règle comparait sa cadence à 50, seuil des jeux à 60. La salle « chutait »
# donc dès sa troisième mesure, puis se taisait cinq minutes, puis recommençait:
# six captures de cadence sur sept portaient une médiane de 30,0. La seule vraie
# chute du jour, un transcodage Jellyfin sur la même carte graphique, est tombée
# dans un de ces silences.

ZELDA = "The Legend of Zelda: Ocarina of Time"
PLAFONDS = {ZELDA: 30.0}

#: La cadence que la page de la salle 1 a envoyée le 11 novembre 2026, toutes les
#: dix secondes, de 15:31:03 à 15:36:33 (journal du salon, champ `jeuHz`). Le
#: transcodage part à 15:32:10; le jeu retrouve 30 à 15:36:03.
SOIREE_DU_11 = [30, 30, 30, 30, 30, 30, 30, 30, 30, 17, 16, 16, 16, 16, 16, 16, 16, 15, 15, 15,
                15, 15, 15, 15, 15, 15, 15, 15, 16, 16, 30, 30, 30, 30]  # fmt: skip
PREMIERE_LENTE = SOIREE_DU_11.index(17)


def _rejouer(declencheur: Declencheur, cadences: list[int], jeu: str) -> list[tuple[int, Chute]]:
    """Donne les mesures une à une, comme le salon, et juge une seconde après chacune."""
    chutes: list[tuple[int, Chute]] = []
    for rang, cadence in enumerate(cadences):
        declencheur.lire(_mesure(rang * 10, cadence, jeu=jeu))
        for chute in declencheur.evaluer(DEBUT + timedelta(seconds=rang * 10 + 1)):
            chutes.append((rang, chute))
    return chutes


def test_un_jeu_plafonne_a_trente_qui_tient_trente_ne_chute_pas() -> None:
    declencheur = Declencheur(plafonds=PLAFONDS)
    assert _rejouer(declencheur, [30] * 40, ZELDA) == []


def test_le_meme_trente_reste_une_chute_pour_un_jeu_sans_plafond() -> None:
    """Le jumeau: c'est la table des plafonds qui fait taire, pas un seuil abaissé
    pour tout le monde. Mario Tennis à 30 au lieu de 60 est une vraie chute."""
    declencheur = Declencheur(plafonds=PLAFONDS)
    chutes = _rejouer(declencheur, [30] * 3, "Mario Tennis Aces")
    assert [(rang, chute.mediane, chute.cause) for rang, chute in chutes] == [(2, 30.0, "cadence")]


def test_la_vraie_chute_du_11_novembre_est_prise_et_rien_avant_elle() -> None:
    declencheur = Declencheur(plafonds=PLAFONDS)
    chutes = _rejouer(declencheur, SOIREE_DU_11, ZELDA)

    # Une seule: la pause de cinq minutes couvre le reste de la série.
    assert len(chutes) == 1
    rang, chute = chutes[0]
    # Trois mesures au moins la disent; la troisième arrive vingt secondes après
    # la première mesure lente, pas avant.
    assert PREMIERE_LENTE < rang <= PREMIERE_LENTE + 2
    assert chute.cause == "cadence"
    assert chute.jeu == ZELDA
    assert chute.mediane <= 17.0


def test_sans_la_table_la_meme_soiree_crie_au_debut_et_rate_la_chute() -> None:
    """Le défaut d'avant, gardé comme jumeau: le seuil de 50 parle sur une médiane
    de 30, et la vraie chute tombe dans le silence qui suit."""
    declencheur = Declencheur()
    chutes = _rejouer(declencheur, SOIREE_DU_11, ZELDA)

    assert [(rang, chute.mediane) for rang, chute in chutes[:1]] == [(2, 30.0)]
    assert not any(PREMIERE_LENTE <= rang <= PREMIERE_LENTE + 3 for rang, _ in chutes)


def test_un_jeu_plafonne_chute_sous_les_neuf_dixiemes_de_son_plafond() -> None:
    """La page arrondit la cadence à l'entier et la règle est stricte: à 27, la
    salle ne chute pas; à 26, elle chute."""
    au_seuil = Declencheur(plafonds=PLAFONDS)
    assert _rejouer(au_seuil, [27, 27, 27], ZELDA) == []

    dessous = Declencheur(plafonds=PLAFONDS)
    chutes = _rejouer(dessous, [26, 26, 26], ZELDA)
    assert [(rang, chute.mediane) for rang, chute in chutes] == [(2, 26.0)]


def test_la_part_du_plafond_se_regle() -> None:
    severe = Declencheur(plafonds=PLAFONDS, part_plafond=1.0)
    chutes = _rejouer(severe, [29, 29, 29], ZELDA)
    assert [chute.mediane for _, chute in chutes] == [29.0]

    assert _rejouer(Declencheur(plafonds=PLAFONDS, part_plafond=1.0), [30, 30, 30], ZELDA) == []


def test_un_changement_de_jeu_ne_juge_pas_le_nouveau_sur_les_mesures_de_l_ancien() -> None:
    """Passer de Zelda, à 30, à un jeu à 60: les trois 30 encore dans la fenêtre
    sont ceux de Zelda, pas une chute du nouveau jeu."""
    declencheur = Declencheur(plafonds=PLAFONDS)
    for rang in range(3):
        declencheur.lire(_mesure(rang * 10, 30, jeu=ZELDA))
    declencheur.lire(_mesure(25, 60, jeu="Mario Tennis Aces"))

    assert declencheur.evaluer(DEBUT + timedelta(seconds=26)) == []


def test_apres_un_changement_de_jeu_trois_mesures_lentes_du_nouveau_suffisent() -> None:
    """Le jumeau: le filtre par jeu ne rend pas la salle sourde. Les mesures de
    l'ancien jeu ne comptent ni pour ni contre."""
    declencheur = Declencheur(plafonds=PLAFONDS)
    declencheur.lire(_mesure(0, 30, jeu=ZELDA))
    for rang, cadence in enumerate((40, 42, 38)):
        declencheur.lire(_mesure(5 + rang * 8, cadence, jeu="Mario Tennis Aces"))

    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == [
        Chute(salle=1, mediane=40.0, mesures=3, pages=1, jeu="Mario Tennis Aces")
    ]
