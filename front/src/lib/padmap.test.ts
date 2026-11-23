/**
 * Les plans de manette, et les deux façons de les rater.
 *
 * Un schéma sert à DÉSIGNER une touche du doigt ou de l'oeil. Deux pièces qui se
 * chevauchent ou une commande absente le rendent inutile, et ni l'une ni l'autre
 * ne se voit dans les données à l'oeil nu.
 */
import { describe, expect, it } from "vitest";

import { CONTROLS } from "../media/pad";
import {
  EMULATED,
  GAMECUBE,
  GUITAR,
  MAPS,
  mirrorX,
  PHYSICAL,
  type PadMap,
  WIIMOTE,
} from "./padmap";

/** La boîte d'une pièce, dans le repère du plan. */
const box = (part: PadMap["parts"][number]) => {
  const half = part.r * (part.shape === "pastille" ? (part.wide ?? 1) : 1);
  return {
    left: part.x - half,
    right: part.x + half,
    top: part.y - part.r,
    bottom: part.y + part.r,
  };
};

/** Les pièces dont le CENTRE tombe dans une autre.
 *
 * La règle n'est pas « rien ne se touche »: les branches d'une croix se
 * touchent, et le groupe A/B/X/Y d'une GameCube est serré exprès. Ce qui compte
 * est de pouvoir VISER la pièce qu'on veut — donc que son centre n'appartienne à
 * aucune autre. Un premier jet vérifiait le non-recouvrement et refusait des
 * plans justes.
 */
const swallowed = (map: PadMap) => {
  const bad: string[] = [];
  for (const one of map.parts) {
    for (const other of map.parts) {
      if (one === other) continue;
      const at = box(other);
      if (one.x > at.left && one.x < at.right && one.y > at.top && one.y < at.bottom) {
        bad.push(`le centre de ${one.key} est dans ${other.key}`);
      }
    }
  }
  return bad;
};

describe.each(Object.values(MAPS))("le plan « $name »", (map) => {
  it("laisse viser chaque pièce", () => {
    expect(swallowed(map)).toEqual([]);
  });

  it("pose chaque pièce SUR le boîtier, pas à côté", () => {
    // Le repère est plus grand que la manette: une pièce peut tenir dedans et
    // déborder quand même de la silhouette, ce qui se voit tout de suite et
    // qu'aucune règle de chevauchement n'attrape. Vu sur X, qui pendait dans le
    // vide à droite du boîtier.
    for (const part of map.parts) {
      const at = box(part);
      expect(at.left, part.key).toBeGreaterThanOrEqual(map.hull.left);
      expect(at.right, part.key).toBeLessThanOrEqual(map.hull.right);
      expect(at.top, part.key).toBeGreaterThanOrEqual(map.hull.top);
      expect(at.bottom, part.key).toBeLessThanOrEqual(map.hull.bottom);
    }
  });

  it("tient entièrement dans son repère", () => {
    // Le repère n'est pas le même pour toutes les coques: la manette standard
    // déclare un cadre plus carré que les autres (`viewBox`). Chaque plan vit
    // dans le sien, pas dans une constante qui ne vaut que pour le premier.
    const [, , totalWidth, totalHeight] = (map.viewBox ?? "-2 -2 104 66").split(" ").map(Number);
    for (const part of map.parts) {
      const at = box(part);
      expect(at.left, part.key).toBeGreaterThanOrEqual(0);
      expect(at.right, part.key).toBeLessThanOrEqual(totalWidth);
      expect(at.top, part.key).toBeGreaterThanOrEqual(0);
      expect(at.bottom, part.key).toBeLessThanOrEqual(totalHeight);
    }
  });

  it("ne nomme pas deux fois la même pièce", () => {
    expect(new Set(map.parts.map((one) => one.key)).size).toBe(map.parts.length);
  });
});

describe("le plan de la manette émulée", () => {
  it("porte les douze boutons et les deux sticks que la trame transporte", () => {
    // LE jumeau qui compte: un plan à qui il manque une commande laisse quelqu'un
    // chercher où assigner « Z », et rien ne le signale.
    const drawn = new Set(GAMECUBE.parts.map((one) => one.key));
    const missing = CONTROLS.map((one) => one.key).filter(
      // Les moitiés négatives d'un stick partagent la pièce de leur moitié
      // positive: un stick se pousse dans les deux sens au même endroit.
      (key) => !drawn.has(key) && !drawn.has(key.replace(/^c?y$/, (m) => (m === "y" ? "x" : "cx"))),
    );

    expect(missing).toEqual([]);
  });
});

describe("les plans des manettes émulées", () => {
  it("ne parlent qu'en commandes de la TRAME, jamais en indices bruts", () => {
    // C'est ce qui fait que les trois se superposent: une GameCube, une Wiimote
    // et une guitare sont trois lectures des mêmes seize commandes. Un plan qui
    // introduirait une clé à lui ne s'allumerait jamais.
    const known = new Set<string>(CONTROLS.map((one) => one.key));
    for (const map of EMULATED) {
      for (const part of map.parts) {
        expect(known.has(part.key), `${map.id}: ${part.key}`).toBe(true);
      }
    }
  });

  it("couvrent chacune ce que leur console sait faire, et rien de plus", () => {
    // Une guitare n'a ni croix gauche ni croix droite: les tenir n'allume rien,
    // et c'est vrai. Ce qui compte est qu'aucun plan n'invente une touche que la
    // console n'a pas — sinon on assignerait dans le vide.
    const guitar = new Set(GUITAR.parts.map((one) => one.key));

    expect(guitar.has("D_LEFT")).toBe(false);
    expect(guitar.has("R")).toBe(false);
    // Le jumeau: elle a bien ses cinq frettes et son grattage.
    for (const fret of ["A", "B", "X", "Y", "Z", "D_UP", "D_DOWN"]) {
      expect(guitar.has(fret), fret).toBe(true);
    }
  });

  it("suivent l'ordre du réglage qui les choisit", () => {
    // `EMULATED[n]` doit être la manette que `PADS[n]` nomme, sinon le sélecteur
    // montrerait une guitare en disant « Wiimote ».
    expect(EMULATED.map((one) => one.id)).toEqual([
      "gamecube",
      "wiimote",
      "guitar",
      "wiimote-only",
    ]);
  });
});

describe.each(PHYSICAL)("le plan de la manette tenue « $name »", (map) => {
  it("ne désigne que des indices bruts, jamais des noms de commande", () => {
    // La distinction porte tout l'écran: à gauche ce que le JEU voit, à droite ce
    // qu'on TIENT. Un plan physique qui parlerait en noms de commande aurait déjà
    // appliqué la correspondance qu'on est justement venu vérifier.
    for (const part of map.parts) {
      expect(part.key, part.key).toMatch(/^[ba]\d+[+-]?$/);
    }
  });
});

describe("les plans de la manette tenue", () => {
  it("dessinent la même trame physique, tous les trois", () => {
    // Une PlayStation, une Xbox et l'inconnue sont trois coques pour les MÊMES
    // indices: que la famille dise PlayStation ou Xbox ne déplace aucune
    // assignation. Un plan qui aurait oublié un indice laisserait la touche
    // s'allumer dans le vide sur UNE des coques, sans que rien ne le signale.
    const sets = PHYSICAL.map((map) => new Set(map.parts.map((part) => part.key)));
    const all = new Set(sets.flatMap((set) => [...set]));
    for (const set of sets) {
      for (const key of all) {
        expect(set.has(key), `il manque ${key}`).toBe(true);
      }
    }
  });
});

/** La boîte des nombres d'un tracé, points de contrôle compris : elle couvre la
 * courbe, un peu plus large qu'elle, ce qui va dans le sens prudent ici. */
const boiteDuTrace = (d: string) => {
  const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(([v]) => Number(v));
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
};

/** Le trait d'un renvoi qui reste VISIBLE entre ce qu'il désigne et son mot.
 *
 * Le trait part du centre de la pièce. Il traverse la pièce dessinée et, quand
 * la pièce est posée sur la coque, le corps qui la porte ; seul le bout qui en
 * sort se voit. Le 23 novembre 2026, la planche montrait « secouer » collé aux
 * arcs et « viser » collé au bord de la Wiimote : 1,6 et 3,5 unités de trait. */
const traitVisible = (map: PadMap, part: PadMap["parts"][number]) => {
  const at = part.callout!;
  const boites = [box(part), ...(part.d ? [boiteDuTrace(part.d)] : [])];
  for (const corps of map.body.split(/(?=M )/)) {
    const b = boiteDuTrace(corps);
    const dedans = part.x >= b.left && part.x <= b.right && part.y >= b.top && part.y <= b.bottom;
    if (dedans) boites.push(b);
  }
  const vers = at.anchor === "end" ? "gauche" : "droite";
  return vers === "gauche"
    ? Math.min(...boites.map((b) => b.left)) - at.x
    : at.x - Math.max(...boites.map((b) => b.right));
};

/** Le plus petit bout de trait qui se lit comme un trait : 4 unités font
 * 4,8 px sur le plus petit dessin (120 px de large pour un repère de 100). */
const TRAIT_MIN = 4;
/** L'avance moyenne d'un caractère de Pixelify Sans, en em, prise large. */
const AVANCE = 0.62;

// `MAPS` ne porte pas la Wiimote seule, qui a pourtant les mêmes renvois.
const AVEC_RENVOIS = [...new Set([...Object.values(MAPS), ...EMULATED])].filter((map) =>
  map.parts.some((part) => part.callout),
);

describe.each(AVEC_RENVOIS)("les renvois du plan « $name »", (map) => {
  it("laissent voir un trait hors de la pièce et de la coque", () => {
    const renvois = map.parts.filter((one) => one.callout);
    // La précondition : la mesure suit un trait horizontal.
    for (const part of renvois) expect(part.callout!.y, part.key).toBe(part.y);
    const courts = renvois
      .map((part) => `${part.key} ${traitVisible(map, part).toFixed(1)}`)
      .filter((_, i) => traitVisible(map, renvois[i]!) < TRAIT_MIN);
    expect(courts).toEqual([]);
  });

  it("écrivent leur mot entièrement dans le repère", () => {
    const [x0, , largeur] = (map.viewBox ?? "-2 -2 104 66").split(" ").map(Number);
    for (const part of map.parts.filter((one) => one.callout)) {
      const at = part.callout!;
      const long = part.label.length * AVANCE * (part.size ?? 2.2);
      const debut = at.anchor === "end" ? at.x - long : at.x;
      expect(debut, part.key).toBeGreaterThanOrEqual(x0!);
      expect(debut + long, part.key).toBeLessThanOrEqual(x0! + largeur!);
    }
  });
});

describe("la mesure du trait d'un renvoi", () => {
  it("compte deux plans à renvois, la Wiimote seule comprise", () => {
    expect(AVEC_RENVOIS.map((map) => map.id).sort()).toEqual(["wiimote", "wiimote-only"]);
  });

  it("refuse les renvois d'avant, collés au bord et aux arcs", () => {
    // Le jumeau : la même mesure aux positions du 21 novembre.
    const viser = WIIMOTE.parts.find((one) => one.key === "cx")!;
    const secouer = WIIMOTE.parts.find((one) => one.key === "Z")!;
    const avant = (part: typeof viser, x: number) => ({
      ...part,
      callout: { ...part.callout!, x },
    });
    expect(traitVisible(WIIMOTE, avant(viser, 58.5))).toBeLessThan(TRAIT_MIN);
    expect(traitVisible(WIIMOTE, avant(secouer, 84.2))).toBeLessThan(TRAIT_MIN);
  });
});

describe("le miroir d'un tracé", () => {
  it("retourne les abscisses autour de 50 et garde les ordonnées", () => {
    // Les deux moitiés des manettes symétriques (gâchettes, plaque de la
    // DualSense, poignées de la Pro) viennent d'un seul tracé et de son miroir.
    expect(mirrorX("M 10 5 L 20 6 C 30 7, 40 8, 45 9 Q 1 2, 3 4 Z")).toBe(
      "M 90 5 L 80 6 C 70 7, 60 8, 55 9 Q 99 2, 97 4 Z",
    );
  });

  it("refuse un arc, dont les nombres ne vont pas par paires", () => {
    // Un arc porte deux rayons, un angle et deux drapeaux avant son point :
    // les retourner deux par deux ferait un tracé faux sans erreur.
    expect(() => mirrorX("M 0 0 A 1 1 0 0 1 2 2")).toThrow(/mirrorX/);
  });
});
