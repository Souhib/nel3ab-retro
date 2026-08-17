/**
 * The picture, and nothing else.
 *
 * The canvas belongs to the media loop; this component exists to place it and to
 * say when it is empty. It never draws, and it never re-renders on a frame.
 *
 * # Poser l'image est un calcul, pas une classe
 *
 * Un canvas a une taille INTRINSÈQUE égale à son nombre de pixels, et le CSS ne
 * sait pas, à lui seul, faire « le plus grand agrandissement entier qui tient »:
 * ça demande de connaître à la fois la place et la taille de l'image. D'où la
 * mesure, et d'où [`place`], qui est pure et testée à part.
 *
 * La place est mesurée par un `ResizeObserver` plutôt qu'à chaque rendu, parce
 * qu'elle change quand la colonne se replie ou qu'on passe en plein écran, et
 * qu'aucun de ces deux gestes ne rend ce composant.
 */
import { useEffect, useRef, useState } from "react";
import { place, type Fit } from "../lib/fit";

export function Screen({
  canvasRef,
  connected,
  fit,
  picture,
  onSpace,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  connected: boolean;
  /** Comment poser l'image. Séparé du format transporté: ce qu'on économise sur
   * le réseau n'a pas à décider de la taille qu'on regarde. */
  fit: Fit;
  /** La taille de l'image décodée, telle que la boucle média la publie. */
  picture: { width: number; height: number };
  /** La place disponible, rapportée vers le haut.
   *
   * Parce que le MENU en a besoin: il annonce à côté de chaque choix la taille
   * qu'il donnerait, et cette taille dépend de la place. Sans ça, deux choix qui
   * rendent exactement la même image se présentent comme deux choix différents,
   * et on croit que le réglage ne fait rien. */
  onSpace?: (space: { width: number; height: number }) => void;
}) {
  const room = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  /* Par une référence: la fonction vient de la page et serait reconstruite à
     chaque rendu, ce qui reposerait l'observateur en boucle. */
  const told = useRef(onSpace);
  told.current = onSpace;

  useEffect(() => {
    const box = room.current;
    if (!box) return;
    const watch = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect;
      if (!size) return;
      const now = { width: size.width, height: size.height };
      setSpace(now);
      told.current?.(now);
    });
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  const at = place(fit, picture, space);

  return (
    <div ref={room} className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <canvas
        id="screen"
        ref={canvasRef}
        width={1280}
        height={960}
        style={{
          width: `${at.width}px`,
          height: `${at.height}px`,
          // Le lissage: laissé au navigateur pour « remplir », coupé pour les
          // trois autres. Un agrandissement exact veut des pixels francs; un
          // agrandissement bâtard veut être lissé, sinon il scintille.
          imageRendering: at.smooth ? "auto" : "pixelated",
        }}
      />
      {connected ? null : (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="border border-rule bg-panel/90 px-4 py-2 font-mono text-[12px] text-muted">
            en attente de l'image
          </span>
        </div>
      )}
    </div>
  );
}
