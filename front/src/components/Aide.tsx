/**
 * Une explication à la demande, lisible au doigt comme à la souris.
 *
 * Plusieurs phrases utiles ne vivaient que dans un attribut `title`: ce que
 * fait le bouton du clip, le micro, l'effet d'un clic sur une place prise, et
 * toutes les aides des mesures. Un `title` n'apparaît qu'au survol d'une
 * souris; ni un écran tactile ni le focus du clavier ne le montrent (audit
 * T10, 22 novembre 2026). Le bouton « ? » ouvre la phrase sous la ligne, et
 * la referme. Le `title` reste, en complément pour la souris.
 */
import { useId, useState, type ReactNode } from "react";

export function Aide({
  texte,
  sujet,
  children,
}: {
  /** La phrase, courte: c'est elle qui s'affiche. */
  texte: string;
  /** Ce qu'elle explique, pour le nom du bouton: « à quoi sert le micro ». */
  sujet: string;
  /** La ligne que la phrase explique. */
  children: ReactNode;
}) {
  const id = useId();
  const [ouverte, setOuverte] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-stretch gap-1">
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        <button
          type="button"
          className="n3-aide-bouton"
          aria-expanded={ouverte}
          aria-controls={id}
          aria-label={`à quoi sert ${sujet}`}
          title={texte}
          onClick={() => setOuverte((avant) => !avant)}
        >
          ?
        </button>
      </div>
      <p id={id} hidden={!ouverte} className="text-note leading-relaxed text-muted">
        {texte}
      </p>
    </div>
  );
}
