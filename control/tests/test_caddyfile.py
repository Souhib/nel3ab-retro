"""La redirection d'une salle éteinte, jouée par un vrai Caddy (K39, 24 novembre 2026).

Le bloc des salles et celui des erreurs sont lus dans `deploy/Caddyfile`, le
fichier que la machine installe, puis servis par Caddy sur un port de boucle
locale tiré au hasard. Les ports des salles et du salon y sont remplacés par
un port fermé: une salle éteinte répond « connexion refusée », comme en vrai,
et l'essai ne touche jamais une salle ni un salon vivants.

Caddy écrit sa configuration et ses certificats sous `XDG_CONFIG_HOME` et
`XDG_DATA_HOME`: tous deux pointent dans le dossier de l'essai.
"""

import re
import shutil
import socket
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest

CADDY = shutil.which("caddy")
CADDYFILE = Path(__file__).parents[2] / "deploy/Caddyfile"

pytestmark = pytest.mark.skipif(CADDY is None, reason="caddy absent de cette machine")


def _port_libre() -> int:
    with socket.socket() as sonde:
        sonde.bind(("127.0.0.1", 0))
        return int(sonde.getsockname()[1])


def blocs_des_salles(texte: str) -> str:
    """Du premier `redir /r/1` à la fin de `handle_errors`, tels qu'installés."""
    debut = texte.index("\tredir /r/1 /r/1/")
    erreurs = texte.index("\thandle_errors {", debut)
    fin = texte.index("\n\t}\n", erreurs) + len("\n\t}\n")
    return texte[debut:fin]


@pytest.fixture
def caddy(tmp_path: Path) -> Iterator[str]:
    port, ferme = _port_libre(), _port_libre()
    blocs = re.sub(
        r"127\.0\.0\.1:8[0-9]{3}", f"127.0.0.1:{ferme}", blocs_des_salles(CADDYFILE.read_text())
    )
    assert "8110" not in blocs and "8200" not in blocs
    (tmp_path / "Caddyfile").write_text(
        "{\n\tadmin off\n\tauto_https off\n\tpersist_config off\n}\n"
        f'http://127.0.0.1:{port} {{\n{blocs}\n\thandle {{\n\t\trespond "salon" 200\n\t}}\n}}\n'
    )
    environnement = {
        "HOME": str(tmp_path),
        "XDG_CONFIG_HOME": str(tmp_path / "config"),
        "XDG_DATA_HOME": str(tmp_path / "data"),
        "PATH": "/usr/bin:/bin",
    }
    assert CADDY is not None
    processus = subprocess.Popen(  # noqa: S603 - caddy et un fichier écrit ici depuis le dépôt
        [CADDY, "run", "--config", str(tmp_path / "Caddyfile"), "--adapter", "caddyfile"],
        env=environnement,
        stdout=subprocess.DEVNULL,
        stderr=(tmp_path / "caddy.err").open("w"),
    )
    try:
        url = f"http://127.0.0.1:{port}"
        for _ in range(100):
            try:
                httpx.get(url, timeout=0.2)
                break
            except httpx.TransportError:
                time.sleep(0.05)
        else:
            pytest.fail(f"caddy n'a pas démarré: {(tmp_path / 'caddy.err').read_text()[-800:]}")
        yield url
    finally:
        processus.terminate()
        processus.wait(timeout=10)


@pytest.mark.parametrize("numero", [1, 2, 3])
def test_une_salle_eteinte_renvoie_au_salon_avec_son_numero(caddy: str, numero: int) -> None:
    for chemin in (f"/r/{numero}/", f"/r/{numero}/roms"):
        reponse = httpx.get(caddy + chemin, follow_redirects=False)
        assert reponse.status_code == 302, (chemin, reponse.status_code, reponse.text)
        assert reponse.headers["location"] == f"/?salle=fermee&n={numero}", chemin


def test_le_salon_lui_meme_n_est_pas_redirige(caddy: str) -> None:
    """Le jumeau: hors des salles, rien n'est réécrit."""
    reponse = httpx.get(caddy + "/", follow_redirects=False)
    assert (reponse.status_code, reponse.text) == (200, "salon")
