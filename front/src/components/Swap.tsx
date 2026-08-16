/**
 * « Tu me la passes ? »
 *
 * Prendre la manette de quelqu'un qui joue est le seul geste de cette page qui
 * se voit sur l'écran d'un autre. Il ne se fait donc plus d'un clic: on demande,
 * et l'autre répond. Ce qui est demandé arrive chez lui, en gros, au milieu de
 * son écran, parce qu'une notification discrète pendant une partie est une
 * notification que personne ne voit.
 */
export function Asked({
  from,
  port,
  onAnswer,
}: {
  from: string;
  port: number;
  onAnswer: (ok: boolean) => void;
}) {
  return (
    <div
      id="asked"
      className="absolute inset-x-0 top-8 z-40 mx-auto flex w-max max-w-[80%] items-center gap-4 border border-indigo bg-panel px-5 py-3"
    >
      <span className="text-[14px]">
        <strong className="text-indigo">{from}</strong> demande ta manette {port}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          id="giveSeat"
          onClick={() => onAnswer(true)}
          className="border border-indigo px-3 py-1 text-[12px] text-indigo hover:bg-indigo/10"
        >
          la lui passer
        </button>
        <button
          type="button"
          id="keepSeat"
          onClick={() => onAnswer(false)}
          className="border border-rule px-3 py-1 text-[12px] text-muted hover:border-rule-bright"
        >
          garder
        </button>
      </span>
    </div>
  );
}

/** Ce que voit celui qui a demandé, tant qu'il attend ou qu'on lui a dit non. */
export function Asking({
  port,
  said,
  onClose,
}: {
  port: number;
  said: string | null;
  onClose: () => void;
}) {
  return (
    <div
      id="asking"
      className="absolute inset-x-0 top-8 z-40 mx-auto flex w-max max-w-[80%] items-center gap-4 border border-rule bg-panel px-5 py-3"
    >
      <span className={said ? "text-[14px] text-alert" : "text-[14px] text-muted"}>
        {said ?? `demande envoyée pour la manette ${port}…`}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="border border-rule px-2 py-1 text-[11px] text-faint hover:text-text"
      >
        fermer
      </button>
    </div>
  );
}
