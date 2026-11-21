/**
 * La scène du branchement: Bobine apporte la fiche d'un nouveau joueur et
 * l'enfonce dans la bonne prise.
 *
 * Elle se joue une fois par personne et par salle, au-dessus de la rangée de
 * prises. Le salon dit qui vient pour la première fois (`Seat.premiere`, lu dans
 * le journal des parties); sans réponse de sa part, la mémoire de ce navigateur
 * décide (`memoire.ts`). Elle se joue sans toucher à leur disposition: tout est posé en
 * position absolue et seules `transform` et `opacity` bougent. La rangée ne
 * bouge pas d'un pixel, et un clic sur une prise pendant la scène marche.
 *
 * La chronologie vit ici, en millisecondes, et non dans des délais CSS dispersés:
 * le moment où la prise passe à « tenue » doit tomber exactement quand la fiche
 * touche le fond, et c'est plus sûr de le décider à un seul endroit.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLAYER_COLOURS } from "../media/players";
import { Bobine, type Pose } from "./Bobine";
import { differences, type Occupation } from "./arrivees";
import { memoireDesVus } from "./memoire";

/** Les étapes et leur début, depuis l'arrivée de la scène. */
export const CHRONO = {
  arrive: 0,
  pousse: 1000,
  branche: 1260,
  salue: 1380,
  repart: 1950,
  fin: 2750,
} as const;

/** Combien dure le claquement d'une fiche, ou son saut quand on la retire. */
const GESTE_MS = 420;

const TAILLE = 50;

export type Fiche = "cachee" | "claque" | "saute";

type Scene = { port: number; nom: string };

/** Le mouvement est-il permis? Lu à chaque scène: le réglage peut changer. */
function mouvementPermis(): boolean {
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/**
 * Suit les prises et décide, pour chacune, quel geste jouer.
 *
 * `salle` sépare les mémoires: avoir vu quelqu'un dans la salle 1 ne dispense
 * pas de le présenter dans la salle 2.
 */
export function useBranchements(occupation: Occupation, salle: string) {
  const memoire = useRef(memoireDesVus(salle));
  const avant = useRef<Occupation | null>(null);
  const [fiches, setFiches] = useState<ReadonlyMap<number, Fiche>>(new Map());
  const [file, setFile] = useState<readonly Scene[]>([]);
  const minuteurs = useRef<number[]>([]);

  // L'état arrive deux fois par seconde dans des objets neufs, même quand rien
  // ne change: l'effet suit donc son RÉSUMÉ, et lit l'occupation dans une
  // référence tenue à jour à chaque rendu.
  const actuelle = useRef(occupation);
  actuelle.current = occupation;
  const cle = JSON.stringify([occupation.tenues, [...occupation.noms.entries()]]);
  useEffect(() => {
    const maintenant = actuelle.current;
    const { arrivees, departs } = differences(avant.current, maintenant, memoire.current.vus());
    avant.current = maintenant;
    if (arrivees.length === 0 && departs.length === 0) return;
    const bouge = mouvementPermis();
    const gestes = new Map<number, Fiche>();
    const scenes: Scene[] = [];
    for (const depart of departs) {
      if (bouge) gestes.set(depart.port, "saute");
    }
    for (const arrivee of arrivees) {
      if (arrivee.nom !== null) memoire.current.retiens(arrivee.nom);
      if (!bouge) continue;
      if (arrivee.facon === "premiere" && arrivee.nom !== null) {
        gestes.set(arrivee.port, "cachee");
        scenes.push({ port: arrivee.port, nom: arrivee.nom });
      } else {
        gestes.set(arrivee.port, "claque");
      }
    }
    setFiches((anciennes) => new Map([...anciennes, ...gestes]));
    if (scenes.length > 0) setFile((attente) => [...attente, ...scenes]);
    for (const [port, geste] of gestes) {
      if (geste === "cachee") continue;
      const id = window.setTimeout(() => oublie(port, geste), GESTE_MS);
      minuteurs.current.push(id);
    }
  }, [cle]);

  // Une prise libérée pendant que sa scène attend: la scène n'a plus d'objet.
  useEffect(() => {
    const tenues = actuelle.current.tenues;
    setFile((attente) => attente.filter((scene) => tenues[scene.port - 1] === true));
  }, [cle]);

  useEffect(
    () => () => {
      for (const id of minuteurs.current) window.clearTimeout(id);
    },
    [],
  );

  function oublie(port: number, geste: Fiche) {
    setFiches((anciennes) => {
      if (anciennes.get(port) !== geste) return anciennes;
      const suite = new Map(anciennes);
      suite.delete(port);
      return suite;
    });
  }

  const scene = file[0] ?? null;
  return {
    fiches,
    scene,
    /** La fiche touche le fond: la prise montre sa fiche, avec un claquement. */
    branche: (port: number) => {
      setFiches((anciennes) => new Map(anciennes).set(port, "claque"));
      const id = window.setTimeout(() => oublie(port, "claque"), GESTE_MS);
      minuteurs.current.push(id);
    },
    /** La scène est finie: la suivante peut commencer. */
    fini: () => setFile((attente) => attente.slice(1)),
  };
}

/**
 * Bobine, la fiche et le fil, posés au-dessus de `conteneur`.
 *
 * `conteneur` est la rangée des prises; la prise visée est trouvée par son
 * identifiant `port<N>`, celui que lisent aussi les pilotes de navigateur.
 */
export function Branchement({
  scene,
  conteneur,
  branche,
  fini,
}: {
  scene: Scene;
  conteneur: HTMLElement | null;
  branche: (port: number) => void;
  fini: () => void;
}) {
  const [etape, setEtape] = useState<keyof typeof CHRONO>("arrive");
  const [mesure, setMesure] = useState<{ largeur: number; cible: number; bouche: number } | null>(
    null,
  );
  const couleur = PLAYER_COLOURS[scene.port - 1] ?? PLAYER_COLOURS[0];
  const appels = useRef({ branche, fini });
  appels.current = { branche, fini };

  useLayoutEffect(() => {
    if (conteneur === null) return;
    const boite = conteneur.getBoundingClientRect();
    const prise = conteneur.querySelector<HTMLElement>(`#port${scene.port}`);
    if (prise === null) return;
    const cadre = prise.getBoundingClientRect();
    setMesure({
      largeur: boite.width,
      cible: cadre.left - boite.left + cadre.width / 2,
      // Le haut de la fiche, dans la prise dessinée, est à 18 unités sur 72 de
      // large; la fiche qui tombe part 30 px au-dessus de la rangée.
      bouche: (cadre.width / 72) * 18 + 30,
    });
  }, [conteneur, scene.port]);

  useEffect(() => {
    if (mesure === null) return;
    const ids = (Object.entries(CHRONO) as [keyof typeof CHRONO, number][]).map(([nom, quand]) =>
      window.setTimeout(() => {
        if (nom === "branche") appels.current.branche(scene.port);
        if (nom === "fin") appels.current.fini();
        else setEtape(nom);
      }, quand),
    );
    return () => {
      for (const id of ids) window.clearTimeout(id);
    };
  }, [mesure, scene.port]);

  if (mesure === null) return null;
  const largeurBob = (TAILLE * 64) / 84;
  // Retourné, il tient la fiche à gauche: sa main est à 11 % de sa largeur.
  const auDessus = mesure.cible - largeurBob * 0.1;
  const position =
    etape === "arrive" ? auDessus : etape === "repart" ? mesure.largeur + 24 : auDessus;
  const depart = mesure.largeur + 24;
  const [x, transition] =
    etape === "arrive"
      ? [position, `transform ${CHRONO.pousse - 60}ms cubic-bezier(0.25, 0.6, 0.3, 1)`]
      : etape === "repart"
        ? [position, `transform ${CHRONO.fin - CHRONO.repart}ms cubic-bezier(0.5, 0, 0.8, 0.6)`]
        : [position, "none"];
  const pose: Pose =
    etape === "arrive"
      ? "porte"
      : etape === "pousse" || etape === "branche"
        ? "pousse"
        : etape === "salue"
          ? "salue"
          : "marche";
  const tientLaFiche = etape === "arrive";
  const ficheTombe = etape === "pousse";
  const filVisible = etape === "arrive";

  return (
    <div className="n3-scene" aria-hidden="true" data-etape={etape}>
      {/* Le fil du joueur, traîné depuis le bord droit, d'où Bobine arrive. */}
      <svg
        className="n3-fil"
        viewBox="0 0 100 14"
        preserveAspectRatio="none"
        style={{
          width: mesure.largeur,
          transform: `scaleX(${filVisible ? Math.max(0, (mesure.largeur - mesure.cible) / mesure.largeur) : 0})`,
          transition: filVisible ? transition : "opacity 220ms ease-out",
          opacity: filVisible ? 1 : 0,
        }}
      >
        <path d="M0 2 Q 40 13 100 9" stroke={couleur} vectorEffect="non-scaling-stroke" />
      </svg>
      <ApparitionDepuis depart={depart} x={x} transition={transition}>
        <div className={etape === "repart" ? "n3-bob-droite" : "n3-bob-gauche"}>
          <Bobine
            pose={pose}
            taille={TAILLE}
            cable={couleur}
            tenue={tientLaFiche ? "fiche" : undefined}
          />
        </div>
      </ApparitionDepuis>
      {ficheTombe ? (
        <svg
          className="n3-fiche-tombe"
          viewBox="0 0 20 16"
          style={
            {
              left: mesure.cible - 10,
              "--bouche": `${mesure.bouche}px`,
            } as React.CSSProperties
          }
        >
          <path d="M2 15 L2 8 A8 8 0 0 1 18 8 L18 15 Z" fill={couleur} stroke="#1d1712" />
        </svg>
      ) : null}
      {etape === "salue" ? (
        <svg
          className="n3-etincelle"
          viewBox="-12 -12 24 24"
          style={{ left: mesure.cible - 12, top: mesure.bouche - 30 - 6 }}
        >
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <path key={angle} d="M0 -6 V -10" transform={`rotate(${angle})`} stroke={couleur} />
          ))}
        </svg>
      ) : null}
    </div>
  );
}

/**
 * Place son contenu à `depart`, puis le fait glisser jusqu'à `x`.
 *
 * Le premier rendu doit être posé AVANT la transition, sinon le navigateur
 * n'a pas de point de départ et Bobine apparaîtrait directement devant la prise.
 */
function ApparitionDepuis({
  depart,
  x,
  transition,
  children,
}: {
  depart: number;
  x: number;
  transition: string;
  children: React.ReactNode;
}) {
  const [pose, setPose] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => setPose(true)),
    );
    return () => window.cancelAnimationFrame(id);
  }, []);
  return (
    <div
      className="n3-bob-porteur"
      style={{
        transform: `translateX(${pose ? x : depart}px)`,
        transition: pose ? transition : "none",
      }}
    >
      {children}
    </div>
  );
}
