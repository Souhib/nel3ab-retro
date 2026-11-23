/**
 * Aïn au salon : l'entrée du paquet que le salon sert à ses pages (accueil,
 * dépôt, carnet), sans la page React de la salle (ADR D46, D41).
 *
 * `just ain-salon` le construit dans `control/nel3ab_control/api/routes/
 * retro/ain.js`, avec sa marque `ain.SOURCES` ; `salon.test.ts` refuse un
 * paquet plus vieux que ses sources, comme `stamp.mjs` pour la page. Le
 * chantier salon le branche (une marque de `retro.py`, ou une route).
 *
 * Le contrat avec une page du salon :
 *
 * - l'hôte : un élément `data-hote="logo"` là où le logo s'affiche. Aïn y
 *   est peint au chargement, à 2 px par pixel d'Aïn si la place le permet ;
 * - le décor : les ancres et les sols que ses scènes demandent, posés par
 *   la page (`salles`, `regle-carnet`, `depot`, `depot-mot`, `place-libre`,
 *   les sols `etagere-haut` et `etagere-bas`). Une ancre absente replie la
 *   scène en version courte, puis en pose clé : rien ne casse ;
 * - les mots qu'il ne doit pas couvrir portent `data-texte` ; les contrôles
 *   (boutons, liens, champs) sont lus d'office ;
 * - la feuille : celle des effets, que le salon pose déjà (`effets.css`) ;
 * - les scènes : la page appelle `nel3abAin.scene("depot")`. Hors d'une
 *   salle, cinq scènes jouent leur variante du salon (`AU_SALON`).
 *
 * Rien ne tourne entre deux scènes, comme dans la salle.
 */
import { jouer, poserMascotte, type Contexte, type Scene, type Version } from "./index";

/** Peint Aïn dans chaque hôte de la page. Rend leur nombre. */
export function monter(racine: ParentNode = document): number {
  let n = 0;
  for (const hote of racine.querySelectorAll<HTMLElement>("[data-hote]"))
    if (poserMascotte(hote)) n++;
  return n;
}

/** Ce que le salon appelle : une scène, sur l'hôte `ou` (le logo par
 * défaut). Rend la version jouée, la pose clé, ou « sans-hote ». */
export function scene(
  quoi: Scene,
  {
    ou = "logo",
    version = "auto",
    phrase,
    region = null,
    contexte,
  }: {
    ou?: string;
    version?: Version | "auto";
    phrase?: string;
    region?: HTMLElement | null;
    contexte?: Contexte;
  } = {},
): string {
  const hote = document.querySelector<HTMLElement>(`[data-hote="${ou}"]`);
  if (!hote) return "sans-hote";
  jouer(quoi, { hote, version, phrase, region, contexte });
  return hote.querySelector<HTMLElement>(".rt-mascotte")?.dataset.version ?? "cle";
}

const crochet = globalThis as { nel3abAin?: Record<string, unknown> };
crochet.nel3abAin = { ...crochet.nel3abAin, scene, monter };

if (typeof document !== "undefined") {
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => monter(), { once: true });
  else monter();
}
