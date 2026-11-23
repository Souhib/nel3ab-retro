"""Un systemd de papier, partagé par les essais qui ouvrent et ferment des salles.

À part et pas dans `test_salles.py`: l'application d'essai de `conftest.py` en a
besoin aussi. Sans lui, son contrôleur des salles garde le vrai lanceur, et un
essai qui appelle `POST /api/salles` lancerait `sudo systemctl start` sur la
machine qui héberge les vraies parties.

# Aussi strict que le vrai

Il suit ce que systemd 255 fait vraiment, relu sans rien changer sur lgf le
23 novembre 2026 (`systemctl show nel3ab-worker@1`, `journalctl -u`):

- un changement de jeu fait SORTIR le worker, et `Restart=always` le relance
  après `RestartSec=2`. L'unité passe par l'état inactif, le temps d'un pas:
  « Deactivated successfully » à 07:09:06.65, `InactiveExitTimestamp` à
  07:09:06, `ActiveEnterTimestamp` à 07:09:08. Les trois horodatages repartent
  donc à chaque changement de jeu. L'ancien faux n'avait qu'un âge fixe par
  salle, et c'est pourquoi personne n'a vu que `ouverte_depuis` repartait;
- une salle fermée faute d'activité sort avec le code 42, que
  `RestartPreventExitStatus=42` empêche de relancer: l'unité finit « failed »,
  `Result=exit-code`, `ExecMainStatus=42`;
- `systemctl show -p A -p B` rend les propriétés dans SON ordre, pas dans celui
  qu'on demande (`Result`, `ExecMainStatus`, `InactiveExitTimestampMonotonic`,
  `ActiveEnterTimestampMonotonic`, `InactiveEnterTimestampMonotonic`). Avec
  `--value`, il ne reste que les valeurs, et rien ne dit laquelle est laquelle.
  Ce faux rend le même ordre, pour qu'un code qui lirait par position échoue ici.
"""

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

#: L'ordre dans lequel systemd 255 rend ces propriétés, quoi qu'on demande.
ORDRE_DE_SYSTEMD = (
    "Result",
    "ExecMainStatus",
    "InactiveExitTimestampMonotonic",
    "ActiveEnterTimestampMonotonic",
    "InactiveEnterTimestampMonotonic",
)

#: `RestartSec=2`, dans `deploy/nel3ab-worker@.service`.
RELANCE_S = 2.0

#: Ce que prend un `sudo systemctl start` ou `stop`, de chaque côté du
#: changement d'état. Une valeur d'ordre, pas une mesure: seul compte qu'elle
#: ne soit pas nulle.
APPEL_S = 0.01


class Horloge:
    """Une horloge monotone qu'un essai fait avancer, partagée avec le contrôleur."""

    def __init__(self, maintenant: float = 3600.0) -> None:
        self.maintenant = maintenant

    def __call__(self) -> float:
        return self.maintenant

    def avancer(self, secondes: float) -> None:
        self.maintenant += secondes


@dataclass
class Unite:
    """Ce que systemd retient d'une unité, en microsecondes d'horloge monotone."""

    etat: str = "inactive"
    resultat: str = "success"
    statut: int = 0
    entree_active: int = 0
    sortie_inactive: int = 0
    entree_inactive: int = 0


class FauxSysteme:
    """Un systemd de papier: il note ce qu'on lui demande et répond comme le vrai."""

    def __init__(
        self,
        allumees: Sequence[int] = (),
        refuse: bool = False,
        relancees: Sequence[int] = (),
        depuis: Mapping[int, float] | None = None,
        horloge: Callable[[], float] = time.monotonic,
    ) -> None:
        #: La MÊME horloge que celle du contrôleur, jamais la vraie. Voir
        #: `HORLOGE` dans `test_salles.py`.
        self.horloge = horloge
        self.refuse = refuse
        self.unites: dict[int, Unite] = {}
        for numero in allumees:
            # Une salle allumée sans âge connu répond comme une unité dont
            # systemd n'a aucun horodatage: c'est le cas que `_depuis` doit
            # taire au lieu d'écrire « 0 seconde ».
            age = (depuis or {}).get(numero)
            debut = self._us(self.horloge() - age) if age is not None else 0
            self.unites[numero] = Unite(etat="active", entree_active=debut, sortie_inactive=debut)
        #: Les salles que systemd est en train de relancer: le worker est sorti
        #: (un changement de jeu, un plantage) et `RestartSec` court encore.
        #: `systemctl is-active` dit alors « activating », avec le code 3, comme
        #: pour une unité arrêtée: seul le mot les distingue.
        for numero in relancees:
            self.unites[numero] = Unite(etat="activating")
        self.commandes: list[list[str]] = []

    @property
    def allumees(self) -> frozenset[int]:
        """Les salles actives, en lecture: on les change par `demarrer` et `arreter`."""
        return frozenset(n for n, u in self.unites.items() if u.etat == "active")

    @staticmethod
    def _us(secondes: float) -> int:
        return int(secondes * 1_000_000)

    def unite(self, numero: int) -> Unite:
        return self.unites.setdefault(numero, Unite())

    def demarrer(self, numero: int) -> None:
        """Ce que fait `systemctl start`: l'unité quitte l'inactif et devient active."""
        maintenant = self._us(self.horloge())
        unite = self.unite(numero)
        unite.etat, unite.resultat, unite.statut = "active", "success", 0
        unite.sortie_inactive = unite.entree_active = maintenant

    def arreter(self, numero: int) -> None:
        """Ce que fait `systemctl stop`: SIGTERM, sortie propre, unité inactive."""
        unite = self.unite(numero)
        unite.etat, unite.resultat, unite.statut = "inactive", "success", 0
        unite.entree_inactive = self._us(self.horloge())

    def relancer(self, numero: int) -> None:
        """Un changement de jeu: le worker sort, systemd le relance deux secondes après.

        L'unité traverse l'inactif d'un seul pas (entrée et sortie au même
        instant), attend `RestartSec` en « activating », puis redevient active.
        L'horloge avance de ces deux secondes.
        """
        unite = self.unite(numero)
        maintenant = self._us(self.horloge())
        unite.entree_inactive = unite.sortie_inactive = maintenant
        unite.etat = "activating"
        self._attendre(RELANCE_S)
        unite.etat = "active"
        unite.entree_active = self._us(self.horloge())

    def fermer_seule(self, numero: int, statut: int = 42) -> None:
        """La salle se ferme d'elle-même: 42 pour l'inactivité, autre chose pour une panne.

        `RestartPreventExitStatus=42` laisse l'unité « failed »; une autre sortie
        relancerait le worker, sauf quand systemd renonce (`start-limit-hit`).
        """
        unite = self.unite(numero)
        unite.etat = "failed"
        unite.resultat = "exit-code" if statut == 42 else "start-limit-hit"
        unite.statut = statut
        unite.entree_inactive = self._us(self.horloge())

    async def __call__(self, commande: Sequence[str]) -> tuple[int, str]:
        self.commandes.append(list(commande))
        numero = int(commande[-1].split("@")[1])
        unite = self.unite(numero)
        if "is-active" in commande:
            if unite.etat == "active":
                return 0, "active"
            return 3, unite.etat
        if "show" in commande:
            return 0, self._show(unite, commande)
        if self.refuse:
            return 1, "Unit not found."
        # Un appel à systemd prend du temps, et l'unité change d'état PENDANT
        # l'appel: un repère posé avant `start` est plus ancien que la sortie de
        # l'inactif, un repère posé après est plus récent. Un faux instantané
        # rendait les deux ordres équivalents, et laissait passer l'erreur.
        self._attendre(APPEL_S)
        if "start" in commande:
            self.demarrer(numero)
        else:
            self.arreter(numero)
        self._attendre(APPEL_S)
        return 0, ""

    def _attendre(self, secondes: float) -> None:
        avancer = getattr(self.horloge, "avancer", None)
        if avancer is not None:
            avancer(secondes)

    @staticmethod
    def _show(unite: Unite, commande: Sequence[str]) -> str:
        demandees = {commande[i + 1] for i, mot in enumerate(commande) if mot == "-p"}
        valeurs = {
            "Result": unite.resultat,
            "ExecMainStatus": str(unite.statut),
            "InactiveExitTimestampMonotonic": str(unite.sortie_inactive),
            "ActiveEnterTimestampMonotonic": str(unite.entree_active),
            "InactiveEnterTimestampMonotonic": str(unite.entree_inactive),
        }
        lignes = [
            valeurs[nom] if "--value" in commande else f"{nom}={valeurs[nom]}"
            for nom in ORDRE_DE_SYSTEMD
            if nom in demandees
        ]
        return "\n".join(lignes)
