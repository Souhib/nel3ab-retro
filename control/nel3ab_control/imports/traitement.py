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
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

from nel3ab_control.imports import archives
from nel3ab_control.imports.destinations import EXTENSIONS, console, destination, dossiers
from nel3ab_control.imports.empreinte import empreinte_rapide, lecteur_fd
from nel3ab_control.imports.identifier import Identification, identifier
from nel3ab_control.imports.quarantaine import (
    DONNEES,
    Element,
    Envoi,
    EtatElement,
    Quarantaine,
)
from nel3ab_control.imports.rangement import (
    Bibliotheque,
    Inscrit,
    Refus,
    fiche_switch,
    fiche_xbox360,
    nom_canonique,
    nom_switch,
    nom_xbox360,
)
from nel3ab_control.imports.switch_nca import (
    CleEntete,
    Contenu,
    Illisible,
    Incertain,
    Lecture,
    SansCle,
    lire_contenu,
)

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
    #: La clé d'en-tête de la Switch, ou pourquoi on ne l'a pas. Sans elle, un
    #: NSP ou un XCI reste « à confirmer ».
    cle_switch: CleEntete | SansCle
    #: Les noms de jeux du catalogue des salles, refusés comme noms nouveaux.
    connus: frozenset[str] = frozenset()
    #: Du même catalogue: titre Switch inscrit, en minuscules, et son fichier.
    titres_connus: Mapping[str, str] = field(default_factory=dict)


def decider(
    trouve: Identification,
    rom_dir: str,
    switch: Lecture | None = None,
    inscrits: Mapping[str, Inscrit] | None = None,
) -> Decision:
    """Ranger, garder en quarantaine, ou demander: d'après les octets seulement.

    Ce qui décide vient du manifeste des consoles: « jouable », la façon dont
    un jeu s'inscrit, les formats listés et le nom du dossier. Pour un NSP ou
    un XCI, `switch` est ce que les en-têtes NCA ont dit, et `inscrits` les
    titres que la bibliothèque inscrit déjà, pour nommer le jeu d'une mise à jour.
    """
    trouvee = console(trouve.console)
    if trouvee is None:
        if trouve.format == "inconnu":
            return Decision("inconnu", "Aucune console reconnue dans ses octets.")
        return Decision(
            "inconnu", f"Format {trouve.format} reconnu, mais pas la console qu'il contient."
        )
    if not trouvee.jouable:
        manque = "d'adaptateur" if trouvee.dossier else "d'émulateur pour elle"
        return Decision(
            "pas-jouable",
            f"{trouvee.libelle} reconnue, pas encore jouable: la salle n'a pas {manque}.",
        )
    if trouvee.inscription == "sidecar":
        if trouvee.code == "switch":
            return _switch(trouve, rom_dir, switch, inscrits or {})
        if trouvee.code == "x360":
            return _xbox360(trouve, rom_dir)
        return Decision(
            "a-confirmer",
            f"{trouvee.libelle}: l'identifiant de titre et le nom s'inscrivent à la main "
            "(<fichier>.nel3ab.json), tant que ce moteur est expérimental.",
        )
    if trouvee.inscription != "dolphin-header":
        return Decision(
            "a-confirmer", f"La salle ne sait pas encore inscrire un jeu {trouvee.libelle}."
        )
    if trouve.format not in trouvee.formats:
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
    dossier = destination(trouvee.code, rom_dir)
    if dossier is None or not dossier.is_dir():
        return Decision(
            "a-confirmer",
            f"Le salon ne connaît pas de dossier « {trouvee.dossier} » où ranger ce jeu "
            "(réglage NEL3AB_ROM_DIR du salon).",
        )
    return Decision("range", VISIBLE, dossier)


def _xbox360(trouve: Identification, rom_dir: str) -> Decision:
    """Un disque entier dont le titre se lit: le ranger avec sa fiche."""
    if trouve.format != "xiso":
        pourquoi = {
            "xex": "Un default.xex seul n'a pas le reste de son jeu",
            "god": "Un jeu Games on Demand tient en plusieurs fichiers, que l'envoi ne garde pas "
            "ensemble",
            "stfs": "Un paquet Xbox Live (démo, extension, jeu Arcade) n'est pas un disque",
        }.get(trouve.format, f"Le format {trouve.format} n'est pas un disque")
        return Decision(
            "pas-jouable",
            f"{pourquoi}: la salle Xbox 360 lance une image de disque entière (ISO).",
        )
    if "a-verifier" in trouve.drapeaux or not trouve.identifiant:
        return Decision(
            "a-confirmer",
            "Disque Xbox 360 reconnu, mais le titre de son default.xex ne se lit pas. "
            "L'inscription <fichier>.nel3ab.json s'écrit donc à la main.",
        )
    dossier = destination("x360", rom_dir)
    if dossier is None or not dossier.is_dir():
        return Decision(
            "a-confirmer",
            "Le salon ne connaît pas de dossier « xbox360 » où ranger ce jeu "
            "(réglage NEL3AB_ROM_DIR du salon).",
        )
    return Decision("range", VISIBLE, dossier)


def _switch(
    trouve: Identification, rom_dir: str, lu: Lecture | None, inscrits: Mapping[str, Inscrit]
) -> Decision:
    if trouve.format in ("nsz", "xcz"):
        return Decision(
            "pas-jouable",
            f"Le {trouve.format.upper()} est un format compressé que la salle ne lit pas encore. "
            "Décompresse-le en NSP ou en XCI, puis renvoie-le.",
        )
    if lu is None or isinstance(lu, SansCle):
        raison = lu.raison if lu is not None else "les en-têtes NCA n'ont pas été lus"
        return _switch_sans_cle(trouve, raison)
    if isinstance(lu, Illisible):
        return Decision(
            "refuse",
            f"Les en-têtes NCA ne se lisent pas: {lu.raison}. Rien n'est inscrit, et le "
            "fichier reste en quarantaine.",
        )
    if isinstance(lu, Incertain):
        return Decision(
            "a-confirmer",
            f"Les en-têtes NCA se lisent, mais {lu.raison}. L'inscription "
            "<fichier>.nel3ab.json s'écrit donc à la main.",
        )
    return _switch_lu(lu, rom_dir, inscrits)


def _switch_lu(lu: Contenu, rom_dir: str, inscrits: Mapping[str, Inscrit]) -> Decision:
    """Un contenu dont les en-têtes ont été lus: le ranger, ou dire à quel jeu il va."""
    base = f"{lu.base:016X}"
    titre = f"{lu.titre:016X}"
    inscrit = inscrits.get(base.lower())
    jeu = (
        f"de « {inscrit.nom or inscrit.jeu.nom} » ({base})"
        if inscrit
        else f"du jeu {base}, absent de la bibliothèque"
    )
    if lu.sorte == "mise-a-jour":
        return Decision(
            "mise-a-jour",
            f"Mise à jour {jeu}, titre {titre}: pas un jeu. La salle Switch lit une mise à "
            "jour dans son dossier privé des mises à jour, choisie pour chaque jeu dans ses "
            "deux emplacements (voir « Switch dans la salle »). Cet import ne l'installe "
            "pas: elle reste en quarantaine.",
        )
    if lu.sorte == "contenu-additionnel":
        return Decision(
            "contenu-additionnel",
            f"Contenu additionnel {jeu}, titre {titre}: pas un jeu. Il se range dans un "
            "dossier du dossier privé des mises à jour, puis switch-dlc.py l'inscrit pour son "
            "jeu, salle fermée (voir « Switch dans la salle »). Cet import ne l'installe "
            "pas: il reste en quarantaine.",
        )
    dossier = destination("switch", rom_dir)
    if dossier is None or not dossier.is_dir():
        return Decision(
            "a-confirmer",
            "Le salon ne connaît pas de dossier « switch » où ranger ce jeu "
            "(réglage NEL3AB_ROM_DIR du salon).",
        )
    return Decision("range", VISIBLE, dossier)


def _switch_sans_cle(trouve: Identification, raison: str) -> Decision:
    """Sans clé d'en-tête: ce que dit le nom du ticket, présenté comme une proposition."""
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
        f"la clé d'en-tête de la console, et le salon ne l'a pas: {raison}. L'inscription "
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


def _remplir_switch(element: Element, lu: Contenu, inscrits: Mapping[str, Inscrit]) -> None:
    """Ce que les en-têtes NCA ont prouvé, par-dessus la proposition du ticket."""
    element.identifiant = f"{lu.titre:016X}"
    element.details["contenu"] = lu.sorte
    element.details["titre_verifie"] = f"{lu.titre:016X}"
    element.details["jeu_de_base"] = f"{lu.base:016X}"
    element.details["generation_cle"] = str(lu.generation)
    element.preuve += (
        f", puis {len(lu.parties)} en-têtes NCA déchiffrés: partie Meta du titre {lu.titre:016X}"
    )
    if lu.sorte == "jeu":
        # Le nom du fichier, et pas un titre lu: celui du jeu est dans sa
        # partie Control, chiffrée avec une autre clé (voir `nom_switch`).
        element.titre = nom_switch(element.nom, lu.titre)
    elif inscrit := inscrits.get(f"{lu.base:016x}"):
        element.titre = inscrit.nom or inscrit.jeu.nom


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
    bibliotheque = Bibliotheque(
        dossiers(regles.rom_dir), regles.verrou, regles.connus, regles.titres_connus
    )
    switch = None
    inscrits: dict[str, Inscrit] = {}
    if trouve.console == "switch" and trouve.format in ("nsp", "xci"):
        taille = os.fstat(fd).st_size
        switch = lire_contenu(lecteur_fd(fd), taille, trouve.format, regles.cle_switch)
        if isinstance(switch, Contenu):
            inscrits = bibliotheque.inscrits()
            _remplir_switch(element, switch, inscrits)
    decision = decider(trouve, regles.rom_dir, switch, inscrits)
    element.etat = decision.etat
    element.message = decision.message
    if decision.etat != "range" or decision.dossier is None:
        return
    fiche = None
    if isinstance(switch, Contenu):
        nom = element.titre + EXTENSIONS[trouve.format]
        fiche = fiche_switch(element.titre, switch.titre)
    elif trouve.console == "x360":
        titre = nom_xbox360(element.nom, trouve.identifiant)
        nom = titre + EXTENSIONS[trouve.format]
        fiche = fiche_xbox360(titre, trouve.identifiant)
    else:
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
    try:
        element.destination = bibliotheque.ranger(
            fd, decision.dossier, nom, sha256=element.sha256, jeu=jeu, fiche=fiche
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
