"""La série de conformité des moteurs: ce que chaque fiche et chaque console doivent tenir.

Un module d'ESSAI: il lit `consoles/consoles.json`, donc aucune salle ne le
charge (`test_regles.py`, liste ESSAIS). Il tourne sans Docker, sans carte et
sans réseau. Chaque contrôle rend la liste de ses écarts, chacun nommé; une liste
vide veut dire conforme. `test_conformite.py` l'applique au dépôt, puis à un
faux moteur cassé exprès pour chaque contrôle.

- C1: la fiche se lit, et son nom et son processus sont ceux d'un moteur du
  manifeste. Attrape le `eden-cli` oublié du 7 novembre 2026, un exécutable
  renommé.
- C2: chaque console externe jouable a sa fiche; hors migration, son module et
  une enveloppe qui appelle `principal("<code>")` au chemin `form.script`.
  Attrape une console sans moteur, une enveloppe qui lance une autre console.
- C8: le lanceur du conteneur nomme le même exécutable que la fiche (pour
  Xenia, la valeur par défaut de `NEL3AB_XENIA` dans xenia.sh). Attrape la
  troisième copie du nom qui dériverait seule.
- C12: `EN_MIGRATION` ne nomme que des moteurs encore servis par un ancien
  adaptateur. Attrape une entrée périmée, qui laisserait un moteur « non
  couvert » en silence.
"""

import ast
import json
import re
from collections.abc import Mapping
from pathlib import Path

from moteurs.socle import fiche

DEPOT = Path(__file__).resolve().parents[2]

#: Les moteurs dont la console est encore servie par son script d'origine,
#: avec le chemin de ce script. Une console sort d'ici dans le commit qui fait de
#: son script une enveloppe du socle.
EN_MIGRATION: dict[str, str] = {
    "ryubing": "docker/switch-room.py",
    "eden": "docker/switch2-room.py",
    "xenia": "docker/xbox360-room.py",
}


#: Les lanceurs de conteneur qui nomment eux-mêmes l'exécutable du moteur, et le
#: motif qui le lit. Ryubing et Eden le reçoivent de leur adaptateur.
LANCEURS: dict[str, tuple[str, re.Pattern[str]]] = {
    "xenia": ("spikes/xbox360/xenia.sh", re.compile(r"\$\{NEL3AB_XENIA:-/emulator/([^}]+)\}")),
}


def manifeste(depot: Path = DEPOT) -> dict:
    return json.loads((depot / "consoles/consoles.json").read_text(encoding="utf-8"))


def externes(brut: dict) -> list[dict]:
    """Les consoles jouables servies par un script externe."""
    return [c for c in brut["consoles"] if c["form"]["kind"] == "external" and c["playable"]]


def appels_de_principal(source: str) -> list[str]:
    """Les codes de console passés à `principal("...")` dans ce source."""
    codes = []
    for noeud in ast.walk(ast.parse(source)):
        if (
            isinstance(noeud, ast.Call)
            and isinstance(noeud.func, ast.Name)
            and noeud.func.id == "principal"
            and len(noeud.args) == 1
            and isinstance(noeud.args[0], ast.Constant)
        ):
            codes.append(noeud.args[0].value)
    return codes


def c1_fiches(depot: Path = DEPOT) -> list[str]:
    brut = manifeste(depot)
    moteurs = {m["name"]: m for m in brut["engines"]}
    ecarts = []
    for chemin in sorted((depot / "moteurs").glob("*/moteur.json")):
        try:
            lue = fiche.lire(chemin)
        except fiche.FicheInvalideError as erreur:
            ecarts.append(f"C1 {chemin.parent.name}: {erreur}")
            continue
        if lue.name not in moteurs:
            ecarts.append(f"C1 {lue.name}: aucun moteur de ce nom dans le manifeste")
        elif lue.process not in moteurs[lue.name]["processes"]:
            ecarts.append(
                f"C1 {lue.name}: le processus {lue.process} n'est pas dans le manifeste "
                f"{moteurs[lue.name]['processes']}"
            )
    return ecarts


def c2_consoles(depot: Path = DEPOT, en_migration: Mapping[str, str] = EN_MIGRATION) -> list[str]:
    ecarts = []
    for console in externes(manifeste(depot)):
        code, moteur, script = console["code"], console["engine"], console["form"]["script"]
        if not (depot / "moteurs" / moteur / "moteur.json").is_file():
            ecarts.append(f"C2 {code}: aucune fiche moteurs/{moteur}/moteur.json")
        if moteur in en_migration:
            continue
        if not (depot / "moteurs" / moteur / "adaptateur.py").is_file():
            ecarts.append(f"C2 {code}: aucun module moteurs/{moteur}/adaptateur.py")
        chemin = depot / script
        codes = appels_de_principal(chemin.read_text(encoding="utf-8")) if chemin.is_file() else []
        if codes != [code]:
            ecarts.append(
                f'C2 {code}: {script} doit appeler principal("{code}"), il appelle {codes}'
            )
    return ecarts


def c8_lanceurs(depot: Path = DEPOT) -> list[str]:
    ecarts = []
    for moteur, (script, motif) in sorted(LANCEURS.items()):
        lue = fiche.lire(depot / "moteurs" / moteur / "moteur.json")
        nommes = motif.findall((depot / script).read_text(encoding="utf-8"))
        if nommes != [str(lue.executable)]:
            ecarts.append(f"C8 {moteur}: {script} lance {nommes}, la fiche {lue.executable}")
    return ecarts


def c12_migration(depot: Path = DEPOT, en_migration: Mapping[str, str] = EN_MIGRATION) -> list[str]:
    scripts = {c["engine"]: c["form"]["script"] for c in externes(manifeste(depot))}
    ecarts = []
    for moteur, ancien in sorted(en_migration.items()):
        if scripts.get(moteur) != ancien:
            lance = scripts.get(moteur)
            ecarts.append(f"C12 {moteur}: en migration depuis {ancien}, le manifeste lance {lance}")
            continue
        chemin = depot / ancien
        if not chemin.is_file():
            ecarts.append(f"C12 {moteur}: {ancien} n'existe plus")
        elif appels_de_principal(chemin.read_text(encoding="utf-8")):
            ecarts.append(f"C12 {moteur}: {ancien} est déjà une enveloppe du socle, entrée périmée")
    return ecarts


def ecarts(depot: Path = DEPOT, en_migration: Mapping[str, str] = EN_MIGRATION) -> list[str]:
    """Tous les écarts de C1, C2, C8 et C12."""
    return [
        *c1_fiches(depot),
        *c2_consoles(depot, en_migration),
        *c8_lanceurs(depot),
        *c12_migration(depot, en_migration),
    ]
