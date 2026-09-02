/**
 * Le banc d'essai: la manette qu'on tient, en chiffres.
 *
 * # Ce que le schéma ne dit pas
 *
 * Un schéma qui s'allume répond à « est-ce que ça marche ». Il ne répond pas à
 * « pourquoi ça marche mal »: un stick qui dérive de 0,03, une gâchette qui
 * repose à 0,6, un bouton qui reste à 0,98 au lieu de 1. Ces pannes-là sont des
 * NOMBRES, et un schéma les arrondit toutes à allumé ou éteint.
 *
 * Le banc montre donc ce que le navigateur annonce, sans rien traduire: un
 * chiffre par bouton, deux par cadran, et le nom brut de la manette. C'est la
 * moitié qui manquait, et c'est ce qu'on va lire quand quelqu'un dit « ma
 * manette fait n'importe quoi ».
 *
 * # Pourquoi rien ne s'affiche depuis React
 *
 * Les nombres bougent à la cadence de l'écran. La page lit son instantané deux
 * fois par seconde (règle 8), et rendre React soixante fois par seconde pour
 * vingt nombres serait exactement ce que cette règle interdit. La structure est
 * donc rendue UNE fois, avec des marques stables, et la boucle d'affichage
 * écrit dedans. Les marques sont le contrat entre les deux.
 */
import { bench } from "../lib/bench";
import { cn } from "../lib/cn";

/** Une étiquette de banc: petite, en majuscules, jamais en gras. */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[9px] uppercase tracking-[0.14em] text-faint whitespace-nowrap">
      {children}
    </span>
  );
}

/** Une valeur et sa jauge. La jauge se remplit par le bas, comme un tube. */
function Gauge({ mark, tag, digits }: { mark: string; tag: string; digits: number }) {
  return (
    <div className="flex items-stretch gap-1.5" data-gauge={mark}>
      <span className="relative w-[3px] shrink-0 bg-rule">
        {/* La part remplie. La boucle ne touche qu'à sa hauteur. */}
        <span className="n3-fill absolute inset-x-0 bottom-0 bg-indigo" style={{ height: "0%" }} />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <Tag>{tag}</Tag>
        <span className="n3-value text-[13px] tabular-nums text-bright">{(0).toFixed(digits)}</span>
      </span>
    </div>
  );
}

export function Bench({
  name,
  id,
  index,
  layout,
  buttons,
  axes,
  className,
}: {
  name: string;
  id: string;
  index: number | null;
  layout: string;
  buttons: number;
  axes: number;
  className?: string;
}) {
  const plan = bench(axes);

  return (
    <div className={cn("flex flex-col gap-3", className)} data-bench>
      <div className="min-w-0">
        <h3 className="truncate text-[15px] font-semibold text-bright">{name}</h3>
        {/* Le nom BRUT, celui qu'on recopie dans un rapport de panne. */}
        <p className="truncate text-[11px] text-faint" title={id}>
          {id || "aucune manette"}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {[
          ["port", index === null ? "—" : String(index)],
          ["disposition", layout],
          ["boutons", String(buttons)],
          ["axes", String(axes)],
        ].map(([tag, value]) => (
          <span key={tag} className="flex flex-col leading-tight">
            <Tag>{tag}</Tag>
            <span className="text-[13px] tabular-nums text-bright">{value}</span>
          </span>
        ))}
        <span className="flex flex-col leading-tight">
          <Tag>horodatage</Tag>
          {/* Le seul chiffre qui dit si la manette parle ENCORE. Figé, elle est
              muette même si tout le reste a l'air juste. */}
          <span className="n3-value text-[13px] tabular-nums text-bright" data-gauge="stamp">
            0
          </span>
        </span>
      </div>

      {buttons > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.4rem,1fr))] gap-x-2 gap-y-1.5">
          {Array.from({ length: buttons }, (_, at) => (
            <Gauge key={at} mark={`b${at}`} tag={`b${at}`} digits={2} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted">cette manette n'annonce aucun bouton.</p>
      )}

      {plan.scopes.length > 0 || plan.lone.length > 0 ? (
        <div className="flex flex-wrap gap-x-5 gap-y-3">
          {plan.scopes.map((scope) => (
            <div key={scope.name} className="flex items-center gap-2.5">
              <div className="flex flex-col gap-1.5">
                <Tag>{scope.name}</Tag>
                <Gauge mark={`a${scope.along}`} tag={`axe ${scope.along}`} digits={5} />
                <Gauge mark={`a${scope.down}`} tag={`axe ${scope.down}`} digits={5} />
              </div>
              {/* Le cadran. Deux nombres ne montrent pas une dérive en rond;
                  une trace dans un cercle, si. */}
              <svg
                viewBox="-1.25 -1.25 2.5 2.5"
                className="h-[4.6rem] w-[4.6rem] shrink-0"
                aria-hidden="true"
                data-scope={`a${scope.along}`}
              >
                <circle r="1" fill="none" stroke="var(--rule)" strokeWidth="0.03" />
                <line x1="-1" y1="0" x2="1" y2="0" stroke="var(--rule)" strokeWidth="0.02" />
                <line x1="0" y1="-1" x2="0" y2="1" stroke="var(--rule)" strokeWidth="0.02" />
                <line
                  className="n3-needle"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="0"
                  stroke="var(--indigo)"
                  strokeWidth="0.04"
                />
                <circle className="n3-dot" r="0.09" cx="0" cy="0" fill="var(--indigo)" />
              </svg>
            </div>
          ))}
          {plan.lone.map((one) => (
            <div key={one.name} className="flex flex-col gap-1.5">
              {/* « sans paire » et non le nom de l'axe: le nom est déjà sur la
                  jauge, et ce qu'on veut dire ici est qu'il n'a pas de cadran
                  parce qu'il n'a personne avec qui en faire un. */}
              <Tag>sans paire</Tag>
              <Gauge mark={`a${one.axis}`} tag={one.name} digits={5} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
