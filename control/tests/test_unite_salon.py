"""L'unité du salon, comparée au manifeste des consoles et à l'unité des salles.

`deploy/nel3ab-control.service` énumère ses dossiers de jeux à la main, et le
salon y range ce qu'on dépose. Rien ne la comparait à quoi que ce soit: seule
l'unité des salles l'était (`test_consoles.py`). Une console rendue jouable
sans son dossier ici aurait ses jeux balayés par les salles, et refusés par la
page de dépôt avec « le salon ne connaît pas de dossier ».

Le salon lit aussi ce que les salles écrivent: la configuration de chaque
adaptateur (pour trouver les sauvegardes) et les sauvegardes Dolphin. Son unité
ne les nomme pas, donc ses défauts s'appliquent: ils doivent désigner les mêmes
fichiers que l'unité des salles, à partir du même dossier personnel.
"""

import re
from pathlib import Path

from nel3ab_control.consoles import CONSOLES, MANIFESTE
from nel3ab_control.settings import Settings

DEPLOY = MANIFESTE.parents[1] / "deploy"
SALON = DEPLOY / "nel3ab-control.service"
SALLES = DEPLOY / "nel3ab-worker@.service"


def environnement(texte: str) -> dict[str, str]:
    """Les variables d'une unité, sous les trois écritures qu'elle emploie.

    `Environment=A=b`, `Environment="A=b c"` et `Environment='A=["b"]'`: systemd
    retire les guillemets doubles d'une valeur, et l'unité du salon met ses
    origines JSON entre guillemets simples pour garder les leurs.
    """
    trouvees: dict[str, str] = {}
    for ligne in texte.splitlines():
        prise = re.fullmatch(r"""Environment=(["']?)([A-Z0-9_]+)=(.*)\1""", ligne.strip())
        if prise:
            trouvees[prise.group(2)] = prise.group(3)
    return trouvees


def desaccords(salon: dict[str, str], salles: dict[str, str]) -> list[str]:
    """Tout ce qui sépare l'unité du salon du manifeste et de l'unité des salles."""
    trouves: list[str] = []
    jouables = [one.folder for one in CONSOLES.consoles if one.playable]
    dossiers = [Path(it).name for it in salon.get("NEL3AB_ROM_DIR", "").split(":") if it]
    if dossiers != jouables:
        trouves.append(f"dossiers du salon {dossiers}, consoles jouables {jouables}")
    if salon.get("NEL3AB_ROM_DIR") != salles.get("NEL3AB_ROM_DIR"):
        trouves.append("le salon et les salles ne balaient pas la même liste de dossiers")
    maison_salon = Path(salon.get("HOME", "/"))
    maison_salles = Path(salles.get("HOME", "/"))
    variables = [
        "NEL3AB_PERSONAL_SAVE_ROOT",
        *(one.config_env for one in CONSOLES.consoles if one.config_env),
    ]
    for variable in variables:
        if variable not in salles:
            trouves.append(f"{variable}: absente de l'unité des salles")
            continue
        champ = variable.removeprefix("NEL3AB_").lower()
        if champ not in Settings.model_fields:
            trouves.append(f"{variable}: le salon n'a aucun réglage pour la lire")
            continue
        if variable in salon:
            chez_le_salon = Path(salon[variable])
        else:
            # Le défaut du réglage, calculé ici sur le dossier personnel de qui
            # lance l'essai, et rapporté à celui que l'unité donne au salon.
            defaut = Settings.model_fields[champ].default
            chez_le_salon = maison_salon / defaut.relative_to(Path.home())
        relatif_salon = chez_le_salon.relative_to(maison_salon)
        relatif_salles = Path(salles[variable]).relative_to(maison_salles)
        if relatif_salon != relatif_salles:
            trouves.append(f"{variable}: salon ~/{relatif_salon}, salles ~/{relatif_salles}")
    return trouves


def test_l_unite_du_salon_range_dans_le_dossier_de_chaque_console_jouable() -> None:
    salon = environnement(SALON.read_text(encoding="utf-8"))
    salles = environnement(SALLES.read_text(encoding="utf-8"))
    # Le lecteur lit bien les trois écritures: sans elles, une liste vide
    # passerait pour une unité sans réglage.
    assert salon["NEL3AB_ORIGINS"] == '["https://nel3ab.app"]'
    assert "xbox360" in salon["NEL3AB_ROM_DIR"]
    assert salles["HOME"] == salon["HOME"]

    assert desaccords(salon, salles) == []


def test_une_console_retiree_de_l_unite_du_salon_est_nommee() -> None:
    """Le jumeau: un contrôle qui ne verrait rien passerait aussi l'essai du dessus."""
    salon = environnement(SALON.read_text(encoding="utf-8"))
    dossiers = salon["NEL3AB_ROM_DIR"].split(":")
    salon["NEL3AB_ROM_DIR"] = ":".join(it for it in dossiers if Path(it).name != "xbox360")
    assert salon["NEL3AB_ROM_DIR"].count(":") == len(dossiers) - 2, "rien n'a été retiré"
    salles = environnement(SALLES.read_text(encoding="utf-8"))

    vus = desaccords(salon, salles)

    # L'attendu vient du manifeste: une liste écrite en dur ferait échouer ce
    # jumeau pour une mauvaise raison le jour où une console devient jouable
    # (vérification finale du 22 novembre 2026).
    jouables = [one.folder for one in CONSOLES.consoles if one.playable]
    assert "xbox360" in jouables, "la console retirée n'est plus jouable: le jumeau ne prouve rien"
    restants = [dossier for dossier in jouables if dossier != "xbox360"]
    assert vus == [
        f"dossiers du salon {restants}, consoles jouables {jouables}",
        "le salon et les salles ne balaient pas la même liste de dossiers",
    ]


def test_une_configuration_d_adaptateur_lue_ailleurs_que_chez_les_salles_est_nommee() -> None:
    """Le second jumeau: le carnet chercherait les sauvegardes dans un autre fichier."""
    salon = environnement(SALON.read_text(encoding="utf-8"))
    salles = environnement(SALLES.read_text(encoding="utf-8"))
    salles["NEL3AB_XBOX360_CONFIG"] = str(Path(salles["HOME"]) / ".config/nel3ab/x360.json")

    assert desaccords(salon, salles) == [
        "NEL3AB_XBOX360_CONFIG: salon ~/.config/nel3ab/xbox360.json, "
        "salles ~/.config/nel3ab/x360.json"
    ]
