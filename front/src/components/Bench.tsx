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
 * donc rendue UNE fois, avec des marques stables, et sa propre boucle
 * d'affichage écrit dedans (`paintBench`). Les marques sont le contrat entre
 * les deux.
 *
 * # Pourquoi le banc se peint lui-même
 *
 * Jusqu'au 24 novembre 2026, `paintWiring` le peignait sur la racine des deux
 * dessins, alors qu'il vivait à côté d'elle, dans son propre `<details>` : il
 * affichait « 0.00 » partout, quoi qu'on presse. Il lit donc la manette par
 * `lire`, et seulement ouvert : fermé, personne ne regarde ses vingt nombres.
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { bench, paintBench, type Live } from "../lib/bench";
import { cn } from "../lib/cn";
import { REGLAGE } from "../lib/mots";
import { poserAfficheur } from "../retro/chiffres";

/** Une étiquette de banc: petite, en minuscules, jamais en gras. */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-mini text-faint whitespace-nowrap">{children}</span>;
}

/** Une valeur et sa jauge. La jauge se remplit par le bas, comme un tube,
 * depuis le repos appris quand il y en a un : un trait le marque. */
function Gauge({
  mark,
  tag,
  digits,
  repos = 0,
}: {
  mark: string;
  tag: string;
  digits: number;
  repos?: number;
}) {
  return (
    <div className="flex items-stretch gap-1.5" data-gauge={mark}>
      <span className="relative w-[3px] shrink-0 bg-rule">
        {/* La part remplie. La boucle ne touche qu'à sa hauteur. */}
        <span className="n3-fill absolute inset-x-0 bottom-0 bg-indigo" style={{ height: "0%" }} />
        {repos > 0 ? (
          <span
            className="n3-repos absolute -inset-x-1 h-px bg-bright"
            style={{ bottom: `${(repos * 100).toFixed(1)}%` }}
          />
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <Tag>{tag}</Tag>
        <span className="n3-value font-mono text-corps tabular-nums text-bright">
          {(0).toFixed(digits)}
        </span>
        {repos > 0 ? <Tag>{REGLAGE.reposDuBanc(repos)}</Tag> : null}
      </span>
    </div>
  );
}

/** L'horodatage en chiffres d'afficheur, posé une fois ; `paintBench` écrit
 * sa valeur. */
function Horodatage() {
  const boite = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (boite.current) poserAfficheur(boite.current, "0").classList.add("n3-value");
  }, []);
  return <span ref={boite} data-gauge="stamp" className="font-mono text-corps text-bright" />;
}

export function Bench({
  name,
  id,
  index,
  layout,
  buttons,
  axes,
  lire,
  repos,
  className,
}: {
  name: string;
  id: string;
  index: number | null;
  layout: string;
  buttons: number;
  axes: number;
  /** La manette telle que le navigateur l'annonce, lue à chaque image. */
  lire: () => Live | null;
  /** Le repos appris de chaque bouton, par indice (`restsOf`). */
  repos?: ReadonlyMap<number, number>;
  className?: string;
}) {
  const plan = bench(axes);
  const racine = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const peindre = () => {
      const el = racine.current;
      const live = el && el.closest("details")?.open !== false ? lire() : null;
      if (el && live) paintBench(el, live, repos);
      frame = requestAnimationFrame(peindre);
    };
    frame = requestAnimationFrame(peindre);
    return () => cancelAnimationFrame(frame);
  }, [lire, repos]);

  return (
    <div ref={racine} className={cn("flex flex-col gap-3", className)} data-bench>
      <div className="min-w-0">
        <h3 className="truncate text-fort font-semibold text-bright">{name}</h3>
        {/* Le nom BRUT, celui qu'on recopie dans un rapport de panne. */}
        <p className="truncate text-note text-faint" title={id}>
          {id || "aucune manette"}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {[
          // « numéro » et non « port »: le mot d'atelier est réservé aux mesures
          // techniques, et le banc est monté dans l'écran des touches.
          ["numéro", index === null ? "–" : String(index)],
          ["disposition", layout],
          ["boutons", String(buttons)],
          ["axes", String(axes)],
        ].map(([tag, value]) => (
          <span key={tag} className="flex flex-col leading-tight">
            <Tag>{tag}</Tag>
            <span className="text-corps tabular-nums text-bright">{value}</span>
          </span>
        ))}
        <span className="flex flex-col leading-tight">
          <Tag>horodatage</Tag>
          {/* Le seul chiffre qui dit si la manette parle ENCORE. Figé, elle est
              muette même si tout le reste a l'air juste. */}
          <Horodatage />
        </span>
      </div>
      <p className="text-note text-muted">{REGLAGE.horodatage}</p>

      {buttons > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3.4rem,1fr))] gap-x-2 gap-y-1.5">
          {Array.from({ length: buttons }, (_, at) => (
            <Gauge key={at} mark={`b${at}`} tag={`b${at}`} digits={2} repos={repos?.get(at)} />
          ))}
        </div>
      ) : (
        <p className="text-note text-muted">cette manette n'annonce aucun bouton.</p>
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
