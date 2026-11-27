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


def test_un_gel_signale_fait_taire_la_salle_une_minute() -> None:
    """Une minute, et pas cinq. Le 27 novembre 2026, la pause de cinq minutes ouverte
    par le trou de 1 488 ms de 00:33:23 aurait couvert le gel de 543 ms de 00:36:14.
    Une minute laisse finir la capture (dix secondes de profil), et une soirée qui
    gèle sans arrêt prend au plus une capture par minute et par salle."""
    declencheur = _declencheur(_mesure(0, 60, gel_ms=800))
    assert len(declencheur.evaluer(DEBUT + timedelta(seconds=1))) == 1

    declencheur.lire(_mesure(40, 60, gel_ms=900))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=41)) == []

    declencheur.lire(_mesure(70, 60, gel_ms=700))
    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=71))
    assert (chute.cause, chute.gel_ms) == ("gel", 700.0)


def test_la_pause_d_un_gel_ne_fait_pas_taire_une_chute_de_cadence_qui_suit() -> None:
    declencheur = _declencheur(_mesure(0, 60, gel_ms=800))
    assert [c.cause for c in declencheur.evaluer(DEBUT + timedelta(seconds=1))] == ["gel"]

    for secondes in (70, 80, 90):
        declencheur.lire(_mesure(secondes, 40))
    assert [c.cause for c in declencheur.evaluer(DEBUT + timedelta(seconds=91))] == ["cadence"]


def test_une_chute_de_cadence_fait_toujours_taire_les_gels_cinq_minutes() -> None:
    """Le jumeau: la pause courte est celle du gel. Une salle qui tourne à 40 images
    par seconde hoquette aussi, et ses trous décrivent la même lenteur."""
    declencheur = _declencheur(_mesure(0, 40), _mesure(10, 40), _mesure(20, 40))
    assert [c.cause for c in declencheur.evaluer(DEBUT + timedelta(seconds=21))] == ["cadence"]

    declencheur.lire(_mesure(120, 60, gel_ms=900))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=121)) == []
    declencheur.lire(_mesure(330, 60, gel_ms=900))
    assert [c.cause for c in declencheur.evaluer(DEBUT + timedelta(seconds=331))] == ["gel"]


def _rejouer_toutes_les_deux_secondes(
    declencheur: Declencheur, lignes: list[dict[str, Any]], jusqu_a: float
) -> list[tuple[float, Chute]]:
    """Comme le service: les lignes arrivent à leur heure, et on juge toutes les 2 s."""
    restantes = sorted(lignes, key=lambda ligne: ligne["quand"])
    chutes: list[tuple[float, Chute]] = []
    seconde = 0.0
    while seconde <= jusqu_a:
        maintenant = DEBUT + timedelta(seconds=seconde)
        while restantes and datetime.fromisoformat(restantes[0]["quand"]) <= maintenant:
            declencheur.lire(restantes.pop(0))
        chutes.extend((seconde, chute) for chute in declencheur.evaluer(maintenant))
        seconde += 2
    return chutes


def test_un_meme_trou_reste_dans_les_arrivees_et_ne_donne_qu_une_capture() -> None:
    """La page garde ses six cents derniers écarts (`video.ts`). Quand elle reçoit peu
    d'images, le même trou reste le pire de plusieurs fenêtres de suite: c'est un
    gel, pas sept."""
    lignes = [_fenetre(10 * rang, 60, 900, vues=80) for rang in range(8)]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 90)

    assert [(seconde, chute.gel_ms) for seconde, chute in chutes] == [(0.0, 900.0)]


def test_un_long_gel_qui_dure_ne_donne_qu_une_capture() -> None:
    """Le gel de Sonic au format du 21 novembre 2026: plus une image, une attente qui
    grandit de dix secondes à chaque fenêtre, puis l'image qui revient."""
    lignes = [_fenetre(0, 60, 20, attente=3000, vues=420)]
    lignes += [
        _fenetre(10 * rang, 0, 0, attente=3000 + 10_000 * rang, vues=0)
        for rang in (1, 2, 3, 4, 5, 6, 7, 8)
    ]
    lignes.append(_fenetre(90, 60, 87_000, attente=10, vues=300))

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 100)

    assert [(seconde, chute.gel_ms) for seconde, chute in chutes] == [(0.0, 3000.0)]


def test_une_image_qui_fige_apres_un_trou_capture_est_un_autre_gel() -> None:
    """Un trou de 900 ms, l'image qui revient, puis plus aucune image: le gel de Sonic
    du 21 novembre 2026, précédé d'un hoquet. La fenêtre sans image ne continue pas le
    trou d'avant, puisque l'image était revenue (attente de 10 ms). Liée au hoquet
    déjà capturé, l'image figée n'avait jamais de capture; avec la pause de cinq
    minutes d'avant, elle en avait une à la sixième. Elle a la sienne quand la
    minute de pause du hoquet finit, et une seule."""
    lignes = [_fenetre(0, 60, 900, attente=10, vues=590)]
    lignes += [
        _fenetre(10 * rang, 0, 0, attente=10_000 * rang - 1_000, vues=0) for rang in range(1, 33)
    ]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 320)

    assert [(seconde, chute.gel_ms) for seconde, chute in chutes] == [(0.0, 900.0), (60.0, 59000.0)]


def test_deux_gels_distincts_a_plus_d_une_minute_font_deux_captures() -> None:
    """Le jumeau des deux précédents: des fenêtres saines entre les deux trous, qui ne
    se ressemblent pas, et deux captures."""
    lignes = [
        _fenetre(0, 60, 900),
        *(_fenetre(10 * rang, 60, 20) for rang in range(1, 8)),
        _fenetre(80, 60, 1300),
    ]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 90)

    assert [(seconde, chute.gel_ms) for seconde, chute in chutes] == [(0.0, 900.0), (80.0, 1300.0)]


def test_un_meme_pire_apres_six_cents_images_est_un_autre_gel() -> None:
    """Le jumeau de la règle des arrivées: les mêmes fenêtres, mais la dernière a reçu
    six cents images. Elles ont remplacé tous les écarts de la page, et un pire
    identique est alors un nouveau trou."""
    lignes = [_fenetre(10 * rang, 60, 900, vues=80) for rang in range(7)]
    lignes.append(_fenetre(70, 60, 900, vues=600))

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 90)

    assert [(seconde, chute.gel_ms) for seconde, chute in chutes] == [(0.0, 900.0), (70.0, 900.0)]


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

    # Trente secondes plus tard, dans la pause d'une minute du gel de salle, et un
    # autre trou que le premier: ce n'est pas le même gel qui se tait ici.
    declencheur.lire(_mesure(30, 60, visite="a", gel_ms=30))
    declencheur.lire(_mesure(30, 60, visite="b", gel_ms=1400))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=31)) == []


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
    assert chute.mediane is not None
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


def _figee(secondes: float, attente: float, arrivees: list[float] | None = None) -> dict[str, Any]:
    """Une fenêtre de page figée, telle que la page l'écrit depuis le 21 novembre 2026."""
    ligne = _mesure(secondes, 0)
    ligne["vu"] = {"jeuHz": 0, "vues": 0, "arrivées": arrivees or [0, 0, 0], "attente": attente}
    return ligne


def test_une_page_qui_attend_son_image_gele_sans_dire_de_cadence() -> None:
    """Le gel de Sonic: plus une image, et plus de cadence mesurée."""
    declencheur = _declencheur(_figee(0, 12_000))
    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=5))
    assert chute.cause == "gel"
    assert chute.gel_ms == 12_000
    assert chute.mediane is None


def test_une_page_sans_cadence_ni_attente_ne_compte_pas() -> None:
    """Le jumeau: zéro partout est une page qui ne mesure rien, pas un gel."""
    declencheur = _declencheur(_figee(0, 0), _figee(10, 0), _figee(20, 0))
    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == []


def test_une_page_figee_ne_fait_pas_tomber_la_mediane_des_autres() -> None:
    """La médiane ne lit que des cadences mesurées: zéro n'en est pas une."""
    # Trois pages à 55 et trois à 300 ms d'attente sans cadence: comptés comme
    # des zéros, ces trois-là feraient une médiane de 27,5 et une fausse chute.
    declencheur = _declencheur(
        *(_mesure(s, 55, visite="a") for s in (0, 10, 20)),
        *(_figee(s, 300, [16, 17, 20]) for s in (1, 11, 21)),
    )
    assert declencheur.evaluer(DEBUT + timedelta(seconds=25)) == []


# --- Le démarrage d'un jeu n'est pas un gel -----------------------------------
#
# Le 27 novembre 2026 à 00:33:15, la boîte noire a pris une capture « gel » de
# 33 386 ms: la page attendait la première image de Smash depuis 33 s. Ce trou
# est le chargement du jeu, pas un arrêt de la partie, et la pause qu'il a
# ouverte a fait taire le vrai gel de 543 ms de 00:36:14.


def _fenetre(
    secondes: float,
    cadence: float,
    pire: float,
    attente: float = 0,
    vues: int = 600,
    visite: str = "8f852a84",
    jeu: str = "Super Smash Bros. Ultimate",
) -> dict[str, Any]:
    """Une fenêtre de page au format du 21 novembre 2026: vues, arrivées, attente."""
    ligne = _mesure(secondes, cadence, visite=visite, jeu=jeu)
    ligne["vu"] = {
        "s": 10,
        "vues": vues,
        "jeuHz": cadence,
        "arrivées": [16 if vues else 0, 30 if vues else 0, pire],
        "attente": attente,
    }
    return ligne


def _changement(secondes: float, jeu: str, visite: str = "8f852a84") -> dict[str, Any]:
    """La ligne que le salon écrit quand une page lance un jeu."""
    return {
        "quand": (DEBUT + timedelta(seconds=secondes)).isoformat(timespec="milliseconds"),
        "quoi": "changement",
        "visite": visite,
        "banc": False,
        "jeu": jeu,
        "salle": {"jeu": jeu, "présents": 1, "places": {}},
    }


#: Le début de la partie du 27 novembre 2026, réduit à ce que la règle lit: une
#: fenêtre sans cadence pendant le chargement, puis celle de la première image,
#: qui porte le trou du chargement, puis la partie.
SMASH_DEMARRE = [
    _fenetre(0, 0, 0, vues=1),
    _fenetre(40, 60, 33386, attente=691, vues=329),
    _fenetre(50, 60, 1488, attente=5, vues=548),
]


def test_le_trou_avant_la_premiere_image_est_un_demarrage() -> None:
    declencheur = _declencheur(*SMASH_DEMARRE[:2])

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=41))
    assert (chute.cause, chute.gel_ms, chute.salle) == ("démarrage", 33386.0, 1)


def test_un_demarrage_n_ouvre_pas_de_pause() -> None:
    """Le trou de 1 488 ms qui suit de dix secondes est un vrai gel, et il est pris."""
    declencheur = _declencheur(*SMASH_DEMARRE[:2])
    declencheur.evaluer(DEBUT + timedelta(seconds=41))

    declencheur.lire(SMASH_DEMARRE[2])
    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=51))
    assert (chute.cause, chute.gel_ms) == ("gel", 1488.0)


def test_un_demarrage_n_est_ecrit_qu_une_fois() -> None:
    declencheur = _declencheur(*SMASH_DEMARRE[:2])

    assert [c.cause for c in declencheur.evaluer(DEBUT + timedelta(seconds=41))] == ["démarrage"]
    assert declencheur.evaluer(DEBUT + timedelta(seconds=43)) == []


def test_le_meme_trou_en_pleine_partie_reste_un_gel() -> None:
    """Le jumeau: c'est l'absence d'image d'avant qui fait le démarrage, pas la taille du
    trou. Après une fenêtre qui a une cadence, 33 s sans image sont un gel."""
    declencheur = _declencheur(_fenetre(0, 60, 18), _fenetre(40, 60, 33386, vues=329))

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=41))
    assert (chute.cause, chute.gel_ms) == ("gel", 33386.0)


def test_un_gel_de_600_ms_vingt_secondes_apres_la_premiere_image_est_pris() -> None:
    declencheur = _declencheur(*SMASH_DEMARRE[:2])
    declencheur.evaluer(DEBUT + timedelta(seconds=41))

    for secondes, pire in ((50, 20), (60, 600)):
        declencheur.lire(_fenetre(secondes, 60, pire))
    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=61))
    assert (chute.cause, chute.gel_ms) == ("gel", 600.0)


def test_une_seconde_page_a_aussi_son_demarrage() -> None:
    """La seconde page reçoit sa première image après la première, et sa fenêtre porte
    le même trou: c'est son chargement, pas un gel."""
    lignes = [*SMASH_DEMARRE[:2], *(_avec_visite(ligne, 3, "b") for ligne in SMASH_DEMARRE[:2])]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 50)

    assert [(seconde, chute.cause, chute.gel_ms) for seconde, chute in chutes] == [
        (40.0, "démarrage", 33386.0),
        (44.0, "démarrage", 33386.0),
    ]


def test_une_page_arrivee_en_pleine_partie_n_a_pas_de_demarrage() -> None:
    """Le jumeau: une page qui arrive deux minutes après la première image n'a pas de
    chargement à faire, et le trou de sa première fenêtre est un gel."""
    lignes = [
        *SMASH_DEMARRE[:2],
        *(_fenetre(10 * rang, 60, 20) for rang in range(5, 17)),
        _avec_visite(_fenetre(160, 60, 900), 0, "b"),
    ]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 170)

    assert [(seconde, chute.cause, chute.gel_ms) for seconde, chute in chutes] == [
        (40.0, "démarrage", 33386.0),
        (160.0, "gel", 900.0),
    ]


def test_un_chargement_qui_reste_dans_les_arrivees_reste_un_demarrage() -> None:
    """Un jeu à 30 images par seconde, comme Zelda sur Switch 2: six cents écarts
    couvrent vingt secondes, et le trou du chargement reste le pire de la fenêtre
    suivante. Pris pour un gel, il faisait une capture de 33 s et ouvrait la pause
    d'une minute, qui taisait le vrai gel de 700 ms de la quatrième fenêtre."""
    lignes = [
        _fenetre(0, 0, 0, vues=1, jeu=ZELDA),
        _fenetre(40, 30, 33386, attente=20, vues=150, jeu=ZELDA),
        _fenetre(50, 30, 33386, attente=20, vues=300, jeu=ZELDA),
        _fenetre(60, 30, 40, attente=20, vues=300, jeu=ZELDA),
        _fenetre(70, 30, 700, attente=20, vues=300, jeu=ZELDA),
    ]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(plafonds={ZELDA: 30.0}), lignes, 80)

    assert [(seconde, chute.cause, chute.gel_ms) for seconde, chute in chutes] == [
        (40.0, "démarrage", 33386.0),
        (70.0, "gel", 700.0),
    ]


def test_un_meme_pire_apres_six_cents_images_n_est_plus_le_chargement() -> None:
    """Le jumeau: la fenêtre suivante a reçu six cents images, qui ont remplacé tous
    les écarts de la page. Le même pire est alors un nouveau trou, et un gel: c'est
    le nombre d'images qui fait le lien, pas la valeur seule."""
    # L'attente de 691 ms de la fenêtre de 00:33:13 lie aussi les deux fenêtres: c'est
    # bien la règle des six cents écarts qui dit que le trou n'est plus le même.
    lignes = [
        _fenetre(0, 0, 0, vues=1),
        _fenetre(40, 60, 33386, attente=691, vues=150),
        _fenetre(50, 60, 33386, attente=20, vues=600),
    ]

    chutes = _rejouer_toutes_les_deux_secondes(Declencheur(), lignes, 60)

    assert [(seconde, chute.cause, chute.gel_ms) for seconde, chute in chutes] == [
        (40.0, "démarrage", 33386.0),
        (50.0, "gel", 33386.0),
    ]


def _avec_visite(ligne: dict[str, Any], secondes: float, visite: str) -> dict[str, Any]:
    """La même fenêtre, vue par une autre page, quelques secondes plus tard."""
    quand = datetime.fromisoformat(ligne["quand"]) + timedelta(seconds=secondes)
    return {**ligne, "visite": visite, "quand": quand.isoformat(timespec="milliseconds")}


def test_un_jeu_relance_par_le_salon_redemarre() -> None:
    """Le même jeu relancé: le salon écrit « changement », et le trou du chargement
    qui suit est de nouveau un démarrage."""
    declencheur = _declencheur(_fenetre(0, 60, 18), _changement(5, "Super Smash Bros. Ultimate"))
    for ligne in (_fenetre(10, 60, 20), _fenetre(20, 0, 0, vues=0), _fenetre(50, 60, 30000)):
        declencheur.lire(ligne)

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=51))
    assert (chute.cause, chute.gel_ms) == ("démarrage", 30000.0)


def test_sans_ligne_de_changement_le_meme_trou_est_un_gel() -> None:
    """Le jumeau: les mêmes fenêtres sans la ligne du salon. Une fenêtre sans image
    au milieu d'une partie qui en avait est un gel, pas un chargement."""
    declencheur = _declencheur(
        _fenetre(0, 60, 18),
        _fenetre(10, 60, 20),
        _fenetre(20, 0, 0, vues=0),
        _fenetre(50, 60, 30000),
    )

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=51))
    assert (chute.cause, chute.gel_ms) == ("gel", 30000.0)


def test_un_changement_de_jeu_vu_dans_les_mesures_redemarre_aussi() -> None:
    """La fenêtre qui annonce le nouveau jeu porte encore des images de l'ancien: elle ne
    met pas fin au démarrage, et le trou du chargement qui suit n'est pas un gel."""
    declencheur = _declencheur(
        _fenetre(0, 60, 18, jeu="Mario Party 4"),
        _fenetre(10, 60, 20),
        _fenetre(40, 60, 28000, vues=200),
    )

    (chute,) = declencheur.evaluer(DEBUT + timedelta(seconds=41))
    assert (chute.cause, chute.gel_ms) == ("démarrage", 28000.0)
