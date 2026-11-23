/** La trame Pro dans le panneau : Switch et Xbox 360 parlent la même trame
 * de quinze octets, seize boutons et quatre axes (`media/switch`). Le panneau
 * est celui de Dolphin ; seules la trame et ses mots changent.
 *
 * `SwitchInput` ne passe pas par l'instantané de la page : le panneau se relit
 * deux fois par seconde (règle 8), et les dessins se peignent hors de React. */
import { useEffect, useReducer, useRef, useState } from "react";
import type { Game } from "../../client";
import { REGLAGE } from "../../lib/mots";
import { SWITCH_PRO, XBOX_360, physicalMap } from "../../lib/padmap";
import { labels as switchLabels, physical, keyName, xboxLabels } from "../../lib/switch-labels";
import { paintPro } from "../../lib/wiring";
import { identify } from "../../media/families";
import type { InputStream } from "../../media/input";
import {
  SWITCH_BUTTONS,
  SWITCH_TARGETS,
  defaultSwitchProfile,
  type SwitchAxis,
  type SwitchButton,
  type SwitchInput,
  type SwitchTarget,
} from "../../media/switch";
import { PadMapView } from "../../components/PadMap";
import {
  AvantLePas,
  Bouton,
  Correspondances,
  Fin,
  PasAPas,
  Suspension,
  type Ligne,
} from "./PasAPas";
import { tenirDessins } from "./inscriptions";
import { poserMarques } from "./marques";

export type TramePro = {
  genre: "pro";
  /** Le nom de la console (« Switch », « Xbox 360 »), dit dans les phrases. */
  console: string;
  xbox: boolean;
  /** Le nom de la manette que le jeu reçoit (« manette Pro »). */
  manette: string;
  source: SwitchInput;
  input: Pick<InputStream, "switchActive">;
  guide?: Game["guide"];
  place: 1 | 2 | 3 | 4 | null;
};

/** « ZL · gâchette gauche » devient « ZL », et dessous « gâchette gauche » :
 * pas de point médian dans la table. */
const scinder = (texte: string): [string, string | undefined] => {
  const [nom, sous] = texte.split(" · ");
  return [nom ?? texte, sous];
};

const estBouton = (cible: SwitchTarget): cible is SwitchButton =>
  SWITCH_BUTTONS.includes(cible as SwitchButton);

/** Relit le panneau deux fois par seconde, et lit la manette tant que la
 * boucle de la partie ne le fait pas. Au départ, rien ne reste en cours :
 * un changement est annulé, et la trame attend que tout soit relâché. */
export function usePro(trame: TramePro | null): void {
  const [, relire] = useReducer((n: number) => n + 1, 0);
  const source = trame?.source;
  const input = trame?.input;
  useEffect(() => {
    if (!source || !input) return;
    const minuteur = window.setInterval(relire, 500);
    let frame = 0;
    const lire = () => {
      if (!input.switchActive()) source.poll(new Set(), navigator.getGamepads?.() ?? []);
      frame = requestAnimationFrame(lire);
    };
    frame = requestAnimationFrame(lire);
    return () => {
      clearInterval(minuteur);
      cancelAnimationFrame(frame);
      source.arreterLecon();
      source.releaseBeforePlay();
    };
  }, [source, input]);
}

/** Un geste sur la trame Pro : son refus se dit au lieu de lever. */
function useGeste(source: SwitchInput) {
  const [avis, setAvis] = useState("");
  const [, relire] = useReducer((n: number) => n + 1, 0);
  const geste = (change: () => void) => {
    try {
      change();
      setAvis("");
    } catch (e) {
      setAvis(e instanceof Error ? e.message : REGLAGE.refuse);
    }
    relire();
  };
  return { avis: avis || source.message, setAvis, geste };
}

function DessinsPro({ trame }: { trame: TramePro }) {
  const gauche = useRef<HTMLDivElement>(null);
  const droite = useRef<HTMLDivElement>(null);
  const { source } = trame;
  useEffect(() => {
    let frame = 0;
    const peindre = () => {
      if (gauche.current)
        paintPro(
          gauche.current,
          droite.current,
          source.reading,
          source.pad,
          source.device(),
          source.lecon?.repos ?? null,
        );
      frame = requestAnimationFrame(peindre);
    };
    frame = requestAnimationFrame(peindre);
    return () => cancelAnimationFrame(frame);
  }, [source]);
  const paire = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const racine = paire.current;
    return racine ? poserMarques(racine, (ecoute) => source.surLecon(ecoute)) : undefined;
  }, [source]);
  const pad = source.pad;
  const identite = pad ? identify(pad.id, pad.mapping) : null;
  useEffect(() => (paire.current ? tenirDessins(paire.current) : undefined), [identite?.name]);
  return (
    <div className="n3-controller-pair n3-dessins" ref={paire}>
      <div ref={gauche}>
        <PadMapView
          map={trame.xbox ? XBOX_360 : SWITCH_PRO}
          title={REGLAGE.recoit(trame.console)}
          note={trame.manette}
          place={trame.place}
          waiting={source.lecon?.demandee ?? source.capturing?.target ?? null}
        />
      </div>
      <div ref={droite}>
        <PadMapView
          map={physicalMap(identite)}
          title={REGLAGE.taManette}
          note={identite?.name ?? REGLAGE.rien}
          rawLabels={!identite?.standard}
          place={trame.place}
        />
      </div>
    </div>
  );
}

/** Les mots d'une cible : l'inscription, et ce qu'elle est ou fait. */
function nomsPro(trame: TramePro) {
  const libelles = trame.xbox ? xboxLabels : switchLabels;
  return (cible: SwitchTarget) => {
    const [nom, sous] = scinder(libelles[cible]);
    return { nom, sous: trame.guide?.actions["4"]?.[cible] ?? sous };
  };
}

export function ManettePro({ trame }: { trame: TramePro }) {
  const { source } = trame;
  const { avis, geste } = useGeste(source);
  const [avant, setAvant] = useState(false);
  const noms = nomsPro(trame);
  const pad = source.pad;
  const appareil = source.device();
  const identite = pad ? identify(pad.id, pad.mapping) : null;
  const lecon = source.lecon;
  const demandee = lecon?.demandee ?? null;
  const occupe = Boolean(source.capturing || lecon);
  const fin = source.resultat;
  const suspendu = source.suspendu;
  const valeur = (cible: SwitchTarget): string => {
    const entree = estBouton(cible)
      ? appareil?.buttons[cible]
      : appareil?.sticks[cible.slice(0, 2) as SwitchAxis];
    if (!entree) return REGLAGE.rien;
    return "button" in entree
      ? ((pad?.mapping === "standard"
          ? physical[entree.button]?.replaceAll(" · ", ", ")
          : undefined) ?? `${REGLAGE.bouton} ${entree.button}`)
      : `${REGLAGE.axe} ${entree.axis}${"sign" in entree && entree.sign < 0 ? `, ${REGLAGE.inverse}` : ""}`;
  };
  const ligne = (cible: SwitchTarget): Ligne => ({
    cle: cible,
    ...noms(cible),
    valeur: valeur(cible),
    enCours: source.capturing?.target === cible && source.capturing.source === "pad",
    attente: estBouton(cible) ? REGLAGE.attendManette : REGLAGE.pousse(noms(cible).nom),
  });
  const table = (cibles: readonly SwitchTarget[], titre: string, pied?: string) => (
    <Correspondances
      titre={titre}
      colonne={REGLAGE.taManette}
      lignes={cibles.map(ligne)}
      prefixe="pad"
      inactif={!pad || occupe}
      onChanger={(cle) => geste(() => source.begin(cle as SwitchTarget, "pad"))}
      onAnnuler={() => geste(() => source.cancel())}
      onEffacer={(cle) => geste(() => source.clear(cle as SwitchTarget, "pad"))}
      pied={pied}
    />
  );
  return (
    <>
      {suspendu ? (
        <Suspension
          etape={suspendu.etape}
          onReprendre={() => geste(() => source.reprendreLecon())}
          onDaccord={() => geste(() => source.oublierSuspension())}
        />
      ) : null}
      {lecon && demandee ? (
        <PasAPas
          etape={lecon.step + 1}
          total={lecon.total}
          attendRelache={lecon.waiting}
          consigne={
            estBouton(demandee)
              ? REGLAGE.appuie(noms(demandee).nom)
              : REGLAGE.pousse(REGLAGE.sensPro(demandee.startsWith("l"), demandee[1] === "y"))
          }
          action={trame.guide?.actions["4"]?.[demandee]}
          onPasser={() => geste(() => source.passerEtape())}
          onArreter={() => geste(() => source.arreterLecon())}
        />
      ) : (
        <div className="n3-appareil" data-appareil="">
          {identite ? (
            <div>
              {source.pads.length > 1 ? (
                <label>
                  {REGLAGE.tuRegles}{" "}
                  <select
                    value={pad?.index ?? ""}
                    disabled={occupe}
                    onChange={(event) =>
                      geste(() => {
                        source.cancel();
                        source.selected = Number(event.target.value);
                      })
                    }
                  >
                    {source.pads.map((un) => (
                      <option key={un.index} value={un.index}>
                        {identify(un.id, un.mapping).name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <strong className="rt-titre">{identite.name}</strong>
              )}
              <p>
                {(appareil?.standard ?? identite.standard) ? REGLAGE.standard : REGLAGE.nonStandard}
              </p>
              {appareil ? null : <p>{REGLAGE.adaptateur}</p>}
              {source.pads.length > 1 ? (
                <p>{REGLAGE.plusieurs(source.pads.length, trame.place)}</p>
              ) : null}
            </div>
          ) : (
            <div>
              <p>{REGLAGE.aucune}</p>
              <p>{REGLAGE.branche}</p>
            </div>
          )}
          {identite && !avant ? (
            <Bouton plein id="learnPad" disabled={occupe} onClick={() => setAvant(true)}>
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
            geste(() => source.commencerLecon());
          }}
        />
      ) : null}
      {!lecon && fin ? (
        <Fin
          texte={REGLAGE.fin(
            fin.retenues,
            fin.passees.map((cible) => noms(cible).nom),
            fin.garde,
          )}
          passee={fin.passees[0] ? { cle: fin.passees[0], nom: noms(fin.passees[0]).nom } : null}
          onRegler={(cle) =>
            requestAnimationFrame(() => document.getElementById(`pad-${cle}`)?.focus())
          }
        />
      ) : null}
      <DessinsPro trame={trame} />
      {lecon ? null : (
        <>
          <h3>{REGLAGE.correspondances}</h3>
          {table(SWITCH_BUTTONS, REGLAGE.correspondances)}
          <h3>{REGLAGE.sticks}</h3>
          {table(
            SWITCH_TARGETS.filter((cible) => !estBouton(cible)),
            REGLAGE.sticks,
            REGLAGE.nonTransmis(trame.xbox),
          )}
          {source.raw ? (
            <details className="n3-nombres">
              <summary className="rt-titre">{REGLAGE.nombres}</summary>
              <p>{pad?.id}</p>
              <pre>
                {JSON.stringify({ physique: source.raw, commandes: source.reading }, null, 2)}
              </pre>
            </details>
          ) : null}
        </>
      )}
      <p role="status">{avis}</p>
    </>
  );
}

/** Le clavier de la trame Pro : l'essai, puis la table des touches. Une
 * touche essayée allume sa pièce et ne part jamais au jeu. */
export function ClavierPro({ trame }: { trame: TramePro }) {
  const { source } = trame;
  const { avis, geste } = useGeste(source);
  const noms = nomsPro(trame);
  return (
    <>
      <div
        tabIndex={0}
        className="n3-essai-clavier"
        role="group"
        aria-label={REGLAGE.essaiNom}
        onKeyDown={(event) => {
          if (!source.capturing && source.handlesKey(event.code)) {
            event.preventDefault();
            source.previewKeys.add(event.code);
          }
        }}
        onKeyUp={(event) => source.previewKeys.delete(event.code)}
        onBlur={() => source.previewKeys.clear()}
      >
        {REGLAGE.essai}
      </div>
      <DessinsPro trame={trame} />
      <Correspondances
        titre={REGLAGE.correspondances}
        colonne={REGLAGE.touche}
        lignes={SWITCH_TARGETS.map((cible) => ({
          cle: cible,
          ...noms(cible),
          valeur: source.profile.keys[cible] ? keyName(source.profile.keys[cible]) : REGLAGE.rien,
          enCours: source.capturing?.target === cible && source.capturing.source === "key",
          attente: REGLAGE.attendTouche,
        }))}
        prefixe="key"
        inactif={Boolean(source.capturing || source.lecon)}
        onChanger={(cle) => geste(() => source.begin(cle as SwitchTarget, "key"))}
        onAnnuler={() => geste(() => source.cancel())}
        onEffacer={(cle) => geste(() => source.clear(cle as SwitchTarget, "key"))}
        pied={REGLAGE.nonTransmis(trame.xbox)}
      />
      <p role="status">{avis}</p>
    </>
  );
}

/** « Mes profils Switch » ou « Mes profils Xbox 360 ». Charger un profil ne
 * déclare jamais prêt, et aucun profil n'est « proposé pour ce jeu ». */
export function ProfilsPro({ trame }: { trame: TramePro }) {
  const { source } = trame;
  const { avis, setAvis, geste } = useGeste(source);
  const [nom, setNom] = useState("");
  const fichier = useRef<HTMLInputElement>(null);
  const pareil = (profil: unknown) => JSON.stringify(profil) === JSON.stringify(source.profile);
  const actif = Object.keys(source.named).find((un) => pareil(source.named[un]));
  const [choisi, setChoisi] = useState(actif ?? "");
  const titre = REGLAGE.mesProfils(trame.console);
  return (
    <section className="n3-profils" aria-label={titre}>
      <h3>{titre}</h3>
      <p>{REGLAGE.pret}</p>
      <ul>
        {Object.keys(source.named).map((un) => (
          <li key={un}>
            <span>{un}</span>
            {un === actif ? <small>{REGLAGE.enService}</small> : null}
          </li>
        ))}
      </ul>
      <label>
        {REGLAGE.nomProfil}{" "}
        <input value={nom} maxLength={64} onChange={(e) => setNom(e.target.value)} />
      </label>
      <div className="n3-reglage-gestes">
        <Bouton
          onClick={() =>
            geste(() => {
              source.save(nom);
              source.message = REGLAGE.enregistre;
            })
          }
        >
          {REGLAGE.enregistrer}
        </Bouton>
      </div>
      <label>
        {REGLAGE.enService}{" "}
        <select value={choisi} onChange={(e) => setChoisi(e.target.value)}>
          <option value="">{REGLAGE.defaut}</option>
          {Object.keys(source.named).map((un) => (
            <option key={un}>{un}</option>
          ))}
        </select>
      </label>
      <div className="n3-reglage-gestes">
        <Bouton onClick={() => geste(() => (choisi ? source.load(choisi) : source.reset()))}>
          {REGLAGE.charger}
        </Bouton>
        {choisi ? (
          <Bouton
            onClick={() =>
              geste(() => {
                source.forget(choisi);
                setChoisi("");
              })
            }
          >
            {REGLAGE.supprimer}
          </Bouton>
        ) : null}
        <Bouton
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(source.profile, null, 2)], { type: "application/json" }),
            );
            const lien = document.createElement("a");
            lien.href = url;
            lien.download = `nel3ab-profil-${trame.xbox ? "x360" : "switch"}.json`;
            lien.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          {REGLAGE.exporter}
        </Bouton>
        <Bouton onClick={() => fichier.current?.click()}>{REGLAGE.importer}</Bouton>
      </div>
      <small>
        {REGLAGE.enService} :{" "}
        {actif ?? (pareil(defaultSwitchProfile()) ? REGLAGE.defaut : REGLAGE.modifies)}
      </small>
      <input
        hidden
        ref={fichier}
        type="file"
        accept=".json"
        onChange={async (e) => {
          const pris = e.target.files?.[0];
          if (pris) {
            if (pris.size > 100000) setAvis(REGLAGE.tropGrand);
            else {
              const texte = await pris.text();
              geste(() => source.import(texte));
            }
          }
          e.target.value = "";
        }}
      />
      <p role="status">{avis}</p>
    </section>
  );
}
