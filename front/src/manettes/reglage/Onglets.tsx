/** Les trois onglets du réglage : une vraie liste d'onglets, au clavier
 * comme à la souris. Les flèches passent d'un onglet à l'autre en boucle,
 * Début et Fin vont aux bouts, et le focus suit la sélection. Pendant un pas
 * à pas ou un changement, ils sont inactifs : changer d'onglet perdrait la
 * question en cours. */
import { REGLAGE } from "../../lib/mots";
import type { Onglet } from "../entree";

export const ONGLETS: readonly Onglet[] = ["manette", "clavier", "profils"];

/** L'onglet où mène une touche, ou `null` quand elle ne déplace rien. */
export function ongletVise(depuis: Onglet, touche: string): Onglet | null {
  const ici = ONGLETS.indexOf(depuis);
  const n = ONGLETS.length;
  if (touche === "ArrowRight") return ONGLETS[(ici + 1) % n]!;
  if (touche === "ArrowLeft") return ONGLETS[(ici + n - 1) % n]!;
  if (touche === "Home") return ONGLETS[0]!;
  if (touche === "End") return ONGLETS[n - 1]!;
  return null;
}

export function Onglets({
  onglet,
  inactifs,
  onChoisir,
}: {
  onglet: Onglet;
  inactifs: boolean;
  onChoisir: (onglet: Onglet) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={REGLAGE.ongletsNom}
      className="n3-onglets"
      onKeyDown={(event) => {
        const vise = inactifs ? null : ongletVise(onglet, event.key);
        if (!vise) return;
        event.preventDefault();
        onChoisir(vise);
        document.getElementById(`onglet-${vise}`)?.focus();
      }}
    >
      {ONGLETS.map((un) => (
        <button
          key={un}
          type="button"
          role="tab"
          id={`onglet-${un}`}
          aria-controls={`page-${un}`}
          aria-selected={un === onglet}
          aria-disabled={inactifs || undefined}
          tabIndex={un === onglet ? 0 : -1}
          className="rt-titre"
          onClick={() => {
            if (!inactifs) onChoisir(un);
          }}
        >
          {REGLAGE.onglets[un]}
        </button>
      ))}
    </div>
  );
}
