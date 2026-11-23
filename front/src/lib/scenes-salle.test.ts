import { describe, expect, it, vi } from "vitest";
import { ETATS as ETATS_DE_LA_MASCOTTE, SCENES, type Lecture, type Scene } from "../mascotte";
import { ETATS_DU_CADRE, HOTES, type EtatDuCadre, type Hote } from "./cadre";
import {
  CHANTIERS,
  HORS_SALLE,
  RANG,
  SCENES_DE,
  creerArbitre,
  decider,
  type Chantier,
} from "./scenes-salle";

/** Une fausse lecture, dont on tient la fin à la main. */
function fausseLecture(scene: Scene) {
  let finir = () => {};
  const fini = new Promise<void>((resolve) => {
    finir = resolve;
  });
  const lecture: Lecture & { finir: () => void } = {
    scene,
    version: "complete",
    refusee: false,
    fini,
    interrompre: vi.fn(() => finir()),
    finir: () => finir(),
  };
  return lecture;
}

function banc(etat: EtatDuCadre = "vit") {
  const hotes = new Map<Hote, HTMLElement>(HOTES.map((h) => [h, document.createElement("div")]));
  const lectures: (Lecture & { finir: () => void })[] = [];
  const jouer = vi.fn((scene: Scene) => {
    const lecture = fausseLecture(scene);
    lectures.push(lecture);
    return lecture;
  });
  let courant = etat;
  const arbitre = creerArbitre({
    hote: (h) => hotes.get(h) ?? null,
    etat: () => courant,
    jouer,
  });
  return {
    arbitre,
    jouer,
    lectures,
    hotes,
    poser: (e: EtatDuCadre) => {
      courant = e;
    },
  };
}

describe("la table des scènes", () => {
  it("donne chaque scène à un chantier de la salle, ou la dit hors de la salle", () => {
    const donnees = new Set([...Object.values(SCENES_DE).flat(), ...HORS_SALLE]);
    expect(donnees).toEqual(new Set(SCENES));
  });

  it("ne donne « premiere-image » qu'à la salle (K06)", () => {
    const qui = CHANTIERS.filter((c) => SCENES_DE[c].includes("premiere-image"));
    expect(qui).toEqual(["salle"]);
  });

  it("range les rangs d'états à salle, sans ex æquo", () => {
    expect([...CHANTIERS].sort((a, b) => RANG[b] - RANG[a])).toEqual([
      "etats",
      "menus",
      "personnes",
      "manettes",
      "salle",
    ]);
    expect(new Set(Object.values(RANG)).size).toBe(CHANTIERS.length);
  });

  it("parle des mêmes états que la mascotte du socle", () => {
    for (const etat of ETATS_DU_CADRE) expect(ETATS_DE_LA_MASCOTTE).toContain(etat);
  });
});

describe("la décision", () => {
  const libre = { enCours: null, etat: "vit" as const };

  it("laisse jouer une scène à son chantier sur un hôte libre", () => {
    expect(decider({ ...libre, scene: "arrivee", par: "personnes" })).toEqual({ jouer: true });
  });

  it("refuse une scène qui n'est pas au chantier qui la demande", () => {
    expect(decider({ ...libre, scene: "premiere-image", par: "menus" })).toEqual({
      jouer: false,
      raison: "pas-a-lui",
    });
    expect(decider({ ...libre, scene: "arrivee", par: "manettes" })).toMatchObject({
      raison: "pas-a-lui",
    });
  });

  it("refuse dans la salle une scène du salon", () => {
    expect(decider({ ...libre, scene: "ouvre", par: "salle" })).toMatchObject({
      raison: "hors-salle",
    });
  });

  it("refuse une scène plus basse pendant une plus haute, et laisse passer la plus haute", () => {
    const panne = { scene: "arret" as const, par: "etats" as const };
    expect(decider({ enCours: panne, etat: "vit", scene: "arrivee", par: "personnes" })).toEqual({
      jouer: false,
      raison: "plus-haut",
    });
    const arrivee = { scene: "arrivee" as const, par: "personnes" as const };
    expect(decider({ enCours: arrivee, etat: "vit", scene: "arret", par: "etats" })).toEqual({
      jouer: true,
    });
  });

  it("laisse un chantier remplacer sa propre scène", () => {
    const arrivee = { scene: "arrivee" as const, par: "personnes" as const };
    expect(decider({ enCours: arrivee, etat: "vit", scene: "depart", par: "personnes" })).toEqual({
      jouer: true,
    });
  });

  it.each(["figee", "coupee", "injoignable", "redemarre", "fermee"] as const)(
    "pendant « %s », ne laisse jouer qu'états",
    (etat) => {
      for (const par of CHANTIERS) {
        const scene = SCENES_DE[par][0];
        if (!scene) throw new Error(`${par} n'a pas de scène`);
        const decision = decider({ enCours: null, etat, scene, par });
        expect(decision.jouer).toBe(par === "etats");
      }
    },
  );

  it.each(["vit", "repos", "demarrage", "connexion"] as const)(
    "hors panne (« %s »), laisse jouer chacun sur un hôte libre",
    (etat) => {
      for (const par of CHANTIERS) {
        const scene = SCENES_DE[par][0];
        if (!scene) throw new Error(`${par} n'a pas de scène`);
        expect(decider({ enCours: null, etat, scene, par }).jouer).toBe(true);
      }
    },
  );
});

describe("l'arbitre branché sur jouer()", () => {
  it("joue, se souvient, et oublie à la fin de la scène", async () => {
    const { arbitre, lectures, jouer, hotes } = banc();
    const lecture = arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" });
    expect(lecture).not.toBeNull();
    expect(jouer).toHaveBeenCalledWith(
      "arrivee",
      expect.objectContaining({ hote: hotes.get("coin") }),
    );
    expect(arbitre.enCours("coin")).toEqual({ scene: "arrivee", par: "personnes" });
    lectures[0]?.finir();
    await lecture?.fini;
    await Promise.resolve();
    expect(arbitre.enCours("coin")).toBeNull();
  });

  it("refuse une arrivée pendant une panne qui parle au coin, sans toucher à la panne", () => {
    const { arbitre, jouer, lectures } = banc();
    arbitre.demander({ scene: "decroche", par: "etats", hote: "coin" });
    const refusee = arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" });
    expect(refusee).toBeNull();
    expect(jouer).toHaveBeenCalledTimes(1);
    expect(lectures[0]?.interrompre).not.toHaveBeenCalled();
  });

  it("coupe une arrivée quand une panne arrive au même endroit", () => {
    const { arbitre, lectures } = banc();
    arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" });
    arbitre.demander({ scene: "arret", par: "etats", hote: "coin" });
    expect(lectures[0]?.interrompre).toHaveBeenCalledTimes(1);
    expect(arbitre.enCours("coin")).toEqual({ scene: "arret", par: "etats" });
  });

  it("tient le coin et le bord du panneau pour un seul personnage", () => {
    const { arbitre, lectures } = banc();
    arbitre.demander({ scene: "decroche", par: "etats", hote: "coin" });
    expect(
      arbitre.demander({ scene: "arrivee", par: "personnes", hote: "bord-panneau" }),
    ).toBeNull();
    expect(lectures).toHaveLength(1);
  });

  it("laisse deux endroits différents jouer chacun le sien", () => {
    const { arbitre } = banc();
    arbitre.demander({ scene: "chercher", par: "menus", hote: "plateau" });
    expect(arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" })).not.toBeNull();
  });

  it("coupe le plateau à la première image, puis laisse jouer premiere-image ailleurs", () => {
    const { arbitre, lectures } = banc("demarrage");
    arbitre.demander({ scene: "chercher", par: "menus", hote: "plateau" });
    arbitre.couper("plateau");
    expect(lectures[0]?.interrompre).toHaveBeenCalledTimes(1);
    expect(arbitre.enCours("plateau")).toBeNull();
    expect(
      arbitre.demander({ scene: "premiere-image", par: "salle", hote: "coin" }),
    ).not.toBeNull();
  });

  it("lit l'état à chaque demande, sans en garder de copie", () => {
    const { arbitre, poser } = banc("vit");
    poser("injoignable");
    expect(arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" })).toBeNull();
    poser("vit");
    expect(arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" })).not.toBeNull();
  });

  it("refuse sans bruit un endroit qui n'est pas monté", () => {
    const jouer = vi.fn();
    const arbitre = creerArbitre({ hote: () => null, etat: () => "vit", jouer });
    expect(arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" })).toBeNull();
    expect(jouer).not.toHaveBeenCalled();
  });

  it("ne retient pas une scène que jouer() a refusée (hôte sur l'image)", () => {
    const refusee: Lecture = {
      scene: "arrivee",
      version: null,
      refusee: true,
      fini: Promise.resolve(),
      interrompre: () => {},
    };
    const arbitre = creerArbitre({
      hote: () => document.createElement("div"),
      etat: () => "vit",
      jouer: () => refusee,
    });
    expect(arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" })).toBeNull();
    expect(arbitre.enCours("coin")).toBeNull();
  });

  it("garde la plus haute quand la plus basse finit en retard", async () => {
    const { arbitre, lectures } = banc();
    arbitre.demander({ scene: "arrivee", par: "personnes", hote: "coin" });
    arbitre.demander({ scene: "arret", par: "etats", hote: "coin" });
    // La fin de l'arrivée, interrompue, arrive après : elle n'efface pas l'arrêt.
    lectures[0]?.finir();
    await Promise.resolve();
    await Promise.resolve();
    expect(arbitre.enCours("coin")).toEqual({ scene: "arret", par: "etats" });
  });
});

/** Un chantier inconnu ne compile pas. */
const inconnu: Chantier[] = [
  // @ts-expect-error « salon » ne joue pas dans la salle.
  "salon",
];
void inconnu;
