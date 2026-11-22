import { cn } from "../lib/cn";

/**
 * One measurement: a label, a number, and the unit it is in.
 *
 * Numbers are monospaced and right-aligned so a column of them can be read down
 * rather than across, and so a value that changes does not move the ones beside
 * it. That is the whole visual argument of this page: an instrument that jitters
 * is an instrument nobody trusts.
 */
export function Readout({
  label,
  value,
  unit,
  tone = "normal",
  hint,
  id,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "normal" | "good" | "alert" | "faint";
  hint?: string;
  /** Pour qu'un pilote lise CE chiffre-là plutôt que de découper un bloc de
   * texte. Un pilote qui cherche par position se casse au prochain ajout. */
  id?: string;
}) {
  const ligne = (
    <>
      <span className="text-note uppercase tracking-[0.14em] text-faint">
        {label}
        {hint ? (
          <span aria-hidden="true" className="ml-1 normal-case text-faint">
            ?
          </span>
        ) : null}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          id={id}
          className={cn(
            "font-mono text-corps tabular-nums",
            tone === "good" && "text-good",
            tone === "alert" && "text-alert",
            tone === "faint" && "text-muted",
            tone === "normal" && "text-text",
          )}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-mini text-faint">{unit}</span> : null}
      </span>
    </>
  );
  // Une aide s'ouvre à la demande, au doigt comme à la souris: elle ne vivait
  // que dans un `title`, qu'un téléphone n'affiche jamais (audit T10). Le
  // `title` reste pour la souris.
  if (hint)
    return (
      <details className="py-[3px]" title={hint}>
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-3 [&::-webkit-details-marker]:hidden">
          {ligne}
        </summary>
        <p className="pt-1 text-note leading-relaxed text-muted">{hint}</p>
      </details>
    );
  return <div className="flex items-baseline justify-between gap-3 py-[3px]">{ligne}</div>;
}

/** A titled group of readouts, ruled off from the next. */
export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-2">
      <h2 className="n3-etiquette mb-1">{title}</h2>
      {children}
    </section>
  );
}
