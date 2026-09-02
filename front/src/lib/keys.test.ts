/**
 * Les jeux de touches nommés, et les deux formes qu'ils remplacent.
 *
 * La partie qui compte est la RELECTURE. Les deux anciennes formes sont sur les
 * disques des gens: un décodeur qui n'en reconnaîtrait pas une rendrait un
 * dossier neuf, donc la disposition d'origine, donc seize touches à refaire sans
 * que rien n'ait échoué.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_KEYS } from "../media/pad";
import {
  activated,
  added,
  DEFAULT_NAME,
  edited,
  fresh,
  names,
  playing,
  mine,
  readKeySet,
  removed,
  roomName,
  withRoom,
} from "./keys";

/** Un profil quelconque, reconnaissable. */
const MINE = {
  KeyW: { kind: "button", name: "A" },
  KeyX: { kind: "trigger", side: "L" },
} as const;

const OTHER = { KeyP: { kind: "button", name: "B" } } as const;

describe("relire ce qui était rangé", () => {
  it("reconnaît la forme à plat, celle qui a vécu des mois", () => {
    const set = readKeySet(MINE);

    expect(names(set)).toEqual([DEFAULT_NAME]);
    expect(playing(set)).toEqual(MINE);
  });

  it("reconnaît la forme par manette et lui rend des noms", () => {
    // La demi-heure où les touches suivaient le type de manette. Personne ne
    // doit perdre ce qu'il avait réglé pendant.
    const set = readKeySet({ byPad: { 0: MINE, 2: OTHER } });

    expect(names(set)).toEqual([DEFAULT_NAME, "guitare"]);
    expect(set.byName["guitare"]).toEqual(OTHER);
  });

  it("reconnaît la forme nommée", () => {
    const set = readKeySet({ byName: { "guitare hero": MINE }, active: "guitare hero" });

    expect(set.active).toBe("guitare hero");
    expect(playing(set)).toEqual(MINE);
  });

  it("distingue vraiment les trois formes", () => {
    // Le jumeau qui compte: un décodeur qui traiterait tout comme la forme à
    // plat passerait le premier essai et rangerait `byName` entier sous un seul
    // profil nommé « défaut ».
    expect(names(readKeySet({ byName: { a: MINE, b: OTHER } }))).toEqual(["a", "b"]);
    expect(names(readKeySet({ byPad: { 1: MINE } }))).toEqual(["Wiimote"]);
    expect(names(readKeySet(MINE))).toEqual([DEFAULT_NAME]);
  });

  it("rend un dossier jouable sur n'importe quoi d'autre", () => {
    // Jamais vide: un dossier vide voudrait dire un clavier qui ne fait rien.
    for (const bad of [null, undefined, 3, "texte", [], {}, { byName: {} }, { byPad: {} }]) {
      const set = readKeySet(bad);
      expect(names(set), JSON.stringify(bad)).toEqual([DEFAULT_NAME]);
      expect(playing(set), JSON.stringify(bad)).toEqual(DEFAULT_KEYS);
    }
  });

  it("répare un nom actif qui ne désigne rien", () => {
    const set = readKeySet({ byName: { a: MINE }, active: "disparu" });

    expect(set.active).toBe("a");
  });

  it("fait l'aller-retour sans rien perdre", () => {
    const set = { byName: { a: MINE, b: OTHER }, active: "b", locked: [] };

    expect(readKeySet(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });
});

describe("le profil qui joue", () => {
  it("rend une COPIE, pas le dossier lui-même", () => {
    // Photographié AVANT, en texte: comparer à la valeur d'origine ne prouve
    // rien si les deux sont le même objet, puisque la mutation touche les deux.
    const set = { byName: { a: { ...MINE } }, active: "a", locked: [] };
    const before = JSON.stringify(set.byName["a"]);
    const got = playing(set);
    (got as Record<string, unknown>)["KeyZ"] = { kind: "button", name: "B" };

    expect(JSON.stringify(set.byName["a"])).toBe(before);
  });
});

describe("choisir, créer, oublier", () => {
  it("joue celui qu'on choisit", () => {
    expect(activated({ byName: { a: MINE, b: OTHER }, active: "a", locked: [] }, "b").active).toBe(
      "b",
    );
  });

  it("ne joue pas un nom qui n'existe pas", () => {
    // Le jumeau: sans ce refus, un clic sur un profil effacé ailleurs laisserait
    // la page avec un nom actif qui ne désigne rien.
    const set = { byName: { a: MINE }, active: "a", locked: [] };
    expect(activated(set, "b")).toEqual(set);
  });

  it("crée une copie de celui qui joue, et la joue", () => {
    // Une copie et non la disposition d'origine: on crée un profil pour changer
    // deux touches, pas pour refaire les seize.
    const after = added({ byName: { a: MINE }, active: "a", locked: [] }, "guitare");

    expect(after.active).toBe("guitare");
    expect(after.byName["guitare"]).toEqual(MINE);
    expect(after.byName["a"]).toEqual(MINE);
  });

  it("refuse un nom vide ou blanc", () => {
    const set = { byName: { a: MINE }, active: "a", locked: [] };
    for (const bad of ["", "   "]) {
      expect(added(set, bad), JSON.stringify(bad)).toEqual(set);
    }
  });

  it("refuse un nom déjà pris SANS écraser celui qui le porte", () => {
    // Le profil actif doit être un AUTRE que celui qu'on recrée, sinon l'essai
    // ne prouve rien: recréer le profil actif redonne un dossier identique, et
    // l'assertion passe avec ou sans le refus. Vu en retirant le refus —
    // l'essai restait vert.
    const set = { byName: { a: MINE, b: OTHER }, active: "b", locked: [] };

    expect(added(set, "a")).toEqual(set);
    expect(added(set, "a").byName["a"]).toEqual(MINE);
  });

  it("enlève les espaces autour du nom", () => {
    expect(names(added({ byName: { a: MINE }, active: "a", locked: [] }, "  guitare  "))).toContain(
      "guitare",
    );
  });

  it("oublie celui qu'on lui donne et rejoue un autre", () => {
    const after = removed({ byName: { a: MINE, b: OTHER }, active: "b", locked: [] }, "b");

    expect(names(after)).toEqual(["a"]);
    expect(after.active).toBe("a");
  });

  it("refuse d'oublier le dernier", () => {
    // Sinon « oublier » laisserait un clavier qui ne fait plus rien, et il n'y
    // aurait aucun bouton pour s'en sortir.
    const set = { byName: { a: MINE }, active: "a", locked: [] };
    expect(removed(set, "a")).toEqual(set);
  });

  it("écrit dans celui qui joue et laisse les autres", () => {
    const after = edited({ byName: { a: MINE, b: OTHER }, active: "b", locked: [] }, {});

    expect(after.byName["b"]).toEqual({});
    expect(after.byName["a"]).toEqual(MINE);
  });
});

describe("un dossier neuf", () => {
  it("a un profil, jouable, et c'est la disposition d'origine", () => {
    expect(names(fresh())).toEqual([DEFAULT_NAME]);
    expect(playing(fresh())).toEqual(DEFAULT_KEYS);
  });
});

describe("les profils de la salle", () => {
  const ROOM = { défaut: MINE, guitare: OTHER };

  it("apparaissent à côté des siens, préfixés", () => {
    const set = withRoom({ byName: { a: MINE }, active: "a", locked: [] }, ROOM);

    expect(names(set)).toEqual(["a", "salle · défaut", "salle · guitare"]);
  });

  it("ne peuvent PAS cacher un profil du même nom", () => {
    // La collision est certaine et pas hypothétique: la référence contiendra un
    // « défaut » et toute personne qui a déjà réglé ses touches en a un aussi,
    // puisque c'est le nom que la migration donne. Sans le préfixe, l'un des
    // deux disparaîtrait de la liste.
    const set = withRoom({ byName: { défaut: MINE }, active: "défaut", locked: [] }, ROOM);

    expect(set.byName["défaut"]).toEqual(MINE);
    expect(set.byName["salle · défaut"]).toEqual(MINE);
    expect(names(set)).toHaveLength(3);
  });

  it("sont marqués verrouillés, et eux seuls", () => {
    const set = withRoom({ byName: { a: MINE }, active: "a", locked: [] }, ROOM);

    expect(set.locked).toEqual(["salle · défaut", "salle · guitare"]);
  });

  it("ne s'oublient pas", () => {
    // Le retirer localement le ferait revenir au prochain chargement: un bouton
    // qui a l'air de marcher et ne marche pas est pire qu'un bouton absent.
    const set = withRoom({ byName: { a: MINE }, active: "a", locked: [] }, ROOM);

    expect(removed(set, "salle · défaut")).toEqual(set);
    // Le jumeau: les siens s'oublient toujours, sinon la garde bloquerait tout.
    expect(names(removed(set, "a"))).not.toContain("a");
  });

  it("ne peuvent pas être imités", () => {
    // Sinon on fabriquerait un faux profil de salle: affiché comme une
    // référence, verrouillé pour personne.
    const set = { byName: { a: MINE }, active: "a", locked: [] };

    expect(added(set, "salle · truc")).toEqual(set);
  });

  it("disparaissent de ce qui est RANGÉ", () => {
    // L'invariant qui porte toute la garantie. S'ils repartaient au service dans
    // le dossier de quelqu'un, ils deviendraient des copies personnelles:
    // modifiables, donc perdables, et figées au jour de la copie. « Je peux y
    // revenir quoi qu'il arrive » tomberait sans qu'aucune erreur ne s'affiche.
    const set = withRoom({ byName: { a: MINE }, active: "a", locked: [] }, ROOM);

    expect(Object.keys(mine(set).byName)).toEqual(["a"]);
  });

  it("ne laissent pas un nom actif que le dossier ne contient pas", () => {
    // Le jumeau du précédent: ranger « salle · défaut » comme profil actif
    // rouvrirait la page sur un nom absent du dossier, donc sur le premier venu,
    // et sans rien dire.
    const set = withRoom({ byName: { a: MINE }, active: "a", locked: [] }, ROOM);
    const onRoom = activated(set, "salle · défaut");

    expect(onRoom.active).toBe("salle · défaut");
    expect(mine(onRoom).active).toBe("a");
  });

  it("rendent leur nom de salle sans le préfixe", () => {
    expect(roomName("salle · guitare")).toBe("guitare");
    // Et laissent tranquille ce qui n'en porte pas.
    expect(roomName("mon truc")).toBe("mon truc");
  });
});
