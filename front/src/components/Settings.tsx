/**
 * The three knobs that change what you hear and when you see it.
 *
 * Each one says what it costs, because each one is a trade rather than a
 * preference. Lining the picture up with the sound adds delay to the picture:
 * that is not a bug to hide behind a nicer label, it is the only way to line
 * them up when the sound is the late one.
 */
import { cn } from "../lib/cn";

export function Toggle({
  label,
  hint,
  on,
  id,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  id: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1" title={hint}>
      <input
        id={id}
        type="checkbox"
        checked={on}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-[3px] h-3 w-3 shrink-0 appearance-none border border-rule-bright bg-panel checked:border-indigo checked:bg-indigo"
      />
      <span className="flex flex-col">
        <span className={cn("text-corps", on ? "text-text" : "text-muted")}>{label}</span>
        <span className="text-mini leading-tight text-faint">{hint}</span>
      </span>
    </label>
  );
}

export function Volume({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex items-center gap-2 py-1">
      {/* Un `<label>` relié et plus un `<span>` voisin: la glissière était
          lue « curseur 70 », sans nom (audit A11Y-10, seule violation axe
          « critique » de la salle). */}
      <label htmlFor="volume" className="text-note uppercase tracking-[0.14em] text-faint">
        volume
      </label>
      <input
        id="volume"
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        // `min-w-0` : une glissière garde sinon sa largeur propre (129 px dans
        // Chrome), et le chiffre sortait de 12 px d'une colonne de 256 px
        // (`etats-navigateur`, étape `colonne-tiree`, 27 novembre 2026).
        className="h-1 min-w-0 flex-1 cursor-pointer appearance-none bg-rule accent-indigo"
      />
      <span className="w-8 text-right font-mono text-corps tabular-nums text-text">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
