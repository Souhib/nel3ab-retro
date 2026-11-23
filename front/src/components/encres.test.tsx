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
import { Socket } from "./Socket";

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

it("écrit chaque « Pn » de l'accueil de salle dans l'encre du joueur n", () => {
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
    const marque = [...document.querySelectorAll(`#lobbySeats [data-port="${port}"] span`)].find(
      (span) => span.textContent === `${port}P`,
    ) as HTMLElement | undefined;
    expect(marque, `${port}P introuvable`).toBeDefined();
    expect(marque?.style.color).toBe(`var(--p${port}-encre)`);
    // Le jumeau: l'aplat reste sur la barre de la case, qui n'est pas du texte.
    expect(marque?.style.color).not.toContain(PLAYER_COLOURS[port - 1]);
  }
});

it("écrit le libellé d'une prise branchée dans l'encre, et celui d'une prise libre en légende", () => {
  for (let port = 1; port <= 4; port += 1) {
    const { container, unmount } = render(<Socket port={port} state="mine" />);
    expect(container.querySelector("text")?.getAttribute("fill")).toBe(`var(--p${port}-encre)`);
    unmount();
  }
  const { container } = render(<Socket port={3} state="free" />);
  expect(container.querySelector("text")?.getAttribute("fill")).toBe("var(--legende)");
});
