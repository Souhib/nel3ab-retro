/** Le chef est élu par le salon. Ce signe ne vient pas du droit administrateur. */
export function Crown() {
  return (
    <svg
      role="img"
      aria-label="chef de la salle"
      viewBox="0 0 24 20"
      className="inline-block h-3.5 w-4 shrink-0 text-alert"
      fill="currentColor"
    >
      <title>Chef de la salle</title>
      <path d="M3 15 1 5l6 4 5-8 5 8 6-4-2 10H3Zm0 2h18v2H3Z" />
    </svg>
  );
}
