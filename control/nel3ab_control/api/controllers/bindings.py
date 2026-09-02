"""Les réglages de manette, rangés sous la personne et pas sous la machine.

Le pseudo avait déjà cette forme, et pour la même raison: ce qu'on a réglé une
fois doit se retrouver ailleurs. Une manette apprise sur le portable du salon
n'a aucune raison d'être réapprise sur la tour du bureau, et la réapprendre veut
dire seize questions.

**Le service ne lit pas ce qu'il garde.** La forme d'un profil appartient à la
page: elle sait ce qu'un axe, un repos et un signe veulent dire, et elle est la
seule à s'en servir. La décrire ici en donnerait une deuxième version à tenir
d'accord avec la première, et il faudrait une version du service pour ajouter un
champ. Ce qui est vérifié ici est donc ce qui protège le disque et rien de plus:
c'est un objet, et il tient sous un plafond.

Sans identité, rien de tout ça ne s'applique: la page garde ses réglages dans le
navigateur, comme avant. Un classeur a besoin d'un nom sur le dossier.
"""

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from anyio import to_thread

#: Ce qu'un jeu de réglages a le droit de peser, en octets de JSON.
#:
#: Seize commandes par manette, quelques dizaines d'octets chacune, et personne
#: n'a plus de quelques manettes: le compte réel tient dans deux kilo-octets.
#: Trente-deux mille laissent de la marge pour une collection déraisonnable tout
#: en gardant ce fichier lisible et sa lecture instantanée. Sans plafond, une
#: page pourrait remplir le disque de la machine avec une requête.
CEILING = 32_768


class RoomBindingsController:
    """Les réglages de RÉFÉRENCE de la salle, que tout le monde reçoit.

    # Pourquoi ils ne sont pas simplement le dossier de quelqu'un

    Pointer sur le dossier d'une personne aurait marché et coûté trois lignes:
    la référence serait alors toujours à jour, sans bouton ni geste. Elle serait
    aussi toujours en train de bouger. Ce qu'on veut est un état auquel on peut
    REVENIR quoi qu'il arrive, donc un instantané qu'on publie, pas un miroir de
    ce que quelqu'un est en train de régler.

    # Ce que le service en sait

    Rien, comme pour les dossiers personnels: la forme appartient à la page. Ce
    qui est vérifié est ce qui protège le disque — c'est un objet, et il tient
    sous le même plafond.
    """

    def __init__(self, store: Path) -> None:
        self._store = store
        self._kept: dict[str, Any] = _read_one(store)

    def read(self) -> dict[str, Any]:
        """La référence, ou rien quand la salle n'en a pas encore."""
        return self._kept

    async def publish(self, settings: dict[str, Any]) -> dict[str, Any]:
        """Remplace la référence. Un remplacement, pas une fusion.

        Fusionner ferait survivre un profil qu'on vient justement de retirer, et
        « retirer de la salle » est un bouton qui doit marcher.
        """
        if len(json.dumps(settings, ensure_ascii=False)) > CEILING:
            raise ValueError("ces réglages sont trop gros pour être des réglages")
        self._kept = settings
        await to_thread.run_sync(_write, self._store, dict(settings))
        return settings


class BindingsController:
    """Ce que chacun a réglé, gardé sous son adresse."""

    def __init__(self, store: Path) -> None:
        self._store = store
        self._kept: dict[str, dict[str, Any]] = _read(store)

    def of(self, login: str) -> dict[str, Any]:
        """Les réglages de quelqu'un, ou rien du tout."""
        return self._kept.get(login, {})

    async def keep(self, login: str, settings: dict[str, Any]) -> dict[str, Any]:
        """Remplace les réglages de quelqu'un, et les garde.

        Un remplacement et pas une fusion: la page envoie tout ce qu'elle a, et
        fusionner ferait survivre une manette qu'on vient justement d'oublier.
        """
        if len(json.dumps(settings, ensure_ascii=False)) > CEILING:
            raise ValueError("ces réglages sont trop gros pour être des réglages")
        self._kept[login] = settings
        # Sur un fil, comme les pseudos: l'écriture est rare et minuscule, mais
        # sur la boucle elle bloquerait le salon qui diffuse au même moment.
        await to_thread.run_sync(_write, self._store, dict(self._kept))
        return settings


def _read_one(store: Path) -> dict[str, Any]:
    """Un seul objet, pas un classeur. Illisible veut dire vide, comme ailleurs."""
    try:
        found = json.loads(store.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return found if isinstance(found, dict) else {}


def _read(store: Path) -> dict[str, dict[str, Any]]:
    """Ce qui est gardé. Un fichier illisible est un fichier qu'on remplace.

    Perdre ses réglages est ennuyeux; ne pas pouvoir entrer dans la salle parce
    qu'une coupure a tronqué un fichier serait pire.
    """
    try:
        found = json.loads(store.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(found, dict):
        return {}
    return {
        str(login): settings
        for login, settings in found.items()
        if isinstance(login, str) and isinstance(settings, dict)
    }


def _write(store: Path, kept: Mapping[str, Any]) -> None:
    """Écrit puis renomme, avec une copie de la version d'avant.

    Exactement la même prudence que pour les pseudos, et pour la même raison: un
    JSON tronqué serait jeté à la lecture, et tout le monde repartirait de zéro.
    """
    try:
        store.parent.mkdir(parents=True, exist_ok=True)
        temporary = store.with_suffix(".tmp")
        temporary.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
        if store.exists():
            store.replace(store.with_suffix(".json.bak"))
        temporary.replace(store)
    except OSError:
        # Disque plein ou dossier en lecture seule: les réglages valent pour
        # cette session, et la partie continue.
        pass
