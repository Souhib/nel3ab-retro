import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Lobby, estLibre, salonAuDessus } from "./Lobby";
import { aplatDuJoueur } from "../lib/etiquette";

const salle = (sieges: (string | null)[], plus: Record<string, unknown> = {}) =>
  ({
    name: "Salle 1",
    /* `library` et `media_url` sont OBLIGATOIRES dans le type `Room`, et
       `useRoom` refuse une réponse sans bibliothèque avant de la rendre. */
    library: [],
    media_url: "",
    seats: sieges.map((player, index) => ({ port: index + 1, player })),
    people: [],
    ...plus,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const poser = (room = salle(["Souhib", null, null, null]), extra: Record<string, unknown> = {}) => {
  const onEnter = vi.fn();
  const onWatch = vi.fn();
  render(
    <Lobby
      room={room}
      name="Souhib"
      login={null}
      failed={false}
      salon
      onEnter={onEnter}
      onWatch={onWatch}
      onForget={vi.fn()}
      onRename={vi.fn()}
      {...extra}
    />,
  );
  return { onEnter, onWatch };
};

const pleins = () => [...document.querySelectorAll(".rt-bouton-plein")];

it("ramène au salon quand un salon existe au-dessus", () => {
  poser();
  expect(document.querySelector("#toRooms")?.getAttribute("href")).toBe("/");
});

/* Le jumeau, et il porte tout le sens : servie en direct par le worker, cette
   page EST la racine. Un retour y rechargerait la salle qu'on quitte. */
it("ne propose aucun retour quand la page est déjà la racine", () => {
  poser(undefined, { salon: false });
  expect(document.querySelector("#toRooms")).toBeNull();
});

it("lit le préfixe de salle, et lui seul", () => {
  expect(salonAuDessus("/r/1/")).toBe(true);
  expect(salonAuDessus("/r/12/quoi")).toBe(true);
  expect(salonAuDessus("/")).toBe(false);
  expect(salonAuDessus("/r/0/")).toBe(false);
  expect(salonAuDessus("/roms")).toBe(false);
});

it("garde le contrat des pilotes : identifiants, quatre places et leur état", () => {
  poser();
  for (const id of ["#room", "#enter", "#watch", "#toRooms", "#lobbySeats", "#rename"])
    expect(document.querySelector(id), id).not.toBeNull();
  const places = [...document.querySelectorAll("#lobbySeats [data-port]")];
  expect(places.map((p) => p.getAttribute("data-state"))).toEqual(["busy", "free", "free", "free"]);
});

it("un seul dessin : plus de bascule ni de dessin retenu", () => {
  poser();
  expect(document.querySelector("#lookSwitch")).toBeNull();
  expect(document.querySelector("[data-look]")).toBeNull();
});

it("la première place libre est le seul bouton plein, et le prend à son numéro", () => {
  const { onEnter } = poser(salle(["Souhib", "Nour", null, null]));
  expect(pleins()).toEqual([document.querySelector("#enter")]);
  expect(document.querySelector("#enter")?.textContent).toBe("Prendre la place 3");
  fireEvent.click(document.querySelector("#enter")!);
  expect(onEnter).toHaveBeenLastCalledWith(3);
  // Une autre place libre se prend à SON numéro, sans être pleine.
  fireEvent.click(document.querySelector('#lobbySeats [data-port="4"]')!);
  expect(onEnter).toHaveBeenLastCalledWith(4);
  expect(document.querySelector('[data-port="3"]')?.hasAttribute("data-conseillee")).toBe(true);
  expect(document.querySelector('[data-port="4"]')?.hasAttribute("data-conseillee")).toBe(false);
});

it("une salle pleine donne le plein à « Regarder la partie », et rien à prendre", () => {
  const { onWatch } = poser(salle(["Souhib", "Nour", "Jo", "Inès"]));
  expect(document.querySelector("#enter")).toBeNull();
  expect(pleins()).toEqual([document.querySelector("#watch")]);
  expect(document.querySelector("#watch")?.textContent).toBe("Regarder la partie");
  expect(document.querySelectorAll('#lobbySeats button[data-state="free"]')).toHaveLength(0);
  expect(screen.getByText(/Les 4 places sont prises/)).toBeTruthy();
  fireEvent.click(document.querySelector("#watch")!);
  expect(onWatch).toHaveBeenCalledOnce();
});

it("hors d'une salle pleine, « Regarder » reste à contour", () => {
  poser();
  expect(document.querySelector("#watch")?.classList.contains("rt-bouton-plein")).toBe(false);
  expect(document.querySelector("#watch")?.textContent).toBe("Regarder sans place");
});

it("une place tenue sans nom n'est pas libre ; un ancien worker sans `held` compte le nom", () => {
  expect(estLibre({ port: 1, player: null, held: true })).toBe(false);
  expect(estLibre({ port: 1, player: null, held: false })).toBe(true);
  expect(estLibre({ port: 1, player: null })).toBe(true);
  expect(estLibre({ port: 1, player: "Nour" })).toBe(false);
});

it("une place prise porte l'étiquette de son joueur à sa couleur", () => {
  poser(salle(["Souhib", null, "Jo", null]));
  const trois = document.querySelector('#lobbySeats [data-port="3"]') as HTMLElement;
  expect(trois.querySelector(".n3-etiquette")?.textContent).toContain("Jo");
  expect(trois.style.getPropertyValue("--rt-joueur")).toBe(aplatDuJoueur(3));
  // Le jumeau : une place libre n'a pas d'étiquette, elle dit « Prendre ».
  const deux = document.querySelector('#lobbySeats [data-port="2"]') as HTMLElement;
  expect(deux.querySelector(".n3-etiquette")).toBeNull();
  expect(deux.textContent).toContain("Prendre");
});

it("dit qui choisit le jeu et qui regarde", () => {
  poser(
    salle(["Souhib", null, null, null], {
      owner: { name: "Nour" },
      people: [
        { name: "Souhib", seat: 1 },
        { name: "mémé", seat: null },
      ],
      game: { name: "Mario Kart Wii", console: "wii" },
    }),
  );
  expect(document.querySelector("#people")?.textContent).toBe("Nour choisit le jeu. mémé regarde.");
  expect(document.querySelector("#room")?.textContent).toContain("Mario Kart Wii");
});

it("une salle injoignable le dit, et laisse entrer quand même", () => {
  poser(salle([]), { failed: true });
  expect(screen.getByText(/ne s'affichent pas pour l'instant/)).toBeTruthy();
  expect(document.querySelector("#enter")).not.toBeNull();
});
