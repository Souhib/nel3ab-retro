import { describe, expect, it } from "vitest";

import { askEcho, readEcho, readRoomMessage, readShake } from "./input";

/** `[players, mine, deciding, busy1..busy4]`, exactement ce qu'écrit le worker. */
const message = (...bytes: number[]) => new Uint8Array(bytes);

describe("le message de salle", () => {
  it("dit combien de manettes, laquelle est la mienne, et lesquelles sont prises", () => {
    expect(readRoomMessage(message(4, 2, 1, 1, 1, 0, 0))).toEqual({
      players: 4,
      port: 2,
      deciding: true,
      busy: [true, true, false, false],
    });
  });

  // Le jumeau: le troisième octet est la seule chose qui dise à la page si elle
  // a le droit de lancer un jeu. S'il était ignoré, tout le monde déciderait de
  // tout, et le salon n'aurait plus de propriétaire du tout.
  it("dit aussi quand ce n'est pas à moi de décider", () => {
    expect(readRoomMessage(message(4, 2, 0, 1, 1, 0, 0))?.deciding).toBe(false);
  });

  it("traduit le port 0 par « aucune manette », pas par « la manette 0 »", () => {
    expect(readRoomMessage(message(4, 0, 1, 1, 1, 1, 1))?.port).toBeNull();
  });

  // Le jumeau négatif, et la raison d'être du fichier : la première version de
  // cette page lisait un seul octet, la longueur ne collait plus, et rien
  // n'échouait. La page n'affichait simplement jamais de manette.
  it("refuse un message qui n'a pas la bonne longueur", () => {
    expect(readRoomMessage(message(2))).toBeNull();
    expect(readRoomMessage(message(4, 1, 1, 0, 0, 0))).toBeNull();
    expect(readRoomMessage(message(4, 1, 1, 0, 0, 0, 0, 0))).toBeNull();
  });

  it("refuse une salle ou une place impossibles", () => {
    expect(readRoomMessage(message(0, 0, 1, 0, 0, 0, 0))).toBeNull();
    expect(readRoomMessage(message(5, 1, 1, 0, 0, 0, 0))).toBeNull();
    // Une place au-delà de ce que la salle annonce.
    expect(readRoomMessage(message(2, 3, 1, 0, 0, 0, 0))).toBeNull();
  });
});

describe("la vibration qui redescend", () => {
  it("se distingue d'une salle par sa longueur", () => {
    // Deux octets contre sept. Pas de tag et pas de version: le décodeur de
    // salle rejette déjà tout ce qui n'a pas sa taille.
    expect(readShake(new Uint8Array([2, 255]))).toEqual({ port: 2, strength: 1 });
    expect(readShake(message(4, 2, 1, 1, 1, 0, 0))).toBeNull();
    expect(readRoomMessage(new Uint8Array([2, 255]))).toBeNull();
  });

  it("ramène la force entre zéro et un", () => {
    expect(readShake(new Uint8Array([1, 0]))?.strength).toBe(0);
    expect(readShake(new Uint8Array([1, 128]))?.strength).toBeCloseTo(0.502, 3);
  });

  it("refuse une manette qui n'existe pas", () => {
    // Le jumeau: sans lui, un décodeur qui accepterait tout ferait vibrer la
    // manette de quelqu'un d'autre.
    expect(readShake(new Uint8Array([0, 200]))).toBeNull();
    expect(readShake(new Uint8Array([5, 200]))).toBeNull();
  });
});

describe("l'aller-retour de la manette", () => {
  it("porte le numéro qu'on lui donne, et le rend", () => {
    expect(readEcho(askEcho(1))).toBe(1);
    expect(readEcho(askEcho(4_294_967_295))).toBe(4_294_967_295);
  });

  it("n'est confondu avec aucun autre message de ce canal", () => {
    // Les messages se reconnaissent à leur longueur. Une secousse en fait deux,
    // l'état de la salle six, l'aller-retour neuf.
    expect(readEcho(new Uint8Array([1, 128]))).toBeNull();
    expect(readEcho(new Uint8Array([2, 1, 1, 0, 0, 0]))).toBeNull();
  });

  it("refuse neuf octets qui ne portent pas la marque", () => {
    // Le jumeau de la marque. Sans lui, une lecture qui ne regarderait que la
    // longueur prendrait pour une mesure n'importe quel message futur de neuf
    // octets, et afficherait une latence inventée.
    const wrong = askEcho(7);
    wrong[0] = 0x11;

    expect(readEcho(wrong)).toBeNull();
  });
});
