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
            "par Souhib le 14 septembre 2026: il revient le soir même ou le lendemain."
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
    worker_control: str = Field(
        default="127.0.0.1:8101",
        description=(
            "Où dire au worker qui décide du jeu. Un autre port que celui des "
            "pages, et que le proxy ne relaie pas: c'est ce qui empêche un "
            "navigateur de se déclarer propriétaire."
        ),
    )
