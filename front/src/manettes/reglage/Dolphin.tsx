/** La trame Dolphin dans le panneau : la manette, le clavier et les profils
 * du clavier. La même trame part toujours ; GameCube, Wiimote et guitare en
 * sont trois lectures (`docs/ecran-manettes.md`). La gauche des dessins lit
 * `readPad`, la droite `heldOn` : ne jamais faire passer l'une par l'autre. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { REGLAGE } from "../../lib/mots";
import { NAME_MAX, ROOM_MARK } from "../../lib/keys";
import { EMULATED } from "../../lib/padmap";
import type { Pad } from "../../lib/saves";
import { describePad, identityOf, keyLabel, keyboardLayout, keysFor } from "../../media/describe";
import { identify } from "../../media/families";
import type { InputState, InputStream } from "../../media/input";
import { controlsFor, isStick, type ControlKey, type KeyProfile } from "../../media/pad";
import { Bench } from "../../components/Bench";
import { KeyboardWiring } from "../../components/KeyboardWiring";
import { Wiring } from "../../components/Wiring";
import {
  AvantLePas,
  Bouton,
  Correspondances,
  type Envoi,
  Fin,
  EnAttente,
  PasAPas,
  Supprime,
  Suspension,
  type Ligne,
} from "./PasAPas";
import { IconeRang } from "../../components/Colonne";
import { tenirDessins } from "./inscriptions";
import { pieceDe, poserMarques } from "./marques";
import { useHorsDeVue, Vignette } from "./Vignette";

export type EntreeDolphin = Pick<
  InputStream,
  | "beginCapture"
  | "cancelCapture"
  | "beginLesson"
  | "skipLessonStep"
  | "reprendreLecon"
  | "oublierSuspension"
  | "useP"
  | "resetPad"
  | "resetKeys"
  | "pickKeys"
  | "newKeys"
  | "forgetKeys"
  | "keyProfileNamed"
  | "rendreKeys"
  | "surReglage"
>;

export type TrameDolphin = {
  genre: "dolphin";
  /** « gc » ou « wii » : nomme les commandes. */
  console: string;
  /** L'appareil que la salle présente au jeu pour cette place. */
  tenue: Pad;
  /** Ce que fait chaque commande dans le jeu, quand la fiche le sait. */
  actions?: Record<string, string>;
  state: InputState;
  input: EntreeDolphin;
  /** Relit l'instantané après un geste (le panneau ne l'attend pas). */
  refresh: () => void;
  publier?: (nom: string) => Promise<boolean>;
  /** « Mes profils » complets (`SetupProfiles`), posés par la salle. */
  profils?: ReactNode;
  envoi?: Envoi;
};

/** Le geste, puis la relecture de l'instantané. */
const agir = (trame: TrameDolphin, geste: (input: EntreeDolphin) => void) => {
  geste(trame.input);
  trame.refresh();
};

/** Le focus sur « Changer » d'une ligne, après le rendu qui la remontre. */
const viserLigne = (prefixe: string, cle: string) =>
  requestAnimationFrame(() => document.getElementById(`${prefixe}-${cle}`)?.focus());

export function ManetteDolphin({
  trame,
  plein = true,
}: {
  trame: TrameDolphin;
  /** Faux quand la bande d'état porte le seul bouton plein du panneau. */
  plein?: boolean;
}) {
  const { state, console, tenue, actions } = trame;
  const identity = identityOf(state);
  const physical = state.pads.find((one) => one.index === state.using);
  const occupe = state.capturing !== null || state.lesson !== null;
  const [vu, setVu] = useState<Pad>(console === "wii" ? tenue : 0);
  const [avant, setAvant] = useState(false);
  const [courante, setCourante] = useState<ControlKey | null>(null);
  const [retablir, setRetablir] = useState(false);
  const dessins = useRef<HTMLDivElement>(null);
  useEffect(() => setVu(console === "wii" ? tenue : 0), [console, tenue]);
  // Les marques du pas à pas suivent la boucle, hors de React.
  useEffect(() => {
    const racine = dessins.current;
    return racine ? poserMarques(racine, (ecoute) => trame.input.surReglage(ecoute)) : undefined;
  }, [trame.input]);
  // Le plancher de 9 px des inscriptions, à chaque dessin montré.
  useEffect(() => (dessins.current ? tenirDessins(dessins.current) : undefined), [vu, state.padId]);
  const controls = controlsFor("wii", vu);
  const nomDe = (key: string) => controls.find((one) => one.key === key)?.label ?? key;
  // Les actions du jeu suivent l'appareil de la place : un aperçu les cache.
  const actionsVues = vu === tenue ? actions : undefined;
  const lecon = state.lesson;
  const fin = state.lessonResult;
  const passee = fin?.passees[0];
  // Changer une ligne du bas fait défiler les dessins hors de la vue : la
  // ligne montre alors la pièce attendue (changement 12).
  const changee = state.capturing?.source === "pad" ? pieceDe(state.capturing.control) : null;
  const horsDeVue = useHorsDeVue(dessins, changee);
  const place =
    state.port === 1 || state.port === 2 || state.port === 3 || state.port === 4
      ? state.port
      : null;
  const lignes: Ligne[] = controls.map((one) => ({
    cle: one.key,
    nom: one.label,
    sous: actionsVues?.[one.key],
    valeur: (identity && describePad(state.profile, identity, one.key)) || REGLAGE.rien,
    enCours: state.capturing?.control === one.key && state.capturing.source === "pad",
    attente: isStick(one.key) ? REGLAGE.pousse(one.ask) : REGLAGE.attendManette,
    vignette:
      horsDeVue && changee === pieceDe(one.key) ? (
        <Vignette map={EMULATED[vu]!} piece={changee} place={place} />
      ) : undefined,
  }));

  return (
    <>
      {state.suspendu ? (
        <Suspension
          etape={state.suspendu.etape}
          onReprendre={() => agir(trame, (input) => input.reprendreLecon())}
          onDaccord={() => agir(trame, (input) => input.oublierSuspension())}
        />
      ) : null}
      {lecon ? (
        <PasAPas
          etape={lecon.step}
          total={lecon.total}
          attendRelache={lecon.waiting}
          consigne={
            isStick(lecon.control)
              ? REGLAGE.pousse(controls.find((one) => one.key === lecon.control)?.ask ?? "")
              : REGLAGE.appuie(nomDe(lecon.control))
          }
          action={actionsVues?.[lecon.control]}
          onPasser={() => agir(trame, (input) => input.skipLessonStep())}
          onArreter={() => agir(trame, (input) => input.cancelCapture())}
        />
      ) : (
        <div className="n3-appareil" data-appareil="">
          {identity ? (
            <div>
              {state.pads.length > 1 ? (
                <label>
                  {REGLAGE.tuRegles}{" "}
                  <select
                    value={state.using ?? ""}
                    disabled={occupe}
                    onChange={(event) =>
                      agir(trame, (input) => input.useP(Number(event.target.value)))
                    }
                  >
                    {state.pads.map((one) => (
                      <option value={one.index} key={one.index}>
                        {identify(one.id, "").name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <strong className="rt-titre">
                  <IconeRang nom="manette" /> {identity.name}
                </strong>
              )}
              <p>{identity.standard ? REGLAGE.standard : REGLAGE.nonStandard}</p>
              {identity.standard ? null : <p>{REGLAGE.adaptateur}</p>}
              {state.pads.length > 1 ? (
                <p>{REGLAGE.plusieurs(state.pads.length, state.port)}</p>
              ) : null}
            </div>
          ) : (
            <div>
              <p>{REGLAGE.aucune}</p>
              <p>{REGLAGE.branche}</p>
            </div>
          )}
          {identity && !avant ? (
            <Bouton plein={plein} id="learnPad" disabled={occupe} onClick={() => setAvant(true)}>
              {REGLAGE.regler}
            </Bouton>
          ) : null}
        </div>
      )}
      {avant && !lecon ? (
        <AvantLePas
          onAnnuler={() => setAvant(false)}
          onCommencer={() => {
            setAvant(false);
            setVu(console === "wii" ? tenue : 0);
            agir(trame, (input) => input.beginLesson(console, tenue));
          }}
        />
      ) : null}
      {!lecon && fin ? (
        <Fin
          texte={REGLAGE.fin(fin.retenues, fin.passees.map(nomDe), fin.garde)}
          passee={passee ? { cle: passee, nom: nomDe(passee) } : null}
          onRegler={(cle) => {
            setCourante(cle as ControlKey);
            viserLigne("pad", cle);
          }}
        />
      ) : null}
      {console === "wii" && !lecon ? (
        <fieldset className="n3-lecture">
          <legend>{REGLAGE.lecture}</legend>
          {EMULATED.map((map, at) => (
            <Bouton
              key={map.id}
              aria-pressed={vu === at}
              disabled={occupe}
              onClick={() => setVu(at as Pad)}
            >
              {map.name}
              {at === tenue ? ` (${REGLAGE.taPlace})` : ""}
            </Bouton>
          ))}
          {vu === tenue ? null : <p>{REGLAGE.apercu(EMULATED[tenue]!.name)}</p>}
        </fieldset>
      ) : null}
      <div ref={dessins} className="n3-dessins">
        <Wiring
          state={state}
          pad={vu}
          selected={lecon?.control ?? state.capturing?.control ?? courante ?? "A"}
          onSelect={(key) => {
            if (occupe) return;
            setCourante(key);
            document.querySelector(`tr[data-cle="${key}"]`)?.scrollIntoView({ block: "nearest" });
          }}
        />
      </div>
      {lecon ? null : (
        <>
          <h3>{REGLAGE.correspondances}</h3>
          <Correspondances
            titre={REGLAGE.correspondances}
            colonne={REGLAGE.taManette}
            lignes={lignes}
            prefixe="pad"
            courante={courante}
            inactif={!identity || occupe}
            onChanger={(cle) => {
              setCourante(cle as ControlKey);
              agir(trame, (input) => input.beginCapture(cle as ControlKey, "pad"));
            }}
            onAnnuler={() => agir(trame, (input) => input.cancelCapture())}
          />
          {physical ? (
            <details className="n3-nombres">
              <summary className="rt-titre">{REGLAGE.nombres}</summary>
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
          <Retablir
            quoi="pad"
            ouvert={retablir}
            inactif={!identity || occupe}
            onOuvrir={setRetablir}
            onRetablir={() => agir(trame, (input) => input.resetPad(console, tenue))}
          />
        </>
      )}
    </>
  );
}

/** « Rétablir », toujours confirmé : il remplace des changements. */
function Retablir({
  quoi,
  ouvert,
  inactif,
  onOuvrir,
  onRetablir,
}: {
  quoi: "pad" | "key";
  ouvert: boolean;
  inactif: boolean;
  onOuvrir: (ouvert: boolean) => void;
  onRetablir: () => void;
}) {
  const [fait, setFait] = useState(false);
  if (!ouvert)
    return (
      <div className="n3-reglage-gestes">
        <Bouton
          id={quoi === "pad" ? "resetPad" : "resetKeys"}
          disabled={inactif}
          onClick={() => {
            setFait(false);
            onOuvrir(true);
          }}
        >
          {quoi === "pad" ? REGLAGE.retablirManette : REGLAGE.retablirClavier}
        </Bouton>
        {fait ? <p role="status">{REGLAGE.retabli}</p> : null}
      </div>
    );
  return (
    <div className="n3-reglage-avis" role="status">
      <p>{REGLAGE.retablirQuestion(quoi)}</p>
      <div className="n3-reglage-gestes">
        <Bouton
          plein
          id="confirmReset"
          onClick={() => {
            onRetablir();
            setFait(true);
            onOuvrir(false);
          }}
        >
          {REGLAGE.retablir}
        </Bouton>
        <Bouton onClick={() => onOuvrir(false)}>{REGLAGE.annuler}</Bouton>
      </div>
    </div>
  );
}

/** Le clavier : l'essai en face du dessin, puis la table. Toujours sur
 * l'appareil de la place. */
export function ClavierDolphin({ trame }: { trame: TrameDolphin }) {
  const { state, tenue } = trame;
  const occupe = state.capturing !== null || state.lesson !== null;
  const [layout, setLayout] = useState<Map<string, string> | null>(null);
  const [retablir, setRetablir] = useState(false);
  useEffect(() => {
    let vivant = true;
    void keyboardLayout().then((trouve) => {
      if (vivant) setLayout(trouve);
    });
    return () => {
      vivant = false;
    };
  }, []);
  const lignes: Ligne[] = controlsFor("wii", tenue)
    .toSorted((a, b) => Number(isStick(b.key)) - Number(isStick(a.key)))
    .flatMap((one) => {
      const ligne = (sign: 1 | -1, nom: string): Ligne => ({
        cle: sign === 1 ? one.key : `${one.key}-`,
        nom,
        sous: trame.actions?.[one.key],
        valeur:
          keysFor(state.keys, one.key, sign)
            .map((code) => keyLabel(code, layout))
            .join(" ou ") || REGLAGE.rien,
        enCours:
          state.capturing?.control === one.key &&
          state.capturing.source === "key" &&
          (state.capturing.sign ?? 1) === sign,
        attente: REGLAGE.attendTouche,
      });
      if (!isStick(one.key)) return [ligne(1, one.label)];
      const oppose = one.label.replace("→", "←").replace("↑", "↓");
      return [
        ligne(1, one.label),
        ligne(-1, oppose === one.label ? REGLAGE.oppose(one.label) : oppose),
      ];
    });
  return (
    <>
      <KeyboardWiring profile={state.keys} pad={tenue} layout={layout} disabled={occupe} />
      <Correspondances
        titre={REGLAGE.correspondances}
        colonne={REGLAGE.touche}
        lignes={lignes}
        prefixe="key"
        inactif={occupe}
        onChanger={(cle) => {
          const sign = cle.endsWith("-") ? -1 : 1;
          agir(trame, (input) =>
            input.beginCapture(cle.replace(/-$/, "") as ControlKey, "key", sign),
          );
        }}
        onAnnuler={() => agir(trame, (input) => input.cancelCapture())}
      />
      <Retablir
        quoi="key"
        ouvert={retablir}
        inactif={occupe}
        onOuvrir={setRetablir}
        onRetablir={() => agir(trame, (input) => input.resetKeys())}
      />
    </>
  );
}

/** Les profils du clavier, sous « Mes profils » complets que la salle pose. */
export function ProfilsDolphin({ trame }: { trame: TrameDolphin }) {
  const { state, publier } = trame;
  const [nom, setNom] = useState("");
  const [avis, setAvis] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [parti, setParti] = useState<{ nom: string; profil: KeyProfile; actif: boolean } | null>(
    null,
  );
  const verrouille = state.lockedProfiles.includes(state.keyProfile);
  const siens = state.keyProfiles.filter((un) => !state.lockedProfiles.includes(un)).length;
  const propre = nom.trim();
  const faute = !propre
    ? "Donne un nom à la copie."
    : state.keyProfiles.includes(propre)
      ? "Ce nom existe déjà."
      : propre.startsWith(ROOM_MARK)
        ? "Ce préfixe est réservé à la salle."
        : "";
  return (
    <div className="n3-profils">
      <EnAttente envoi={trame.envoi} />
      {trame.profils}
      <h3>{REGLAGE.profilsClavier}</h3>
      <label htmlFor="keyProfile">{REGLAGE.enService}</label>
      <select
        id="keyProfile"
        value={state.keyProfile}
        onChange={(event) => {
          agir(trame, (input) => input.pickKeys(event.target.value));
          setAvis("");
        }}
      >
        {state.keyProfiles.map((un) => (
          <option key={un} value={un}>
            {un}
            {state.lockedProfiles.includes(un) ? ", référence de la salle" : ""}
          </option>
        ))}
      </select>
      <p>
        {verrouille
          ? "Référence de la salle. La modifier crée une copie à toi et garde l’original."
          : "Profil à toi. Tes changements s’appliquent tout de suite."}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (faute) return;
          agir(trame, (input) => input.newKeys(propre));
          setNom("");
          setAvis(`Le profil « ${propre} » est créé et en service.`);
        }}
      >
        <label htmlFor="profileName">{REGLAGE.enregistrer}</label>
        <input
          id="profileName"
          value={nom}
          maxLength={NAME_MAX}
          aria-describedby="profileNameHelp"
          onChange={(event) => setNom(event.target.value)}
        />
        <button
          id="newKeys"
          type="submit"
          className="rt-boite rt-bouton n3-reglage-bouton"
          disabled={!!faute}
        >
          <i className="rt-ombre" aria-hidden="true" />
          {REGLAGE.enregistrer}
        </button>
        <p id="profileNameHelp">
          {nom && faute ? faute : `Un nom unique, ${NAME_MAX} caractères au plus.`}
        </p>
      </form>
      <div className="n3-reglage-gestes">
        {!verrouille && siens > 1 ? (
          <Bouton
            id="forgetKeys"
            onClick={() => {
              const parte = state.keyProfile;
              const profil = trame.input.keyProfileNamed(parte);
              agir(trame, (input) => input.forgetKeys(parte));
              setAvis("");
              setParti(profil ? { nom: parte, profil, actif: true } : null);
            }}
          >
            {REGLAGE.supprimer}
          </Bouton>
        ) : null}
        {publier && !verrouille ? (
          <Bouton
            id="publishKeys"
            disabled={envoi}
            onClick={async () => {
              setEnvoi(true);
              setAvis("");
              try {
                setAvis(
                  (await publier(state.keyProfile))
                    ? "Profil publié dans la salle."
                    : "Publication impossible. Tes réglages à toi sont gardés.",
                );
              } catch {
                setAvis("Publication impossible. Réessaie dans un instant.");
              } finally {
                setEnvoi(false);
              }
            }}
          >
            {envoi ? "Publication…" : "Publier dans la salle"}
          </Bouton>
        ) : null}
      </div>
      {parti ? (
        <Supprime
          nom={parti.nom}
          onAnnuler={() => {
            agir(trame, (input) => input.rendreKeys(parti.nom, parti.profil, parti.actif));
            setParti(null);
          }}
        />
      ) : null}
      {avis ? <p role="status">{avis}</p> : null}
    </div>
  );
}
