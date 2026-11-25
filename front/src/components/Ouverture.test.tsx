import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mascotte = vi.hoisted(() => ({
  jouer: vi.fn(),
  poserMascotte: vi.fn(),
}));
vi.mock("../mascotte", () => mascotte);

const { OUVERTURE_LIMITE_MS, Ouverture, placeDeLaParole, plusGrandLibre } =
  await import("./Ouverture");
const { miseEnPage, SANS_ZONES } = await import("../lib/cadre");

beforeEach(() => {
  vi.useFakeTimers();
  mascotte.jouer.mockClear();
  mascotte.poserMascotte.mockClear();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

const ouvrir = (nomGarde = "") => {
  const rappels = { onReessayer: vi.fn(), onEntrer: vi.fn() };
  const vue = render(<Ouverture salle={1} nomGarde={nomGarde} {...rappels} />);
  return { ...vue, ...rappels };
};

describe("le squelette de la salle", () => {
  it("dit tout de suite où l'on est : h1 « Salle 1 », une seule région annoncée (E8)", () => {
    const { container } = ouvrir();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Salle 1");
    const annonces = screen.getAllByRole("status");
    expect(annonces).toHaveLength(1);
    expect(annonces[0]).toHaveTextContent("On ouvre la salle 1…");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.querySelector("header h1")).not.toBeNull();
    // Le jumeau : une attente normale ne propose rien.
    act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS - 500));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("dessine quatre START éteints, qu'on ne peut pas prendre", () => {
    const { container } = ouvrir();
    const starts = container.querySelectorAll(".rt-bouton-start");
    expect([...starts].map((s) => s.textContent)).toEqual(["1P", "2P", "3P", "4P"]);
    for (const s of starts) {
      expect(s).toHaveAttribute("data-libre");
      expect(s.closest("button, a, [role=button], [tabindex]")).toBeNull();
      expect(s.closest("[aria-hidden=true]")).not.toBeNull();
    }
  });

  it("suit le thème : ni la régie de nuit forcée, ni Bobine", () => {
    const { container } = ouvrir();
    expect(container.querySelector(".regie-nuit")).toBeNull();
    expect(container.querySelector(".rt-bobine, [class*='bobine']")).toBeNull();
    expect(container.querySelector(".n3-ouverture-ecran")).not.toBeNull();
  });

  it("ne porte aucun identifiant de la salle : un pilote qui attend #side attend la vraie", () => {
    const { container } = ouvrir();
    for (const id of ["side", "panneau", "leaveRoom", "coin", "mesures", "screen"])
      expect(container.querySelector(`#${id}`), id).toBeNull();
    expect(container.querySelector("#ouvertureColonne")).not.toBeNull();
  });

  it("au bureau, la colonne prend la largeur gardée par ce navigateur", () => {
    localStorage.setItem("nel3ab:colonne", "400");
    const { container } = ouvrir();
    expect((container.querySelector("#ouvertureColonne") as HTMLElement).style.width).toBe("400px");
  });

  it("le jumeau : sans largeur gardée, celle de la salle par défaut (304 px)", () => {
    const { container } = ouvrir();
    expect((container.querySelector("#ouvertureColonne") as HTMLElement).style.width).toBe("304px");
  });
});

describe("la fin de l'attente", () => {
  it("passé la limite, le dit et propose « Réessayer », seul bouton plein", () => {
    const { container, onReessayer, onEntrer } = ouvrir();
    act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS + 100));
    expect(screen.getByRole("status")).toHaveTextContent("nel3ab ne répond pas encore.");
    expect(screen.getByText("La page l'attend depuis 8 secondes…")).toBeVisible();
    const pleins = container.querySelectorAll("[data-plein]");
    expect(pleins).toHaveLength(1);
    expect(pleins[0]).toHaveTextContent("Réessayer");
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    fireEvent.click(screen.getByRole("button", { name: "Entrer quand même" }));
    expect(onReessayer).toHaveBeenCalledTimes(1);
    expect(onEntrer).toHaveBeenCalledTimes(1);
  });

  it("avec un nom gardé, le second bouton le nomme", () => {
    ouvrir("Bilel");
    act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS));
    expect(screen.getByRole("button", { name: "Entrer en tant que Bilel" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Entrer quand même" })).toBeNull();
  });

  it("le compte avance hors de la région annoncée : une seconde de plus ne se relit pas", () => {
    ouvrir();
    act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS + 1000));
    const annonce = screen.getByRole("status");
    const avant = annonce.innerHTML;
    expect(screen.getByText("La page l'attend depuis 9 secondes…")).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("La page l'attend depuis 10 secondes…")).toBeVisible();
    expect(annonce.innerHTML).toBe(avant);
    expect(within(annonce).queryByText(/secondes/)).toBeNull();
  });
});

describe("Aïn pendant l'ouverture", () => {
  it("est posé au montage, hors de l'écran noir, et ne joue rien avant la limite", () => {
    const { container } = ouvrir();
    expect(mascotte.poserMascotte).toHaveBeenCalledTimes(1);
    const hote = mascotte.poserMascotte.mock.calls[0]?.[0] as HTMLElement;
    expect(hote.dataset.hote).toBe("ouverture");
    expect(hote.closest(".n3-ouverture-ecran")).toBeNull();
    expect(container.querySelector(".n3-ouverture-ecran")?.contains(hote)).toBe(false);
    act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS - 100));
    expect(mascotte.jouer).not.toHaveBeenCalled();
  });

  it("à la limite, joue « attente » une fois, et rien ensuite", () => {
    ouvrir();
    act(() => vi.advanceTimersByTime(OUVERTURE_LIMITE_MS));
    expect(mascotte.jouer).toHaveBeenCalledTimes(1);
    expect(mascotte.jouer.mock.calls[0]?.[0]).toBe("attente");
    act(() => vi.advanceTimersByTime(10_000));
    expect(mascotte.jouer).toHaveBeenCalledTimes(1);
  });
});

describe("plusGrandLibre", () => {
  it("sous un écran en haut, la bande du bas", () => {
    expect(plusGrandLibre({ x: 0, y: 48, w: 390, h: 220 }, 390, 844)).toEqual({
      x: 0,
      y: 268,
      w: 390,
      h: 576,
    });
  });
  it("à droite d'un écran en travers, la bande de droite", () => {
    expect(plusGrandLibre({ x: 0, y: 0, w: 600, h: 390 }, 844, 390)).toEqual({
      x: 600,
      y: 0,
      w: 244,
      h: 390,
    });
  });
  it("sans écran, toute la fenêtre", () => {
    expect(plusGrandLibre(null, 390, 844)).toEqual({ x: 0, y: 0, w: 390, h: 844 });
  });
});

/**
 * Tenue en main, la colonne de l'ouverture prenait la plus grande bande
 * autour de l'écran, quelle qu'en soit la taille : 0 px de haut sous
 * l'écran à 1024x768, 43,5 px de large à 1180x820, 0,5 px à 1366x1024, où
 * elle débordait à droite et élargissait la page (relecture finale du
 * 25 novembre 2026).
 */
describe("la place de la parole, tenue en main", () => {
  const ecranDe = (largeur: number, hauteur: number) =>
    miseEnPage({
      mode: "paysage",
      fenetre: { width: largeur, height: hauteur },
      zonesSures: SANS_ZONES,
      image: { width: 0, height: 0 },
      ajustement: "remplir",
      base: null,
      etat: "connexion",
      role: "joueur",
      manette: null,
      largeurColonne: 304,
      largeurPanneau: null,
      agrandie: false,
      reglage: false,
    }).ecran;
  for (const [largeur, hauteur] of [
    [1024, 768],
    [1112, 834],
    [1180, 820],
    [1194, 834],
    [1280, 800],
    [1366, 1024],
  ] as const) {
    it(`${largeur}x${hauteur} : une boîte lisible, dans la fenêtre, sur l'écran noir`, () => {
      const place = placeDeLaParole(ecranDe(largeur, hauteur), largeur, hauteur);
      expect(place.rect.w).toBeGreaterThanOrEqual(150);
      expect(place.rect.h).toBeGreaterThanOrEqual(200);
      expect(place.rect.x).toBeGreaterThanOrEqual(0);
      expect(place.rect.y).toBeGreaterThanOrEqual(0);
      expect(place.rect.x + place.rect.w).toBeLessThanOrEqual(largeur);
      expect(place.rect.y + place.rect.h).toBeLessThanOrEqual(hauteur);
      expect(place.surEcran).toBe(true);
    });
  }
  it("jumeau : un téléphone couché garde sa bande de droite, assez large", () => {
    for (const [largeur, hauteur] of [
      [844, 390],
      [932, 430],
    ] as const) {
      const ecran = ecranDe(largeur, hauteur);
      const place = placeDeLaParole(ecran, largeur, hauteur);
      expect(place.surEcran).toBe(false);
      expect(place.rect).toEqual(plusGrandLibre(ecran, largeur, hauteur));
      expect(place.rect.w).toBeGreaterThanOrEqual(150);
    }
  });
});

describe("le squelette avant le script (front/index.html)", () => {
  type Fs = { readFileSync: (chemin: string, codage: string) => string };
  type Vm = { runInNewContext: (code: string, contexte: Record<string, unknown>) => unknown };

  /** Le corps de la page source, et son script classique exécuté comme le
   * navigateur le ferait, pour une adresse et une largeur gardée. */
  async function statique(chemin: string, colonne: string | null) {
    const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
    const { runInNewContext } = (await import(/* @vite-ignore */ `node:${"vm"}`)) as Vm;
    // Par une variable : Vite réécrit `new URL("…", import.meta.url)` écrit en
    // toutes lettres en adresse d'un fichier servi.
    const relatif = "../../index.html";
    const source = fs.readFileSync(new URL(relatif, import.meta.url).pathname, "utf-8");
    const corps = /<body>([\s\S]*?)<\/body>/.exec(source)?.[1] ?? "";
    const scripts = [...corps.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    expect(scripts).toHaveLength(1);
    document.body.innerHTML = corps.replace(/<script[\s\S]*?<\/script>/g, "");
    localStorage.clear();
    if (colonne !== null) localStorage.setItem("nel3ab:colonne", colonne);
    runInNewContext(scripts[0] ?? "", {
      document,
      localStorage: window.localStorage,
      location: { pathname: chemin },
      Number,
      Math,
    });
    const racine = document.getElementById("root") as HTMLElement;
    return {
      h1: racine.querySelector("h1")?.textContent,
      dit: racine.querySelector("[role=status]")?.textContent,
      largeur: racine.style.getPropertyValue("--ouverture-colonne"),
      starts: racine.querySelectorAll(".rt-bouton-start[data-libre]").length,
    };
  }

  it("dit « On ouvre la salle 2… » sous /r/2/, avec la largeur gardée", async () => {
    expect(await statique("/r/2/", "400")).toEqual({
      h1: "Salle 2",
      dit: "On ouvre la salle 2…",
      largeur: "400px",
      starts: 4,
    });
  });

  it("le jumeau : à la racine la salle 1, et une largeur qui n'est pas un entier ne passe pas", async () => {
    expect(await statique("/", "304px")).toEqual({
      h1: "Salle 1",
      dit: "On ouvre la salle 1…",
      largeur: "",
      starts: 4,
    });
  });

  it("une largeur hors des bornes est ramenée entre 256 et 480, comme `clampColumn`", async () => {
    expect((await statique("/r/1/", "9000")).largeur).toBe("480px");
    expect((await statique("/r/1/", "10")).largeur).toBe("256px");
  });
});
