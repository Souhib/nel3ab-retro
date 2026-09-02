"""Ce que le service croit, et ce qu'il refuse de croire."""

from nel3ab_control.identity import from_headers, suggested_name

REAL = (b"tailscale-user-login", b"souhib@example.com")
NAME = (b"tailscale-user-name", b"Souhib Trabelsi")


def test_reads_the_identity_the_proxy_wrote() -> None:
    assert from_headers([REAL, NAME]) == ("souhib@example.com", "Souhib Trabelsi")


def test_normalises_the_address() -> None:
    headers = [(b"Tailscale-User-Login", b"  Souhib@Example.COM  ")]
    found = from_headers(headers)
    assert found is not None
    assert found[0] == "souhib@example.com"


def test_no_header_is_nobody_rather_than_a_guess() -> None:
    """Sans proxy devant, il n'y a personne d'authentifié.

    C'est le cas du développement local et des pilotes de navigateur, et la
    bonne réponse est « je ne sais pas » et non une identité inventée.
    """
    assert from_headers([]) is None
    assert from_headers([(b"user-agent", b"curl")]) is None


def test_an_empty_address_is_not_an_identity() -> None:
    assert from_headers([(b"tailscale-user-login", b"   ")]) is None


def test_two_identities_are_no_identity() -> None:
    """Le jumeau négatif qui compte.

    Le proxy écrase ce que le client envoie, vérifié en en forgeant un. Mais si
    deux arrivaient un jour, choisir lequel croire SERAIT la faille. Ne rien
    croire est la bonne réponse à une ambiguïté sur une identité.
    """
    forged = (b"tailscale-user-login", b"attaquant@example.com")
    assert from_headers([REAL, forged]) is None
    assert from_headers([forged, REAL]) is None


def test_a_display_name_that_appears_twice_is_dropped_not_guessed() -> None:
    found = from_headers([REAL, NAME, (b"tailscale-user-name", b"Autre")])
    assert found == ("souhib@example.com", "")


def test_the_suggested_name_is_a_first_name_then_the_local_part() -> None:
    assert suggested_name("souhib@example.com", "Souhib Trabelsi") == "Souhib"
    assert suggested_name("vincent@example.com", "") == "vincent"
    # Rien d'exploitable des deux côtés: on propose quelque chose plutôt que vide.
    assert suggested_name("@", "") == "quelqu'un"


class _Whois:
    """Un tailscaled de papier, qui note ce qu'on lui a demandé."""

    def __init__(self, answer: tuple[str, str] | None) -> None:
        self.answer = answer
        self.asked: list[str] = []

    async def __call__(self, address: str) -> tuple[str, str] | None:
        self.asked.append(address)
        return self.answer


def _scope(headers: list[tuple[bytes, bytes]], client: tuple[str, int] | None) -> dict[str, object]:
    return {"headers": headers, "client": client}


async def test_the_header_wins_and_nobody_is_asked(monkeypatch) -> None:
    """Le chemin d'origine reste le premier, et le seul quand il répond.

    Le nom `.ts.net` est servi par tailscaled lui-même, qui écrit l'identité. Y
    ajouter une question au même tailscaled serait un aller-retour par requête
    pour apprendre ce qu'on vient de lire.
    """
    from nel3ab_control import identity

    asked = _Whois(("quelqun@example.com", "Quelqu'un"))
    monkeypatch.setattr(identity, "whois", asked)

    found = await identity.caller_of(_scope([REAL, NAME], ("10.0.0.9", 5)))

    assert found == ("souhib@example.com", "Souhib Trabelsi")
    assert asked.asked == [], "on ne demande pas ce que le proxy vient de dire"


async def test_without_the_header_the_peer_address_is_asked(monkeypatch) -> None:
    """Le chemin du nom de domaine à nous.

    Le défaut qu'il corrige: passer de `.ts.net` à `nel3ab.app` a fait tomber
    l'identité SANS RIEN CASSER DE VISIBLE. La salle marchait, elle avait juste
    cessé de savoir qui était là, donc plus personne n'était propriétaire et
    n'importe qui pouvait changer le jeu de tout le monde.
    """
    from nel3ab_control import identity

    asked = _Whois(("souhib@example.com", "Souhib"))
    monkeypatch.setattr(identity, "whois", asked)

    found = await identity.caller_of(_scope([], ("fd7a:115c:a1e0::1", 0)))

    assert found == ("souhib@example.com", "Souhib")
    # L'adresse demandée est celle que le serveur a établie, jamais une valeur
    # lue dans un en-tête: c'est là que vit toute la garantie.
    assert asked.asked == ["fd7a:115c:a1e0::1"]


async def test_a_peer_nobody_recognises_is_nobody(monkeypatch) -> None:
    """Le jumeau: tailscaled qui ne connaît pas, ou qui ne répond pas.

    Une salle sans identité marche, elle ne sait juste pas qui est qui. Une
    salle qui REFUSE parce que tailscaled a mis trop de temps serait pire que le
    problème qu'on résout.
    """
    from nel3ab_control import identity

    monkeypatch.setattr(identity, "whois", _Whois(None))

    assert await identity.caller_of(_scope([], ("100.64.0.7", 0))) is None
    # Et sans pair du tout, ce qui arrive sur une socket de test.
    assert await identity.caller_of(_scope([], None)) is None


def test_an_address_of_the_sixth_kind_is_bracketed() -> None:
    """Les crochets autour d'une adresse v6, et ils ont coûté une heure.

    Sans eux, les deux-points de l'adresse et celui du port se confondent et
    l'API locale rend 404. Le cas v4, essayé à la main, marchait; or la salle se
    joint en v6 par MagicDNS, donc le cas « rare » était le cas normal.
    """
    from nel3ab_control.identity import _with_port

    assert _with_port("fd7a:115c:a1e0::1") == "[fd7a:115c:a1e0::1]:0"
    assert _with_port("100.64.0.7") == "100.64.0.7:0"
