/**
 * Le bord gauche de la colonne, qu'on tire pour l'élargir ou la rétrécir.
 *
 * # Pas de flèches du clavier ici
 *
 * La boucle d'entrée prend les flèches pour le jeu dès que le focus n'est pas
 * dans un champ de texte (`media/input.ts`, `onKeyDown`). Une poignée réglable
 * aux flèches les partagerait avec le personnage. La poignée ne prend donc
 * jamais le focus, pas même au clic, et le réglage au clavier ou à la manette
 * passe par le menu (« largeur de la colonne »), qui possède déjà ses flèches.
 *
 * # Suivie par un état, pas écrite dans le style
 *
 * Écrire la largeur dans le style pendant le glissement éviterait un rendu. Mais
 * la page se rend DÉJÀ à chaque pas: l'écran mesure sa place et la remonte
 * (`Screen`, `onSpace`). Ce rendu remettrait la largeur de l'état par-dessus
 * celle du style, et la colonne sauterait de l'une à l'autre. La largeur n'est
 * rangée dans le navigateur qu'au lâcher, une seule fois.
 */
import { useRef, useState } from "react";
import { cn } from "../lib/cn";
import { COLUMN, clampColumn } from "../lib/column";

export function ColumnHandle({
  width,
  onWidth,
  onSettle,
}: {
  width: number;
  /** À chaque pas du glissement. */
  onWidth: (px: number) => void;
  /** Au lâcher, et au double-clic qui remet la largeur d'origine. */
  onSettle: (px: number) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; from: number; now: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || held.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    // Un simple clic ne range rien: le double-clic en fait deux.
    if (held.now !== held.from) onSettle(held.now);
  };

  return (
    <div
      id="columnHandle"
      role="separator"
      aria-orientation="vertical"
      aria-label="largeur de la colonne"
      aria-valuemin={COLUMN.min}
      aria-valuemax={COLUMN.max}
      aria-valuenow={width}
      title="tirer pour élargir ou rétrécir · double-clic : largeur d'origine"
      className="group relative z-20 w-0 shrink-0 cursor-col-resize touch-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Ni focus, ni texte sélectionné en tirant.
        event.preventDefault();
        // Capturé, pour que le glissement suive la souris quand elle passe sur
        // l'image, ce qui arrive dès qu'on élargit.
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointer: event.pointerId, x: event.clientX, from: width, now: width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const held = drag.current;
        if (!held || held.pointer !== event.pointerId) return;
        // La colonne est à DROITE: tirer vers la gauche l'élargit.
        const next = clampColumn(held.from + held.x - event.clientX, window.innerWidth);
        if (next === held.now) return;
        held.now = next;
        onWidth(next);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => {
        onWidth(COLUMN.normal);
        onSettle(COLUMN.normal);
      }}
    >
      {/* La prise, plus large que le trait qu'elle recouvre: un trait d'un pixel
          ne s'attrape pas à la souris. Elle déborde des deux côtés du bord. */}
      <span
        className={cn(
          "absolute inset-y-0 -left-1 w-2 transition-colors",
          dragging ? "bg-indigo/60" : "group-hover:bg-indigo/40",
        )}
      />
    </div>
  );
}
