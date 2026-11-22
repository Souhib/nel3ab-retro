/**
 * Les mesures techniques: ce qui sert au propriétaire, pas au joueur.
 *
 * Deux niveaux d'information (audit des textes, 22 novembre 2026). Le joueur lit
 * un état en une phrase; le propriétaire lit ici les chiffres qui ont expliqué
 * chaque panne, avec leurs mots d'atelier: socket, worker, p95. Ces mots sont
 * refusés partout ailleurs par `lib/mots.test.ts`, qui reconnaît cette balise:
 * une chaîne écrite dessous a le droit de les porter, et un composant qui n'est
 * monté que dessous (`Instruments`) aussi.
 */
import type { ReactNode } from "react";

export function MesuresTechniques({ children }: { children: ReactNode }) {
  return (
    <section aria-label="mesures techniques" className="flex flex-col gap-2">
      <p className="text-note leading-relaxed text-faint">
        Pour chercher une panne. Rien ici ne change la partie.
      </p>
      {children}
    </section>
  );
}
