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
import elisions from "../test/elisions.json";
import {
  chefAbsent,
  chefChoisit,
  de,
  enMenu,
  etatDuSon,
  fautes,
  LEXIQUE,
  PLACE,
  placeN,
  placesLibres,
  prixImageLegere,
  SAUVEGARDES,
} from "./mots";
import { SLOTS } from "./saves";

/* Les modules de Node sont importés à l'exécution, comme dans `regie.test.ts`:
   la page n'a pas les types de Node, et ne doit pas les avoir. */
type Fs = {
  readFileSync: (chemin: string, codage: "utf-8") => string;
  readdirSync: (
    chemin: string,
    options: { withFileTypes: true },
  ) => { name: string; isDirectory: () => boolean }[];
};
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as Fs;
const ici = (relatif: string) => new URL(relatif, import.meta.url).pathname;
const SRC = ici("../");

/** Les dossiers dont les chaînes n'arrivent PAS à l'écran, par leur nom.
 * `client/` est généré, `apercu/` est la planche de Bobine, et `test/` ne sert
 * qu'aux essais. Tout le reste de `src` est lu, sous-dossiers compris: la
 * première liste nommait les dossiers lus, et un dossier ajouté demain aurait
 * échappé à l'essai sans un mot (relecture du 22 novembre 2026). */
const HORS_PAGE = new Set(["client", "apercu", "test"]);

function fichiersDe(dossier: string): string[] {
  return fs.readdirSync(`${SRC}${dossier}`, { withFileTypes: true }).flatMap((entree) => {
    if (entree.isDirectory())
      return dossier === "" && HORS_PAGE.has(entree.name)
        ? []
        : fichiersDe(`${dossier}${entree.name}/`);
    const nom = entree.name;
    return /\.tsx?$/.test(nom) && !/\.test\.tsx?$/.test(nom) && !nom.endsWith(".d.ts")
      ? [`${dossier}${nom}`]
      : [];
  });
}

/** Un fichier dont TOUT le texte vit dans les mesures techniques, et le
 * composant qu'il exporte. Permis seulement si ce composant n'est monté que
 * sous `<MesuresTechniques>` (l'essai plus bas le vérifie). */
const FICHIERS_TECHNIQUES: Record<string, string> = {
  "components/Instruments.tsx": "Instruments",
};

const sources = fichiersDe("").map((fichier) => ({
  fichier,
  source: fs.readFileSync(`${SRC}${fichier}`, "utf-8"),
}));

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
      "prends une manette pour changer de jeu",
      "Après correspondance",
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
      "prends une place pour changer de jeu",
      "Ce que le jeu reçoit",
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
    for (const attendu of ["Choisir un jeu", "touches et manettes", "reprise de la salle"])
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
      const f = (c.lectures ?? [c.texte]).flatMap((texte) => fautes(texte, c.technique));
      return f.length ? [dire(c, f)] : [];
    });
    expect(fautives).toEqual([]);
  });
});

/** Les fautes d'une source d'essai, lues comme l'essai global les lit: sur
 * chaque lecture d'une chaîne (`lectures`), pas seulement sur son affichage. */
const fautesDeLaSource = (source: string) =>
  chainesDe("essai.tsx", source).flatMap((c) =>
    (c.lectures ?? [c.texte]).flatMap((texte) => fautes(texte, c.technique).map((f) => f.mot)),
  );

describe("les trous trouvés par la relecture du 22 novembre 2026", () => {
  // Trois chaînes visibles portaient un mot refusé et l'essai global restait
  // vert: « Bo décide du jeu » dans le menu, « 2 manettes libres » dans
  // l'avant-salle, « port » et un tiret cadratin dans le banc d'essai. Chaque
  // trou a son essai, et son jumeau qui ne doit rien trouver.

  it("lit une constante en minuscules quand elle arrive à l'écran", () => {
    expect(
      fautesDeLaSource(
        `const pourquoi = mine ? null : "Bo décide du jeu";
         const A = () => <Item hint={pourquoi ?? undefined} />;`,
      ),
    ).toEqual(["décide du jeu"]);
    expect(
      fautesDeLaSource(
        `const pourquoi = mine ? null : "Bo décide du jeu";
         const A = () => <p>{pourquoi}</p>;`,
      ),
    ).toEqual(["décide du jeu"]);
    // Le jumeau: la même constante, seulement comparée, n'est pas un texte.
    expect(
      fautesDeLaSource(
        `const etat = "running";
         const A = ({ s }) => <p>{s === etat ? "joue" : "arrêté"}</p>;`,
      ),
    ).toEqual([]);
  });

  it("lit les éléments d'un tableau que la page dessine", () => {
    expect(
      fautesDeLaSource(
        `const A = () => <div>{[["port", "1"], ["axes", "4"]].map(([t, v]) => <span key={t}>{t}{v}</span>)}</div>;`,
      ),
    ).toEqual(["port"]);
    expect(
      fautesDeLaSource(
        `const LIGNES = [["port", "1"]];
         const A = () => <div>{LIGNES.map(([t]) => <span key={t}>{t}</span>)}</div>;`,
      ),
    ).toEqual(["port"]);
    // Le jumeau: un tableau de codes, seulement interrogé, n'est pas dessiné.
    expect(
      fautesDeLaSource(
        `const A = ({ c }) => <p>{["running", "port"].includes(c) ? "oui" : "non"}</p>;`,
      ),
    ).toEqual([]);
  });

  it("lit un gabarit avec ses trous remplis, pas avec des points de suspension", () => {
    expect(
      fautesDeLaSource(
        'const A = ({ free }) => <p>{`${free} manette${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`}</p>;',
      ),
    ).toEqual(["manette libre"]);
    expect(fautesDeLaSource("const A = ({ n }) => <p>{`Ami · manette ${n}`}</p>;")).toEqual([
      "manette N",
    ]);
    // Le jumeau: le mot du lexique, sous la même forme, passe.
    expect(
      fautesDeLaSource(
        'const A = ({ free }) => <p>{`${free} place${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`}</p>;',
      ),
    ).toEqual([]);
  });
});

describe("un geste du lexique ne s'écrit qu'à travers lui", () => {
  /** Les chaînes d'une source qui recopient une phrase du lexique. */
  const recopies = (cs: readonly Chaine[]) => {
    const phrases = new Set(LEXIQUE.map((phrase) => phrase.toLowerCase()));
    return cs.filter((c) => phrases.has(c.texte.trim().toLowerCase()));
  };

  it("trouve la phrase recopiée, et pas celle qui passe par le lexique", () => {
    expect(
      recopies(chainesDe("essai.tsx", `const A = () => <button>Rendre ma place</button>;`)),
    ).toHaveLength(1);
    expect(
      recopies(chainesDe("essai.tsx", `const A = () => ({ label: "quitter la salle" });`)),
    ).toHaveLength(1);
    expect(
      recopies(chainesDe("essai.tsx", `const A = () => <button>{PLACE.rendre}</button>;`)),
    ).toEqual([]);
    expect(enMenu(PLACE.prendre)).toBe("prendre une place");
  });

  it("aucune source de la page ne recopie un geste du lexique", () => {
    // `saves.ts` garde les trois sauvegardes en clair, pour le salon qui les
    // lit dans le fichier; l'essai « nomme les trois sauvegardes » les tient.
    const permis = new Set(["lib/mots.ts", "lib/saves.ts"]);
    expect(
      recopies(chaines.filter((c) => !permis.has(c.fichier))).map(
        (c) => `${c.fichier}:${c.ligne} « ${c.texte} »`,
      ),
    ).toEqual([]);
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
  });

  it("élide comme le salon, sur la même table d'exemples", () => {
    // `control/tests/ws/test_lobby.py` lit la même table pour `handlers.de`.
    expect(elisions.exemples.length).toBeGreaterThan(5);
    for (const [nom, attendu] of elisions.exemples) expect(de(nom), nom).toBe(attendu);
  });

  it("ne donne le chiffre mesuré de l'image légère qu'aux consoles où on l'a mesuré", () => {
    expect(prixImageLegere("dolphin")).toBe("environ 2,6 fois moins de débit");
    // Le jumeau: la Switch et la Xbox 360 n'ont pas été mesurées.
    for (const moteur of ["ryubing", "eden", "xenia", null, undefined])
      expect(prixImageLegere(moteur)).not.toMatch(/\d/);
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
