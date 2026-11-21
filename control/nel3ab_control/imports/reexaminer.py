"""Réexamine un envoi resté en quarantaine, avec les règles d'aujourd'hui.

Un jeu peut attendre en quarantaine parce que sa console n'était pas encore
jouable, ou parce que le dossier de la salle manquait. Le 21 novembre 2026,
Sonic the Hedgehog (Xbox 360) y attendait depuis 15 h 25, et la Xbox 360 est
devenue jouable le soir même. Le renvoyer aurait coûté dix-huit minutes de
transfert pour des octets déjà là, vérifiés par leur empreinte.

Le réexamen refait exactement le traitement d'un envoi terminé, sur le même
fichier, avec les règles du salon lues maintenant. Il ne touche qu'un envoi
d'un seul fichier, encore en quarantaine, que le premier examen n'a pas rangé.

    uv run python -m nel3ab_control.imports.reexaminer <identifiant>

Le salon qui tourne garde son ancienne vue de l'envoi jusqu'à son redémarrage;
la bibliothèque, elle, est protégée par le même verrou de rangement.
"""

from __future__ import annotations

import sys

from nel3ab_control.imports.quarantaine import DONNEES, Envoi, Quarantaine
from nel3ab_control.imports.traitement import Regles, traiter

#: Ce qu'un nouvel examen peut changer: une console devenue jouable, un dossier
#: ajouté, une identification améliorée. Un jeu rangé, refusé ou en doublon reste
#: ce qu'il est.
REEXAMINABLES = frozenset({"pas-jouable", "a-confirmer", "inconnu"})


def reexaminer(quarantaine: Quarantaine, envoi: Envoi, regles: Regles) -> Envoi:
    """Refait le traitement d'un envoi terminé, ou refuse en disant pourquoi."""
    if envoi.etat != "termine":
        raise ValueError(f"l'envoi est « {envoi.etat} », pas terminé")
    if len(envoi.elements) != 1:
        raise ValueError("seul un envoi d'un seul fichier se réexamine")
    [element] = envoi.elements
    if element.source != DONNEES:
        raise ValueError("le fichier n'est plus en quarantaine")
    if element.etat not in REEXAMINABLES:
        raise ValueError(f"un élément « {element.etat} » ne se réexamine pas")
    return traiter(quarantaine, envoi.model_copy(deep=True), regles, envoi.sha256 or None)


def main(argv: list[str]) -> int:
    from nel3ab_control.api.controllers.imports import ImportsController
    from nel3ab_control.settings import Settings

    if len(argv) != 1:
        sys.stderr.write("usage: python -m nel3ab_control.imports.reexaminer <identifiant>\n")
        return 2
    controleur = ImportsController(Settings())
    envois = {envoi.id: envoi for envoi in controleur.quarantaine.charger()}
    envoi = envois.get(argv[0])
    if envoi is None:
        sys.stderr.write(f"aucun envoi {argv[0]} en quarantaine\n")
        return 1
    try:
        fini = reexaminer(controleur.quarantaine, envoi, controleur.regles())
    except ValueError as erreur:
        sys.stderr.write(f"refusé: {erreur}\n")
        return 1
    controleur.quarantaine.sauver(fini)
    for element in fini.elements:
        sys.stdout.write(f"{element.etat}: {element.destination or element.message}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
