/**
 * Le rendu de la mascotte : Aïn, le 3 du logo, vivant (ADR D46). C'est le
 * seul endroit qui le branche sur `jouer()` (`index.ts`), dont l'API ne
 * change pas : un hôte, une scène, une version.
 *
 * # Ses maisons
 *
 * L'hôte dit où Aïn habite (`data-hote`, posé par le cadre de la salle) :
 *
 * - `coin` : le logo au pied de la colonne ; Aïn est le 3, il en sort et y
 *   rentre, sa place reste en pointillés quand il est dehors ;
 * - `bord-panneau` : le même personnage que le coin (une arrivée au bord du
 *   panneau part du logo) ;
 * - `barre` : sa tête seule, au téléphone ; les scènes y jouent leur
 *   version courte ;
 * - `plateau` : l'écran noir sans image peinte, où il joue en grand ; la
 *   première image le coupe aussitôt (K06), et l'observateur du cadre le
 *   coupe aussi si une image apparaît sans que personne ne l'ait demandé.
 *
 * Hors d'une salle (le salon), l'hôte est un logo, et les scènes qui ont
 * une variante au salon la jouent.
 *
 * # Ce qui tourne
 *
 * Rien entre deux scènes : le logo est une toile peinte une fois. Seuls
 * des écouteurs attendent un geste (un thème qui change, une fenêtre qui
 * change de taille, le pointeur au niveau Tout, un clic sur Aïn).
 */
import { mouvementReduit, niveau } from "../lib/effets";
import { LOGO_W, TH, TW, type Joueur } from "./dessin";
import { relirePalette, Theatre, type Cle } from "./lecteur";
import { lireDecor, touche, type Contexte, type Zone } from "./moteur";
import { AU_SALON, planifier, SCENES_AIN, type IdAin } from "./scenes-ain";
import type { Scene, Version } from "./scenes";

/** Ce qu'un rendu rend pour une scène : de quoi l'attendre et la finir. */
export type Mouvement = { finished: Promise<unknown>; finish(): void };

/** Ce qu'un rendu sait faire. */
export type Rendu = {
  /** Le nom du personnage, pour les essais et la planche. */
  nom: string;
  /** Dessine le personnage dans l'hôte, au repos. Rend son élément. */
  dessiner(hote: HTMLElement): HTMLElement;
  /** Montre la pose clé d'une scène, sans mouvement. */
  poseCle(el: HTMLElement, scene: Scene, contexte?: Contexte): void;
  /** Joue une scène. Rend ses mouvements, que l'appelant attend ou arrête. */
  jouer(el: HTMLElement, scene: Scene, version: Version, contexte?: Contexte): Mouvement[];
};

const THEATRES = new Map<HTMLElement, Theatre>();
const RENVOIS = new WeakMap<HTMLElement, HTMLElement>();

/** L'échelle du logo : 2 px par pixel d'Aïn si la place le permet, par
 * demi-pixel en dessous, 1 au moins. */
export const echelleLogo = (largeur: number) =>
  Math.max(1, Math.min(2, Math.floor((largeur / LOGO_W) * 2) / 2));
const echelleTete = (w: number, h: number) => Math.max(0.75, Math.min(w / TW, h / TH)) || 1;

const racineDe = (el: Element): ParentNode => el.closest("[data-cadre]") ?? el.ownerDocument;
const auSalon = (el: Element) => el.closest("[data-cadre]") === null;

/**
 * Le sol du logo : la ligne où Aïn pose les pieds dans le 3, sur toute la
 * largeur de la maison, et une marque devant le logo (« devant », où il
 * attend quand la salle décroche). Posés par le rendu, à l'échelle du logo.
 */
function poserSols(hote: HTMLElement, c: number) {
  let sol = hote.querySelector<HTMLElement>(":scope > [data-sol]");
  if (!sol) {
    sol = document.createElement("i");
    sol.dataset.sol = "coin";
    sol.className = "rt-ain-sol";
    const devant = document.createElement("i");
    devant.dataset.ancre = "devant";
    devant.className = "rt-ain-sol";
    devant.style.left = "18%";
    devant.style.width = "2px";
    hote.append(sol, devant);
  }
  // Le logo est posé en bas de sa maison : le sol est à 6 pixels d'Aïn
  // au-dessus du bas (le logo a 31 lignes, les pieds sont sur la 25e).
  for (const i of hote.querySelectorAll<HTMLElement>(":scope > .rt-ain-sol"))
    i.style.bottom = `${6 * c}px`;
}

function creer(hote: HTMLElement, el: HTMLElement, sorte: string): Theatre {
  const mode = sorte === "barre" ? "tete" : sorte === "plateau" ? "plateau" : "logo";
  const racine = racineDe(hote);
  let c = 1;
  if (el instanceof HTMLCanvasElement) {
    c =
      mode === "tete"
        ? echelleTete(hote.clientWidth, hote.clientHeight)
        : echelleLogo(hote.clientWidth);
    el.style.width = `${(mode === "tete" ? TW : LOGO_W) * c}px`;
    if (mode === "logo") poserSols(hote, c);
  }
  const decor = () =>
    mode === "plateau"
      ? lireDecor(racine, hote, {
          plateau: true,
          c: Math.max(2, Math.floor((hote.clientHeight / 36) * 2) / 2),
        })
      : lireDecor(racine, el, { tete: mode === "tete" });
  const th = new Theatre(el, mode, decor);
  THEATRES.set(el, th);
  // Un seul Aïn : quand il joue sur le plateau, le logo de la même salle
  // montre sa place en pointillés, et la retrouve quand il rentre.
  if (mode === "plateau")
    th.surPresence = (present) =>
      pourTous((t) => {
        if (t.mode === "plateau" || racineDe(t.maison) !== racine) return;
        t.ailleurs = !present;
        t.peindreMaison();
      });
  else
    pourTous((t) => {
      if (t.mode === "plateau" && racineDe(t.maison) === racine && !t.present) th.ailleurs = true;
    });
  if (th.ailleurs) th.peindreMaison();
  ecouter(racine);
  return th;
}

/** Un seul Aïn par salle : une scène qui part coupe celle d'une autre
 * maison de la même salle, et Aïn y rentre avant de ressortir d'ici. */
function seul(th: Theatre) {
  const racine = racineDe(th.maison);
  pourTous((t) => {
    if (t === th || racineDe(t.maison) !== racine || !(t.joue || t.dehors)) return;
    t.terminer("couper");
    t.rentrer();
    t.peindreMaison();
  });
}

/** Le théâtre d'un élément de mascotte : le sien, ou celui du logo pour le
 * bord du panneau. `null` quand le logo manque. */
function theatreDe(el: HTMLElement): Theatre | null {
  const renvoi = RENVOIS.get(el);
  if (renvoi) {
    const coin = racineDe(renvoi).querySelector<HTMLElement>('[data-hote="coin"] > .rt-mascotte');
    return coin ? (THEATRES.get(coin) ?? null) : null;
  }
  return THEATRES.get(el) ?? null;
}

function pourTous(fn: (th: Theatre) => void) {
  for (const [el, th] of THEATRES) {
    if (!el.isConnected) {
      th.detruire();
      THEATRES.delete(el);
      continue;
    }
    fn(th);
  }
}

/* ── Les écouteurs, une fois par page ─────────────────────────────────── */

const RACINES = new WeakSet<object>();
let pageEcoutee = false;
function ecouter(racine: ParentNode) {
  if (!pageEcoutee && typeof window !== "undefined") {
    pageEcoutee = true;
    const repeindre = () => {
      if (relirePalette()) pourTous((th) => th.peindreMaison());
    };
    globalThis.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", repeindre);
    new MutationObserver(repeindre).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    window.addEventListener("resize", () => pourTous(rajuster), { passive: true });
    document.addEventListener("pointermove", suivre, { passive: true });
  }
  const cadre = racine instanceof Element ? racine : null;
  if (!cadre || RACINES.has(cadre)) return;
  RACINES.add(cadre);
  // La première image coupe le plateau, même sans demande (K06), et l'image
  // qui revient d'une panne ramène Aïn au logo.
  new MutationObserver(() => {
    const image = cadre.getAttribute("data-sans-image") === "non";
    pourTous((th) => {
      if (!cadre.contains(th.maison)) return;
      if (image && th.mode === "plateau") th.terminer("couper");
      if (image && th.mode === "plateau") th.rentrer();
      if (cadre.getAttribute("data-etat") === "vit" && th.dehors && !th.joue) rentrerDe(th);
      if (th.dehors && surLImage(th)) {
        th.terminer("couper");
        th.rentrer();
        th.peindreMaison();
      }
    });
  }).observe(cadre, { attributes: true, attributeFilter: ["data-sans-image", "data-etat"] });
}
const surLImage = (th: Theatre) => {
  const img: Zone | undefined = th
    .relire()
    .zones()
    .find((z) => z.nom === "image");
  const b = th.ain.visible ? th.ain.cv.getBoundingClientRect() : null;
  return !!img && !!b && touche([b.left, b.top, b.right, b.bottom], img.b);
};
/** La fenêtre change : l'échelle du logo suit, et Aïn dehors rentre s'il
 * toucherait maintenant l'image. */
function rajuster(th: Theatre) {
  if (th.mode === "logo" && th.maison instanceof HTMLCanvasElement) {
    const hote = th.maison.parentElement;
    const c = echelleLogo(hote?.clientWidth ?? 0);
    th.maison.style.width = `${LOGO_W * c}px`;
    if (hote) poserSols(hote, c);
  }
  th.relire();
  if (th.dehors && !th.joue && surLImage(th)) th.rentrer();
  th.peindreMaison();
}
function rentrerDe(th: Theatre) {
  if (mouvementReduit() || niveau() === "sobre") {
    th.rentrer();
    th.peindreMaison();
    return;
  }
  const r = planifier("retour", "complete", th.relire(), {}, th.dehors);
  if (r.plan) th.lancer(r.plan, () => {});
  else th.rentrer();
}
/** Niveau Tout : l'œil suit le pointeur, sauf sur l'image du jeu. Un calcul
 * par geste, au plus un par image. */
let regard: [number, number] | null = null;
let regardPrevu = false;
function suivre(e: PointerEvent) {
  if (niveau() !== "tout" || mouvementReduit()) return;
  regard = [e.clientX, e.clientY];
  if (regardPrevu) return;
  regardPrevu = true;
  requestAnimationFrame(() => {
    regardPrevu = false;
    const p = regard;
    if (!p) return;
    pourTous((th) => {
      if (th.mode === "plateau" || !(th.maison instanceof HTMLCanvasElement)) return;
      const img = th.d.image();
      const surImage =
        !!img && p[0] >= img.x && p[0] <= img.droite && p[1] >= img.y && p[1] <= img.bas;
      const r = th.maison.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      const s = r.width / (th.mode === "tete" ? TW : LOGO_W);
      const dx = p[0] - (r.left + ((th.mode === "tete" ? 3 : 48) + 13.5) * s);
      const dy = p[1] - (r.top + 5.5 * s);
      const seuil = 8 * s;
      const sens = (v: number) => (surImage || Math.abs(v) < seuil ? 0 : Math.sign(v));
      th.regarder(sens(dx), sens(dy));
    });
  });
}

/* ── Le rendu ─────────────────────────────────────────────────────────── */

const fini = (): Mouvement => ({ finished: Promise.resolve(), finish: () => {} });
const idDe = (el: HTMLElement, scene: Scene): IdAin =>
  (auSalon(el) ? AU_SALON[scene as IdAin] : undefined) ?? (scene as IdAin);
const cleDe = (id: IdAin, ctx: Contexte): Cle | null => {
  const def: { cle?: (c: Contexte) => Cle | null } = SCENES_AIN[id];
  return def.cle?.(ctx) ?? null;
};
/** La pose clé, comme un mouvement qu'on attend : elle finit avec son
 * minuteur, ou tout de suite quand elle reste. */
function poser(th: Theatre, id: IdAin, ctx: Contexte): Mouvement {
  let finir = () => {};
  const finished = new Promise<void>((r) => {
    finir = r;
  });
  th.poseCle(cleDe(id, ctx), ctx.joueur, finir);
  return { finished, finish: () => (th.finirPose(), finir()) };
}

export const AIN: Rendu = {
  nom: "Aïn",
  dessiner(hote) {
    const sorte = hote.dataset.hote ?? "coin";
    if (sorte === "bord-panneau") {
      const marque = document.createElement("span");
      marque.className = "rt-mascotte";
      marque.hidden = true;
      hote.append(marque);
      RENVOIS.set(marque, hote);
      return marque;
    }
    const el =
      sorte === "plateau" ? document.createElement("span") : document.createElement("canvas");
    el.className = "rt-mascotte";
    el.dataset.rendu = "ain";
    el.dataset.ancre = "logo";
    el.setAttribute("aria-hidden", "true");
    hote.append(el);
    const th = creer(hote, el, sorte);
    // Niveau Tout : un clic sur Aïn chez lui, et il réagit.
    el.addEventListener("click", () => {
      if (niveau() !== "tout" || mouvementReduit() || th.joue || th.dehors || th.air.eteint) return;
      const r = planifier("clic", "complete", th.relire());
      if (r.plan) th.lancer(r.plan, () => {});
    });
    return el;
  },
  poseCle(el, scene, contexte = {}) {
    const th = theatreDe(el);
    if (th) poser(th, idDe(el, scene), contexte);
  },
  jouer(el, scene, version, contexte = {}) {
    const th = theatreDe(el);
    if (!th) return [fini()];
    if (scene === "premiere-image") {
      // Rien ne traverse l'image : tout ce qui joue dans la salle saute à sa
      // fin, Aïn est déjà rentré.
      const cadre = el.closest("[data-cadre]");
      pourTous((t) => {
        if (cadre && !cadre.contains(t.maison)) return;
        t.terminer("couper");
        t.rentrer();
        t.peindreMaison();
      });
      return [fini()];
    }
    const id = idDe(el, scene);
    th.terminer(th.mode === "plateau" ? "couper" : "interrompre");
    if (niveau() === "sobre") return [poser(th, id, contexte)];
    const choix = planifier(
      id,
      th.mode === "tete" ? "courte" : version,
      th.relire(),
      contexte,
      th.dehors,
    );
    // Les replis de la dernière scène, lisibles par les pilotes et la
    // planche : une ancre absente, un contact, et à quel instant.
    th.maison.dataset.refus = choix.refus.join(" ; ");
    if (!choix.plan) return [poser(th, id, contexte)];
    seul(th);
    let finir = () => {};
    const finished = new Promise<void>((r) => {
      finir = r;
    });
    th.lancer(choix.plan, finir);
    // Interrompue, une scène laisse Aïn où il est ; sur le plateau, elle le
    // rentre : l'écran noir va laisser place à une image.
    return [
      { finished, finish: () => th.terminer(th.mode === "plateau" ? "couper" : "interrompre") },
    ];
  },
};

/** Le rendu en service. Remplacer la mascotte, c'est changer cette ligne. */
export const RENDU: Rendu = AIN;

/** Le joueur d'un numéro de place, pour le contexte d'une scène. */
export const joueur = (n: number): Joueur | undefined =>
  n >= 1 && n <= 4 ? (String(n) as Joueur) : undefined;
