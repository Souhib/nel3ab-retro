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
