/**
 * « P1 » à « P4 » s'écrivent dans l'ENCRE du joueur, pas dans son aplat.
 *
 * L'aplat (`PLAYER_COLOURS`) peint une barre ou une fiche: il ne change pas
 * avec le thème. Écrit tel quel en 11 px sur le fond clair, l'aplat du joueur 3
 * tombait à 1,81:1 (audit visuel du 22 novembre 2026, V3). L'encre est un
 * jeton de la régie qui change avec le thème; `src/lib/regie.test.ts` calcule
 * qu'elle tient 4,5:1 sur chaque surface. Ici on vérifie que les libellés
 * l'emploient vraiment: un jeton juste que personne ne lit ne protège rien.
 */
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PLAYER_COLOURS, PLAYER_INKS } from "../media/players";
import { Lobby } from "./Lobby";
import { Etiquette } from "./Etiquette";

const salle = {
  name: "salle 1",
  library: [],
  media_url: "",
  seats: [
    { port: 1, player: "Ami" },
    { port: 2, player: null },
    { port: 3, player: "Cleo" },
    { port: 4, player: null },
  ],
  people: [],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

it("nomme une encre de la régie par joueur, distincte de l'aplat", () => {
  expect(PLAYER_INKS).toEqual([
    "var(--p1-encre)",
    "var(--p2-encre)",
    "var(--p3-encre)",
    "var(--p4-encre)",
  ]);
});

/* L'avant-salle n'a plus qu'un dessin depuis le 24 novembre 2026 (chantier
   salon) : « 1P » à « 4P » s'écrivent DANS le rond START, à l'encre du bouton
   (`.rt-bouton-start`, comme les places de la salle), et l'aplat du joueur
   ne va que dans `--rt-joueur`, le fond du rond. */
it("écrit chaque « nP » de l'avant-salle sur son rond START, l'aplat hors du texte", () => {
  render(
    <Lobby
      room={salle}
      name="Ami"
      login={null}
      failed={false}
      salon={false}
      onEnter={vi.fn()}
      onWatch={vi.fn()}
      onForget={vi.fn()}
      onRename={vi.fn()}
    />,
  );
  for (let port = 1; port <= 4; port += 1) {
    const place = document.querySelector(`#lobbySeats [data-port="${port}"]`) as HTMLElement;
    const marque = place.querySelector(".rt-bouton-start") as HTMLElement | null;
    expect(marque?.textContent, `${port}P introuvable`).toBe(`${port}P`);
    expect(place.style.getPropertyValue("--rt-joueur")).toBe(`var(--p${port})`);
    // Le jumeau : jamais l'aplat écrit en couleur de texte.
    expect(marque?.style.color ?? "").toBe("");
    expect(place.style.color).not.toContain(PLAYER_COLOURS[port - 1]);
  }
});

it("écrit l'étiquette d'une place dans l'encre de son joueur, et celle de qui regarde sans encre", () => {
  for (let port = 1; port <= 4; port += 1) {
    const { container, unmount } = render(<Etiquette nom="Ami" place={port} />);
    const etiquette = container.querySelector(".n3-etiquette") as HTMLElement;
    expect(etiquette.style.getPropertyValue("--etiquette-encre")).toBe(`var(--p${port}-encre)`);
    // Le jumeau: l'aplat du joueur reste sur le liseré, jamais sur le texte.
    expect(etiquette.style.getPropertyValue("--etiquette-encre")).not.toContain(
      PLAYER_COLOURS[port - 1],
    );
    unmount();
  }
  const { container } = render(<Etiquette nom="Cleo" />);
  expect(
    (container.querySelector(".n3-etiquette") as HTMLElement).style.getPropertyValue(
      "--etiquette-encre",
    ),
  ).toBe("");
});
