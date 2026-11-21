"""Qui a accès au salon, et qui peut y déposer des jeux: la liste de l'administrateur.

Trois sources, rassemblées par adresse:

- tailscaled, qui connaît chaque compte dont un appareil peut joindre cette
  machine, membre du tailnet ou invité par un partage (`identity.tailnet`);
- les pseudos du salon, c'est-à-dire chaque personne déjà venue;
- les droits eux-mêmes, pour qu'une personne nommée puis sortie du tailnet
  reste visible, donc retirable.

Rien de cette liste ne sort de la page de l'administrateur: les autres pages
ne voient jamais d'adresse (voir `reperes.py`).
"""

from collections.abc import Awaitable, Callable

from fastapi import HTTPException, status

from nel3ab_control import identity
from nel3ab_control.api.controllers.people import PeopleController
from nel3ab_control.api.schemas.imports import Personnes, PersonneVue
from nel3ab_control.identity import Membre
from nel3ab_control.imports.droits import (
    Registre,
    RegistreIllisible,
    adresse,
    droit_de,
    importeurs,
)
from nel3ab_control.settings import Settings

LireTailnet = Callable[[], Awaitable[list[Membre] | None]]


async def _tailnet() -> list[Membre] | None:
    # Résolu à l'appel et pas à l'import: les essais remplacent `identity.tailnet`
    # pour ne jamais interroger le tailscaled de la machine.
    return await identity.tailnet()


class ImporteursController:
    """La liste des personnes, et le droit de déposer qu'on leur donne ou reprend."""

    def __init__(
        self,
        settings: Settings,
        registre: Registre,
        people: PeopleController,
        lire_tailnet: LireTailnet = _tailnet,
    ) -> None:
        self.settings = settings
        self.registre = registre
        self.people = people
        self.lire_tailnet = lire_tailnet

    async def lister(self) -> Personnes:
        """Tout le monde, l'administrateur d'abord, puis les droits, puis les noms."""
        membres = await self.lire_tailnet()
        par_adresse: dict[str, PersonneVue] = {}

        def vue(login: str) -> PersonneVue:
            if login not in par_adresse:
                par_adresse[login] = PersonneVue(
                    login=login,
                    nom="",
                    pseudo=None,
                    sources=[],
                    appareils=0,
                    en_ligne=False,
                    partage=False,
                    droit=droit_de(login, self.settings, self.registre),
                )
            return par_adresse[login]

        for membre in membres or []:
            une = vue(membre.login)
            une.nom = membre.nom
            une.appareils = membre.appareils
            une.en_ligne = membre.en_ligne
            une.partage = membre.partage
            une.sources.append("tailnet")
        for login, pseudo in self.people.connus().items():
            une = vue(login.strip().lower())
            une.pseudo = pseudo
            une.sources.append("salon")
        admin = self.settings.admin.strip().lower()
        droits = importeurs(self.settings) | self.registre.nommes() | ({admin} if admin else set())
        for login in droits:
            vue(login)

        rang = {"administrateur": 0, "configuration": 1, "nomme": 2, "aucun": 3}
        personnes = sorted(
            par_adresse.values(),
            key=lambda une: (rang[une.droit], (une.pseudo or une.nom or une.login).casefold()),
        )
        return Personnes(
            personnes=personnes,
            tailnet=membres is not None,
            registre_lisible=not self.registre.illisible,
        )

    async def donner(self, login: str) -> PersonneVue:
        """Nomme cette adresse importeuse. Déjà admise: rien ne change."""
        login = self._adresse(login)
        if droit_de(login, self.settings, self.registre) == "aucun":
            await self._ecrire(self.registre.nommer, login)
        return await self._une(login)

    async def reprendre(self, login: str) -> PersonneVue:
        """Reprend le droit donné depuis la page. Sans droit: rien ne change.

        L'administrateur et la configuration se refusent en 409: les retirer
        d'ici ne changerait rien, puisque leur droit ne vient pas de ce fichier,
        et un bouton qui répond « fait » sans rien faire ment.
        """
        login = self._adresse(login)
        droit = droit_de(login, self.settings, self.registre)
        if droit in ("administrateur", "configuration"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "l'administrateur garde toujours ce droit"
                    if droit == "administrateur"
                    else "ce droit est écrit dans NEL3AB_IMPORTEURS: il se retire là"
                ),
            )
        if droit == "nomme":
            await self._ecrire(self.registre.retirer, login)
        return await self._une(login)

    @staticmethod
    def _adresse(login: str) -> str:
        try:
            return adresse(login)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="ce n'est pas une adresse de personne",
            ) from None

    @staticmethod
    async def _ecrire(action: Callable[[str], Awaitable[None]], login: str) -> None:
        try:
            await action(login)
        except RegistreIllisible:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "le fichier des importeurs ne se lit pas: il n'est pas écrasé. "
                    "Répare-le ou retire-le à la main, puis redémarre le salon."
                ),
            ) from None
        except OSError:
            raise HTTPException(
                status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
                detail="le fichier des importeurs n'a pas pu être écrit",
            ) from None

    async def _une(self, login: str) -> PersonneVue:
        liste = await self.lister()
        trouvee = next((une for une in liste.personnes if une.login == login), None)
        if trouvee is not None:
            return trouvee
        return PersonneVue(
            login=login,
            nom="",
            pseudo=None,
            sources=[],
            appareils=0,
            en_ligne=False,
            partage=False,
            droit=droit_de(login, self.settings, self.registre),
        )
