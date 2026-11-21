"""Parler au salon comme la page de dépôt: annoncer, envoyer, terminer."""

import hashlib
from pathlib import Path

import httpx
from fastapi import FastAPI

from nel3ab_control.api.controllers.imports import ImportsController
from tests.conftest import SOUHIB
from tests.imports import fabrique as f

MIO = 1024 * 1024


def empreinte(octets: bytes) -> str:
    """SHA-256 des 4 premiers Mio, des 4 derniers sans recouvrement, et de la taille."""
    tete = octets[: 4 * MIO]
    queue = octets[max(len(tete), len(octets) - 4 * MIO) :]
    return hashlib.sha256(tete + queue + len(octets).to_bytes(8, "big")).hexdigest()


def quarantaine(app: FastAPI) -> Path:
    return app.state.settings.imports_dir


async def annoncer(
    client: httpx.AsyncClient,
    octets: bytes,
    nom: str = "jeu.iso",
    qui: dict[str, str] = SOUHIB,
    empreinte_annoncee: str | None = None,
) -> httpx.Response:
    return await client.post(
        "/api/imports",
        json={
            "nom": nom,
            "taille": len(octets),
            "empreinte_rapide": empreinte_annoncee or empreinte(octets),
        },
        headers=qui,
    )


async def envoyer(
    client: httpx.AsyncClient,
    ident: str,
    octets: bytes,
    debut: int = 0,
    morceau: int = 0x200,
    qui: dict[str, str] = SOUHIB,
) -> int:
    decalage = debut
    while decalage < len(octets):
        corps = octets[decalage : decalage + morceau]
        reponse = await client.put(
            f"/api/imports/{ident}", params={"decalage": decalage}, content=corps, headers=qui
        )
        assert reponse.status_code == 200, reponse.text
        decalage = reponse.json()["decalage"]
    return decalage


async def finir(
    client: httpx.AsyncClient, imports: ImportsController, ident: str, qui: dict[str, str] = SOUHIB
) -> dict:
    reponse = await client.post(f"/api/imports/{ident}/fin", headers=qui)
    assert reponse.status_code == 202, reponse.text
    await imports.attendre(ident)
    lu = await client.get(f"/api/imports/{ident}", headers=qui)
    assert lu.status_code == 200
    return lu.json()


GC = f.iso_nintendo(wii=False, identifiant="GALE01", titre="Super Essai Melee") + b"\x5a" * 0x1000
