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
/**
 * Le fourre-tout, et pourquoi il n'existe plus.
 *
 * C'était un carré vide, posé sur quinze entrées différentes. Un menu où « son »,
 * « volume », « ambiance » et « touches » portent le même carré ne se lit pas: il
 * faut relire les mots, et l'icône ne sert alors qu'à occuper de la place. Chaque
 * entrée a maintenant la sienne, plus bas.
 *
 * Gardé comme dernier recours pour une entrée qui n'aurait rien de mieux, et
 * dessiné comme un point plutôt qu'un carré: un point dit « il y a une entrée
 * ici », un carré vide a l'air d'une image qui n'a pas chargé.
 */
export function DotIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="24" cy="24" r="4" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Le son: un haut-parleur, et rien qui sorte. Pour « activer le son ». */
export function SoundIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 19h7l9-7v24l-9-7h-7z" strokeLinejoin="round" />
      <path d="M32 18a9 9 0 0 1 0 12" strokeLinecap="round" />
    </svg>
  );
}

/** Le volume: le même haut-parleur, avec des ondes qui montent. */
export function VolumeIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M8 19h6l8-6v22l-8-6H8z" strokeLinejoin="round" />
      <path d="M28 17a11 11 0 0 1 0 14M33 13a17 17 0 0 1 0 22" strokeLinecap="round" />
    </svg>
  );
}

/** L'ambiance: une palette. Sept couleurs se choisissent, pas se règlent. */
export function PaletteIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M24 8a16 16 0 1 0 0 32c3 0 3-3 1-5s0-5 3-5h5a7 7 0 0 0 7-7c0-8-7-15-16-15z"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="18" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="26" cy="15" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="27" r="2.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** La forme du menu: des panneaux, comme une console en dispose. */
export function LayoutIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="7" y="11" width="14" height="26" rx="3" />
      <rect x="25" y="11" width="16" height="11" rx="3" />
      <rect x="25" y="26" width="16" height="11" rx="3" />
    </svg>
  );
}

/** Les touches: un clavier. C'est ce qu'on vient y régler. */
export function KeysIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="15" width="38" height="19" rx="3" />
      <path
        d="M12 21h2M18 21h2M24 21h2M30 21h2M36 21h2M12 27h2M17 27h14M36 27h2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Le format de l'image: un écran, et le cadre plus petit qui tient dedans. */
export function ScreenIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="10" width="38" height="26" rx="3" />
      <rect x="14" y="17" width="20" height="12" rx="2" strokeDasharray="3 3" />
      <path d="M18 41h12" strokeLinecap="round" />
    </svg>
  );
}

/** Une manette, pour une place de la salle. */
export function PadIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M16 16h16a10 10 0 0 1 9 14l-2 5a4 4 0 0 1-6 1l-4-4H19l-4 4a4 4 0 0 1-6-1l-2-5a10 10 0 0 1 9-14z"
        strokeLinejoin="round"
      />
      <path d="M16 24v6M13 27h6" strokeLinecap="round" />
      <circle cx="32" cy="25" r="2" fill="currentColor" stroke="none" />
      <circle cx="28" cy="29" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Un oeil: regarder sans jouer. */
export function WatchIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 24s7-11 20-11 20 11 20 11-7 11-20 11S4 24 4 24z" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="5" />
    </svg>
  );
}

/** Une porte, avec la flèche qui en sort: quitter la salle. */
export function LeaveIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M26 8H12a3 3 0 0 0-3 3v26a3 3 0 0 0 3 3h14" strokeLinejoin="round" />
      <path d="M22 24h18M34 18l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Une onde: la fréquence que la carte son préfère. */
export function WaveIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M5 24c4-10 7-10 10 0s7 10 10 0 7-10 10 0 5 6 8 0"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Deux anneaux liés: caler l'image sur le son. */
export function SyncIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 18h-5a7 7 0 0 0 0 14h5" strokeLinecap="round" />
      <path d="M27 18h5a7 7 0 0 1 0 14h-5" strokeLinecap="round" />
      <path d="M18 25h12" strokeLinecap="round" />
    </svg>
  );
}

/** Une colonne qui se replie. */
export function PanelIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="38" height="26" rx="3" />
      <path d="M31 11v26" />
      <path d="M25 20l-5 4 5 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Quatre flèches vers les coins: le plein écran. */
export function ExpandIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M18 8H8v10M30 8h10v10M30 40h10V30M18 40H8V30"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Le dossier des jeux `GameCube`: un cube en perspective.
 *
 * De la géométrie, pas un logo. Le principe est celui de l'en-tête de ce
 * fichier: les marques de Nintendo ne sont pas à nous, et un logo redessiné de
 * mémoire aurait l'air de vouloir tromper. Un cube dit « GameCube » à qui
 * connaît la console, et ne prétend être la propriété de personne.
 */
export function CubeIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M24 8 40 17v18l-16 9-16-9V17z" strokeLinejoin="round" />
      <path d="M8 17l16 9 16-9M24 26v18" strokeLinejoin="round" />
    </svg>
  );
}

/** Le dossier des jeux Wii: la silhouette de sa manette.
 *
 * Une forme de matériel plutôt qu'un mot: elle se reconnaît à quarante pixels,
 * et pour la même raison que le cube, elle n'emprunte rien à personne.
 */
export function WandIcon({ className }: IconProps) {
  return (
    <svg viewBox={box} className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="17" y="5" width="14" height="38" rx="4" />
      <path d="M21 12h6M24 9v6" strokeLinecap="round" />
      <circle cx="24" cy="24" r="2.4" fill="currentColor" stroke="none" />
      <path d="M20 33h8" strokeLinecap="round" />
    </svg>
  );
}
