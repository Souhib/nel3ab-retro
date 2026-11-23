/** Configuration edits render at reading speed. The live diagram paints from
 * the same SwitchInput state as gameplay, without React on its polling path.
 *
 * La préparation à plusieurs d'une salle Pro n'est plus écrite ici : elle vit
 * dans `Preparation.tsx` (`usePreparationPro`), et ce panneau pose ses
 * morceaux à leur place. */
import { useEffect, useRef, useState } from "react";
import type { Game, Preparation } from "../client";
import type { InputStream } from "../media/input";
import {
  SWITCH_BUTTONS,
  SWITCH_TARGETS,
  defaultSwitchProfile,
  type SwitchInput,
  type SwitchButton,
  type SwitchAxis,
  type SwitchTarget,
} from "../media/switch";
import { labels as switchLabels, physical, keyName, xboxLabels } from "../lib/switch-labels";
import { SWITCH_PRO, XBOX_360 } from "../lib/padmap";
import { consoleName } from "../lib/consoles";
import { deviceLabel } from "../lib/faces";
import { PadMapView } from "./PadMap";
import { usePreparationPro } from "./Preparation";

export function SwitchBindings({
  source,
  input,
  pending,
  game,
  send,
  close,
}: {
  source: SwitchInput;
  input: InputStream;
  pending: Preparation | null;
  game?: Game | null;
  send: (action: Record<string, unknown>) => Promise<void>;
  close: () => void;
}) {
  const [, refresh] = useState(0);
  const [name, setName] = useState("");
  // Le profil en service: un profil enregistré identique, "" pour le profil par
  // défaut, null pour des réglages modifiés et pas enregistrés.
  const same = (a: unknown) => JSON.stringify(a) === JSON.stringify(source.profile);
  const active =
    Object.keys(source.named).find((n) => same(source.named[n])) ??
    (same(defaultSwitchProfile()) ? "" : null);
  const [chosen, setChosen] = useState(active ?? "");
  const [notice, setNotice] = useState("");
  const pad = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const preparation = usePreparationPro({
    pending,
    game,
    input,
    send,
    capture: Boolean(source.capturing),
    dire: setNotice,
  });
  const ready = preparation.pret;
  const vue = preparation.vue;
  const edit = (change: () => void) => {
    try {
      change();
      setNotice("");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Réglage refusé.");
    }
    refresh((n) => n + 1);
  };
  useEffect(() => {
    dialog.current?.showModal();
    input.blockGameplay(true);
    const timer = window.setInterval(() => refresh((n) => n + 1), 500);
    let frame = 0;
    const paint = () => {
      if (!input.switchActive()) source.poll(new Set(), navigator.getGamepads?.() ?? []);
      // Le même dessin que les autres manettes : la boucle ne pose que l'état
      // allumé et l'inclinaison des sticks, React ne repeint jamais.
      for (const button of SWITCH_BUTTONS) {
        pad.current
          ?.querySelector(`[data-part="${button}"]`)
          ?.setAttribute(
            "data-lit",
            source.reading.buttons & (1 << SWITCH_BUTTONS.indexOf(button)) ? "oui" : "non",
          );
      }
      for (const [stick, axis] of [
        ["LS", "l"],
        ["RS", "r"],
      ] as const) {
        const body = pad.current?.querySelector<SVGGElement>(
          `[data-part="${stick}"] .n3-stick-body`,
        );
        const travel = Number(body?.dataset.drive ?? 0);
        body?.setAttribute(
          "transform",
          `translate(${(source.reading[`${axis}x`] * travel).toFixed(2)} ${(-source.reading[`${axis}y`] * travel).toFixed(2)})`,
        );
      }
      frame = requestAnimationFrame(paint);
    };
    frame = requestAnimationFrame(paint);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(frame);
      source.cancel();
      source.releaseBeforePlay();
      input.blockGameplay(false);
    };
  }, [input, source]);
  useEffect(() => {
    if (ready) source.cancel();
  }, [ready, source]);
  const device = source.device();
  const guide = game?.guide;
  // Une salle Xbox 360 parle la même trame que la Switch, avec ses propres
  // lettres et sa propre manette: A en bas, LB et LT, Back et Start.
  const xbox = game?.console === "x360";
  const labels = xbox ? xboxLabels : switchLabels;
  /** Le nom de la console et de sa manette, lus dans le manifeste et la table
   * des faces. Ils étaient écrits « Switch · manette Pro » pour toutes les
   * salles Pro, Xbox 360 comprise (audit T03, 22 novembre 2026). */
  const nomConsole = consoleName(game?.console) ?? (xbox ? "Xbox 360" : "Switch");
  const nomManette = deviceLabel(4, game?.console) ?? (xbox ? "manette Xbox 360" : "manette Pro");
  const binding = (target: SwitchTarget) => {
    const value = SWITCH_BUTTONS.includes(target as SwitchButton)
      ? device?.buttons[target as SwitchButton]
      : device?.sticks[target.slice(0, 2) as SwitchAxis];
    if (!value) return "Non assigné";
    return "button" in value
      ? ((source.pad?.mapping === "standard" ? physical[value.button] : undefined) ??
          `Bouton ${value.button}`)
      : `Axe ${value.axis}${"sign" in value && value.sign < 0 ? " · inversé" : ""}`;
  };
  return (
    <dialog
      ref={dialog}
      className="n3-switch-setup"
      aria-label={`Touches et manettes ${nomConsole}`}
      onCancel={(e) => {
        e.preventDefault();
        if (source.capturing) edit(() => source.cancel());
        else if (!vue) close();
      }}
    >
      <header>
        <div>
          <span className="n3-eyebrow">{vue ? vue.surtitre : `${nomConsole} · ${nomManette}`}</span>
          <h2>{vue ? vue.titre : "Touches et manettes"}</h2>
        </div>
        {vue ? vue.annuler : <button onClick={close}>Reprendre</button>}
      </header>
      <div className="n3-switch-body">
        {vue?.joueurs}
        <fieldset disabled={ready || preparation.occupe}>
          <label>
            Manette physique{" "}
            <select
              disabled={!source.pads.length}
              value={source.selected ?? "auto"}
              onChange={(e) =>
                edit(() => {
                  source.cancel();
                  source.selected = e.target.value === "auto" ? null : Number(e.target.value);
                })
              }
            >
              <option value="auto">
                {source.pads.length ? "Première manette détectée" : "Aucune manette détectée"}
              </option>
              {source.pads.map((p) => (
                <option key={p.index} value={p.index}>
                  {p.index + 1} · {p.id}
                </option>
              ))}
            </select>
          </label>
          <p>
            {source.pad
              ? `${source.pad.id}${device ? "" : " · disposition inconnue, assigne les commandes ci-dessous"}`
              : "Clavier disponible. Branche une manette et appuie sur un bouton pour la détecter."}
          </p>
          <div className="n3-switch-preview">
            <div ref={pad} className="n3-switch-pad">
              <PadMapView
                map={xbox ? XBOX_360 : SWITCH_PRO}
                title={xbox ? "Ce que la Xbox 360 reçoit" : "Ce que la Switch reçoit"}
                note={xbox ? "manette Xbox 360" : "manette Pro"}
              />
            </div>
            <div
              tabIndex={0}
              className="n3-switch-keytest"
              role="group"
              aria-label="Zone de test du clavier"
              onKeyDown={(e) => {
                if (!source.capturing && source.handlesKey(e.code)) {
                  e.preventDefault();
                  source.previewKeys.add(e.code);
                }
              }}
              onKeyUp={(e) => source.previewKeys.delete(e.code)}
              onBlur={() => source.previewKeys.clear()}
            >
              Clique ici et teste tes touches.
              <br />
              Les commandes restent dans ce panneau.
            </div>
          </div>
          <section aria-label={`Mes profils ${nomConsole}`}>
            <h3>Mes profils {nomConsole}</h3>
            <p>
              Conservés avec tes réglages personnels. Sans identité, ils restent dans ce navigateur.
            </p>
            <div className="n3-switch-actions">
              <label>
                Nom <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              <button
                onClick={() =>
                  edit(() => {
                    source.save(name);
                    source.message =
                      "Profil enregistré. Il rejoint tes réglages personnels dès que la salle répond.";
                  })
                }
              >
                Enregistrer
              </button>
              <label>
                Profil{" "}
                <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  <option value="">Profil par défaut</option>
                  {Object.keys(source.named).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button onClick={() => edit(() => (chosen ? source.load(chosen) : source.reset()))}>
                Charger
              </button>
              <small>
                En service : {active === "" ? "Profil par défaut" : (active ?? "réglages modifiés")}
              </small>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(source.profile, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `nel3ab-profil-${game?.console ?? "switch"}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                Exporter
              </button>
              <button onClick={() => file.current?.click()}>Importer</button>
              <input
                hidden
                ref={file}
                type="file"
                accept=".json"
                onChange={async (e) => {
                  const selected = e.target.files?.[0];
                  if (selected) {
                    if (selected.size > 100000) setNotice("Fichier trop grand.");
                    else {
                      const text = await selected.text();
                      edit(() => source.import(text));
                    }
                  }
                  e.target.value = "";
                }}
              />
            </div>
          </section>
          <details open>
            <summary>Toutes les correspondances</summary>
            <p>
              Clique pour réassigner. Actionne le stick dans la direction indiquée. Échap annule.
            </p>
            <div className="n3-switch-binding n3-switch-heads" aria-hidden="true">
              <span />
              <span>Clavier</span>
              {source.pad ? <span>Manette</span> : null}
            </div>
            {SWITCH_TARGETS.map((target) => (
              <div
                className="n3-switch-binding"
                key={target}
                data-waiting={source.capturing?.target === target}
              >
                <strong>
                  {labels[target]}
                  {guide?.actions["4"]?.[target] ? (
                    <small>{guide.actions["4"][target]}</small>
                  ) : null}
                </strong>
                {(source.pad ? (["key", "pad"] as const) : (["key"] as const)).map((kind) => (
                  <div key={kind}>
                    <button onClick={() => edit(() => source.begin(target, kind))}>
                      {source.capturing?.target === target && source.capturing.source === kind
                        ? "Actionne la commande…"
                        : kind === "key"
                          ? keyName(source.profile.keys[target])
                          : binding(target)}
                    </button>
                    <button
                      aria-label={`Effacer ${kind === "key" ? "la touche" : "la commande"} ${labels[target]}`}
                      onClick={() => edit(() => source.clear(target, kind))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </details>
          <details>
            <summary>Diagnostic des boutons et des axes</summary>
            <pre>
              {JSON.stringify({ physique: source.raw, commandes: source.reading }, null, 2)}
            </pre>
          </details>
          {guide ? (
            <p>
              {guide.note}{" "}
              <a href={guide.source} target="_blank" rel="noreferrer">
                Commandes du jeu
              </a>
            </p>
          ) : null}
          {/* Ce que la trame Pro ne porte pas: seize boutons et quatre axes,
              ni HOME, ni Capture, ni gyroscope (`media/switch.ts`), et donc ni
              le bouton Guide d'une manette Xbox 360. Une phrase sur la Switch
              lue dans une salle Xbox nommait des boutons qui n'y existent pas. */}
          <p>
            {xbox
              ? "Le bouton Guide n'est pas disponible."
              : "Home, Capture et le gyroscope ne sont pas disponibles."}
          </p>
        </fieldset>
        <p role="status">{notice || source.message}</p>
      </div>
      {vue?.pied}
    </dialog>
  );
}
