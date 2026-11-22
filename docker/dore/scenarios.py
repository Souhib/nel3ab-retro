"""Les scénarios du banc doré, console par console.

Chaque scénario dit ce que la salle trouve en arrivant: la configuration, le
moteur, la ROM, les emplacements déjà joués, et ce que Docker répondra. Le doré
enregistre ce que le script en fait AUJOURD'HUI, y compris ses tolérances:

- la Switch lance tout le cycle avec une ROM `.iso` ou un moteur absent. Le
  worker ne lui envoie jamais ces cas (switch.rs filtre l'extension), mais
  l'adaptateur ne les refuse pas lui-même;
- la Switch fait sa première copie de sauvegarde et écrit le profil de manette
  AVANT de refuser `refresh_hz: 0`;
- la Xbox 360 écrit ses quatre profils AVANT de refuser `refresh_hz: 0`;
- sans `image`, la Switch copie et prépare l'emplacement, puis échoue en
  `KeyError` avant le profil de manette et avant tout conteneur.

Les refuser autrement est une décision, prise dans un commit qui ne change que
ces scénarios et le dit (moteurs-critique, problème « C4 »).
"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from banc import Scenario

#: Une clé d'essai pour les profils Xbox 360. La vraie est hors du dépôt.
CLE = bytes(range(16))
IMAGE = "sha256:" + "5a1e" + "0" * 58 + "d0"
#: L'image d'un moteur choisi par titre (Switch 2): une autre empreinte.
IMAGE_ZELDA = "sha256:df06b8ce" + "0" * 56
SWITCH = "0100abcdef012000"
SWITCH2 = "0400123456789000"
ZELDA = "0400486024dec000"
SONIC = "534507d6"
#: Une valeur à retirer de la configuration de base.
ABSENT = object()


def ecrire(chemin: Path, contenu: bytes) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_bytes(contenu)


def configuration(base: dict, changes: dict) -> dict:
    return {cle: valeur for cle, valeur in {**base, **changes}.items() if valeur is not ABSENT}


# --- Switch (Ryubing) --------------------------------------------------------------


def switch(racine: Path, **changes) -> dict:
    gabarit = racine / "gabarit"
    banque = gabarit / "bis/user/save/0000000000000001"
    for numero in ("0", "1"):
        ecrire(banque / numero / "save7.dat", b"progression du gabarit")
    ecrire(banque / "ExtraData0", b"metadonnees du conteneur")
    ecrire(gabarit / "Config.json", b"{}")
    ecrire(racine / "moteurs/ryubing/publish/Ryujinx", b"faux moteur")
    return configuration(
        {
            "image": IMAGE,
            "engine": str(racine / "moteurs/ryubing"),
            "template": str(gabarit),
            "state": str(racine / "state"),
            "refresh_hz": 120,
            "hold_front_buffer": True,
        },
        changes,
    )


def switch_joue(racine: Path, choix: str) -> Path:
    """Un emplacement Switch déjà joué: le gabarit ne doit pas l'écraser."""
    slot = racine / "state" / SWITCH / choix
    ecrire(slot / "data/bis/user/save/0000000000000001/0/save7.dat", f"partie {choix}".encode())
    ecrire(slot / "data/Config.json", b"{}")
    return slot


def switch_joueur(racine: Path) -> dict:
    """Trois emplacements avec des caches de tailles DIFFÉRENTES: le plus plein amorce
    le cache partagé, et des tailles égales feraient dépendre le choix de l'ordre du
    système de fichiers."""
    config = switch(racine)
    for choix, cache, mesa in (
        ("joueur-ami", 300, 200),
        ("neuve", 500, 50),
        ("debloquee", 100, 10),
    ):
        slot = switch_joue(racine, choix)
        ecrire(slot / f"data/games/{SWITCH}/cache/shaders.bin", b"c" * cache)
        ecrire(slot / "home/.cache/mesa_shader_cache/index", b"m" * mesa)
    return config


def switch_mises_a_jour(racine: Path) -> dict:
    config = switch(racine, updates=str(racine / "mises-a-jour"))
    slot = switch_joue(racine, "neuve")
    jeux = slot / "data/games" / SWITCH
    ecrire(jeux / "updates.json", b'{"selected": "/run-data/updates/maj-v3.nsp"}')
    ecrire(jeux / "dlc.json", b'[{"path": "/run-data/updates/dlc-1.nsp"}]')
    ecrire(racine / "mises-a-jour/maj-v3.nsp", b"mise a jour")
    ecrire(racine / "mises-a-jour/dlc-1.nsp", b"contenu additionnel")
    return config


# --- Switch 2 (Eden) ------------------------------------------------------------------


def switch2(racine: Path, **changes) -> dict:
    for nom in ("eglantine", "lichii"):
        ecrire(racine / "moteurs" / nom / "usr/bin/eden-cli", b"faux moteur")
    return configuration(
        {
            "engine": str(racine / "moteurs/eglantine"),
            "revision": "eglantine-216d3e2943",
            "state": str(racine / "state"),
            "image": "nel3ab/switch-prototype:2026-09-08-recovery",
            "refresh_hz": 120,
            "engines_by_title": {
                ZELDA: {
                    "image": IMAGE_ZELDA,
                    "engine": str(racine / "moteurs/lichii"),
                    "revision": "lichii-30",
                }
            },
        },
        changes,
    )


def switch2_joueur(racine: Path) -> dict:
    config = switch2(racine)
    slot = racine / "state" / SWITCH2 / "joueur-ami"
    ecrire(slot / "home/.local/share/eden/nand/user/save/0000000000000000/partie.bin", b"ma partie")
    ecrire(slot / "emulator.ini", b"[Ancien]\nvaleur=1\n")
    return config


# --- Xbox 360 (Xenia) -----------------------------------------------------------------


def xbox360(racine: Path, ouverte: bool = False, **changes) -> dict:
    ecrire(racine / "moteurs/xenia/usr/bin/xenia_edge", b"faux moteur")
    cle = racine / "cle-des-profils"
    cle.write_text(CLE.hex())
    cle.chmod(0o644 if ouverte else 0o600)
    return configuration(
        {
            "image": IMAGE,
            "engine": str(racine / "moteurs/xenia"),
            "state": str(racine / "state"),
            "profile_key": str(cle),
            "refresh_hz": 120,
            "captures_s": 30,
        },
        changes,
    )


def xbox360_profil_existant(racine: Path) -> dict:
    """Un profil déjà sur le disque porte les sauvegardes de son joueur: il reste."""
    config = xbox360(racine)
    content = racine / "state" / SONIC / "debloquee/xenia/content"
    profil = "E030000000000002"
    ecrire(content / profil / "FFFE07D1/00010000" / profil / "Account", b"profil deja la")
    ecrire(content / profil / "534507D6/00000001/SAVE", b"partie du joueur 2")
    ecrire(content.parent / "cache_host/shader.bin", b"cache hors copie")
    return config


def xbox360_ecran_d_hier(racine: Path) -> dict:
    """L'emplacement garde le `display.json` d'une partie d'hier. La salle doit le
    retirer avant de lancer le moteur: sinon elle prendrait l'ancien compositeur pour
    le nouveau, prêt. Avec un conteneur refusé, rien ne le réécrit, et son retrait se
    voit dans l'arbre (moteurs-critique, revue du 22 novembre 2026)."""
    config = xbox360(racine)
    ecrire(racine / "state" / SONIC / "neuve/display.json", b'{"WAYLAND_DISPLAY": "wayland-0"}')
    return config


# --- Les cas communs aux trois consoles -----------------------------------------------


def communs(modele: Scenario) -> list[Scenario]:
    """Moteur arrêté, manettes incomplètes ou absentes, capture qui meurt, conteneur refusé."""
    console = modele.nom
    return [
        replace(modele, nom=f"{console}-moteur-arrete", arret_apres=1),
        replace(modele, nom=f"{console}-manettes-incompletes", manettes=3),
        replace(modele, nom=f"{console}-manettes-absentes", manettes=None),
        replace(modele, nom=f"{console}-capture-relancee", capture_meurt=True, tours=10),
        replace(modele, nom=f"{console}-conteneur-refuse", echec_moteur=True),
    ]


SW = Scenario("switch", "NEL3AB_SWITCH_CONFIG", switch, SWITCH)
S2 = Scenario("switch2", "NEL3AB_SWITCH2_CONFIG", switch2, SWITCH2, rom="jeu.nup")
XB = Scenario("x360", "NEL3AB_XBOX360_CONFIG", xbox360, SONIC, rom="Sonic.iso")

SCENARIOS_SWITCH = [
    replace(SW, nom="switch-neuve"),
    replace(
        SW,
        nom="switch-defauts",
        preparer=lambda r: switch(r, refresh_hz=ABSENT, hold_front_buffer=ABSENT),
    ),
    replace(SW, nom="switch-mises-a-jour", preparer=switch_mises_a_jour),
    replace(SW, nom="switch-cpuset", preparer=lambda r: switch(r, cpuset=" 0-3,6-9 ")),
    replace(SW, nom="switch-joueur", preparer=switch_joueur, emplacement="joueur-ami"),
    replace(SW, nom="switch-image-absente", preparer=lambda r: switch(r, image=ABSENT)),
    *communs(SW),
    replace(SW, nom="switch-refus-titre", titre=SONIC),
    replace(SW, nom="switch-refus-emplacement", emplacement="joueur-../x"),
    replace(SW, nom="switch-refus-refresh-0", preparer=lambda r: switch(r, refresh_hz=0)),
    replace(SW, nom="switch-tolerance-iso", rom="jeu.iso"),
    replace(
        SW,
        nom="switch-tolerance-moteur-absent",
        preparer=lambda r: switch(r, engine=str(r / "moteurs/absent")),
    ),
]

#: La sonde de latence de spikes/switch-room/latence: même adaptateur, ses deux
#: variables, et le programme de test monté en écriture.
SONDE = replace(
    SW,
    nom="sonde",
    preparer=lambda r: switch(r, hold_front_buffer=False),
    rom="jeu.nro",
    environnement={"NEL3AB_HOLD_FRONT_BUFFER": "1"},
    par_le_worker=False,
)

SCENARIOS_SWITCH2 = [
    replace(S2, nom="switch2-defaut"),
    replace(S2, nom="switch2-zelda", titre=ZELDA),
    replace(S2, nom="switch2-joueur", preparer=switch2_joueur, emplacement="joueur-ami"),
    *communs(S2),
    replace(S2, nom="switch2-refus-titre", titre=SWITCH),
    replace(S2, nom="switch2-refus-emplacement", emplacement="neuve/x"),
    replace(S2, nom="switch2-refus-extension", rom="jeu.xci"),
    replace(
        S2,
        nom="switch2-refus-moteur-absent",
        preparer=lambda r: switch2(r, engine=str(r / "moteurs/absent")),
    ),
    replace(S2, nom="switch2-refus-refresh-0", preparer=lambda r: switch2(r, refresh_hz=0)),
    replace(S2, nom="switch2-refus-revision", preparer=lambda r: switch2(r, revision="")),
    replace(
        S2,
        nom="switch2-refus-profil-titre",
        preparer=lambda r: switch2(r, engines_by_title={SWITCH: {}}),
    ),
]

SCENARIOS_X360 = [
    replace(XB, nom="x360-captures"),
    replace(XB, nom="x360-sans-captures", preparer=lambda r: xbox360(r, captures_s=ABSENT)),
    replace(XB, nom="x360-majuscules", titre=SONIC.upper()),
    replace(
        XB, nom="x360-profil-existant", preparer=xbox360_profil_existant, emplacement="debloquee"
    ),
    replace(XB, nom="x360-joueur", emplacement="joueur-ami"),
    # Le serve d'aujourd'hui (switch-room.py) sert aussi la Switch et la Switch 2:
    # ce scénario passe par lui, par le socle du canari et par le différentiel.
    replace(XB, nom="x360-ecran-d-hier", preparer=xbox360_ecran_d_hier, echec_moteur=True),
    *communs(XB),
    replace(XB, nom="x360-refus-titre", titre=SWITCH),
    replace(XB, nom="x360-refus-emplacement", emplacement="joueur-../x"),
    replace(XB, nom="x360-refus-extension", rom="default.xex"),
    replace(
        XB,
        nom="x360-refus-moteur-absent",
        preparer=lambda r: xbox360(r, engine=str(r / "moteurs/absent")),
    ),
    replace(XB, nom="x360-refus-refresh-0", preparer=lambda r: xbox360(r, refresh_hz=0)),
    replace(XB, nom="x360-refus-captures", preparer=lambda r: xbox360(r, captures_s=5)),
    replace(XB, nom="x360-refus-cle-ouverte", preparer=lambda r: xbox360(r, ouverte=True)),
]

#: Chaque scénario, et les scripts qui doivent tous rendre son doré.
SCRIPTS: dict[str, tuple[str, ...]] = {
    **{s.nom: ("docker/switch-room.py",) for s in SCENARIOS_SWITCH},
    SONDE.nom: ("spikes/switch-room/latence/adaptateur-sonde.py",),
    **{s.nom: ("docker/switch2-room.py",) for s in SCENARIOS_SWITCH2},
    # Le canari doit rendre exactement le doré de l'ancien script.
    **{s.nom: ("docker/xbox360-room.py", "docker/xbox360-room-socle.py") for s in SCENARIOS_X360},
}

TOUS = {s.nom: s for s in [*SCENARIOS_SWITCH, SONDE, *SCENARIOS_SWITCH2, *SCENARIOS_X360]}
