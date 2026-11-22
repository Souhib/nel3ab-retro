"""Une préparation appartient aux attributions présentes, pas à quatre noms."""

import pytest

from nel3ab_control.api.controllers.preparation import ATTENTE_SANS, Participant, Preparation


def waiting() -> Preparation:
    return Preparation(
        game=2,
        save=0,
        starter="one",
        allowed=[1, 0],
        players=[
            Participant(port=1, claim="one", name="Souhib"),
            Participant(port=2, claim="two", name="Yassine"),
        ],
    )


def test_each_player_can_choose_a_different_device() -> None:
    p = waiting()
    p.choose("one", 0, True)
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one")
    p.choose("two", 1, True)
    assert p.launch("one") == [0, 1, 1, 1]
    with pytest.raises(ValueError, match="qui prépare"):
        p.launch("two")


def test_a_spectator_cannot_confirm_somebody_else() -> None:
    p = waiting()
    with pytest.raises(ValueError, match="Prends une place"):
        p.choose("spectator", 0, True)
    assert not any(player.ready for player in p.players)


def test_an_incompatible_device_is_refused() -> None:
    p = waiting()
    with pytest.raises(ValueError, match="pas proposée"):
        p.choose("one", 2, True)
    assert p.players[0].pad is None
    p.choose("one", 1, True)
    assert p.players[0].ready


def test_returning_to_the_same_port_requires_a_new_confirmation() -> None:
    p = waiting()
    p.choose("one", 0, True)
    p.choose("two", 1, True)
    assert p.synchronise([(1, "one", "Souhib"), (2, "three", "Vincent")])
    assert p.players[0].ready
    assert not p.players[1].ready
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one")
    assert not p.synchronise([(2, "three", "Vincent")])


def test_a_departed_player_no_longer_blocks_everybody() -> None:
    p = waiting()
    p.choose("one", 0, True)
    assert p.synchronise([(1, "one", "Souhib")])
    assert p.launch("one") == [0, 1, 1, 1]
    p.choose("one", 1, False)
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one")


def test_switch_players_confirm_pro_controls_and_new_arrivals_must_test_again() -> None:
    pending = waiting()
    pending.allowed = [4]
    with pytest.raises(ValueError, match="pas proposée"):
        pending.choose("one", 0, True)
    pending.choose("one", 4, True)
    with pytest.raises(ValueError, match="Chaque joueur"):
        pending.launch("one")
    pending.choose("two", 4, True)
    assert pending.launch("one") == [4, 4, 4, 4]
    assert pending.synchronise([(1, "one", "Alice"), (2, "new", "Benoît")])
    assert not pending.players[1].ready
    with pytest.raises(ValueError, match="Chaque joueur"):
        pending.launch("one")


# ── Lancer en un geste, et sans attendre un absent (audit P6, 22 novembre 2026) ──


def test_le_chef_lance_avec_son_choix_en_un_seul_geste() -> None:
    """« Je suis prêt » puis « Lancer le jeu » confirmaient la même décision.

    Le chef envoie son appareil AVEC le lancement: un geste au lieu de deux.
    """
    p = waiting()
    p.choose("two", 1, True)
    assert p.launch("one", pad=0) == [0, 1, 1, 1]
    assert p.players[0].ready
    assert p.players[0].pad == 0


def test_le_choix_du_chef_n_efface_pas_l_attente_des_autres() -> None:
    """Le jumeau: son choix ne fait pas d'un autre joueur un joueur prêt."""
    p = waiting()
    with pytest.raises(ValueError, match="Chaque joueur"):
        p.launch("one", pad=0)
    assert not p.players[1].ready


def test_un_appareil_refuse_ne_lance_rien() -> None:
    p = waiting()
    p.choose("two", 1, True)
    with pytest.raises(ValueError, match="pas proposée"):
        p.launch("one", pad=2)
    assert not p.players[0].ready


def test_le_chef_lance_sans_attendre_un_absent_apres_le_delai() -> None:
    """Un joueur assis qui ne répond pas bloquait tout le monde.

    Après `ATTENTE_SANS`, le chef lance sans lui. L'absent garde sa place, avec
    l'appareil qu'il avait choisi ou, à défaut, le premier proposé.
    """
    p = waiting()
    debut = p.ouverte_a
    p.choose("one", 0, True)
    assert p.launch("one", sans_attendre=True, maintenant=debut + ATTENTE_SANS) == [0, 1, 1, 1]


def test_sans_attendre_avant_le_delai_est_refuse() -> None:
    """Le jumeau: le délai est une règle du salon, pas une politesse de la page."""
    p = waiting()
    p.choose("one", 0, True)
    with pytest.raises(ValueError, match="Attends encore"):
        p.launch("one", sans_attendre=True, maintenant=p.ouverte_a + ATTENTE_SANS - 1)


def test_sans_attendre_garde_le_choix_non_confirme_de_l_absent() -> None:
    p = waiting()
    p.choose("one", 1, True)
    p.choose("two", 0, False)
    assert p.launch("one", sans_attendre=True, maintenant=p.ouverte_a + ATTENTE_SANS) == [
        1,
        0,
        1,
        1,
    ]


def test_seul_le_chef_lance_sans_attendre_et_pas_sans_lui_meme() -> None:
    p = waiting()
    p.choose("two", 1, True)
    with pytest.raises(ValueError, match="qui prépare"):
        p.launch("two", sans_attendre=True, maintenant=p.ouverte_a + ATTENTE_SANS)
    # Le chef ne peut pas se lancer lui-même sans choix.
    with pytest.raises(ValueError, match="Choisis"):
        p.launch("one", sans_attendre=True, maintenant=p.ouverte_a + ATTENTE_SANS)


def test_un_joueur_seul_avec_un_seul_appareil_peut_partir_tout_de_suite() -> None:
    """La règle du lancement direct: seul à jouer, et un seul appareil."""
    p = waiting()
    p.allowed = [0]
    assert not p.directe()
    assert p.synchronise([(1, "one", "Souhib")])
    assert p.directe()
    # Le jumeau: deux appareils demandent un choix, même seul.
    p.allowed = [1, 0]
    assert not p.directe()
