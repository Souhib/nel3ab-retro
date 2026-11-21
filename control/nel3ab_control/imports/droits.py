"""Qui peut déposer un jeu.

Déposer écrit dans la bibliothèque de tout le monde, et un jeu rangé fixe pour
toujours le nom qui porte ses sauvegardes. Trois sources donnent ce droit, et
aucune autre:

- l'administrateur (`Settings.is_admin`, la même règle que pour la référence
  de la salle);
- les adresses écrites à la main dans `NEL3AB_IMPORTEURS`, dans l'unité du
  service. La page les montre, mais ne peut pas les retirer: ce qui est écrit
  dans la configuration se retire dans la configuration;
- les adresses que l'administrateur a nommées depuis la page `/importer`,
  gardées dans un fichier (`Registre`).

Une adresse VIDE ne correspond à personne: elle est filtrée, et les deux chemins
d'identité refusent déjà une adresse vide. Tout passe en minuscules: l'identité
arrive normalisée, la configuration est écrite à la main.
"""

import json
import os
import re
from pathlib import Path
from typing import Literal

from anyio import Lock, to_thread

from nel3ab_control.settings import Settings

Droit = Literal["administrateur", "configuration", "nomme", "aucun"]

#: Une adresse telle que tailscaled les donne: `nom@gmail.com`, `nom@github`,
#: `nom@passkey`. Pas d'espace ni de caractère de contrôle, une seule arobase,
#: et la longueur d'une adresse électronique au plus.
ADRESSE = re.compile(r"[^\s@/\\]{1,128}@[^\s@/\\]{1,125}")


def adresse(texte: str) -> str:
    """L'adresse normalisée, ou `ValueError` si ce n'en est pas une."""
    login = texte.strip().lower()
    if not ADRESSE.fullmatch(login) or not login.isprintable():
        raise ValueError(f"pas une adresse: {texte!r}")
    return login


def importeurs(settings: Settings) -> frozenset[str]:
    """Les adresses de `NEL3AB_IMPORTEURS`, normalisées, sans les vides."""
    return frozenset(une.strip().lower() for une in settings.importeurs) - {""}


class RegistreIllisible(RuntimeError):  # noqa: N818 - un constat sur le fichier, pas une panne
    """Le fichier des importeurs existe mais ne se lit pas: on n'écrit pas dessus."""


class Registre:
    """Les importeurs nommés depuis la page, dans un fichier qui leur survit.

    Lu une fois, au démarrage du salon. Un fichier ABSENT veut dire personne. Un
    fichier PRÉSENT mais illisible (JSON tronqué, forme inattendue) veut dire
    personne aussi, mais il n'est jamais écrasé: la prochaine écriture le
    remplacerait par une liste à un nom et perdrait les autres sans bruit. Les
    écritures sont donc refusées tant qu'il n'est pas réparé ou retiré à la main.

    Les pseudos (`people.json`) font l'autre choix, remplacer un fichier
    illisible, parce qu'un pseudo perdu se retape. Un droit perdu en silence ne
    se voit pas, et un droit gardé par erreur non plus: d'où le refus.
    """

    def __init__(self, fichier: Path) -> None:
        self._fichier = fichier
        self._ecriture = Lock()
        self.illisible = False
        self._nommes: frozenset[str] = frozenset()
        try:
            brut = fichier.read_text(encoding="utf-8")
        except FileNotFoundError:
            return
        except OSError:
            self.illisible = True
            return
        try:
            lu = json.loads(brut)
            liste = lu["importeurs"] if isinstance(lu, dict) else None
            if not isinstance(liste, list) or not all(isinstance(un, str) for un in liste):
                raise ValueError("forme inattendue")
            self._nommes = frozenset(adresse(un) for un in liste)
        except (ValueError, KeyError):
            self.illisible = True

    def nommes(self) -> frozenset[str]:
        """Les adresses nommées depuis la page."""
        return self._nommes

    async def nommer(self, login: str) -> None:
        """Donne le droit à cette adresse, et l'écrit avant de répondre."""
        await self._changer(self._nommes | {adresse(login)})

    async def retirer(self, login: str) -> None:
        """Reprend le droit à cette adresse, et l'écrit avant de répondre."""
        await self._changer(self._nommes - {adresse(login)})

    async def _changer(self, nouveaux: frozenset[str]) -> None:
        if self.illisible:
            raise RegistreIllisible(str(self._fichier))
        async with self._ecriture:
            # Le disque d'abord, la mémoire ensuite: si l'écriture échoue, la
            # page reçoit une erreur et le droit reste ce qu'il était, partout.
            await to_thread.run_sync(_ecrire, self._fichier, sorted(nouveaux))
            self._nommes = nouveaux


def _ecrire(fichier: Path, liste: list[str]) -> None:
    """Écrit à côté, en 600, puis renomme: un fichier à moitié écrit n'existe jamais."""
    fichier.parent.mkdir(parents=True, exist_ok=True)
    temporaire = fichier.with_name(fichier.name + ".tmp")
    contenu = json.dumps({"importeurs": liste}, ensure_ascii=False, indent=2) + "\n"
    descripteur = os.open(temporaire, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descripteur, "w", encoding="utf-8") as sortie:
        sortie.write(contenu)
        sortie.flush()
        os.fsync(sortie.fileno())
    temporaire.replace(fichier)


def droit_de(login: str | None, settings: Settings, registre: Registre | None) -> Droit:
    """D'où vient le droit de déposer de cette adresse, ou « aucun »."""
    if not login:
        return "aucun"
    login = login.strip().lower()
    if not login:
        return "aucun"
    if settings.is_admin(login):
        return "administrateur"
    if login in importeurs(settings):
        return "configuration"
    if registre is not None and login in registre.nommes():
        return "nomme"
    return "aucun"


def peut_importer(login: str | None, settings: Settings, registre: Registre | None = None) -> bool:
    """Vrai pour l'administrateur, la configuration et les nommés, seulement."""
    return droit_de(login, settings, registre) != "aucun"
