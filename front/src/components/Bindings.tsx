/**
 * Ce que fait chaque touche, et comment le changer.
 *
 * Un seul écran pour les deux, parce que ce sont les deux moitiés de la même
 * question. Une antisèche qu'on lit en se disant « ah non, moi je veux B là » et
 * qu'il faut ensuite quitter pour aller chercher un réglage ailleurs est une
 * antisèche qui fait perdre du temps. Ici la ligne qu'on lit est le bouton sur
 * lequel on clique.
 *
 * Rien ne descend au jeu pendant une réassignation: `InputStream` envoie un état
 * neutre tant qu'il attend une réponse. Sans ça, réassigner « A » consisterait à
 * appuyer sur A dans la partie de tout le monde.
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { describePad, identityOf, keyLabel, keyboardLayout, keysFor } from "../media/describe";
import { identify } from "../media/families";
import { CONTROLS, type ControlKey } from "../media/pad";
import type { InputState } from "../media/input";

/** Le résumé dans la colonne: quelle manette, et de quoi ouvrir le reste. */
export function PadSummary({ state, onOpen }: { state: InputState; onOpen: () => void }) {
  const identity = identityOf(state);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px]" title={state.padId ?? undefined}>
          {identity?.name ?? "clavier"}
        </span>
        {identity && !identity.standard ? (
          <span className="shrink-0 font-mono text-[10px] text-alert">à apprendre</span>
        ) : null}
      </div>
      <button
        type="button"
        id="bindings"
        onClick={onOpen}
        className="border border-rule px-2 py-1.5 text-[12px] text-muted transition-colors hover:border-indigo hover:text-indigo"
      >
        touches et configuration
      </button>
    </div>
  );
}

export function Bindings({
  state,
  onCapture,
  onUse,
  onCancel,
  onLearn,
  onResetPad,
  onResetKeys,
  onClose,
}: {
  state: InputState;
  onCapture: (control: ControlKey, source: "pad" | "key") => void;
  onUse: (index: number | null) => void;
  onCancel: () => void;
  onLearn: () => void;
  onResetPad: () => void;
  onResetKeys: () => void;
  onClose: () => void;
}) {
  const identity = identityOf(state);
  const [layout, setLayout] = useState<Map<string, string> | null>(null);

  // Le caractère IMPRIMÉ sur la touche, quand le navigateur veut bien le dire.
  // Sur un azerty, la touche marquée A rend le code `KeyQ`, et afficher « Q »
  // ferait croire que le configurateur s'est trompé.
  useEffect(() => {
    let alive = true;
    void keyboardLayout().then((found) => {
      if (alive) setLayout(found);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Échap ferme, sauf pendant une capture où c'est elle qui l'annule.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && state.capturing === null) onClose();
    };
    addEventListener("keydown", escape);
    return () => removeEventListener("keydown", escape);
  }, [onClose, state.capturing]);

  return (
    <div
      /* Un voile sombre dans les deux thèmes. En clair, `bg-ink/80` donnait du
         blanc sur du blanc: la page derrière restait lisible et le panneau ne se
         détachait plus de rien. Un voile est censé éteindre la pièce. */
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && state.capturing === null) onClose();
      }}
    >
      <div
        id="bindingsPanel"
        className="flex max-h-[86vh] w-full max-w-2xl flex-col border border-rule bg-panel"
      >
        <header className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-[14px] font-medium">Touches</h2>
            {state.pads.length > 1 ? (
              /* Le choix n'apparaît que s'il y a un choix. Une seule manette
                 branchée n'a pas besoin d'un sélecteur pour la désigner. */
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] uppercase tracking-[0.16em] text-faint">
                  configurer
                </span>
                {state.pads.map((pad) => (
                  <button
                    key={pad.index}
                    type="button"
                    id={`use-${pad.index}`}
                    onClick={() => onUse(pad.index)}
                    title={pad.id}
                    className={cn(
                      "max-w-[14rem] truncate border px-2 py-0.5 text-[11px]",
                      state.using === pad.index
                        ? "border-indigo text-indigo"
                        : "border-rule text-muted hover:border-rule-bright",
                    )}
                  >
                    {nameOf(pad.id)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted">
                {identity ? identity.name : "aucune manette détectée"}
                {identity && !identity.standard
                  ? " · disposition inconnue, il lui faut un apprentissage"
                  : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            id="closeBindings"
            onClick={onClose}
            className="border border-rule px-2 py-1 text-[11px] text-muted hover:border-indigo hover:text-indigo"
          >
            fermer
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-faint">
                <th className="pb-2 font-normal">GameCube</th>
                <th className="pb-2 font-normal">manette</th>
                <th className="pb-2 font-normal">clavier</th>
              </tr>
            </thead>
            <tbody>
              {CONTROLS.map(({ key, label }) => (
                <tr key={key} className="border-t border-rule">
                  <td className="py-1 pr-3 text-[12px]">{label}</td>
                  <td className="py-1 pr-3">
                    <Cell
                      id={`pad-${key}`}
                      what={describePad(state.profile, identity, key)}
                      empty={identity === null ? "pas de manette" : "non assigné"}
                      disabled={identity === null}
                      capturing={
                        state.capturing?.control === key && state.capturing.source === "pad"
                      }
                      waiting="appuie sur la manette"
                      onClick={() => onCapture(key, "pad")}
                    />
                  </td>
                  <td className="py-1">
                    <Cell
                      id={`key-${key}`}
                      what={
                        keysFor(state.keys, key)
                          .map((code) => keyLabel(code, layout))
                          .join(" ou ") || null
                      }
                      empty="non assigné"
                      disabled={false}
                      capturing={
                        state.capturing?.control === key && state.capturing.source === "key"
                      }
                      waiting="appuie sur une touche"
                      onClick={() => onCapture(key, "key")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-rule px-4 py-3">
          {state.capturing !== null ? (
            <button
              type="button"
              onClick={onCancel}
              className="border border-alert px-2 py-1 text-[11px] text-alert"
            >
              annuler l'assignation
            </button>
          ) : null}
          {identity && !identity.standard ? (
            <button
              type="button"
              id="learnPad"
              onClick={onLearn}
              className="border border-indigo px-2 py-1 text-[11px] text-indigo hover:bg-indigo/10"
            >
              apprendre la manette entière
            </button>
          ) : null}
          <button
            type="button"
            onClick={onResetPad}
            disabled={identity === null}
            className="border border-rule px-2 py-1 text-[11px] text-muted hover:border-rule-bright disabled:opacity-40"
          >
            manette d'origine
          </button>
          <button
            type="button"
            onClick={onResetKeys}
            className="border border-rule px-2 py-1 text-[11px] text-muted hover:border-rule-bright"
          >
            clavier d'origine
          </button>
          <p className="ml-auto text-[10px] leading-tight text-faint">
            Pendant une assignation, rien n'est envoyé au jeu.
          </p>
        </footer>
      </div>
    </div>
  );
}

function Cell({
  id,
  what,
  empty,
  disabled,
  capturing,
  waiting,
  onClick,
}: {
  id: string;
  what: string | null;
  empty: string;
  disabled: boolean;
  capturing: boolean;
  waiting: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      data-capturing={capturing}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-full border px-2 py-1 text-left font-mono text-[11px] transition-colors",
        capturing
          ? "border-indigo bg-indigo/10 text-indigo"
          : what
            ? "border-transparent text-text hover:border-rule-bright"
            : "border-transparent text-faint hover:border-rule-bright",
        disabled && "cursor-default hover:border-transparent",
      )}
      title={disabled ? undefined : "cliquer, puis appuyer sur ce qu'on veut à la place"}
    >
      {capturing ? waiting : (what ?? empty)}
    </button>
  );
}

/** Le nom court d'une manette, pour un bouton qui doit tenir sur une ligne. */
const nameOf = (id: string): string => identify(id, "standard").name;
