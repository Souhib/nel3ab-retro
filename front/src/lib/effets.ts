/**
 * Les effets rétro: le catalogue, les trois niveaux, et le réglage de
 * l'appareil.
 *
 * # Le catalogue
 *
 * Les 46 effets de la page des effets du 23 novembre 2026 (ADR D37), avec
 * leur famille, leur niveau (`d` discret, `m` moyen, `M` marqué) et l'avis
 * donné sur la page (`oui`, `doser`, `non`). Le propriétaire les a tous
 * retenus, derrière un réglage à trois niveaux:
 *
 * - « sobre »: les effets discrets (`niv: "d"`);
 * - « conseillé », le défaut: ceux que la page conseillait (`avis: "oui"`);
 * - « tout »: les 46, sauf les sons.
 *
 * Les niveaux s'emboîtent (`effets.test.ts` le vérifie): tout effet sobre est
 * conseillé, tout effet conseillé est dans « tout ». Les sons de menu sont un
 * réglage À PART, coupé par défaut, qu'aucun niveau n'allume.
 *
 * # Comment un effet s'allume
 *
 * Par une classe `fx-<id>` sur `<html>`, et `data-effets` qui dit le niveau.
 * Les feuilles (`src/effets.css`, `regie.css` pour les polices) visent ces
 * classes; le code lit `effetActif(id)`. La classe est posée AVANT la première
 * image par le script de l'en-tête (`scriptEnTete`), dans la salle comme au
 * salon, puis reposée par ce module: une police de titre qui changerait sous
 * les yeux au chargement serait le défaut même que le thème a dû corriger.
 *
 * # Un réglage par appareil, une clé pour les deux
 *
 * Le salon et les salles sont servis sous la même origine (`nel3ab.app`, la
 * salle sous `/r/N/`): une seule clé, `nel3ab:effets`, que les deux lisent.
 * Changer le niveau dans une salle le change au salon, et dans les autres
 * onglets (`storage`). Elle porte un objet `{ niveau, sons }`: les deux
 * réglages voyagent ensemble, et une valeur illisible retombe sur le défaut
 * plutôt que de deviner.
 *
 * # Mouvement réduit
 *
 * `prefers-reduced-motion` ne retire AUCUN effet: la pose clé et le texte
 * restent, rien ne bouge. Les feuilles coupent leurs animations sous la
 * requête média; le code demande `mouvementReduit()` avant d'animer.
 */

export type Famille = "mire" | "pixels" | "menu" | "transitions" | "tube" | "arcade";
export type Force = "d" | "m" | "M";
export type Avis = "oui" | "doser" | "non";

/** Les 46 effets, dans l'ordre de la page des effets. */
export const EFFETS = [
  // La mire et les couleurs
  { id: "mire-vide", fam: "mire", niv: "d", avis: "oui" },
  { id: "mire-charge", fam: "mire", niv: "m", avis: "doser" },
  { id: "palette", fam: "mire", niv: "d", avis: "oui" },
  { id: "cycle", fam: "mire", niv: "m", avis: "doser" },
  { id: "tramage", fam: "mire", niv: "d", avis: "oui" },
  // Les pixels
  { id: "titres", fam: "pixels", niv: "d", avis: "oui" },
  { id: "texte-pixel", fam: "pixels", niv: "M", avis: "non" },
  { id: "coins", fam: "pixels", niv: "d", avis: "oui" },
  { id: "ombres", fam: "pixels", niv: "d", avis: "oui" },
  { id: "nettes", fam: "pixels", niv: "d", avis: "oui" },
  { id: "icones", fam: "pixels", niv: "d", avis: "oui" },
  { id: "pointeur", fam: "pixels", niv: "m", avis: "doser" },
  { id: "chiffres", fam: "pixels", niv: "d", avis: "oui" },
  // Le menu de jeu
  { id: "curseur", fam: "menu", niv: "d", avis: "oui" },
  { id: "boutons", fam: "menu", niv: "d", avis: "oui" },
  { id: "start", fam: "menu", niv: "m", avis: "oui" },
  { id: "arrive", fam: "menu", niv: "d", avis: "oui" },
  { id: "lettres", fam: "menu", niv: "m", avis: "doser" },
  { id: "compteur", fam: "menu", niv: "m", avis: "doser" },
  { id: "sons", fam: "menu", niv: "m", avis: "doser" },
  { id: "secousse", fam: "menu", niv: "M", avis: "non" },
  // Les transitions
  { id: "fondu", fam: "transitions", niv: "d", avis: "oui" },
  { id: "mosaique", fam: "transitions", niv: "m", avis: "oui" },
  { id: "iris", fam: "transitions", niv: "m", avis: "doser" },
  { id: "tuiles", fam: "transitions", niv: "m", avis: "doser" },
  { id: "coupure", fam: "transitions", niv: "m", avis: "doser" },
  { id: "defile", fam: "transitions", niv: "M", avis: "non" },
  { id: "extinction", fam: "transitions", niv: "m", avis: "oui" },
  { id: "paliers", fam: "transitions", niv: "m", avis: "doser" },
  // Le tube
  { id: "balayage", fam: "tube", niv: "m", avis: "oui" },
  { id: "balayage-tout", fam: "tube", niv: "M", avis: "non" },
  { id: "grille", fam: "tube", niv: "M", avis: "non" },
  { id: "vignette", fam: "tube", niv: "m", avis: "doser" },
  { id: "halo", fam: "tube", niv: "d", avis: "oui" },
  { id: "bave", fam: "tube", niv: "m", avis: "doser" },
  { id: "neige", fam: "tube", niv: "m", avis: "oui" },
  { id: "roulement", fam: "tube", niv: "m", avis: "doser" },
  { id: "scintille", fam: "tube", niv: "M", avis: "non" },
  { id: "courbure", fam: "tube", niv: "M", avis: "non" },
  // La salle d'arcade
  { id: "fronton", fam: "arcade", niv: "d", avis: "oui" },
  { id: "borne", fam: "arcade", niv: "m", avis: "doser" },
  { id: "places", fam: "arcade", niv: "d", avis: "oui" },
  { id: "initiales", fam: "arcade", niv: "m", avis: "doser" },
  { id: "scores", fam: "arcade", niv: "d", avis: "oui" },
  { id: "demo", fam: "arcade", niv: "m", avis: "doser" },
  { id: "credit", fam: "arcade", niv: "d", avis: "oui" },
] as const satisfies readonly { id: string; fam: Famille; niv: Force; avis: Avis }[];

export type IdEffet = (typeof EFFETS)[number]["id"];

/** Les trois niveaux, dans l'ordre du plus calme au plus chargé. */
export const NIVEAUX = ["sobre", "conseille", "tout"] as const;
export type Niveau = (typeof NIVEAUX)[number];
export const NIVEAU_DEFAUT: Niveau = "conseille";

/** La clé du réglage, lue par la salle et par le salon. */
export const CLE = "nel3ab:effets";

export type Reglage = { niveau: Niveau; sons: boolean };
export const REGLAGE_DEFAUT: Reglage = { niveau: NIVEAU_DEFAUT, sons: false };

export const estNiveau = (valeur: unknown): valeur is Niveau =>
  typeof valeur === "string" && (NIVEAUX as readonly string[]).includes(valeur);

/** Un effet est-il dans ce niveau ? Les sons n'y sont jamais. */
export function dansLeNiveau(effet: (typeof EFFETS)[number], niveau: Niveau): boolean {
  if (effet.id === "sons") return false;
  if (niveau === "tout") return true;
  if (niveau === "sobre") return effet.niv === "d";
  return effet.avis === "oui";
}

/** Les effets d'un niveau, sons exclus. */
export function effetsDuNiveau(niveau: Niveau): ReadonlySet<IdEffet> {
  return new Set(EFFETS.filter((effet) => dansLeNiveau(effet, niveau)).map((effet) => effet.id));
}

/** Les effets allumés par un réglage: ceux du niveau, et les sons s'ils sont
 * demandés. */
export function effetsDu(reglage: Reglage): ReadonlySet<IdEffet> {
  const actifs = new Set<IdEffet>(effetsDuNiveau(reglage.niveau));
  if (reglage.sons) actifs.add("sons");
  return actifs;
}

/** Lit la valeur stockée. Tout ce qui n'est pas un réglage reconnu retombe sur
 * le défaut, champ par champ: un niveau inconnu ne coupe pas des sons choisis. */
export function lireReglage(brut: string | null): Reglage {
  if (brut === null) return { ...REGLAGE_DEFAUT };
  let lu: unknown;
  try {
    lu = JSON.parse(brut);
  } catch {
    return { ...REGLAGE_DEFAUT };
  }
  if (typeof lu !== "object" || lu === null) return { ...REGLAGE_DEFAUT };
  const objet = lu as Record<string, unknown>;
  return {
    niveau:
      Object.hasOwn(objet, "niveau") && estNiveau(objet.niveau) ? objet.niveau : NIVEAU_DEFAUT,
    sons: Object.hasOwn(objet, "sons") && objet.sons === true,
  };
}

export const ecrireReglage = (reglage: Reglage): string =>
  JSON.stringify({ niveau: reglage.niveau, sons: reglage.sons });

/** Le réglage de cet appareil. Un stockage refusé (navigation privée, page
 * vue dans un aperçu) rend le défaut: la page marche sans. */
export function reglageStocke(): Reglage {
  try {
    return lireReglage(localStorage.getItem(CLE));
  } catch {
    return { ...REGLAGE_DEFAUT };
  }
}

let courant: Reglage = { ...REGLAGE_DEFAUT };
let lu = false;
const abonnes = new Set<(reglage: Reglage) => void>();

function actuel(): Reglage {
  if (!lu) {
    courant = reglageStocke();
    lu = true;
  }
  return courant;
}

/** Le réglage en cours, le même objet tant qu'il ne change pas: React le lit
 * par `useSyncExternalStore(abonner, instantane)`. */
export const instantane = (): Readonly<Reglage> => actuel();

/** Le niveau en cours. */
export const niveau = (): Niveau => actuel().niveau;

/** Les sons de menu sont-ils demandés ? */
export const sonsMenu = (): boolean => actuel().sons;

/** Cet effet est-il allumé sur cet appareil ? `sons` suit son propre réglage. */
export function effetActif(id: IdEffet): boolean {
  return effetsDu(actuel()).has(id);
}

/** L'appareil demande-t-il moins de mouvement ? Lu à chaque appel: le réglage
 * du système peut changer pendant que la page est ouverte. */
export function mouvementReduit(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Pose les classes `fx-<id>`, `data-effets` et `data-sons` sur la racine.
 * Toutes les classes du catalogue sont posées ou retirées: une classe d'un
 * niveau précédent ne doit pas survivre au changement. */
export function appliquer(racine: HTMLElement = document.documentElement): void {
  const actifs = effetsDu(actuel());
  for (const effet of EFFETS) racine.classList.toggle(`fx-${effet.id}`, actifs.has(effet.id));
  racine.dataset.effets = actuel().niveau;
  racine.dataset.sons = actuel().sons ? "oui" : "non";
}

function changer(suivant: Reglage): void {
  courant = { ...suivant };
  lu = true;
  try {
    localStorage.setItem(CLE, ecrireReglage(courant));
  } catch {
    /* navigation privée: le réglage vaut pour cet onglet */
  }
  appliquer();
  for (const abonne of abonnes) abonne({ ...courant });
}

/** Change le niveau sur cet appareil, et le dit à ceux qui écoutent. */
export function changerNiveau(suivant: Niveau): void {
  if (!estNiveau(suivant)) throw new Error(`niveau d'effets inconnu: ${String(suivant)}`);
  changer({ ...actuel(), niveau: suivant });
}

/** Allume ou coupe les sons de menu. */
export function changerSons(actifs: boolean): void {
  changer({ ...actuel(), sons: actifs });
}

/** Écoute les changements du réglage. Rend la fonction qui arrête d'écouter. */
export function abonner(rappel: (reglage: Reglage) => void): () => void {
  abonnes.add(rappel);
  return () => abonnes.delete(rappel);
}

/** Relit le stockage: un autre onglet (une salle, le salon) a pu le changer. */
export function relire(): void {
  courant = reglageStocke();
  lu = true;
  appliquer();
  for (const abonne of abonnes) abonne({ ...courant });
}

let demarre = false;

/** Pose le réglage sur la page et suit les autres onglets. Appelé une fois,
 * avant le premier rendu de React (`main.tsx`). */
export function demarrer(): void {
  relire();
  if (demarre) return;
  demarre = true;
  window.addEventListener("storage", (evenement) => {
    if (evenement.key === CLE || evenement.key === null) relire();
  });
}

/**
 * Le script de l'en-tête, en texte: le même dans la salle (`front/index.html`)
 * et dans les pages du salon (`control/.../routes/retro/en-tete.html`).
 *
 * Un script classique, lancé avant le corps, qui fait ce que `appliquer` fera
 * plus tard, avec le même catalogue écrit en court (`id/force/avis`).
 * `effets.test.ts` l'exécute dans un contexte qui ne porte que ce qu'un
 * navigateur lui donne, pour chaque valeur stockée, et compare les classes
 * posées à celles de `appliquer`. Il ne lève jamais: une erreur ici
 * empêcherait le thème posé juste avant de servir.
 *
 * Il laisse `nel3abEffets.appliquer` à la page, pour que le réglage du salon
 * repose les classes sans recharger.
 */
export function scriptEnTete(): string {
  const court = EFFETS.map((e) => `${e.id}/${e.niv}/${e.avis === "oui" ? "o" : "-"}`).join(" ");
  return [
    "(function () {",
    `  var effets = "${court}".split(" ");`,
    "  function appliquer() {",
    `    var niveau = "${NIVEAU_DEFAUT}", sons = false;`,
    "    try {",
    `      var lu = JSON.parse(localStorage.getItem("${CLE}") || "null");`,
    '      if (lu && typeof lu === "object") {',
    '        if (lu.niveau === "sobre" || lu.niveau === "conseille" || lu.niveau === "tout") niveau = lu.niveau;',
    "        if (lu.sons === true) sons = true;",
    "      }",
    "    } catch (refus) {}",
    "    try {",
    "      var racine = document.documentElement;",
    "      for (var i = 0; i < effets.length; i++) {",
    '        var e = effets[i].split("/");',
    '        var actif = e[0] === "sons" ? sons : niveau === "tout" ? true : niveau === "sobre" ? e[1] === "d" : e[2] === "o";',
    '        racine.classList.toggle("fx-" + e[0], actif);',
    "      }",
    '      racine.setAttribute("data-effets", niveau);',
    '      racine.setAttribute("data-sons", sons ? "oui" : "non");',
    "    } catch (refus) {}",
    "  }",
    "  appliquer();",
    "  try {",
    "    window.nel3abEffets = { appliquer: appliquer };",
    '    window.addEventListener("storage", function (e) {',
    `      if (e.key === "${CLE}" || e.key === null) appliquer();`,
    "    });",
    "  } catch (refus) {}",
    "})();",
  ].join("\n");
}

/** Pour les essais: oublie ce qui a été lu, sans toucher au stockage. */
export function oublierPourEssai(): void {
  lu = false;
  courant = { ...REGLAGE_DEFAUT };
  abonnes.clear();
}
