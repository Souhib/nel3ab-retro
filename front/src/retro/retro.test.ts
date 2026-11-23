/**
 * Les utilitaires des effets rétro. Chaque essai pose le niveau par la vraie
 * clé de l'appareil, comme la page le lirait, et chaque effet a son jumeau:
 * éteint, refusé sur l'image du jeu, ou figé en mouvement réduit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLE, oublierPourEssai, type Niveau } from "../lib/effets";
import { ZONE_JEU } from "../lib/focus-jeu";
import { initiales, surInactivite, surStart } from "./arcade";
import { neige, poserCalquesAttente, poserCalquesUi } from "./calques";
import { ecrireChiffres, fantome, poserAfficheur } from "./chiffres";
import { activerCurseur } from "./curseur";
import { ICONES_PIXEL, iconePixelSVG } from "./icones";
import { cacherLImage, IMAGE_CACHEE, toucheLImage } from "./image";
import { annoncerLettres } from "./lettres";
import { courbe } from "./paliers";
import { pointeurCSS } from "./pointeur";
import { secouer } from "./secousse";
import { oublierContexte, sonMenu } from "./sons";
import { choisirTransition, transition } from "./transitions";

type Fs = { readFileSync: (chemin: string, codage: "utf-8") => string };
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;

function regler(niveau: Niveau, sons = false) {
  localStorage.setItem(CLE, JSON.stringify({ niveau, sons }));
  oublierPourEssai();
}

function reduit(oui: boolean) {
  vi.stubGlobal("matchMedia", (requete: string) => ({
    matches: oui && requete.includes("reduce"),
  }));
}

/** Une page: une surface d'interface, et la zone de jeu à côté. */
function page() {
  document.body.innerHTML = `
    <main id="surface"><button id="un">un</button><button id="deux">deux</button></main>
    <section id="salle"><div id="zone" ${ZONE_JEU}><canvas id="screen"></canvas></div><aside id="colonne"></aside></section>
    <button id="dehors">dehors</button>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  return {
    surface: get("surface"),
    salle: get("salle"),
    zone: get("zone"),
    colonne: get("colonne"),
  };
}

/** `Element.animate` n'existe pas dans jsdom: une animation finie tout de suite. */
function animations() {
  const appels: { el: Element; images: unknown }[] = [];
  const animer = vi.fn(function (this: Element, images: unknown) {
    appels.push({ el: this, images });
    return {
      finished: Promise.resolve(),
      cancel: () => {},
      finish: () => {},
    } as unknown as Animation;
  });
  Object.defineProperty(Element.prototype, "animate", {
    value: animer,
    configurable: true,
    writable: true,
  });
  return appels;
}

beforeEach(() => {
  localStorage.clear();
  oublierPourEssai();
  reduit(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
  oublierContexte();
});

describe("l'image du jeu", () => {
  it("reconnaît la zone, ce qui est dedans et ce qui la contient, pas le reste", () => {
    const { surface, salle, zone, colonne } = page();
    expect(toucheLImage(zone)).toBe(true);
    expect(toucheLImage(document.getElementById("screen") as Element)).toBe(true);
    expect(toucheLImage(salle)).toBe(true);
    expect(toucheLImage(surface)).toBe(false);
    expect(toucheLImage(colonne)).toBe(false);
  });

  it("cache les zones d'une surface et les remontre", () => {
    const { salle, zone } = page();
    const remontrer = cacherLImage(salle);
    expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(true);
    remontrer();
    expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(false);
  });

  it("la feuille cache vraiment la zone marquée", () => {
    const css = fs.readFileSync(ici("../effets.css"), "utf-8");
    expect(css).toMatch(/\[data-transition-image\]\s*\{\s*visibility: hidden;/);
  });
});

describe("les transitions", () => {
  it("chaque moment prend la plus marquée que le niveau allume", () => {
    regler("tout");
    expect(choisirTransition("entrer-salle")).toBe("tuiles");
    expect(choisirTransition("fermer-salle")).toBe("extinction");
    regler("conseille");
    expect(choisirTransition("entrer-salle")).toBe("mosaique");
    expect(choisirTransition("quitter-partie")).toBe("mosaique");
    expect(choisirTransition("changer-jeu")).toBe("fondu");
    regler("sobre");
    expect(choisirTransition("entrer-salle")).toBe("fondu");
    expect(choisirTransition("fermer-salle")).toBe("fondu");
  });

  it("rien ne bouge en mouvement réduit", () => {
    regler("tout");
    reduit(true);
    expect(choisirTransition("entrer-salle")).toBeNull();
  });

  it("cache l'image avant de couvrir l'écran, et la remontre après", async () => {
    regler("sobre");
    const appels = animations();
    const { salle, zone } = page();
    let cacheeAuMilieu = false;
    await transition("fondu", salle, () => {
      cacheeAuMilieu = zone.hasAttribute(IMAGE_CACHEE);
    });
    expect(cacheeAuMilieu).toBe(true);
    expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(false);
    // Le voile a été animé, puis retiré.
    expect(appels.length).toBe(2);
    expect(appels[0]?.el.classList.contains("rt-voile")).toBe(true);
    expect(salle.querySelector(".rt-voile")).toBeNull();
  });

  it("remontre l'image même quand l'écran suivant lève une erreur", async () => {
    regler("sobre");
    animations();
    const { salle, zone } = page();
    await expect(
      transition("fondu", salle, () => {
        throw new Error("écran cassé");
      }),
    ).rejects.toThrow("écran cassé");
    expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(false);
    expect(salle.querySelector(".rt-voile")).toBeNull();
  });

  it("change l'écran d'un coup quand l'effet est éteint, sans rien animer", async () => {
    regler("sobre");
    const appels = animations();
    const { salle, zone } = page();
    const milieu = vi.fn(() => {
      expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(false);
    });
    await transition("tuiles", salle, milieu);
    await transition(null, salle, milieu);
    expect(milieu).toHaveBeenCalledTimes(2);
    expect(appels).toHaveLength(0);
  });

  it("change l'écran d'un coup sans Element.animate", async () => {
    regler("tout");
    const { salle } = page();
    const milieu = vi.fn();
    await transition("iris", salle, milieu);
    expect(milieu).toHaveBeenCalledTimes(1);
  });

  it("les tuiles couvrent la surface puis s'en vont", async () => {
    regler("tout");
    const appels = animations();
    const { salle } = page();
    let tuilesAuMilieu = 0;
    await transition("tuiles", salle, () => {
      tuilesAuMilieu = salle.querySelectorAll(".rt-tuiles > i").length;
    });
    expect(tuilesAuMilieu).toBe(160);
    expect(appels).toHaveLength(320);
    expect(salle.querySelector(".rt-tuiles")).toBeNull();
  });
});

describe("le curseur ▶", () => {
  it("suit le focus dans sa surface, et pas dehors", () => {
    const { surface } = page();
    const curseur = activerCurseur(surface);
    const fleche = surface.querySelector(".rt-curseur") as HTMLElement;
    expect(fleche).not.toBeNull();
    expect(fleche.getAttribute("aria-hidden")).toBe("true");
    (document.getElementById("un") as HTMLElement).focus();
    expect(fleche.hasAttribute("data-visible")).toBe(true);
    // Le jumeau: le focus qui sort de la surface cache le ▶.
    (document.getElementById("dehors") as HTMLElement).focus();
    expect(fleche.hasAttribute("data-visible")).toBe(false);
    curseur.arreter();
    expect(surface.querySelector(".rt-curseur")).toBeNull();
  });

  it("refuse une surface qui contient l'image du jeu", () => {
    const { salle } = page();
    activerCurseur(salle);
    expect(salle.querySelector(".rt-curseur")).toBeNull();
  });

  it("ne reçoit jamais le pointeur, et clignote une fois par seconde au plus", () => {
    const css = fs.readFileSync(ici("../effets.css"), "utf-8");
    const regle = /\.rt-curseur \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(regle).toContain("pointer-events: none");
    expect(css).toMatch(
      /\.rt-curseur > svg \{[^}]*animation: rt-clignote 1s steps\(1, end\) infinite/,
    );
  });
});

describe("les sons de menu", () => {
  /** Un contexte audio qui compte ses oscillateurs. */
  function audio() {
    const oscillateurs: number[] = [];
    class Contexte {
      state = "running";
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createOscillator() {
        const osc = {
          type: "",
          frequency: { setValueAtTime: (f: number) => oscillateurs.push(f) },
          connect: (g: unknown) => g,
          start: () => {},
          stop: () => {},
        };
        return osc;
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: (d: unknown) => d,
        };
      }
    }
    vi.stubGlobal("AudioContext", Contexte);
    return oscillateurs;
  }

  it("se taisent par défaut, à tous les niveaux", () => {
    const joues = audio();
    regler("tout");
    expect(sonMenu("piece")).toBe(false);
    expect(joues).toEqual([]);
  });

  it("jouent quand on les demande", () => {
    const joues = audio();
    regler("sobre", true);
    expect(sonMenu("piece")).toBe(true);
    expect(joues).toEqual([988, 1319]);
  });

  it("jamais pendant que le jeu a le focus", () => {
    const joues = audio();
    regler("conseille", true);
    const { zone } = page();
    zone.tabIndex = 0;
    zone.focus();
    expect(sonMenu("bip")).toBe(false);
    // Le jumeau: le focus rendu à l'interface, le bip revient.
    (document.getElementById("un") as HTMLElement).focus();
    expect(sonMenu("bip")).toBe(true);
    expect(joues).toEqual([880]);
  });
});

describe("l'annonce lettre par lettre", () => {
  function boite() {
    document.body.innerHTML =
      '<div class="rt-lettres"><span id="texte"></span><span class="rt-suite">▼</span></div><p id="region" role="status"></p>';
    return {
      texte: document.getElementById("texte") as HTMLElement,
      region: document.getElementById("region") as HTMLElement,
      boite: document.querySelector(".rt-lettres") as HTMLElement,
    };
  }

  it("donne toute la phrase au lecteur d'écran, et l'écrit lettre par lettre à l'écran", async () => {
    vi.useFakeTimers();
    regler("tout");
    const { texte, region, boite: cadre } = boite();
    const annonce = annoncerLettres(texte, "Lina arrive.", { region });
    expect(region.textContent).toBe("Lina arrive.");
    expect(texte.getAttribute("aria-hidden")).toBe("true");
    vi.advanceTimersByTime(28 * 4);
    expect(texte.textContent).toBe("Lina");
    vi.advanceTimersByTime(28 * 20);
    await annonce.fini;
    expect(texte.textContent).toBe("Lina arrive.");
    expect(texte.hasAttribute("aria-hidden")).toBe(false);
    expect(cadre.hasAttribute("data-fini")).toBe(true);
    // Le ▼ ne reste pas dans le texte: il est à côté.
    expect(cadre.querySelector(".rt-suite")).not.toBeNull();
  });

  it("un clic affiche tout", () => {
    vi.useFakeTimers();
    regler("tout");
    const { texte, region, boite: cadre } = boite();
    annoncerLettres(texte, "Une longue phrase.", { region });
    vi.advanceTimersByTime(28 * 2);
    cadre.click();
    expect(texte.textContent).toBe("Une longue phrase.");
  });

  it("une erreur s'affiche d'un coup, même avec l'effet", () => {
    regler("tout");
    const { texte, region, boite: cadre } = boite();
    annoncerLettres(texte, "La manette ne répond plus.", { region, erreur: true });
    expect(texte.textContent).toBe("La manette ne répond plus.");
    expect(cadre.hasAttribute("data-erreur")).toBe(true);
  });

  it("d'un coup sans l'effet, sans région, ou en mouvement réduit", () => {
    const { texte, region } = boite();
    regler("conseille");
    annoncerLettres(texte, "Un.", { region });
    expect(texte.textContent).toBe("Un.");
    regler("tout");
    annoncerLettres(texte, "Deux.");
    expect(texte.textContent).toBe("Deux.");
    reduit(true);
    annoncerLettres(texte, "Trois.", { region });
    expect(texte.textContent).toBe("Trois.");
  });
});

describe("l'afficheur et le compteur", () => {
  it("pose le fantôme, caché aux lecteurs d'écran, et la valeur lisible", () => {
    const el = document.createElement("span");
    poserAfficheur(el, "21:14:07");
    expect(fantome("21:14:07")).toBe("88:88:88");
    const ombre = el.querySelector(".rt-afficheur-fantome");
    expect(ombre?.getAttribute("aria-hidden")).toBe("true");
    expect(ombre?.textContent).toBe("88:88:88");
    expect(el.querySelector(".rt-afficheur-valeur")?.textContent).toBe("21:14:07");
  });

  it("fait rouler les chiffres qui changent, au niveau « tout »", () => {
    regler("tout");
    const el = document.createElement("span");
    ecrireChiffres(el, "00:12:34");
    ecrireChiffres(el, "00:12:35");
    const roulent = [...el.querySelectorAll(".rt-roule")].map((s) => s.textContent);
    expect(roulent).toEqual(["5"]);
    expect(el.textContent).toBe("00:12:35");
  });

  it("ne roule pas sans l'effet, ni en mouvement réduit", () => {
    regler("conseille");
    const el = document.createElement("span");
    ecrireChiffres(el, "1");
    ecrireChiffres(el, "2");
    expect(el.querySelector(".rt-roule")).toBeNull();
    regler("tout");
    reduit(true);
    ecrireChiffres(el, "3");
    expect(el.querySelector(".rt-roule")).toBeNull();
  });
});

describe("la secousse", () => {
  it("niveau « tout » seulement, et jamais sur l'image", () => {
    const appels = animations();
    const { surface, salle } = page();
    regler("conseille");
    expect(secouer(surface)).toBe(false);
    regler("tout");
    expect(secouer(surface)).toBe(true);
    expect(secouer(salle)).toBe(false);
    reduit(true);
    expect(secouer(surface)).toBe(false);
    expect(appels).toHaveLength(1);
  });
});

describe("les calques", () => {
  it("un écran d'attente reçoit ses trois calques, l'image aucun", () => {
    const { surface, salle } = page();
    const retirer = poserCalquesAttente(surface);
    expect([...surface.querySelectorAll("i")].map((i) => i.className)).toEqual([
      "rt-calque-balayage",
      "rt-calque-vignette",
      "rt-calque-roulement",
    ]);
    poserCalquesAttente(salle);
    expect(salle.querySelector("[class^='rt-calque']")).toBeNull();
    retirer();
    expect(surface.querySelector("i")).toBeNull();
  });

  it("les calques d'interface vivent dans leur surface, jamais dans la zone de jeu", () => {
    const { colonne, salle } = page();
    poserCalquesUi(colonne);
    expect(colonne.querySelectorAll(".rt-calques-ui > i")).toHaveLength(3);
    poserCalquesUi(salle);
    expect(salle.querySelectorAll(".rt-calques-ui")).toHaveLength(1);
    expect(salle.querySelector(`[${ZONE_JEU}] .rt-calques-ui`)).toBeNull();
    poserCalquesUi(document.body, { page: true });
    expect(document.querySelector(".rt-calques-ui.rt-calques-page")).toBeNull();
  });

  it("la neige remplace l'image cachée, et refuse de passer dessus", () => {
    regler("conseille");
    const { zone } = page();
    const toile = document.createElement("canvas");
    zone.append(toile);
    neige(toile);
    expect(toile.hasAttribute("data-actif")).toBe(false);
    const arreter = neige(toile, { remplace: zone });
    expect(toile.hasAttribute("data-actif")).toBe(true);
    expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(true);
    arreter();
    expect(zone.hasAttribute(IMAGE_CACHEE)).toBe(false);
    regler("sobre");
    neige(toile, { remplace: zone });
    expect(toile.hasAttribute("data-actif")).toBe(false);
  });
});

describe("l'arcade", () => {
  it("trois initiales sans accent", () => {
    expect(initiales("Lina")).toBe("LIN");
    expect(initiales("Élodie")).toBe("ELO");
    expect(initiales("Jean-Pierre")).toBe("JEA");
    expect(initiales("Bo")).toBe("BO");
    expect(initiales("  42 ")).toBe("---");
  });

  it("APPUIE SUR START: Entrée hors d'un bouton, au niveau qui l'allume", () => {
    const rappel = vi.fn();
    page();
    regler("conseille");
    const arreter = surStart(rappel);
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(rappel).toHaveBeenCalledTimes(1);
    // Entrée sur un bouton garde son sens: elle active le bouton.
    (document.getElementById("un") as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    // Une touche maintenue ne rouvre rien.
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", repeat: true, bubbles: true }),
    );
    expect(rappel).toHaveBeenCalledTimes(1);
    regler("sobre");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(rappel).toHaveBeenCalledTimes(1);
    arreter();
    regler("conseille");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(rappel).toHaveBeenCalledTimes(1);
  });

  it("le mode démo part après l'inactivité, et le premier geste l'arrête", () => {
    vi.useFakeTimers();
    regler("tout");
    const { surface } = page();
    const lancer = vi.fn();
    const arreter = vi.fn();
    const fin = surInactivite(surface, 30_000, { lancer, arreter });
    vi.advanceTimersByTime(29_000);
    expect(lancer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(lancer).toHaveBeenCalledTimes(1);
    expect(surface.hasAttribute("data-demo")).toBe(true);
    document.dispatchEvent(new Event("keydown"));
    expect(arreter).toHaveBeenCalledTimes(1);
    expect(surface.hasAttribute("data-demo")).toBe(false);
    fin();
  });

  it("pas de démo sans l'effet ni en mouvement réduit", () => {
    vi.useFakeTimers();
    const { surface } = page();
    const lancer = vi.fn();
    regler("conseille");
    const fin = surInactivite(surface, 1_000, { lancer });
    vi.advanceTimersByTime(2_000);
    regler("tout");
    reduit(true);
    document.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(2_000);
    expect(lancer).not.toHaveBeenCalled();
    fin();
  });
});

describe("le dessin en pixels", () => {
  it("chaque icône couvre exactement ses cases", () => {
    for (const [nom, grille] of Object.entries(ICONES_PIXEL)) {
      const svg = iconePixelSVG(nom as keyof typeof ICONES_PIXEL);
      const d = /d="([^"]+)"/.exec(svg)?.[1] ?? "";
      const couvertes = [...d.matchAll(/M\d+ \d+h(\d+)v1/g)].reduce((n, m) => n + Number(m[1]), 0);
      const allumees = grille.join("").split("#").length - 1;
      expect(couvertes, nom).toBe(allumees);
    }
  });

  it("la flèche de souris de la feuille est celle de la grille", () => {
    // La feuille porte la valeur toute faite: un pixel changé dans la grille
    // sans recopier la valeur fait échouer cet essai.
    const css = fs.readFileSync(ici("../effets.css"), "utf-8");
    const valeur = /--rt-pointeur:\s*([\s\S]*?);/.exec(css)?.[1]?.replace(/\s+/g, " ").trim();
    expect(valeur).toBe(pointeurCSS());
  });

  it("les paliers: des marches seulement quand l'effet est allumé", () => {
    regler("conseille");
    expect(courbe("ease-out", 3)).toBe("ease-out");
    regler("tout");
    expect(courbe("ease-out", 3)).toBe("steps(3, end)");
    expect(() => courbe("ease", 0)).toThrow();
  });
});
