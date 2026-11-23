/**
 * Un petit micro, barré quand la voix de cette place n'est pas captée.
 *
 * Posé sur la place START, comme la couronne, pour dire d'un coup d'oeil qui
 * figurera dans le prochain clip. Deux dessins, au trait et en pixels
 * (`retro/icones`, effet « icones »). Muet : le nom accessible de la place
 * dit « micro coupé » (`lib/places`, `nomDePlace`).
 */
import { iconePixelSVG } from "../retro/icones";

export function MicBadge({ open }: { open: boolean }) {
  return (
    <span className="n3-micro inline-flex" data-ouvert={open} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="rt-icone-trait h-3.5 w-3.5" aria-hidden="true">
        <path
          d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"
          className={open ? "fill-good" : "fill-faint"}
        />
        <path
          d="M6 11a6 6 0 0 0 12 0M12 17v4"
          className={open ? "stroke-good" : "stroke-faint"}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {open ? null : (
          <path d="M4 4l16 16" className="stroke-alert" strokeWidth="2" strokeLinecap="round" />
        )}
      </svg>
      <span
        className={open ? "contents text-good" : "contents text-faint"}
        // Le dessin vient de la table du dépôt ; aucune donnée n'y passe.
        dangerouslySetInnerHTML={{ __html: iconePixelSVG(open ? "micro" : "micro-coupe") }}
      />
    </span>
  );
}
