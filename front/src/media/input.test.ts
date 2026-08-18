import { describe, expect, it } from "vitest";
import { readRoomMessage, readShake } from "./input";

/** `[players, mine, busy1..busy4]`, exactly as the worker writes it. */
const message = (...bytes: number[]) => new Uint8Array(bytes);

describe("le message de salle", () => {
  it("dit combien de manettes, laquelle est la mienne, et lesquelles sont prises", () => {
    expect(readRoomMessage(message(4, 2, 1, 1, 0, 0))).toEqual({
      players: 4,
      port: 2,
      busy: [true, true, false, false],
    });
  });

  it("traduit le port 0 par « aucune manette », pas par « la manette 0 »", () => {
    expect(readRoomMessage(message(4, 0, 1, 1, 1, 1))?.port).toBeNull();
  });

  // Le jumeau négatif, et la raison d'être du fichier : la première version de
  // cette page lisait un seul octet, la longueur ne collait plus, et rien
  // n'échouait. La page n'affichait simplement jamais de manette.
  it("refuse un message qui n'a pas la bonne longueur", () => {
    expect(readRoomMessage(message(2))).toBeNull();
    expect(readRoomMessage(message(4, 1, 0, 0, 0))).toBeNull();
    expect(readRoomMessage(message(4, 1, 0, 0, 0, 0, 0))).toBeNull();
  });

  it("refuse une salle ou une place impossibles", () => {
    expect(readRoomMessage(message(0, 0, 0, 0, 0, 0))).toBeNull();
    expect(readRoomMessage(message(5, 1, 0, 0, 0, 0))).toBeNull();
    // Une place au-delà de ce que la salle annonce.
    expect(readRoomMessage(message(2, 3, 0, 0, 0, 0))).toBeNull();
  });
});

describe("la vibration qui redescend", () => {
  it("se distingue d'une salle par sa longueur", () => {
    // Deux octets contre six. Pas de tag et pas de version: le décodeur de
    // salle rejette déjà tout ce qui n'a pas sa taille.
    expect(readShake(new Uint8Array([2, 255]))).toEqual({ port: 2, strength: 1 });
    expect(readShake(message(4, 2, 1, 1, 0, 0))).toBeNull();
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
