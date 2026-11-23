/**
 * Le lecteur d'Aïn : sa maison (le logo, la tête dans la barre, ou le
 * plateau de l'écran noir), ses sprites, et la boucle d'une scène.
 *
 * # Rien ne tourne entre deux scènes
 *
 * Une boucle `requestAnimationFrame` part avec une scène et s'arrête avec
 * elle. Entre deux scènes, Aïn est une image fixe : le logo peint une fois,
 * des toiles cachées. `mesure` compte les images peintes et les demandes
 * d'image en attente ; `lecteur.test.ts` vérifie qu'il n'en reste aucune
 * après la fin d'une scène.
 *
 * # La scène cède
 *
 * Deux images de suite à plus de 50 ms l'une de l'autre : la page a du
 * retard (la boucle vidéo peint sur le même fil). La scène saute à son état
 * final au lieu de prendre du temps au jeu.
 *
 * # Trois façons de finir
 *
 * - « fin » : la scène est allée au bout, ou elle cède ;
 * - « interrompre » : une autre scène arrive ; Aïn reste où il est s'il est
 *   dehors, et la suivante part de là ;
 * - « couper » : la première image du jeu ; Aïn est rentré, aucun objet.
 */
import {
  boiteSerree,
  dessinerLogo,
  dessinerTete,
  lirePalette,
  LOGO_H,
  LOGO_W,
  peindre,
  TH,
  TW,
  type Grille,
  type Maison,
  type Pose,
} from "./dessin";
import {
  accessoire,
  bulleDe,
  coinAin,
  estAin,
  grilleDe,
  interp,
  objetA,
  pisteAinA,
  placeBulle,
  placeBulleMaison,
  Plan,
  poseA,
  solSous,
  touche,
  type Boite,
  type Contexte,
  type Decor,
  type Dehors,
  type PisteObjet,
  type Point,
} from "./moteur";

/** Le retard qui fait céder une scène, en millisecondes entre deux images. */
export const CEDE_MS = 50;

/* ── Les toiles, peintes une fois par échelle ─────────────────────────── */

let palette: Record<string, string> = lirePalette(null);
let signature = "";
/** Relit les couleurs de la page (au départ d'une scène, à un changement de
 * thème). Rend vrai si elles ont changé. */
export function relirePalette(doc: Document | null = globalThis.document ?? null) {
  palette = lirePalette(doc);
  const s = Object.values(palette).join();
  const change = s !== signature;
  signature = s;
  return change;
}
const BITMAPS = new Map<string, HTMLCanvasElement>();
function bitmap(g: Grille, cle: string, k: number) {
  const id = `${cle}@${k.toFixed(3)}|${signature}`;
  let b = BITMAPS.get(id);
  if (!b) {
    b = document.createElement("canvas");
    peindre(b, g, k, palette);
    BITMAPS.set(id, b);
    if (BITMAPS.size > 400) BITMAPS.delete(BITMAPS.keys().next().value as string);
  }
  return b;
}

class Acteur {
  cv: HTMLCanvasElement;
  x = Number.NaN;
  y = Number.NaN;
  cle: string | null = null;
  g: Grille | null = null;
  visible = false;
  constructor(calque: HTMLElement, nom: string) {
    this.cv = document.createElement("canvas");
    this.cv.className = "rt-ain-sprite";
    this.cv.hidden = true;
    this.cv.dataset.acteur = nom;
    calque.append(this.cv);
  }
  montrer(v: boolean) {
    if (v === this.visible) return;
    this.visible = v;
    this.cv.hidden = !v;
  }
  placer(x: number, y: number, k: number) {
    // Au pixel de l'écran près : un sprite entre deux pixels est flou.
    const px = Math.round(x * k) / k;
    const py = Math.round(y * k) / k;
    if (px === this.x && py === this.y) return;
    this.x = px;
    this.y = py;
    this.cv.style.transform = `translate(${px}px, ${py}px)`;
  }
  dessin(g: Grille, cle: string, c: number, k: number, mesure: Mesure) {
    const id = `${cle}@${k}|${signature}`;
    if (id === this.cle) return;
    this.cle = id;
    this.g = g;
    const b = bitmap(g, cle, k);
    if (this.cv.width !== b.width || this.cv.height !== b.height) {
      this.cv.width = b.width;
      this.cv.height = b.height;
    }
    this.cv.style.width = `${g[0].length * c}px`;
    this.cv.style.height = `${g.length * c}px`;
    // La boîte serrée, en pixels de la page depuis le coin de la toile : ce
    // que le planificateur a vérifié, et ce que les pilotes relèvent.
    const s = boiteSerree(g);
    this.cv.dataset.serre = s ? s.map((v) => v * c).join(" ") : "";
    const ctx = this.cv.getContext("2d");
    ctx?.clearRect(0, 0, b.width, b.height);
    ctx?.drawImage(b, 0, 0);
    mesure.peints++;
  }
}

export type Mesure = { images: number; ms: number; max: number; peints: number; cede: number };
/** La pose clé d'une scène : sa pose, et si elle reste tant que l'état dure. */
export type Cle = { pose: Pose; reste?: boolean; tient?: number };

/** L'air neutre d'Aïn chez lui. */
const NEUTRE: Maison = {};

type Courante = {
  plan: Plan;
  t0: number;
  fait: number;
  retards: number;
  dernier: number;
  fin: () => void;
};

/**
 * Le théâtre d'une maison : un élément qui porte Aïn chez lui. `mode` dit
 * ce qu'il peint : le logo entier, la tête seule, ou rien (le plateau, où
 * Aïn n'est qu'en sprite).
 */
export class Theatre {
  maison: HTMLCanvasElement | HTMLElement;
  mode: "logo" | "tete" | "plateau";
  calque: HTMLElement;
  decor: () => Decor;
  air: Maison = NEUTRE;
  present = true;
  courante: Courante | null = null;
  dehors: Dehors | null = null;
  poseFixe: { minuteur: ReturnType<typeof setTimeout> | 0; reste: boolean } | null = null;
  raf = 0;
  mesure: Mesure = { images: 0, ms: 0, max: 0, peints: 0, cede: 0 };
  ain: Acteur;
  bulle: Acteur;
  objets = new Map<string, Acteur>();
  /** Le dernier décor lu : l'échelle et la maison du dernier départ. */
  d: Decor;

  constructor(maison: HTMLElement, mode: Theatre["mode"], decor: () => Decor) {
    this.maison = maison;
    this.mode = mode;
    this.decor = decor;
    this.calque = document.createElement("div");
    this.calque.className = "rt-ain-calque";
    this.calque.setAttribute("aria-hidden", "true");
    document.body.append(this.calque);
    this.ain = new Acteur(this.calque, "ain");
    this.bulle = new Acteur(this.calque, "bulle");
    relirePalette();
    this.d = decor();
    this.peindreMaison();
  }

  get k() {
    return this.d.c * (globalThis.devicePixelRatio || 1);
  }
  get joue() {
    return this.courante !== null;
  }

  /** Peint le logo (ou la tête) : Aïn dedans, ou sa place en pointillés. */
  peindreMaison() {
    const m = this.maison;
    if (m instanceof HTMLCanvasElement && this.mode !== "plateau") {
      const c = this.d.c;
      const tete = this.mode === "tete";
      m.style.width = `${(tete ? TW : LOGO_W) * c}px`;
      m.style.height = `${(tete ? TH : LOGO_H) * c}px`;
      const air = this.air.eteint ? { ...this.air, oeil: "ferme" as const, gris: true } : this.air;
      const g = tete
        ? this.present
          ? dessinerTete(air, this.air.joueur ?? "1")
          : [".".repeat(TW)]
        : dessinerLogo(this.present, this.air);
      peindre(m, g, this.k, palette);
    }
    if (this.present && !this.courante && this.air.fx?.length) {
      const B = bulleDe(this.air.fx, this.air.joueur ?? "1");
      const [x, y] = placeBulleMaison(this.d, B.g);
      const c = this.d.c;
      const b: Boite = [
        x + B.serre[0] * c,
        y + B.serre[1] * c,
        x + B.serre[2] * c,
        y + B.serre[3] * c,
      ];
      // Une bulle chez lui ne couvre pas plus qu'une scène : si sa place
      // touche une zone (les mots de « La salle » qui porte sa tête), il
      // garde son air sans bulle.
      if (this.d.zones().some((z) => touche(b, z.b))) this.bulle.montrer(false);
      else {
        this.bulle.dessin(B.g, B.cle, c, this.k, this.mesure);
        this.bulle.placer(x, y, this.k);
        this.bulle.montrer(true);
      }
    } else if (this.present && !this.courante) this.bulle.montrer(false);
  }

  private mettrePresent(v: boolean) {
    if (this.present === v) return;
    this.present = v;
    this.peindreMaison();
  }
  private objet(nom: string) {
    let o = this.objets.get(nom);
    if (!o) {
      o = new Acteur(this.calque, nom);
      this.objets.set(nom, o);
    }
    return o;
  }
  private cacherObjets(sauf?: Set<string>) {
    for (const [n, o] of this.objets) if (!sauf?.has(n)) o.montrer(false);
  }

  /** Le décor de maintenant, pour une nouvelle scène. */
  relire() {
    if (relirePalette()) this.bulle.cle = null;
    this.d = this.decor();
    return this.d;
  }

  /** Applique un plan au temps t : où est Aïn, son image, ses objets. */
  appliquer(plan: Plan, t: number) {
    const d = this.d;
    const k = this.k;
    const pa = pisteAinA(plan, t);
    const dehors = plan.dehorsA(t);
    this.mettrePresent(!dehors);
    if (dehors && pa) {
      const pos = interp(pa, t);
      const pose = poseA(pa, t);
      const A = grilleDe(pose, plan.joueur, d.tete);
      this.ain.dessin(A.g, A.cle, d.c, k, this.mesure);
      const [x, y] = coinAin(d, pos);
      this.ain.placer(x, y, k);
      this.ain.montrer(true);
      this.dehors = { pose, pied: pos, scene: plan.id, enLair: false };
      if (pose.fx?.length) {
        const B = bulleDe(pose.fx, plan.joueur);
        const [bx, by] = placeBulle(d, A.serre, pos, B.g);
        this.bulle.dessin(B.g, B.cle, d.c, k, this.mesure);
        this.bulle.placer(bx, by, k);
        this.bulle.montrer(true);
      } else this.bulle.montrer(false);
    } else {
      this.dehors = null;
      this.ain.montrer(false);
      if (!this.air.fx?.length || !this.present) this.bulle.montrer(false);
    }
    const parNom = new Map<string, PisteObjet[]>();
    for (const p of plan.pistes)
      if (!estAin(p)) parNom.set(p.qui, [...(parNom.get(p.qui) ?? []), p]);
    for (const [nom, ps] of parNom) {
      let cur: PisteObjet | null = null;
      for (const p of ps) if (p.t0 <= t) cur = p;
      const o = this.objet(nom);
      if (!cur) {
        if (!plan.garde.has(nom)) o.montrer(false);
        continue;
      }
      if (t >= cur.t1 && cur === ps[ps.length - 1] && !cur.reste) {
        o.montrer(false);
        continue;
      }
      const A = accessoire(cur.dessin);
      o.dessin(A.g, A.cle, d.c, k, this.mesure);
      const xy = objetA(plan, cur, t);
      if (!xy) continue;
      o.placer(xy[0], xy[1], k);
      o.montrer(true);
      o.cv.classList.toggle("rt-ain-efface", !!cur.efface && t >= cur.t1 - 150);
    }
    const c = this.courante;
    if (!c) return;
    for (; c.fait < plan.evts.length && plan.evts[c.fait].t <= t; c.fait++) plan.evts[c.fait].fn();
  }

  /** Lance un plan vérifié. `fin` est appelée une fois, à la fin. */
  lancer(plan: Plan, fin: () => void) {
    this.finirPose();
    // Préparer toutes les images avant la première : aucun dessin de grille
    // ne tombe pendant la scène.
    for (const p of plan.pistes) {
      if (!estAin(p)) continue;
      for (const pz of p.poses) {
        const pose = { forme: p.forme, ...p.base, ...pz };
        const A = grilleDe(pose, plan.joueur, this.d.tete);
        bitmap(A.g, A.cle, this.k);
        if (pose.fx?.length) {
          const B = bulleDe(pose.fx, plan.joueur);
          bitmap(B.g, B.cle, this.k);
        }
      }
    }
    this.cacherObjets(plan.garde);
    this.air = NEUTRE;
    plan.evts.sort((a, b) => a.t - b.t);
    this.mesure = { images: 0, ms: 0, max: 0, peints: 0, cede: 0 };
    this.courante = { plan, t0: performance.now(), fait: 0, retards: 0, dernier: 0, fin };
    // La scène qui joue, lisible par les pilotes, retirée à la fin.
    this.maison.dataset.scene = plan.id;
    this.dehors = null;
    this.appliquer(plan, 0);
    this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  private tick(now: number) {
    const c = this.courante;
    if (!c) return;
    if (c.dernier && now - c.dernier > CEDE_MS) c.retards++;
    else c.retards = 0;
    c.dernier = now;
    if (c.retards >= 2) {
      this.mesure.cede++;
      this.terminer("fin");
      return;
    }
    const d0 = performance.now();
    const t = now - c.t0;
    this.appliquer(c.plan, t);
    const ms = performance.now() - d0;
    this.mesure.images++;
    this.mesure.ms += ms;
    this.mesure.max = Math.max(this.mesure.max, ms);
    if (t >= c.plan.duree) this.terminer("fin");
    else this.raf = requestAnimationFrame((n) => this.tick(n));
  }

  /** Finit la scène en cours (voir l'en-tête du module). */
  terminer(mode: "fin" | "interrompre" | "couper" = "fin") {
    const c = this.courante;
    if (!c) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const plan = c.plan;
    const t = performance.now() - c.t0;
    delete this.maison.dataset.scene;
    if (mode === "interrompre" && t < plan.duree) {
      while (c.fait < plan.evts.length) plan.evts[c.fait++].fn();
      plan.finFn?.();
      this.courante = null;
      if (this.ain.visible && plan.dehorsA(t) && this.dehors) {
        const s = solSous(this.d, this.dehors.pied);
        this.dehors = { ...this.dehors, enLair: !s || Math.abs(s.y - this.dehors.pied[1]) > 1 };
        for (const p of plan.pistes)
          if (!estAin(p) && !p.reste) this.objets.get(p.qui)?.montrer(false);
      } else this.rentrer();
    } else {
      this.appliquer(plan, plan.duree + 1);
      plan.finFn?.();
      this.courante = null;
      if (mode !== "couper" && this.dehors) {
        /* la scène finit dehors : il reste là tant que l'état dure */
      } else {
        this.rentrer();
        if (mode !== "couper")
          for (const p of plan.pistes)
            if (!estAin(p) && p.reste) this.objets.get(p.qui)?.montrer(true);
      }
    }
    if (mode === "couper") this.air = NEUTRE;
    else if (plan.airFin && this.present) this.air = { ...plan.airFin, joueur: plan.joueur };
    this.peindreMaison();
    c.fin();
  }

  /** Aïn rentre chez lui d'un coup : plus de sprite, plus d'objet. */
  rentrer() {
    this.dehors = null;
    this.ain.montrer(false);
    this.bulle.montrer(false);
    this.cacherObjets();
    this.present = true;
  }

  /** La pose clé, sans mouvement : dans le logo, avec sa bulle. Elle reste
   * `tient` ms, ou tant que l'état dure (`reste`). Un minuteur, pas une
   * boucle. */
  poseCle(cle: Cle | null, joueur: Contexte["joueur"] | undefined, fin: () => void) {
    this.terminer("fin");
    this.finirPose();
    this.rentrer();
    this.air = cle ? { ...cle.pose, joueur: joueur ?? null } : NEUTRE;
    this.peindreMaison();
    const reste = !!cle?.reste;
    this.poseFixe = { minuteur: 0, reste };
    if (!reste)
      this.poseFixe.minuteur = setTimeout(() => {
        this.finirPose();
        fin();
      }, cle?.tient ?? 2200);
    else fin();
  }
  finirPose() {
    const p = this.poseFixe;
    if (!p) return;
    if (p.minuteur) clearTimeout(p.minuteur);
    this.poseFixe = null;
    this.air = NEUTRE;
    this.peindreMaison();
  }

  /** Change l'air d'Aïn chez lui (le regard qui suit le pointeur). */
  regarder(rx: number, ry: number) {
    if (this.courante || this.poseFixe || !this.present || this.air.eteint) return;
    if ((this.air.rx ?? 0) === rx && (this.air.ry ?? 0) === ry) return;
    this.air = { ...this.air, rx, ry };
    this.peindreMaison();
  }

  /** Retire les toiles de la page : la maison est partie. */
  detruire() {
    this.terminer("couper");
    this.finirPose();
    this.calque.remove();
  }

  /** Le point des pieds d'Aïn, s'il est dehors. */
  get pied(): Point | null {
    return this.dehors?.pied ?? null;
  }
}
