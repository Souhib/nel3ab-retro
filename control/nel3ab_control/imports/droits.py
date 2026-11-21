"""Qui peut déposer un jeu.

Déposer écrit dans la bibliothèque de tout le monde, et un jeu rangé fixe pour
toujours le nom qui porte ses sauvegardes. C'est donc l'administrateur
(`NEL3AB_ADMIN`), plus les adresses écrites une à une dans `NEL3AB_IMPORTEURS`,
et personne d'autre. Une adresse VIDE ne correspond à personne: les deux
chemins d'identité refusent déjà une adresse vide, et la liste est filtrée.

Les deux côtés passent en minuscules, comme pour la référence de la salle
(`rooms.py`): l'identité arrive normalisée, la configuration non.
"""

from nel3ab_control.settings import Settings


def admis(settings: Settings) -> frozenset[str]:
    """Les adresses qui peuvent importer, normalisées, sans les vides."""
    toutes = (settings.admin, *settings.importeurs)
    return frozenset(adresse.strip().lower() for adresse in toutes) - {""}


def peut_importer(login: str | None, settings: Settings) -> bool:
    """Vrai seulement pour une adresse de la liste."""
    if not login:
        return False
    return login.strip().lower() in admis(settings)
