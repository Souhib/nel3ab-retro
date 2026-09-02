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
import { consoleLabel } from "../lib/consoles";
import { NAME_MAX } from "../lib/keys";
import { Wiring } from "./Wiring";
import type { Pad } from "../lib/saves";
import { controlsFor, type ControlKey } from "../media/pad";
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
  console,
  held,
  onPickKeys,
  onNewKeys,
  onForgetKeys,
  onPublish,
  state,
  onCapture,
  onUse,
  onCancel,
  onLearn,
  onResetPad,
  onResetKeys,
  onClose,
}: {
  /** La console du jeu en cours, qui décide comment les commandes se NOMMENT.
   *
   * Personne ne cherche « le bouton X » sur une Wiimote. Ce qu'on enregistre ne
   * change pas: la page envoie la même trame, et c'est Dolphin qui la relit
   * comme une manette GameCube ou comme une Wiimote. */
  console: string;
  /** Ce qu'on tient: manette GameCube, Wiimote ou guitare.
   *
   * La console ne suffit pas — sur un jeu Wii les trois sont possibles et ne
   * nomment pas les mêmes commandes. Nommé `held` et non `pad`, parce que `pad`
   * désigne déjà une manette PHYSIQUE dans ce fichier. */
  held: Pad;
  /** Jouer ce profil-là. Immédiat, local, sans effet sur la partie. */
  onPickKeys: (name: string) => void;
  /** En créer un, copie de celui qui joue. */
  onNewKeys: (name: string) => void;
  /** En oublier un. Le dernier ne s'oublie pas. */
  onForgetKeys: (name: string) => void;
  /** Publier celui-ci comme référence de la salle, ou rien si on n'a pas le droit.
   *
   * Absent plutôt que désactivé: un bouton grisé demande « pourquoi ? » à tous
   * ceux qui ne peuvent pas s'en servir, c'est-à-dire à presque tout le monde. */
  onPublish?: (name: string) => void;
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
  /** Le nom en cours de frappe, ou rien quand on ne crée pas. */
  const [naming, setNaming] = useState<string | null>(null);
  /** Le TABLEAU des correspondances, ou les deux manettes dessinées.
   *
   * Deux vues du même sujet plutôt que deux écrans: le tableau dit ce qui est
   * assigné, le schéma dit ce que la salle REÇOIT en ce moment. On vient pour
   * l'un ou pour l'autre selon qu'on règle ou qu'on doute, et les séparer
   * obligerait à savoir lequel on veut avant de l'avoir vu. */
  const [drawn, setDrawn] = useState(false);

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
            {/* Les jeux de touches de cette personne, et de quoi en ajouter.
                PERSONNELS: en changer ne touche ni la salle ni la partie de qui
                que ce soit. Ils ont été accrochés au type de manette pendant une
                demi-heure, ce qui faisait redémarrer le jeu de tout le monde
                quand quelqu'un voulait juste régler ses touches. */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] uppercase tracking-[0.16em] text-faint">profil</span>
              {state.keyProfiles.map((name) => (
                <button
                  key={name}
                  type="button"
                  id={`keys-${name}`}
                  onClick={() => onPickKeys(name)}
                  /* Le cadenas dit ce que la ligne du bas explique. Sans marque,
                     on ne comprend pas pourquoi une modification crée soudain un
                     profil de plus. */
                  title={
                    state.lockedProfiles.includes(name)
                      ? "de la salle: le modifier en fera une copie à toi"
                      : undefined
                  }
                  className={cn(
                    "flex max-w-[12rem] items-center gap-1.5 truncate border px-2 py-0.5 text-[11px]",
                    state.keyProfile === name
                      ? "border-indigo text-indigo"
                      : "border-rule text-muted hover:border-rule-bright",
                  )}
                >
                  {state.lockedProfiles.includes(name) ? (
                    /* Un cadenas DESSINÉ, pas un emoji. L'emoji rendait un carré
                       vide: aucune police de la page ne le porte, et rien ne le
                       signalait. Toutes les autres icônes ici sont déjà du SVG. */
                    <svg
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                  ) : null}
                  {name}
                </button>
              ))}
              {naming === null ? (
                <button
                  type="button"
                  id="newKeys"
                  onClick={() => setNaming("")}
                  className="border border-rule px-2 py-0.5 text-[11px] text-muted hover:border-indigo hover:text-indigo"
                >
                  + nouveau
                </button>
              ) : (
                <form
                  className="flex items-center gap-1"
                  onSubmit={(event) => {
                    event.preventDefault();
                    onNewKeys(naming);
                    setNaming(null);
                  }}
                >
                  <input
                    value={naming}
                    maxLength={NAME_MAX}
                    placeholder="nom du profil"
                    onChange={(event) => setNaming(event.target.value)}
                    /* Échap ferme la saisie sans fermer le panneau. Sans ça la
                       touche remonte au gestionnaire du panneau et on perd
                       l'écran entier en voulant annuler un mot. */
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") return;
                      event.stopPropagation();
                      setNaming(null);
                    }}
                    className="w-36 border border-indigo bg-transparent px-2 py-0.5 text-[11px] outline-none"
                  />
                  <button
                    type="submit"
                    className="border border-rule px-2 py-0.5 text-[11px] text-muted hover:border-indigo hover:text-indigo"
                  >
                    créer
                  </button>
                </form>
              )}
              {/* « Oublier » n'apparaît qu'à partir de deux: le dernier profil ne
                  s'efface pas, et un bouton qui ne fait rien est pire qu'absent. */}
              {state.keyProfiles.length > 1 &&
              naming === null &&
              !state.lockedProfiles.includes(state.keyProfile) ? (
                <button
                  type="button"
                  id="forgetKeys"
                  onClick={() => onForgetKeys(state.keyProfile)}
                  className="border border-rule px-2 py-0.5 text-[11px] text-faint hover:border-rust hover:text-rust"
                >
                  oublier
                </button>
              ) : null}
              {/* Publier n'apparaît qu'à celui qui tient la salle, et le service
                  ne croit pas la page sur parole: il vérifie l'adresse de son
                  côté. Cacher un bouton n'est pas une règle. */}
              {onPublish && naming === null && !state.lockedProfiles.includes(state.keyProfile) ? (
                <button
                  type="button"
                  id="publishKeys"
                  title="ce profil et tes manettes deviennent ce que la salle propose"
                  onClick={() => onPublish(state.keyProfile)}
                  className="border border-rule px-2 py-0.5 text-[11px] text-muted hover:border-indigo hover:text-indigo"
                >
                  publier dans la salle
                </button>
              ) : null}
              <span className="w-full text-[10px] text-faint">
                juste des touches, à toi. En changer ne touche ni la partie ni personne d'autre. Un
                profil neuf part d'une copie de celui qui joue. Ceux qui portent un cadenas viennent
                de la salle: les modifier en fait une copie à toi, et l'original reste.
              </span>
            </div>
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
                {/* Le malentendu à lever: choisir ici ne DÉSACTIVE rien. Toutes
                    les manettes branchées jouent, et le clavier avec, en même
                    temps. Ce bouton dit seulement laquelle on est en train de
                    régler. */}
                <span className="w-full text-[10px] text-faint">
                  toutes jouent en même temps, clavier compris. Ce choix ne dit que laquelle on
                  règle.
                </span>
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

        <div className="flex items-center gap-1 border-b border-rule px-4 py-2">
          {[
            { id: "table", label: "correspondances", on: !drawn },
            { id: "schema", label: "les deux manettes", on: drawn },
          ].map((view) => (
            <button
              key={view.id}
              type="button"
              id={`view-${view.id}`}
              onClick={() => setDrawn(view.id === "schema")}
              className={cn(
                "border px-2 py-0.5 text-[11px]",
                view.on
                  ? "border-indigo text-indigo"
                  : "border-rule text-muted hover:border-rule-bright",
              )}
            >
              {view.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {drawn ? <Wiring state={state} pad={held} onUse={onUse} /> : null}
          <table className={cn("w-full border-collapse text-left", drawn && "hidden")}>
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-faint">
                {/* Le nom de la console, parce que cette colonne dit ce que le
                    JEU attend, pas ce que la personne tient. */}
                <th className="pb-2 font-normal">{consoleLabel(console)}</th>
                <th className="pb-2 font-normal">manette</th>
                <th className="pb-2 font-normal">clavier</th>
              </tr>
            </thead>
            <tbody>
              {controlsFor(console, held).map(({ key, label }) => (
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
            id="resetPad"
            onClick={onResetPad}
            disabled={identity === null}
            className="border border-rule px-2 py-1 text-[11px] text-muted hover:border-rule-bright disabled:opacity-40"
          >
            manette d'origine
          </button>
          <button
            type="button"
            id="resetKeys"
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
