/**
 * « Tu joues au clavier »: les touches, sans ouvrir de menu.
 *
 * Aucun écran de la salle ne les donnait: il fallait passer par le menu, les
 * réglages, « touches et manettes » puis l'onglet Clavier (audit T02, 22
 * novembre 2026). La carte est ouverte à la première visite et se souvient
 * d'avoir été lue: un `<details>`, donc un pli que le clavier et le lecteur
 * d'écran savent ouvrir sans rien de plus.
 *
 * Elle ne montre que ce que le profil ACTIF fait (`lib/aide-clavier`), et
 * seulement à qui joue au clavier: une manette branchée la retire.
 */
import { Bobine } from "../bobine/Bobine";
import type { Ligne } from "../lib/aide-clavier";
import { Touche } from "./Reperes";

export function AideClavier({
  lignes,
  ouverte,
  onBascule,
  onChanger,
}: {
  lignes: readonly Ligne[];
  ouverte: boolean;
  onBascule: (ouverte: boolean) => void;
  /** Ouvre « touches et manettes » sur l'onglet du clavier. */
  onChanger: () => void;
}) {
  return (
    <details
      id="aideClavier"
      open={ouverte}
      onToggle={(event) => {
        const maintenant = event.currentTarget.open;
        if (maintenant !== ouverte) onBascule(maintenant);
      }}
      className="group border-t border-rule pt-2"
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-corps text-text [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="shrink-0">
          <Bobine pose={ouverte ? "salue" : "repos"} taille={28} />
        </span>
        <span className="flex-1">Tu joues au clavier</span>
        <span aria-hidden="true" className="text-faint transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      {/* Deux paires par ligne: neuf lignes d'une paire poussaient le clip, le
          micro et le menu sous le bord de la colonne. */}
      <dl className="mt-2 grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 text-corps text-muted">
        {lignes.map((ligne) => (
          <div key={ligne.fait} className="contents">
            <dt className="justify-self-end text-text">
              <Touche>{ligne.touches}</Touche>
            </dt>
            <dd>{ligne.fait}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-corps leading-relaxed text-faint">
        Clique sur l&apos;image pour que tes touches aillent au jeu.
      </p>
      <button
        type="button"
        id="changerTouches"
        onClick={onChanger}
        className="mt-2 min-h-9 border border-rule px-3 py-1.5 text-corps text-muted transition-colors hover:border-indigo hover:text-indigo"
      >
        Changer les touches
      </button>
    </details>
  );
}
