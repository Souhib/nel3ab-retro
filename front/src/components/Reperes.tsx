/**
 * Une touche dessinée, et une ligne de touches avec ce qu'elles font.
 *
 * Les aides des menus nommaient les touches dans le texte (« A choisit »), et
 * rien ne distinguait le nom d'une touche du mot qui la suit. Une touche
 * dessinée se lit d'un coup d'oeil, et le lecteur d'écran la lit comme une
 * touche (`<kbd>`).
 */
import type { Repere } from "../lib/appareil";

export function Touche({ children }: { children: React.ReactNode }) {
  return <kbd className="n3-touche">{children}</kbd>;
}

export function Reperes({ liste }: { liste: readonly Repere[] }) {
  return (
    <>
      {liste.map((one) => (
        <span key={`${one.touche}-${one.fait}`} className="flex items-center gap-1.5">
          <Touche>{one.touche}</Touche>
          {one.fait}
        </span>
      ))}
    </>
  );
}
