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
  /* `library` et `media_url` sont OBLIGATOIRES dans le type `Room`, et
     `useRoom` refuse une réponse dont la bibliothèque n'est pas un tableau
     avant de la rendre: une salle définie en porte donc toujours une. Ce
     montage les omettait, et un dessin qui lit `room.library.length` tombait
     sur un objet que la production ne produit jamais. On complète le montage
     plutôt que d'ajouter une garde au composant: la garde existe déjà, à la
     frontière, et en poser une seconde ferait deux endroits qui répondent à la
     même question. */
  library: [],
  media_url: "",
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

const poserLook = (look: "classique" | "cables" | "sol", onLook = vi.fn()) =>
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

it.each(["classique", "cables", "sol"] as const)("garde le contrat des pilotes en %s", (look) => {
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

/* Le cycle, ÉPINGLÉ et non recalculé.
   La version d'avant écrivait `LOBBIES.find((c) => c.id !== "classique")`, la
   même expression que le composant. Elle est donc restée verte pendant que le
   troisième dessin était inatteignable: les deux côtés se trompaient ensemble.
   Un essai qui rejoue le calcul qu'il vérifie ne vérifie rien. Les trois
   attendus sont maintenant écrits en toutes lettres. */
it.each([
  ["classique", "câbles", "cables"],
  ["cables", "au sol", "sol"],
  ["sol", "classique", "classique"],
] as const)("depuis %s, la bascule annonce et appelle le suivant du cycle", (ou, libelle, vers) => {
  const onLook = vi.fn();
  poserLook(ou, onLook);
  const bouton = document.querySelector("#lookSwitch");
  expect(bouton?.textContent).toBe(libelle);
  fireEvent.click(bouton!);
  expect(onLook).toHaveBeenCalledWith(vers);
});

/* Le cycle passe par TOUS les dessins. Le jumeau de l'essai du dessus: sans
   lui, trois bascules qui se renvoient entre deux entrées passeraient. */
it("atteint les trois dessins en trois bascules", () => {
  const vus = new Set<string>();
  let ou: "classique" | "cables" | "sol" = "classique";
  for (let tour = 0; tour < LOBBIES.length; tour += 1) {
    const onLook = vi.fn();
    const vue = poserLook(ou, onLook);
    fireEvent.click(document.querySelector("#lookSwitch")!);
    ou = onLook.mock.calls[0][0];
    vus.add(ou);
    vue.unmount();
  }
  expect([...vus].sort()).toEqual(LOBBIES.map((c) => c.id).sort());
});

/* UN SEUL bouton d'entrée dans le DOM.
   Le dessin câbles rendait `actions` à deux points de rupture, donc deux
   `#enter` et deux `#watch`, dont un caché. `querySelector` rend le premier du
   balisage: un pilote pouvait cliquer celui qui ne se voyait pas. */
it.each(["classique", "cables", "sol"] as const)("ne pose qu'un seul #enter en %s", (look) => {
  poserLook(look);
  expect(document.querySelectorAll("#enter")).toHaveLength(1);
  expect(document.querySelectorAll("#watch")).toHaveLength(1);
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

/* Une salle qui porte les trois vérités d'un siège: un nom, une manette tenue
   sans nom annoncé, et une place libre. La quatrième place a `held` NUL, ce qui
   veut dire « worker ancien ou lecture ratée »: une ignorance, qui doit se
   rendre exactement comme une place libre plutôt que d'inventer un état. */
const salleTroisEtats = {
  name: "lgf",
  library: [],
  media_url: "",
  seats: [
    { port: 1, player: "Souhib", held: true },
    { port: 2, player: null, held: true },
    { port: 3, player: null, held: false },
    { port: 4, player: null, held: null },
  ],
  people: [
    { name: "Souhib", login: null, seat: 1 },
    { name: "Kim", login: null, seat: null, seat_pending: true },
    { name: "Nora", login: null, seat: null, seat_pending: false },
  ],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

const poserSol = () =>
  render(
    <Lobby
      room={salleTroisEtats}
      name="Souhib"
      login={null}
      failed={false}
      salon
      look="sol"
      onLook={vi.fn()}
      onEnter={vi.fn()}
      onWatch={vi.fn()}
      onForget={vi.fn()}
      onRename={vi.fn()}
    />,
  );

it("au sol, la chaise dit plein, creux ou vide sans compter sur la couleur", () => {
  poserSol();
  const pion = (port: number) =>
    document.querySelector(`[data-port="${port}"] [data-pion]`)?.getAttribute("data-pion") ?? null;
  expect(pion(1), "un nom annoncé: pion plein").toBe("plein");
  expect(pion(2), "tenue sans nom: anneau").toBe("anneau");
  expect(pion(3), "libre: rien").toBeNull();
  // Le jumeau qui porte le sens: `held` nul est une ignorance, pas un état.
  expect(pion(4), "held nul: rien, on ne dessine pas une ignorance").toBeNull();
});

it("au sol, l'anneau ne change pas data-state, qui reste celui du nom", () => {
  poserSol();
  const etat = (port: number) =>
    document.querySelector(`[data-port="${port}"]`)?.getAttribute("data-state");
  expect(etat(1)).toBe("busy");
  // Tenue sans nom: l'encre change, l'attribut lu par les pilotes ne bouge pas.
  expect(etat(2)).toBe("free");
  expect(etat(3)).toBe("free");
});

it("au sol, la porte et le mur du fond sont deux endroits", () => {
  poserSol();
  const mur = document.querySelector("#people")?.textContent ?? "";
  // `seat_pending` dit « cette personne n'est pas un spectateur ».
  expect(mur).toContain("Nora");
  expect(mur).not.toContain("Kim");
  expect(document.body.textContent).toContain("à la porte");
});

/* Le dessin se NOMME sur la page.
   Sans cette marque, un pilote qui sème `nel3ab:lobby` puis mesure ne peut pas
   vérifier qu'il regarde l'écran qu'il a demandé: une clé mal orthographiée, un
   repli sur « classique », et il rendrait un vert en mesurant autre chose. Le
   dépôt s'applique déjà cette règle dans `debordement.mjs`, qui refuse de
   mesurer si le panneau des touches ne s'est pas ouvert. */
it.each(["classique", "cables", "sol"] as const)("nomme le dessin rendu en %s", (look) => {
  poserLook(look);
  expect(document.querySelector("#room")?.getAttribute("data-look")).toBe(look);
});
