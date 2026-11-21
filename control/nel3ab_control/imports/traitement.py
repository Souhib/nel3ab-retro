"""Ce qui arrive à un envoi complet: le vérifier, le reconnaître, le ranger.

Synchrone, et lancé dans un fil par le contrôleur: l'empreinte complète d'un
jeu de 20 Gio se lit en dizaines de secondes, et le salon doit continuer de
répondre aux salles pendant ce temps.

Le serveur redétecte TOUJOURS. L'estimation de la page n'entre ici sous
aucune forme: le seul texte du navigateur qui arrive jusqu'ici est le nom
qu'il annonce, gardé pour l'affichage et comme dernier repli pour un nom.
"""

import contextlib
import hashlib
import os
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from nel3ab_control.imports import archives
from nel3ab_control.imports.destinations import CONSOLES, destination, dossiers
from nel3ab_control.imports.empreinte import empreinte_rapide, lecteur_fd
from nel3ab_control.imports.identifier import Identification, identifier
from nel3ab_control.imports.quarantaine import (
    DONNEES,
    Element,
    Envoi,
    EtatElement,
    Quarantaine,
)
from nel3ab_control.imports.rangement import Bibliotheque, Refus, nom_canonique

#: Ce que la page dit d'un jeu rangé. Le worker lit sa bibliothèque une seule
#: fois, à son démarrage (`scan_libraries`, main.rs), et un changement de jeu
#: redémarre le worker: un jeu rangé pendant une partie attend donc l'un des deux.
VISIBLE = "Visible à la prochaine ouverture de salle ou au prochain changement de jeu."


@dataclass(frozen=True)
class Decision:
    """Ce qu'on fait d'un fichier reconnu, et ce qu'on en dit."""

    etat: EtatElement
    message: str
    dossier: Path | None = None


@dataclass(frozen=True)
class Regles:
    """Ce que le traitement doit savoir de la machine, réglages compris."""

    rom_dir: str
    verrou: Path
    #: Ce qu'une archive peut écrire une fois extraite, en octets.
    budget: int
    marge: int
    espace_libre: Callable[[Path], int]
    outils: archives.Outils | None


def decider(trouve: Identification, rom_dir: str) -> Decision:
    """Ranger, garder en quarantaine, ou demander: d'après les octets seulement."""
    console = CONSOLES.get(trouve.console or "")
    if console is None:
        if trouve.format == "inconnu":
            return Decision("inconnu", "Aucune console reconnue dans ses octets.")
        return Decision(
            "inconnu", f"Format {trouve.format} reconnu, mais pas la console qu'il contient."
        )
    if console.code in ("gc", "wii"):
        if trouve.format not in console.formats:
            return Decision(
                "pas-jouable",
                f"Dolphin lit le format {trouve.format.upper()}, mais la salle ne le liste pas "
                "encore. Convertis-le en RVZ avec Dolphin, puis renvoie-le.",
            )
        if "nkit" in trouve.drapeaux:
            return Decision(
                "a-confirmer",
                "Image NKit: Dolphin la lance avec un avertissement, et certains jeux s'y "
                "arrêtent. Il manque une image complète, en ISO ou en RVZ.",
            )
        if "a-verifier" in trouve.drapeaux:
            return Decision(
                "a-confirmer",
                "Le format annonce une console et le disque en porte une autre. Il manque une "
                "image dont les deux s'accordent.",
            )
        dossier = destination(console.code, rom_dir)
        if dossier is None or not dossier.is_dir():
            return Decision(
                "a-confirmer",
                f"Le salon ne connaît pas de dossier « {console.dossier} » où ranger ce jeu "
                "(réglage NEL3AB_ROM_DIR du salon).",
            )
        return Decision("range", VISIBLE, dossier)
    if console.code == "switch":
        return _switch(trouve)
    if console.code == "switch2":
        return Decision(
            "a-confirmer",
            "Switch 2: l'identifiant de titre, qui commence par 0400, et le nom s'inscrivent "
            "à la main tant que ce moteur est expérimental.",
        )
    if console.code == "x360":
        return Decision(
            "pas-jouable", "Xbox 360 reconnue, pas encore jouable: la salle n'a pas d'adaptateur."
        )
    return Decision(
        "pas-jouable",
        f"{console.libelle} reconnue, pas encore jouable: la salle n'a pas d'émulateur pour elle.",
    )


def _switch(trouve: Identification) -> Decision:
    if trouve.format in ("nsz", "xcz"):
        return Decision(
            "pas-jouable",
            f"Le {trouve.format.upper()} est un format compressé que la salle ne lit pas encore. "
            "Décompresse-le en NSP ou en XCI, puis renvoie-le.",
        )
    contenu = trouve.details.get("contenu")
    propose = trouve.details.get("titre_propose")
    if contenu == "mise-a-jour":
        return Decision(
            "a-confirmer",
            f"C'est une mise à jour (titre {propose}), pas un jeu. Elle se range dans le dossier "
            "privé des mises à jour, à la main pour l'instant.",
        )
    if contenu == "contenu-additionnel":
        return Decision(
            "a-confirmer",
            f"C'est un contenu additionnel (titre {propose}), pas un jeu. Il s'installe avec "
            "switch-dlc.py, jeu fermé.",
        )
    manque = (
        "Il manque l'identifiant de titre vérifié. Il est écrit dans l'en-tête NCA, chiffré avec "
        "la clé d'en-tête de la console, que le salon ne lit pas. L'inscription "
        "<fichier>.nel3ab.json s'écrit donc à la main."
    )
    if propose:
        manque += f" Le nom du ticket propose {propose}, à confirmer par un lancement d'essai."
    return Decision("a-confirmer", manque)


def _sha256(fd: int) -> str:
    calcul = hashlib.sha256()
    decalage = 0
    while morceau := os.pread(fd, 1 << 20, decalage):
        calcul.update(morceau)
        decalage += len(morceau)
    return calcul.hexdigest()


def _remplir(element: Element, trouve: Identification) -> None:
    """Recopie ce que l'identifiant a lu dans l'élément montré à la page."""
    element.console = trouve.console
    element.format = trouve.format
    element.titre = trouve.titre
    element.identifiant = trouve.identifiant
    element.drapeaux = sorted(trouve.drapeaux)
    element.preuve = trouve.preuve
    element.details = dict(trouve.details)


def _placer(
    quarantaine: Quarantaine,
    envoi: Envoi,
    element: Element,
    fd: int,
    trouve: Identification,
    regles: Regles,
) -> None:
    """Décide, et range quand il le faut. Remplit `etat`, `message`, `destination`."""
    _remplir(element, trouve)
    decision = decider(trouve, regles.rom_dir)
    element.etat = decision.etat
    element.message = decision.message
    if decision.etat != "range" or decision.dossier is None:
        return
    nom = nom_canonique(
        trouve.titre,
        element.nom,
        trouve.identifiant,
        trouve.details.get("disque", ""),
        trouve.format,
    )
    jeu = (
        (trouve.identifiant, trouve.details.get("disque", ""))
        if trouve.console in ("gc", "wii") and trouve.identifiant
        else None
    )
    bibliotheque = Bibliotheque(dossiers(regles.rom_dir), regles.verrou)
    try:
        element.destination = bibliotheque.ranger(
            fd, decision.dossier, nom, sha256=element.sha256, jeu=jeu
        )
    except Refus as refus:
        element.etat = "doublon" if refus.etat == "doublon" else "refuse"
        element.message = f"{refus.message}. Le fichier reste en quarantaine."
        return
    # Rangé: le nom de quarantaine part seulement maintenant, pour qu'un échec
    # du lien laisse toujours une copie quelque part.
    quarantaine.effacer_source(envoi, element.source)
    element.source = ""


def traiter(quarantaine: Quarantaine, envoi: Envoi, regles: Regles, sha256: str | None) -> Envoi:
    """Termine un envoi complet. Rend l'envoi, état et éléments remplis.

    `sha256` est l'empreinte calculée pendant l'envoi, quand le salon ne s'est
    pas arrêté entre-temps. Sans elle, le fichier est relu en entier.
    """
    fd = quarantaine.ouvrir(envoi)
    try:
        taille = os.fstat(fd).st_size
        if taille != envoi.taille:
            envoi.etat = "erreur"
            envoi.message = f"{taille} octets reçus pour {envoi.taille} annoncés"
            return envoi
        envoi.sha256 = sha256 or _sha256(fd)
        if empreinte_rapide(lecteur_fd(fd), taille) != envoi.empreinte_rapide:
            element = Element(nom=envoi.nom, taille=taille, source=DONNEES, sha256=envoi.sha256)
            element.etat = "refuse"
            element.message = (
                "Les octets reçus ne donnent pas l'empreinte que la page avait annoncée. "
                "Le fichier reste en quarantaine."
            )
            envoi.elements = [element]
        else:
            trouve = identifier(lecteur_fd(fd), taille)
            if "archive" in trouve.drapeaux:
                envoi.elements = _archive(quarantaine, envoi, fd, trouve, regles)
            else:
                element = Element(nom=envoi.nom, taille=taille, source=DONNEES, sha256=envoi.sha256)
                _placer(quarantaine, envoi, element, fd, trouve, regles)
                envoi.elements = [element]
    finally:
        os.close(fd)
    envoi.etat = "termine"
    return envoi


def _archive(
    quarantaine: Quarantaine, envoi: Envoi, fd: int, trouve: Identification, regles: Regles
) -> list[Element]:
    """Ouvre l'archive, range chaque entrée, et retire l'archive si tout s'est ouvert."""
    tete = Element(nom=envoi.nom, taille=envoi.taille, source=DONNEES, sha256=envoi.sha256)
    _remplir(tete, trouve)
    if trouve.format != "zip" and regles.outils is None:
        tete.etat = "archive-non-prise-en-charge"
        tete.message = (
            f"Archive {trouve.format}: lsar et unar ne sont pas installés sur le serveur. "
            "Extrais-la chez toi et envoie son contenu."
        )
        return [tete]
    extraites: list[tuple[Element, int]] = []
    try:
        extraites = _extraire(quarantaine, envoi, fd, trouve.format, regles)
    except archives.ArchiveRefusee as refus:
        tete.etat = "refuse"
        tete.message = f"Archive refusée: {refus}. Elle reste en quarantaine."
        return [tete]
    elements = []
    try:
        for element, entree in extraites:
            dedans = identifier(lecteur_fd(entree), element.taille)
            if "archive" in dedans.drapeaux:
                _remplir(element, dedans)
                element.etat = "archive-non-prise-en-charge"
                element.message = "Une archive dans l'archive n'est pas ouverte."
            else:
                _placer(quarantaine, envoi, element, entree, dedans, regles)
            elements.append(element)
    finally:
        for _, entree in extraites:
            os.close(entree)
    # Tout est sorti de l'archive: elle ne sert plus, et elle pèse autant que son contenu.
    quarantaine.effacer_source(envoi, DONNEES)
    return elements


def _extraire(
    quarantaine: Quarantaine, envoi: Envoi, fd: int, format_: str, regles: Regles
) -> list[tuple[Element, int]]:
    """Chaque entrée dans son fichier de quarantaine, ou rien du tout."""
    if format_ == "zip":
        with os.fdopen(os.dup(fd), "rb") as flux:
            try:
                archive = zipfile.ZipFile(flux)
            except zipfile.BadZipFile as erreur:
                raise archives.ArchiveRefusee(f"zip illisible ({erreur})") from erreur
            with archive:
                entrees = archives.lister_zip(archive, regles.budget)
                _assez_de_place(entrees, regles, quarantaine)
                return _ecrire_entrees(
                    quarantaine, envoi, entrees, lambda e, s: archives.extraire_zip(archive, e, s)
                )
    outils = regles.outils
    if outils is None:  # écarté par l'appelant; ty ne le sait pas
        raise archives.ArchiveRefusee("outils absents")
    entrees = archives.lister_xad(outils, fd, regles.budget)
    _assez_de_place(entrees, regles, quarantaine)
    return _ecrire_entrees(
        quarantaine, envoi, entrees, lambda e, s: archives.extraire_xad(outils, fd, e, s)
    )


def _assez_de_place(
    entrees: list[archives.Entree], regles: Regles, quarantaine: Quarantaine
) -> None:
    total = sum(entree.taille for entree in entrees)
    libre = regles.espace_libre(quarantaine.racine)
    if libre - total < regles.marge:
        raise archives.ArchiveRefusee(
            f"pas assez de place pour l'extraire en gardant {regles.marge} octets libres"
        )


def _ecrire_entrees(
    quarantaine: Quarantaine,
    envoi: Envoi,
    entrees: list[archives.Entree],
    extraire: Callable[[archives.Entree, int], None],
) -> list[tuple[Element, int]]:
    faites: list[tuple[Element, int]] = []
    try:
        for rang, entree in enumerate(entrees, start=1):
            source, sortie = quarantaine.nouvelle_entree(envoi, rang)
            faites.append((Element(nom=entree.nom, taille=entree.taille, source=source), sortie))
            extraire(entree, sortie)
            faites[-1][0].sha256 = _sha256(sortie)
    except BaseException:
        # Une entrée qui ment sur sa taille rend toute l'archive suspecte: rien
        # de ce qui en est sorti ne reste.
        for element, sortie in faites:
            os.close(sortie)
            with contextlib.suppress(OSError):
                quarantaine.effacer_source(envoi, element.source)
        raise
    return faites
