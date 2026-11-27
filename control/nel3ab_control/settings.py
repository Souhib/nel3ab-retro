"""What the control plane needs to know, and where it comes from."""

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration, from the environment or a `.env` beside the service.

    Every value has a default that works on the machine this runs on, because a
    control plane that will not start without a file is one more thing between a
    person and their game.
    """

    model_config = SettingsConfigDict(env_prefix="NEL3AB_", env_file=".env", extra="ignore")

    room_name: str = Field(default="Salon", description="What the single room is called.")
    worker_url: str = Field(
        default="http://127.0.0.1:8100",
        description="Where the worker serves its library and its media sockets.",
    )
    worker_public_url: str = Field(
        default="",
        description=(
            "What a BROWSER should use to reach the worker. Empty means the same "
            "origin as the page, which is the case behind the Tailscale proxy."
        ),
    )
    origins: list[str] = Field(
        default_factory=lambda: ["https://nel3ab.app"],
        description=(
            "Les origines qui ont le droit d'ouvrir le salon depuis un navigateur. "
            "Une liste, jamais vide: pour python-socketio, une liste vide veut "
            "dire AUCUN contrôle, et n'importe quel site ouvert dans le navigateur "
            "d'un membre du tailnet parlait alors à la salle en son nom. Vérifié "
            "le 5 septembre 2026 avec une origine forgée: poignée de main acceptée."
        ),
    )
    state_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/people.json",
        description=(
            "Où les pseudos sont gardés. Hors du dépôt et hors de /tmp: un pseudo "
            "doit survivre à un redémarrage du service ET de la machine, "
            "contrairement aux places, qui meurent avec le processus."
        ),
    )
    bindings_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/bindings.json",
        description=(
            "Où sont gardés les réglages de manette de chacun. Sous la personne "
            "et pas sous la machine: une manette apprise au salon n'a aucune "
            "raison d'être réapprise au bureau."
        ),
    )
    room_bindings_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/room-bindings.json",
        description="La configuration de RÉFÉRENCE de la salle, celle que tout le monde reçoit.",
    )
    admin: str = Field(
        default="",
        description=(
            "L'adresse de la seule personne qui peut publier la référence de la salle. "
            "Vide veut dire personne, et une salle sans référence se comporte comme avant."
        ),
    )
    journal_dir: Path = Field(
        default=Path.home() / ".local/state/nel3ab/sessions",
        description=(
            "Où les séances sont écrites, un fichier JSONL par jour. À côté des "
            "pseudos et pour la même raison: hors du dépôt, et hors de /tmp, où "
            "un redémarrage de la machine effacerait la trace de la soirée "
            "qu'on veut justement relire le lendemain."
        ),
    )
    journal_days: int = Field(
        default=7,
        description=(
            "Combien de jours de séances on garde. Sept depuis le 14 septembre "
            "2026, au lieu de deux: la boîte noire garde une semaine de relevés, "
            "et une mesure de page qui a disparu ne se recolle plus au relevé de "
            "la machine du même instant. Une soirée à quatre pèse environ 4 Mo."
        ),
    )
    journal_zone: str = Field(
        default="Europe/Paris",
        description=(
            "Sur quelle horloge le journal écrit ses heures. Celle des joueurs "
            "et pas celle de la machine, qui tourne en UTC: une plainte parle "
            "de « 16 h 43 », et un journal qui répond 14:43 ne se relit pas."
        ),
    )
    parties_dir: Path = Field(
        default=Path.home() / ".local/state/nel3ab/parties",
        description=(
            "Où le journal des parties est écrit: un fichier JSONL par personne, "
            "nommé par l'empreinte de son adresse, JAMAIS balayé. Séparé du "
            "journal des séances, qui s'efface après sept jours: un profil qui "
            "oublie les parties d'il y a huit jours ne dit pas « ce que j'ai joué »."
        ),
    )
    demarrages_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/demarrages.jsonl",
        description=(
            "Où le salon note la durée de chaque démarrage de jeu, une ligne JSON "
            "sans personne, pour dire « d'habitude, il démarre en 25 s » "
            "(`nel3ab_control.demarrages`). Un fichier pour la machine."
        ),
    )
    personal_save_root: Path = Field(
        default=Path.home() / ".local/state/nel3ab/personal-saves",
        description=(
            "Où le worker range les sauvegardes personnelles GameCube et Wii. La "
            "même variable et la même valeur que dans l'unité du worker "
            "(`deploy/nel3ab-worker@.service`): le salon ne fait qu'y lire des "
            "dates et des tailles, pour montrer à chacun les siennes."
        ),
    )
    switch_config: Path = Field(
        default=Path.home() / ".config/nel3ab/switch.json",
        description=(
            "La configuration de l'adaptateur Switch, la même que lit le worker. "
            "Le salon n'y prend que `state`, le dossier des emplacements."
        ),
    )
    switch2_config: Path = Field(
        default=Path.home() / ".config/nel3ab/switch2.json",
        description="Pareil pour l'adaptateur Switch 2.",
    )
    xbox360_config: Path = Field(
        default=Path.home() / ".config/nel3ab/xbox360.json",
        description=(
            "Pareil pour l'adaptateur Xbox 360. Absent jusqu'au 22 novembre 2026: le "
            "carnet de jeu ne montrait aucune sauvegarde Xbox 360."
        ),
    )
    boite_noire_dir: Path = Field(
        default=Path.home() / ".local/state/nel3ab/boite-noire",
        description=(
            "Où la boîte noire range ses relevés (un JSONL par jour) et ses captures "
            "(un dossier daté par capture). Hors du dépôt et hors de /tmp, pour la "
            "même raison que le journal des séances."
        ),
    )
    boite_noire_jours: int = Field(
        default=7,
        description=(
            "Combien de jours de relevés et de captures on garde. Une semaine, fixée "
            "par Souhib le 14 septembre 2026: il revient le soir même ou le lendemain. "
            "Gardée à sept le 27 novembre 2026, quand la partie de Mario Tennis du "
            "30 octobre s'est révélée sans relevés: ce qui manquait pour comparer deux "
            "soirées tient dans le résumé de chaque partie (`parties/`, environ 2 Kio, "
            "jamais effacé), et les mesures des pages partent elles aussi après sept "
            "jours (`journal_days`). Le disque n'est pas la raison: ce jour-là, sept "
            "jours de relevés pesaient 23 Mo et 28 captures 48 Mo."
        ),
    )
    boite_noire_pas_partie_s: float = Field(
        default=2.0,
        description=(
            "Le pas entre deux relevés pendant qu'un émulateur tourne. Un relevé "
            "coûtait 15 ms de processeur le 14 septembre 2026, soit 0,75 % d'un cœur "
            "à ce pas, à la priorité la plus basse."
        ),
    )
    boite_noire_pas_repos_s: float = Field(
        default=60.0,
        description="Le pas entre deux relevés quand aucun émulateur ne tourne.",
    )
    boite_noire_veille_s: float = Field(
        default=2.0,
        gt=0,
        description=(
            "Au repos, tous les combien de secondes regarder si un émulateur vient "
            "de démarrer, pour prendre le premier relevé sans attendre le pas du "
            "repos. Le 21 novembre 2026, les deux parties de Sonic ont été vues 36 et "
            "42 s après leur lancement: chargement et premiers gels sans relevé. "
            "Regarder coûte 0,56 ms de processeur (503 processus, même jour). Le "
            "service entier au repos, veille comprise, a pris 70 ms de processeur "
            "en 60 s une fois redémarré, soit 0,12 % d'un cœur (relevé par minute "
            "compris; précision de 10 ms)."
        ),
    )
    boite_noire_allocateur_s: float = Field(
        default=60.0,
        description=(
            "Tous les combien lire l'allocateur de la mémoire vidéo et les objets GPU. "
            "Pas à chaque relevé: lire `amdgpu_vram_mm` prenait 35 ms dans le noyau."
        ),
    )
    boite_noire_seuil_images: float = Field(
        default=50.0,
        description=(
            "Sous quelle médiane d'images par seconde des pages une salle chute et "
            "déclenche une capture. Mario Tennis tombait à 40 le 13 septembre 2026."
        ),
    )
    boite_noire_plafonds: dict[str, float] = Field(
        default={"The Legend of Zelda: Ocarina of Time": 30.0},
        description=(
            "Les jeux plafonnés sous 60 images par seconde: leur titre, tel que le "
            "salon l'écrit, et leur plafond. Un jeu de cette table chute sous "
            "`boite_noire_part_plafond` de son plafond, et non sous "
            "`boite_noire_seuil_images`. Zelda sur Switch 2 est plafonné à 30 par sa "
            "politique de lancement. Le 11 novembre 2026, le seuil de 50 a donné six "
            "captures de cadence sur sept avec une médiane de 30,0, une toutes les "
            "cinq minutes, et la seule vraie chute du jour (15 à 17 images par seconde "
            "de 15:32:33 à 15:36:53) est tombée dans un de ces silences."
        ),
    )
    boite_noire_part_plafond: float = Field(
        default=0.9,
        description=(
            "Sous quelle part de son plafond un jeu de `boite_noire_plafonds` chute. "
            "0,9 d'un plafond de 30 donne 27. La page arrondit la cadence à l'entier "
            "et la règle est stricte: la salle chute donc à une médiane de 26,5 ou "
            "moins. Rejoué le 14 novembre 2026 sur les mesures réelles des 10 et 11: "
            "plus aucune capture à médiane 30, et la chute du 11 est prise."
        ),
    )
    boite_noire_seuil_gel_ms: float = Field(
        default=500.0,
        description=(
            "À partir de quel écart entre deux images reçues, en millisecondes, une "
            "salle est capturée. Le 16 septembre 2026, deux joueurs ont signalé des "
            "mini-freezes que la règle de cadence n'a pas vus: leurs pages perdaient "
            "0,7 à 1,2 s d'images toutes les deux minutes et demie, sans que la "
            "médiane bouge de 60 images par seconde. Les fenêtres saines de cette "
            "soirée-là tenaient sous 100 ms, ce qui laisse un facteur cinq."
        ),
    )
    boite_noire_pause_gel_s: float = Field(
        default=60.0,
        gt=0,
        description=(
            "Combien de secondes une salle se tait après la capture d'un GEL. Une "
            "chute de cadence garde sa pause de cinq minutes. Cinq minutes aussi pour "
            "un gel jusqu'au 27 novembre 2026: ce soir-là, la pause ouverte par le trou "
            "de 1 488 ms de 00:33:23 aurait couvert le gel de 543 ms de 00:36:14, rejoué "
            "sur les vraies mesures. Une minute laisse finir la capture (dix secondes de "
            "profil) et borne une soirée qui gèle sans arrêt à une capture par minute et "
            "par salle, de 2 à 5 Mo chacune. Un même gel, même long, n'en prend qu'une."
        ),
    )
    boite_noire_capture_s: int = Field(
        default=10,
        description="Combien de secondes dure le profil d'une capture.",
    )
    boite_noire_periode_profil_s: float = Field(
        default=600.0,
        description=(
            "Tous les combien de secondes de partie prendre une capture périodique, "
            "celle qui dit à quoi ressemble une partie qui va BIEN."
        ),
    )
    boite_noire_roulant: bool = Field(
        default=True,
        description=(
            "Garder un `perf` en tampon circulaire pendant les parties, qu'une chute "
            "vide pour obtenir le profil des secondes qui la PRÉCÈDENT. Sans lui, une "
            "capture ne montre qu'une machine déjà repartie: c'est ce qu'ont donné les "
            "trois premières captures de gel, le 16 septembre 2026."
        ),
    )
    boite_noire_roulant_sauf: tuple[str, ...] = Field(
        default=("switch2",),
        description=(
            "Les moteurs que le `perf` roulant ne suit pas, par leur nom dans les "
            "relevés. Mesuré les 12 et 14 novembre 2026 sur Zelda (Lichii 65defb74), "
            "moteur seul: le perf roulant ajoute 2,5 à 3,0 % au coût du fil GPUBack, "
            "qui borne la cadence, soit 0,74 à 0,85 ms par image; quand ce fil n'a "
            "plus de marge, le jeu perd 1,0 à 1,3 image par seconde. Ce moteur change "
            "les droits d'accès de ses pages 408 à 437 fois par image, et le noyau "
            "prépare un événement pour `perf` à chacune. Ce qu'on perd: le profil des "
            "secondes qui précèdent une chute, pour ce moteur seulement. La capture "
            "garde son profil de dix secondes, l'image et les journaux."
        ),
    )
    boite_noire_debugfs_en_partie: bool = Field(
        default=False,
        description=(
            "Lire l'allocateur de la mémoire vidéo et les objets GPU pendant une partie, "
            "relevés et captures compris. Non par défaut: mesuré le 14 septembre 2026 sur "
            "Mario Tennis à quatre, chaque lecture de `amdgpu_vram_mm` et `amdgpu_gem_info` "
            "coupait l'image une centaine de millisecondes. Hors partie, ils se lisent."
        ),
    )
    salles_dir: Path = Field(
        default=Path.home() / ".local/state/nel3ab/salles",
        description=(
            "Où chaque salle garde sa session: ses sauvegardes, sa configuration "
            "et son dernier jeu. Un dossier par numéro, le MÊME que celui écrit "
            "dans le modèle d'unité: deux salles qui le partageraient "
            "écraseraient leurs sauvegardes l'une l'autre, et le worker refuse "
            "d'ailleurs de démarrer sur un dossier déjà tenu."
        ),
    )
    rom_dir: str = Field(
        default=f"{Path.home() / 'roms/gc'}:{Path.home() / 'roms/wii'}",
        description=(
            "Les dossiers de jeux, séparés par deux-points, sous la MÊME forme que "
            "`NEL3AB_ROM_DIR` du worker: c'est la même liste, lue par deux services. "
            "L'import y range un jeu dans le dossier dont le NOM est celui de sa "
            "console (`gc`, `wii`, `switch`, `switch2`, `xbox360`). Le défaut est "
            "celui du worker, GameCube et Wii seulement."
        ),
    )
    importeurs: list[str] = Field(
        default_factory=list,
        description=(
            "Les adresses, en plus de l'administrateur, qui ont le droit de déposer "
            "un jeu. En JSON, comme les origines. Vide par défaut: déposer écrit "
            "dans la bibliothèque de tout le monde, donc personne d'autre que "
            "l'administrateur ne le fait sans qu'on l'ait écrit ici."
        ),
    )
    importeurs_file: Path = Field(
        default=Path.home() / ".local/state/nel3ab/importeurs.json",
        description=(
            "Les adresses que l'administrateur a nommées depuis la page de dépôt. "
            "Elles s'ajoutent à `importeurs`, qui reste la liste écrite à la main "
            "et que la page ne peut pas retirer. Absent veut dire personne."
        ),
    )
    imports_dir: Path = Field(
        default=Path.home() / ".local/state/nel3ab/imports",
        description=(
            "La quarantaine: où un envoi arrive, morceau par morceau, et où reste un "
            "fichier qu'on ne range pas. Sur le MÊME disque que les jeux, pour que "
            "le rangement soit un simple lien et pas une copie de 20 Gio. Créée au "
            "premier envoi, jamais au démarrage."
        ),
    )
    imports_marge: int = Field(
        default=100 * 1024**3,
        ge=0,
        description=(
            "Combien d'octets doivent rester libres sur le disque après un envoi. "
            "Les jeux partagent le disque du système: le remplir arrêterait Docker, "
            "les journaux et l'écriture des sauvegardes. Cent Gio est un CHOIX, "
            "proposé par l'audit du 20 novembre 2026, pas une mesure."
        ),
    )
    imports_max: int = Field(
        default=48 * 1024**3,
        gt=0,
        description=(
            "La taille la plus grande d'un envoi. Le plus gros fichier de la "
            "bibliothèque pesait 23,9 Gio le 20 novembre 2026 (Switch 2): le double "
            "laisse passer une archive qui le contient."
        ),
    )
    imports_total: int = Field(
        default=128 * 1024**3,
        gt=0,
        description=(
            "Ce que la quarantaine peut tenir en tout, envois en cours compris. "
            "Chaque envoi réserve sa taille annoncée dès sa création."
        ),
    )
    switch_keys: Path | None = Field(
        default=None,
        description=(
            "Le `prod.keys` de la console, dont l'import lit la seule ligne "
            "`header_key` pour déchiffrer l'en-tête NCA d'un jeu Switch et y lire "
            "son identifiant de titre. Sans lui, un NSP ou un XCI reste « à "
            "confirmer » et s'inscrit à la main. Aucun défaut, exprès: un salon de "
            "développement, ou un essai, ne lit jamais la vraie clé de la machine "
            "sans qu'on l'ait écrit."
        ),
    )
    worker_control: str = Field(
        default="127.0.0.1:8101",
        description=(
            "Où dire au worker qui décide du jeu. Un autre port que celui des "
            "pages, et que le proxy ne relaie pas: c'est ce qui empêche un "
            "navigateur de se déclarer propriétaire."
        ),
    )

    def configuration_adaptateur(self, config_env: str) -> Path:
        """La configuration d'un adaptateur, nommée par la variable que lit le worker.

        Le manifeste nomme cette variable (`form.config_env`), et le réglage du
        salon porte le même nom sans son préfixe: `NEL3AB_XBOX360_CONFIG` est
        `xbox360_config`. Une variable sans réglage lève `LookupError`: une
        console ajoutée au manifeste sans le sien doit se voir à l'essai, pas
        faire disparaître ses sauvegardes du carnet.
        """
        prefixe = self.model_config.get("env_prefix", "")
        champ = config_env.removeprefix(prefixe).lower()
        if (
            not config_env.startswith(prefixe)
            or not champ.endswith("_config")
            or champ not in type(self).model_fields
        ):
            raise LookupError(f"le salon n'a aucun réglage pour {config_env}")
        valeur = getattr(self, champ)
        if not isinstance(valeur, Path):
            raise LookupError(f"{champ} n'est pas un chemin")
        return valeur

    def is_admin(self, login: str) -> bool:
        """Cette adresse est-elle celle de `admin` ?

        Une seule lecture de la règle, pour les trois routes qui la posent:
        publier la référence de la salle, le dire à la page, fermer une salle.
        Trois copies d'une comparaison finissent par ne plus dire la même chose.

        Mise en minuscules des DEUX côtés: l'identité arrive normalisée, la
        configuration est écrite à la main. Une adresse d'administrateur vide ne
        correspond à personne, puisque les deux chemins d'identité refusent une
        adresse vide.
        """
        return login == self.admin.strip().lower()
