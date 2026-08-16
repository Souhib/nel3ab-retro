/**
 * Une manette GameCube, dessinée.
 *
 * Un carré numéroté disait déjà « P2, occupée ». Ce qu'il ne disait pas, c'est
 * de quelle console on parle, ni où on est dans la rangée sans lire. Une
 * silhouette se reconnaît avant d'être lue, et la rangée de quatre ressemble
 * alors à la façade de la console, ce qu'elle est.
 *
 * Tracée avec `currentColor` et rien d'autre: la couleur vient du thème, donc
 * les sept ambiances la portent sans qu'aucune n'ait à la connaître. Pas de
 * dégradé ni d'ombre, pour la même raison que le reste de la page.
 */
export function Pad({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 44" className={className} aria-hidden="true" fill="none">
      {/* Le corps: deux poignées et la bosse centrale. */}
      <path
        d="M20 8h24c5 0 8 3 9 8l4 15c1 5-2 9-7 9-4 0-6-3-9-6-2-2-4-3-7-3H30c-3 0-5 1-7 3-3 3-5 6-9 6-5 0-8-4-7-9l4-15c1-5 4-8 9-8z"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Le stick principal, à gauche, et la croix sous lui. */}
      <circle cx="20" cy="17" r="4.5" stroke="currentColor" strokeWidth="2" />
      <path d="M20 30v4M18 32h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* Le gros A, et le B en dessous à gauche: la disposition qui ne ressemble
          à aucune autre manette. */}
      <circle cx="45" cy="19" r="5" fill="currentColor" />
      <circle cx="37" cy="26" r="2.5" fill="currentColor" />
      <circle cx="52" cy="12" r="2" fill="currentColor" />
      {/* Start, au milieu. */}
      <circle cx="32" cy="18" r="1.8" fill="currentColor" />
    </svg>
  );
}
