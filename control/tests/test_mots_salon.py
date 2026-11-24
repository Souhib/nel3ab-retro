"""Les mots des pages du salon viennent de `front/src/lib/mots.ts` (ADR D41).

Les trois pages du salon écrivaient leurs mots en dur, hors de la charte de la
salle: le dépôt disait « l'administrateur du salon », et l'accueil « Pas de
réponse : réessaie » quand la salle dit « Pas de réponse. Réessaie ». Depuis le
24 novembre 2026, `retro.py` les pose depuis `retro/mots.json`, tiré de
`mots.ts`. Ces essais tiennent les trois bouts: une clé inconnue lève au
démarrage, un texte fixe ne reste pas écrit dans une page, et la table n'a pas
de mot mort.
"""

import re
from html.parser import HTMLParser
from pathlib import Path

import httpx
import pytest

from nel3ab_control.api.routes import retro

ROUTES = Path(retro.__file__).parent
#: Les sources des pages du salon, telles qu'elles sont écrites.
PAGES = ("accueil.html", "importer.html", "profil.html", "retro/bandeau.html")
#: Les sources qui écrivent des clés de mots: les pages, le module du dépôt, et
#: le module Python qui remplit la phrase des consoles rangées.
SOURCES = (*PAGES, "importer.mjs", "importer.py")
SQUELETTE = "<!--RETRO:EN-TETE--><!--RETRO:MOTS--><style>/*__EFFETS__*/</style>{}"


def garnir(corps: str) -> str:
    return retro.garnir(SQUELETTE.format(corps))


# ── La pose ──────────────────────────────────────────────────────────────


def test_une_marque_devient_son_texte_echappe_dans_le_corps_et_les_attributs() -> None:
    page = garnir('<nav aria-label="<!--MOT:entete.pages-->"><a><!--MOT:carnet.aucune--></a></nav>')
    assert '<nav aria-label="Les pages">' in page
    # L'apostrophe est échappée: le texte peut finir dans un attribut.
    assert "<a>Aucune partie notée pour l&#x27;instant.</a>" in page
    assert "<!--MOT:" not in page


def test_une_marque_inconnue_leve_au_demarrage() -> None:
    with pytest.raises(ValueError, match=r"mot inconnu du salon: carnet\.inconnu"):
        garnir("<p><!--MOT:carnet.inconnu--></p>")
    # Le jumeau: la même marque, sur une clé qui existe, passe.
    assert "<p>Ton carnet</p>" in garnir("<p><!--MOT:entete.carnet--></p>")


def test_un_texte_a_trous_ne_se_pose_pas_par_une_marque() -> None:
    """Une marque ne sait pas remplir `{n}`: le trou s'afficherait tel quel."""
    with pytest.raises(ValueError, match="à trous"):
        garnir("<p><!--MOT:accueil.eteinte--></p>")
    assert "{n}" in retro.MOTS["accueil.eteinte"], "précondition: le mot a un trou"


def test_une_cle_inconnue_dans_un_script_leve_au_demarrage() -> None:
    with pytest.raises(ValueError, match=r"accueil\.inexistant"):
        garnir('<script>mots("accueil.inexistant");</script>')
    # Une clé lue par une condition est vue aussi.
    with pytest.raises(ValueError, match=r"carnet\.plusieurs"):
        garnir("<script>mots(n > 1 ? 'carnet.plusieurs' : 'carnet.unePartie');</script>")
    # Le jumeau: une clé connue passe, et une chaîne d'un autre groupe n'est pas une clé.
    assert "nel3abMots" in garnir('<script>mots("accueil.compris"); f("rt.ligne");</script>')


def test_le_module_du_depot_est_verifie_aussi() -> None:
    """Posé après `garnir`, le module du dépôt n'est pas lu par lui."""
    with pytest.raises(ValueError, match=r"depot\.absent"):
        retro.verifier_cles('dire(mots("depot.absent"));')
    retro.verifier_cles((ROUTES / "importer.mjs").read_text(encoding="utf-8"))


def test_mot_remplit_ses_trous_et_refuse_un_trou_sans_valeur() -> None:
    assert retro.mot("accueil.eteinte", n="2") == "Salle 2, éteinte."
    with pytest.raises(ValueError, match=r"trou sans valeur: accueil.eteinte \{n\}"):
        retro.mot("accueil.eteinte")
    with pytest.raises(ValueError, match="mot inconnu"):
        retro.mot("accueil.absent")


def test_la_table_ne_peut_pas_fermer_sa_balise(monkeypatch: pytest.MonkeyPatch) -> None:
    """Un mot qui contiendrait `</script>` fermerait la balise de la table."""
    monkeypatch.setitem(retro.MOTS, "carnet.piege", "</script><b>")
    sortie = retro.table_des_mots()
    assert sortie.count("</script") == 1, "seule la balise de la table se ferme"
    assert sortie.endswith("</script>")
    assert '"carnet.piege": "\\u003c/script>\\u003cb>"' in sortie


# ── Les pages servies ────────────────────────────────────────────────────


class Textes(HTMLParser):
    """Le texte visible d'une page: hors script, style et commentaire, et les
    attributs qu'un lecteur d'écran ou une feuille montre."""

    ATTRIBUTS = frozenset({"aria-label", "title", "placeholder", "alt", "data-vide"})

    def __init__(self) -> None:
        super().__init__()
        self.dedans = 0
        self.textes: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.dedans += 1
        self.textes += [v for k, v in attrs if k in self.ATTRIBUTS and v]

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self.dedans -= 1

    def handle_data(self, data: str) -> None:
        if not self.dedans and data.strip():
            self.textes.append(" ".join(data.split()))


def textes(html: str) -> list[str]:
    lecteur = Textes()
    lecteur.feed(html)
    return lecteur.textes


@pytest.mark.parametrize("chemin", ["/", "/importer", "/profil"])
async def test_une_page_servie_n_a_ni_marque_ni_trou(
    client: httpx.AsyncClient, chemin: str
) -> None:
    page = (await client.get(chemin, headers={})).text
    assert "<!--MOT:" not in page
    vus = textes(page)
    assert "Les salles" in vus, "précondition: l'en-tête commun est lu"
    assert [t for t in vus if re.search(r"\{\w+\}", t)] == []


def boutons_en_minuscule(html: str) -> list[str]:
    """Les boutons d'une page dont le texte commence par une minuscule."""
    return [
        texte
        for texte in (
            " ".join(t.split()) for t in re.findall(r"<button[^>]*>([^<]+)</button>", html)
        )
        if texte[:1].islower()
    ]


def test_un_bouton_du_salon_commence_par_une_majuscule() -> None:
    """Charte, règle 5. Le dépôt avait « pause » et « annuler » (24 novembre 2026)."""
    assert boutons_en_minuscule('<button type="button">pause</button><button>Garder</button>') == [
        "pause"
    ]


@pytest.mark.parametrize("chemin", ["/", "/importer", "/profil"])
async def test_les_boutons_d_une_page_servie_commencent_par_une_majuscule(
    client: httpx.AsyncClient, chemin: str
) -> None:
    page = (await client.get(chemin, headers={})).text
    assert "<button" in page, "précondition: la page a des boutons"
    assert boutons_en_minuscule(page) == []


# ── Les sources: aucun texte fixe écrit en dur ───────────────────────────

#: Une marque de l'assemblage (`/*__RANGEES__*/`), remplacée par Python.
MARQUE_PYTHON = re.compile(r"/\*__[A-Z]+__\*/")


def ecrits_en_dur(html: str) -> list[str]:
    """Les textes visibles d'une source qui ne passent pas par une marque.

    Une marque est un commentaire HTML: le lecteur ne la voit pas comme du
    texte. Il reste ce qui est écrit à la main avec au moins une lettre.
    """
    return [
        t
        for t in textes(html)
        if re.search(r"[^\W\d_]", MARQUE_PYTHON.sub("", t)) and "<!--MOT:" not in t
    ]


def test_le_lecteur_trouve_un_texte_ecrit_en_dur() -> None:
    assert ecrits_en_dur('<nav aria-label="Le salon"><p>Bonjour</p></nav>') == [
        "Le salon",
        "Bonjour",
    ]
    # Le jumeau: une marque, un chiffre d'horloge et une marque Python passent.
    propre = (
        '<nav aria-label="<!--MOT:entete.pages-->"><p><!--MOT:x.y--></p>'
        "<b>--:--</b>/*__RANGEES__*/</nav>"
    )
    assert ecrits_en_dur(propre) == []


@pytest.mark.parametrize("source", PAGES)
def test_aucune_page_n_ecrit_un_texte_fixe_en_dur(source: str) -> None:
    html = (ROUTES / source).read_text(encoding="utf-8")
    assert "<!--MOT:" in html, "précondition: la page porte des marques"
    assert ecrits_en_dur(html) == []


# ── Les scripts: aucune phrase écrite en dur ─────────────────────────────

#: Une chaîne d'un script: entre guillemets doubles, simples ou obliques.
CHAINE = re.compile(r'"((?:[^"\\\n]|\\.)*)"|\'((?:[^\'\\\n]|\\.)*)\'|`((?:[^`\\]|\\.)*)`')
#: Un mot de deux lettres au moins, puis un autre: une phrase, ou une liste
#: de classes, que la suite trie.
PHRASE = re.compile(r"[^\W\d_]{2,}['\u2019\s]+[^\W\d_]{2,}|[À-ÿ]")
#: Les preuves de l'estimation du dépôt: des positions et des octets lus dans
#: le fichier, des mesures et non des phrases (`SALON_DEPOT` le dit).
PREUVES = re.compile(r"\nexport function estimer\(b\) \{.*?\n\}\n", re.S)


def code_de(source: str) -> str:
    """Le code d'une source, sans commentaires: un script en ligne d'une page,
    ou le module entier."""
    texte = (ROUTES / source).read_text(encoding="utf-8")
    if source.endswith(".html"):
        texte = "\n".join(re.findall(r"<script[^>]*>(.*?)</script>", texte, re.S))
    texte = PREUVES.sub("\n", texte)
    texte = re.sub(r"/\*.*?\*/", "", texte, flags=re.S)
    return re.sub(r"(?m)^\s*//.*$|\s//\s.*$", "", texte)


def classes_de(source: str) -> set[str]:
    """Les classes et les valeurs d'attribut qu'une page déclare ou lit."""
    texte = (ROUTES / source).read_text(encoding="utf-8")
    feuilles = texte + (ROUTES / "retro/salon.css").read_text(encoding="utf-8")
    feuilles += (ROUTES / "retro/effets.css").read_text(encoding="utf-8")
    return set(re.findall(r"\.([a-z][\w-]*)", feuilles))


def phrases_en_dur(code: str, classes: set[str]) -> list[str]:
    trouvees = []
    for trouve in CHAINE.finditer(code):
        chaine = next(g for g in trouve.groups() if g is not None)
        texte = re.sub(r"\$\{[^}]*\}", " ", chaine)
        # Un sélecteur (`".cartouche img"`) n'est pas un texte.
        if not PHRASE.search(texte) or texte.startswith((".", "#", "[")):
            continue
        # Une liste de classes de la page (`"vide rt-mire rt-bombe"`).
        if all(jeton in classes for jeton in texte.split()):
            continue
        trouvees.append(chaine)
    return trouvees


#: Ce qui reste écrit dans un script, et pourquoi ce n'est pas un mot à dire.
PERMIS = {
    # Le refus du module, quand la page n'a pas posé ses mots: une erreur de
    # développement que personne ne lit dans une page servie.
    "la page de dépôt n'a pas reçu ses mots",
    # Les erreurs d'un morceau d'envoi (`envoyerMorceau`): `envoyer` les
    # rattrape toutes, réessaie, puis dit « La connexion a coupé » par sa clé.
    "réseau",
    "arrêté",
}


def test_le_lecteur_trouve_une_phrase_ecrite_en_dur() -> None:
    code = 'ecrire(a, "en pause"); b.textContent = `Salle ${n}, éteinte.`; el("p", "vide rt-mire");'
    assert phrases_en_dur(code, {"vide", "rt-mire"}) == ["en pause", "Salle ${n}, éteinte."]
    # Le jumeau: une clé de mot, une classe et un sélecteur passent.
    propre = 'mots("accueil.sOuvre"); el("p", "vide rt-mire"); q(".pile-boites > :last-child");'
    assert phrases_en_dur(propre, {"vide", "rt-mire"}) == []


@pytest.mark.parametrize("source", [*PAGES, "importer.mjs"])
def test_aucun_script_n_ecrit_une_phrase_en_dur(source: str) -> None:
    trouvees = phrases_en_dur(
        code_de(source), classes_de(source if source.endswith(".html") else "importer.html")
    )
    assert [t for t in trouvees if t not in PERMIS] == []


def test_les_preuves_de_l_estimation_sont_mises_de_cote_et_seulement_elles() -> None:
    """La règle des preuves retire une fonction, pas le module."""
    module = (ROUTES / "importer.mjs").read_text(encoding="utf-8")
    assert len(PREUVES.findall(module)) == 1
    preuves = PREUVES.search(module)
    assert preuves is not None
    assert "« HEAD » à 0x100" in preuves.group(0)
    assert "phraseEnvoi" in PREUVES.sub("", module)


# ── La table: aucun mot mort ─────────────────────────────────────────────


def morts(table: dict[str, str], sources: str) -> list[str]:
    """Les clés que rien n'écrit: ni une marque, ni une chaîne d'un script."""
    return sorted(
        cle
        for cle in table
        if f"<!--MOT:{cle}-->" not in sources
        and f'"{cle}"' not in sources
        and f"'{cle}'" not in sources
    )


def test_chaque_mot_de_la_table_est_dit_quelque_part() -> None:
    sources = "".join((ROUTES / s).read_text(encoding="utf-8") for s in SOURCES)
    assert len(retro.MOTS) > 100, "précondition: la table est lue"
    assert morts(retro.MOTS, sources) == []
    # Le jumeau: un mot ajouté à la table et dit nulle part est trouvé.
    assert morts({**retro.MOTS, "carnet.oublie": "Oublié"}, sources) == ["carnet.oublie"]
