/**
 * Les plans de manette, et les deux façons de les rater.
 *
 * Un schéma sert à DÉSIGNER une touche du doigt ou de l'oeil. Deux pièces qui se
 * chevauchent ou une commande absente le rendent inutile, et ni l'une ni l'autre
 * ne se voit dans les données à l'oeil nu.
 */
import { describe, expect, it } from "vitest";

import { CONTROLS } from "../media/pad";
import { EMULATED, GAMECUBE, GUITAR, MAPS, PHYSICAL, type PadMap } from "./padmap";

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
    expect(EMULATED.map((one) => one.id)).toEqual(["gamecube", "wiimote", "guitar"]);
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
