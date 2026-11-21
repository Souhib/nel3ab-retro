"""Les envois en cours: les recevoir morceau par morceau, puis les terminer.

# Le protocole, en entier

1. `POST /api/imports` annonce un fichier: nom, taille, empreinte rapide. Le
   salon rend un identifiant et le décalage où reprendre (zéro). Il refuse
   (409) un fichier déjà dans la bibliothèque, ou déjà en cours d'envoi; dans
   ce second cas il rend l'identifiant et le décalage, si l'envoi est à la même
   personne: c'est ainsi qu'une page rechargée reprend où elle en était.
2. `PUT /api/imports/{id}?decalage=N` envoie un morceau brut de 32 Mio au plus,
   avec un `Content-Length` exact. Un décalage qui n'est pas celui du serveur
   est refusé (409) avec le vrai: la page reprend de là.
3. `GET /api/imports/{id}` rend le décalage et l'état, à tout moment.
4. `POST /api/imports/{id}/fin` lance la vérification: empreinte complète,
   identification, rangement. Elle tourne en arrière-plan; la page relit l'état.
5. `DELETE /api/imports/{id}` abandonne, et efface la quarantaine de l'envoi.

# Ce qui protège le disque

Chaque envoi réserve sa taille annoncée dès sa création, contre un plafond par
envoi et un plafond pour toute la quarantaine. Chaque morceau vérifie qu'après
lui il restera encore la marge libre: les jeux partagent le disque du système.
"""

import hashlib
import os
import shutil
from collections.abc import AsyncIterator, Callable, Mapping
from pathlib import Path
from typing import Any

import anyio
from anyio import to_thread
from anyio.abc import TaskGroup
from fastapi import HTTPException, status
from starlette.requests import ClientDisconnect

from nel3ab_control.api.schemas.imports import (
    MORCEAU_MAX,
    DemandeEnvoi,
    ElementVu,
    EnvoiVu,
)
from nel3ab_control.imports.archives import Outils
from nel3ab_control.imports.destinations import dossiers, libelle
from nel3ab_control.imports.quarantaine import (
    IDENTIFIANT,
    Envoi,
    Quarantaine,
    QuarantaineAbimee,
)
from nel3ab_control.imports.rangement import Bibliotheque
from nel3ab_control.imports.traitement import Regles, traiter
from nel3ab_control.settings import Settings

#: On écrit par blocs d'un Mio: assez pour ne pas sauter dans un fil à chaque
#: paquet de 64 Kio, assez peu pour ne rien garder de gros en mémoire.
BLOC = 1 << 20

LIBELLES_ENVOI = {
    "envoi": "en cours d'envoi",
    "verification": "vérification",
    "termine": "terminé",
    "erreur": "erreur",
}
LIBELLES_ELEMENT = {
    "range": "rangé",
    "pas-jouable": "reconnu, pas encore jouable",
    "a-confirmer": "à confirmer",
    "inconnu": "inconnu, gardé en quarantaine",
    "doublon": "déjà dans la bibliothèque",
    "refuse": "refusé",
    "archive-non-prise-en-charge": "archive non prise en charge",
}


def refus(code: int, raison: str, message: str, **plus: Any) -> HTTPException:
    """Un refus que la page lit: une raison stable, une phrase, et ce qui aide."""
    return HTTPException(code, detail={"raison": raison, "message": message, **plus})


def longueur_annoncee(entetes: Mapping[str, str]) -> int:
    """Le `Content-Length` d'un morceau, exigé et exact.

    Sans lui, ou en `Transfer-Encoding: chunked`, on ne sait pas d'avance ce
    qui arrive: refusé (411) AVANT de lire un seul octet.
    """
    if "transfer-encoding" in entetes or "content-length" not in entetes:
        raise refus(status.HTTP_411_LENGTH_REQUIRED, "longueur", "Content-Length est exigé")
    valeur = entetes["content-length"]
    if not valeur.isdigit():
        raise refus(status.HTTP_400_BAD_REQUEST, "longueur", "Content-Length illisible")
    return int(valeur)


def vu(envoi: Envoi) -> EnvoiVu:
    """L'envoi tel que la page le lit, sans aucun nom du serveur."""
    return EnvoiVu(
        id=envoi.id,
        nom=envoi.nom,
        taille=envoi.taille,
        decalage=envoi.decalage,
        etat=envoi.etat,
        libelle=LIBELLES_ENVOI[envoi.etat],
        message=envoi.message,
        elements=[
            ElementVu(
                nom=element.nom,
                taille=element.taille,
                console=element.console,
                console_libelle=libelle(element.console),
                format=element.format,
                titre=element.titre,
                identifiant=element.identifiant,
                drapeaux=element.drapeaux,
                preuve=element.preuve,
                details=element.details,
                etat=element.etat,
                libelle=LIBELLES_ELEMENT[element.etat],
                message=element.message,
                destination=element.destination,
            )
            for element in envoi.elements
        ],
    )


def _espace_libre(chemin: Path) -> int:
    return shutil.disk_usage(chemin).free


class ImportsController:
    """Les envois de cette machine, et le seul chemin vers la bibliothèque."""

    def __init__(
        self,
        settings: Settings,
        *,
        espace_libre: Callable[[Path], int] = _espace_libre,
        outils: Callable[[], Outils | None] = Outils.trouver,
    ) -> None:
        self.settings = settings
        self.quarantaine = Quarantaine(settings.imports_dir)
        self.espace_libre = espace_libre
        self.outils = outils
        self._envois: dict[str, Envoi] | None = None
        self._verrous: dict[str, anyio.Lock] = {}
        self._global = anyio.Lock()
        #: L'empreinte complète calculée au fil des morceaux, et jusqu'où.
        self._calculs: dict[str, tuple[Any, int]] = {}
        self._finis: dict[str, anyio.Event] = {}
        self._groupe: TaskGroup | None = None

    def demarrer(self, groupe: TaskGroup) -> None:
        """Le groupe où tournent les vérifications, celui de la vie du salon."""
        self._groupe = groupe

    # ── Le registre ────────────────────────────────────────────────────

    async def _registre(self) -> dict[str, Envoi]:
        """Les envois, relus de la quarantaine au premier besoin."""
        async with self._global:
            if self._envois is None:
                charges = await to_thread.run_sync(self.quarantaine.charger)
                self._envois = {envoi.id: envoi for envoi in charges}
            return self._envois

    def _verrou(self, ident: str) -> anyio.Lock:
        return self._verrous.setdefault(ident, anyio.Lock())

    def _peut_voir(self, envoi: Envoi, login: str) -> bool:
        administrateur = self.settings.admin.strip().lower()
        return envoi.par == login or (bool(administrateur) and login == administrateur)

    async def _a(self, ident: str, login: str) -> Envoi:
        """L'envoi, s'il existe ET si cette personne peut le voir. Sinon 404."""
        envoi = (await self._registre()).get(ident) if IDENTIFIANT.match(ident) else None
        if envoi is None or not self._peut_voir(envoi, login):
            raise refus(status.HTTP_404_NOT_FOUND, "inconnu", "aucun envoi de ce nom")
        return envoi

    def _reserve(self, envois: dict[str, Envoi]) -> int:
        """Ce que la quarantaine tient ou tiendra: tout ce qui n'est pas rangé."""
        total = 0
        for envoi in envois.values():
            if envoi.etat in ("envoi", "verification"):
                total += envoi.taille
            else:
                total += sum(e.taille for e in envoi.elements if e.etat != "range")
        return total

    # ── Le protocole ───────────────────────────────────────────────────

    async def lister(self, login: str) -> list[EnvoiVu]:
        envois = await self._registre()
        return [
            vu(e)
            for e in sorted(envois.values(), key=lambda e: e.cree)
            if self._peut_voir(e, login)
        ]

    async def lire(self, ident: str, login: str) -> EnvoiVu:
        return vu(await self._a(ident, login))

    async def creer(self, demande: DemandeEnvoi, login: str) -> EnvoiVu:
        """Un envoi neuf, ou le refus qui dit pourquoi et comment reprendre."""
        envois = await self._registre()
        async with self._global:
            for envoi in envois.values():
                if (envoi.empreinte_rapide, envoi.taille) != (
                    demande.empreinte_rapide,
                    demande.taille,
                ):
                    continue
                if envoi.etat != "termine" or any(e.etat != "range" for e in envoi.elements):
                    plus = (
                        {"id": envoi.id, "decalage": envoi.decalage, "etat": envoi.etat}
                        if self._peut_voir(envoi, login)
                        else {}
                    )
                    raise refus(
                        status.HTTP_409_CONFLICT,
                        "en-cours",
                        "ce fichier est déjà en cours d'envoi ou en quarantaine",
                        **plus,
                    )
            bibliotheque = Bibliotheque(
                dossiers(self.settings.rom_dir), self.settings.imports_dir / "rangement.lock"
            )
            deja = await to_thread.run_sync(
                bibliotheque.deja_la, demande.taille, demande.empreinte_rapide
            )
            if deja is not None:
                raise refus(
                    status.HTTP_409_CONFLICT,
                    "deja-la",
                    f"ce fichier est déjà dans la bibliothèque: « {deja.montre} »",
                    fichier=deja.montre,
                )
            if demande.taille > self.settings.imports_max:
                raise refus(
                    status.HTTP_413_CONTENT_TOO_LARGE,
                    "trop-gros",
                    f"un envoi ne dépasse pas {self.settings.imports_max} octets",
                )
            if self._reserve(envois) + demande.taille > self.settings.imports_total:
                raise refus(
                    status.HTTP_507_INSUFFICIENT_STORAGE,
                    "quarantaine-pleine",
                    "la quarantaine est pleine: termine ou abandonne un envoi d'abord",
                )
            await to_thread.run_sync(self._place_pour, demande.taille)
            envoi = await to_thread.run_sync(
                self.quarantaine.creer, demande.nom, demande.taille, demande.empreinte_rapide, login
            )
            envois[envoi.id] = envoi
            self._calculs[envoi.id] = (hashlib.sha256(), 0)
            return vu(envoi)

    def _place_pour(self, restant: int) -> None:
        """Refuse (507) quand `restant` octets de plus passeraient sous la marge."""
        self.quarantaine.preparer()
        libre = self.espace_libre(self.settings.imports_dir)
        if libre - restant < self.settings.imports_marge:
            raise refus(
                status.HTTP_507_INSUFFICIENT_STORAGE,
                "disque",
                f"il ne resterait pas {self.settings.imports_marge} octets libres sur le disque",
                libre=libre,
            )

    async def recevoir(
        self, ident: str, decalage: int, longueur: int, flux: AsyncIterator[bytes], login: str
    ) -> EnvoiVu:
        """Écrit un morceau à sa place, sans jamais le garder en mémoire en entier."""
        async with self._verrou(ident):
            envoi = await self._a(ident, login)
            if envoi.etat != "envoi":
                raise refus(status.HTTP_409_CONFLICT, "etat", "cet envoi n'attend plus d'octets")
            if decalage != envoi.decalage:
                raise refus(
                    status.HTTP_409_CONFLICT,
                    "decalage",
                    f"le serveur en est à l'octet {envoi.decalage}",
                    decalage=envoi.decalage,
                )
            if longueur > MORCEAU_MAX:
                raise refus(
                    status.HTTP_413_CONTENT_TOO_LARGE,
                    "morceau",
                    f"un morceau ne dépasse pas {MORCEAU_MAX} octets",
                )
            if decalage + longueur > envoi.taille:
                raise refus(
                    status.HTTP_413_CONTENT_TOO_LARGE,
                    "depasse",
                    "ce morceau dépasse la taille annoncée",
                )
            await to_thread.run_sync(self._place_pour, envoi.taille - decalage)
            try:
                fd = await to_thread.run_sync(lambda: self.quarantaine.ouvrir(envoi, ecriture=True))
            except QuarantaineAbimee as erreur:
                raise refus(status.HTTP_409_CONFLICT, "abimee", str(erreur)) from erreur
            calcul, jusque = self._calculs.get(ident, (None, -1))
            if jusque != decalage:
                calcul = None
            ecrits = 0
            recus = 0
            #: Le code, la raison et la phrase d'un refus survenu en route.
            probleme: tuple[int, str, str] | None = None
            tampon = bytearray()
            try:
                async for paquet in flux:
                    recus += len(paquet)
                    if recus > longueur:
                        probleme = (status.HTTP_400_BAD_REQUEST, "longueur", "corps trop long")
                        break
                    tampon += paquet
                    if len(tampon) >= BLOC:
                        ecrits += await self._ecrire(fd, decalage + ecrits, tampon, calcul)
                if probleme is None and tampon:
                    ecrits += await self._ecrire(fd, decalage + ecrits, tampon, calcul)
            except ClientDisconnect:
                probleme = (status.HTTP_400_BAD_REQUEST, "coupe", "envoi coupé en route")
            except OSError as erreur:
                probleme = (
                    status.HTTP_507_INSUFFICIENT_STORAGE,
                    "ecriture",
                    f"écriture refusée: {erreur}",
                )
            finally:
                os.close(fd)
                envoi.decalage = decalage + ecrits
                if calcul is not None:
                    self._calculs[ident] = (calcul, envoi.decalage)
                else:
                    self._calculs.pop(ident, None)
                await to_thread.run_sync(self.quarantaine.sauver, envoi)
            if probleme is None and recus != longueur:
                probleme = (status.HTTP_400_BAD_REQUEST, "longueur", "corps plus court qu'annoncé")
            if probleme is not None:
                # Ce qui est arrivé est gardé: la page reprend au vrai décalage.
                raise refus(*probleme, decalage=envoi.decalage)
            return vu(envoi)

    async def _ecrire(self, fd: int, position: int, tampon: bytearray, calcul: Any) -> int:
        donnees = bytes(tampon)
        tampon.clear()

        def ecrire() -> int:
            vue = memoryview(donnees)
            a = 0
            while a < len(vue):
                a += os.pwrite(fd, vue[a:], position + a)
            if calcul is not None:
                calcul.update(donnees)
            return a

        return await to_thread.run_sync(ecrire)

    def regles(self) -> Regles:
        return Regles(
            rom_dir=self.settings.rom_dir,
            verrou=self.settings.imports_dir / "rangement.lock",
            budget=self.settings.imports_max,
            marge=self.settings.imports_marge,
            espace_libre=self.espace_libre,
            outils=self.outils(),
        )

    async def finir(self, ident: str, login: str) -> EnvoiVu:
        """Lance la vérification, une seule fois, et rend l'état tout de suite."""
        async with self._verrou(ident):
            envoi = await self._a(ident, login)
            if envoi.etat != "envoi":
                return vu(envoi)
            if envoi.decalage != envoi.taille:
                raise refus(
                    status.HTTP_409_CONFLICT,
                    "incomplet",
                    f"il manque {envoi.taille - envoi.decalage} octets",
                    decalage=envoi.decalage,
                )
            calcul, jusque = self._calculs.pop(ident, (None, -1))
            sha256 = calcul.hexdigest() if calcul is not None and jusque == envoi.taille else None
            envoi.etat = "verification"
            envoi.message = ""
            await to_thread.run_sync(self.quarantaine.sauver, envoi)
            self._finis[ident] = anyio.Event()
            regles = await to_thread.run_sync(self.regles)
            lance = vu(envoi)
        # Hors du verrou: le traitement le reprend pour écrire son résultat.
        if self._groupe is not None:
            self._groupe.start_soon(self._traiter, envoi, regles, sha256)
        else:
            await self._traiter(envoi, regles, sha256)
        return lance

    async def _traiter(self, envoi: Envoi, regles: Regles, sha256: str | None) -> None:
        copie = envoi.model_copy(deep=True)
        try:
            fini = await to_thread.run_sync(traiter, self.quarantaine, copie, regles, sha256)
        except (OSError, QuarantaineAbimee, ValueError) as erreur:
            fini = envoi.model_copy(deep=True)
            fini.etat = "erreur"
            fini.message = f"la vérification a échoué: {erreur}"
        async with self._verrou(envoi.id):
            (await self._registre())[envoi.id] = fini
            await to_thread.run_sync(self.quarantaine.sauver, fini)
        self._finis[envoi.id].set()

    async def attendre(self, ident: str) -> None:
        """Attend la fin d'une vérification lancée. Pour les essais et les outils."""
        if ident in self._finis:
            await self._finis[ident].wait()

    async def abandonner(self, ident: str, login: str) -> None:
        """Efface la quarantaine d'un envoi. Un jeu déjà rangé n'y est plus."""
        async with self._verrou(ident):
            envoi = await self._a(ident, login)
            if envoi.etat == "verification":
                raise refus(status.HTTP_409_CONFLICT, "etat", "attends la fin de la vérification")
            await to_thread.run_sync(self.quarantaine.supprimer, envoi)
            (await self._registre()).pop(ident, None)
            self._calculs.pop(ident, None)
