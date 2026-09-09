/** Les commandes personnelles se règlent ici, indépendamment de la salle. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { NAME_MAX, ROOM_MARK } from "../lib/keys";
import { describePad, identityOf, keyLabel, keyboardLayout, keysFor } from "../media/describe";
import { identify } from "../media/families";
import { controlsFor, isStick, type ControlKey } from "../media/pad";
import type { InputState } from "../media/input";
import { EMULATED } from "../lib/padmap";
import type { Pad } from "../lib/saves";
import { Bench } from "./Bench";
import { Wiring } from "./Wiring";
import { KeyboardWiring } from "./KeyboardWiring";

export type BindingsProps = {
  preparation?: ReactNode;
  profiles?: ReactNode;
  readOnly?: boolean;
  actions?: Record<string, string>;
  console: string;
  held: Pad;
  state: InputState;
  onPickKeys: (name: string) => void;
  onNewKeys: (name: string) => void;
  onForgetKeys: (name: string) => void;
  onPublish?: (name: string) => Promise<boolean>;
  onCapture: (control: ControlKey, source: "pad" | "key", sign?: 1 | -1) => void;
  onUse: (index: number | null) => void;
  onCancel: () => void;
  onLearn: () => void;
  onSkip: () => void;
  onResetPad: () => void;
  onResetKeys: () => void;
  onClose: () => void;
};

export function Bindings({
  preparation,
  profiles,
  readOnly = false,
  actions,
  console,
  held,
  state,
  onPickKeys,
  onNewKeys,
  onForgetKeys,
  onPublish,
  onCapture,
  onUse,
  onCancel,
  onLearn,
  onSkip,
  onResetPad,
  onResetKeys,
  onClose,
}: BindingsProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLElement>(null);
  const identity = identityOf(state);
  const physical = state.pads.find((one) => one.index === state.using);
  const [tab, setTab] = useState<"pad" | "key" | "profiles">("pad");
  const [selected, setSelected] = useState<ControlKey>("A");
  const [looking, setLooking] = useState<Pad>(console === "wii" ? held : 0);
  const [layout, setLayout] = useState<Map<string, string> | null>(null);
  const [naming, setNaming] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [reset, setReset] = useState<"pad" | "key" | null>(null);
  const [notice, setNotice] = useState("");
  const [publishing, setPublishing] = useState(false);
  const busy = state.capturing !== null || state.lesson !== null;
  const controls = controlsFor("wii", looking);
  const chosen = state.lesson?.control ?? state.capturing?.control ?? selected;
  const command = controls.find((one) => one.key === chosen)!;
  const locked = state.lockedProfiles.includes(state.keyProfile);
  const ownCount = state.keyProfiles.filter((name) => !state.lockedProfiles.includes(name)).length;
  const name = naming.trim();
  const nameError = !name
    ? "Donne un nom à la copie."
    : state.keyProfiles.includes(name)
      ? "Ce nom existe déjà."
      : name.startsWith(ROOM_MARK)
        ? "Ce préfixe est réservé à la salle."
        : "";
  const capture = (key: ControlKey, source: "pad" | "key", sign: 1 | -1 = 1) => {
    setNotice("");
    setSelected(key);
    onCapture(key, source, sign);
  };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.showModal();
    panel?.querySelector<HTMLElement>(".n3-preparation select")?.focus();
    return () => {
      panel?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void keyboardLayout().then((found) => {
      if (alive) setLayout(found);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (busy) editor.current?.scrollIntoView({ block: "nearest" });
  }, [busy]);
  useEffect(() => setLooking(console === "wii" ? held : 0), [console, held]);

  const keyCell = (key: ControlKey, label: string, sign: 1 | -1 = 1) => {
    const capturing =
      state.capturing?.control === key &&
      state.capturing.source === "key" &&
      (state.capturing.sign ?? 1) === sign;
    const what = keysFor(state.keys, key, sign)
      .map((code) => keyLabel(code, layout))
      .join(" ou ");
    return (
      <button
        type="button"
        id={`key-${key}${sign === -1 ? "-negative" : ""}`}
        className="n3-binding-cell"
        data-capturing={capturing}
        aria-label={`Modifier ${label} au clavier`}
        disabled={busy && !capturing}
        onClick={() => capture(key, "key", sign)}
      >
        <span>{capturing ? "Appuie sur une touche…" : what || "Non assigné"}</span>
        <span aria-hidden="true">↗</span>
      </button>
    );
  };

  return (
    <dialog
      ref={dialog}
      id="bindingsPanel"
      className="n3-bindings"
      aria-labelledby="bindingsTitle"
      onCancel={(event) => {
        event.preventDefault();
        if (busy) onCancel();
        else onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="n3-bindings-frame" data-preparing={Boolean(preparation)}>
        <header className="n3-bindings-header">
          <div>
            <span className="n3-eyebrow">À ta façon</span>
            <h2 id="bindingsTitle">Touches et manettes</h2>
            <p>
              {preparation
                ? "Prépare tes commandes avant le lancement."
                : "Teste tes commandes et trouve la disposition qui te convient."}
            </p>
          </div>
          <button
            type="button"
            id="closeBindings"
            hidden={Boolean(preparation)}
            onClick={onClose}
            className="n3-close"
            aria-label="Fermer les touches et manettes"
          >
            ×
          </button>
        </header>
        <div className="n3-bindings-scroll">
          {preparation}
          <fieldset disabled={readOnly} className="n3-bindings-fields">
            <nav className="n3-bindings-tabs" aria-label="Configuration des commandes">
              {(
                [
                  ["pad", "Manette"],
                  ["key", "Clavier"],
                  ["profiles", "Profils"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  id={id === "pad" ? "view-schema" : id === "key" ? "view-table" : "view-profiles"}
                  aria-pressed={tab === id}
                  disabled={busy}
                  onClick={() => {
                    setTab(id);
                    if (id === "key") setLooking(console === "wii" ? held : 0);
                    setReset(null);
                    setPreparing(false);
                    setNotice("");
                  }}
                >
                  {label}
                </button>
              ))}
              <span className="n3-bindings-local">Réglages personnels</span>
            </nav>

            <div className="n3-bindings-content">
              {tab === "pad" ? (
                <>
                  <div className="n3-device-row">
                    <div className="min-w-0">
                      <span className={cn("n3-status-dot", identity && "connected")} />
                      {state.pads.length > 1 ? (
                        <select
                          aria-label="Manette à configurer"
                          value={state.using ?? ""}
                          disabled={busy}
                          onChange={(event) => onUse(Number(event.target.value))}
                        >
                          {state.pads.map((one) => (
                            <option value={one.index} key={one.index}>
                              {identify(one.id, "").name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <strong>{identity?.name ?? "Aucune manette détectée"}</strong>
                      )}
                      <p>
                        {identity
                          ? state.profile
                            ? "Correspondances personnalisées"
                            : identity.standard
                              ? "Prête à jouer · disposition du navigateur"
                              : "Adaptateur à configurer"
                          : "Branche-la puis appuie sur un bouton."}
                      </p>
                    </div>
                    <button
                      type="button"
                      id="learnPad"
                      className="n3-action primary"
                      disabled={!identity || busy}
                      onClick={() => setPreparing(true)}
                    >
                      Configuration guidée
                    </button>
                  </div>
                  {preparing && !busy ? (
                    <div className="n3-capture-banner" role="status">
                      <div>
                        <strong>Pose ta manette au repos.</strong>
                        <p>
                          Relâche les boutons, sticks et gâchettes. La configuration actuelle reste
                          disponible si tu annules.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="n3-action primary"
                        disabled={!identity}
                        onClick={() => {
                          setPreparing(false);
                          setLooking(console === "wii" ? held : 0);
                          onLearn();
                        }}
                      >
                        Commencer
                      </button>
                      <button
                        type="button"
                        className="n3-action"
                        onClick={() => setPreparing(false)}
                      >
                        Annuler
                      </button>
                    </div>
                  ) : null}
                  <div className="n3-workbench" data-busy={busy}>
                    <div className="min-w-0">
                      <div className="n3-reading-choice">
                        {console === "wii" ? (
                          <>
                            <label htmlFor="reading">Lecture des commandes</label>
                            <select
                              id="reading"
                              value={looking}
                              disabled={busy || Boolean(preparation)}
                              onChange={(event) => setLooking(Number(event.target.value) as Pad)}
                            >
                              {EMULATED.map((map, at) => (
                                <option key={map.id} value={at}>
                                  {map.name}
                                </option>
                              ))}
                            </select>
                            <span>
                              {preparation ? "ton choix" : looking === held ? "en salle" : "aperçu"}
                            </span>
                          </>
                        ) : (
                          <strong>Manette GameCube</strong>
                        )}
                      </div>
                      <Wiring
                        state={state}
                        pad={looking}
                        selected={chosen}
                        onSelect={(key) => {
                          if (!busy) {
                            setSelected(key);
                            editor.current?.scrollIntoView({ block: "nearest" });
                          }
                        }}
                      />
                    </div>
                    <aside
                      ref={editor}
                      className="n3-command-editor"
                      aria-label="Commande sélectionnée"
                    >
                      <span className="n3-eyebrow">
                        {state.lesson
                          ? `Étape ${state.lesson.step} sur ${state.lesson.total}`
                          : "Commande sélectionnée"}
                      </span>
                      <h3>{command.label}</h3>
                      {(looking === held ? actions?.[chosen] : undefined) ? (
                        <p className="n3-game-action">
                          <span>Dans le jeu</span>
                          <strong>{actions?.[chosen]}</strong>
                        </p>
                      ) : null}
                      {state.capturing?.source === "pad" ? (
                        <p role="status" className="n3-inline-capture">
                          {isStick(chosen)
                            ? `Pousse ${command.ask}.`
                            : "Appuie sur le bouton souhaité."}{" "}
                          <button type="button" onClick={onCancel}>
                            Annuler
                          </button>
                        </p>
                      ) : null}
                      {state.lesson ? (
                        <>
                          <progress
                            value={state.lesson.step - 1}
                            max={state.lesson.total}
                            aria-label="Progression de la configuration"
                          />
                          <p role="status">
                            {state.lesson.waiting
                              ? "Relâche avant de continuer."
                              : `Appuie sur ${state.learning}.`}
                          </p>
                          <button type="button" className="n3-action" onClick={onSkip}>
                            Passer cette commande
                          </button>
                          <button type="button" className="n3-action" onClick={onCancel}>
                            Annuler l’apprentissage
                          </button>
                        </>
                      ) : (
                        <>
                          <label htmlFor="command">Choisir une commande</label>
                          <select
                            id="command"
                            value={chosen}
                            disabled={busy}
                            onChange={(event) => setSelected(event.target.value as ControlKey)}
                          >
                            {controls.map((one) => (
                              <option value={one.key} key={one.key}>
                                {one.label}
                              </option>
                            ))}
                          </select>
                          <span className="n3-field-label">Assignée à ta manette</span>
                          <div className="n3-current-binding">
                            {describePad(state.profile, identity, chosen) ?? "Non assignée"}
                          </div>
                          <button
                            type="button"
                            id={`pad-${chosen}`}
                            className="n3-action primary"
                            disabled={!identity || busy}
                            onClick={() => capture(chosen, "pad")}
                          >
                            Modifier cette commande
                          </button>
                          <p>
                            {isStick(chosen)
                              ? `Pousse ${command.ask}. L’axe et son repos seront retenus.`
                              : "Clique sur modifier, puis appuie sur le bouton ou la gâchette souhaitée."}
                          </p>
                          <span className="n3-field-label">Équivalent au clavier</span>
                          <div className="n3-current-binding">
                            {keysFor(state.keys, chosen)
                              .map((key) => keyLabel(key, layout))
                              .join(" ou ") || "Non assigné"}
                          </div>
                        </>
                      )}
                      <p className="n3-editor-note">
                        {preparation
                          ? "Le dessin suit ta configuration pour ce jeu. Tes essais restent ici jusqu’au lancement."
                          : "Ce choix de dessin change les noms affichés. L’appareil présenté au jeu se règle dans le menu de la salle."}
                      </p>
                    </aside>
                  </div>
                  {state.capturing?.source === "pad" ? (
                    <div className="n3-capture-banner" role="status">
                      <div>
                        <strong>
                          {isStick(chosen)
                            ? `Pousse ${command.ask}.`
                            : `Appuie pour assigner « ${command.label} ».`}
                        </strong>
                        <p>Les commandes du jeu sont suspendues. Échap pour annuler.</p>
                      </div>
                      <button type="button" className="n3-action" onClick={onCancel}>
                        Annuler l’assignation
                      </button>
                    </div>
                  ) : null}
                  <details className="n3-diagnostics" open>
                    <summary>
                      Toutes les correspondances <span>{controls.length} commandes</span>
                    </summary>
                    <div className="n3-mapping-list">
                      {controls.map((one) => (
                        <button
                          type="button"
                          key={one.key}
                          disabled={busy}
                          onClick={() => setSelected(one.key)}
                          aria-pressed={selected === one.key}
                        >
                          <span>{one.label}</span>
                          <span>
                            {describePad(state.profile, identity, one.key) ?? "Non assignée"}
                          </span>
                        </button>
                      ))}
                    </div>
                  </details>
                  {physical ? (
                    <details className="n3-diagnostics">
                      <summary>
                        Diagnostic des boutons et des axes <span>valeurs en direct</span>
                      </summary>
                      <Bench
                        name={identity?.name ?? physical.id}
                        id={physical.id}
                        index={state.using}
                        layout={state.padLayout ?? "inconnue"}
                        buttons={physical.buttons}
                        axes={physical.axes}
                        className="pt-4"
                      />
                    </details>
                  ) : null}
                  <div className="n3-bindings-tools">
                    <span>
                      {state.pads.length > 1
                        ? "Toutes les manettes connectées jouent sur ta place. Le choix ci-dessus désigne celle à configurer."
                        : "Les correspondances de manette sont mémorisées par modèle."}
                    </span>
                    <button
                      type="button"
                      id="resetPad"
                      className="n3-action"
                      disabled={!identity || busy}
                      onClick={() => (identity?.standard ? setReset("pad") : setPreparing(true))}
                    >
                      {identity?.standard ? "Rétablir la manette" : "Reconfigurer l’adaptateur"}
                    </button>
                  </div>
                </>
              ) : null}

              {tab === "key" ? (
                <>
                  <div className="n3-device-row">
                    <div>
                      <strong>Profil clavier · {state.keyProfile}</strong>
                      <p>
                        {locked
                          ? "Une modification crée une copie personnelle de ce profil de salle."
                          : "Clique une touche, puis appuie sur celle que tu veux utiliser."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="n3-action"
                      disabled={busy}
                      onClick={() => setTab("profiles")}
                    >
                      Gérer les profils
                    </button>
                  </div>
                  <KeyboardWiring
                    profile={state.keys}
                    pad={looking}
                    layout={layout}
                    disabled={busy || readOnly}
                  />
                  <p className="text-[12px] leading-relaxed text-muted">
                    Le stick et la croix sont deux commandes différentes. Assigne séparément les
                    quatre directions du stick.
                    {looking === 1
                      ? " La croix de la Wiimote ne remplace pas le stick du Nunchuk."
                      : ""}
                  </p>
                  <table className="n3-key-table">
                    <thead>
                      <tr>
                        <th>Commande</th>
                        <th>Touche du clavier</th>
                        {actions ? <th>Dans le jeu</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {controls
                        .toSorted((a, b) => Number(isStick(b.key)) - Number(isStick(a.key)))
                        .flatMap((one) => {
                          const rows = [
                            <tr key={one.key}>
                              <td>{one.label}</td>
                              <td>{keyCell(one.key, one.label)}</td>
                              {actions ? <td>{actions[one.key] ?? "—"}</td> : null}
                            </tr>,
                          ];
                          if (isStick(one.key)) {
                            const label = one.label.replace("→", "←").replace("↑", "↓");
                            rows.push(
                              <tr key={`${one.key}-negative`}>
                                <td>{label === one.label ? `${label} · sens opposé` : label}</td>
                                <td>{keyCell(one.key, `${label} · sens opposé`, -1)}</td>
                                {actions ? <td>{actions[one.key] ?? "—"}</td> : null}
                              </tr>,
                            );
                          }
                          return rows;
                        })}
                    </tbody>
                  </table>
                  {physical ? (
                    <details className="n3-diagnostics">
                      <summary>
                        Diagnostic des boutons et des axes <span>valeurs en direct</span>
                      </summary>
                      <Bench
                        name={identity?.name ?? physical.id}
                        id={physical.id}
                        index={state.using}
                        layout={state.padLayout ?? "inconnue"}
                        buttons={physical.buttons}
                        axes={physical.axes}
                        className="pt-4"
                      />
                    </details>
                  ) : null}
                  <div className="n3-bindings-tools">
                    <span>
                      Une touche ne déclenche qu’une commande. Une réassignation la retire de son
                      ancienne commande.
                    </span>
                    <button
                      type="button"
                      id="resetKeys"
                      className="n3-action"
                      disabled={busy}
                      onClick={() => setReset("key")}
                    >
                      Rétablir le clavier
                    </button>
                  </div>
                </>
              ) : null}

              {tab === "profiles" ? (
                <div className="n3-profiles">
                  {profiles}
                  <div>
                    <span className="n3-eyebrow">Tes dispositions</span>
                    <h3>Profils du clavier</h3>
                    <p>
                      Garde plusieurs dispositions et passe de l’une à l’autre. Les correspondances
                      des manettes restent liées à leur modèle.
                    </p>
                  </div>
                  <label htmlFor="keyProfile">Profil actif</label>
                  <select
                    id="keyProfile"
                    value={state.keyProfile}
                    onChange={(event) => {
                      onPickKeys(event.target.value);
                      setNotice("");
                    }}
                  >
                    {state.keyProfiles.map((profileName) => (
                      <option key={profileName} value={profileName}>
                        {profileName}
                        {state.lockedProfiles.includes(profileName) ? " · référence" : ""}
                      </option>
                    ))}
                  </select>
                  <p>
                    {locked
                      ? "Référence de la salle. La modifier crée une copie à toi et préserve l’original."
                      : "Profil personnel. Tes changements s’appliquent immédiatement."}
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (nameError) return;
                      onNewKeys(name);
                      setNaming("");
                      setNotice(`Le profil « ${name} » est créé et actif.`);
                    }}
                  >
                    <label htmlFor="profileName">Créer une copie du profil actif</label>
                    <div className="flex gap-2">
                      <input
                        id="profileName"
                        value={naming}
                        maxLength={NAME_MAX}
                        placeholder="Ex. Mario Kart"
                        aria-describedby="profileNameHelp"
                        onChange={(event) => setNaming(event.target.value)}
                      />
                      <button
                        id="newKeys"
                        type="submit"
                        className="n3-action primary"
                        disabled={!!nameError}
                      >
                        Créer la copie
                      </button>
                    </div>
                    <p id="profileNameHelp">
                      {naming && nameError
                        ? nameError
                        : `Un nom unique, ${NAME_MAX} caractères maximum.`}
                    </p>
                  </form>
                  <div className="flex flex-wrap gap-2">
                    {!locked && ownCount > 1 ? (
                      <button
                        type="button"
                        id="forgetKeys"
                        className="n3-action"
                        onClick={() => {
                          onForgetKeys(state.keyProfile);
                          setNotice(`Le profil « ${state.keyProfile} » a été supprimé.`);
                        }}
                      >
                        Supprimer ce profil
                      </button>
                    ) : null}
                    {onPublish && !locked ? (
                      <button
                        type="button"
                        id="publishKeys"
                        className="n3-action"
                        disabled={publishing}
                        onClick={async () => {
                          setPublishing(true);
                          setNotice("");
                          try {
                            setNotice(
                              (await onPublish(state.keyProfile))
                                ? "Profil publié dans la salle."
                                : "Publication impossible. Tes réglages personnels sont conservés.",
                            );
                          } catch {
                            setNotice("Publication impossible. Réessaie quand le salon répond.");
                          } finally {
                            setPublishing(false);
                          }
                        }}
                      >
                        {publishing ? "Publication…" : "Publier dans la salle"}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {reset ? (
                <div className="n3-capture-banner" role="status">
                  <div>
                    <strong>Rétablir {reset === "pad" ? "la manette" : "le clavier"} ?</strong>
                    <p>
                      Les correspondances personnalisées seront remplacées par celles d’origine.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="n3-action primary"
                    id="confirmReset"
                    onClick={() => {
                      if (reset === "pad") onResetPad();
                      else onResetKeys();
                      setReset(null);
                      setNotice("Correspondances d’origine rétablies.");
                    }}
                  >
                    Rétablir
                  </button>
                  <button type="button" className="n3-action" onClick={() => setReset(null)}>
                    Annuler
                  </button>
                </div>
              ) : null}
              {notice ? (
                <p className="n3-bindings-notice" role="status">
                  {notice}
                </p>
              ) : null}
            </div>
          </fieldset>
        </div>
        <footer className="n3-bindings-footer">
          <span>
            {busy
              ? "Assignation en cours · aucune commande envoyée au jeu"
              : preparation
                ? "Teste tes commandes, puis confirme avec « Je suis prêt »."
                : "Appliqué dans ce navigateur · aucun redémarrage de la partie"}
          </span>
          {state.capturing?.source === "key" ? (
            <button type="button" className="n3-action" onClick={onCancel}>
              Annuler l’assignation
            </button>
          ) : (
            <button
              type="button"
              className="n3-action"
              onClick={onClose}
              hidden={Boolean(preparation)}
            >
              {busy ? "Annuler et fermer" : "Terminé"}
            </button>
          )}
        </footer>
      </div>
    </dialog>
  );
}
