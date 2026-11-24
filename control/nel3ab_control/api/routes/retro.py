"""Le thème rétro dans les pages du salon (ADR D37).

Les pages du salon (accueil, dépôt, carnet) sont du HTML écrit à la main, sans
la page React de la salle. Elles reçoivent au démarrage ce que la salle porte:
la feuille des effets, le script qui pose le réglage de l'appareil avant la
première image, l'icône d'onglet et le logo. Les trois fichiers de `retro/`
sont écrits depuis les modules de la salle et comparés par
`front/src/lib/salon-retro.test.ts`: une seule source pour les deux.

Une page marque l'endroit de chaque pièce:

- ``/*__EFFETS__*/`` dans son ``<style>``, après ``/*__REGIE__*/``;
- ``/*__SALON__*/`` dans son ``<style>``, après les effets: les règles que les
  trois pages partagent (l'en-tête commun, l'étiquette tapée);
- ``<!--RETRO:EN-TETE-->`` dans son ``<head>``, avant le ``<style>``: le
  script doit tourner avant que le corps se peigne;
- ``<!--RETRO:BANDEAU /chemin-->`` dans son ``<header class="entete">``:
  l'en-tête commun du salon (`bandeau.html`: le logo, les trois pages, qui tu
  es, et le script qui le remplit), la page du chemin marquée courante.
  Recopié dans chaque page jusqu'au 24 novembre 2026, il avait dérivé: le
  dépôt n'avait plus « Tu es », et son lien « Ton carnet » restait caché;
- ``<!--RETRO:LOGO-->`` là où le nom du service s'affiche (l'en-tête commun
  le porte);
- ``<!--RETRO:REGLAGE-->`` là où la page propose le réglage des effets (le pied
  de l'accueil): trois niveaux et les sons de menu, la même clé que la salle;
- ``<!--RETRO:AIN-->`` en fin de corps: le paquet du salon (ADR D41), construit
  par `just ain-salon` depuis `front/src/salon/paquet.ts`. Il peint Aïn dans
  l'élément ``data-hote="logo"`` de la page et donne `nel3abAin.scene()`, puis
  les gestes d'arcade du socle sous `nel3abSalon`. Un script classique: la page
  n'a pas de module, et le paquet est une fonction appelée tout de suite;
- ``<!--RETRO:MOTS-->`` dans son ``<head>``, après l'en-tête: les mots des
  pages du salon (`mots.json`, tirés de `front/src/lib/mots.ts`) et la
  fonction `nel3abMots(cle, trous)` qui les dit (`mots.js`);
- ``<!--MOT:groupe.cle-->`` à la place d'un texte fixe de la page, dans le
  corps comme dans un attribut. Le texte est échappé, et un texte à trous
  (``{n}``) y est refusé: il se dit par le script.

Les mots du salon vivent dans `mots.ts` depuis le 24 novembre 2026: la charte
de la salle les juge (`mots.test.ts`), et le lexique s'y écrit une fois. Une
clé inconnue, qu'elle soit dans une marque ou dans une chaîne d'un script
(``"accueil.ouvrirUne"``), lève une erreur au démarrage du salon.

Le remplacement se fait une fois, au chargement de la page. Une marque restée
dans une page servie lève une erreur au démarrage du salon plutôt que
d'afficher un commentaire à la place du logo.
"""

import html
import json
import re
from pathlib import Path

DOSSIER = Path(__file__).parent / "retro"

#: Les pages du salon: chacune est la page courante d'un lien de l'en-tête.
PAGES = ("/", "/profil", "/importer")

#: La marque de l'en-tête commun, avec la page qui le porte.
BANDEAU = re.compile(r"<!--RETRO:BANDEAU (\S*)-->")

#: Les marques, et le fichier qui les remplace.
MARQUES = {
    "/*__EFFETS__*/": "effets.css",
    "/*__SALON__*/": "salon.css",
    "<!--RETRO:EN-TETE-->": "en-tete.html",
    "<!--RETRO:LOGO-->": "logo.svg",
    "<!--RETRO:REGLAGE-->": "reglage.html",
    "<!--RETRO:AIN-->": "ain.js",
}

#: Les marques qu'une page doit porter, faute de quoi elle s'afficherait sans
#: le réglage de l'appareil ou sans ses mots.
REQUISES = ("/*__EFFETS__*/", "<!--RETRO:EN-TETE-->", "<!--RETRO:MOTS-->")


def piece(nom: str) -> str:
    """Le contenu d'une pièce de `retro/`, sans la fin de ligne finale."""
    return (DOSSIER / nom).read_text(encoding="utf-8").rstrip("\n")


def script(code: str) -> str:
    """Un paquet JavaScript dans une balise ``<script>`` de la page.

    Le paquet est posé tel quel dans le HTML: une chaîne ``</script`` dedans
    fermerait la balise au milieu du code, et la suite s'afficherait comme du
    texte. Le minifieur ne l'échappe pas pour nous; une telle chaîne lève donc
    une erreur au démarrage du salon plutôt qu'une page cassée.
    """
    if "</script" in code.lower():
        raise ValueError("un paquet du salon contient </script: il fermerait sa balise")
    return f"<script>\n{code}\n</script>"


def remplacement(nom: str) -> str:
    """Ce qui remplace la marque d'une pièce: le fichier, ou son script."""
    return script(piece(nom)) if nom.endswith(".js") else piece(nom)


def bandeau(ici: str) -> str:
    """L'en-tête commun, la page `ici` marquée courante et toujours visible.

    Le lien de la page courante porte `aria-current` et perd son `hidden`: le
    script de l'en-tête ne cache jamais ce lien-là, même à qui n'a pas le droit
    d'y être (la page le lui dit elle-même).
    """
    if ici not in PAGES:
        raise ValueError(f"en-tête commun pour une page inconnue du salon: {ici}")
    lien = re.compile(rf'(<li[^>]*?)(?: hidden)?><a href="{re.escape(ici)}">')
    texte, marques = lien.subn(rf'\1><a href="{ici}" aria-current="page">', piece("bandeau.html"))
    if marques != 1:
        raise ValueError(f"l'en-tête commun a {marques} liens vers {ici}")
    return texte


#: Les mots des pages du salon, une clé ``groupe.cle`` par texte.
MOTS: dict[str, str] = json.loads(piece("mots.json"))

#: Une marque de texte fixe, ``<!--MOT:groupe.cle-->``.
MOT = re.compile(r"<!--MOT:([^>]*?)-->")

#: Un trou dans un texte: ``{n}``.
TROU = re.compile(r"\{(\w+)\}")

#: Une clé de mot écrite dans le script d'une page, entre guillemets. Les
#: groupes sont ceux de la table: une chaîne ``"accueil.html"`` serait lue
#: comme un mot inconnu, et c'est voulu, puisqu'aucune page n'en écrit.
GROUPES = "|".join(sorted({cle.split(".")[0] for cle in MOTS}))
CLE = re.compile(rf"""["']((?:{GROUPES})\.\w+)["']""")


def mot(cle: str, **trous: str) -> str:
    """Le texte d'un mot du salon, ses trous remplis, sans échappement."""
    if cle not in MOTS:
        raise ValueError(f"mot inconnu du salon: {cle}")

    def remplir(trouve: re.Match[str]) -> str:
        if trouve.group(1) not in trous:
            raise ValueError(f"trou sans valeur: {cle} {{{trouve.group(1)}}}")
        return trous[trouve.group(1)]

    return TROU.sub(remplir, MOTS[cle])


def texte_fixe(cle: str) -> str:
    """Ce qui remplace ``<!--MOT:cle-->``: le texte échappé, sans trou."""
    if cle in MOTS and TROU.search(MOTS[cle]):
        raise ValueError(f"mot du salon à trous dans une marque: {cle}")
    return html.escape(mot(cle))


def verifier_cles(code: str) -> None:
    """Chaque clé de mot écrite dans un script existe dans la table."""
    inconnues = sorted({cle for cle in CLE.findall(code) if cle not in MOTS})
    if inconnues:
        raise ValueError(f"mots inconnus du salon: {inconnues}")


def table_des_mots() -> str:
    """Le script qui donne `nel3abMots` à la page, la table dedans.

    Sans ``<``: un mot qui contiendrait ``</script>`` fermerait l'élément. JSON
    lit la suite ``\\u003c`` comme le même caractère.
    """
    table = json.dumps(MOTS, ensure_ascii=False).replace("<", "\\u003c")
    return script(piece("mots.js").replace("/*__MOTS__*/", table))


def garnir(page: str) -> str:
    """Remplace les marques du thème rétro dans une page.

    L'en-tête, la feuille et les mots sont attendus dans chaque page; le logo
    et le réglage, là où la page les demande. Une page sans en-tête ni feuille
    s'afficherait sans le réglage de l'appareil, et sans mots elle ne dirait
    rien: c'est une erreur.

    Les clés de mots sont vérifiées sur la page et son en-tête, avant les
    pièces: le paquet d'Aïn est un code minifié qui n'en écrit aucune.
    """
    for marque in REQUISES:
        if marque not in page:
            raise ValueError(f"page du salon sans la marque {marque}")
    page = BANDEAU.sub(lambda trouve: bandeau(trouve.group(1)), page)
    verifier_cles(page)
    page = MOT.sub(lambda trouve: texte_fixe(trouve.group(1)), page)
    page = page.replace("<!--RETRO:MOTS-->", table_des_mots())
    for marque, fichier in MARQUES.items():
        if marque in page:
            page = page.replace(marque, remplacement(fichier))
    restes = [
        marque
        for marque in (*MARQUES, *REQUISES, "<!--RETRO:BANDEAU", "<!--MOT:")
        if marque in page
    ]
    if restes:
        raise ValueError(f"marques du thème rétro restées dans la page: {restes}")
    return page
