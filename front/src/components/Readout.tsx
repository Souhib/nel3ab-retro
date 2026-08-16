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
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "normal" | "good" | "alert" | "faint";
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]" title={hint}>
      <span className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</span>
      <span className="flex items-baseline gap-1">
        <span
          className={cn(
            "font-mono text-[13px] tabular-nums",
            tone === "good" && "text-good",
            tone === "alert" && "text-alert",
            tone === "faint" && "text-muted",
            tone === "normal" && "text-text",
          )}
        >
          {value}
        </span>
        {unit ? <span className="font-mono text-[10px] text-faint">{unit}</span> : null}
      </span>
    </div>
  );
}

/** A titled group of readouts, ruled off from the next. */
export function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-rule pt-2">
      <h2 className="mb-1 text-[10px] uppercase tracking-[0.2em] text-indigo/70">{title}</h2>
      {children}
    </section>
  );
}
