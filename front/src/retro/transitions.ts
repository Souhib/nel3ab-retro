/**
 * Les transitions entre deux écrans: fondu par paliers, mosaïque, iris,
 * tuiles, coupure de signal, défilement, extinction du tube.
 *
 * # Une transition, un moment
 *
 * La page des effets ne jouait qu'une transition à la fois, la dernière
 * allumée. Dans la page, chaque MOMENT a sa transition préférée, et retombe
 * sur le fondu quand le niveau choisi ne l'allume pas (`choisirTransition`):
 * entrer dans une salle fait des tuiles en « tout », une mosaïque en
 * « conseillé », un fondu en « sobre ».
 *
 * # L'image du jeu s'efface d'abord
 *
 * Avant toute transition, les zones de jeu de la surface sont cachées
 * (`cacherLImage`): la transition ne passe jamais sur l'image, ni ne la
 * filtre, ni ne la déplace. Elles reviennent à la fin, même si l'écran
 * suivant lève une erreur.
 *
 * # Mouvement réduit, navigateur sans animations
 *
 * Sans mouvement, l'écran change d'un coup: `milieu` est appelé seul. Un
 * navigateur sans `Element.animate` fait pareil.
 */
import { effetActif, mouvementReduit } from "../lib/effets";
import { bruit, CARRES_MOSAIQUE, filtreMosaique, poserFiltresMosaique } from "./calques";
import { cacherLImage } from "./image";
import { courbe } from "./paliers";

export const TRANSITIONS = [
  "fondu",
  "mosaique",
  "iris",
  "tuiles",
  "coupure",
  "defile",
  "extinction",
] as const;
export type TypeTransition = (typeof TRANSITIONS)[number];

/** Les moments où un écran change, et leur transition, de la plus marquée à
 * la plus sobre. Les lieux sont ceux que la page des effets donnait à chacune. */
export const MOMENTS = {
  ecran: ["fondu"],
  "entrer-salle": ["tuiles", "mosaique", "fondu"],
  "sortir-salle": ["mosaique", "fondu"],
  "quitter-partie": ["iris", "mosaique", "fondu"],
  "changer-jeu": ["coupure", "fondu"],
  page: ["defile", "fondu"],
  "fermer-salle": ["extinction", "fondu"],
} as const satisfies Record<string, readonly TypeTransition[]>;
export type Moment = keyof typeof MOMENTS;

/** La transition de ce moment, selon le niveau choisi; `null` quand rien ne
 * doit bouger (aucune allumée, ou mouvement réduit). */
export function choisirTransition(moment: Moment): TypeTransition | null {
  if (mouvementReduit()) return null;
  return MOMENTS[moment].find((type) => effetActif(type)) ?? null;
}

const attendre = (ms: number) => new Promise<void>((fin) => window.setTimeout(fin, ms));

type Jeu = (cible: HTMLElement, milieu: () => Promise<void>) => Promise<void>;

/** Un calque posé dans la cible le temps de la transition. */
function calque<T extends HTMLElement>(cible: HTMLElement, balise: string, classe: string): T {
  const el = document.createElement(balise) as T;
  el.className = classe;
  el.setAttribute("aria-hidden", "true");
  cible.append(el);
  return el;
}

const JEUX: Record<TypeTransition, Jeu> = {
  /** Quatre paliers vers le noir, l'écran suivant, quatre paliers retour. */
  async fondu(cible, milieu) {
    const voile = calque(cible, "div", "rt-voile");
    try {
      await voile.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 240,
        easing: "steps(4, end)",
        fill: "forwards",
      }).finished;
      await milieu();
      await voile.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 240,
        easing: "steps(4, end)",
        fill: "forwards",
      }).finished;
    } finally {
      voile.remove();
    }
  },
  /** Des carrés de plus en plus gros, l'écran suivant, puis de plus en plus
   * petits: l'effet mosaïque de la Super Nintendo, par filtres SVG. */
  async mosaique(cible, milieu) {
    poserFiltresMosaique();
    const avant = cible.style.filter;
    try {
      for (const taille of CARRES_MOSAIQUE) {
        cible.style.filter = `url(#${filtreMosaique(taille)})`;
        await attendre(70);
      }
      await milieu();
      await attendre(40);
      for (const taille of [...CARRES_MOSAIQUE].reverse()) {
        cible.style.filter = `url(#${filtreMosaique(taille)})`;
        await attendre(70);
      }
    } finally {
      cible.style.filter = avant;
    }
  },
  /** Un cercle se referme sur le centre, puis s'ouvre sur l'écran suivant. */
  async iris(cible, milieu) {
    const ferme = cible.animate(
      [{ clipPath: "circle(75% at 50% 50%)" }, { clipPath: "circle(0% at 50% 50%)" }],
      { duration: 380, easing: courbe("ease-in", 8), fill: "forwards" },
    );
    await ferme.finished;
    await milieu();
    const ouvre = cible.animate(
      [{ clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)" }],
      { duration: 380, easing: courbe("ease-out", 8), fill: "forwards" },
    );
    try {
      await ouvre.finished;
    } finally {
      ferme.cancel();
      ouvre.cancel();
    }
  },
  /** Des tuiles couvrent l'écran en diagonale, puis le découvrent. */
  async tuiles(cible, milieu) {
    const grille = calque(cible, "div", "rt-tuiles");
    const tuiles: [HTMLElement, number][] = [];
    for (let y = 0; y < 10; y += 1)
      for (let x = 0; x < 16; x += 1) tuiles.push([calque(grille, "i", ""), x + y]);
    const vague = (de: string, a: string) =>
      Promise.all(
        tuiles.map(
          ([tuile, rang]) =>
            tuile.animate([{ transform: de }, { transform: a }], {
              duration: 140,
              delay: rang * 16,
              easing: "steps(3, end)",
              fill: "forwards",
            }).finished,
        ),
      );
    try {
      await vague("scale(0)", "scale(1)");
      await milieu();
      await vague("scale(1)", "scale(0)");
    } finally {
      grille.remove();
    }
  },
  /** Un quart de seconde de neige, comme en changeant de chaîne. */
  async coupure(cible, milieu) {
    const toile = calque<HTMLCanvasElement>(cible, "canvas", "rt-neige-transition");
    toile.width = 120;
    toile.height = 75;
    bruit(toile);
    const minuterie = window.setInterval(() => bruit(toile), 45);
    try {
      await attendre(130);
      await milieu();
      await attendre(130);
    } finally {
      window.clearInterval(minuterie);
      toile.remove();
    }
  },
  /** L'écran part sur le côté et le suivant arrive, comme un niveau qui défile. */
  async defile(cible, milieu) {
    const part = cible.animate(
      [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
      {
        duration: 260,
        easing: courbe("ease-in", 6),
        fill: "forwards",
      },
    );
    await part.finished;
    await milieu();
    const arrive = cible.animate(
      [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }],
      { duration: 260, easing: courbe("ease-out", 6), fill: "forwards" },
    );
    try {
      await arrive.finished;
    } finally {
      part.cancel();
      arrive.cancel();
    }
  },
  /** L'écran s'écrase en une ligne, puis en un point, comme une borne qu'on
   * éteint; l'écran suivant s'allume ensuite. */
  async extinction(cible, milieu) {
    const eteint = cible.animate(
      [
        { transform: "scale(1, 1)", filter: "brightness(1)" },
        { transform: "scale(1, 0.008)", filter: "brightness(4)", offset: 0.5 },
        { transform: "scale(0.004, 0.008)", filter: "brightness(4)", offset: 0.85 },
        { transform: "scale(0, 0)", filter: "brightness(4)" },
      ],
      { duration: 650, easing: "ease-in", fill: "forwards" },
    );
    await eteint.finished;
    await milieu();
    await attendre(260);
    const allume = cible.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 220,
      fill: "forwards",
    });
    eteint.cancel();
    try {
      await allume.finished;
    } finally {
      allume.cancel();
    }
  },
};

/** Ce qu'il a fallu poser sur la cible pour que ses calques s'y placent. */
function positionner(cible: HTMLElement): () => void {
  if (getComputedStyle(cible).position !== "static") return () => {};
  const avant = cible.style.position;
  cible.style.position = "relative";
  return () => {
    cible.style.position = avant;
  };
}

/**
 * Joue une transition sur une surface: `milieu` change l'écran, au moment où
 * la surface est couverte. `type` vient d'ordinaire de `choisirTransition`;
 * `null`, un effet éteint, le mouvement réduit ou un navigateur sans
 * animations changent l'écran d'un coup. Les zones de jeu de la surface sont
 * cachées avant, et remontrées après, quoi qu'il arrive.
 */
export async function transition(
  type: TypeTransition | null,
  cible: HTMLElement,
  milieu: () => void | Promise<void>,
): Promise<void> {
  const changer = async () => {
    await milieu();
  };
  if (
    type === null ||
    !effetActif(type) ||
    mouvementReduit() ||
    typeof cible.animate !== "function"
  ) {
    await changer();
    return;
  }
  const remontrer = cacherLImage(cible);
  const remettre = positionner(cible);
  try {
    await JEUX[type](cible, changer);
  } finally {
    remettre();
    remontrer();
  }
}
