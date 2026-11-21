"""Un repère opaque et stable par personne, montré à la place de son adresse.

# Pourquoi

L'état de la salle part vers toutes les pages, invités partagés compris. Il
portait l'adresse de connexion de chaque présent, qui est souvent un courriel.
Relevé par l'audit du 20 novembre 2026. La page n'a pas besoin de l'adresse: elle
a besoin de reconnaître la même personne d'un message à l'autre (le chef dans la
liste, une clé de liste stable) et de savoir laquelle est elle-même. Le premier
besoin demande un repère stable, le second un booléen calculé pour chaque page.

# Pourquoi un HMAC et pas une empreinte

Une empreinte de l'adresse seule (SHA-256) se recalcule: quiconque devine une
adresse vérifierait si elle est dans la salle. Un HMAC-SHA256 avec un secret de
la machine ne se recalcule qu'avec ce secret. Seize caractères hexadécimaux,
soit 64 bits: une collision entre les quelques personnes d'un salon est
improbable au point d'être négligeable, et le repère n'a pas à être un secret
lui-même.

# Où vit le secret

À côté des pseudos, dans le dossier d'état du salon, jamais dans le dépôt. Il
naît au premier repère demandé, lisible par son seul propriétaire (0600). Un
secret absent ou abîmé est remplacé: les repères changent alors une fois, ce qui
ne coûte qu'un rechargement de page. Un disque qui refuse l'écriture donne un
secret pour la vie du processus: la salle marche, ses repères changeront au
prochain démarrage.
"""

import hashlib
import hmac
import os
import secrets
from pathlib import Path

#: Le nom du fichier du secret, dans le dossier d'état du salon.
FICHIER = "reperes.secret"

#: Combien d'octets de secret. 32, la taille d'un bloc de sortie de SHA-256.
TAILLE = 32

#: Combien de caractères hexadécimaux garde un repère. Voir le docstring du module.
LONGUEUR = 16


class Reperes:
    """Le repère d'une adresse, sous le secret de cette machine."""

    def __init__(self, fichier: Path) -> None:
        self._fichier = fichier
        self._cle: bytes | None = None

    def de(self, login: str | None) -> str | None:
        """Le repère de cette adresse, ou rien sans adresse.

        Rien plutôt qu'un repère d'anonyme: deux personnes sans identité ne
        sont pas la même personne, et un repère commun les confondrait.
        """
        if login is None:
            return None
        if self._cle is None:
            self._cle = _charger(self._fichier)
        empreinte = hmac.new(self._cle, login.encode("utf-8"), hashlib.sha256)
        return empreinte.hexdigest()[:LONGUEUR]


def _charger(fichier: Path) -> bytes:
    """Le secret gardé, ou un nouveau, écrit pour la prochaine fois."""
    try:
        gardee = bytes.fromhex(fichier.read_text(encoding="ascii").strip())
    except (OSError, ValueError):
        gardee = b""
    if len(gardee) == TAILLE:
        return gardee
    neuve = secrets.token_bytes(TAILLE)
    try:
        fichier.parent.mkdir(parents=True, exist_ok=True)
        provisoire = fichier.with_suffix(".tmp")
        # Créé directement en 0600: écrire puis restreindre laisserait le secret
        # lisible le temps d'un appel. `fchmod` en plus, parce que le mode de
        # `open` ne s'applique pas à un fichier provisoire resté d'un échec.
        descripteur = os.open(provisoire, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(descripteur, 0o600)
        with os.fdopen(descripteur, "w", encoding="ascii") as sortie:
            sortie.write(neuve.hex())
        provisoire.replace(fichier)
    except OSError:
        # Voir le docstring du module: un secret pour la vie du processus.
        pass
    return neuve
