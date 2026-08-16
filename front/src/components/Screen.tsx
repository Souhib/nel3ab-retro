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
        // The emulator draws 4:3. Letting the window stretch it would be the one
        // deformation nobody forgives.
        className="max-h-full max-w-full object-contain"
        style={{ aspectRatio: "4 / 3" }}
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
