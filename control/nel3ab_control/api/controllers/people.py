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
        self._present: dict[str, tuple[str | None, str]] = {}
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

    def arrived(self, sid: str, login: str | None, name: str) -> None:
        self._present[sid] = (login, name)

    def renamed(self, sid: str, name: str) -> None:
        """Le nouveau pseudo, sur la socket qui vient d'en changer."""
        if sid in self._present:
            self._present[sid] = (self._present[sid][0], name)

    def live(self) -> set[str]:
        """Les sockets encore là.

        Rendu à la salle pour qu'elle rende les places de celles qui sont
        parties. La présence est tenue ICI, donc la question se pose ici; en
        garder une seconde copie ailleurs ferait deux vérités à tenir d'accord.
        """
        return set(self._present)

    def left(self, sid: str) -> None:
        self._present.pop(sid, None)
        self.owner()

    def owner(self) -> tuple[str, str] | None:
        """Le chef choisi, sinon la première identité encore connectée.

        Le 6 septembre, un onglet spectateur oublié gardait ce rôle indéfiniment.
        Une reprise confirmée change désormais la personne choisie. L'ancien
        chef ne repasse pas devant en ouvrant un autre onglet. Sans identité,
        la règle du worker reste celle de la manette tenue.
        """
        for login, name in self._present.values():
            if login is not None and login == self._owner:
                return login, name
        for login, name in self._present.values():
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
        if not any(login == wanted for login, _ in self._present.values()):
            return False
        self._owner = wanted
        return True

    def sessions(self) -> dict[str, list[str]]:
        """Les sockets de chaque personne, par identité.

        Une personne peut en avoir plusieurs: deux onglets, ou deux machines.
        C'est ce qui permet de dire « cette personne tient la manette 2 » sans
        confondre ses appareils entre eux.
        """
        found: dict[str, list[str]] = {}
        for sid, (login, name) in self._present.items():
            found.setdefault(login or name, []).append(sid)
        return found

    def present(self) -> list[tuple[str | None, str]]:
        """Qui est là, une fois par personne et non une fois par onglet.

        Deux onglets de la même adresse sont une personne. Quelqu'un sans
        identité (développement local, aucun proxy devant) compte pour un chacun,
        faute de pouvoir les distinguer autrement.
        """
        seen: dict[str, tuple[str | None, str]] = {}
        for sid, (login, name) in self._present.items():
            seen.setdefault(login or name or f"anonyme:{sid}", (login, name))
        return list(seen.values())


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
