import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { Lobby, salonAuDessus } from "./Lobby";
import { LOBBIES } from "../lib/theme";
import { PLAYER_COLOURS } from "../media/players";

/** « #d9534f » vu comme le DOM l'écrit: « 217, 83, 79 ». */
const canaux = (hex: string): string =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ");

const salle = {
  name: "lgf",
  seats: [
    { port: 1, player: "Souhib" },
    { port: 2, player: null },
    { port: 3, player: null },
    { port: 4, player: null },
  ],
  people: [{ name: "Souhib", login: null, seat: 1 }],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const poser = (salon: boolean) =>
  render(
    <Lobby
      room={salle}
      name="Souhib"
      login={null}
      failed={false}
      salon={salon}
      onEnter={vi.fn()}
      onWatch={vi.fn()}
      onForget={vi.fn()}
      onRename={vi.fn()}
    />,
  );

it("ramène au salon quand un salon existe au-dessus", () => {
  poser(true);
  const retour = document.querySelector("#toRooms");
  expect(retour).not.toBeNull();
  expect(retour?.getAttribute("href")).toBe("/");
});

/* Le jumeau, et il porte tout le sens: servie en direct par le worker, cette
   page EST la racine. Un retour y rechargerait la salle qu'on quitte, donc il
   ne doit pas être proposé. Sans cette moitié, un bouton affiché partout
   passerait l'essai du dessus. */
it("ne propose aucun retour quand la page est déjà la racine", () => {
  poser(false);
  expect(document.querySelector("#toRooms")).toBeNull();
});

it("lit le préfixe de salle, et lui seul", () => {
  expect(salonAuDessus("/r/1/")).toBe(true);
  expect(salonAuDessus("/r/12/quoi")).toBe(true);
  expect(salonAuDessus("/")).toBe(false);
  expect(salonAuDessus("/r/0/")).toBe(false);
  expect(salonAuDessus("/roms")).toBe(false);
});

it("donne à chaque place sa couleur, occupée ou libre", () => {
  poser(true);
  const cases = [...document.querySelectorAll("#lobbySeats [data-port]")];
  expect(cases).toHaveLength(4);
  cases.forEach((boite, index) => {
    const marque = boite.querySelector("span");
    // Sur les CANAUX, pas sur l'hexadécimal: le DOM ne réécrit jamais `#d9534f`,
    // il sérialise `rgb(217, 83, 79)` pour une couleur pleine et
    // `rgba(217, 83, 79, 0.12)` pour un fond translucide. Chercher la forme
    // hexadécimale faisait échouer cet essai devant un composant correct.
    // Le triplet, lui, est présent dans les deux formes.
    expect(`${boite.getAttribute("style")} ${marque?.getAttribute("style")}`).toContain(
      canaux(PLAYER_COLOURS[index]),
    );
  });
  // Une place libre garde sa couleur: c'est le cas qui manquait.
  expect(cases[1]?.getAttribute("data-state")).toBe("free");
  expect(cases[1]?.getAttribute("style")).toContain(canaux(PLAYER_COLOURS[1]));
  expect(screen.getAllByText("libre")).toHaveLength(3);
});

/* Les deux dessins, et le contrat qu'ils partagent.
   Ces identifiants sont lus par les pilotes de navigateur: un dessin qui en
   perdrait un casserait des essais qui tournent, sans que rien ne le dise ici.
   L'essai porte donc sur les DEUX, pas sur celui qu'on vient d'écrire. */
const IDS = ["#room", "#people", "#enter", "#watch", "#toRooms", "#lobbySeats"];

const poserLook = (look: "classique" | "cables", onLook = vi.fn()) =>
  render(
    <Lobby
      room={salle}
      name="Souhib"
      login={null}
      failed={false}
      salon
      look={look}
      onLook={onLook}
      onEnter={vi.fn()}
      onWatch={vi.fn()}
      onForget={vi.fn()}
      onRename={vi.fn()}
    />,
  );

it.each(["classique", "cables"] as const)("garde le contrat des pilotes en %s", (look) => {
  poserLook(look);
  for (const id of IDS) expect(document.querySelector(id), id).not.toBeNull();
  expect(document.querySelectorAll("#lobbySeats [data-port]")).toHaveLength(4);
  expect(document.querySelector('[data-port="1"]')?.getAttribute("data-state")).toBe("busy");
  expect(document.querySelector('[data-port="2"]')?.getAttribute("data-state")).toBe("free");
});

/* La couleur d'une place vit à DEUX endroits selon son état, et un essai qui
   n'en regarde qu'un ment sans le dire. La boucle est un tracé SVG, dont les
   attributs gardent l'hexadécimal; la barre tendue est un élément stylé, que le
   DOM réécrit en `rgb(...)`. La première version de cet essai ne balayait que
   le SVG: elle est passée au vert tant que les quatre câbles étaient des
   tracés, et elle est tombée à la seconde où le câble tendu est devenu une
   barre. C'est la bonne nouvelle; ce qui l'est moins est l'essai voisin, qui
   comparait un `svg path` disparu à un tracé présent et passait donc en
   comparant `undefined` à autre chose. */
const couleursVues = (port: number): string => {
  /* LE CÂBLE, et rien d'autre de la boîte.
     La première version balayait toute la place, or le libellé « P1 » porte lui
     aussi la couleur du joueur. Mise à l'épreuve en peignant la barre tendue en
     gris, elle restait verte: elle prouvait que le NUMÉRO était coloré, pas le
     câble. Un essai qui survit à la panne qu'il prétend guetter ne vaut rien. */
  const cable = document.querySelector(`[data-port="${port}"] [data-cable]`);
  const attributs = [...(cable?.querySelectorAll("[fill], [stroke]") ?? [])]
    .flatMap((n) => [n.getAttribute("fill"), n.getAttribute("stroke")])
    .filter(Boolean)
    .join(" ");
  const styles = [cable, ...(cable?.querySelectorAll("[style]") ?? [])]
    .map((n) => n?.getAttribute("style") ?? "")
    .join(" ");
  return `${attributs} ${styles}`.toLowerCase();
};

it("porte les quatre couleurs dans le dessin câbles, prise ou libre", () => {
  poserLook("cables");
  PLAYER_COLOURS.forEach((couleur, index) => {
    const vu = couleursVues(index + 1);
    const present = vu.includes(couleur.toLowerCase()) || vu.includes(canaux(couleur));
    expect(present, `P${index + 1} ${couleur}: ${vu}`).toBe(true);
  });
});

it("distingue un câble tendu d'un câble enroulé, sans compter sur la couleur", () => {
  poserLook("cables");
  const prise = document.querySelector('[data-port="1"]');
  const libre = document.querySelector('[data-port="2"]');
  // L'invariant, énoncé sur ce qui EXISTE et non sur deux valeurs comparées:
  // une place prise montre une barre et aucune boucle, une place libre montre
  // une boucle. Quelqu'un qui ne distingue pas le rouge du vert lit quand même
  // l'état de la salle.
  expect(prise?.querySelector("svg"), "une place prise ne doit pas boucler").toBeNull();
  expect(libre?.querySelector("svg path"), "une place libre doit boucler").not.toBeNull();
});

it("annonce le dessin vers lequel la bascule emmène, pas celui où l'on est", () => {
  const onLook = vi.fn();
  poserLook("classique", onLook);
  const bouton = document.querySelector("#lookSwitch");
  const autre = LOBBIES.find((c) => c.id !== "classique")!;
  expect(bouton?.textContent).toBe(autre.label);
  fireEvent.click(bouton!);
  expect(onLook).toHaveBeenCalledWith(autre.id);
});

it("ne montre aucune bascule quand personne ne peut changer de dessin", () => {
  render(
    <Lobby
      room={salle}
      name="Souhib"
      login={null}
      failed={false}
      salon
      onEnter={vi.fn()}
      onWatch={vi.fn()}
      onForget={vi.fn()}
      onRename={vi.fn()}
    />,
  );
  expect(document.querySelector("#lookSwitch")).toBeNull();
});
