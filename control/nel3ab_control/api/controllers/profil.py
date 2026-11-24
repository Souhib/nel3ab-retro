"""Le carnet de jeu d'une personne, relu dans son journal des parties et sur le disque.

Tout ici est en lecture: le journal, les dossiers de sauvegarde et le
catalogue. Rien n'est écrit, rien n'est ouvert hors des fichiers ordinaires.

# D'une place à une partie

Le journal écrit une ligne par PLACE tenue. Une soirée sur une liaison qui
décroche en compte des dizaines, une par reconnexion, et deux onglets de la même
personne en ouvrent deux en même temps. Le carnet regroupe donc en une PARTIE
les places de suite au même jeu, dans la même salle, lancé par la même personne
dans la même sauvegarde, séparées de moins de `RECONNEXION` secondes. Le temps
d'une partie est la réunion de ses places: deux onglets ne comptent pas double.

Une place dont la fin n'a pas été vue (le salon a redémarré) n'est jamais
prolongée. Elle compte pour zéro seconde, et la partie le dit (`complete`).

# Avec qui (carnet commun, D12)

Une partie dit qui a joué avec moi et qui regardait: une place ou un regard
d'une autre personne dans la même salle, au même jeu, dont l'intervalle touche
celui d'une de mes places. Le recouvrement est strict, sauf pour une place sans
fin connue: comptée pour un instant, elle ne touche que si elle commence
PENDANT une des miennes. Rien n'est prolongé pour trouver quelqu'un.

Le nom affiché est le pseudo actuel de la personne quand elle en a choisi un,
sinon celui de sa ligne; sans l'un ni l'autre (une ligne d'avant le
24 novembre 2026), elle n'est pas nommée du tout. Aucune empreinte ne sort.
"""

from bisect import bisect_right
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from nel3ab_control.api.schemas.profil import (
    Chez,
    Compagnon,
    ConsoleVue,
    Dernier,
    Emplacement,
    JeuProfil,
    PageParties,
    Partie,
    Profil,
    ResumeSauvegarde,
    SauvegardeVue,
)
from nel3ab_control.consoles import CONSOLES
from nel3ab_control.parties import JeuJoue, Sauvegarde
from nel3ab_control.personnes import cle
from nel3ab_control.sauvegardes import Mesure, Trouvee

#: Une reconnexion plus courte que ça ne fait pas une nouvelle partie. Deux
#: minutes: un rechargement de page prend quelques secondes, un worker qui
#: redémarre pour le même jeu une dizaine; une pause pour aller chercher à boire
#: en fait plus, et c'en est une autre.
RECONNEXION = timedelta(seconds=120)


def console_vue(code: str) -> ConsoleVue:
    """La console d'après le manifeste, ou une console inconnue."""
    for rang, console in enumerate(CONSOLES.consoles):
        if console.code == code:
            media = console.media if console.media in ("disc", "cartridge", "card") else None
            return ConsoleVue(
                code=code,
                label=console.label,
                media=media,
                experimental=console.experimental,
                rang=rang,
            )
    return ConsoleVue(code="?", label="console inconnue")


@dataclass
class Place:
    """Une place du journal, avec sa fin quand elle a été vue."""

    id: str
    salle: int
    jeu: JeuJoue | None
    par: str | None
    pseudo_lanceur: str | None
    sauvegarde: Sauvegarde
    debut: datetime
    secondes: float | None = None
    en_cours: bool = False


@dataclass
class Run:
    """Une partie: des places regroupées. Voir le docstring du module."""

    #: Le jeu de la partie. Une place sur le menu n'entre dans aucune partie.
    jeu: JeuJoue
    places: list[Place] = field(default_factory=list)

    @property
    def premiere(self) -> Place:
        return self.places[0]

    def intervalles(self) -> list[tuple[datetime, datetime]]:
        return [
            (place.debut, place.debut + timedelta(seconds=place.secondes or 0.0))
            for place in self.places
        ]

    def fin_connue(self) -> datetime:
        return max(fin for _, fin in self.intervalles())

    def secondes(self) -> float:
        """La réunion des places: deux onglets en même temps ne comptent qu'une fois."""
        total = 0.0
        courant: tuple[datetime, datetime] | None = None
        for debut, fin in sorted(self.intervalles()):
            if courant is None or debut > courant[1]:
                if courant is not None:
                    total += (courant[1] - courant[0]).total_seconds()
                courant = (debut, fin)
            else:
                courant = (courant[0], max(courant[1], fin))
        if courant is not None:
            total += (courant[1] - courant[0]).total_seconds()
        return total

    def complete(self) -> bool:
        return all(place.secondes is not None for place in self.places)

    def en_cours(self) -> bool:
        return any(place.en_cours for place in self.places)


def _date(brut: object) -> datetime | None:
    if not isinstance(brut, str):
        return None
    try:
        lue = datetime.fromisoformat(brut)
    except ValueError:
        return None
    return lue if lue.tzinfo is not None else None


def places(lignes: Iterable[dict[str, Any]], ouvertes: dict[str, float]) -> list[Place]:
    """Les places du journal, appariées à leur fin par leur `id`."""
    trouvees: dict[str, Place] = {}
    fins: dict[str, float] = {}
    for ligne in lignes:
        quoi, ident = ligne.get("quoi"), ligne.get("id")
        if not isinstance(ident, str):
            continue
        if quoi == "place_debut":
            debut = _date(ligne.get("quand"))
            salle = ligne.get("salle")
            if debut is None or type(salle) is not int or ident in trouvees:
                continue
            lance = ligne.get("lance")
            par = lance.get("empreinte") if isinstance(lance, dict) else None
            pseudo = lance.get("pseudo") if isinstance(lance, dict) else None
            try:
                sauvegarde = Sauvegarde(ligne.get("sauvegarde"))
            except ValueError:
                sauvegarde = Sauvegarde.INCONNUE
            trouvees[ident] = Place(
                id=ident,
                salle=salle,
                jeu=JeuJoue.lu(ligne.get("jeu")),
                par=par if isinstance(par, str) else None,
                pseudo_lanceur=pseudo if isinstance(pseudo, str) else None,
                sauvegarde=sauvegarde,
                debut=debut,
            )
        elif quoi == "place_fin":
            secondes = ligne.get("secondes")
            if (
                isinstance(secondes, int | float)
                and not isinstance(secondes, bool)
                and secondes >= 0
            ):
                fins[ident] = float(secondes)
    for ident, place in trouvees.items():
        if ident in fins:
            place.secondes = fins[ident]
        elif ident in ouvertes:
            place.secondes = ouvertes[ident]
            place.en_cours = True
    return sorted(trouvees.values(), key=lambda place: (place.debut, place.id))


@dataclass(frozen=True)
class Presence:
    """Une place ou un regard d'une autre personne, pour le carnet commun."""

    salle: int
    jeu: str
    debut: datetime
    fin: datetime
    #: La prise tenue, ou rien pour un regard.
    place: int | None
    pseudo: str | None


def presences(lignes: Iterable[dict[str, Any]], ouvertes: dict[str, float]) -> list[Presence]:
    """Les places et les regards sur un jeu, avec leur fin connue ou leur durée en cours.

    Une présence sans fin ni durée en cours dure zéro seconde: jamais prolongée.
    Une présence sur le menu (sans jeu) ne compte pas.
    """
    debuts: dict[str, tuple[dict[str, Any], datetime]] = {}
    fins: dict[str, float] = {}
    for ligne in lignes:
        quoi, ident = ligne.get("quoi"), ligne.get("id")
        if not isinstance(ident, str):
            continue
        if quoi in ("place_debut", "regard_debut"):
            debut = _date(ligne.get("quand"))
            if debut is not None and ident not in debuts:
                debuts[ident] = (ligne, debut)
        elif quoi in ("place_fin", "regard_fin"):
            secondes = ligne.get("secondes")
            if (
                isinstance(secondes, int | float)
                and not isinstance(secondes, bool)
                and secondes >= 0
            ):
                fins[ident] = float(secondes)
    sortie: list[Presence] = []
    for ident, (ligne, debut) in debuts.items():
        salle, jeu = ligne.get("salle"), JeuJoue.lu(ligne.get("jeu"))
        if type(salle) is not int or jeu is None:
            continue
        place = ligne.get("place") if ligne.get("quoi") == "place_debut" else None
        if place is not None and (type(place) is not int or place < 1):
            continue
        pseudo = ligne.get("pseudo")
        secondes = fins.get(ident, ouvertes.get(ident, 0.0))
        sortie.append(
            Presence(
                salle=salle,
                jeu=jeu.identite(),
                debut=debut,
                fin=debut + timedelta(seconds=secondes),
                place=place,
                pseudo=pseudo if isinstance(pseudo, str) and pseudo.strip() else None,
            )
        )
    return sorted(sortie, key=lambda presence: presence.debut)


def _touche(presence: Presence, debut: datetime, fin: datetime) -> bool:
    """La présence touche-t-elle l'intervalle d'une de mes places ? Voir le docstring."""
    if presence.debut == presence.fin:
        return debut <= presence.debut < fin or presence.debut == debut
    return presence.debut < fin and debut < presence.fin


@dataclass
class Fil:
    """Les présences d'une personne dans une salle, à un jeu, par début croissant.

    `plus_tard[i]` est la fin la plus tardive des présences 0 à i: en remontant
    depuis la dernière présence commencée avant la fin d'une partie, on s'arrête
    dès qu'aucune présence plus ancienne ne peut encore la toucher.
    """

    presences: list[Presence]
    debuts: list[datetime]
    plus_tard: list[datetime]

    @staticmethod
    def de(presences: list[Presence]) -> "Fil":
        rangees = sorted(presences, key=lambda presence: presence.debut)
        plus_tard: list[datetime] = []
        for presence in rangees:
            plus_tard.append(max(plus_tard[-1], presence.fin) if plus_tard else presence.fin)
        return Fil(rangees, [presence.debut for presence in rangees], plus_tard)

    def touchant(self, intervalles: list[tuple[datetime, datetime]]) -> list[Presence]:
        debut = min(un for un, _ in intervalles)
        fin = max(autre for _, autre in intervalles)
        rang = bisect_right(self.debuts, fin) - 1
        trouvees: list[Presence] = []
        while rang >= 0 and self.plus_tard[rang] >= debut:
            presence = self.presences[rang]
            if any(_touche(presence, un, autre) for un, autre in intervalles):
                trouvees.append(presence)
            rang -= 1
        trouvees.reverse()
        return trouvees


def index(autres: dict[str, list[Presence]]) -> dict[tuple[int, str], dict[str, Fil]]:
    """Les présences des autres par salle et par jeu, puis par personne.

    Mesuré le 24 novembre 2026 sur lgf, vingt personnes de 5 000 lignes chacune
    (des années de soirées, 19,8 Mo): une page de 50 parties prenait 1,7 s en
    comparant chaque partie à chaque présence, et la lecture seule des fichiers
    0,74 s. Indexée ainsi, la même page prend 0,87 s, dont la lecture: c'est un
    plafond pour un volume que le journal (commencé le 21 novembre 2026) mettra
    des années à atteindre, sur un fil et seulement pour la liste des parties.
    """
    groupes: dict[tuple[int, str], dict[str, list[Presence]]] = {}
    for qui, siennes in autres.items():
        for presence in siennes:
            groupes.setdefault((presence.salle, presence.jeu), {}).setdefault(qui, []).append(
                presence
            )
    return {
        cle: {qui: Fil.de(siennes) for qui, siennes in parqui.items()}
        for cle, parqui in groupes.items()
    }


def entourage(
    run: "Run", autres: dict[tuple[int, str], dict[str, Fil]], noms: dict[str, str]
) -> tuple[list[Compagnon], list[str]]:
    """Qui jouait avec moi pendant cette partie, et qui regardait."""
    intervalles = run.intervalles()
    joueurs: list[tuple[int, datetime, str]] = []
    spectateurs: list[tuple[datetime, str]] = []
    for qui, fil in autres.get((run.premiere.salle, run.jeu.identite()), {}).items():
        touchees = fil.touchant(intervalles)
        if not touchees:
            continue
        nom = noms.get(qui) or next(
            (presence.pseudo for presence in reversed(touchees) if presence.pseudo), None
        )
        if nom is None:
            continue
        places = [presence for presence in touchees if presence.place is not None]
        if places and places[0].place is not None:
            joueurs.append((places[0].place, places[0].debut, nom))
        else:
            spectateurs.append((touchees[0].debut, nom))
    return (
        [Compagnon(nom=nom, place=place) for place, _, nom in sorted(joueurs)],
        [nom for _, nom in sorted(spectateurs)],
    )


def _meme_partie(run: Run, jeu: JeuJoue, place: Place) -> bool:
    premiere = run.premiere
    return (
        run.jeu.identite() == jeu.identite()
        and premiere.par == place.par
        and premiere.sauvegarde == place.sauvegarde
        and place.debut <= run.fin_connue() + RECONNEXION
    )


def parties(toutes: list[Place]) -> list[Run]:
    """Les parties, de la plus ancienne à la plus récente. Le menu n'en est pas une.

    Une place prolonge la DERNIÈRE partie de sa salle, ou en commence une: un
    autre jeu entre les deux coupe la partie, même revenu en moins de deux
    minutes. Deux salles tenues en même temps font deux parties.
    """
    runs: list[Run] = []
    derniere: dict[int, Run] = {}
    for place in toutes:
        jeu = place.jeu
        if jeu is None:
            continue
        run = derniere.get(place.salle)
        if run is not None and _meme_partie(run, jeu, place):
            run.places.append(place)
            continue
        run = Run(jeu=jeu, places=[place])
        runs.append(run)
        derniere[place.salle] = run
    return runs


def sauvegarde_vue(place: Place, moi: str) -> tuple[SauvegardeVue, str | None]:
    """Dans quelle sauvegarde, et chez qui, vu de la personne `moi`."""
    lancee_par_moi = place.par is not None and place.par == moi
    chez = None if lancee_par_moi or place.par is None else place.pseudo_lanceur
    if place.sauvegarde is Sauvegarde.LANCEUR:
        return ("mienne" if lancee_par_moi else "du_lanceur"), chez
    if place.sauvegarde is Sauvegarde.COMMUNE:
        return "commune", chez
    if place.sauvegarde is Sauvegarde.NEUVE:
        return "neuve", chez
    return "inconnue", chez


def partie_vue(
    run: Run,
    moi: str,
    autres: dict[tuple[int, str], dict[str, Fil]] | None = None,
    noms: dict[str, str] | None = None,
) -> Partie:
    premiere = run.premiere
    sauvegarde, chez = sauvegarde_vue(premiere, moi)
    en_cours = run.en_cours()
    avec, regardaient = entourage(run, autres or {}, noms or {})
    return Partie(
        id=premiere.id,
        salle=premiere.salle,
        titre=run.jeu.titre,
        console=console_vue(run.jeu.console),
        debut=premiere.debut,
        fin=None if en_cours or not run.complete() else run.fin_connue(),
        secondes=int(run.secondes()),
        complete=run.complete(),
        en_cours=en_cours,
        sauvegarde=sauvegarde,
        lance_par=chez,
        avec=avec,
        regardaient=regardaient,
    )


@dataclass(frozen=True)
class Catalogue:
    """Ce qu'on sait des jeux pour relier une sauvegarde à son titre."""

    #: Clé de dossier Dolphin -> (titre, console, clé du jeu), pour GameCube et Wii.
    dolphin: dict[str, tuple[str, str, str | None]]
    #: Identifiant de titre -> (titre, console, clé du jeu), pour les jeux inscrits.
    inscrits: dict[str, tuple[str, str, str | None]]

    @staticmethod
    def de(jeux: Iterable[JeuJoue]) -> "Catalogue":
        dolphin: dict[str, tuple[str, str, str | None]] = {}
        inscrits: dict[str, tuple[str, str, str | None]] = {}
        for jeu in jeux:
            if jeu.cle and jeu.console in ("gc", "wii"):
                dolphin[cle(jeu.cle)] = (jeu.titre, jeu.console, jeu.cle)
            if jeu.titre_id:
                inscrits[jeu.titre_id] = (jeu.titre, jeu.console, jeu.cle)
        return Catalogue(dolphin=dolphin, inscrits=inscrits)


def resume(mesure: Mesure) -> ResumeSauvegarde:
    return ResumeSauvegarde(
        derniere_ecriture=mesure.derniere_ecriture,
        octets=mesure.octets,
        versions=mesure.versions,
        copies=mesure.copies,
    )


def emplacement(trouvee: Trouvee, mesure: Mesure, catalogue: Catalogue) -> Emplacement:
    if trouvee.famille == "dolphin":
        relie = catalogue.dolphin.get(trouvee.jeu)
        titre, code, de_jeu = relie if relie else (trouvee.jeu, "?", None)
        return Emplacement(
            titre=titre,
            console=console_vue(code),
            relie=relie is not None,
            cle=de_jeu,
            sauvegarde=resume(mesure),
        )
    # Un emplacement Switch porte l'identifiant du titre; le catalogue le
    # publie pour chaque jeu inscrit. Sans lui (worker plus ancien, jeu retiré
    # de la bibliothèque), la carte garde l'identifiant, dite « pas relié ».
    inscrit = catalogue.inscrits.get(trouvee.jeu.lower())
    return Emplacement(
        titre=inscrit[0] if inscrit else trouvee.jeu.upper(),
        console=console_vue(inscrit[1] if inscrit else trouvee.famille),
        relie=inscrit is not None,
        cle=inscrit[2] if inscrit else None,
        sauvegarde=resume(mesure),
    )


class Carnet:
    """Le carnet d'une personne, assemblé une fois par demande."""

    def __init__(
        self,
        moi: str,
        lignes: list[dict[str, Any]],
        ouvertes: dict[str, float],
        sauvegardes: list[tuple[Trouvee, Mesure]],
        catalogue: Iterable[JeuJoue],
        autres: dict[str, list[dict[str, Any]]] | None = None,
        noms: dict[str, str] | None = None,
    ) -> None:
        """`autres`: les lignes des autres personnes par empreinte, la mienne exclue.

        `noms`: empreinte -> pseudo choisi. `ouvertes`: les places et regards
        encore ouverts de tout le monde, par `id`.
        """
        self._moi = moi
        self._lignes = lignes
        self._autres = index(
            {
                qui: presences(siennes, ouvertes)
                for qui, siennes in (autres or {}).items()
                if qui != moi
            }
        )
        self._noms = noms or {}
        self._places = places(lignes, ouvertes)
        self._runs = parties(self._places)
        self._sauvegardes = sauvegardes
        connus = list(catalogue)
        connus.extend(place.jeu for place in self._places if place.jeu is not None)
        connus.extend(
            jeu
            for ligne in lignes
            if ligne.get("quoi") == "lancement"
            if (jeu := JeuJoue.lu(ligne.get("jeu"))) is not None
        )
        self._catalogue = Catalogue.de(connus)

    def profil(self, pseudo: str) -> Profil:
        dates = [quand for ligne in self._lignes if (quand := _date(ligne.get("quand")))]
        dernier = self._runs[-1] if self._runs else None
        return Profil(
            pseudo=pseudo,
            depuis=min(dates) if dates else None,
            jeux=len({run.jeu.identite() for run in self._runs}),
            parties=len(self._runs),
            secondes=int(sum(run.secondes() for run in self._runs)),
            inconnues=sum(1 for run in self._runs if not run.complete()),
            sauvegardes=len(self._sauvegardes),
            dernier=Dernier(
                titre=dernier.jeu.titre,
                console=console_vue(dernier.jeu.console),
                quand=dernier.premiere.debut,
            )
            if dernier
            else None,
        )

    def parties(self, avant: str | None, limite: int) -> PageParties:
        """Les parties de la plus récente à la plus ancienne, par pages.

        `avant` est l'`id` de la dernière partie de la page précédente. Un id
        inconnu lève `KeyError`: répondre la première page à un curseur périmé
        ferait relire les mêmes parties sans fin.
        """
        recentes = list(reversed(self._runs))
        debut = 0
        if avant is not None:
            rangs = [rang for rang, run in enumerate(recentes) if run.premiere.id == avant]
            if not rangs:
                raise KeyError(avant)
            debut = rangs[0] + 1
        page = recentes[debut : debut + limite]
        suivant = page[-1].premiere.id if page and debut + limite < len(recentes) else None
        return PageParties(
            parties=[partie_vue(run, self._moi, self._autres, self._noms) for run in page],
            suivant=suivant,
        )

    def jeux(self) -> list[JeuProfil]:
        """Un jeu par identité, du plus récemment joué au plus ancien."""
        par_jeu: dict[str, list[Run]] = {}
        for run in self._runs:
            par_jeu.setdefault(run.jeu.identite(), []).append(run)
        lancements: dict[str, int] = {}
        for ligne in self._lignes:
            if ligne.get("quoi") == "lancement" and (jeu := JeuJoue.lu(ligne.get("jeu"))):
                lancements[jeu.identite()] = lancements.get(jeu.identite(), 0) + 1
        sauvegardes = {
            (trouvee.famille, trouvee.jeu): mesure for trouvee, mesure in self._sauvegardes
        }
        sortie: list[JeuProfil] = []
        for identite, runs in par_jeu.items():
            recent = runs[-1].jeu
            chez: dict[str, Chez] = {}
            communes = 0
            for run in runs:
                vue, pseudo = sauvegarde_vue(run.premiere, self._moi)
                if vue == "commune":
                    communes += 1
                if vue == "du_lanceur" and run.premiere.par is not None:
                    ancien = chez.get(run.premiere.par)
                    chez[run.premiere.par] = Chez(
                        # Le pseudo le plus récent de ce lanceur.
                        pseudo=pseudo or (ancien.pseudo if ancien else "quelqu'un"),
                        parties=(ancien.parties if ancien else 0) + 1,
                        secondes=(ancien.secondes if ancien else 0) + int(run.secondes()),
                    )
            mesure = (
                sauvegardes.get(("dolphin", cle(recent.cle)))
                if recent.cle and recent.console in ("gc", "wii")
                else None
            )
            sortie.append(
                JeuProfil(
                    titre=recent.titre,
                    console=console_vue(recent.console),
                    premiere_fois=runs[0].premiere.debut,
                    derniere_fois=runs[-1].premiere.debut,
                    secondes=int(sum(run.secondes() for run in runs)),
                    parties=len(runs),
                    lancements=lancements.get(identite, 0),
                    en_cours=any(run.en_cours() for run in runs),
                    chez=sorted(chez.values(), key=_plus_long, reverse=True),
                    communes=communes,
                    sauvegarde=resume(mesure) if mesure else None,
                )
            )
        return sorted(sortie, key=lambda jeu: jeu.derniere_fois, reverse=True)

    def emplacements(self) -> list[Emplacement]:
        trouves = [
            emplacement(trouvee, mesure, self._catalogue) for trouvee, mesure in self._sauvegardes
        ]
        return sorted(trouves, key=_plus_recent, reverse=True)


def _plus_long(un: Chez) -> int:
    """Le lanceur chez qui on a joué le plus longtemps vient en premier."""
    return un.secondes


#: Une sauvegarde encore vide se range après toutes les autres.
_JAMAIS = datetime.min.replace(tzinfo=UTC)


def _plus_recent(un: Emplacement) -> datetime:
    return un.sauvegarde.derniere_ecriture or _JAMAIS
