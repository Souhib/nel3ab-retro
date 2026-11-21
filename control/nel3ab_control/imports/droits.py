"""Qui peut déposer un jeu.

Déposer écrit dans la bibliothèque de tout le monde, et un jeu rangé fixe pour
toujours le nom qui porte ses sauvegardes. C'est donc l'administrateur
(`Settings.is_admin`, la même règle que pour la référence de la salle), plus
les adresses écrites une à une dans `NEL3AB_IMPORTEURS`, et personne d'autre.

Une adresse VIDE de la liste ne correspond à personne: elle est filtrée, et les
deux chemins d'identité refusent déjà une adresse vide. La liste passe en
minuscules: l'identité arrive normalisée, la configuration est écrite à la main.
"""

from nel3ab_control.settings import Settings


def importeurs(settings: Settings) -> frozenset[str]:
    """Les adresses de `NEL3AB_IMPORTEURS`, normalisées, sans les vides."""
    return frozenset(adresse.strip().lower() for adresse in settings.importeurs) - {""}


def peut_importer(login: str | None, settings: Settings) -> bool:
    """Vrai pour l'administrateur et pour une adresse de la liste, seulement."""
    if not login:
        return False
    login = login.strip().lower()
    return settings.is_admin(login) or login in importeurs(settings)
