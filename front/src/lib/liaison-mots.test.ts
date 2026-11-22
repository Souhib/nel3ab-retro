import { describe, expect, it } from "vitest";
import type { Liaison } from "../media/liaison";
import { dire, NOM_ETAT, phraseDemande, phraseLiaison, resumeConnexion } from "./liaison-mots";

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
  { etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 },
  { etat: "injoignable", site: "relais", arrivee: false, depuisMs: 3000 },
  { etat: "injoignable", site: null, arrivee: false, depuisMs: 3000 },
  { etat: "injoignable", site: "repond", arrivee: true, depuisMs: 6000 },
  { etat: "injoignable", site: null, arrivee: true, depuisMs: 6000 },
  { etat: "redemarre", arrivee: false },
  { etat: "redemarre", arrivee: true },
  { etat: "fermee" },
  { etat: "demarrage", depuisMs: 3000 },
  { etat: "demarrage", depuisMs: 25_000, attente: "long" },
  { etat: "demarrage", depuisMs: 61_000, attente: "echec" },
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
  it("la salle qui ne répond plus, quand le site répond: le fait, sans la cause", () => {
    // « ta connexion passe » supposait une cause: le 22 septembre 2026, une
    // petite requête passait sur un Wi-Fi qui ne portait plus le flux.
    const dit = dire({ etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 }, 2);
    expect(dit.titre).toBe("La salle 2 ne répond plus.");
    expect(dit.detail).toBe("Le reste du site répond. La page réessaie toute seule.");
    expect(dit.actions).toContain("signaler");
  });
  it("jumeau: sans réponse du site, rien sur ta connexion", () => {
    const dit = dire({ etat: "injoignable", site: null, arrivee: false, depuisMs: 3000 }, 2);
    expect(dit.detail).not.toContain("connexion");
    expect(dit.detail).not.toContain("répond");
  });
  it("un relais seul: le reste du site ne répond pas non plus, et rien à signaler", () => {
    const dit = dire({ etat: "injoignable", site: "relais", arrivee: false, depuisMs: 3000 }, 1);
    expect(dit.detail).toBe(
      "Le reste du site ne répond pas non plus. La page réessaie toute seule.",
    );
    expect(dit.actions).not.toContain("signaler");
  });
  it("à l'arrivée, la salle « ne répond pas », sous le rideau et ses étapes", () => {
    const dit = dire({ etat: "injoignable", site: "repond", arrivee: true, depuisMs: 6000 }, 1);
    expect(dit.titre).toBe("La salle 1 ne répond pas.");
    expect(dit.niveau).toBe("rideau");
    expect(dit.etapes?.map((e) => e.fait)).toEqual([false, false]);
    expect(dit.actions).toEqual(expect.arrayContaining(["reessayer", "quitter"]));
  });
  it("la salle qui redémarre le dit, sans « fermée »", () => {
    const dit = dire({ etat: "redemarre", arrivee: false }, 1);
    expect(dit.titre).toBe("La salle 1 redémarre.");
    expect(JSON.stringify(dit)).not.toContain("fermée");
    expect(dit.actions).not.toContain("salles");
  });
  it("la salle fermée n'est pas une salle qui ne répond pas", () => {
    const fermee = dire({ etat: "fermee" }, 1);
    expect(fermee.titre).toBe("La salle 1 est fermée.");
    expect(fermee.actions).toEqual(["salles"]);
    expect(
      dire({ etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 }, 1).titre,
    ).not.toContain("fermée");
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
    for (const site of ["repond", "relais", null] as const)
      for (const arrivee of [true, false])
        expect(dire({ etat: "injoignable", site, arrivee, depuisMs: 3000 }, 1).actions).toContain(
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
  it("dit un démarrage qui traîne, puis un démarrage perdu, une fois chacun (A11Y-07)", () => {
    const debut: Liaison = { etat: "demarrage", depuisMs: 2000 };
    const long: Liaison = { etat: "demarrage", depuisMs: 25_000, attente: "long" };
    const echec: Liaison = { etat: "demarrage", depuisMs: 61_000, attente: "echec" };
    expect(phraseLiaison({ etat: "ok" }, debut, 1)).toBe("Le jeu démarre.");
    expect(phraseLiaison(debut, long, 1)).toBe("Le jeu met plus longtemps que d'habitude.");
    expect(phraseLiaison(long, echec, 1)).toBe(
      "La salle n'a pas rendu d'image. Tu peux arrêter d'attendre.",
    );
  });
  it("la salle qui redémarre, puis l'image qui revient", () => {
    const redemarre: Liaison = { etat: "redemarre", arrivee: false };
    expect(phraseLiaison({ etat: "ok" }, redemarre, 1)).toBe("La salle 1 redémarre.");
    expect(phraseLiaison(redemarre, { etat: "ok" }, 1)).toBe("L'image est revenue.");
  });
  it("annonce une demande de manette une fois, avec le délai en mots", () => {
    expect(phraseDemande({ from: "Lina", port: 2 }, 10)).toBe(
      "Lina demande ta place 2. Tu as 10 secondes pour répondre. Sans réponse, tu la gardes.",
    );
    expect(phraseDemande(null, 10)).toBe("");
  });
});

describe("le vocabulaire tenu", () => {
  // Calculé dans chaque essai et non au chargement: un état sans phrase doit
  // faire échouer SON essai, pas empêcher les autres de tourner.
  const textes = () =>
    TOUS.flatMap((l) => {
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
    for (const texte of textes()) {
      expect(texte).not.toMatch(/—|salon|worker|socket|running|\bport\b|prise|xenia|serveur/i);
    }
  });
  it("des phrases de moins de soixante-dix caractères", () => {
    for (const texte of textes())
      for (const phrase of texte.split(/(?<=[.:])\s+/))
        expect(phrase.length, phrase).toBeLessThan(70);
  });
});

/**
 * « état de la connexion », l'entrée du menu qui a remplacé la rubrique
 * « mesures ». Son nom promettait un état et sa valeur disait « 1234 images »,
 * son aide « 60 Hz à l'écran » (relecture du 22 novembre 2026). La valeur est
 * maintenant le nom de l'état, et le résumé dit les mêmes faits en mots.
 */
describe("le résumé de la connexion", () => {
  const faits = { images: 1234, hz: 59.94, port: 2 as number | null };

  it("dit l'état par son nom, puis les faits en mots", () => {
    const lignes = resumeConnexion({ etat: "ok" }, faits);
    expect(lignes[0]).toEqual({ nom: "état", valeur: "en marche" });
    expect(lignes).toContainEqual({ nom: "images reçues", valeur: "1 234" });
    expect(lignes).toContainEqual({ nom: "ton écran", valeur: "60 images par seconde" });
    expect(lignes).toContainEqual({ nom: "ta manette", valeur: "la 2" });
  });

  it("le jumeau: une image figée et une page sans manette se disent", () => {
    const fige: Liaison = {
      etat: "figee",
      depuisMs: 4000,
      son: true,
      manette: true,
      niveau: "pastille",
    };
    const lignes = resumeConnexion(fige, { ...faits, port: null });
    expect(lignes[0]?.valeur).toBe("image figée");
    expect(lignes).toContainEqual({ nom: "ta manette", valeur: "aucune" });
  });

  it("sans mot d'atelier", () => {
    for (const l of TOUS)
      for (const ligne of resumeConnexion(l, faits))
        expect(`${ligne.nom} ${ligne.valeur}`).not.toMatch(/—|socket|\bHz\b|worker|serveur/i);
  });
});
