import { useEffect, useState } from "react";

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
  lasts,
  onAnswer,
  onExpire,
}: {
  from: string;
  port: number;
  /** Combien de secondes pour répondre. Vient du service, qui applique la même
   * limite: un compte à rebours que le serveur ne connaîtrait pas serait une
   * décoration, et un « oui » tapé après lui téléporterait une manette. */
  lasts: number;
  onAnswer: (ok: boolean) => void;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(Math.ceil(lasts));

  useEffect(() => {
    const tick = window.setInterval(() => {
      setLeft((was) => {
        if (was <= 1) {
          window.clearInterval(tick);
          onExpire();
          return 0;
        }
        return was - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick);
  }, [onExpire]);

  return (
    <div
      id="asked"
      // Plus une alerte assertive. Le bandeau entier l'était, et il réécrivait
      // « 9 s », « 8 s »… chaque seconde: dix interruptions de suite en pleine
      // partie, d'un nombre nu (audit A11Y-09, 22 novembre 2026). La ligne
      // parlée de la salle (`LigneParlee`) dit la demande UNE fois, avec le
      // délai en mots et ce qui arrive sans réponse.
      // Sous le « ••• » qui se pose seul en haut à droite (10 px du bord,
      // 44 px de haut): à 2rem, il mordait sur le coin du bandeau
      // (relecture du 22 novembre 2026, 27x22 px à 390x844).
      // Tenu droit, le texte prend sa ligne et les boutons la suivante: sur
      // trois colonnes, « garder » débordait du bandeau à 390 px.
      className="absolute inset-x-0 top-[calc(var(--zone-haut)+4rem)] z-40 mx-auto flex w-max max-w-[80%] flex-wrap items-center gap-x-4 gap-y-3 border border-indigo bg-panel px-5 py-3"
    >
      <span className="flex basis-full flex-col sm:basis-auto">
        <span className="text-fort">
          <strong className="text-indigo">{from}</strong> demande ta place {port}
        </span>
        {/* Ce qui arrive sans réponse, écrit: un `title` ne s'affiche ni au
            doigt ni au clavier (audit T10). */}
        <span className="text-note text-muted">Sans réponse, tu gardes ta place.</span>
      </span>
      <span className="font-mono text-corps tabular-nums text-faint" aria-hidden="true">
        {left} s
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          id="giveSeat"
          onClick={() => onAnswer(true)}
          className="border border-indigo px-3 py-1 text-corps text-indigo pointer-coarse:min-h-11 hover:bg-indigo/10"
        >
          la lui passer
        </button>
        <button
          type="button"
          id="keepSeat"
          onClick={() => onAnswer(false)}
          className="border border-rule px-3 py-1 text-corps text-muted pointer-coarse:min-h-11 hover:border-rule-bright"
        >
          garder
        </button>
      </span>
    </div>
  );
}
