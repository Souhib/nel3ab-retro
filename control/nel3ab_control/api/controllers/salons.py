"""Un contrôleur par salle, et l'adresse qui va avec.

Le salon n'en connaissait qu'une, par une adresse écrite dans son unité. Le
12 septembre 2026, cette adresse est restée sur l'ancienne salle unique après la
bascule: le salon rendait 503 sur toute la salle, donc plus de places, plus de
noms, plus d'annonce de démarrage. Une adresse écrite à la main pour une salle
parmi trois est une erreur qui attend son heure.

Ici, l'adresse se DÉDUIT du numéro, comme les ports du modèle d'unité et comme
le routage du proxy. Il n'y a plus qu'un seul endroit où le savoir.

Chaque salle garde son contrôleur: il tient ses places, ses reçus et sa dernière
bibliothèque, qui ne veulent rien dire pour la salle d'à côté.
"""

import httpx

from nel3ab_control.api.controllers.rooms import RoomController
from nel3ab_control.api.controllers.salles import SALLES, SalleInconnue, adresse, controle
from nel3ab_control.settings import Settings


class Salons:
    """Les contrôleurs de salle, un par numéro, créés au premier besoin."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._par_numero: dict[int, RoomController] = {}

    def pour(self, numero: int) -> RoomController:
        """Le contrôleur de cette salle.

        Le MÊME à chaque appel, et c'est tout l'intérêt: un contrôleur neuf
        oublierait qui tient quelle manette, donc chaque page en ferait repartir
        les places de zéro.
        """
        if numero not in SALLES:
            raise SalleInconnue(numero)
        if numero not in self._par_numero:
            self._par_numero[numero] = RoomController(self._reglages(numero), self._client)
        return self._par_numero[numero]

    def poser(self, numero: int, controleur: RoomController) -> None:
        """Utilise CE contrôleur pour cette salle.

        Existe pour les essais, qui montent un worker de papier et doivent que
        le salon parle au leur: sans ce point d'entrée, ils posaient leur
        contrôleur à côté du registre, le salon en fabriquait un autre, et les
        deux regardaient des salles différentes sans que rien ne le dise. C'est
        exactement la panne qu'on vient de corriger, en plus discret.
        """
        if numero not in SALLES:
            raise SalleInconnue(numero)
        self._par_numero[numero] = controleur

    def _reglages(self, numero: int) -> Settings:
        """Les réglages du salon, pointés sur CETTE salle."""
        return self._settings.model_copy(
            update={"worker_url": adresse(numero), "worker_control": controle(numero)}
        )

    def eveilles(self) -> list[tuple[int, RoomController]]:
        """Les salles dont quelqu'un s'est déjà occupé, par numéro croissant.

        Seulement celles-là: fabriquer un contrôleur pour une salle que personne
        n'a ouverte ferait interroger un worker qui n'existe pas, une fois par
        seconde, pour rien.
        """
        return sorted(self._par_numero.items())
