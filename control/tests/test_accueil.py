"""La page d'accueil: elle est servie, et elle ne demande rien à personne."""

import json
import re
import shutil
from pathlib import Path

import anyio
import httpx
import pytest
from fastapi import FastAPI

from nel3ab_control.api.routes import accueil as regie_module
from nel3ab_control.api.routes import retro


async def test_la_page_d_accueil_est_servie(client: httpx.AsyncClient) -> None:
    reponse = await client.get("/")

    assert reponse.status_code == 200
    assert reponse.headers["content-type"].startswith("text/html")
    assert "salle" in reponse.text


async def test_l_accueil_ne_demande_aucune_identite(client: httpx.AsyncClient) -> None:
    """Sans proxy devant, la liste doit rester visible.

    C'est la première page que voit quelqu'un qui arrive, et une page qui se
    cache à qui n'est pas encore reconnu ne montre rien du tout.
    """
    reponse = await client.get("/", headers={})

    assert reponse.status_code == 200


def test_l_accueil_n_est_pas_dans_le_contrat(app: FastAPI) -> None:
    """Le jumeau: une page n'est pas une ressource.

    L'inscrire au schéma ajouterait au client TypeScript de la salle une
    fonction qui rend du HTML et que personne n'appellera jamais.
    """
    assert "/" not in app.openapi()["paths"]


# ── La rangée de bornes, lue dans la vraie page ───────────────────────────

RACINE = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")
JSDOM = RACINE / "front/node_modules/jsdom/package.json"
#: Node et jsdom sont là sur la machine et sur le lanceur de CI, qui installe les
#: dépendances de la page avant `just check`. Sauté, et dit, ailleurs.
AVEC_JSDOM = pytest.mark.skipif(
    NODE is None or not JSDOM.exists(), reason="node ou front/node_modules/jsdom absent"
)
RUNNER = Path(__file__).with_name("accueil_module.mjs")


def siege(port: int, nom: str | None, tenu: bool | None = None) -> dict:
    """Une manette telle que `/api/salles` la rend."""
    return {"port": port, "nom": nom, "tenu": bool(nom) if tenu is None else tenu}


def salle(numero: int, **champs: object) -> dict:
    """Une salle de `/api/salles`: fermée par défaut, les champs donnés par-dessus."""
    base: dict = {
        "numero": numero,
        "ouverte": False,
        "redemarre": False,
        "chemin": f"/r/{numero}/",
        "jeu": None,
        "cle": None,
        "console": None,
        "switch": False,
        "gens": [],
        "chef": None,
        "sieges": [],
        "regardent": [],
        "ouverte_depuis": None,
        "repond": None,
        "fermee_pour": None,
        "places": None,
    }
    return {**base, **champs}


def ouverte(numero: int, noms: list[str | None] | None, **champs: object) -> dict:
    """Une salle ouverte qui répond; `noms` le pseudo de chaque place, ou rien
    quand personne n'est relié au salon dans cette salle (`sieges` absent)."""
    sieges = None if noms is None else [siege(i + 1, nom) for i, nom in enumerate(noms)]
    libres = None if noms is None else sum(nom is None for nom in noms)
    return salle(
        numero,
        ouverte=True,
        repond=True,
        sieges=sieges,
        places=libres,
        gens=[nom for nom in (noms or []) if nom],
        ouverte_depuis=3960,
        **champs,
    )


async def _jouer(client: httpx.AsyncClient, tours: list, **entree: object) -> dict:
    """La vraie page servie, exécutée dans jsdom tour après tour."""
    page = (await client.get("/")).text
    assert NODE is not None
    with anyio.fail_after(60):
        sortie = await anyio.run_process(
            [NODE, str(RUNNER)],
            input=json.dumps({"page": page, "tours": tours, **entree}).encode(),
            check=False,
        )
    assert sortie.returncode == 0, sortie.stderr.decode()
    return json.loads(sortie.stdout)


def _trois(un: dict, deux: dict | None = None, trois: dict | None = None) -> list[dict]:
    return [un, deux or salle(2), trois or salle(3)]


@AVEC_JSDOM
async def test_la_liste_ne_reecrit_rien_tant_que_rien_ne_change(client: httpx.AsyncClient) -> None:
    """A11Y-08, audit d'accessibilité du 21 novembre 2026.

    La liste était une région `aria-live` réécrite toutes les cinq secondes, même
    identique: 18 remplacements de texte comptés en 11 s, autant d'occasions pour
    un lecteur d'écran de la relire. Le jumeau: un vrai changement change la
    liste, et une seule ligne l'annonce en phrase.
    """
    un = ouverte(1, ["Nour", None, None, None], jeu="Mario Kart Wii")
    tours = [
        _trois(un),
        # Le salon compte les secondes: 1 h 06 reste 1 h 06.
        _trois({**un, "ouverte_depuis": 3965}),
        _trois({**un, "ouverte_depuis": 3970}),
        _trois(un, ouverte(2, [None] * 4)),
        _trois({**un, "jeu": "Wii Sports"}, ouverte(2, [None] * 4)),
        _trois({**un, "jeu": "Wii Sports"}),
    ]
    dit = await _jouer(client, tours)
    _, pareil, encore, ouvre, autre_jeu, fermee = dit["rendus"]

    assert pareil["mutations"] == [], pareil["mutations"]
    assert encore["mutations"] == []
    assert pareil["annonce"] == encore["annonce"] == ""
    assert ouvre["mutations"], "la salle 2 ouverte doit changer la rangée"
    assert ouvre["annonce"] == "la salle 2 vient de s'ouvrir"
    assert autre_jeu["annonce"] == "la salle 1 passe à Wii Sports"
    assert fermee["annonce"] == "la salle 2 s'est fermée"
    # La rangée n'est pas une région vivante: la ligne d'annonce l'est.
    assert dit["vivante"] is None
    assert dit["role"] == "status"


@AVEC_JSDOM
async def test_une_borne_montre_ses_places_et_la_page_un_seul_plein(
    client: httpx.AsyncClient,
) -> None:
    """Audit P13 et proposition du 22 novembre 2026: les START sont les places.

    Une place prise porte l'étiquette de son joueur; une place libre est un
    lien qui la prend, `?entrer=jouer&place=K`; la place conseillée est le seul
    bouton plein de la page, et la jauge de « 3 PRESENTS » a disparu.
    """
    pleine = ouverte(
        1, ["nour", "bilel", "jo", "ines"], jeu="Mario Kart Wii", chef="nour", regardent=["mémé"]
    )
    deux = ouverte(2, ["sami", "lou", None, None], jeu="Wii Sports")
    tour = _trois(pleine, deux)
    vue = (await _jouer(client, [tour, tour]))["rendus"][-1]["vue"]

    un, deux_ = vue["bornes"]
    assert [s["etiquette"] for s in un["starts"]] == ["nour", "bilel", "jo", "ines"]
    assert [s["lien"] for s in un["starts"]] == [None] * 4
    assert un["placesMot"] == "Les 4 places sont prises."
    assert un["etiquettes"] == ["nour", "mémé"]
    assert un["gens"] == "nour choisit le jeu. mémé regarde."
    assert un["regarder"] == {"lien": "/r/1/?entrer=regarder", "cache": False}

    liens = [s["lien"] for s in deux_["starts"]]
    assert liens == [None, None, "/r/2/?entrer=jouer&place=3", "/r/2/?entrer=jouer&place=4"]
    assert [s["plein"] for s in deux_["starts"]] == [False, False, True, False]
    assert deux_["starts"][2]["mot"] == "Prendre la place 3"
    assert deux_["starts"][3]["mot"] == "Prendre"
    assert deux_["placesMot"] == "Deux places libres."
    assert vue["pleins"] == ["/r/2/?entrer=jouer&place=3"]
    assert vue["accroche"] == "Joue en salle 2 : deux places t'attendent."
    assert vue["credit"] == "Salles ouvertes 2 · Places libres 2"
    assert vue["jauge"] is False
    assert "PRESENT" not in vue["texte"]
    # La salle 3 est éteinte: elle seule propose de s'ouvrir.
    assert vue["eteints"] == [
        {
            "salle": "3",
            "titre": "Salle 3, éteinte.",
            "ouvrir": "Ouvrir la salle 3",
        }
    ]


@AVEC_JSDOM
async def test_sans_places_connues_aucun_bouton_prendre(client: httpx.AsyncClient) -> None:
    """Le jumeau: une salle dont le salon ne suit pas les places n'en invente pas.

    `sieges` absent (personne n'est relié au salon dans cette salle) et les
    places libres inconnues: aucun « Prendre », la borne le dit, et aucun bouton
    plein; « Regarder » reste. Quatre places libres au compte du worker se
    disent quand même.
    """
    muette = ouverte(1, None, jeu="Zelda")
    toutes = {**ouverte(2, None), "places": 4}
    tour = _trois(muette, toutes)
    vue = (await _jouer(client, [tour, tour]))["rendus"][-1]["vue"]

    un, deux = vue["bornes"]
    assert un["placesMot"] == "Ses places s'affichent dès qu'elle répond."
    assert [s["lien"] for s in un["starts"]] == [None] * 4
    assert un["regarder"]["cache"] is False
    assert [s["lien"] for s in deux["starts"]] == [
        f"/r/2/?entrer=jouer&place={k}" for k in (1, 2, 3, 4)
    ]
    assert vue["pleins"] == ["/r/2/?entrer=jouer&place=1"]
    # Le crédit tait les places libres tant qu'une salle ne les dit pas.
    assert vue["credit"] == "Salles ouvertes 2"


@AVEC_JSDOM
async def test_une_salle_qui_redemarre_ou_se_tait_garde_sa_borne_sans_bouton(
    client: httpx.AsyncClient,
) -> None:
    """Audit P10: une salle qui redémarre n'est ni ouverte ni fermée.

    Elle reste dans la rangée, en pointillés, avec son dernier jeu et sans
    aucun bouton; seule une salle FERMÉE propose « Ouvrir la salle 3 ».
    """
    revient = salle(
        3,
        redemarre=True,
        dernier_jeu={"cle": "mk.iso", "titre": "Mario Kart Wii", "quand": "2026-11-24T20:00:00Z"},
    )
    muette = salle(2, ouverte=True, repond=False, sieges=None)
    tour = [ouverte(1, ["nour", None, None, None]), muette, revient]
    vue = (await _jouer(client, [tour, tour]))["rendus"][-1]["vue"]

    _, deux, trois = vue["bornes"]
    assert trois["etat"] == "redemarre"
    assert trois["titre"] == "Salle 3, elle redémarre…"
    assert trois["jeu"] == "Mario Kart Wii"
    assert trois["boutons"] == 0
    assert deux["etat"] == "muette"
    assert deux["titre"] == "Salle 2, elle ne répond pas."
    assert deux["boutons"] == 0
    assert vue["eteints"] == []
    assert "Ouvrir la salle" not in vue["texte"]

    # Le jumeau: la même salle 3 fermée propose de s'ouvrir.
    tour = [ouverte(1, ["nour", None, None, None]), salle(2), salle(3)]
    vue = (await _jouer(client, [tour, tour]))["rendus"][-1]["vue"]
    assert [e["ouvrir"] for e in vue["eteints"]] == ["Ouvrir la salle 2", "Ouvrir la salle 3"]


@AVEC_JSDOM
async def test_sans_salle_ouverte_la_mire_et_ouvrir_seul_plein(client: httpx.AsyncClient) -> None:
    """Décision du propriétaire: la mire « Hors antenne » en plein cadre.

    Dessous, le panneau porte « Ouvrir une salle » (seul plein), « Appuie sur
    Start » et le crédit. La phrase « tu choisiras le jeu » n'est dite qu'une
    fois.
    """
    vide = [salle(1), salle(2), salle(3)]
    vue = (await _jouer(client, [vide, vide]))["rendus"][-1]["vue"]

    assert vue["vide"] is True
    assert vue["bornes"] == [] and vue["eteints"] == []
    assert vue["accroche"] == "Aucune salle ouverte ce soir."
    assert vue["texte"].lower().count("tu choisiras le jeu") == 1
    assert vue["pleins"] == ["#ouvrir"]
    assert vue["startCache"] is False
    assert vue["credit"] == "Salles ouvertes 0"

    # Le jumeau: une salle ouverte, pas de mire, ni Ouvrir ni Start au panneau.
    tour = [ouverte(1, [None] * 4), salle(2), salle(3)]
    vue = (await _jouer(client, [tour, tour]))["rendus"][-1]["vue"]
    assert vue["vide"] is False
    assert vue["ouvrirCache"] is True
    assert vue["startCache"] is True
    assert vue["pleins"] == ["/r/1/?entrer=jouer&place=1"]


@AVEC_JSDOM
async def test_deux_releves_manques_figent_la_liste_et_aine_decroche(
    client: httpx.AsyncClient,
) -> None:
    """Constat T18: une liste qui ne se met plus à jour a l'air d'une liste fraîche.

    Après deux relevés manqués, l'accroche dit l'heure de la liste, « Recharger
    la page » est le seul bouton plein, les START restent sans plein, et Aïn
    décroche; le relevé suivant réussi le rebranche.
    """
    tour = _trois(ouverte(1, ["nour", None, None, None]))
    dit = await _jouer(client, [tour, {"statut": 502}, {"statut": 502}, tour])
    _, un_rate, fige, revenu = dit["rendus"]

    assert un_rate["vue"]["pleins"] == ["/r/1/?entrer=jouer&place=2"]
    assert not un_rate["vue"]["accroche"].startswith("La liste date de")
    assert fige["vue"]["accroche"].startswith("La liste date de ")
    assert fige["vue"]["pleins"] == ["#recharger"]
    assert all(not s["plein"] for b in fige["vue"]["bornes"] for s in b["starts"])
    assert fige["vue"]["horlogePerdue"] == "oui"
    assert dit["scenes"].count("decroche") == 1
    assert revenu["vue"]["pleins"] == ["/r/1/?entrer=jouer&place=2"]
    assert dit["scenes"][-1] == "rebrancher"


@AVEC_JSDOM
async def test_a_zero_salle_ain_attire_l_attention_jusqu_a_ce_qu_une_salle_s_ouvre(
    client: httpx.AsyncClient,
) -> None:
    """La boucle d'attention (« attente » trois fois, puis « dort ») est armée
    une fois à zéro salle, même relue, et coupée quand une salle s'ouvre. Sa
    cadence est essayée sous horloge simulée dans `salon/attention.test.ts`."""
    dit = await _jouer(
        client, [_trois(salle(1)), _trois(salle(1)), _trois(ouverte(1, ["Nour", None, None, None]))]
    )
    assert dit["attention"] == ["arme", "coupe"]
    assert dit["scenes"].count("attente") == 1


@AVEC_JSDOM
async def test_une_salle_ouverte_n_arme_pas_la_boucle_d_attention(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau : une salle tourne dès le chargement, rien n'attire l'œil vers
    « Ouvrir une salle »."""
    dit = await _jouer(
        client,
        [
            _trois(ouverte(1, ["Nour", None, None, None])),
            _trois(ouverte(1, ["Nour", None, None, None])),
        ],
    )
    assert dit["attention"] == []
    assert "attente" not in dit["scenes"]


@AVEC_JSDOM
async def test_une_liste_figee_coupe_la_boucle_d_attention(client: httpx.AsyncClient) -> None:
    """Deux relevés manqués : la liste ne dit plus la vérité, Aïn ne
    montre plus « Ouvrir une salle »."""
    dit = await _jouer(client, [_trois(salle(1)), {"statut": 502}, {"statut": 502}])
    assert dit["attention"] == ["arme", "coupe"]


@AVEC_JSDOM
async def test_ouvrir_une_salle_la_montre_ici_sans_partir(client: httpx.AsyncClient) -> None:
    """Après « Ouvrir une salle », la page ne part plus vers l'avant-salle.

    La salle ouverte arrive dans la rangée, l'accroche la nomme, et sa place 1
    devient le seul bouton plein dès qu'elle répond. Aïn joue « ouvre » au
    clic, puis « pret » à la réponse.
    """
    vide = [salle(1), salle(2), salle(3)]
    arrivee = [salle(1), salle(2), ouverte(3, [None] * 4)]
    dit = await _jouer(
        client,
        [vide, arrivee],
        cliquer={"apres": 0, "cible": "#ouvrir"},
        post={"statut": 201, "corps": {**salle(3), "ouverte": True}},
    )
    vue = dit["rendus"][-1]["vue"]

    assert dit["envois"] == [None]
    assert dit["scenes"][:2] == ["ouvre", "pret"]
    assert vue["adresse"] == "/"
    assert vue["accroche"] == "La salle 3 est ouverte : prends la place 1."
    assert vue["pleins"] == ["/r/3/?entrer=jouer&place=1"]

    # Le jumeau: tant que la salle 3 ne dit pas ses places, rien n'est plein
    # dans sa borne, et le panneau le dit.
    tot = [salle(1), salle(2), ouverte(3, None)]
    dit = await _jouer(
        client,
        [vide, tot],
        cliquer={"apres": 0, "cible": "#ouvrir"},
        post={"statut": 201, "corps": {**salle(3), "ouverte": True}},
    )
    vue = dit["rendus"][-1]["vue"]
    assert vue["accroche"] == "La salle 3 est ouverte."
    assert vue["mot"] == "Elle n'a pas encore répondu."
    assert vue["pleins"] == []


@AVEC_JSDOM
async def test_ouvrir_la_salle_n_demande_cette_salle_et_un_refus_se_dit(
    client: httpx.AsyncClient,
) -> None:
    """D17: « Ouvrir la salle 3 » envoie son numéro; un refus est dit, et Aïn refuse."""
    tour = _trois(ouverte(1, ["nour", None, None, None]))
    dit = await _jouer(
        client,
        [tour, tour],
        cliquer={"apres": 0, "cible": '[data-ouvrir="3"]'},
        post={"statut": 409, "corps": {"detail": "la salle 3 n'est pas fermée"}},
    )

    assert dit["envois"] == [{"numero": 3}]
    assert dit["rendus"][1]["vue"]["mot"] == "la salle 3 n'est pas fermée"
    assert "refus" in dit["scenes"]


@AVEC_JSDOM
async def test_entree_ouvre_une_salle_seulement_quand_rien_ne_tourne(
    client: httpx.AsyncClient,
) -> None:
    """APPUIE SUR START (effet « start », niveau conseillé): Entrée hors d'un champ.

    `surStart` vient du paquet du salon. Le jumeau: une salle tourne déjà, et
    Entrée n'en allume pas une seconde sur la carte graphique commune.
    """
    vide = [salle(1), salle(2), salle(3)]
    arrivee = [ouverte(1, [None] * 4), salle(2), salle(3)]
    dit = await _jouer(client, [vide, arrivee], cliquer={"apres": 0, "cible": "touche:Enter"})
    assert dit["envois"] == [None]

    une = [ouverte(1, [None] * 4), salle(2), salle(3)]
    dit = await _jouer(client, [une, une], cliquer={"apres": 0, "cible": "touche:Enter"})
    assert dit["envois"] == []


@AVEC_JSDOM
async def test_une_place_qui_se_remplit_sous_les_yeux_s_allume_une_fois(
    client: httpx.AsyncClient,
) -> None:
    """Effet « arrive »: l'étiquette se pose sur son START, une seule fois."""
    avant = _trois(ouverte(1, ["nour", "bilel", "jo", None]))
    apres = _trois(ouverte(1, ["nour", "bilel", "jo", "ines"]))
    dit = await _jouer(client, [avant, apres, apres])
    _, arrive, reste = dit["rendus"]

    assert [s["arrive"] for s in arrive["vue"]["bornes"][0]["starts"]] == [False] * 3 + [True]
    assert reste["mutations"] == []

    # Le jumeau: Inès déjà assise au premier dessin, rien ne s'allume.
    dit = await _jouer(client, [apres, apres])
    assert not any(s["arrive"] for s in dit["rendus"][-1]["vue"]["bornes"][0]["starts"])


@AVEC_JSDOM
async def test_le_retour_d_une_salle_dit_laquelle_et_pourquoi(client: httpx.AsyncClient) -> None:
    """K39: Caddy renvoie `/?salle=fermee&n=N`; la page dit ce qui est arrivé à N.

    Une fois, quand la liste le confirme, puis l'adresse est nettoyée.
    """
    fermee = [salle(1), salle(2), salle(3, fermee_pour="inactivite")]
    dit = await _jouer(client, [fermee, fermee], adresse="/?salle=fermee&n=3")
    vue = dit["rendus"][-1]["vue"]
    assert vue["retour"]["cache"] is False
    assert vue["retour"]["texte"] == (
        "La salle 3 s'est fermée faute d'activité. "
        "Tu peux la rouvrir : les sauvegardes sont intactes."
    )
    assert vue["adresse"] == "/"
    assert dit["scenes"].count("arret") == 1

    # Le jumeau: la même salle redémarre, la page ne la dit pas fermée.
    revient = [salle(1), salle(2), salle(3, redemarre=True)]
    dit = await _jouer(client, [revient, revient], adresse="/?salle=fermee&n=3")
    vue = dit["rendus"][-1]["vue"]
    assert vue["retour"]["texte"] == "La salle 3 redémarre : elle revient dans quelques secondes."
    assert "arret" not in dit["scenes"]
    assert "redemarre" in dit["scenes"]
    # Sans retour dans l'adresse, aucune bannière.
    dit = await _jouer(client, [fermee, fermee])
    assert dit["rendus"][-1]["vue"]["retour"]["cache"] is True


async def test_les_trois_pages_du_salon_portent_la_regie_de_la_salle(
    client: httpx.AsyncClient,
) -> None:
    """Une seule identité: les jetons de `front/src/regie.css`, dans chaque page.

    Le salon reçoit une copie de la feuille de la salle (`routes/regie.css`,
    comparée octet pour octet par `front/src/lib/regie.test.ts`). Ici on vérifie
    qu'elle arrive VRAIMENT dans ce qui est servi: une copie juste qu'aucune page
    n'inclut ne change rien à l'écran.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text
        assert "/*__REGIE__*/" not in page, chemin
        assert regie in page, f"{chemin} ne porte pas la régie"
        # Les deux thèmes, et le système qui choisit entre eux.
        assert "@media (prefers-color-scheme: light)" in page, chemin
        assert ':root[data-theme="jour"]' in page, chemin


def _jetons_de_la_regie(regie: str) -> set[str]:
    """Chaque nom que `regie.css` déclare: primitives, rôles et composants."""
    return set(re.findall(r"(?<![\w-])(--[a-z0-9-]+)\s*:", regie))


def _redeclares(page: str, jetons: set[str]) -> list[str]:
    """Les jetons de la régie qu'une page déclare à nouveau, en CSS ou en style en ligne."""
    return sorted(
        nom for nom in re.findall(r"(?<![\w-])(--[a-z0-9-]+)[\"']?\s*:", page) if nom in jetons
    )


def test_la_liste_des_jetons_vient_de_la_feuille() -> None:
    """La précondition: une liste vide ou réduite rendrait le garde muet.

    La première version cherchait cinq rôles écrits à la main, et un
    `--encre` ou un `--signal` redéclaré passait (relecture du 22 novembre
    2026). La liste est maintenant lue dans la feuille.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    jetons = _jetons_de_la_regie(regie)

    for attendu in (
        "--fond",
        "--encre",
        "--signal",
        "--p3-encre",
        "--bouton-plein-fond",
        "--ecran",
    ):
        assert attendu in jetons, attendu
    # `--color-fond` n'est pas `--fond`: le nom se lit entier.
    assert "--color-fond" not in jetons
    assert _redeclares("a{--color-fond: red}", jetons) == []
    assert _redeclares(".tampon{--encre: var(--alerte)}", jetons) == ["--encre"]
    assert _redeclares('style="--signal: #f0f"', jetons) == ["--signal"]


async def test_le_salon_ne_redeclare_pas_ses_propres_couleurs_de_page(
    client: httpx.AsyncClient,
) -> None:
    """Le jumeau: une page qui reposerait `--fond` après la régie l'écraserait.

    Le graphite était recopié à la main dans les trois pages; c'est par là
    qu'une page aurait dérivé seule, et la régie de jour n'aurait jamais pris.
    Un rôle redéfini localement contourne aussi `regie.test.ts`, qui calcule
    les contrastes sur les valeurs de la feuille et non sur celles de la page:
    le dépôt avait dû renommer son `--encre` local en `--tampon` pour cette
    raison. Aucun jeton de la feuille, quelle que soit sa couche.
    """
    regie = (Path(regie_module.__file__).with_name("regie.css")).read_text(encoding="utf-8")
    jetons = _jetons_de_la_regie(regie)
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text
        assert regie in page, chemin
        assert _redeclares(page.replace(regie, ""), jetons) == [], chemin


async def test_les_trois_pages_du_salon_portent_le_theme_retro(
    client: httpx.AsyncClient,
) -> None:
    """La feuille des effets, le script d'en-tête, l'icône et le logo (ADR D37).

    Les pièces de `routes/retro/` sont écrites depuis les modules de la salle et
    comparées par `front/src/lib/salon-retro.test.ts`. Ici on vérifie qu'elles
    arrivent dans ce qui est servi, et que le script passe AVANT la feuille: il
    pose les classes des effets avant que le corps se peigne.
    """
    pieces = {nom: retro.piece(nom) for nom in ("effets.css", "en-tete.html", "logo.svg")}
    for nom, contenu in pieces.items():
        assert len(contenu) > 500, nom
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text
        for marque in retro.MARQUES:
            assert marque not in page, (chemin, marque)
        for nom, contenu in pieces.items():
            assert contenu in page, (chemin, nom)
        tete = page.index("</head>")
        assert page.index(pieces["en-tete.html"]) < page.index("<style>") < tete, chemin
        assert 'localStorage.getItem("nel3ab:effets")' in page[:tete], chemin
        assert "font-family:'Pixelify Sans'" in page, chemin
        # Le logo remplace le mot: plus de « nel3ab » écrit dans la marque.
        assert re.search(r'class="marque"[^>]*>\s*<svg[^>]*class="rt-logo"', page), chemin


async def test_le_reglage_des_effets_est_au_pied_de_l_accueil(
    client: httpx.AsyncClient,
) -> None:
    """Le réglage de l'appareil, au salon comme dans le menu d'une salle."""
    reglage = retro.piece("reglage.html")
    accueil = (await client.get("/", headers={})).text
    assert reglage in accueil
    assert accueil.index(reglage) > accueil.index('id="ouvrir"')
    # Le jumeau: les autres pages ne le portent pas.
    assert reglage not in (await client.get("/importer", headers={})).text


async def test_les_trois_pages_du_salon_portent_ain_dans_leur_logo(
    client: httpx.AsyncClient,
) -> None:
    """Le paquet du salon (ADR D41) et sa maison, dans chaque page servie.

    Le paquet peint Aïn dans l'élément `data-hote="logo"` et donne au salon
    `nel3abAin` et `nel3abSalon`. Le logo statique reste dans la maison, pour
    une page sans script. Le paquet est posé APRÈS le corps: il cherche sa
    maison au chargement.
    """
    paquet = retro.piece("ain.js")
    assert "nel3abAin" in paquet
    assert "nel3abSalon" in paquet
    for chemin in ("/", "/importer", "/profil"):
        page = (await client.get(chemin, headers={})).text
        assert "<!--RETRO:AIN-->" not in page, chemin
        assert f"<script>\n{paquet}\n</script>" in page, chemin
        maison = re.search(r'<(?:span|a) class="marque" data-hote="logo"[^>]*>\s*<svg', page)
        assert maison, f"{chemin}: pas de maison pour Aïn, ou sans le logo statique"
        assert page.index(paquet) > maison.start(), chemin
        assert page.count('data-hote="logo"') == 1, chemin


def test_un_paquet_qui_fermerait_sa_balise_est_refuse() -> None:
    """Le paquet est posé tel quel: `</script` dedans couperait la page en deux."""
    with pytest.raises(ValueError, match="</script"):
        retro.script('var a = "</SCRIPT>";')
    # Le jumeau: un paquet ordinaire passe, dans sa balise.
    assert retro.script("var a = 1;") == "<script>\nvar a = 1;\n</script>"


def test_une_page_sans_en_tete_ni_feuille_du_theme_est_refusee() -> None:
    """Une marque oubliée se voit au démarrage du salon, pas dans une page servie."""
    with pytest.raises(ValueError, match="EN-TETE"):
        retro.garnir("<style>/*__EFFETS__*/</style>")
    with pytest.raises(ValueError, match="EFFETS"):
        retro.garnir("<!--RETRO:EN-TETE--><style></style>")
    # Le jumeau: une page qui porte les deux marques passe, et les perd.
    garnie = retro.garnir("<!--RETRO:EN-TETE--><style>/*__EFFETS__*/</style>")
    assert "RETRO" not in garnie
    assert "__EFFETS__" not in garnie
