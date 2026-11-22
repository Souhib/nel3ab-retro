"""Les consoles de la salle, lues dans `consoles/consoles.json` (ADR D22).

Ce module est le seul endroit du plan de contrôle qui connaît la liste. Ce qui en
dépend la DÉRIVE d'ici plutôt que de la recopier : les moteurs que la boîte noire
reconnaît à leur processus, les rôles dont elle capture l'écran, les consoles
qu'une préparation accepte, les appareils qu'elle propose, la préparation à un
seul joueur et le verrou « une seule Switch sur la machine ».

Il porte aussi la forme de l'identifiant de titre de chaque console
(`FORMES_TITRE`), que le manifeste ne décrit pas: le catalogue, les sauvegardes
et le rangement la lisent ici plutôt que de la recopier.

Avant le 21 novembre 2026, ces listes étaient écrites à la main à sept endroits.
L'oubli d'`eden-cli` dans l'une d'elles a fait voir Zelda au repos le 7 novembre,
et autorisé pendant la partie des lectures qui coupent l'image.

Le fichier est validé à la lecture. Un manifeste faux arrête le service qui le
lit, avec la raison, plutôt que de laisser une console à moitié décrite : c'est
la moitié manquante qui ne se voit pas.
"""

import json
from dataclasses import dataclass
from pathlib import Path

#: Le manifeste du dépôt. Les services tournent depuis l'arbre du dépôt, et uv
#: installe ce paquet en mode modifiable : le chemin relatif à ce fichier tient.
MANIFESTE = Path(__file__).resolve().parents[2] / "consoles" / "consoles.json"

#: Le seul format que ce code sait lire.
VERSION = 1

#: Quinze caractères : c'est ce que le noyau garde du nom d'un processus dans
#: `/proc/<pid>/comm`. `dolphin-emu-nogui` y devient `dolphin-emu-nog`, et un nom
#: plus long ne serait jamais reconnu par la boîte noire.
NOM_NOYAU_MAX = 15

ENTREES = ("dolphin", "pro")
FORMES = ("internal", "external")
JAQUETTES = ("banner", "wii-save", "sidecar")
SUPPORTS = ("disc", "cartridge", "card")
INSCRIPTIONS = ("dolphin-header", "sidecar", "none")

#: L'appareil que la trame Pro présente à chaque place, comme le worker
#: (`InputFrame::device`).
APPAREIL_PRO = 4


class ManifesteInvalideError(ValueError):
    """Le manifeste ne décrit pas des consoles que ce code sait servir."""


@dataclass(frozen=True)
class Moteur:
    """Un émulateur, tel que la boîte noire le reconnaît."""

    name: str
    #: Le nom que la boîte noire écrit dans ses relevés pour ce moteur.
    role: str
    #: Les noms de processus du noyau, quinze caractères au plus.
    processes: tuple[str, ...]


@dataclass(frozen=True)
class Console:
    """Une console, avec chacune des décisions que les couches prennent pour elle."""

    code: str
    label: str
    note: str
    players: int
    engine: str
    form: str
    script: str | None
    script_env: str | None
    config_env: str | None
    input: str
    devices: tuple[int, ...]
    lock: str | None
    art: str
    media: str
    folder: str
    registration: str
    extensions: tuple[str, ...]
    experimental: bool
    playable: bool


@dataclass(frozen=True)
class Manifeste:
    """Les moteurs et les consoles, dans l'ordre du fichier."""

    engines: tuple[Moteur, ...]
    consoles: tuple[Console, ...]

    def console(self, code: str) -> Console | None:
        """La console de ce code, ou rien pour « ? » et tout code inconnu."""
        return next((one for one in self.consoles if one.code == code), None)

    def engine(self, name: str) -> Moteur:
        """Le moteur de ce nom. Toujours trouvé : `lire` l'a vérifié."""
        return next(one for one in self.engines if one.name == name)

    def processes(self) -> dict[str, str]:
        """Le rôle de chaque nom de processus, pour la boîte noire."""
        return {process: one.role for one in self.engines for process in one.processes}

    def roles(self) -> frozenset[str]:
        """Tous les rôles qu'un relevé peut porter."""
        return frozenset(one.role for one in self.engines)

    def roles_with_a_screen(self) -> frozenset[str]:
        """Les rôles dont la boîte noire peut capturer l'écran.

        Ceux des consoles servies par un adaptateur : le jeu y tourne dans un
        compositeur Sway, que `grim` sait lire. Dolphin rend dans le worker et n'a
        pas d'écran à capturer.
        """
        return frozenset(
            self.engine(one.engine).role for one in self.consoles if one.form == "external"
        )

    def preparable(self) -> frozenset[str]:
        """Les consoles qu'une préparation accepte : celles qu'on peut lancer."""
        return frozenset(one.code for one in self.consoles if one.playable)

    def devices(self, code: str) -> tuple[int, ...]:
        """Les appareils qu'une préparation propose pour cette console.

        Vide pour un code inconnu : une console qu'on ne connaît pas ne reçoit
        plus les appareils de la Wii par défaut, ce que l'audit du 20 novembre
        2026 avait trouvé.
        """
        found = self.console(code)
        return found.devices if found else ()

    def solo(self, code: str) -> bool:
        """Vrai quand la salle ne valide qu'un joueur pour cette console."""
        found = self.console(code)
        return found is not None and found.players == 1

    def lock(self, code: str) -> str | None:
        """Le verrou de machine que cette console prend, ou rien."""
        found = self.console(code)
        return found.lock if found else None


def _texte(entree: dict, champ: str, ou: str) -> str:
    valeur = entree.get(champ)
    if not isinstance(valeur, str) or not valeur:
        raise ManifesteInvalideError(f"{ou}: « {champ} » doit être un texte non vide")
    return valeur


def _parmi(entree: dict, champ: str, permis: tuple[str, ...], ou: str) -> str:
    valeur = _texte(entree, champ, ou)
    if valeur not in permis:
        raise ManifesteInvalideError(f"{ou}: « {champ} » vaut {valeur!r}, hors de {permis}")
    return valeur


def _booleen(entree: dict, champ: str, ou: str) -> bool:
    valeur = entree.get(champ)
    if not isinstance(valeur, bool):
        raise ManifesteInvalideError(f"{ou}: « {champ} » doit être vrai ou faux")
    return valeur


def _textes(entree: dict, champ: str, ou: str) -> tuple[str, ...]:
    valeur = entree.get(champ)
    if not isinstance(valeur, list) or not all(isinstance(it, str) and it for it in valeur):
        raise ManifesteInvalideError(f"{ou}: « {champ} » doit être une liste de textes")
    return tuple(valeur)


def _moteur(entree: object, ou: str) -> Moteur:
    if not isinstance(entree, dict):
        raise ManifesteInvalideError(f"{ou}: un moteur est un objet")
    processus = _textes(entree, "processes", ou)
    trop_longs = [nom for nom in processus if len(nom) > NOM_NOYAU_MAX]
    if trop_longs:
        raise ManifesteInvalideError(
            f"{ou}: {trop_longs} dépassent les {NOM_NOYAU_MAX} caractères que le noyau garde"
        )
    return Moteur(
        name=_texte(entree, "name", ou),
        role=_texte(entree, "role", ou),
        processes=processus,
    )


def _console(entree: object, ou: str) -> Console:
    if not isinstance(entree, dict):
        raise ManifesteInvalideError(f"{ou}: une console est un objet")
    ou = f"{ou} ({entree.get('code')!r})"
    joueurs = entree.get("players")
    if type(joueurs) is not int or not 1 <= joueurs <= 4:
        raise ManifesteInvalideError(f"{ou}: « players » doit valoir de 1 à 4")
    appareils = entree.get("devices")
    if (
        not isinstance(appareils, list)
        or not appareils
        or any(type(it) is not int or not 0 <= it <= APPAREIL_PRO for it in appareils)
    ):
        raise ManifesteInvalideError(f"{ou}: « devices » doit lister des appareils de 0 à 4")
    forme = entree.get("form")
    if not isinstance(forme, dict):
        raise ManifesteInvalideError(f"{ou}: « form » est un objet")
    genre = _parmi(forme, "kind", FORMES, ou)
    externe = genre == "external"
    verrou = entree.get("lock")
    if verrou is not None and (not isinstance(verrou, str) or not verrou):
        raise ManifesteInvalideError(f"{ou}: « lock » est un nom de groupe ou null")
    extensions = _textes(entree, "extensions", ou)
    if any(it != it.lower() or "." in it for it in extensions):
        raise ManifesteInvalideError(f"{ou}: une extension s'écrit en minuscules, sans point")
    entree_ = _parmi(entree, "input", ENTREES, ou)
    if entree_ == "pro" and appareils != [APPAREIL_PRO]:
        raise ManifesteInvalideError(f"{ou}: la trame Pro présente l'appareil 4 et lui seul")
    code = _texte(entree, "code", ou)
    if code == "?":
        raise ManifesteInvalideError(
            f"{ou}: « ? » est la réponse d'un disque muet, pas une console"
        )
    return Console(
        code=code,
        label=_texte(entree, "label", ou),
        note=_texte(entree, "note", ou),
        players=joueurs,
        engine=_texte(entree, "engine", ou),
        form=genre,
        script=_texte(forme, "script", ou) if externe else None,
        script_env=_texte(forme, "script_env", ou) if externe else None,
        config_env=_texte(forme, "config_env", ou) if externe else None,
        input=entree_,
        devices=tuple(appareils),
        lock=verrou,
        art=_parmi(entree, "art", JAQUETTES, ou),
        media=_parmi(entree, "media", SUPPORTS, ou),
        folder=_texte(entree, "folder", ou),
        registration=_parmi(entree, "registration", INSCRIPTIONS, ou),
        extensions=extensions,
        experimental=_booleen(entree, "experimental", ou),
        playable=_booleen(entree, "playable", ou),
    )


def lire(chemin: Path = MANIFESTE) -> Manifeste:
    """Lit et vérifie le manifeste.

    Lève `ManifesteInvalideError` en nommant l'entrée et le champ fautifs.
    """
    try:
        brut = json.loads(chemin.read_text(encoding="utf-8"))
    except (OSError, ValueError) as erreur:
        raise ManifesteInvalideError(f"{chemin} ne se lit pas : {erreur}") from erreur
    if not isinstance(brut, dict) or brut.get("version") != VERSION:
        raise ManifesteInvalideError(f"{chemin}: seule la version {VERSION} est connue")
    moteurs_bruts = brut.get("engines")
    consoles_brutes = brut.get("consoles")
    if not isinstance(moteurs_bruts, list) or not isinstance(consoles_brutes, list):
        raise ManifesteInvalideError(f"{chemin}: « engines » et « consoles » sont des listes")
    moteurs = tuple(_moteur(entree, f"moteur {rang}") for rang, entree in enumerate(moteurs_bruts))
    consoles = tuple(
        _console(entree, f"console {rang}") for rang, entree in enumerate(consoles_brutes)
    )
    for nom, valeurs in (
        ("moteur", [one.name for one in moteurs]),
        ("rôle", [one.role for one in moteurs]),
        ("console", [one.code for one in consoles]),
        ("processus", [process for one in moteurs for process in one.processes]),
    ):
        doubles = sorted({it for it in valeurs if valeurs.count(it) > 1})
        if doubles:
            raise ManifesteInvalideError(f"{chemin}: {nom} en double : {doubles}")
    connus = {one.name: one for one in moteurs}
    for console in consoles:
        moteur = connus.get(console.engine)
        if moteur is None:
            raise ManifesteInvalideError(f"{console.code}: moteur inconnu {console.engine!r}")
        # La leçon du 7 novembre 2026, tenue par le fichier lui-même : une
        # console qu'on lance doit être visible de la boîte noire.
        if console.playable and not moteur.processes:
            raise ManifesteInvalideError(
                f"{console.code}: jouable, mais son moteur {moteur.name!r} n'a aucun "
                "processus : la boîte noire verrait ses parties au repos"
            )
    return Manifeste(engines=moteurs, consoles=consoles)


#: Les chiffres d'un identifiant de titre. Écrits un par un, en ASCII: `\d` et
#: `str.isdigit` acceptent aussi les chiffres pleine chasse, et `int(titre, 16)`
#: accepte `0x`, un signe, un tiret bas et des blancs (voir les vecteurs).
HEXADECIMAL = frozenset("0123456789abcdefABCDEF")


@dataclass(frozen=True)
class FormeTitre:
    """La forme d'un identifiant de titre: tant de chiffres hexadécimaux, et une fin imposée."""

    chiffres: int
    #: Ce par quoi le titre doit finir, ou rien.
    fin: str = ""

    def accepte(self, titre: str) -> bool:
        return (
            len(titre) == self.chiffres
            and all(caractere in HEXADECIMAL for caractere in titre)
            and titre.endswith(self.fin)
        )


#: La forme du titre de chaque console qui en porte un, écrite ICI et nulle part
#: ailleurs dans le salon. Le worker écrit la même règle une fois, dans
#: `Console::valid_title` (`core/crates/emulator/src/disc.rs`), et les deux essais
#: lisent les mêmes exemples, `consoles/titres-vecteurs.json`.
#:
#: Une Switch écrit 16 chiffres, dont les trois derniers à zéro pour un jeu de
#: base (une mise à jour finit par 800). Une Xbox 360 en écrit 8, lus dans
#: l'en-tête de son `default.xex`. Les consoles de Dolphin n'en ont pas: le disque
#: répond lui-même. Le préfixe `0400` d'un jeu Switch 2 n'est pas une forme de
#: titre: le worker le vérifie à la lecture d'une fiche (`emulator::switch`).
#:
#: Avant le 22 novembre 2026, la forme était recopiée dans le catalogue, les
#: sauvegardes et le rangement, en 16 chiffres partout: le titre d'un jeu Xbox 360
#: (`534507d6`) était jeté par le catalogue et ignoré par la recherche de doublons.
FORMES_TITRE: dict[str, FormeTitre] = {
    "switch": FormeTitre(16, "000"),
    "switch2": FormeTitre(16, "000"),
    "x360": FormeTitre(8),
}


def forme_titre(code: str) -> FormeTitre | None:
    """La forme du titre de cette console, ou rien pour une console sans titre."""
    return FORMES_TITRE.get(code)


def titre_valide(code: str, titre: object, *, minuscules: bool = False) -> bool:
    """Vrai pour un identifiant que cette console peut porter.

    `minuscules` exige en plus l'écriture du worker: c'est celle des dossiers de
    sauvegarde et du catalogue, qu'il écrit en minuscules. Ailleurs, la casse est
    acceptée comme le fait le Rust; la question est reportée.
    """
    forme = FORMES_TITRE.get(code)
    if forme is None or not isinstance(titre, str):
        return False
    return forme.accepte(titre) and (not minuscules or titre == titre.lower())


#: Le manifeste du dépôt, lu une fois à l'import.
CONSOLES = lire()
