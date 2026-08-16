/**
 * Les icônes du menu, dessinées ici.
 *
 * La disposition et la façon de naviguer sont celles du XMB de la PS3; les
 * dessins, non. Ceux de Sony ne sont pas à nous, et les recopier de mémoire
 * donnerait des approximations qui auraient l'air de vouloir tromper. Ce sont
 * donc des formes géométriques simples, dans le même esprit: un trait fin, une
 * silhouette lisible à quarante pixels, rien de plus.
 *
 * Tracées en `currentColor`, donc le thème les porte sans qu'elles le sachent.
 */
type IconProps = { className?: string };

const box = "0 0 48 48";

export function GameIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="6" y="14" width="36" height="22" rx="7" />
      <path d="M15 21v8M11 25h8" strokeLinecap="round" />
      <circle cx="34" cy="23" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="30" cy="29" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function RoomIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="17" width="16" height="14" rx="4" />
      <rect x="27" y="17" width="16" height="14" rx="4" />
      <path d="M9 31v5M39 31v5" strokeLinecap="round" />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="24" cy="24" r="7" />
      <path
        d="M24 6v6M24 36v6M6 24h6M36 24h6M11 11l4 4M33 33l4 4M37 11l-4 4M15 33l-4 4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MeasureIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 38V24M18 38V14M28 38V28M38 38V18" strokeLinecap="round" />
    </svg>
  );
}

/** Une pastille pour une ligne de liste: un jeu, une prise, un réglage. */
export function DotIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="12" y="12" width="24" height="24" rx="5" />
    </svg>
  );
}
