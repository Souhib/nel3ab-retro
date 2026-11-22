"""Les réglages d'essai de Xenia: un faux moteur, une clé d'essai, un état jetable.

Un module d'ESSAI: aucune salle ne le charge (moteurs/socle/test_regles.py).
"""

from pathlib import Path

from moteurs.socle.fiche import Fiche

#: Une clé d'essai pour les profils. La vraie est hors du dépôt (`profile_key`).
CLE = bytes(range(16))


def reglages_essai(racine: Path, lue: Fiche) -> dict:
    """Une configuration Xbox 360 complète, dont chaque chemin est sous `racine`."""
    executable = racine / "moteur" / lue.executable
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"faux moteur")
    cle = racine / "cle-des-profils"
    cle.write_text(CLE.hex())
    cle.chmod(0o600)
    return {
        "image": "sha256:essai",
        "engine": str(racine / "moteur"),
        "state": str(racine / "state"),
        "profile_key": str(cle),
        "refresh_hz": 120,
        "captures_s": 30,
    }
