/**
 * Le silence qui débloque le son sur iPhone.
 *
 * Il ne s'entend pas, donc rien ne dirait qu'il est cassé: un en-tête faux
 * donnerait un fichier que le navigateur refuse, et le refus est justement le
 * symptôme qu'on essaie de corriger. D'où ces vérifications sur les octets.
 */
import { describe, expect, it } from "vitest";
import { LEAD_MAX, LEAD_MIN, silentWav } from "./sound";

function bytesOf(url: string): Uint8Array {
  const base64 = url.slice(url.indexOf(",") + 1);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

describe("le silence qui déplace la session audio", () => {
  it("est un WAV que le navigateur saura lire", () => {
    const bytes = bytesOf(silentWav());
    const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));

    expect(text(0)).toBe("RIFF");
    expect(text(8)).toBe("WAVE");
    expect(text(12)).toBe("fmt ");
    expect(text(36)).toBe("data");
  });

  it("annonce une longueur qui correspond à ce qu'il porte", () => {
    // Un en-tête qui ment sur sa taille donne un fichier refusé, et un refus
    // est exactement le symptôme qu'on corrige.
    const bytes = bytesOf(silentWav());
    const view = new DataView(bytes.buffer);

    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(view.getUint32(40, true)).toBe(bytes.length - 44);
  });

  it("est vraiment silencieux, et pas un créneau à fond", () => {
    // En huit bits non signés, le silence vaut 128. Zéro donnerait la butée
    // basse, donc un claquement pour un morceau censé ne pas s'entendre.
    const bytes = bytesOf(silentWav());

    expect([...bytes.slice(44)].every((sample) => sample === 128)).toBe(true);
  });
});

describe("le plafond de l'avance", () => {
  it("laisse assez de marge pour un téléphone", () => {
    // Relevé sur un vrai iPhone le 18 août 2026: l'avance restait collée à cent
    // vingt millisecondes avec huit trous par fenêtre de dix secondes, pendant
    // qu'une page saine tenait à dix sans un seul trou. Une avance au plafond
    // qui prend encore des trous est une avance trop basse, par définition.
    expect(LEAD_MAX).toBeGreaterThanOrEqual(0.3);
  });

  it("part quand même au plus bas", () => {
    // Le jumeau: un plancher relevé en même temps que le plafond ferait payer à
    // tout le monde le retard d'un seul appareil. L'avance ne monte que sur un
    // trou.
    expect(LEAD_MIN).toBeLessThanOrEqual(0.02);
    expect(LEAD_MIN).toBeLessThan(LEAD_MAX);
  });
});
