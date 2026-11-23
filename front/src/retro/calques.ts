/**
 * Les calques du tube, et les filtres que les effets posent dans le document.
 *
 * - `poserCalquesAttente`: balayage, vignette et roulement, sur un écran SANS
 *   jeu (la mire, un démarrage, une connexion coupée);
 * - `poserCalquesUi`: balayage partout, grille de phosphore et scintillement
 *   (niveau « tout »), dans une surface d'interface;
 * - `neige`: le signal perdu, sur son propre canevas;
 * - `poserFiltresMosaique`, `poserFiltreBombe`: les filtres SVG de la mosaïque
 *   et de l'écran bombé.
 *
 * Un calque vit DANS sa surface et s'arrête à son bord. Une surface qui est la
 * zone de jeu, qui est dedans ou qui la contient est refusée: un calque posé
 * là passerait sur l'image (ADR D37). Les feuilles (`src/effets.css`) montrent
 * ou cachent chaque calque selon le niveau choisi; ces fonctions ne font que
 * poser la structure, une fois.
 */
import { effetActif, mouvementReduit } from "../lib/effets";
import { cacherLImage, toucheLImage } from "./image";

const rien = () => {};

function enfant(parent: HTMLElement, balise: string, classe: string): HTMLElement {
  const el = document.createElement(balise);
  el.className = classe;
  el.setAttribute("aria-hidden", "true");
  parent.append(el);
  return el;
}

/** La surface doit pouvoir porter des calques en `position: absolute`. */
function positionner(surface: HTMLElement): () => void {
  if (getComputedStyle(surface).position !== "static") return rien;
  const avant = surface.style.position;
  surface.style.position = "relative";
  return () => {
    surface.style.position = avant;
  };
}

/** Les trois calques d'un écran d'attente. Rend la fonction qui les retire.
 * Refusé (et sans effet) sur l'image du jeu. */
export function poserCalquesAttente(surface: HTMLElement): () => void {
  if (toucheLImage(surface)) return rien;
  const remettre = positionner(surface);
  const poses = ["rt-calque-balayage", "rt-calque-vignette", "rt-calque-roulement"].map((classe) =>
    enfant(surface, "i", classe),
  );
  return () => {
    for (const calque of poses) calque.remove();
    remettre();
  };
}

/** Les calques de toute l'interface, dans une surface. `page`: la surface est
 * la page entière (le salon), le calque reste fixe à l'écran. Refusé sur une
 * surface qui touche l'image du jeu. */
export function poserCalquesUi(surface: HTMLElement, { page = false } = {}): () => void {
  if (toucheLImage(surface)) return rien;
  const remettre = page ? rien : positionner(surface);
  const conteneur = enfant(
    surface,
    "div",
    page ? "rt-calques-ui rt-calques-page" : "rt-calques-ui",
  );
  for (const classe of ["rt-calque-balayage-tout", "rt-calque-grille", "rt-calque-scintille"])
    enfant(conteneur, "i", classe);
  return () => {
    conteneur.remove();
    remettre();
  };
}

/** Une image de bruit, en niveaux de gris. Sans contexte 2D (un navigateur
 * sans écran, un essai), le canevas reste noir. */
export function bruit(canevas: HTMLCanvasElement, hasard: () => number = Math.random): void {
  const contexte = canevas.getContext("2d");
  if (!contexte) return;
  const image = contexte.createImageData(canevas.width, canevas.height);
  const d = image.data;
  for (let k = 0; k < d.length; k += 4) {
    const v = Math.floor(hasard() * 256);
    d[k] = v;
    d[k + 1] = v;
    d[k + 2] = v;
    d[k + 3] = 255;
  }
  contexte.putImageData(image, 0, 0);
}

/** « neige »: le signal perdu, redessiné vingt fois par seconde tant que la
 * page est visible, sur un canevas `.rt-neige` posé À LA PLACE de l'image.
 *
 * `remplace` est la zone de jeu qu'elle remplace: la zone est cachée d'abord
 * (`cacherLImage`), puis la neige paraît, et la zone revient à l'arrêt. Un
 * canevas posé dans une zone de jeu sans la cacher est refusé: il passerait
 * sur l'image. Rien sans l'effet; une seule image fixe en mouvement réduit.
 * Rend la fonction qui l'arrête. */
export function neige(
  canevas: HTMLCanvasElement,
  { remplace }: { remplace?: HTMLElement } = {},
): () => void {
  if (!effetActif("neige")) return rien;
  if (remplace === undefined && toucheLImage(canevas)) return rien;
  const remontrer = remplace ? cacherLImage(remplace) : rien;
  canevas.setAttribute("data-actif", "");
  bruit(canevas);
  const minuterie = mouvementReduit()
    ? undefined
    : window.setInterval(() => {
        if (document.visibilityState === "visible") bruit(canevas);
      }, 50);
  return () => {
    if (minuterie !== undefined) window.clearInterval(minuterie);
    canevas.removeAttribute("data-actif");
    remontrer();
  };
}

const SVG = "http://www.w3.org/2000/svg";

/** Le conteneur caché des filtres du thème, créé une fois. */
function filtres(): SVGSVGElement {
  const deja = document.getElementById("rt-filtres");
  if (deja instanceof SVGSVGElement) return deja;
  const svg = document.createElementNS(SVG, "svg");
  svg.id = "rt-filtres";
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.position = "absolute";
  document.body.append(svg);
  return svg;
}

/** Les tailles de carrés de la mosaïque, et l'identifiant de leur filtre. */
export const CARRES_MOSAIQUE = [4, 8, 16, 32] as const;
export const filtreMosaique = (taille: number) => `rt-px${taille}`;

/** Les quatre filtres de la mosaïque: chaque carré prend la couleur de son
 * point central. Les filtres de la page des effets. */
export function poserFiltresMosaique(): void {
  const svg = filtres();
  for (const taille of CARRES_MOSAIQUE) {
    if (document.getElementById(filtreMosaique(taille))) continue;
    const demi = taille / 2;
    const filtre = document.createElementNS(SVG, "filter");
    filtre.id = filtreMosaique(taille);
    for (const [nom, valeur] of [
      ["x", "0"],
      ["y", "0"],
      ["width", "100%"],
      ["height", "100%"],
    ])
      filtre.setAttribute(nom ?? "", valeur ?? "");
    filtre.innerHTML =
      `<feFlood x="${demi}" y="${demi}" width="1" height="1"/>` +
      `<feComposite width="${taille}" height="${taille}"/>` +
      `<feTile result="a"/>` +
      `<feComposite in="SourceGraphic" in2="a" operator="in"/>` +
      `<feMorphology operator="dilate" radius="${demi}"/>`;
    svg.append(filtre);
  }
}

/** La carte de déplacement de l'écran bombé: chaque point est poussé vers le
 * centre selon sa distance au bord. `null` sans canevas 2D. */
function carteBombe(): string | null {
  const n = 128;
  const canevas = document.createElement("canvas");
  canevas.width = n;
  canevas.height = n;
  const contexte = canevas.getContext("2d");
  if (!contexte) return null;
  const image = contexte.createImageData(n, n);
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1) {
      const u = (x / (n - 1)) * 2 - 1;
      const v = (y / (n - 1)) * 2 - 1;
      const r2 = u * u + v * v;
      const k = (y * n + x) * 4;
      image.data[k] = Math.round((0.5 - u * r2 * 0.25) * 255);
      image.data[k + 1] = Math.round((0.5 - v * r2 * 0.25) * 255);
      image.data[k + 2] = 128;
      image.data[k + 3] = 255;
    }
  contexte.putImageData(image, 0, 0);
  return canevas.toDataURL();
}

/** Le filtre de l'écran bombé (`.fx-courbure .rt-bombe`). Sans canevas, le
 * filtre n'est pas posé et l'écran reste plat: la règle CSS vise alors un
 * filtre absent, que le navigateur ignore. */
export function poserFiltreBombe(): boolean {
  if (document.getElementById("rt-bombe")) return true;
  const carte = carteBombe();
  if (!carte) return false;
  const filtre = document.createElementNS(SVG, "filter");
  filtre.id = "rt-bombe";
  filtre.setAttribute("x", "0");
  filtre.setAttribute("y", "0");
  filtre.setAttribute("width", "1");
  filtre.setAttribute("height", "1");
  filtre.setAttribute("primitiveUnits", "objectBoundingBox");
  filtre.setAttribute("color-interpolation-filters", "sRGB");
  filtre.innerHTML =
    `<feImage href="${carte}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="carte"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="carte" scale="0.12" xChannelSelector="R" yChannelSelector="G"/>`;
  filtres().append(filtre);
  return true;
}
