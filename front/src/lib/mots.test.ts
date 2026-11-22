/**
 * Le lexique, tenu par la machine (audit des textes, 22 novembre 2026).
 *
 * L'essai parcourt les chaînes visibles de toute la page, extraites par le
 * compilateur TypeScript (`test/chaines-visibles.ts`), et refuse les mots
 * d'atelier hors des mesures techniques, les anciens noms remplacés par le
 * lexique, et les tirets cadratins. Chaque règle a son jumeau: un mot permis
 * qui doit passer, ou la même phrase sous le pli des mesures techniques.
 */
import { describe, expect, it } from "vitest";

import manifest from "../../../consoles/consoles.json";
import { chainesDe, montagesHorsDuPli, type Chaine } from "../test/chaines-visibles";
import {
  chefAbsent,
  chefChoisit,
  de,
  etatDuSon,
  fautes,
  placeN,
  placesLibres,
  placesPrises,
  sauvegardeDe,
  SAUVEGARDES,
} from "./mots";
import { SLOTS } from "./saves";

/* Les modules de Node sont importés à l'exécution, comme dans `regie.test.ts`:
   la page n'a pas les types de Node, et ne doit pas les avoir. */
type Fs = {
  readFileSync: (chemin: string, codage: "utf-8") => string;
  readdirSync: (chemin: string) => string[];
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const SRC = ici("../");

/** Les dossiers dont les chaînes arrivent à l'écran. `client/` est généré,
 * `apercu/` est la planche de Bobine, et `test/` ne sert qu'aux essais. */
const DOSSIERS = ["", "components/", "lib/", "media/", "bobine/"];

/** Un fichier dont TOUT le texte vit dans les mesures techniques, et le
 * composant qu'il exporte. Permis seulement si ce composant n'est monté que
 * sous `<MesuresTechniques>` (l'essai plus bas le vérifie). */
const FICHIERS_TECHNIQUES: Record<string, string> = {
  "components/Instruments.tsx": "Instruments",
};

const sources = DOSSIERS.flatMap((dossier) =>
  fs
    .readdirSync(`${SRC}${dossier}`)
    .filter((nom) => /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) && !nom.endsWith(".d.ts"))
    .map((nom) => {
      const fichier = `${dossier}${nom}`;
      return { fichier, source: fs.readFileSync(`${SRC}${fichier}`, "utf-8") };
    }),
);

const chaines: Chaine[] = sources.flatMap(({ fichier, source }) =>
  chainesDe(fichier, source, fichier in FICHIERS_TECHNIQUES, fichier === "lib/mots.ts"),
);

/** Les noms et les notes du manifeste des consoles: ils s'affichent dans le
 * menu et la bibliothèque, et le worker ne les lit pas. */
const DU_MANIFESTE: Chaine[] = manifest.consoles.flatMap((une) =>
  [une.label, une.note].map((texte) => ({
    fichier: "consoles/consoles.json",
    ligne: 0,
    texte,
    technique: false,
  })),
);

const dire = (c: Chaine, fautesDe: ReturnType<typeof fautes>) =>
  `${c.fichier}:${c.ligne} « ${c.texte} »: ${fautesDe.map((f) => `${f.mot} (${f.raison})`).join(", ")}`;

describe("les mots d'atelier", () => {
  it("refuse chacun, et laisse passer le mot français qui lui ressemble", () => {
    const refuses = [
      ["Le salon ne répond pas.", "salon"],
      ["Le worker a refusé.", "worker"],
      ["socket muette", "socket"],
      ["son · running", "running"],
      ["port 1", "port"],
      ["clique une prise libre", "prise"],
      ["évite un rééchantillonnage", "rééchantillonnage"],
      ["expérimentale : Xenia Edge", "Xenia"],
      ["Ryubing est lent", "Ryubing"],
      ["Eden tourne", "Eden"],
      ["Dolphin relit la trame", "Dolphin"],
    ] as const;
    for (const [texte, mot] of refuses)
      expect(
        fautes(texte).map((f) => f.mot),
        texte,
      ).toContain(mot);
    // Les jumeaux: des mots français que les motifs ne doivent pas avaler.
    for (const texte of [
      "Les 4 places sont prises.",
      "la Switch est prise",
      "déposer un jeu à importer",
      "la porte de la salle",
      "hors de portée",
      "un salonnier",
      "Édenté",
      "La salle ne répond pas.",
    ])
      expect(fautes(texte), texte).toEqual([]);
  });

  it("permet les mots d'atelier dans les mesures techniques, et rien d'autre", () => {
    expect(fautes("socket muette", true)).toEqual([]);
    expect(fautes("Dolphin relit la trame", true)).toEqual([]);
    // Le tiret cadratin et les anciens noms restent refusés sous le pli.
    expect(fautes("image \u2014 réduite", true).map((f) => f.mot)).toEqual(["tiret cadratin"]);
    expect(fautes("format réduit", true).map((f) => f.mot)).toEqual(["format réduit"]);
  });
});

describe("les anciens noms", () => {
  it("refuse chacun, et laisse passer le nom du lexique", () => {
    const refuses = [
      "Ton lien ne suivait pas: l'image est passée en format réduit.",
      "revenir en pleine taille",
      "qualité reçue",
      "partie neuve",
      "prendre une manette",
      "rendre la manette",
      "regarder sans manette",
      "2 manettes libres",
      "Ami · manette 2",
      "Bo demande ta manette 3",
      "Bo décide du jeu dans cette salle",
    ];
    for (const texte of refuses) expect(fautes(texte), texte).not.toEqual([]);
    for (const texte of [
      "image légère",
      "image complète",
      "qualité de l'image",
      "nouvelle partie",
      "prendre une place",
      "rendre ma place",
      "2 places libres",
      "Ami · place 2",
      "Aucune manette détectée",
      "Bo choisit le jeu.",
    ])
      expect(fautes(texte), texte).toEqual([]);
  });
});

describe("le parcours des chaînes visibles", () => {
  it("voit toute la page, et les chaînes qu'il doit voir", () => {
    // Sans ces préconditions, un extracteur cassé rendrait zéro chaîne et
    // l'essai suivant passerait sur rien.
    expect(sources.length).toBeGreaterThan(60);
    expect(chaines.length).toBeGreaterThan(800);
    const textes = new Set(chaines.map((c) => c.texte));
    // Un texte JSX, une entrée de menu (propriété), un attribut, un avis.
    for (const attendu of ["Choisir un jeu", "touches et manettes", "replier la colonne"])
      expect(textes, attendu).toContain(attendu);
  });

  it("ne prend pas une chaîne comparée pour un texte, et prend celle qu'on montre", () => {
    const vu = (source: string) => chainesDe("essai.tsx", source).map((c) => c.texte);
    expect(vu(`const A = ({ s }) => <p>{s === "running" ? "joue" : "arrêté"}</p>;`)).toEqual([
      "joue",
      "arrêté",
    ]);
    expect(vu(`const A = () => <option value="auto">Première</option>;`)).toEqual(["Première"]);
    expect(vu(`const A = () => <Readout value="socket" />;`)).toEqual(["socket"]);
  });

  it("aucune chaîne visible ne porte un mot refusé", () => {
    const fautives = [...chaines, ...DU_MANIFESTE].flatMap((c) => {
      const f = fautes(c.texte, c.technique);
      return f.length ? [dire(c, f)] : [];
    });
    expect(fautives).toEqual([]);
  });
});

describe("le pli des mesures techniques", () => {
  const fautesDe = (source: string) =>
    chainesDe("essai.tsx", source).flatMap((c) => fautes(c.texte, c.technique).map((f) => f.mot));

  it("permet le mot d'atelier sous le pli, et le refuse à côté", () => {
    expect(
      fautesDe(
        `const A = () => <MesuresTechniques><Readout label="socket vidéo" /></MesuresTechniques>;`,
      ),
    ).toEqual([]);
    expect(
      fautesDe(`const A = () => <section><Readout label="socket vidéo" /></section>;`),
    ).toEqual(["socket"]);
    expect(
      fautesDe(`const A = () => <MesuresTechniques><p>Dolphin</p></MesuresTechniques>;`),
    ).toEqual([]);
    expect(fautesDe(`const A = () => <p>Dolphin</p>;`)).toEqual(["Dolphin"]);
  });

  it("un fichier technique n'est monté que sous le pli", () => {
    const dehors = sources.flatMap(({ fichier, source }) =>
      Object.values(FICHIERS_TECHNIQUES).flatMap((composant) =>
        montagesHorsDuPli(fichier, source, composant),
      ),
    );
    expect(dehors).toEqual([]);
    // Le jumeau: le même montage, hors du pli, est trouvé.
    expect(
      montagesHorsDuPli(
        "essai.tsx",
        `const A = () => <div><Instruments shot={s} /></div>;`,
        "Instruments",
      ),
    ).toHaveLength(1);
    expect(
      montagesHorsDuPli(
        "essai.tsx",
        `const A = () => <MesuresTechniques><Instruments shot={s} /></MesuresTechniques>;`,
        "Instruments",
      ),
    ).toEqual([]);
    // Et il est vraiment monté quelque part: sinon la permission ne coûte rien.
    const montages = sources.filter(({ source }) => /<Instruments\b/.test(source));
    expect(montages.map((m) => m.fichier)).toEqual(["components/Sidebar.tsx"]);
  });
});

describe("les mots du lexique", () => {
  it("compte les places", () => {
    expect(placeN(2)).toBe("place 2");
    expect(placesLibres(0)).toBe("aucune place libre");
    expect(placesLibres(1)).toBe("1 place libre");
    expect(placesLibres(3)).toBe("3 places libres");
    expect(placesPrises(0)).toBe("aucune place prise");
    expect(placesPrises(2)).toBe("2 places prises");
  });

  it("élide devant une voyelle, pas devant une consonne", () => {
    expect(de("Ami")).toBe("d'Ami");
    expect(de("Éloi")).toBe("d'Éloi");
    expect(de("Bo")).toBe("de Bo");
    expect(sauvegardeDe("Ami")).toBe("la sauvegarde d'Ami");
    expect(sauvegardeDe("Bo")).toBe("la sauvegarde de Bo");
  });

  it("nomme les trois sauvegardes comme le panneau et le salon", () => {
    // `saves.ts` porte les noms que le salon compare octet pour octet
    // (`test_the_save_names_say_the_same_thing_on_both_sides`): le lexique,
    // la table de la page et le salon disent les trois mêmes mots.
    expect(SLOTS.map((slot) => slot.label)).toEqual(Object.values(SAUVEGARDES));
  });

  it("dit le chef en une phrase", () => {
    expect(chefChoisit("Bo")).toBe("Bo choisit le jeu.");
    expect(chefAbsent("Bo")).toBe("Bo ne joue plus : tu peux choisir le jeu.");
  });

  it("traduit l'état du son, et dit qu'un état est inconnu", () => {
    expect(etatDuSon("running")).toBe("joue");
    expect(etatDuSon("suspended")).toBe("en attente d'un geste");
    expect(etatDuSon("closed")).toBe("arrêté");
    expect(etatDuSon("interrupted")).toBe("inconnu");
  });
});
