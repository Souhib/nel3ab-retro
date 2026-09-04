#!/usr/bin/env python3
"""Prouve qu'on peut changer l'extension d'une Wiimote SANS relancer le jeu.

# La question

Changer de manette relance la partie aujourd'hui, parce que le choix voyage sur
le chemin du changement de jeu. La question posée est: est-ce qu'un joueur peut
dire « je reste le joueur 1, mais débranche mon Nunchuk et mets-moi autre chose »
pendant que le jeu tourne ?

# Ce qui est prouvé ici, et ce qui ne l'est pas

PROUVÉ: Dolphin échange l'extension d'une Wiimote émulée en cours de partie,
sur ordre venu de l'extérieur, sans redémarrage et sans le patcher.

NON PROUVÉ: que le JEU accepte l'échange à ce moment-là. Un jeu Wii peut très
bien ignorer une extension apparue en plein niveau, ou attendre son écran de
choix de manette. Ça se teste par jeu, et ce n'est pas ce que ce script mesure.

# Comment, et pourquoi ça marche sans patch

Deux faits lus dans la source du Dolphin épinglé (216ffb45):

1. `Wiimote::Update()` tourne à 200 Hz et appelle `HandleExtensionSwap` à chaque
   passage. Le commentaire de Dolphin le dit: « If a new extension is requested
   in the GUI the change will happen here. » Le mécanisme existe, il n'attend
   qu'un ordre.

2. Le choix d'extension accepte une EXPRESSION d'entrée, réévaluée à chaque
   sondage (`NumericSetting::GetValue`, qui relit `m_input` tant que la valeur
   n'est pas une constante). `Attachments::LoadConfig` le dit aussi:
   « First assume attachment string is a valid expression. »

On écrit donc `Extension` comme une expression qui lit un SECOND tuyau, dédié au
contrôle. Un second tuyau plutôt qu'un jeton du premier parce que le tuyau de
Dolphin n'expose que douze boutons — exactement les douze de notre trame — donc
en voler un coûterait un bouton de jeu.

# L'observable

`HandleExtensionSwap` journalise « Switching to Extension N » et « Detaching
Extension ». C'est un nombre dans un journal: pas besoin de regarder l'écran, pas
besoin d'un humain, et ça nomme l'extension obtenue plutôt que de la deviner.

Noter l'échange en DEUX temps, qui est le comportement de Dolphin et non un
défaut: il détache d'abord, il attache au passage suivant.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
GAME = os.environ.get(
    "NEL3AB_SPIKE_ROM",
    str(Path.home() / "roms/wii/Mario Strikers Charged (USA) (En,Fr,Es) (Rev 1).rvz"),
)
IMAGE = os.environ.get("NEL3AB_DOLPHIN_IMAGE", "nel3ab/dolphin:dev")

# Un nom de conteneur À NOUS, et ce n'est pas du confort.
#
# `dolphin-in-docker.sh` fait `docker rm -f nel3ab-dolphin` avant de démarrer,
# pour la bonne raison qu'un émulateur orphelin vole les entrées. Sans ce nom,
# lancer cette manip TUE le Dolphin de la salle en cours, et la salle tue le
# nôtre en repartant. C'est arrivé: code de sortie 137, et une partie relancée
# sous les doigts de quelqu'un.
CONTAINER = os.environ.get("NEL3AB_SPIKE_CONTAINER", "nel3ab-dolphin-manip")

# L'ordre des attachements, tel que `WiimoteEmu::Wiimote::Wiimote` les ajoute.
# Le nombre EST le contrat: l'expression rend un entier, pas un nom.
NONE, NUNCHUK, CLASSIC, GUITAR = 0, 1, 2, 3
NAMES = {NONE: "rien", NUNCHUK: "Nunchuk", CLASSIC: "Classic", GUITAR: "guitare"}

CTL = "ctl"          # le tuyau de contrôle
PAD = "p1"           # le tuyau de jeu de la place 1

# Nunchuk par défaut, Classic si A est tenu sur le tuyau de contrôle, guitare si
# B l'est. Une somme plutôt qu'un `if` imbriqué: les deux boutons ne sont jamais
# tenus ensemble, et le calcul se relit.
EXPRESSION = f"1 + `Pipe/0/{CTL}:Button A` + 2 * `Pipe/0/{CTL}:Button B`"

SWITCH = re.compile(r"Switching to Extension (\d+)")


def write_config(user: Path) -> None:
    (user / "Config").mkdir(parents=True, exist_ok=True)
    (user / "Pipes").mkdir(parents=True, exist_ok=True)

    (user / "Config" / "Dolphin.ini").write_text(
        "[Core]\n"
        # Aucune manette GameCube: on veut la Wiimote seule, comme la salle la
        # présente aujourd'hui pour un jeu Wii.
        "SIDevice0 = 0\nSIDevice1 = 0\nSIDevice2 = 0\nSIDevice3 = 0\n"
        "\n[DSP]\nBackend = No Audio Output\n"
        "\n[Analytics]\nEnabled = False\nPermissionAsked = True\n"
        "\n[Interface]\nConfirmStop = False\n"
    )

    (user / "Config" / "WiimoteNew.ini").write_text(
        "[Wiimote1]\n"
        f"Device = Pipe/0/{PAD}\n"
        "Source = 1\n"
        "Buttons/A = `Button A`\n"
        "Buttons/B = `Button B`\n"
        f"Extension = {EXPRESSION}\n"
    )

    # Le journal EST la mesure. Verbosité 4 = INFO, la ligne qu'on vient lire.
    (user / "Config" / "Logger.ini").write_text(
        "[Options]\nVerbosity = 4\nWriteToConsole = True\nWriteToFile = False\n"
        "\n[Logs]\nWIIMOTE = True\n"
    )


def main() -> int:
    if not Path(GAME).exists():
        print(f"pas de jeu à {GAME}", file=sys.stderr)
        return 64

    # Deux Dolphin sur une seule carte, c'est jouable; deux Dolphin sur un seul
    # NOM de conteneur, non. Le garde-fou vérifie que le nôtre est bien à part.
    if CONTAINER == "nel3ab-dolphin":
        print("le nom de conteneur est celui de la salle: ça la tuerait", file=sys.stderr)
        return 64

    user = Path(tempfile.mkdtemp(prefix="nel3ab-chaud-"))
    write_config(user)
    for name in (PAD, CTL):
        os.mkfifo(user / "Pipes" / name)

    seen: list[int] = []
    lines: list[str] = []

    proc = subprocess.Popen(
        [
            str(REPO / "docker" / "dolphin-in-docker.sh"),
            "--platform", "headless",
            "--user", str(user),
            "--video_backend", "Null",
            "--exec", GAME,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={
            **os.environ,
            "NEL3AB_DOLPHIN_IMAGE": IMAGE,
            "NEL3AB_CONTAINER": CONTAINER,
        },
    )

    def pump() -> None:
        for line in proc.stdout:  # type: ignore[union-attr]
            lines.append(line)
            found = SWITCH.search(line)
            if found:
                seen.append(int(found.group(1)))

    threading.Thread(target=pump, daemon=True).start()

    # Ouvrir les deux tuyaux: Dolphin bloque tant que personne n'écrit dedans.
    pads = {name: open(user / "Pipes" / name, "w") for name in (PAD, CTL)}

    def say(name: str, line: str) -> None:
        """Écrit sur un tuyau, et dit clairement si Dolphin n'est plus là.

        Un tuyau rompu ne veut pas dire « l'écriture a raté »: il veut dire que
        le lecteur est parti. Le confondre avec une panne d'écriture ferait
        chercher au mauvais endroit."""
        if proc.poll() is not None:
            raise RuntimeError(f"Dolphin est parti (code {proc.returncode}) avant « {line} »")
        try:
            pads[name].write(line + "\n")
            pads[name].flush()
        except BrokenPipeError as gone:
            raise RuntimeError(
                f"Dolphin a fermé le tuyau « {name} » pendant « {line} » "
                f"(code de sortie {proc.poll()})"
            ) from gone

    bad = 0

    def check(ok: bool, what: str) -> None:
        nonlocal bad
        if not ok:
            bad += 1
        print(f"  {'ok  ' if ok else 'RATÉ'}   {what}")

    try:
        # Le jeu doit avoir démarré et la Wiimote exister. Un jeu Wii met du
        # temps: on attend la PREUVE (une première extension) plutôt qu'un délai.
        deadline = time.time() + 120
        while not seen and time.time() < deadline and proc.poll() is None:
            time.sleep(0.5)
        check(bool(seen), f"la Wiimote démarre avec une extension ({NAMES.get(seen[0] if seen else -1, '?')})")
        if not seen:
            return 1
        check(seen[0] == NUNCHUK, f"et c'est le Nunchuk, comme la salle le règle (vu {seen[0]})")

        # Laisser le jeu TOURNER avant de demander quoi que ce soit.
        #
        # Sans cette attente, l'échange se faisait 1,4 s après l'init de la
        # Wiimote, c'est-à-dire pendant le démarrage. Ça prouvait que Dolphin
        # échange, mais laissait ouverte l'objection « ça n'a marché que parce
        # que rien ne tournait encore ».
        settle = float(os.environ.get("NEL3AB_SPIKE_SETTLE", "25"))
        print(f"  ...   le jeu tourne pendant {settle:.0f} s avant qu'on demande quoi que ce soit")
        time.sleep(settle)
        check(proc.poll() is None, f"le jeu tourne toujours après {settle:.0f} s")

        before = len(seen)
        say(CTL, "PRESS A")
        # Deux temps: Dolphin détache d'abord, attache au passage suivant.
        time.sleep(2.0)
        got = seen[before:]
        check(CLASSIC in got, f"un ordre sur le tuyau de contrôle donne la Classic sans relancer (vu {got})")

        before = len(seen)
        say(CTL, "RELEASE A")
        say(CTL, "PRESS B")
        time.sleep(2.0)
        got = seen[before:]
        check(GUITAR in got, f"et la guitare de même (vu {got})")

        # Le jumeau négatif: sans ordre, rien ne bouge. Sans lui, un échange dû à
        # autre chose — un reset, un rechargement — passerait pour une réussite.
        before = len(seen)
        time.sleep(2.0)
        check(len(seen) == before, "et rien ne change tant que personne ne demande")

        before = len(seen)
        say(CTL, "RELEASE B")
        time.sleep(2.0)
        check(NUNCHUK in seen[before:], f"le retour au Nunchuk marche aussi (vu {seen[before:]})")

        check(proc.poll() is None, "Dolphin n'a jamais redémarré pendant tout ça")
    except RuntimeError as trouble:
        check(False, str(trouble))
    finally:
        for handle in pads.values():
            try:
                handle.close()
            except BrokenPipeError:
                pass
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
        if bad:
            keep = Path("/tmp/nel3ab-chaud.log")
            keep.write_text("".join(lines))
            print(f"\n--- dernières lignes de Dolphin (tout dans {keep}) ---", file=sys.stderr)
            print("".join(lines[-25:]), file=sys.stderr)
        shutil.rmtree(user, ignore_errors=True)

    print("\nPASS" if not bad else f"\nÉCHEC ({bad})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
