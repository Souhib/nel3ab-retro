/**
 * Le logo « nel3ab » en lettres de pixels, et l'icône d'onglet.
 *
 * # Le choix
 *
 * Le propriétaire a choisi le « relief en escalier » sur la page des effets
 * du 23 novembre 2026 (ADR D37): les six lettres dessinées sur une grille de
 * sept pixels de haut, sans police, chacune doublée d'un relief en trois
 * marches décalées d'un pixel (cyan, magenta puis bleu la nuit), et le 3 en
 * jaune. Les glyphes et l'ordre de peinture sont ceux de `logoSVG` de cette
 * page, recopiés ici; `logo.test.ts` peint les deux sur une grille et exige
 * la même couleur dans chaque case, de nuit et de jour.
 *
 * # Une seule source
 *
 * La salle l'affiche par `<Logo>` (`components/Logo.tsx`), le salon le reçoit
 * au démarrage (`control/.../routes/retro/logo.svg`, écrit depuis ce module et
 * comparé par `salon-retro.test.ts`). Les couleurs ne sont pas écrites dans le
 * dessin: chaque calque lit un jeton de `regie.css` (`--logo-lettre`,
 * `--logo-trois`, `--logo-relief-1` à `3`), si bien que le même dessin passe de
 * la nuit au jour avec la page. L'icône d'onglet, elle, ne lit aucune page:
 * ses couleurs sont écrites.
 *
 * # Pourquoi des chemins et pas des carrés
 *
 * La page des effets posait un `<rect>` d'un pixel par case: 472 rectangles,
 * 26 ko de balisage. Ici chaque calque est UN chemin, une suite de traits
 * horizontaux: les mêmes cases couvertes, environ dix fois moins de texte, et
 * plus de joint visible entre deux carrés voisins à une échelle non entière.
 */

/** Les lettres, sur une grille de 7 lignes. `#` est un pixel allumé. */
export const GLYPHES = {
  n: [".....", ".....", "####.", "##.##", "##.##", "##.##", "##.##"],
  e: [".....", ".....", ".###.", "##.##", "#####", "##...", ".####"],
  l: ["##.", "##.", "##.", "##.", "##.", "##.", ".##"],
  "3": ["######.", ".....##", ".....##", "..####.", ".....##", ".....##", "######."],
  a: [".....", ".....", "####.", "...##", ".####", "##.##", ".####"],
  b: ["##...", "##...", "####.", "##.##", "##.##", "##.##", "####."],
} as const satisfies Record<string, readonly string[]>;

/** Les sept barres de la mire, dans l'ordre de l'écran (`--mire-*` de
 * `regie.css`, que `regie.test.ts` compare à ce tableau). */
export const MIRE = [
  "#eef0f2",
  "#f2e14b",
  "#57d3f0",
  "#63d488",
  "#d06fd0",
  "#e0604f",
  "#4f63e0",
] as const;

/** Les couleurs d'un logo: ses lettres, son 3, et son relief, de la marche la
 * plus proche (décalée d'un pixel) à la plus lointaine (trois pixels). */
export type CouleursLogo = {
  lettre: string;
  trois: string;
  relief: readonly [string, string, string];
};

/** La nuit: lettres claires, relief cyan, magenta puis bleu, le 3 en jaune. */
export const LOGO_NUIT: CouleursLogo = {
  lettre: "#eef0f2",
  trois: "#f2e14b",
  relief: ["#57d3f0", "#d06fd0", "#4f63e0"],
};

/** Le jour: lettres marine, la marche la plus lointaine en gris bleuté. */
export const LOGO_JOUR: CouleursLogo = {
  lettre: "#11142a",
  trois: "#f2e14b",
  relief: ["#57d3f0", "#d06fd0", "#9aa3c2"],
};

/** Les jetons de `regie.css` que lit chaque calque du logo dans une page. */
export const JETONS_LOGO = {
  lettre: "--logo-lettre",
  trois: "--logo-trois",
  relief: ["--logo-relief-1", "--logo-relief-2", "--logo-relief-3"],
} as const;

/** Un pixel allumé du logo, et s'il appartient au 3. */
export type Pixel = { x: number; y: number; trois: boolean };

/** La largeur des lettres seules, sans relief: 35 pixels. */
export const LARGEUR_LETTRES = 35;
/** Le relief ajoute trois pixels à droite et en bas. */
export const RELIEF = 3;
export const LARGEUR = LARGEUR_LETTRES + RELIEF;
export const HAUTEUR = 7 + RELIEF;

/** Les pixels des six lettres, de gauche à droite, une colonne vide entre
 * deux lettres. */
export function pixelsDuLogo(): Pixel[] {
  const pixels: Pixel[] = [];
  let x = 0;
  for (const lettre of ["n", "e", "l", "3", "a", "b"] as const) {
    const glyphe = GLYPHES[lettre];
    const largeur = glyphe[0].length;
    glyphe.forEach((ligne, y) => {
      for (let c = 0; c < largeur; c += 1) {
        if (ligne[c] === "#") pixels.push({ x: x + c, y, trois: lettre === "3" });
      }
    });
    x += largeur + 1;
  }
  return pixels;
}

/** Un chemin SVG qui couvre exactement ces cases: une suite de traits
 * horizontaux, une ligne après l'autre. */
export function chemin(pixels: readonly { x: number; y: number }[]): string {
  const lignes = new Map<number, number[]>();
  for (const { x, y } of pixels) lignes.set(y, [...(lignes.get(y) ?? []), x]);
  const traits: string[] = [];
  for (const y of [...lignes.keys()].sort((a, b) => a - b)) {
    const xs = [...new Set(lignes.get(y))].sort((a, b) => a - b);
    let debut = xs[0] ?? 0;
    let fin = debut;
    const poser = () => traits.push(`M${debut} ${y}h${fin - debut + 1}v1h-${fin - debut + 1}z`);
    for (const x of xs.slice(1)) {
      if (x === fin + 1) {
        fin = x;
        continue;
      }
      poser();
      debut = x;
      fin = x;
    }
    if (xs.length > 0) poser();
  }
  return traits.join("");
}

/** Comment le logo se colore: par les jetons de la page, ou par des couleurs
 * écrites (une image hors de toute page, un essai). */
export type Peinture = "jetons" | CouleursLogo;

const echapper = (texte: string) =>
  texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/**
 * Le logo en SVG, prêt à poser dans une page.
 *
 * `unite` est la taille d'un pixel du dessin, en pixels d'écran (2 donne un
 * logo de 76 × 20). Le dessin se nomme « nel3ab » pour un lecteur d'écran
 * (`role="img"`); `titre` vide le rend décoratif, quand un texte voisin dit
 * déjà le nom.
 */
export function logoSVG({
  unite = 2,
  peinture = "jetons",
  titre = "nel3ab",
}: { unite?: number; peinture?: Peinture; titre?: string } = {}): string {
  const pixels = pixelsDuLogo();
  const tout = chemin(pixels);
  const couleur = (jeton: string, ecrite: string) =>
    peinture === "jetons" ? `style="fill:var(${jeton})"` : `fill="${ecrite}"`;
  const calques: string[] = [];
  for (let marche = RELIEF; marche >= 1; marche -= 1) {
    const rang = marche - 1;
    const ecrite = peinture === "jetons" ? "" : (peinture.relief[rang] ?? "");
    calques.push(
      `<path transform="translate(${marche} ${marche})" ${couleur(JETONS_LOGO.relief[rang] ?? "", ecrite)} d="${tout}"/>`,
    );
  }
  const lettres = chemin(pixels.filter((p) => !p.trois));
  const trois = chemin(pixels.filter((p) => p.trois));
  calques.push(
    `<path ${couleur(JETONS_LOGO.lettre, peinture === "jetons" ? "" : peinture.lettre)} d="${lettres}"/>`,
    `<path ${couleur(JETONS_LOGO.trois, peinture === "jetons" ? "" : peinture.trois)} d="${trois}"/>`,
  );
  const nom = titre
    ? `role="img" aria-label="${echapper(titre)}"`
    : `aria-hidden="true" focusable="false"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="rt-logo" viewBox="0 0 ${LARGEUR} ${HAUTEUR}"` +
    ` width="${LARGEUR * unite}" height="${HAUTEUR * unite}" shape-rendering="crispEdges" ${nom}>` +
    `${calques.join("")}</svg>`
  );
}

/**
 * L'icône d'onglet: le 3 seul, en seize pixels sur noir, chaque colonne à la
 * couleur de sa barre de mire. C'est l'icône que la page des effets montrait
 * sous chaque logo, et donc sous le relief en escalier choisi.
 */
export function iconeOngletSVG(): string {
  const glyphe = GLYPHES["3"];
  const carres = ['<rect width="16" height="16" fill="#000"/>'];
  glyphe.forEach((ligne, r) => {
    for (let c = 0; c < 7; c += 1) {
      if (ligne[c] === "#")
        carres.push(
          `<rect x="${1 + c * 2}" y="${1 + r * 2}" width="2" height="2" fill="${MIRE[c]}"/>`,
        );
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${carres.join("")}</svg>`;
}

/** L'icône en adresse `data:`, pour `<link rel="icon">`: le worker ne sert
 * qu'un fichier, et une icône à sa propre adresse y serait un 404. */
export function iconeOngletDataUrl(): string {
  return `data:image/svg+xml,${encodeURIComponent(iconeOngletSVG())}`;
}
