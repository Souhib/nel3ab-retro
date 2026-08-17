/**
 * The picture, and nothing else.
 *
 * The canvas belongs to the media loop; this component exists to place it and to
 * say when it is empty. It never draws, and it never re-renders on a frame.
 */
export function Screen({
  canvasRef,
  connected,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  connected: boolean;
}) {
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black">
      <canvas
        id="screen"
        ref={canvasRef}
        width={1280}
        height={960}
        /* `h-full w-full` et non `max-h-full max-w-full`, et la différence est
           tout sauf cosmétique.
        
           Un canvas a une taille INTRINSÈQUE égale à son nombre de pixels, et
           `max-*` ne fait que la plafonner: il ne fait jamais grandir. En pleine
           taille l'image fait 1216 pixels de large, donc plus que la place
           disponible, donc elle était rabotée pour tenir et remplissait l'écran.
           En demi-format elle fait 608, donc moins, donc plus rien ne la faisait
           grandir: elle s'affichait à 608 pixels au milieu du noir, sur une place
           de 1136. Mesuré le 2026-08-17: 28 % de la surface.
        
           Quelqu'un qui passe en demi-format pour sauver son débit se retrouvait
           donc avec une image quatre fois plus petite EN PLUS d'être moins fine,
           ce qui n'était demandé nulle part.
        
           `object-contain` fait le reste: l'élément prend toute la place, et
           l'image garde ses proportions dedans. L'émulateur dessine en 4/3, et
           l'étirer serait la déformation que personne ne pardonne. */
        className="h-full w-full object-contain"
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
