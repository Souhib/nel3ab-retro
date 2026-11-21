/**
 * Un petit micro, barré quand la voix de cette place n'est pas captée.
 *
 * Posé à côté de la prise, comme la couronne, pour dire d'un coup d'oeil qui
 * figurera dans le prochain clip. Un micro plein pour une voix captée, un micro
 * barré pour une place qui n'a pas ouvert le sien.
 */
export function MicBadge({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
        className={open ? "fill-good" : "fill-faint"}
      />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v4"
        className={open ? "stroke-good" : "stroke-faint"}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {open ? null : (
        <path d="M4 4l16 16" className="stroke-alert" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}
