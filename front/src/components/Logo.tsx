/**
 * Le logo « nel3ab » de la salle: le relief en escalier (ADR D37).
 *
 * Il remplace le mot-marque en Departure partout où la salle se nommait
 * (colonne, avant-salle, ouverture, entrée du nom). Le dessin vient de
 * `lib/logo.ts`, la source que le salon reçoit aussi; ses couleurs sont lues
 * dans les jetons de la page, donc il suit la nuit, le jour et `.regie-nuit`.
 */
import { calquesDuLogo, HAUTEUR, LARGEUR } from "../lib/logo";
import { cn } from "../lib/cn";

const CALQUES = calquesDuLogo();

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("n3-marque", className)}>
      <svg
        className="rt-logo"
        viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
        width={LARGEUR * 2}
        height={HAUTEUR * 2}
        shapeRendering="crispEdges"
        role="img"
        aria-label="nel3ab"
      >
        {CALQUES.map((calque) => (
          <path
            key={calque.jeton}
            transform={calque.decale ? `translate(${calque.decale} ${calque.decale})` : undefined}
            style={{ fill: `var(${calque.jeton})` }}
            d={calque.d}
          />
        ))}
      </svg>
    </span>
  );
}
