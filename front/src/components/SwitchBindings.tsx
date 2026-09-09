/** Configuration edits render at reading speed. The live diagram paints from
 * the same SwitchInput state as gameplay, without React on its polling path. */
import { useEffect, useRef, useState } from "react";
import type { Game, Preparation } from "../client";
import type { InputStream } from "../media/input";
import {
  SWITCH_BUTTONS,
  SWITCH_TARGETS,
  type SwitchInput,
  type SwitchButton,
  type SwitchAxis,
  type SwitchTarget,
} from "../media/switch";
import { labels, physical, keyName } from "../lib/switch-labels";
import { slotLabel, type Slot } from "../lib/saves";

const spots: [SwitchButton, number, number, string][] = [
  ["A", 350, 132, "A"],
  ["B", 322, 160, "B"],
  ["X", 322, 104, "X"],
  ["Y", 294, 132, "Y"],
  ["L", 96, 44, "L"],
  ["R", 320, 44, "R"],
  ["ZL", 96, 18, "ZL"],
  ["ZR", 320, 18, "ZR"],
  ["MINUS", 173, 100, "−"],
  ["PLUS", 243, 100, "+"],
  ["LS", 99, 117, "L3"],
  ["RS", 264, 200, "R3"],
  ["UP", 155, 166, "▲"],
  ["DOWN", 155, 210, "▼"],
  ["LEFT", 133, 188, "◀"],
  ["RIGHT", 177, 188, "▶"],
];
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
  const [chosen, setChosen] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const me = pending?.players.find((p) => p.claim === input.attribution());
  const ready = me?.ready ?? false;
  const starter = pending?.starter === input.attribution();
  const allReady = Boolean(pending?.players.length && pending.players.every((p) => p.ready));
  const act = async (action: Record<string, unknown>) => {
    setBusy(true);
    setNotice("");
    try {
      await send({ ...action, id: pending?.id });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Le salon ne répond pas.");
    } finally {
      setBusy(false);
    }
  };
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
      for (const [button, x, y] of spots) {
        const element = svg.current?.querySelector(`[data-button="${button}"]`);
        element?.setAttribute(
          "data-lit",
          String(Boolean(source.reading.buttons & (1 << SWITCH_BUTTONS.indexOf(button)))),
        );
        const axis = button === "LS" ? "l" : button === "RS" ? "r" : null;
        if (axis)
          element?.setAttribute(
            "transform",
            `translate(${x + source.reading[`${axis}x`] * 10} ${y - source.reading[`${axis}y`] * 10})`,
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
      aria-label="Touches et manettes Switch"
      onCancel={(e) => {
        e.preventDefault();
        if (source.capturing) edit(() => source.cancel());
        else if (!pending) close();
      }}
    >
      <header>
        <div>
          <span className="n3-eyebrow">
            {pending ? "Avant de jouer · " : ""}Switch · manette Pro
          </span>
          <h2>{pending ? game?.name : "Touches et manettes"}</h2>
        </div>
        {!pending ? (
          <button onClick={close}>Reprendre</button>
        ) : starter ? (
          <button disabled={busy} onClick={() => void act({ action: "cancel" })}>
            Annuler le lancement
          </button>
        ) : null}
      </header>
      <div className="n3-switch-body">
        {pending ? (
          <section className="n3-preparation">
            <p>
              Sauvegarde : {slotLabel(pending.save as Slot)}. Chacun teste ses commandes, charge son
              profil puis confirme.
            </p>
            <div className="n3-preparation-players">
              {pending.players.map((p) => (
                <div key={p.claim} data-ready={p.ready}>
                  <span>P{p.port}</span>
                  <strong>{p.name ?? ""}</strong>
                  <small>{p.ready ? "Manette Pro · prêt" : "prépare ses commandes"}</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        <fieldset disabled={ready || busy}>
          <label>
            Manette physique{" "}
            <select
              value={source.selected ?? "auto"}
              onChange={(e) =>
                edit(() => {
                  source.cancel();
                  source.selected = e.target.value === "auto" ? null : Number(e.target.value);
                })
              }
            >
              <option value="auto">Première manette détectée</option>
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
            <svg
              ref={svg}
              viewBox="0 0 420 290"
              role="img"
              aria-label="Commandes interprétées pour la manette Pro"
            >
              <defs>
                <linearGradient id="n3-switch-case" x2=".2" y2="1">
                  <stop stopColor="#536580" />
                  <stop offset=".45" stopColor="#2d3c54" />
                  <stop offset="1" stopColor="#1b273a" />
                </linearGradient>
              </defs>
              <path
                d="M82 56Q48 57 36 93L13 230Q5 271 39 276Q56 279 76 253L114 222Q153 238 208 238Q262 238 301 222L341 258Q361 279 379 275Q415 269 406 231L382 95Q372 57 338 56Z"
                fill="url(#n3-switch-case)"
                stroke="#8b9cb4"
                strokeWidth="2"
              />
              <text x="210" y="157">
                nel3ab
              </text>
              {spots.map(([button, x, y, label]) => (
                <g key={button} data-button={button} transform={`translate(${x} ${y})`}>
                  <circle r={button === "LS" || button === "RS" ? 22 : 16} />
                  <text dy="5">{label}</text>
                </g>
              ))}
            </svg>
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
          <section aria-label="Mes profils Switch">
            <h3>Mes profils Switch</h3>
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
                      "Profil enregistré. La synchronisation personnelle reprend dès que le salon répond.";
                  })
                }
              >
                Enregistrer
              </button>
              <label>
                Profil{" "}
                <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
                  <option value="">Choisir…</option>
                  {Object.keys(source.named).map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button disabled={!chosen} onClick={() => edit(() => source.load(chosen))}>
                Charger
              </button>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(source.profile, null, 2)], {
                      type: "application/json",
                    }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "nel3ab-switch-profil.json";
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
                {(["key", "pad"] as const).map((kind) => (
                  <div key={kind}>
                    <button
                      disabled={kind === "pad" && !source.pad}
                      onClick={() => edit(() => source.begin(target, kind))}
                    >
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
                Commandes du jeu · Nintendo
              </a>
            </p>
          ) : null}
          <p>Home, Capture et le gyroscope ne sont pas disponibles.</p>
          <button onClick={() => edit(() => source.reset())}>Configuration d’origine</button>
        </fieldset>
        <p role="status">{notice || source.message}</p>
      </div>
      {pending ? (
        <footer>
          <button
            disabled={busy || Boolean(source.capturing)}
            onClick={() => void act({ action: "choose", pad: 4, ready: !ready })}
          >
            {ready ? "Modifier ma configuration" : "Je suis prêt"}
          </button>
          {starter ? (
            <button
              id="launchPrepared"
              disabled={busy || !allReady}
              onClick={() => void act({ action: "launch" })}
            >
              Lancer le jeu
            </button>
          ) : (
            <span>Le lancement attend la confirmation du chef.</span>
          )}
        </footer>
      ) : null}
    </dialog>
  );
}
