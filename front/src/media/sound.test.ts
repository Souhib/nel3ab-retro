/**
 * Le silence qui débloque le son sur iPhone.
 *
 * Il ne s'entend pas, donc rien ne dirait qu'il est cassé: un en-tête faux
 * donnerait un fichier que le navigateur refuse, et le refus est justement le
 * symptôme qu'on essaie de corriger. D'où ces vérifications sur les octets.
 */
import { describe, expect, it } from "vitest";
import { LEAD_MAX, LEAD_MIN, RESYNC } from "./sound";

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

describe("le seuil de réancrage", () => {
  it("reste AU-DESSUS de l'avance maximale", () => {
    // L'invariant qui manquait, et son absence a rendu un téléphone muet.
    // Réancrer pose l'horaire à « maintenant + avance »: si ça dépasse déjà le
    // seuil, le morceau suivant réancre aussi, et ainsi de suite. Relevé sur le
    // téléphone: mille un trous pour mille morceaux, donc pas un seul joué.
    expect(RESYNC).toBeGreaterThan(LEAD_MAX);
  });

  it("garde une marge, et pas seulement un cheveu", () => {
    // Le jumeau: un seuil égal à l'avance plus un millième satisferait l'essai
    // d'au-dessus tout en réancrant sur la moindre irrégularité d'horloge.
    expect(RESYNC - LEAD_MAX).toBeGreaterThanOrEqual(0.05);
  });
});
