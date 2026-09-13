"""Les pseudos, et qui est là.

Deux états qui n'ont pas la même durée de vie, et c'est pour ça qu'ils sont
rangés différemment.

Un **pseudo** appartient à quelqu'un et doit lui survivre: à un redémarrage du
service, à un changement de navigateur, à une machine différente. Il est donc
écrit dans un fichier, indexé par l'adresse que le proxy garantit.

La **présence** meurt avec le processus, et c'est correct: personne n'est encore
dans une salle qui vient de redémarrer. Elle reste en mémoire, comme les places.
"""

import json
from pathlib import Path

from anyio import Lock, to_thread

from nel3ab_control.identity import suggested_name


class PeopleController:
    """Qui s'appelle comment, et qui est connecté en ce moment."""

    def __init__(self, store: Path) -> None:
        self._store = store
        # La mutation et sa copie disque partagent ce verrou. Un nom temporaire
        # unique seul laisserait encore deux instantanés se remplacer à rebours.
        self._writing = Lock()
        self._names: dict[str, str] = _read(store)
        #: Une entrée par socket, pas par personne: la même personne peut ouvrir
        #: deux onglets, et fermer l'un ne la fait pas disparaître de l'autre.
        #: On garde le nom RÉSOLU à la connexion, et pas seulement l'adresse: le
        #: recalculer perdait le nom affiché par le fournisseur d'identité, et
        #: quelqu'un sans identité du tout n'a pas de nom à recalculer.
        #: La troisième valeur est le NUMÉRO DE SALLE. Sans elle, les présents
        #: d'une salle apparaissaient dans toutes les autres: trois salles
        #: tournant ensemble se seraient montré mutuellement leurs joueurs, et
        #: le chef de l'une aurait pu être désigné par la présence d'un autre.
        self._present: dict[str, tuple[str | None, str, int]] = {}
        self._owner: str | None = None

    def name_for(self, login: str | None, display: str = "") -> str:
        """Le pseudo choisi, ou celui qu'on propose faute de mieux."""
        if login is None:
            return ""
        return self._names.get(login) or suggested_name(login, display)

    async def rename(self, login: str, name: str) -> str:
        """Change le pseudo de quelqu'un, et le garde.

        La LONGUEUR est le contrat du schéma, pas d'ici: la répéter donnerait
        deux limites à garder d'accord, et c'est le genre de paire qui finit par
        diverger. Ce qui reste ici est ce que le schéma ne peut pas voir, à
        savoir qu'un nom fait d'espaces n'est pas un nom.
        """
        kept = name.strip()
        if not kept:
            raise ValueError("un pseudo vide n'est pas un pseudo")
        async with self._writing:
            self._names[login] = kept
            # Sur un fil, pas sur la boucle: l'écriture est minuscule et rare, mais
            # une écriture disque sur la boucle bloque tout le monde, y compris le
            # salon qui diffuse.
            await to_thread.run_sync(_write, self._store, dict(self._names))
        return kept

    def arrived(self, sid: str, login: str | None, name: str, salle: int = 1) -> None:
        self._present[sid] = (login, name, salle)

    def renamed(self, sid: str, name: str) -> dict[str, tuple[int, str]]:
        """Le nouveau pseudo, sur CHAQUE socket de la personne qui en change.

        Pas seulement sur celle qui l'annonce. Le pseudo est rangé sous le login,
        donc deux onglets ou deux appareils de la même adresse portent le même.
        Le 13 septembre 2026, un pseudo rendu depuis un deuxième appareil laissait
        l'ancien sur le premier, et `present` garde la PREMIÈRE socket d'une
        personne: le salon a affiché « SouhibMarie-Alexandra » une heure après
        que le fichier disait « Souhib ».

        Sans login, la socket seule: deux anonymes ne sont pas une personne.

        Rend les sockets dont le nom a changé, avec leur salle et l'ancien nom,
        pour que l'appelant fasse suivre les places et le journal.
        """
        if sid not in self._present:
            return {}
        login = self._present[sid][0]
        changed: dict[str, tuple[int, str]] = {}
        for other, (who, was, salle) in self._present.items():
            if (other == sid or (login is not None and who == login)) and was != name:
                changed[other] = (salle, was)
        for other, (salle, _) in changed.items():
            self._present[other] = (self._present[other][0], name, salle)
        return changed

    def live(self, salle: int | None = None) -> set[str]:
        """Les sockets encore là.

        Rendu à la salle pour qu'elle rende les places de celles qui sont
        parties. La présence est tenue ICI, donc la question se pose ici; en
        garder une seconde copie ailleurs ferait deux vérités à tenir d'accord.
        """
        if salle is None:
            return set(self._present)
        return {sid for sid, (_, _, ou) in self._present.items() if ou == salle}

    def left(self, sid: str) -> None:
        self._present.pop(sid, None)
        self.owner()

    def owner(self, salle: int | None = None) -> tuple[str, str] | None:
        """Le chef choisi, sinon la première identité encore connectée.

        Le 6 septembre, un onglet spectateur oublié gardait ce rôle indéfiniment.
        Une reprise confirmée change désormais la personne choisie. L'ancien
        chef ne repasse pas devant en ouvrant un autre onglet. Sans identité,
        la règle du worker reste celle de la manette tenue.
        """
        ici = self._dans(salle)
        for login, name in ici:
            if login is not None and login == self._owner:
                return login, name
        for login, name in ici:
            if login is not None:
                self._owner = login
                return login, name
        self._owner = None
        return None

    def transfer_owner(self, expected: str, wanted: str) -> bool:
        """Une réponse ancienne ne remplace ni un nouveau chef ni un absent."""
        current = self.owner()
        if current is None or current[0] != expected:
            return False
        if not any(login == wanted for login, _ in self._dans(None)):
            return False
        self._owner = wanted
        return True

    def sessions(self, salle: int | None = None) -> dict[str, list[str]]:
        """Les sockets de chaque personne, par identité.

        Une personne peut en avoir plusieurs: deux onglets, ou deux machines.
        C'est ce qui permet de dire « cette personne tient la manette 2 » sans
        confondre ses appareils entre eux.
        """
        found: dict[str, list[str]] = {}
        for sid, (login, name, ou) in self._present.items():
            if salle is not None and ou != salle:
                continue
            found.setdefault(login or name, []).append(sid)
        return found

    def present(self, salle: int | None = None) -> list[tuple[str | None, str]]:
        """Qui est là, une fois par personne et non une fois par onglet.

        Deux onglets de la même adresse sont une personne. Quelqu'un sans
        identité (développement local, aucun proxy devant) compte pour un chacun,
        faute de pouvoir les distinguer autrement.
        """
        seen: dict[str, tuple[str | None, str]] = {}
        for sid, (login, name, ou) in self._present.items():
            if salle is not None and ou != salle:
                continue
            seen.setdefault(login or name or f"anonyme:{sid}", (login, name))
        return list(seen.values())

    def _dans(self, salle: int | None) -> list[tuple[str | None, str]]:
        """Les présents d'une salle, ou de toutes quand aucune n'est nommée."""
        return [
            (login, name)
            for login, name, ou in self._present.values()
            if salle is None or ou == salle
        ]


def _read(store: Path) -> dict[str, str]:
    """Les pseudos connus. Un fichier illisible est un fichier qu'on remplace.

    Pas une erreur de démarrage: personne ne doit se retrouver sans salle parce
    qu'un fichier de pseudos a été tronqué par une coupure de courant.
    """
    try:
        found = json.loads(store.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(found, dict):
        return {}
    return {
        str(login): str(name)
        for login, name in found.items()
        if isinstance(login, str) and isinstance(name, str)
    }


def _write(store: Path, names: dict[str, str]) -> None:
    """Écrit puis renomme: un fichier à moitié écrit n'existe jamais.

    Une coupure au mauvais moment laisserait sinon un JSON tronqué, que la
    lecture ci-dessus jetterait, et tout le monde perdrait son pseudo.
    """
    try:
        store.parent.mkdir(parents=True, exist_ok=True)
        temporary = store.with_suffix(".tmp")
        temporary.write_text(json.dumps(names, ensure_ascii=False, indent=2), encoding="utf-8")
        # La version d'avant est gardée à côté avant d'être remplacée.
        # Le renommage protège d'une coupure; il ne protège pas d'une bêtise de
        # notre part. Écrire un dictionnaire vide serait atomique et perdrait
        # quand même tous les pseudos, et ce fichier est le seul état du projet
        # qui n'existe qu'en un exemplaire. Une copie coûte trente-sept octets.
        if store.exists():
            store.replace(store.with_suffix(".json.bak"))
        temporary.replace(store)
    except OSError:
        # Un disque plein ou un dossier en lecture seule ne doit pas casser une
        # partie. Le pseudo vaut alors pour cette session.
        pass
