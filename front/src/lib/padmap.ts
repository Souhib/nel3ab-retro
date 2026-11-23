/**
 * Où se trouve chaque commande sur une manette, et à quoi la manette ressemble.
 *
 * # Des manettes reconnaissables, pas des schémas
 *
 * Ce qu'on cherche est de pouvoir DÉSIGNER une touche : « celle-là, en haut à
 * droite ». Le 21 novembre 2026, Souhib a trouvé les dessins de septembre
 * « très moches », sans ressemblance avec les vraies manettes. Ils étaient
 * tracés à main levée. Les silhouettes et la place des touches viennent
 * maintenant de photos vues de dessus, relevées dans un repère de 100 de
 * large (`outils` du carnet, entrée du 21 novembre). Le dessin reste à nous :
 * des tracés SVG, sans photo ni logo, ce qui garde la page légère, nette à
 * toute taille, et loin des marques.
 *
 * Le volume (dégradés, reflets, logements, ombres) est rendu par
 * `components/PadMap.tsx` pour toutes les manettes de la même façon. Un plan
 * ne déclare que des formes et des couleurs de matière.
 *
 * # Des DONNÉES et pas du balisage
 *
 * Deux manettes à l'écran — celle que le jeu voit et celle qu'on tient — et
 * une Wiimote et une guitare. Un composant qui dessine n'importe quel plan
 * coûte un fichier; quatre composants qui dessinent chacun le leur coûtent
 * quatre fichiers qui divergent.
 */
import type { PadIdentity } from "../media/families";

/** Une couleur de touche, NOMMÉE : sa valeur vit dans `regie.css`
 * (`--manette-<nom>`, D3), la même dans les deux thèmes. Une touche porte la
 * couleur de la VRAIE manette : on reconnaît le A d'une GameCube à son vert
 * d'eau avant d'avoir lu la lettre. Un plan nomme, il n'écrit aucune valeur
 * (`lib/manettes-couleurs.test.ts` vérifie que chaque nom est déclaré). */
export type Matiere =
  | "gamecube-gachette"
  | "gamecube-gachette-encre"
  | "gamecube-z"
  | "gamecube-touche"
  | "gamecube-c"
  | "gamecube-c-encre"
  | "gamecube-a"
  | "gamecube-a-encre"
  | "gamecube-b"
  | "gamecube-start"
  | "gamecube-xy-encre"
  | "blanc"
  | "xbox-lettres"
  | "xbox-a"
  | "xbox-b"
  | "xbox-x"
  | "xbox-y"
  | "xbox-guide"
  | "xbox-guide-encre"
  | "standard-touche"
  | "standard-encre"
  | "wiimote-viseur"
  | "wiimote-secousse"
  | "guitare-verte"
  | "guitare-rouge"
  | "guitare-jaune"
  | "guitare-bleue"
  | "guitare-orange"
  | "guitare-vibrato";
/** La couleur que la feuille donne à un nom : le seul type qu'une pièce
 * accepte, si bien qu'une valeur écrite en dur ne compile pas. */
export type Couleur = `var(--manette-${Matiere})`;
const m = (nom: Matiere): Couleur => `var(--manette-${nom})`;

/**
 * Un symbole DESSINÉ dans la pièce, en chemin SVG autour de l'origine.
 *
 * La croix, le carré, le rond et le triangle d'une PlayStation s'écrivent en
 * texte, mais aucune des polices de la page ne garantit de les porter, et un
 * caractère absent rend un carré vide sans que rien ne le signale. On les
 * dessine donc, avec les mêmes règles de couleur que les étiquettes. Les
 * flèches en relief d'une croix directionnelle suivent la même règle.
 */
export const GLYPHS = {
  triangle: "M -1.9 1.35 L 1.9 1.35 L 0 -1.9 Z",
  croix: "M -1.7 -1.7 L 1.7 1.7 M 1.7 -1.7 L -1.7 1.7",
  rond: "M -1.75 0 A 1.75 1.75 0 1 0 1.75 0 A 1.75 1.75 0 1 0 -1.75 0",
  carre: "M -1.5 -1.5 L 1.5 -1.5 L 1.5 1.5 L -1.5 1.5 Z",
  haut: "M -0.7 0.35 L 0 -0.4 L 0.7 0.35",
  bas: "M -0.7 -0.35 L 0 0.4 L 0.7 -0.35",
  gauche: "M 0.35 -0.7 L -0.4 0 L 0.35 0.7",
  droite: "M -0.35 -0.7 L 0.4 0 L -0.35 0.7",
  anneau: "M -2.5 0 A 2.5 2.5 0 1 0 2.5 0 A 2.5 2.5 0 1 0 -2.5 0",
  vue: "M -1 -0.6 L 0.4 -0.6 L 0.4 0.4 M -0.4 -0.1 L 1 -0.1 L 1 0.9 L -0.4 0.9 Z",
  menu: "M -0.9 -0.6 L 0.9 -0.6 M -0.9 0 L 0.9 0 M -0.9 0.6 L 0.9 0.6",
} as const;

/** Un aplat décoratif : il ne s'allume jamais et ne se vise pas. */
export type Tone =
  | "plaque"
  | "grain"
  | "creux"
  | "logement"
  | "reflet"
  | "ombre"
  | "trait"
  | "bouton"
  | "voyant"
  | "lumiere"
  | "points"
  | "bord";
export type Layer = { tone: Tone; d: string };

/** Une pièce du dessin: sa clé, son nom, sa place, sa forme. */
export type Part = {
  /** Ce que cette pièce désigne. Une commande pour le plan émulé (`A`, `D_UP`),
   * un indice brut pour le plan physique (`b0`, `a1+`). */
  key: string;
  /** Ce qu'on écrit dessus ou à côté. Vide quand la forme se suffit. */
  label: string;
  x: number;
  y: number;
  /** Rayon pour un rond, demi-hauteur pour une pastille. C'est aussi la boîte
   * que les essais utilisent quand la pièce a un tracé exact (`d`). */
  r: number;
  shape: "rond" | "pastille";
  /** Une pastille est plus large que haute; ceci dit de combien. */
  wide?: number;
  /** Le contour exact, quand ni un disque ni une pastille ne ressemblent :
   * une branche de croix, un haricot, une gâchette. */
  d?: string;
  /** La couleur de la touche. Absente veut dire celle des touches de la manette. */
  tint?: Couleur;
  /** La couleur de son inscription ou de son symbole. */
  ink?: Couleur;
  /** Une gâchette ou une tranche : dessinée SOUS la coque, qui en cache le bas. */
  under?: boolean;
  /** Une branche d'une pièce plus grande (la croix) : pas de logement à elle. */
  flush?: boolean;
  /** Posée sur la coque mais en dépasse, comme le vibrato d'une guitare. */
  hangs?: boolean;
  /** La garde d'un stick, ronde ou octogonale comme sur une GameCube. */
  gate?: boolean | "octogone";
  /** Le dessus d'un stick : des anneaux, une cuvette, ou une cuvette bordée de stries. */
  grip?: "anneaux" | "cuvette" | "creux";
  /** Ce stick S'INCLINE avec son axe.
   *
   * « x » et « cx » pour le côté émulation (lue dans `readPad`), « a0 » et
   * « a2 » pour le côté physique (les axes du navigateur). C'est ce qui donne
   * à un stick l'air d'un stick: la boucle d'affichage déplace son capot du
   * côté où on pousse, comme sur un banc d'essai de manette.
   */
  stick?: "x" | "cx" | "a0" | "a2";
  /** Un symbole DESSINÉ au milieu, dans `GLYPHS`. */
  glyph?: string;
  /** La taille de l'inscription, dans le repère du plan. */
  size?: number;
  /** L'inscription écrite À CÔTÉ, au bout d'un trait, quand la pièce est trop
   * petite pour la porter (« viser », « secouer »). */
  callout?: { x: number; y: number; anchor?: "start" | "middle" | "end" };
};

export type PadMap = {
  id: string;
  name: string;
  /** Le cadre du dessin: par défaut `-2 -2 104 66`. */
  viewBox?: string;
  /** La silhouette du boîtier, en chemin SVG dans le même repère.
   *
   * Deux corps se déclarent en deux tracés fermés dans la même chaîne:
   * la Wiimote et son Nunchuk, par exemple. */
  body: string;
  /** Ce qui dépasse derrière la coque sans être une commande. */
  under?: Layer[];
  /** Les matières posées SUR la coque et découpées par elle : la plaque noire
   * d'une DualSense, le grain des poignées, les coutures, les logements. */
  art?: Layer[];
  /** Ce qui se pose par-dessus, hors commandes : les touches qu'aucun jeu ne
   * reçoit (HOME, POWER), les voyants, le haut-parleur, la base d'une croix. */
  deco?: Layer[];
  /** Un fil dessiné entre les corps: le câble du Nunchuk. */
  wire?: string;
  /** Là où le boîtier occupe le repère, pour qu'un essai vérifie que les pièces
   * se posent DESSUS. Le repère est plus grand que la manette: sans ça une pièce
   * peut tenir dedans et pendre à côté, ce qui est arrivé. Déclaré par le plan
   * plutôt que deviné, parce qu'une guitare et une manette n'occupent pas la même
   * partie de l'espace. */
  hull: { left: number; right: number; top: number; bottom: number };
  parts: Part[];
};

const f = (v: number) => String(Number(v.toFixed(2)));

/** Un octogone à plats horizontaux, décrit par sa demi-largeur entre plats. */
export function octagon(cx: number, cy: number, apothem: number): string {
  const R = apothem / Math.cos(Math.PI / 8);
  const points = Array.from({ length: 8 }, (_, k) => {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    return `${f(cx + R * Math.cos(a))} ${f(cy + R * Math.sin(a))}`;
  });
  return `M ${points.join(" L ")} Z`;
}

type Direction = "haut" | "bas" | "gauche" | "droite";

/** Une croix directionnelle : la base, et ses quatre branches qui s'allument
 * chacune. `half` est la demi-largeur d'une branche, `len` la distance du
 * centre au bout. Les branches s'arrêtent au carré central, qui reste à la
 * base : on voit quelle direction est tenue, pas toute la croix. */
export function dpad(
  cx: number,
  cy: number,
  half: number,
  len: number,
  keys: Record<Direction, string>,
): { base: string; parts: Part[] } {
  const round = Math.min(half * 0.45, 1);
  // Repère local: u vers le bout de la branche, v en travers.
  const at = (dir: Direction, u: number, v: number): [number, number] =>
    dir === "haut"
      ? [cx + v, cy - u]
      : dir === "bas"
        ? [cx - v, cy + u]
        : dir === "gauche"
          ? [cx - u, cy - v]
          : [cx + u, cy + v];
  const branch = (dir: Direction, from: number) => {
    const p = (u: number, v: number) => at(dir, u, v).map(f).join(" ");
    return (
      `M ${p(from, -half)} L ${p(len - round, -half)} Q ${p(len, -half)} ${p(len, round - half)} ` +
      `L ${p(len, half - round)} Q ${p(len, half)} ${p(len - round, half)} L ${p(from, half)} Z`
    );
  };
  const dirs: Direction[] = ["haut", "droite", "bas", "gauche"];
  // La base est la croix entière, en un seul tracé.
  const corner = (dir: Direction) => {
    const p = (u: number, v: number) => at(dir, u, v).map(f).join(" ");
    return (
      `${p(half, -half)} L ${p(len - round, -half)} Q ${p(len, -half)} ${p(len, round - half)} ` +
      `L ${p(len, half - round)} Q ${p(len, half)} ${p(len - round, half)} L `
    );
  };
  const base = `M ${dirs.map(corner).join("")}${at("haut", half, -half).map(f).join(" ")} Z`;
  const mid = (half + len) / 2;
  const parts = dirs.map((dir): Part => {
    const [x, y] = at(dir, mid, 0);
    const along = (len - half) / 2;
    const vertical = dir === "haut" || dir === "bas";
    return {
      key: keys[dir],
      label: "",
      x,
      y,
      r: vertical ? along : half,
      shape: "pastille",
      wide: vertical ? half / along : along / half,
      d: branch(dir, half),
      flush: true,
      glyph: GLYPHS[dir],
    };
  });
  return { base, parts };
}

/** Un haricot couché autour d'un centre : le X et le Y d'une GameCube
 * entourent son A. Angles en degrés, dans le sens de l'écran. */
export function kidney(
  cx: number,
  cy: number,
  radius: number,
  thick: number,
  from: number,
  to: number,
): string {
  const P = (deg: number, r: number) => {
    const a = (deg * Math.PI) / 180;
    return `${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  };
  const ro = radius + thick / 2;
  const ri = radius - thick / 2;
  const e = f(thick / 2);
  return (
    `M ${P(from, ro)} A ${f(ro)} ${f(ro)} 0 0 1 ${P(to, ro)} ` +
    `A ${e} ${e} 0 0 1 ${P(to, ri)} A ${f(ri)} ${f(ri)} 0 0 0 ${P(from, ri)} ` +
    `A ${e} ${e} 0 0 1 ${P(from, ro)} Z`
  );
}

/** Le même tracé vu dans un miroir vertical (x devient `2·axe − x`). Seules les
 * commandes absolues M, L, C et Q sont admises : leurs nombres vont par paires. */
export function mirrorX(d: string, axis = 50): string {
  if (/[^MLCQZ0-9.,\s-]/.test(d)) throw new Error(`mirrorX ne sait pas retourner « ${d} »`);
  let index = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (n) => (index++ % 2 === 0 ? f(2 * axis - Number(n)) : n));
}

/** Une touche de croix en flèche, à plat dehors et en pointe vers le centre,
 * comme sur une DualSense. `w` en travers, `h` le long de la branche. */
export function arrowKey(cx: number, cy: number, dir: Direction, w: number, h: number): string {
  const at = (u: number, v: number): string =>
    (dir === "haut"
      ? [cx + v, cy - u]
      : dir === "bas"
        ? [cx - v, cy + u]
        : dir === "gauche"
          ? [cx - u, cy - v]
          : [cx + u, cy + v]
    )
      .map(f)
      .join(" ");
  const out = h / 2;
  const shoulder = -h / 2 + w * 0.42;
  const k = w * 0.18;
  return (
    `M ${at(-h / 2, 0)} L ${at(shoulder, -w / 2)} L ${at(out - k, -w / 2)} ` +
    `Q ${at(out, -w / 2)} ${at(out, k - w / 2)} L ${at(out, w / 2 - k)} ` +
    `Q ${at(out, w / 2)} ${at(out - k, w / 2)} L ${at(shoulder, w / 2)} Z`
  );
}

const GC_DPAD = dpad(34.5, 44.2, 1.95, 5.75, {
  haut: "D_UP",
  bas: "D_DOWN",
  gauche: "D_LEFT",
  droite: "D_RIGHT",
});

/**
 * La manette que le jeu voit quand la salle présente une GameCube.
 *
 * Relevée sur une photo vue de dessus : deux poignées longues, un pont entre
 * elles qui descend en arrondi, le stick gauche haut dans son octogone et la
 * croix plus bas, le grand A vert d'eau entouré de deux haricots X et Y, le B
 * rouge en dessous, le stick C jaune en bas à droite. Les gâchettes L et R
 * dépassent derrière, et Z se pose sur l'épaule droite, côté intérieur.
 */
export const GAMECUBE: PadMap = {
  id: "gamecube",
  name: "manette GameCube",
  viewBox: "0 0 100 77",
  body:
    "M 44 3.2 C 41.9 3.4, 40 3.7, 38 4 C 36.1 4.3, 34.1 4.7, 32.2 5.2 C 30.4 5.6, 28.5 6.2, 26.6 6.8 " +
    "C 24.8 7.4, 23 8.1, 21.2 8.8 C 19.4 9.5, 17.5 10, 15.8 10.9 C 14.1 11.8, 12.3 12.8, 10.9 14.2 " +
    "C 9.6 15.5, 8.3 17.3, 7.5 19 C 6.7 20.8, 6.2 22.7, 6 24.7 C 5.9 26.6, 6.5 28.7, 6.5 30.7 " +
    "C 6.5 32.7, 6.1 34.7, 5.9 36.7 C 5.8 38.7, 5.6 40.7, 5.5 42.7 C 5.3 44.8, 5.2 46.8, 5.1 48.8 " +
    "C 5 50.9, 4.9 53, 4.9 55 C 5 57.1, 5.1 59.1, 5.4 61.1 C 5.6 63.1, 5.6 65.2, 6.3 67 " +
    "C 7 68.8, 8.2 71.2, 9.6 71.8 C 11 72.3, 13.5 71.4, 14.6 70.2 C 15.7 69, 15.8 66.6, 16.3 64.7 " +
    "C 16.8 62.8, 16.9 60.7, 17.3 58.8 C 17.7 56.9, 18 54.9, 18.6 53.1 C 19.2 51.2, 19.9 48.2, 20.9 47.8 " +
    "C 21.8 47.3, 23.2 49.3, 24.6 50.4 C 25.9 51.6, 27.2 53.5, 28.8 54.5 C 30.5 55.4, 32.6 55.9, 34.5 55.9 " +
    "C 36.4 55.9, 38.5 55.4, 40.1 54.5 C 41.7 53.5, 43.2 51.9, 44.3 50.3 C 45.4 48.7, 46.4 46.7, 46.5 44.9 " +
    "C 46.5 43.1, 45.6 41.1, 44.6 39.4 C 43.6 37.7, 40.6 36, 40.6 34.9 C 40.5 33.8, 42.9 33.1, 44.5 32.8 " +
    "C 46.2 32.6, 48.5 33.5, 50.5 33.5 C 52.5 33.5, 55.6 32.4, 56.5 32.9 C 57.5 33.5, 57 35.3, 56.5 36.8 " +
    "C 56 38.3, 53.9 40, 53.4 41.8 C 52.9 43.6, 52.8 45.9, 53.3 47.7 C 53.8 49.6, 54.9 51.5, 56.3 52.8 " +
    "C 57.6 54.1, 59.5 55.2, 61.3 55.7 C 63.2 56.2, 65.4 56, 67.3 55.7 C 69.2 55.5, 71.4 55.3, 72.8 54.2 " +
    "C 74.2 53.1, 74.5 50.1, 75.7 49.2 C 76.8 48.3, 78.6 47.9, 79.5 48.7 C 80.5 49.5, 80.9 52.3, 81.4 54.2 " +
    "C 81.9 56.1, 82.3 58, 82.7 59.9 C 83.1 61.9, 83.3 63.9, 83.8 65.7 C 84.3 67.6, 84.7 70.1, 85.9 71.1 " +
    "C 87.1 72.1, 89.7 72.6, 91 71.8 C 92.3 71.1, 93.2 68.5, 93.7 66.7 C 94.3 64.8, 94.2 62.7, 94.4 60.7 " +
    "C 94.6 58.7, 94.7 56.7, 94.7 54.7 C 94.8 52.7, 94.7 50.6, 94.6 48.6 C 94.5 46.6, 94.2 44.7, 94.1 42.6 " +
    "C 93.9 40.6, 93.9 38.5, 93.7 36.5 C 93.6 34.5, 93.1 32.5, 93 30.5 C 93 28.6, 93.5 26.6, 93.3 24.7 " +
    "C 93.1 22.7, 92.7 20.7, 91.9 19 C 91.1 17.2, 89.7 15.6, 88.5 14.1 C 87.4 12.6, 86.3 10.9, 84.8 9.7 " +
    "C 83.3 8.6, 81.4 7.8, 79.6 7.2 C 77.8 6.7, 75.7 6.7, 73.8 6.4 C 71.8 6.1, 70 5.8, 68.1 5.4 " +
    "C 66.2 5, 64.3 4.5, 62.4 4.1 C 60.4 3.8, 58.5 3.5, 56.4 3.3 C 54.4 3.2, 52.3 3.2, 50.2 3.2 " +
    "C 48.1 3.2, 46 3.1, 44 3.2 Z",
  deco: [
    { tone: "logement", d: GC_DPAD.base },
    { tone: "bouton", d: GC_DPAD.base },
  ],
  hull: { left: 4.9, right: 94.7, top: 1.5, bottom: 72.6 },
  parts: [
    {
      key: "L",
      label: "L",
      x: 19.4,
      y: 6.9,
      r: 2.6,
      shape: "pastille",
      wide: 2.6,
      under: true,
      d: "M 8.5 16 C 9 10, 13.5 6, 20 4.6 C 24 3.8, 27.4 4.2, 28.6 6.4 L 27 9 L 11 17.5 Z",
      tint: m("gamecube-gachette"),
      ink: m("gamecube-gachette-encre"),
      size: 3,
    },
    {
      key: "R",
      label: "R",
      x: 85.4,
      y: 7.4,
      r: 2.6,
      shape: "pastille",
      wide: 1.9,
      under: true,
      d: "M 92 17 C 91.6 11, 88 6.4, 82 4.4 C 78.6 3.3, 75.4 3.6, 74.4 5.8 L 76 9 L 89 18.5 Z",
      tint: m("gamecube-gachette"),
      ink: m("gamecube-gachette-encre"),
      size: 3,
    },
    {
      key: "Z",
      label: "Z",
      x: 72.4,
      y: 4.6,
      r: 2.4,
      shape: "pastille",
      wide: 2.2,
      under: true,
      d: "M 67 6.4 C 67 4.1, 69 2.4, 72.2 2.2 C 75.6 2, 78 3.2, 78.1 5.2 C 78.2 7.2, 76.4 8.2, 72.6 8.4 C 69 8.6, 67 8.2, 67 6.4 Z",
      tint: m("gamecube-z"),
      ink: m("blanc"),
      size: 2.6,
    },
    {
      key: "x",
      label: "",
      x: 22.2,
      y: 24.5,
      r: 5.6,
      shape: "rond",
      gate: "octogone",
      grip: "anneaux",
      stick: "x",
      tint: m("gamecube-touche"),
    },
    ...GC_DPAD.parts,
    { key: "START", label: "", x: 49.6, y: 25.6, r: 2, shape: "rond", tint: m("gamecube-start") },
    {
      key: "cx",
      label: "C",
      x: 64.3,
      y: 44.9,
      r: 5.6,
      shape: "rond",
      d: octagon(64.3, 44.9, 5.3),
      gate: "octogone",
      grip: "cuvette",
      stick: "cx",
      tint: m("gamecube-c"),
      ink: m("gamecube-c-encre"),
      size: 3.4,
    },
    {
      key: "A",
      label: "A",
      x: 77.2,
      y: 24.4,
      r: 5.3,
      shape: "rond",
      tint: m("gamecube-a"),
      ink: m("gamecube-a-encre"),
      size: 4,
    },
    {
      key: "B",
      label: "B",
      x: 67,
      y: 29.5,
      r: 3.5,
      shape: "rond",
      tint: m("gamecube-b"),
      ink: m("blanc"),
      size: 3,
    },
    {
      key: "Y",
      label: "Y",
      x: 74.6,
      y: 14.7,
      r: 2.6,
      shape: "pastille",
      wide: 1.6,
      d: kidney(77.2, 24.4, 10, 5.2, 241, 268),
      ink: m("gamecube-xy-encre"),
      size: 2.8,
    },
    {
      key: "X",
      label: "X",
      x: 87.3,
      y: 22.4,
      r: 4.2,
      shape: "pastille",
      wide: 0.62,
      d: kidney(77.2, 24.4, 10.3, 5.2, -24, 2),
      ink: m("gamecube-xy-encre"),
      size: 2.8,
    },
  ],
};

/**
 * La DualSense qu'on tient, quand le navigateur dit PlayStation.
 *
 * Relevée sur une photo de face, puis rendue symétrique (la photo est prise un
 * peu de biais). Une coque blanche en deux ailes, le pavé tactile en haut, la
 * plaque noire au milieu qui descend le long de l'intérieur des poignées, les
 * deux sticks à la même hauteur, les quatre flèches séparées. Les symboles
 * sont gris comme sur la vraie : la forme suffit à les reconnaître. Les
 * indices suivent la norme du navigateur, dont la PlayStation est la
 * référence.
 */
const DS_PLATE =
  "M 33.8 22.4 C 30.2 23.3, 27.4 26.2, 26.3 30 C 25.3 34, 24.6 37.5, 23.6 41 " +
  "C 22.2 46, 20.6 51, 18.9 56 C 17 61.5, 15 66, 12.6 71 L 12.6 80 L 50 80 L 50 23.2 " +
  "C 44 23.3, 38 23, 33.8 22.4 Z";
const DS_TOUCH =
  "M 32.4 7.4 L 67.6 7.4 C 68.3 7.4, 68.5 7.9, 68.4 8.5 L 66.4 21 " +
  "C 66.2 22, 65.6 22.4, 64.6 22.5 C 56 23.4, 44 23.4, 35.4 22.5 " +
  "C 34.4 22.4, 33.8 22, 33.6 21 L 31.6 8.5 C 31.5 7.9, 31.7 7.4, 32.4 7.4 Z";
const DS_BAR = "M 30.9 9 C 31.5 13, 32.2 17.5, 32.9 21.4";
const DS_GRILLE = Array.from({ length: 11 }, (_, i) => {
  const row = i < 6 ? 0 : 1;
  const x = 46.6 + (row ? 0.68 : 0) + (i - row * 6) * 1.36;
  return `M ${f(x)} ${row ? 26.6 : 25} l 0 0`;
}).join(" ");
const DS_TRIGGER = {
  l2: "M 15.5 9 C 16.2 4.6, 20 2, 24.6 1.6 C 27.8 1.3, 29.8 2.4, 30.2 4.8 L 30.2 9 L 16 10 Z",
  l1: "M 11.6 13 C 12.4 8.4, 16.2 4.6, 21.6 4 C 25.4 3.6, 28.8 4.2, 29.6 6.4 L 28 10 L 13 14 Z",
};
const DS_KEYS = (["haut", "bas", "gauche", "droite"] as const).map((dir): Part => {
  const vertical = dir === "haut" || dir === "bas";
  const x = dir === "gauche" ? 17.4 : dir === "droite" ? 26.4 : 21.9;
  const y = dir === "haut" ? 15.1 : dir === "bas" ? 23.6 : 19.35;
  return {
    key: { haut: "b12", bas: "b13", gauche: "b14", droite: "b15" }[dir],
    label: "",
    x,
    y,
    r: vertical ? 2.1 : 2.45,
    shape: "pastille",
    wide: vertical ? 1.17 : 0.86,
    d: arrowKey(x, y, dir, 4.9, 4.3),
    glyph: GLYPHS[dir],
  };
});
const DS_FACE = (key: string, glyph: keyof typeof GLYPHS, x: number, y: number): Part => ({
  key,
  label: "",
  x,
  y,
  r: 3,
  shape: "rond",
  glyph: GLYPHS[glyph],
});

export const DUALSHOCK: PadMap = {
  id: "dualshock",
  name: "manette PlayStation",
  viewBox: "0 0 100 72",
  body:
    "M 50 6.5 C 46.6 6.5, 42.1 6.7, 39.7 6.8 C 37.3 6.9, 36.9 7.1, 35.5 7.1 " +
    "C 34.1 7.2, 32.7 7.2, 31.3 7.2 C 30 7.2, 28.9 7.1, 27.5 7 C 26.1 7, 24.6 7, 23.2 7 " +
    "C 21.8 7.1, 20.3 7.1, 18.9 7.3 C 17.6 7.6, 16.1 7.8, 15.1 8.6 " +
    "C 14.1 9.3, 13.4 10.7, 12.6 11.9 C 11.9 13.1, 11.2 14.3, 10.6 15.6 " +
    "C 10 16.9, 9.6 18.3, 9.2 19.6 C 8.7 20.9, 8.2 22.2, 7.7 23.6 C 7.3 24.9, 6.8 26.3, 6.5 27.7 " +
    "C 6.1 29, 5.9 30.5, 5.6 31.9 C 5.3 33.3, 4.9 34.7, 4.6 36.1 C 4.4 37.5, 4.1 38.9, 3.9 40.4 " +
    "C 3.7 41.8, 3.5 43.3, 3.4 44.7 C 3.3 46.2, 3.2 47.7, 3.1 49.2 C 3.1 50.7, 3.1 52.2, 3.1 53.7 " +
    "C 3.2 55.2, 3.2 56.7, 3.4 58.2 C 3.6 59.6, 3.7 61.1, 4.2 62.4 C 4.8 63.7, 5.6 65.1, 6.6 66 " +
    "C 7.6 66.9, 9.1 67.2, 10.4 67.8 C 11.7 68.4, 13.1 69.6, 14.3 69.6 " +
    "C 15.4 69.6, 16.6 68.7, 17.4 67.7 C 18.1 66.8, 18.5 65.1, 19 63.8 " +
    "C 19.5 62.5, 20 61.2, 20.5 59.9 C 21 58.6, 21.5 57.2, 22 55.9 " +
    "C 22.4 54.5, 22.8 53.2, 23.3 51.8 C 23.8 50.5, 24.1 49.1, 24.9 47.9 " +
    "C 25.6 46.7, 26.6 45.3, 27.7 44.7 C 28.9 44.1, 30.6 44.3, 32.1 44.3 " +
    "C 33.5 44.2, 35 44.6, 36.5 44.7 C 38 44.8, 39.5 44.8, 41 44.8 " +
    "C 42.5 44.8, 44.1 44.8, 45.6 44.8 C 47.1 44.8, 48.5 44.8, 50 44.8 " +
    "C 51.5 44.8, 52.9 44.8, 54.4 44.8 C 55.9 44.8, 57.5 44.8, 59 44.8 " +
    "C 60.5 44.8, 62 44.8, 63.5 44.7 C 65 44.6, 66.5 44.2, 67.9 44.3 " +
    "C 69.4 44.3, 71.1 44.1, 72.3 44.7 C 73.4 45.3, 74.4 46.7, 75.1 47.9 " +
    "C 75.9 49.1, 76.2 50.5, 76.7 51.8 C 77.2 53.2, 77.6 54.5, 78 55.9 " +
    "C 78.5 57.2, 79 58.6, 79.5 59.9 C 80 61.2, 80.5 62.5, 81 63.8 " +
    "C 81.5 65.1, 81.9 66.8, 82.6 67.7 C 83.4 68.7, 84.6 69.6, 85.7 69.6 " +
    "C 86.9 69.6, 88.3 68.4, 89.6 67.8 C 90.9 67.2, 92.4 66.9, 93.4 66 " +
    "C 94.4 65.1, 95.2 63.7, 95.8 62.4 C 96.3 61.1, 96.4 59.6, 96.6 58.2 " +
    "C 96.8 56.7, 96.8 55.2, 96.9 53.7 C 96.9 52.2, 96.9 50.7, 96.9 49.2 " +
    "C 96.8 47.7, 96.7 46.2, 96.6 44.7 C 96.5 43.3, 96.3 41.8, 96.1 40.4 " +
    "C 95.9 38.9, 95.6 37.5, 95.4 36.1 C 95.1 34.7, 94.7 33.3, 94.4 31.9 " +
    "C 94.1 30.5, 93.9 29, 93.5 27.7 C 93.2 26.3, 92.7 24.9, 92.3 23.6 " +
    "C 91.8 22.2, 91.3 20.9, 90.8 19.6 C 90.4 18.3, 90 16.9, 89.4 15.6 " +
    "C 88.8 14.3, 88.1 13.1, 87.4 11.9 C 86.6 10.7, 85.9 9.3, 84.9 8.6 " +
    "C 83.9 7.8, 82.4 7.6, 81.1 7.3 C 79.7 7.1, 78.2 7.1, 76.8 7 C 75.4 7, 73.9 7, 72.5 7 " +
    "C 71.1 7.1, 70 7.2, 68.7 7.2 C 67.3 7.2, 65.9 7.2, 64.5 7.1 C 63.1 7.1, 62.7 6.9, 60.3 6.8 " +
    "C 57.9 6.7, 53.4 6.5, 50 6.5 Z",
  art: [
    { tone: "plaque", d: `${DS_PLATE} ${mirrorX(DS_PLATE)}` },
    { tone: "trait", d: DS_TOUCH },
  ],
  deco: [
    { tone: "reflet", d: DS_TOUCH },
    { tone: "lumiere", d: `${DS_BAR} ${mirrorX(DS_BAR)}` },
    { tone: "points", d: DS_GRILLE },
    {
      tone: "bouton",
      d: "M 48 36.4 L 52 36.4 C 52.4 36.4, 52.6 36.7, 52.6 37 C 52.6 37.3, 52.4 37.6, 52 37.6 L 48 37.6 C 47.6 37.6, 47.4 37.3, 47.4 37 C 47.4 36.7, 47.6 36.4, 48 36.4 Z",
    },
  ],
  hull: { left: 3.1, right: 96.9, top: 1.2, bottom: 69.6 },
  parts: [
    {
      key: "b6",
      label: "L2",
      x: 24,
      y: 2.7,
      r: 1.1,
      shape: "pastille",
      wide: 4.4,
      under: true,
      d: DS_TRIGGER.l2,
      size: 2.2,
    },
    {
      key: "b7",
      label: "R2",
      x: 76,
      y: 2.7,
      r: 1.1,
      shape: "pastille",
      wide: 4.4,
      under: true,
      d: mirrorX(DS_TRIGGER.l2),
      size: 2.2,
    },
    {
      key: "b4",
      label: "L1",
      x: 20.4,
      y: 5.7,
      r: 1.2,
      shape: "pastille",
      wide: 4,
      under: true,
      d: DS_TRIGGER.l1,
      size: 2.2,
    },
    {
      key: "b5",
      label: "R1",
      x: 79.6,
      y: 5.7,
      r: 1.2,
      shape: "pastille",
      wide: 4,
      under: true,
      d: mirrorX(DS_TRIGGER.l1),
      size: 2.2,
    },
    ...DS_KEYS,
    DS_FACE("b3", "triangle", 78.1, 13.1),
    DS_FACE("b2", "carre", 71.7, 19.4),
    DS_FACE("b1", "rond", 84.5, 19.4),
    DS_FACE("b0", "croix", 78.1, 25.7),
    { key: "b8", label: "", x: 28.7, y: 10.4, r: 2, shape: "pastille", wide: 0.6 },
    { key: "b9", label: "", x: 71.3, y: 10.4, r: 2, shape: "pastille", wide: 0.6 },
    { key: "b16", label: "", x: 50, y: 31.4, r: 2, shape: "rond" },
    {
      key: "b10",
      label: "",
      x: 35.2,
      y: 30,
      r: 4.6,
      shape: "rond",
      gate: true,
      grip: "creux",
      stick: "a0",
    },
    {
      key: "b11",
      label: "",
      x: 64.8,
      y: 30,
      r: 4.6,
      shape: "rond",
      gate: true,
      grip: "creux",
      stick: "a2",
    },
  ],
};

/**
 * La manette Xbox qu'on tient, quand son nom le dit.
 *
 * Relevée sur une photo vue de dessus d'une manette Xbox Series, avec une
 * grille posée sur l'image pour lire les positions. Les deux sticks en
 * quinconce, la croix sur son disque, les lettres A B X Y en couleur sur des
 * boutons noirs, le bouton central rond et lumineux (sans le logo), Vue et
 * Menu de part et d'autre, Partage en dessous. Les indices suivent la norme du
 * navigateur, comme sur PlayStation.
 */
const XB_DPAD = dpad(36.5, 39.9, 2.5, 6.4, {
  haut: "b12",
  bas: "b13",
  gauche: "b14",
  droite: "b15",
});
const XB_TRIGGER = {
  lb: "M 11 14 C 12.2 8.4, 16.6 4.8, 23.6 4.3 L 33.2 4.1 C 34.8 4.1, 35.5 5, 35.3 6.8 L 28 9 L 13 15.5 Z",
  lt: "M 17 8 C 17.5 3.8, 21 1.2, 26 0.9 L 32.4 0.8 C 33.9 0.8, 34.4 2, 34.1 4.4 L 26 7 Z",
};
const XB_FACE = (key: string, label: string, x: number, y: number, ink: Matiere): Part => ({
  key,
  label,
  x,
  y,
  r: 3.2,
  shape: "rond",
  tint: m("xbox-lettres"),
  ink: m(ink),
  size: 3.4,
});

export const XBOX: PadMap = {
  id: "xbox",
  name: "manette Xbox",
  viewBox: "0 0 100 75",
  body:
    "M 50 6.5 C 45.5 6.5, 40.3 6.5, 36.4 6.6 C 32.5 6.7, 29.3 6.9, 26.5 7.2 " +
    "C 23.7 7.5, 21.6 7.9, 19.7 8.5 C 17.8 9, 16.5 9.6, 15.1 10.6 " +
    "C 13.8 11.6, 12.7 12.7, 11.7 14.5 C 10.6 16.3, 9.7 18.9, 8.8 21.3 " +
    "C 7.9 23.8, 7.2 26.5, 6.5 29.4 C 5.8 32.3, 5.1 35.7, 4.6 38.6 C 4.1 41.6, 3.7 44.4, 3.5 47.3 " +
    "C 3.2 50.2, 3.1 53.4, 3.1 56 C 3.1 58.5, 3.2 60.8, 3.6 62.8 C 4 64.7, 4.6 66.3, 5.5 67.7 " +
    "C 6.3 69.1, 7.4 70.3, 8.6 71.1 C 9.7 71.8, 11.1 72, 12.3 72 C 13.4 72, 14.4 71.7, 15.4 71.1 " +
    "C 16.3 70.4, 17.2 69.4, 18.1 68.1 C 19 66.8, 19.7 65, 20.6 63.4 " +
    "C 21.4 61.8, 22.2 59.8, 23 58.4 C 23.9 57.1, 24.7 56.1, 25.8 55.3 " +
    "C 26.8 54.6, 27.4 54.4, 29.6 54.1 C 31.8 53.9, 35.5 53.9, 38.9 53.9 " +
    "C 42.3 53.8, 46.3 53.9, 50 53.9 C 53.7 53.9, 57.7 53.8, 61.1 53.9 " +
    "C 64.5 53.9, 68.2 53.9, 70.4 54.1 C 72.6 54.4, 73.2 54.6, 74.2 55.3 " +
    "C 75.3 56.1, 76.1 57.1, 77 58.4 C 77.8 59.8, 78.6 61.8, 79.4 63.4 " +
    "C 80.3 65, 81 66.8, 81.9 68.1 C 82.8 69.4, 83.7 70.4, 84.6 71.1 " +
    "C 85.6 71.7, 86.6 72, 87.7 72 C 88.9 72, 90.3 71.8, 91.4 71.1 " +
    "C 92.6 70.3, 93.7 69.1, 94.5 67.7 C 95.4 66.3, 96 64.7, 96.4 62.8 " +
    "C 96.8 60.8, 96.9 58.5, 96.9 56 C 96.9 53.4, 96.8 50.2, 96.5 47.3 " +
    "C 96.3 44.4, 95.9 41.6, 95.4 38.6 C 94.9 35.7, 94.2 32.3, 93.5 29.4 " +
    "C 92.8 26.5, 92.1 23.8, 91.2 21.3 C 90.3 18.9, 89.4 16.3, 88.3 14.5 " +
    "C 87.3 12.7, 86.2 11.6, 84.9 10.6 C 83.5 9.6, 82.2 9, 80.3 8.5 " +
    "C 78.4 7.9, 76.3 7.5, 73.5 7.2 C 70.7 6.9, 67.5 6.7, 63.6 6.6 C 59.7 6.5, 54.5 6.5, 50 6.5 Z",
  deco: [
    { tone: "logement", d: "M 28.1 39.9 A 8.4 8.4 0 1 0 44.9 39.9 A 8.4 8.4 0 1 0 28.1 39.9 Z" },
    { tone: "bouton", d: "M 28.6 39.9 A 7.9 7.9 0 1 0 44.4 39.9 A 7.9 7.9 0 1 0 28.6 39.9 Z" },
    { tone: "logement", d: XB_DPAD.base },
    { tone: "bouton", d: XB_DPAD.base },
    { tone: "logement", d: "M 47.6 28.4 L 52.4 28.4" },
    {
      tone: "bouton",
      d: "M 47.9 27.2 L 52.1 27.2 C 52.8 27.2, 53.3 27.7, 53.3 28.4 C 53.3 29.1, 52.8 29.6, 52.1 29.6 L 47.9 29.6 C 47.2 29.6, 46.7 29.1, 46.7 28.4 C 46.7 27.7, 47.2 27.2, 47.9 27.2 Z",
    },
  ],
  hull: { left: 3.1, right: 96.9, top: 0.8, bottom: 72 },
  parts: [
    {
      key: "b6",
      label: "LT",
      x: 27.5,
      y: 2.5,
      r: 1.1,
      shape: "pastille",
      wide: 4.5,
      under: true,
      d: XB_TRIGGER.lt,
      size: 2.2,
    },
    {
      key: "b7",
      label: "RT",
      x: 72.5,
      y: 2.5,
      r: 1.1,
      shape: "pastille",
      wide: 4.5,
      under: true,
      d: mirrorX(XB_TRIGGER.lt),
      size: 2.2,
    },
    {
      key: "b4",
      label: "LB",
      x: 24.5,
      y: 5.6,
      r: 1,
      shape: "pastille",
      wide: 6,
      under: true,
      d: XB_TRIGGER.lb,
      size: 2.2,
    },
    {
      key: "b5",
      label: "RB",
      x: 75.5,
      y: 5.6,
      r: 1,
      shape: "pastille",
      wide: 6,
      under: true,
      d: mirrorX(XB_TRIGGER.lb),
      size: 2.2,
    },
    {
      key: "b16",
      label: "",
      x: 50,
      y: 13,
      r: 3.8,
      shape: "rond",
      tint: m("xbox-guide"),
      glyph: GLYPHS.anneau,
      ink: m("xbox-guide-encre"),
    },
    { key: "b8", label: "", x: 42.6, y: 22.8, r: 2.1, shape: "rond", glyph: GLYPHS.vue },
    { key: "b9", label: "", x: 57.4, y: 22.8, r: 2.1, shape: "rond", glyph: GLYPHS.menu },
    {
      key: "b10",
      label: "",
      x: 23.2,
      y: 22.8,
      r: 6,
      shape: "rond",
      gate: true,
      grip: "creux",
      stick: "a0",
    },
    {
      key: "b11",
      label: "",
      x: 64.7,
      y: 38,
      r: 6,
      shape: "rond",
      gate: true,
      grip: "creux",
      stick: "a2",
    },
    ...XB_DPAD.parts,
    XB_FACE("b3", "Y", 75.6, 16.8, "xbox-y"),
    XB_FACE("b2", "X", 69.3, 23.1, "xbox-x"),
    XB_FACE("b1", "B", 81.9, 23.1, "xbox-b"),
    XB_FACE("b0", "A", 75.6, 29.4, "xbox-a"),
  ],
};

/**
 * La manette qu'on tient, quand on n'en sait rien du tout: le dernier recours.
 *
 * Le navigateur ne dit pas à quoi ressemble une manette. Quand il dit son nom
 * et la disposition standard, on dessine sa vraie coque : `DUALSHOCK` pour une
 * PlayStation, `XBOX` pour une Xbox. Cette coque générique sert sinon, et elle
 * le dit : grise, sans marque ni lettre, les indices bruts du navigateur écrits
 * dessus. Un adaptateur GameCube n'annonce aucune disposition, et pour lui aucun
 * plan ne peut être juste. Elle reprend la forme de la Xbox, la disposition que
 * la norme du navigateur décrit.
 */
export const STANDARD_PAD: PadMap = {
  id: "standard",
  name: "manette standard",
  viewBox: "0 0 100 75",
  body: XBOX.body,
  deco: XBOX.deco,
  hull: { left: 3.1, right: 96.9, top: 0.8, bottom: 72 },
  parts: XBOX.parts.map(({ tint, ink, glyph, ...part }) => ({
    ...part,
    label: part.under ? part.label : "",
    ...(tint ? { tint: m("standard-touche"), ink: m("standard-encre") } : ink ? { ink } : {}),
    ...(glyph && Number(part.key.slice(1)) >= 12 && Number(part.key.slice(1)) <= 15
      ? { glyph }
      : {}),
  })),
};

/**
 * La manette Pro de la Switch, relevée sur une photo vue de dessus.
 *
 * Le stick gauche en haut, la croix en dessous, le stick droit plus bas que
 * les quatre boutons, moins et plus en haut, capture et HOME au milieu, les
 * poignées grainées séparées du dessus par une couture en biais. Deux plans
 * partagent ce dessin : celui de la salle Switch, qui parle en boutons Switch
 * (`SWITCH_PRO`), et celui de la manette qu'on tient quand le navigateur la
 * reconnaît en disposition standard (`SWITCH_PRO_PAD`), qui parle en indices.
 */
const SP_GRIP = "M 3 19.8 L 8 27 L 25.3 51.5 L 29 57 L 29 80 L 0 80 L 0 19.8 Z";
const SP_SEAM = "M 6.6 25 L 8 27 L 25.3 51.5 L 27 54";
const SP_DPAD = (keys: Record<"haut" | "bas" | "gauche" | "droite", string>) =>
  dpad(34.7, 36.6, 2.4, 6.6, keys);
const SP_TRIGGER = {
  l: "M 10.4 15 C 11.4 9.2, 15.4 5.6, 21.4 5 L 30.4 4.8 C 32 4.8, 32.8 5.8, 32.6 7.6 L 26 9 L 12 17 Z",
  zl: "M 15 10 C 15.6 5.4, 19 2.4, 24 2 L 30 1.9 C 31.6 1.9, 32.2 3, 32 5.4 L 25 8 Z",
};
const SP_BODY =
  "M 50 7.1 C 45.7 7.1, 40.5 7, 37.1 7.1 C 33.8 7.1, 32.1 7.3, 30 7.2 " +
  "C 27.8 7.2, 25.8 6.9, 24 6.9 C 22.2 6.9, 20.6 7, 19.2 7.4 C 17.8 7.7, 16.7 8.4, 15.6 9.1 " +
  "C 14.6 9.9, 13.8 10.8, 13 12.1 C 12.2 13.4, 11.5 15.2, 10.9 16.9 " +
  "C 10.3 18.6, 9.8 20.5, 9.4 22.3 C 8.9 24.1, 8.6 25.7, 8.2 27.6 " +
  "C 7.7 29.5, 7.2 31.4, 6.7 33.6 C 6.2 35.8, 5.6 38.2, 5.2 40.8 C 4.8 43.3, 4.4 46.3, 4.2 49.1 " +
  "C 4 51.9, 4 54.9, 4.2 57.5 C 4.4 60, 4.6 62.5, 5.2 64.6 C 5.8 66.7, 6.5 68.7, 7.6 70 " +
  "C 8.6 71.3, 10 72, 11.5 72.4 C 12.9 72.7, 14.7 72.5, 16.2 72.1 C 17.7 71.7, 19.3 71, 20.4 70 " +
  "C 21.6 68.9, 22.4 67.5, 23.1 65.8 C 23.8 64.1, 24.3 61.7, 24.9 59.8 " +
  "C 25.4 58, 25.8 55.9, 26.4 54.5 C 27 53.1, 27.5 52.1, 28.5 51.5 " +
  "C 29.5 50.9, 28.8 51.1, 32.3 51 C 35.9 50.9, 44.1 51, 50 51 C 55.9 51, 64.1 50.9, 67.7 51 " +
  "C 71.2 51.1, 70.5 50.9, 71.5 51.5 C 72.5 52.1, 73 53.1, 73.6 54.5 " +
  "C 74.2 55.9, 74.6 58, 75.1 59.8 C 75.7 61.7, 76.2 64.1, 76.9 65.8 " +
  "C 77.6 67.5, 78.4 68.9, 79.6 70 C 80.7 71, 82.3 71.7, 83.8 72.1 " +
  "C 85.3 72.5, 87.1 72.7, 88.5 72.4 C 90 72, 91.4 71.3, 92.4 70 " +
  "C 93.5 68.7, 94.2 66.7, 94.8 64.6 C 95.4 62.5, 95.6 60, 95.8 57.5 " +
  "C 96 54.9, 96 51.9, 95.8 49.1 C 95.6 46.3, 95.2 43.3, 94.8 40.8 " +
  "C 94.4 38.2, 93.8 35.8, 93.3 33.6 C 92.8 31.4, 92.3 29.5, 91.8 27.6 " +
  "C 91.4 25.7, 91.1 24.1, 90.6 22.3 C 90.2 20.5, 89.7 18.6, 89.1 16.9 " +
  "C 88.5 15.2, 87.8 13.4, 87 12.1 C 86.2 10.8, 85.4 9.9, 84.4 9.1 " +
  "C 83.3 8.4, 82.2 7.7, 80.8 7.4 C 79.4 7, 77.8 6.9, 76 6.9 C 74.2 6.9, 72.2 7.2, 70 7.2 " +
  "C 67.9 7.3, 66.2 7.1, 62.9 7.1 C 59.5 7, 54.3 7.1, 50 7.1 Z";
const SP_CAPTURE = "M 42.5 21.9 L 45 21.9 L 45 24.4 L 42.5 24.4 Z";

/** Le dessin de la manette Pro, avec les noms que l'on veut sur chaque pièce. */
function switchPro(
  id: string,
  name: string,
  keys: Record<
    | "A"
    | "B"
    | "X"
    | "Y"
    | "L"
    | "R"
    | "ZL"
    | "ZR"
    | "MINUS"
    | "PLUS"
    | "LS"
    | "RS"
    | "UP"
    | "DOWN"
    | "LEFT"
    | "RIGHT",
    string
  >,
  home?: string,
): PadMap {
  const cross = SP_DPAD({ haut: keys.UP, bas: keys.DOWN, gauche: keys.LEFT, droite: keys.RIGHT });
  const face = (key: string, label: string, x: number, y: number): Part => ({
    key,
    label,
    x,
    y,
    r: 3.4,
    shape: "rond",
    size: 3,
  });
  const homeDisc = "M 54.2 23.1 A 2 2 0 1 0 58.2 23.1 A 2 2 0 1 0 54.2 23.1 Z";
  return {
    id,
    name,
    viewBox: "0 0 100 75",
    body: SP_BODY,
    art: [
      { tone: "plaque", d: `${SP_GRIP} ${mirrorX(SP_GRIP)}` },
      { tone: "grain", d: `${SP_GRIP} ${mirrorX(SP_GRIP)}` },
      { tone: "trait", d: `${SP_SEAM} ${mirrorX(SP_SEAM)}` },
    ],
    deco: [
      { tone: "logement", d: cross.base },
      { tone: "bouton", d: cross.base },
      { tone: "logement", d: home ? SP_CAPTURE : `${SP_CAPTURE} ${homeDisc}` },
      { tone: "bouton", d: home ? SP_CAPTURE : `${SP_CAPTURE} ${homeDisc}` },
    ],
    hull: { left: 3, right: 97, top: 1.9, bottom: 72.4 },
    parts: [
      {
        key: keys.ZL,
        label: "ZL",
        x: 25.5,
        y: 3.4,
        r: 1.1,
        shape: "pastille",
        wide: 4.5,
        under: true,
        d: SP_TRIGGER.zl,
        size: 2.2,
      },
      {
        key: keys.ZR,
        label: "ZR",
        x: 74.5,
        y: 3.4,
        r: 1.1,
        shape: "pastille",
        wide: 4.5,
        under: true,
        d: mirrorX(SP_TRIGGER.zl),
        size: 2.2,
      },
      {
        key: keys.L,
        label: "L",
        x: 23,
        y: 6.1,
        r: 0.9,
        shape: "pastille",
        wide: 6.5,
        under: true,
        d: SP_TRIGGER.l,
        size: 2.2,
      },
      {
        key: keys.R,
        label: "R",
        x: 77,
        y: 6.1,
        r: 0.9,
        shape: "pastille",
        wide: 6.5,
        under: true,
        d: mirrorX(SP_TRIGGER.l),
        size: 2.2,
      },
      { key: keys.MINUS, label: "−", x: 38, y: 16.3, r: 1.7, shape: "rond", size: 2.6 },
      { key: keys.PLUS, label: "+", x: 62, y: 16.3, r: 1.7, shape: "rond", size: 2.6 },
      ...(home
        ? [
            {
              key: home,
              label: "",
              x: 56.2,
              y: 23.1,
              r: 2,
              shape: "rond",
              glyph: GLYPHS.anneau,
            } satisfies Part,
          ]
        : []),
      {
        key: keys.LS,
        label: "",
        x: 23.4,
        y: 22.9,
        r: 5.4,
        shape: "rond",
        gate: true,
        grip: "creux",
        stick: "a0",
      },
      {
        key: keys.RS,
        label: "",
        x: 63.4,
        y: 37.2,
        r: 5.4,
        shape: "rond",
        gate: true,
        grip: "creux",
        stick: "a2",
      },
      ...cross.parts,
      face(keys.X, "X", 76.1, 16.1),
      face(keys.Y, "Y", 69.1, 23.1),
      face(keys.A, "A", 83.1, 23.1),
      face(keys.B, "B", 76.1, 30.1),
    ],
  };
}

/** La manette Pro de la salle Switch : ses pièces portent les noms de boutons
 * que `media/switch` envoie, et les sticks s'inclinent avec leur propre lecture. */
export const SWITCH_PRO: PadMap = switchPro("switch-pro", "manette Pro", {
  A: "A",
  B: "B",
  X: "X",
  Y: "Y",
  L: "L",
  R: "R",
  ZL: "ZL",
  ZR: "ZR",
  MINUS: "MINUS",
  PLUS: "PLUS",
  LS: "LS",
  RS: "RS",
  UP: "UP",
  DOWN: "DOWN",
  LEFT: "LEFT",
  RIGHT: "RIGHT",
});

/** La même manette, tenue en main, quand le navigateur la reconnaît. La norme
 * place les indices par POSITION : en bas `b0`, qui est le B d'une manette
 * Nintendo, à droite `b1`, qui est son A. */
export const SWITCH_PRO_PAD: PadMap = switchPro(
  "switch-pro-pad",
  "manette Nintendo",
  {
    B: "b0",
    A: "b1",
    Y: "b2",
    X: "b3",
    L: "b4",
    R: "b5",
    ZL: "b6",
    ZR: "b7",
    MINUS: "b8",
    PLUS: "b9",
    LS: "b10",
    RS: "b11",
    UP: "b12",
    DOWN: "b13",
    LEFT: "b14",
    RIGHT: "b15",
  },
  "b16",
);

/**
 * La manette Xbox 360 d'une salle Xbox 360: le dessin de la Xbox, avec les
 * noms de boutons de la trame Pro que la page envoie (ceux de la Switch).
 *
 * La trame range ses boutons par POSITION: le bas s'appelle A, la droite B, la
 * gauche X, le haut Y, comme sur une manette Xbox. Une salle Xbox 360 n'a donc
 * qu'à dessiner une Xbox et à nommer ses pièces avec la trame. Le bouton Guide
 * n'y est pas: la trame ne le transporte pas, et Xenia ouvrirait son menu.
 */
const XBOX_TO_FRAME: Record<string, string> = {
  b0: "A",
  b1: "B",
  b2: "X",
  b3: "Y",
  b4: "L",
  b5: "R",
  b6: "ZL",
  b7: "ZR",
  b8: "MINUS",
  b9: "PLUS",
  b10: "LS",
  b11: "RS",
  b12: "UP",
  b13: "DOWN",
  b14: "LEFT",
  b15: "RIGHT",
};
const XBOX_360_PARTS: Part[] = [];
for (const part of XBOX.parts) {
  const key = XBOX_TO_FRAME[part.key];
  if (key) XBOX_360_PARTS.push(Object.assign({}, part, { key }));
}
export const XBOX_360: PadMap = {
  ...XBOX,
  id: "xbox360",
  name: "manette Xbox 360",
  parts: XBOX_360_PARTS,
};

/**
 * La Wiimote et son Nunchuk, quand la salle présente une Wii.
 *
 * # Les mêmes clés que la GameCube, et c'est le point
 *
 * La page envoie TOUJOURS la même trame: douze boutons, deux sticks, deux
 * gâchettes. Une GameCube, une Wiimote et une guitare en sont trois LECTURES,
 * décidées par le fichier de correspondances qu'on écrit à Dolphin. Les plans
 * partagent donc leurs clés — `A` reste `A` — et seules les places et les
 * étiquettes changent.
 *
 * D'où un écran qui vaut mieux qu'un tableau: on tient un bouton, et on voit ce
 * qu'il devient sur chacune des trois. Ce qu'aucune ne montre est aussi
 * instructif — une guitare n'a pas de croix droite, donc cette commande n'y
 * allume rien, et c'est vrai.
 *
 * Les correspondances viennent de `emulator::config::wiimote_ini`, qui est
 * l'endroit où elles sont DÉCIDÉES. Les recopier d'ailleurs ferait un schéma qui
 * ment le jour où l'une change.
 *
 * # Deux vues, parce qu'aucune ne montre tout
 *
 * La Wiimote est vue de face, relevée sur une photo : POWER, la croix, A, moins,
 * HOME et plus, le haut-parleur, 1 et 2, les quatre voyants. Sa gâchette B est
 * dessous : elle dépasse du bord droit, à la hauteur de A. La fenêtre qui sert
 * à viser est le bout noir, en haut. Moins, HOME et POWER sont dessinés mais ne
 * se visent pas : la trame ne les transporte pas.
 *
 * Le Nunchuk est vu de PROFIL, relevé sur une photo de côté : vu de dessus, ses
 * deux boutons C et Z, posés sur sa face avant, disparaîtraient. Le stick
 * dépasse en haut, C et Z en avant, le câble part du bas vers la Wiimote.
 */
const WM_BODY =
  "M 64.4 6 L 75.1 6 Q 77.5 6, 77.5 8.4 L 77.5 58 Q 77.5 60, 75.5 60 L 64 60 Q 62 60, 62 58 L 62 8.4 Q 62 6, 64.4 6 Z";
const NC_BODY =
  "M 33.6 12 C 32.7 11.9, 31.3 12, 30.2 12.3 C 29.2 12.5, 28.4 12.9, 27.4 13.4 C 26.5 13.9, 25.6 14.4, 24.6 15.1 " +
  "C 23.7 15.7, 22.7 16.5, 21.8 17.3 C 21 18.1, 20.3 18.9, 19.6 19.8 C 18.9 20.8, 18.2 21.9, 17.6 23.2 " +
  "C 17 24.5, 16.4 26, 16 27.7 C 15.5 29.4, 15.1 31.4, 14.8 33.3 C 14.5 35.2, 14.3 37, 14.1 38.9 " +
  "C 14 40.8, 13.9 42.6, 14 44.5 C 14.1 46.4, 14.2 48.6, 14.6 50.1 C 14.9 51.6, 15.4 52.6, 16 53.5 " +
  "C 16.6 54.4, 17.5 55, 18.2 55.4 C 18.9 55.9, 19.7 56, 20.4 56 C 21.2 56, 21.9 55.8, 22.7 55.4 " +
  "C 23.5 55.1, 24.5 54.4, 25.2 53.7 C 25.9 53, 26.4 52.3, 26.9 51.2 C 27.4 50.2, 27.9 48.7, 28.3 47.3 " +
  "C 28.7 45.9, 28.9 44.5, 29.1 43.1 C 29.3 41.7, 29.4 40.3, 29.7 38.9 C 29.9 37.5, 30.1 35.8, 30.5 34.7 " +
  "C 30.9 33.6, 31.3 32.9, 31.9 32.1 C 32.5 31.4, 33.4 30.4, 34.2 29.9 C 35 29.4, 35.8 29.2, 36.7 29 " +
  "C 37.6 28.7, 39 28.7, 39.5 28.5 C 39.9 28.3, 39.7 27.9, 39.4 27.7 C 39 27.5, 37.8 27.6, 37.5 27.2 " +
  "C 37.2 26.7, 37.5 26.1, 37.5 24.9 C 37.6 23.7, 37.9 21.6, 37.8 19.8 C 37.8 18.1, 37.6 15.7, 37.3 14.5 " +
  "C 36.9 13.3, 36.5 13.2, 35.9 12.8 C 35.3 12.4, 34.6 12.1, 33.6 12 Z";
const WM_DPAD = dpad(69.75, 16.6, 1.25, 3.5, {
  haut: "D_UP",
  bas: "D_DOWN",
  gauche: "D_LEFT",
  droite: "D_RIGHT",
});
const WM_SPEAKER = Array.from({ length: 20 }, (_, i) => {
  const x = 68.35 + (i % 5) * 0.7;
  const y = 39.6 + Math.floor(i / 5) * 0.7;
  return `M ${f(x)} ${f(y)} l 0 0`;
}).join(" ");
const WM_LEDS = [67.05, 68.85, 70.65, 72.45]
  .map(
    (x) =>
      `M ${f(x - 0.35)} 55.55 L ${f(x + 0.35)} 55.55 L ${f(x + 0.35)} 56.05 L ${f(x - 0.35)} 56.05 Z`,
  )
  .join(" ");
const WM_ROUND = (x: number, y: number, r: number) =>
  `M ${f(x - r)} ${f(y)} A ${r} ${r} 0 1 0 ${f(x + r)} ${f(y)} A ${r} ${r} 0 1 0 ${f(x - r)} ${f(y)} Z`;
const WM_DECO: Layer[] = [
  { tone: "logement", d: WM_DPAD.base },
  { tone: "bouton", d: WM_DPAD.base },
  {
    tone: "logement",
    d: `${WM_ROUND(66.6, 9.8, 0.9)} ${WM_ROUND(66.4, 34.9, 1)} ${WM_ROUND(69.75, 34.9, 1.05)}`,
  },
  {
    tone: "bouton",
    d: `${WM_ROUND(66.6, 9.8, 0.9)} ${WM_ROUND(66.4, 34.9, 1)} ${WM_ROUND(69.75, 34.9, 1.05)}`,
  },
  { tone: "points", d: WM_SPEAKER },
  { tone: "voyant", d: WM_LEDS },
];
const WM_UNDER: Layer[] = [{ tone: "bouton", d: "M 67.4 59 L 72.1 59 L 72.1 61.6 L 67.4 61.6 Z" }];
const WM_PARTS: Part[] = [
  {
    key: "cx",
    label: "viser",
    x: 69.75,
    y: 7,
    r: 0.8,
    shape: "pastille",
    wide: 6.5,
    d: "M 64.4 6.4 L 75.1 6.4 Q 76.85 6.4, 76.95 7.8 L 62.55 7.8 Q 62.65 6.4, 64.4 6.4 Z",
    tint: m("wiimote-viseur"),
    flush: true,
    size: 2.4,
    // Hors du bord de la coque, avec un trait qui se voit (`padmap.test.ts`,
    // « les renvois ») : à 58,5, le 23 novembre 2026, le mot touchait le bord.
    callout: { x: 56, y: 7, anchor: "end" },
  },
  ...WM_DPAD.parts,
  { key: "A", label: "A", x: 69.75, y: 25.9, r: 2.2, shape: "rond", size: 2.6 },
  {
    key: "B",
    label: "B",
    x: 78.9,
    y: 25.9,
    r: 1.8,
    shape: "pastille",
    wide: 0.8,
    under: true,
    d: "M 76.8 23.2 C 79.2 23.2, 80.4 24.4, 80.4 25.9 C 80.4 27.4, 79.2 28.6, 76.8 28.6 Z",
    size: 2.2,
  },
  { key: "START", label: "+", x: 73.1, y: 34.9, r: 1, shape: "rond", size: 2 },
  { key: "X", label: "1", x: 69.75, y: 46.8, r: 1.35, shape: "rond", size: 2.2 },
  { key: "Y", label: "2", x: 69.75, y: 51, r: 1.35, shape: "rond", size: 2.2 },
  {
    key: "Z",
    label: "secouer",
    x: 80.4,
    y: 50,
    r: 2.8,
    shape: "pastille",
    wide: 0.5,
    under: true,
    d:
      "M 78.6 46.4 C 80.4 48.3, 80.4 51.7, 78.6 53.6 C 79.6 51.7, 79.6 48.3, 78.6 46.4 Z " +
      "M 80.6 45.2 C 83.3 47.8, 83.3 52.2, 80.6 54.8 C 82 52.2, 82 47.8, 80.6 45.2 Z",
    tint: m("wiimote-secousse"),
    size: 2.4,
    // Hors des arcs : à 84,2, le mot se collait au deuxième.
    callout: { x: 87.4, y: 50, anchor: "start" },
  },
];
const NC_PARTS: Part[] = [
  {
    key: "x",
    label: "",
    x: 21.6,
    y: 15.2,
    r: 1.6,
    shape: "pastille",
    wide: 1.6,
    under: true,
    d:
      "M 24.1 13.6 C 24.2 13.8, 24.2 14, 24.1 14.3 C 24 14.6, 23.7 14.9, 23.4 15.2 C 23.1 15.6, 22.6 15.9, 22.2 16.2 " +
      "C 21.8 16.4, 21.3 16.7, 20.8 16.8 C 20.4 17, 20 17.1, 19.7 17.1 C 19.4 17.1, 19.1 17, 19 16.8 " +
      "C 18.9 16.6, 18.9 16.4, 19.1 16.1 C 19.2 15.8, 19.5 15.5, 19.8 15.1 C 20.1 14.8, 20.5 14.5, 21 14.2 " +
      "C 21.4 14, 21.9 13.7, 22.3 13.6 C 22.7 13.4, 23.2 13.3, 23.5 13.3 C 23.8 13.3, 24 13.4, 24.1 13.6 Z",
    stick: "x",
  },
  { key: "L", label: "C", x: 38.5, y: 17.3, r: 1.75, shape: "rond", under: true, size: 2.2 },
  {
    key: "R",
    label: "Z",
    x: 39.4,
    y: 23.8,
    r: 3.3,
    shape: "pastille",
    wide: 0.98,
    under: true,
    d: "M 37.3 20.5 L 41.4 20.5 Q 42.6 20.5, 42.6 21.7 L 42.6 25.9 Q 42.6 27.1, 41.4 27.1 L 37.3 27.1 Z",
    size: 2.6,
  },
];

export const WIIMOTE: PadMap = {
  id: "wiimote",
  name: "Wiimote et Nunchuk",
  viewBox: "0 0 100 66",
  body: `${NC_BODY} ${WM_BODY}`,
  under: [
    ...WM_UNDER,
    {
      tone: "bouton",
      d: "M 22.06 14.74 L 25.76 18.44 L 24.84 19.36 L 21.14 15.66 Z",
    },
  ],
  art: [
    {
      tone: "trait",
      d:
        "M 36.7 13.7 C 35.8 13.8, 32.8 14.2, 31.4 14.7 C 29.9 15.2, 29.2 15.8, 28 16.7 C 26.8 17.6, 25.4 18.8, 24.4 20.1 " +
        "C 23.4 21.5, 22.6 23.4, 21.8 24.9 C 21 26.3, 20.3 27.5, 19.6 28.9 C 18.9 30.3, 18.2 31.7, 17.6 33.3 " +
        "C 17.1 34.9, 16.5 36.7, 16.1 38.5 C 15.6 40.4, 15.3 43.5, 15.1 44.5",
    },
  ],
  deco: WM_DECO,
  wire: "M 20.4 56 C 20.4 62, 28 63.6, 42 63 C 55 62.4, 64.5 63, 69.75 61.4",
  hull: { left: 13.9, right: 82.2, top: 6, bottom: 63 },
  parts: [...WM_PARTS, ...NC_PARTS],
};

/**
 * La guitare, pour les jeux qui n'acceptent qu'elle.
 *
 * Relevée sur une photo vue de dessus de la guitare Wii de Guitar Hero III :
 * le corps à gauche, avec la Wiimote couchée dans sa trappe, la barre de
 * grattage dans son logement, moins et plus dans leur double creux, le petit
 * stick sur la corne du haut et le vibrato qui sort en bas à gauche ; le
 * manche noir à droite, avec ses cinq frettes de couleur près de la tête. Les
 * correspondances viennent de `emulator::config::guitar_binds`.
 *
 * Trois commandes de la trame n'apparaissent pas: une guitare n'a ni croix
 * gauche ni croix droite ni deuxième gâchette. Les tenir n'allume donc rien, et
 * c'est exactement ce que le jeu en fait.
 */
const GT_BODY =
  "M 42.9 14.1 C 43 12.4, 43 11.2, 42.8 10.2 C 42.6 9.2, 42.5 8.6, 41.7 8.1 C 41 7.6, 39.4 7.4, 38.1 7.3 " +
  "C 36.8 7.3, 35.4 7.6, 34 7.8 C 32.6 8, 31.2 8.7, 29.9 8.6 C 28.5 8.6, 27.1 8.1, 25.7 7.6 " +
  "C 24.4 7.1, 23.2 6.2, 21.6 5.5 C 20.1 4.9, 18.2 4.2, 16.4 4 C 14.7 3.8, 12.8 4.1, 11.3 4.5 " +
  "C 9.7 4.9, 8 5.5, 7.2 6.6 C 6.3 7.7, 6.4 9.4, 6.1 11.2 C 5.9 13, 5.7 15.5, 5.6 17.4 " +
  "C 5.5 19.3, 5.4 20.9, 5.6 22.6 C 5.8 24.3, 6.1 26.3, 6.6 27.7 C 7.2 29.2, 7.8 30.4, 8.7 31.3 " +
  "C 9.7 32.3, 10.9 33.2, 12.3 33.7 C 13.8 34.2, 15.8 34.5, 17.5 34.4 C 19.2 34.3, 21.1 33.8, 22.6 33.1 " +
  "C 24.2 32.4, 25.5 31.3, 26.8 30.5 C 28.1 29.7, 29.2 28.8, 30.4 28.3 C 31.6 27.7, 32.8 27.4, 34 27.2 " +
  "C 35.2 27, 36.5 27.1, 37.6 27.2 C 38.7 27.3, 39.8 27.7, 40.7 27.7 C 41.6 27.7, 42.6 27.6, 42.8 27.2 " +
  "C 42.9 26.9, 42.1 26.3, 41.7 25.7 C 41.4 25.1, 40.8 24.3, 40.7 23.6 C 40.6 22.9, 41.2 22.1, 41.4 21.5 " +
  "C 41.7 21, 42 20.6, 42.2 19.9 C 42.5 18.6, 42.8 15.8, 42.9 14.1 Z";
const GT_NECK =
  "M 40.2 14.7 L 84 14.7 L 84.8 11.8 C 86.6 11, 90.8 11.4, 94.4 11.1 C 95.9 10.6, 98 10.4, 98.2 11.4 " +
  "L 98 18.7 C 97.8 19.7, 96.1 19.5, 94.4 19.2 C 90.8 18.9, 86.6 19.3, 84.8 19.7 L 84 20.1 L 40.2 20.1 Z";
const GT_FRET = (key: string, x: number, tint: Matiere): Part => ({
  key,
  label: "",
  x,
  y: 17.4,
  r: 2,
  shape: "pastille",
  wide: 0.6,
  tint: m(tint),
});

export const GUITAR: PadMap = {
  id: "guitar",
  name: "guitare",
  viewBox: "0 0 100 38",
  body: `${GT_BODY} ${GT_NECK}`,
  art: [
    { tone: "bord", d: GT_BODY },
    {
      tone: "plaque",
      d: GT_NECK.replace("M 40.2 14.7", "M 42.7 14.7").replace("L 40.2 20.1", "L 42.7 20.1"),
    },
    {
      tone: "trait",
      d:
        "M 46.4 14.9 L 46.4 19.9 M 51.7 14.9 L 51.7 19.9 M 56.7 14.9 L 56.7 19.9 M 61.3 14.9 L 61.3 19.9 " +
        "M 65.5 14.9 L 65.5 19.9 M 69.1 14.9 L 69.1 19.9 M 72.4 14.9 L 72.4 19.9 M 75.5 14.9 L 75.5 19.9 " +
        "M 78.6 14.9 L 78.6 19.9 M 81.7 14.9 L 81.7 19.9",
    },
    {
      tone: "points",
      d: "M 49.1 17.4 l 0 0 M 54.2 17.4 l 0 0 M 59.1 17.4 l 0 0 M 63.4 17.4 l 0 0 M 67.3 17.4 l 0 0",
    },
  ],
  deco: [
    {
      tone: "creux",
      d: "M 12.6 10.2 L 28 10.2 Q 29.3 10.2, 29.3 11.5 L 29.3 13.5 Q 29.3 14.8, 28 14.8 L 12.6 14.8 Q 11.3 14.8, 11.3 13.5 L 11.3 11.5 Q 11.3 10.2, 12.6 10.2 Z",
    },
    {
      tone: "bouton",
      d: "M 13.2 10.9 L 27.4 10.9 Q 28.6 10.9, 28.6 12.1 L 28.6 12.9 Q 28.6 14.1, 27.4 14.1 L 13.2 14.1 Q 12 14.1, 12 12.9 L 12 12.1 Q 12 10.9, 13.2 10.9 Z",
    },
    {
      tone: "creux",
      d: "M 22.6 15.9 L 33.5 15.9 Q 35 15.9, 35 17.4 L 35 19 Q 35 20.5, 33.5 20.5 L 22.6 20.5 Q 21.1 20.5, 21.1 19 L 21.1 17.4 Q 21.1 15.9, 22.6 15.9 Z",
    },
    {
      tone: "creux",
      d: "M 11.2 20.5 A 2.4 2.4 0 1 0 16 20.5 A 2.4 2.4 0 1 0 11.2 20.5 Z M 8.5 22.8 A 2.4 2.4 0 1 0 13.3 22.8 A 2.4 2.4 0 1 0 8.5 22.8 Z",
    },
  ],
  hull: { left: 2.2, right: 98.2, top: 4, bottom: 34.5 },
  parts: [
    GT_FRET("Z", 70.1, "guitare-orange"),
    GT_FRET("Y", 73, "guitare-bleue"),
    GT_FRET("X", 76.1, "guitare-jaune"),
    GT_FRET("B", 79.2, "guitare-rouge"),
    GT_FRET("A", 82.3, "guitare-verte"),
    { key: "START", label: "+", x: 13.6, y: 20.5, r: 1.5, shape: "rond", size: 2.4 },
    { key: "L", label: "−", x: 10.9, y: 22.8, r: 1.5, shape: "rond", size: 2.4 },
    {
      key: "D_UP",
      label: "",
      x: 28.05,
      y: 17.5,
      r: 0.7,
      shape: "pastille",
      wide: 8.5,
      d: "M 22.8 16.8 L 33.3 16.8 Q 34 16.8, 34 17.5 L 34 18.2 L 22.1 18.2 L 22.1 17.5 Q 22.1 16.8, 22.8 16.8 Z",
      flush: true,
      glyph: GLYPHS.haut,
    },
    {
      key: "D_DOWN",
      label: "",
      x: 28.05,
      y: 18.9,
      r: 0.7,
      shape: "pastille",
      wide: 8.5,
      d: "M 22.1 18.2 L 34 18.2 L 34 18.9 Q 34 19.6, 33.3 19.6 L 22.8 19.6 Q 22.1 19.6, 22.1 18.9 Z",
      flush: true,
      glyph: GLYPHS.bas,
    },
    {
      key: "x",
      label: "",
      x: 40,
      y: 11.4,
      r: 1.6,
      shape: "rond",
      d: octagon(40, 11.4, 1.5),
      gate: true,
      stick: "x",
    },
    {
      key: "cx",
      label: "",
      x: 9,
      y: 28.6,
      r: 1.1,
      shape: "pastille",
      wide: 4.8,
      hangs: true,
      d:
        "M 15.05 25.88 L 5.6 29.2 L 5.9 30.05 L 15.35 26.72 Z " +
        "M 5.9 28.75 L 2.25 30.05 L 2.75 31.45 L 6.4 30.15 Z " +
        "M 14.6 26.3 A 1.1 1.1 0 1 0 16.8 26.3 A 1.1 1.1 0 1 0 14.6 26.3 Z",
      tint: m("guitare-vibrato"),
    },
  ],
};

/** Le plan de chaque manette que Dolphin peut présenter, dans l'ordre du réglage
 * qui les choisit (`lib/saves.PADS`). */
export const WIIMOTE_ONLY: PadMap = {
  ...WIIMOTE,
  id: "wiimote-only",
  name: "Wiimote seule",
  body: WM_BODY,
  under: WM_UNDER,
  art: [],
  wire: "",
  hull: { left: 62, right: 82.2, top: 6, bottom: 61.6 },
  parts: WM_PARTS,
};
export const EMULATED: readonly PadMap[] = [GAMECUBE, WIIMOTE, GUITAR, WIIMOTE_ONLY];

/** Les coques parmi lesquelles l'écran choisit celle qu'on TIENT. La famille
 * que le navigateur annonce décide (voir `Wiring.tsx`). */
export const PHYSICAL: readonly PadMap[] = [STANDARD_PAD, DUALSHOCK, XBOX, SWITCH_PRO_PAD];

/** Les positions ne sont fiables que si le navigateur annonce la norme.
 * Une marque reconnue sans disposition standard reste un diagramme d'indices. */
export function physicalMap(identity: PadIdentity | null): PadMap {
  if (!identity?.standard) return STANDARD_PAD;
  if (identity.family === "playstation") return DUALSHOCK;
  if (identity.family === "xbox") return XBOX;
  if (identity.family === "nintendo") return SWITCH_PRO_PAD;
  return STANDARD_PAD;
}

export const MAPS: Record<string, PadMap> = {
  [GAMECUBE.id]: GAMECUBE,
  [STANDARD_PAD.id]: STANDARD_PAD,
  [DUALSHOCK.id]: DUALSHOCK,
  [XBOX.id]: XBOX,
  [SWITCH_PRO_PAD.id]: SWITCH_PRO_PAD,
  [SWITCH_PRO.id]: SWITCH_PRO,
  [XBOX_360.id]: XBOX_360,
  [WIIMOTE.id]: WIIMOTE,
  [GUITAR.id]: GUITAR,
};
