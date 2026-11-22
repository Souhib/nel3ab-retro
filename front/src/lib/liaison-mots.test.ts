import { describe, expect, it } from "vitest";
import type { Liaison } from "../media/liaison";
import { dire, NOM_ETAT, phraseDemande, phraseLiaison } from "./liaison-mots";

const figee = (
  depuisMs: number,
  son = true,
  niveau: "pastille" | "bandeau" = "bandeau",
): Liaison => ({
  etat: "figee",
  depuisMs,
  son,
  manette: true,
  niveau,
});

/** Tous les états, avec leurs variantes, pour les gardes de vocabulaire. */
const TOUS: Liaison[] = [
  { etat: "ok" },
  { etat: "cachee" },
  { etat: "irreguliere" },
  figee(3000, true, "pastille"),
  figee(14_000, true),
  figee(14_000, false),
  { etat: "decodeur", depuisMs: 3000 },
  { etat: "coupee", cause: "reseau", depuisMs: 3000 },
  { etat: "coupee", cause: "silence", depuisMs: 3000 },
  { etat: "injoignable", siteRepond: true, depuisMs: 3000 },
  { etat: "injoignable", siteRepond: false, depuisMs: 3000 },
  { etat: "fermee" },
  { etat: "demarrage", depuisMs: 3000 },
  { etat: "arrivee", etape: "salle", depuisMs: 2000, perdue: false, salleRepond: false },
  { etat: "arrivee", etape: "image", depuisMs: 2000, perdue: false, salleRepond: true },
  { etat: "arrivee", etape: "image", depuisMs: 16_000, perdue: true, salleRepond: true },
  { etat: "arrivee", etape: "salle", depuisMs: 16_000, perdue: true, salleRepond: false },
];

describe("ce que Bobine dit de l'image figée", () => {
  it("la phrase du 21 novembre: une durée, un fait, deux actions", () => {
    const dit = dire(figee(14_000), 1);
    expect(dit.niveau).toBe("bandeau");
    expect(dit.titre).toBe("L'image ne bouge plus depuis 14 s.");
    expect(dit.detail).toBe("Le son arrive encore: le jeu tourne sur la machine.");
    expect(dit.actions).toEqual(["relancer", "signaler"]);
    expect(dit.pose).toBe("loupe");
  });
  it("jumeau: sans son, il ne dit pas que le jeu tourne", () => {
    const dit = dire(figee(14_000, false), 1);
    expect(dit.detail).not.toContain("son");
    expect(dit.detail).toBe("La salle répond, mais n'envoie plus d'image.");
  });
  it("une pastille d'abord, sans action", () => {
    const dit = dire(figee(3000, true, "pastille"), 1);
    expect(dit.niveau).toBe("pastille");
    expect(dit.actions).toEqual([]);
    expect(dit.compteur).toBe(3);
  });
});

describe("chaque panne dit de quel côté elle est, sans le supposer", () => {
  it("la salle qui ne répond plus, quand le site répond", () => {
    const dit = dire({ etat: "injoignable", siteRepond: true, depuisMs: 3000 }, 2);
    expect(dit.titre).toBe("La salle 2 ne répond plus.");
    expect(dit.detail).toContain("ta connexion passe");
  });
  it("jumeau: sans réponse du site, rien sur ta connexion", () => {
    const dit = dire({ etat: "injoignable", siteRepond: false, depuisMs: 3000 }, 2);
    expect(dit.detail).not.toContain("connexion");
  });
  it("la salle fermée n'est pas une salle qui ne répond pas", () => {
    const fermee = dire({ etat: "fermee" }, 1);
    expect(fermee.titre).toBe("La salle 1 est fermée.");
    expect(fermee.actions).toEqual(["salles"]);
    expect(dire({ etat: "injoignable", siteRepond: true, depuisMs: 3000 }, 1).titre).not.toContain(
      "fermée",
    );
  });
  it("ta connexion coupée, et le geste qui va avec", () => {
    expect(dire({ etat: "coupee", cause: "reseau", depuisMs: 1 }, 1).titre).toBe(
      "Ton appareil n'a plus de réseau.",
    );
    const rien = dire({ etat: "coupee", cause: "silence", depuisMs: 1 }, 1);
    expect(rien.detail).toContain("Vérifie ta connexion");
    expect(rien.actions).toEqual(["reessayer", "quitter"]);
  });
  it("une panne de salle offre toujours une sortie: au téléphone, la colonne est repliée", () => {
    // Le 22 novembre 2026 (E6), une salle muette ne laissait que le bouton
    // Précédent du navigateur. La colonne porte « quitter », mais un téléphone
    // la replie d'office.
    for (const siteRepond of [true, false])
      expect(dire({ etat: "injoignable", siteRepond, depuisMs: 3000 }, 1).actions).toContain(
        "quitter",
      );
    // Le jumeau: une image figée garde ses deux gestes, la partie continue.
    expect(dire(figee(9000), 1).actions).not.toContain("quitter");
  });
});

describe("l'arrivée a ses vraies étapes, et une fin", () => {
  it("ne parle ni de demande ni de démarrage", () => {
    const dit = dire(
      { etat: "arrivee", etape: "image", depuisMs: 2000, perdue: false, salleRepond: true },
      1,
    );
    const texte = JSON.stringify(dit);
    expect(texte).not.toContain("demande");
    expect(texte).not.toContain("démarre");
    expect(dit.etapes?.map((e) => e.fait)).toEqual([true, false]);
    expect(dit.actions).toEqual([]);
  });
  it("à la fin de l'attente, propose de réessayer ou de partir", () => {
    const dit = dire(
      { etat: "arrivee", etape: "image", depuisMs: 16_000, perdue: true, salleRepond: true },
      1,
    );
    expect(dit.titre).toBe("L'image n'arrive pas.");
    expect(dit.detail).toBe("La salle répond, mais n'envoie aucune image.");
    expect(dit.actions).toEqual(["reessayer", "quitter"]);
  });
});

describe("la ligne parlée", () => {
  it("dit chaque changement d'état en phrase", () => {
    expect(phraseLiaison({ etat: "ok" }, figee(3000, true, "pastille"), 1)).toBe(
      "L'image ne bouge plus. Le son arrive encore.",
    );
    expect(phraseLiaison(figee(9000), { etat: "ok" }, 1)).toBe("L'image est revenue.");
  });
  it("jumeau: une durée qui avance ne change pas la phrase", () => {
    const a = phraseLiaison({ etat: "ok" }, figee(3000, true, "pastille"), 1);
    const b = phraseLiaison({ etat: "ok" }, figee(14_000, true, "bandeau"), 1);
    expect(a).toBe(b);
  });
  it("jumeau: rien à dire quand tout va bien depuis le début, ni d'un onglet caché", () => {
    expect(phraseLiaison({ etat: "ok" }, { etat: "ok" }, 1)).toBe("");
    expect(phraseLiaison({ etat: "ok" }, { etat: "cachee" }, 1)).toBe("");
  });
  it("annonce une demande de manette une fois, avec le délai en mots", () => {
    expect(phraseDemande({ from: "Lina", port: 2 }, 10)).toBe(
      "Lina demande ta manette 2. Tu as 10 secondes pour répondre. Sans réponse, tu la gardes.",
    );
    expect(phraseDemande(null, 10)).toBe("");
  });
});

describe("le vocabulaire tenu", () => {
  const textes = TOUS.flatMap((l) => {
    const dit = dire(l, 1);
    return [
      dit.titre,
      dit.detail ?? "",
      ...(dit.etapes ?? []).map((e) => e.texte),
      phraseLiaison({ etat: "ok" }, l, 1),
      phraseLiaison(l, { etat: "ok" }, 1),
      NOM_ETAT[l.etat],
    ];
  });

  it("chaque état qui doit parler a une phrase", () => {
    for (const l of TOUS) {
      const dit = dire(l, 1);
      if (l.etat === "ok" || l.etat === "cachee" || l.etat === "demarrage")
        expect(dit.niveau, l.etat).toBe("rien");
      else expect(dit.titre.length, l.etat).toBeGreaterThan(0);
    }
  });
  it("aucun mot d'atelier, aucun tiret cadratin", () => {
    for (const texte of textes) {
      expect(texte).not.toMatch(/—|salon|worker|socket|running|\bport\b|prise|xenia|serveur/i);
    }
  });
  it("des phrases de moins de soixante-dix caractères", () => {
    for (const texte of textes)
      for (const phrase of texte.split(/(?<=[.:])\s+/))
        expect(phrase.length, phrase).toBeLessThan(70);
  });
});
