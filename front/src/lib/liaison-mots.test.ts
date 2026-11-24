import { describe, expect, it } from "vitest";
import type { Liaison } from "../media/liaison";
import {
  dire,
  direFermeture,
  direLegere,
  NOM_ETAT,
  phraseDemande,
  phraseDemarrage,
  phraseFermeture,
  phraseLiaison,
  resumeConnexion,
  type Dit,
} from "./liaison-mots";
import { fautes, IMAGE } from "./mots";
import { ROUGH_IN_A_ROW, VITALS_EVERY } from "./vitals";

const figee = (
  depuisMs: number,
  son = true,
  niveau: "pastille" | "bandeau" = "bandeau",
  apresRelance = false,
): Liaison => ({ etat: "figee", depuisMs, son, manette: true, niveau, apresRelance });

const arrivee = (
  etape: "salle" | "image",
  depuisMs: number,
  perdue: boolean,
  repondDepuisMs: number | null,
): Liaison => ({
  etat: "arrivee",
  etape,
  depuisMs,
  perdue,
  salleRepond: repondDepuisMs !== null,
  repondDepuisMs,
});

/** Tous les états, avec leurs variantes, pour les gardes de vocabulaire. */
const TOUS: Liaison[] = [
  { etat: "ok" },
  { etat: "cachee" },
  { etat: "irreguliere" },
  figee(3000, true, "pastille"),
  figee(14_000, true),
  figee(14_000, false),
  figee(24_000, true, "bandeau", true),
  { etat: "decodeur", depuisMs: 3000 },
  { etat: "coupee", cause: "reseau", depuisMs: 3000 },
  { etat: "coupee", cause: "silence", depuisMs: 3000 },
  { etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 },
  { etat: "injoignable", site: "relais", arrivee: false, depuisMs: 3000 },
  { etat: "injoignable", site: null, arrivee: false, depuisMs: 3000 },
  { etat: "injoignable", site: "repond", arrivee: true, depuisMs: 6000 },
  { etat: "injoignable", site: "relais", arrivee: true, depuisMs: 6000 },
  { etat: "injoignable", site: null, arrivee: true, depuisMs: 6000 },
  { etat: "redemarre", arrivee: false },
  { etat: "redemarre", arrivee: true },
  { etat: "fermee", a: null, pour: null },
  { etat: "demarrage", depuisMs: 3000 },
  { etat: "demarrage", depuisMs: 25_000, attente: "long" },
  { etat: "demarrage", depuisMs: 61_000, attente: "echec" },
  { etat: "demarrage", depuisMs: 61_000, attente: "echec", jeu: "Kart", relance: "moi" },
  arrivee("salle", 2000, false, null),
  arrivee("image", 2000, false, 1500),
  arrivee("image", 16_000, true, 15_000),
  arrivee("salle", 16_000, true, null),
];

/** Le plus long nom du catalogue d'essai : les phrases qui le portent doivent
 * tenir la garde des soixante-dix caractères. */
const LONG = "Mario Kart: Double Dash";

describe("le prix de l'image légère, dans la proposition", () => {
  it("donne le chiffre mesuré à une salle Dolphin, en trois phrases", () => {
    expect(dire({ etat: "irreguliere" }, 1, { moteur: "dolphin" }).detail).toBe(
      "L'image légère est moins nette. Elle demande environ 2,6 fois moins de débit. " +
        "Elle ne change que ton écran.",
    );
  });
  it("jumeau: une salle Switch ou Xbox 360 n'a pas de chiffre, faute de mesure", () => {
    for (const moteur of ["ryubing", "xenia", null])
      expect(dire({ etat: "irreguliere" }, 1, { moteur }).detail).toContain(
        "Elle demande moins de débit.",
      );
  });
  it("est une offre : une pastille en pointillés et deux gestes", () => {
    const dit = dire({ etat: "irreguliere" }, 1);
    expect(dit.niveau).toBe("fiche");
    expect(dit.pastille).toEqual({ texte: "L'image saute", icone: "saute", offre: true });
    expect(dit.actions).toEqual(["reduire", "garder"]);
  });
});

describe("l'image figée", () => {
  it("la phrase du 21 novembre: une durée, un fait, le geste et Signaler à côté", () => {
    const dit = dire(figee(14_000), 1);
    expect(dit.niveau).toBe("fiche");
    expect(dit.titre).toBe("L'image ne bouge plus depuis 14 s.");
    expect(dit.detail).toBe("Le son arrive encore.");
    expect(dit.cout).toBe("Ta place et ta manette restent.");
    expect(dit.actions).toEqual(["relancer"]);
    expect(dit.signaler).toBe("a-cote");
    expect(dit.pastille).toEqual({ texte: "Image figée", icone: "arret", compteur: 14 });
  });
  it("le détail replié dit ce que ta page voit : l'image, le son, la salle, la manette", () => {
    expect(dire(figee(14_000), 1).voit).toEqual([
      { quoi: "Image", vu: "arrêtée depuis 14 s" },
      { quoi: "Son", vu: "arrive" },
      { quoi: "Salle", vu: "répond" },
      { quoi: "Manette", vu: "reçoit son écho" },
    ]);
    expect(dire(figee(24_000, true, "bandeau", true), 1).voit?.[0]).toEqual({
      quoi: "Image",
      vu: "arrêtée depuis 24 s",
    });
  });
  it("jumeau: sans son ni écho, le détail le dit ; la pastille seule n'a pas de détail", () => {
    const sourd: Liaison = { ...figee(14_000, false), manette: false } as Liaison;
    expect(dire(sourd, 1).voit).toEqual([
      { quoi: "Image", vu: "arrêtée depuis 14 s" },
      { quoi: "Son", vu: "n'arrive plus" },
      { quoi: "Salle", vu: "répond" },
      { quoi: "Manette", vu: "pas d'écho" },
    ]);
    expect(dire(figee(3000, true, "pastille"), 1).voit).toBeUndefined();
    expect(dire({ etat: "decodeur", depuisMs: 6400 }, 1).voit).toBeUndefined();
  });
  it("jumeau: sans son, il ne dit pas que le son arrive", () => {
    const dit = dire(figee(14_000, false), 1);
    expect(dit.detail).toBe("La salle répond, mais n'envoie plus d'image.");
  });
  it("une pastille d'abord, sans geste ni fiche", () => {
    const dit = dire(figee(3000, true, "pastille"), 1);
    expect(dit.niveau).toBe("pastille");
    expect(dit.actions).toEqual([]);
    expect(dit.signaler).toBeNull();
    expect(dit.pastille?.compteur).toBe(3);
  });
  it("après une relance vaine, Signaler devient le geste plein", () => {
    const dit = dire(figee(24_000, true, "bandeau", true), 1);
    expect(dit.titre).toBe("L'image reste figée après la relance.");
    expect(dit.signaler).toBe("plein");
    expect(dit.cout).toContain("deux dernières minutes");
  });
  it("jumeau: sans relance vaine, Signaler reste à côté", () => {
    expect(dire(figee(24_000, true, "bandeau", false), 1).signaler).toBe("a-cote");
  });
  it("l'affichage arrêté a la même fiche, et dit depuis quand rien n'est affiché", () => {
    const dit = dire({ etat: "decodeur", depuisMs: 6400 }, 1);
    expect(dit.titre).toBe("L'image arrive, mais ton appareil ne l'affiche plus.");
    expect(dit.detail).toBe("Rien n'est affiché depuis 6 s; la salle envoie toujours.");
    expect(dit.pastille).toEqual({ texte: "Affichage arrêté", icone: "ecran-noir" });
    expect(dit.actions).toEqual(["relancer"]);
  });
});

describe("chaque panne dit de quel côté elle est, sans le supposer", () => {
  it("la salle qui ne répond plus, quand le site répond: le fait, sans la cause", () => {
    // « ta connexion passe » supposait une cause: le 22 septembre 2026, une
    // petite requête passait sur un Wi-Fi qui ne portait plus le flux.
    const dit = dire({ etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 }, 2);
    expect(dit.titre).toBe("La salle 2 ne répond plus.");
    expect(dit.detail).toBe("Le reste du site répond. La page réessaie toute seule.");
    expect(dit.actions).toEqual(["reessayer"]);
    expect(dit.signaler).toBe("a-cote");
    expect(dit.pastille?.texte).toBe("La salle ne répond plus");
  });
  it("jumeau: sans réponse du site, rien sur ta connexion ni Signaler", () => {
    const dit = dire({ etat: "injoignable", site: null, arrivee: false, depuisMs: 3000 }, 2);
    expect(dit.detail).not.toContain("connexion");
    expect(dit.detail).not.toContain("répond");
    expect(dit.signaler).toBeNull();
  });
  it("un relais seul se dit « Rien ne répond », comme une connexion muette", () => {
    const relais = dire({ etat: "injoignable", site: "relais", arrivee: false, depuisMs: 3000 }, 1);
    const muette = dire({ etat: "coupee", cause: "silence", depuisMs: 3000 }, 1);
    expect(relais.titre).toBe("Rien ne répond, ni la salle ni le reste du site.");
    expect(relais).toEqual(muette);
    expect(relais.signaler).toBeNull();
    expect(relais.pastille).toEqual({ texte: "Rien ne répond", icone: "inconnu" });
  });
  it("à l'arrivée, la salle « ne répond pas », en plein cadre, avec sa sortie", () => {
    const dit = dire({ etat: "injoignable", site: "repond", arrivee: true, depuisMs: 6000 }, 1);
    expect(dit.titre).toBe("La salle 1 ne répond pas.");
    expect(dit.niveau).toBe("plein");
    expect(dit.actions).toEqual(["reessayer", "quitter"]);
    // Sous un salon, la sortie mène aux autres salles.
    expect(
      dire({ etat: "injoignable", site: "repond", arrivee: true, depuisMs: 6000 }, 1, {
        salon: true,
      }).actions,
    ).toEqual(["reessayer", "salles"]);
  });
  it("la salle qui redémarre le dit, sans « fermée » et sans geste en partie", () => {
    const dit = dire({ etat: "redemarre", arrivee: false }, 1);
    expect(dit.titre).toBe("La salle 1 redémarre.");
    expect(JSON.stringify(dit)).not.toContain("fermée");
    expect(dit.actions).toEqual([]);
    expect(dit.cout).toBe("Rien à faire: la page revient seule dans la salle.");
  });
  it("jumeau: à l'arrivée, elle redémarre en plein cadre avec un seul geste, la sortie", () => {
    const dit = dire({ etat: "redemarre", arrivee: true }, 1, { salon: true });
    expect(dit.niveau).toBe("plein");
    expect(dit.actions).toEqual(["salles"]);
  });
  it("la salle fermée n'est pas une salle qui ne répond pas", () => {
    const fermee = dire({ etat: "fermee", a: null, pour: null }, 1, { salon: true });
    expect(fermee.titre).toBe("La salle 1 est fermée.");
    expect(fermee.niveau).toBe("plein");
    // Les autres salles, et le carnet une seule fois (D12, décidé le
    // 24 novembre 2026) ; « Rouvrir la salle » attend toujours D17.
    expect(fermee.actions).toEqual(["salles", "carnet"]);
    expect(fermee.detail).toBe(
      "Ce que tu as sauvegardé dans le jeu est gardé. " +
        "Le reste de la partie s'est arrêté avec la salle.",
    );
    expect(
      dire({ etat: "injoignable", site: "repond", arrivee: false, depuisMs: 3000 }, 1).titre,
    ).not.toContain("fermée");
  });
  it("la salle fermée dit l'heure et la raison que le salon a lues (K37)", () => {
    const a = new Date(2026, 10, 24, 23, 12, 40).getTime();
    const inactive = dire({ etat: "fermee", a, pour: "inactivite" }, 1, { salon: true });
    expect(inactive.titre).toBe("La salle 1 a fermé à 23 h 12.");
    expect(inactive.detail).toBe(
      "Personne n'avait touché au jeu depuis longtemps. " +
        "Ce que tu as sauvegardé dans le jeu est gardé. " +
        "Le reste de la partie s'est arrêté avec la salle.",
    );
    const matin = new Date(2026, 10, 24, 9, 5, 0).getTime();
    expect(dire({ etat: "fermee", a: matin, pour: "arret" }, 2).titre).toBe(
      "La salle 2 a fermé à 9 h 05.",
    );
    expect(dire({ etat: "fermee", a: matin, pour: "arret" }, 2).detail).toMatch(
      /^Quelqu'un l'a fermée\. /,
    );
    expect(dire({ etat: "fermee", a: matin, pour: "panne" }, 2).detail).toMatch(
      /^Elle s'est arrêtée sur une panne\. /,
    );
  });
  it("jumeau: sans heure, jamais « a fermé à » ; servie seule, ni carnet ni autres salles", () => {
    const seule = dire({ etat: "fermee", a: null, pour: "inactivite" }, 1);
    expect(seule.titre).toBe("La salle 1 est fermée.");
    expect(seule.titre).not.toContain("a fermé à");
    expect(seule.actions).toEqual(["quitter"]);
    expect(seule.detail).toMatch(/^Personne n'avait touché au jeu/);
  });
  it("ta connexion coupée: le fait, sans geste tant que la page réessaie toute seule", () => {
    const reseau = dire({ etat: "coupee", cause: "reseau", depuisMs: 1 }, 1);
    expect(reseau.titre).toBe("Ton appareil n'a plus de réseau.");
    expect(reseau.actions).toEqual([]);
    expect(reseau.pastille).toEqual({ texte: "Plus de réseau", icone: "coupe" });
    const rien = dire({ etat: "coupee", cause: "silence", depuisMs: 1 }, 1);
    expect(rien.actions).toEqual(["reessayer"]);
    expect(rien.cout).toBe("Ta page ne voit pas de quel côté ça coince.");
  });
  it("une salle qui n'a jamais répondu offre toujours sa sortie, au téléphone aussi", () => {
    // Le 22 novembre 2026 (E6), une salle muette ne laissait que le bouton
    // Précédent du navigateur. En partie, la sortie est en tête de colonne
    // et dans la feuille ; à l'arrivée, le plein cadre la porte lui-même.
    for (const site of ["repond", "relais", null] as const)
      expect(
        dire({ etat: "injoignable", site, arrivee: true, depuisMs: 3000 }, 1).actions,
      ).toContain("quitter");
    expect(dire(arrivee("image", 16_000, true, 15_000), 1).actions).toContain("quitter");
    // Le jumeau: une image figée garde son seul geste, la partie continue.
    expect(dire(figee(9000), 1).actions).not.toContain("quitter");
  });
});

describe("l'arrivée a ses vraies étapes, et une fin", () => {
  it("ne parle ni de demande ni de démarrage", () => {
    const dit = dire(arrivee("image", 2000, false, 1500), 1);
    const texte = JSON.stringify(dit);
    expect(texte).not.toContain("demande");
    expect(texte).not.toContain("démarre");
    expect(dit.titre).toBe("Connexion à la salle 1.");
    expect(dit.niveau).toBe("plein");
    expect(dit.etapes?.map((e) => e.fait)).toEqual([true, false]);
    expect(dit.actions).toEqual([]);
  });
  it("dit qu'on arrive au milieu d'une partie quand la salle a dit son jeu", () => {
    expect(dire(arrivee("salle", 900, false, null), 1, { jeu: "Kart" }).detail).toBe(
      "Une partie de Kart est en cours: tu arrives au milieu.",
    );
  });
  it("jumeau: sans jeu, aucun fait", () => {
    expect(dire(arrivee("salle", 900, false, null), 1, { jeu: null }).detail).toBeUndefined();
  });
  it("à la fin de l'attente, dit depuis quand la salle répond, et propose de réessayer", () => {
    const dit = dire(arrivee("image", 16_000, true, 9000), 1, { salon: true });
    expect(dit.titre).toBe("L'image n'arrive pas.");
    expect(dit.detail).toBe("La salle répond depuis 9 s, sans envoyer d'image.");
    expect(dit.cout).toBe("Réessayer rouvre la liaison, sans recharger la page.");
    expect(dit.actions).toEqual(["reessayer", "salles"]);
    expect(dit.etapes).toBeUndefined();
  });
  it("jumeau: servie seule, la sortie quitte la salle ; muette, pas de durée", () => {
    const dit = dire(arrivee("salle", 16_000, true, null), 1);
    expect(dit.actions).toEqual(["reessayer", "quitter"]);
    expect(dit.detail).toBe("La salle ne répond pas encore.");
  });
});

describe("la fermeture proche et l'image légère", () => {
  it("la fermeture: un compte, une touche du jeu, et « Je reste » pour qui tient une place", () => {
    const dit = direFermeture(4, true);
    expect(dit.titre).toBe("La salle ferme dans 4 min.");
    expect(dit.detail).toContain("Une touche du jeu suffit: manette, clavier ou écran.");
    expect(dit.actions).toEqual(["rester"]);
    expect(dit.pastille).toEqual({ texte: "Ferme dans 4 min", icone: "lune" });
    // Ni « Personne n'a touché » : c'est un compte, pas une conclusion.
    expect(JSON.stringify(dit)).not.toContain("Personne");
  });
  it("jumeau: un spectateur n'a que la pastille, sans geste", () => {
    const dit = direFermeture(4, false);
    expect(dit.niveau).toBe("pastille");
    expect(dit.actions).toEqual([]);
  });
  it("l'image légère passée seule se dit, et se laisse défaire", () => {
    const dit = direLegere();
    expect(dit.titre).toBe("Ton image est passée en image légère.");
    expect(dit.actions).toEqual(["revenir", "garder-legere"]);
    expect(dit.pastille).toEqual({ texte: "Image légère", icone: "plume" });
  });
});

describe("la ligne parlée", () => {
  it("dit le gel, puis le geste quand la fiche paraît", () => {
    expect(phraseLiaison({ etat: "ok" }, figee(3000, true, "pastille"), 1, 1)).toBe(
      "L'image ne bouge plus. Le son arrive encore.",
    );
    expect(phraseLiaison(figee(4500, true, "pastille"), figee(5000), 1, 1)).toBe(
      "Tu peux relancer l'image.",
    );
    expect(phraseLiaison(figee(9000), { etat: "ok" }, 1, 1)).toBe("L'image est revenue.");
  });
  it("jumeau: une durée qui avance ne change pas la phrase", () => {
    const a = phraseLiaison({ etat: "ok" }, figee(2000, true, "pastille"), 1, 1);
    const b = phraseLiaison({ etat: "ok" }, figee(4000, true, "pastille"), 1, 1);
    expect(a).toBe(b);
  });
  it("dit l'arrivée en trois temps, puis « L'image est là. »", () => {
    expect(phraseLiaison({ etat: "ok" }, arrivee("salle", 100, false, null), 1, 0)).toBe(
      "Connexion à la salle 1.",
    );
    expect(
      phraseLiaison(arrivee("salle", 100, false, null), arrivee("image", 300, false, 100), 1, 0),
    ).toBe("La salle répond. Première image attendue.");
    expect(phraseLiaison(arrivee("image", 900, false, 600), { etat: "ok" }, 1, 12)).toBe(
      "L'image est là.",
    );
  });
  it("jumeau: une salle au repos sort de l'arrivée sans image, et ne dit rien", () => {
    // Une salle au repos sort de l'arrivée sans aucune image: la phrase était
    // fausse pour un lecteur d'écran (vérification finale du 22 novembre 2026).
    expect(phraseLiaison(arrivee("image", 900, false, 600), { etat: "ok" }, 1, 0)).toBe("");
  });
  it("dit l'arrivée perdue avec le fait qui la prouve", () => {
    expect(phraseLiaison({ etat: "ok" }, arrivee("image", 16_000, true, 15_000), 1, 0)).toBe(
      "L'image n'arrive pas. La salle répond, sans envoyer d'image.",
    );
    expect(phraseLiaison({ etat: "ok" }, arrivee("salle", 16_000, true, null), 1, 0)).toBe(
      "L'image n'arrive pas. La salle ne répond pas encore.",
    );
  });
  it("jumeau: rien à dire quand tout va bien depuis le début, ni d'un onglet caché", () => {
    expect(phraseLiaison({ etat: "ok" }, { etat: "ok" }, 1, 1)).toBe("");
    expect(phraseLiaison({ etat: "ok" }, { etat: "cachee" }, 1, 1)).toBe("");
  });
  it("dit un démarrage qui traîne, puis un démarrage perdu, une fois chacun (A11Y-07)", () => {
    const debut: Liaison = { etat: "demarrage", depuisMs: 2000 };
    const long: Liaison = { etat: "demarrage", depuisMs: 25_000, attente: "long", habitude: true };
    const echec: Liaison = { etat: "demarrage", depuisMs: 61_000, attente: "echec" };
    expect(phraseLiaison({ etat: "ok" }, debut, 1, 1)).toBe("Le jeu démarre.");
    expect(phraseLiaison(debut, long, 1, 1)).toBe("Le jeu met plus longtemps que d'habitude.");
    // C5 : sans habitude mesurée (D05), la lenteur ne dit pas « d'habitude » ;
    // elle dit le seuil des vingt secondes d'avant.
    expect(phraseLiaison(debut, { ...long, habitude: false }, 1, 1)).toBe(
      "Le jeu démarre encore, depuis 20 s.",
    );
    // Le bouton « arrêter d'attendre » n'existe plus (C7a) : la phrase ne
    // l'offre plus.
    expect(phraseLiaison(long, echec, 1, 1)).toBe("Aucune image du jeu.");
  });
  it("nomme le jeu qui démarre et le seuil mesuré, sans que le compteur parle (C9)", () => {
    const debut: Liaison = { etat: "demarrage", depuisMs: 2000, jeu: "Chantier Royal" };
    // Un seuil mesuré (le 90e centile du jeu, `seuilLong`) remplace les
    // vingt secondes : la phrase dit celui que l'écran a franchi.
    const long: Liaison = { ...debut, depuisMs: 36_000, attente: "long", seuilS: 35 };
    expect(phraseLiaison({ etat: "ok" }, debut, 1, 1)).toBe("Chantier Royal démarre.");
    expect(phraseLiaison(debut, long, 1, 1)).toBe("Chantier Royal démarre encore, depuis 35 s.");
    // Le jumeau : trois secondes de plus ne changent pas un mot.
    expect(phraseLiaison(debut, { ...long, depuisMs: 39_000 }, 1, 1)).toBe(
      phraseLiaison(debut, long, 1, 1),
    );
    expect(phraseLiaison(debut, { ...long, habitude: true }, 1, 1)).toBe(
      "Chantier Royal met plus longtemps que d'habitude.",
    );
    const echec: Liaison = { ...debut, depuisMs: 61_000, attente: "echec" };
    expect(phraseLiaison(long, { ...echec, relance: { nom: "Sami" } }, 1, 1)).toBe(
      "Aucune image de Chantier Royal. Sami peut le relancer.",
    );
    expect(phraseLiaison(long, { ...echec, relance: "moi" }, 1, 1)).toBe(
      "Aucune image de Chantier Royal. Tu peux le relancer.",
    );
    expect(phraseLiaison(long, echec, 1, 1)).toBe("Aucune image de Chantier Royal.");
  });
  it("la salle qui redémarre, puis l'image qui revient", () => {
    const redemarre: Liaison = { etat: "redemarre", arrivee: false };
    expect(phraseLiaison({ etat: "ok" }, redemarre, 1, 1)).toBe("La salle 1 redémarre.");
    expect(phraseLiaison(redemarre, { etat: "ok" }, 1, 1)).toBe("L'image est revenue.");
  });
  it("dit la fermeture à l'entrée, à la dernière minute, et quand la salle reste", () => {
    expect(phraseFermeture(0, 5)).toBe(
      "La salle ferme dans 5 minutes. Une touche du jeu suffit pour rester.",
    );
    expect(phraseFermeture(2, 1)).toBe("La salle ferme dans une minute.");
    expect(phraseFermeture(3, 0)).toBe("La salle reste ouverte.");
  });
  it("jumeau: jamais chaque minute, et rien sans compte", () => {
    expect(phraseFermeture(5, 4)).toBe("");
    expect(phraseFermeture(4, 3)).toBe("");
    expect(phraseFermeture(0, 0)).toBe("");
  });
  it("une salle qui ferme dans une minute dès l'entrée le dit au singulier", () => {
    expect(phraseFermeture(0, 1)).toBe(
      "La salle ferme dans une minute. Une touche du jeu suffit pour rester.",
    );
  });
  // ==== chantier personnes ====
  it("annonce une demande de place une fois, selon la règle de son chemin", () => {
    // La reprise, le chemin que la page emploie : le silence laisse l'autre
    // prendre la place (`api/ws/recovery.py`). La phrase disait le contraire.
    expect(phraseDemande({ from: "Lina", port: 2, chemin: "reprise" }, 20)).toBe(
      "Lina demande ta place 2. Tu as 20 secondes pour répondre. Sans réponse, Lina pourra la prendre.",
    );
    // L'ancienne demande, que la page écoute encore : le silence garde.
    expect(phraseDemande({ from: "Lina", port: 2, chemin: "ancienne" }, 10)).toBe(
      "Lina demande ta place 2. Tu as 10 secondes pour répondre. Sans réponse, tu la gardes.",
    );
    // Le jumeau : la reprise ne dit jamais « tu la gardes ».
    expect(phraseDemande({ from: "Lina", port: 2, chemin: "reprise" }, 20)).not.toMatch(
      /tu la gardes/,
    );
    expect(phraseDemande(null, 10)).toBe("");
  });
  // ==== fin personnes ====
});

/** Les phrases du chargement, demandées par le chantier menus (C1a, C5, C9)
 * et écrites ici, où vit la seule région annoncée. */
describe("les phrases du chargement", () => {
  it("nomment le jeu, sa lenteur au seuil, puis l'échec et qui peut relancer", () => {
    expect(phraseDemarrage(undefined, "Chantier Royal")).toBe("Chantier Royal démarre.");
    expect(phraseDemarrage("long", "Chantier Royal")).toBe(
      "Chantier Royal démarre encore, depuis 20 s.",
    );
    expect(phraseDemarrage("echec", "Chantier Royal", { nom: "Sami" })).toBe(
      "Aucune image de Chantier Royal. Sami peut le relancer.",
    );
    expect(phraseDemarrage("echec", "Chantier Royal", "moi")).toBe(
      "Aucune image de Chantier Royal. Tu peux le relancer.",
    );
  });
  it("jumeau: sans nom de jeu ni relanceur connu, la phrase reste vraie", () => {
    expect(phraseDemarrage(undefined)).toBe("Le jeu démarre.");
    expect(phraseDemarrage("echec")).toBe("Aucune image du jeu.");
  });
  it("l'échec ne dit ni « n'a pas démarré » ni « a démarré » (C1a)", () => {
    for (const relance of ["moi", { nom: "Sami" }, null] as const) {
      const phrase = phraseDemarrage("echec", "Kart", relance);
      expect(phrase).not.toContain("démarré");
    }
  });
  it("la lenteur ne parle pas d'une habitude que personne n'a mesurée (C5)", () => {
    expect(phraseDemarrage("long", "Kart")).not.toContain("habitude");
  });
  it("passe par la ligne parlée, une fois par palier", () => {
    const debut: Liaison = { etat: "demarrage", depuisMs: 2000, jeu: "Kart" };
    const long: Liaison = { etat: "demarrage", depuisMs: 25_000, attente: "long", jeu: "Kart" };
    const echec: Liaison = {
      etat: "demarrage",
      depuisMs: 61_000,
      attente: "echec",
      jeu: "Kart",
      relance: { nom: "Sami" },
    };
    expect(phraseLiaison({ etat: "ok" }, debut, 1, 1)).toBe("Kart démarre.");
    expect(phraseLiaison(debut, long, 1, 1)).toBe("Kart démarre encore, depuis 20 s.");
    expect(phraseLiaison(long, echec, 1, 1)).toBe("Aucune image de Kart. Sami peut le relancer.");
    expect(phraseLiaison(long, { etat: "ok" }, 1, 1)).toBe("Kart a démarré.");
  });
});

describe("le vocabulaire tenu", () => {
  const textesDe = (dit: Dit) => [
    dit.titre,
    dit.detail ?? "",
    dit.cout ?? "",
    dit.pastille?.texte ?? "",
    ...(dit.etapes ?? []).map((e) => e.texte),
  ];
  // Calculé dans chaque essai et non au chargement: un état sans phrase doit
  // faire échouer SON essai, pas empêcher les autres de tourner.
  const textes = () => [
    ...TOUS.flatMap((l) => [
      ...textesDe(dire(l, 1, { jeu: LONG })),
      ...textesDe(dire(l, 1, { jeu: null, salon: true })),
      phraseLiaison({ etat: "ok" }, l, 1, 1),
      phraseLiaison(l, { etat: "ok" }, 1, 1),
      NOM_ETAT[l.etat],
    ]),
    ...textesDe(direFermeture(30, true)),
    ...textesDe(direFermeture(1, false)),
    ...textesDe(direLegere()),
    phraseDemarrage("long", LONG),
    phraseDemarrage("echec", LONG, { nom: "Saladin" }),
    phraseFermeture(0, 30),
    phraseFermeture(0, 1),
    phraseFermeture(2, 1),
    phraseFermeture(2, 0),
  ];

  it("chaque état qui doit parler a une phrase", () => {
    for (const l of TOUS) {
      const dit = dire(l, 1);
      if (l.etat === "ok" || l.etat === "cachee" || l.etat === "demarrage")
        expect(dit.niveau, l.etat).toBe("rien");
      else expect(dit.titre.length, l.etat).toBeGreaterThan(0);
    }
  });
  it("une fiche a toujours sa pastille, et un plein cadre n'en a pas", () => {
    for (const l of TOUS) {
      const dit = dire(l, 1);
      if (dit.niveau === "fiche" || dit.niveau === "pastille")
        expect(dit.pastille, l.etat).not.toBeNull();
      if (dit.niveau === "plein") expect(dit.pastille, l.etat).toBeNull();
    }
  });
  it("garde « image complète » pour la qualité de l'image, et elle seule", () => {
    // Le lexique réserve « image complète » à la qualité (`IMAGE.complete`);
    // une relance repart d'une image-clé, entière (vérification finale du
    // 22 novembre 2026).
    const dit = dire({ etat: "decodeur", depuisMs: 4000 }, 1);
    expect(dit.cout).toBe("Elle repart d'une image entière. Ta place et ta manette restent.");
    for (const texte of textes()) expect(texte, texte).not.toContain(IMAGE.complete);
  });
  it("dit la durée d'une image qui saute avec les constantes qui la font", () => {
    // Deux fenêtres mauvaises de suite, à une fenêtre toutes les dix secondes:
    // la durée écrite en dur aurait menti au premier réglage changé
    // (vérification finale du 22 novembre 2026).
    expect(dire({ etat: "irreguliere" }, 1).titre).toBe(
      `Ton image saute depuis ${(ROUGH_IN_A_ROW * VITALS_EVERY) / 1000} s.`,
    );
  });
  it("aucun mot d'atelier, aucun tiret cadratin", () => {
    // La garde de la charte elle-même, et pas une copie de ses motifs: la copie
    // avait divergé (« prise » sans borne aurait refusé « les places sont
    // prises »).
    expect(textes().flatMap((texte) => fautes(texte).map((f) => `${texte}: ${f.mot}`))).toEqual([]);
  });
  it("des phrases de moins de soixante-dix caractères, avec le plus long nom de jeu", () => {
    for (const texte of textes())
      for (const phrase of texte.split(/(?<=[.:;])\s+/))
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
    // Le compteur est celui des images PEINTES: il se fige quand l'image arrive
    // mais que l'appareil ne l'affiche plus. Et l'emplacement est une place, la
    // manette est l'objet qu'on tient (lexique, vérification finale du
    // 22 novembre 2026).
    expect(lignes).toContainEqual({ nom: "images affichées", valeur: "1 234" });
    expect(lignes).toContainEqual({ nom: "ton écran", valeur: "60 images par seconde" });
    expect(lignes).toContainEqual({ nom: "ta place", valeur: "place 2" });
  });

  it("le jumeau: une image figée et une page sans manette se disent", () => {
    const fige: Liaison = {
      etat: "figee",
      depuisMs: 4000,
      son: true,
      manette: true,
      niveau: "pastille",
      apresRelance: false,
    };
    const lignes = resumeConnexion(fige, { ...faits, port: null });
    expect(lignes[0]?.valeur).toBe("image figée");
    expect(lignes).toContainEqual({ nom: "ta place", valeur: "aucune" });
  });

  it("sans mot d'atelier ni unité", () => {
    const lignes = TOUS.flatMap((l) =>
      resumeConnexion(l, faits).map((ligne) => `${ligne.nom} ${ligne.valeur}`),
    );
    expect(lignes.flatMap((ligne) => fautes(ligne).map((f) => `${ligne}: ${f.mot}`))).toEqual([]);
    // Le résumé dit « images par seconde »: « 60 Hz » était la plainte d'origine.
    for (const ligne of lignes) expect(ligne).not.toMatch(/\bHz\b/);
  });
});
