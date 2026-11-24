/**
 * La manette tactile, montée seule, dans la même boîte que la salle.
 *
 * Servie par `manette-garde.mjs`, sans relais vers une salle. Elle reprend de
 * `App` ce qui décide de la place des touches, et rien d'autre : un `main`
 * plein écran, le vrai `Screen` qui pose l'image, et la largeur des bandes
 * noires calculée par la même expression que `App` (voir l'appel de
 * `TouchPad`). Le reste de la salle (menus, bandeaux, colonne) n'est pas là ;
 * cette page ne prouve donc rien sur eux.
 *
 * Les props passées aux deux pavés sont celles d'aujourd'hui ET celles d'avant
 * le 22 novembre 2026 (`onFeuille` depuis le « ••• », `onSound`, `onMenu` et
 * `onLeave` avant lui). Un composant ignore celles qu'il ne connaît pas, ce qui
 * permet de rejouer la garde sur l'ancien code et de la voir échouer.
 *
 * Paramètres : `pad` (code de console), `pw` et `ph` (taille de l'image),
 * `muet=1` pour un son coupé (le geste « son » passe alors en alerte).
 */
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../front/src/index.css";
import { Screen } from "../../front/src/components/Screen";
import { SwitchTouchPad } from "../../front/src/components/SwitchTouchPad";
import { TouchPad } from "../../front/src/components/TouchPad";
import { usesProInput } from "../../front/src/lib/consoles";
import { BarreSalle, BoutonSalle } from "../../front/src/components/BarreSalle";
import { placeDe, useFenetre, useZonesSures } from "../../front/src/components/Cadre";
import { MANETTES, miseEnPage, modeDuCadre } from "../../front/src/lib/cadre";
import { placeDeLaPastille } from "../../front/src/lib/etat-place";
import { EtatPastille } from "../../front/src/components/EtatSalle";
import { modeleEtat } from "../../front/src/lib/etat-modele";
import { BUTTON } from "../../front/src/media/pad";
import { SwitchInput } from "../../front/src/media/switch";
import { Touch } from "../../front/src/media/touch";

const query = new URLSearchParams(location.search);
const code = query.get("pad") ?? "gc";
const picture = { width: Number(query.get("pw") ?? 640), height: Number(query.get("ph") ?? 480) };
const muet = query.get("muet") === "1";

const touch = new Touch();
const source = new SwitchInput();
/** Ce que les gestes de page ont reçu. Un appui de jeu qui le fait monter est
 * tombé sur un geste. */
const gestures: string[] = [];

/** Ce que le pavé tient en ce moment, sous les noms de sa trame. */
function pressed(): string[] {
  if (usesProInput(code)) return [...source.touched].map(String);
  const bits = touch.reading()?.buttons ?? 0;
  return Object.entries(BUTTON)
    .filter(([, bit]) => (bits & bit) !== 0)
    .map(([name]) => name);
}

Object.assign(window, { __garde: { pressed, gestures, code, picture } });

/** Une image peinte, pour que les captures montrent où elle est. */
function paint(canvas: HTMLCanvasElement) {
  canvas.width = picture.width;
  canvas.height = picture.height;
  const ink = canvas.getContext("2d");
  if (!ink) return;
  const sky = ink.createLinearGradient(0, 0, 0, picture.height);
  sky.addColorStop(0, "#3b6fb6");
  sky.addColorStop(0.6, "#8fc1e8");
  sky.addColorStop(0.61, "#4c9a3c");
  sky.addColorStop(1, "#2c5e22");
  ink.fillStyle = sky;
  ink.fillRect(0, 0, picture.width, picture.height);
  ink.fillStyle = "#ffd400";
  ink.font = `bold ${Math.round(picture.height / 16)}px sans-serif`;
  ink.fillText("VIES x3", picture.width * 0.03, picture.height * 0.09);
  ink.fillText("SCORE 0123", picture.width * 0.66, picture.height * 0.09);
  ink.fillStyle = "#e23b3b";
  ink.fillRect(picture.width * 0.46, picture.height * 0.62, picture.width * 0.08, picture.height * 0.16);
}

function Salle() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const [hidden, setHidden] = useState(false);
  // La salle tenue en main, posée comme `App` la pose depuis le 23 novembre
  // 2026 : le cadre (`lib/cadre`) donne l'écran, la barre, « La salle » et la
  // boîte de la manette, zones sûres retranchées par le même témoin.
  const fenetre = useFenetre();
  const zonesSures = useZonesSures(fenetre);
  const pro = usesProInput(code);
  const geo = miseEnPage({
    mode: modeDuCadre({
      largeur: fenetre.width,
      hauteur: fenetre.height,
      grossier: true,
      role: "joueur",
    }),
    fenetre,
    zonesSures,
    image: picture,
    ajustement: "remplir",
    // Tenu en main : la base de la souris n'y sert pas (`baseDuPanneau`).
    base: null,
    etat: "vit",
    role: "joueur",
    manette: pro ? MANETTES.pro : MANETTES.dolphin,
    largeurColonne: 304,
    largeurPanneau: null,
    agrandie: false,
    reglage: false,
  });
  useEffect(() => {
    if (canvas.current) paint(canvas.current);
  }, []);
  useEffect(() => {
    if (space.width <= 0) return;
    // Deux images d'écran : la première pose la manette, la seconde la mesure.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.body.dataset.gardePret = "oui";
      }),
    );
  }, [space]);
  const tell = (what: string) => () => {
    gestures.push(what);
    if (what === "cacher") setHidden(true);
  };
  // La pastille de la fermeture proche, posée comme `App` la pose tenue en
  // main (`placeDeLaPastille`, ADR D40) : à part en haut de la grappe droite
  // ou dans la barre, sinon en tête de la bande, où va la pile des avis. La
  // garde mesure CETTE pastille, pas une copie ; sans place, il n'y en a pas.
  const fermeture = modeleEtat({
    liaison: { etat: "ok" },
    salle: 1,
    contexte: {},
    fermeDans: 2,
    place: true,
    legerePassee: false,
    legere: false,
    neige: false,
  });
  const place = placeDeLaPastille(geo, true);
  // Dans la pile, `App` la met en tête de la bande.
  const rectPastille =
    place?.lieu === "a-part" ? place.rect : place && geo.bande ? { ...geo.bande, h: 44 } : null;
  // Dit à la garde que la page a choisi « nulle part », pour qu'une
  // pastille absente ne passe pas pour une pastille perdue.
  document.body.dataset.pastille = place === null ? "aucune" : "posee";
  const m = geo.manette;
  const boite = m
    ? {
        bandes: m.grappes ? { left: m.grappes.g.w, right: m.grappes.d.w } : { left: 0, right: 0 },
        gestes: geo.salleDansLaManette ? (["feuille"] as const) : ([] as const),
        dansLesBandes: m.grappes !== null,
        tete: geo.salleDansLaManette,
      }
    : undefined;
  return (
    <div style={{ position: "relative", height: "100%" }}>
      <main style={{ position: "absolute", inset: 0 }}>
        <div
          style={{
            ...(geo.ecran ? placeDe(geo.ecran) : {}),
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Screen canvasRef={canvas} connected fit="remplir" picture={picture} onSpace={setSpace} />
        </div>
        {geo.barre ? (
          <BarreSalle
            rect={geo.barre}
            nomSalle="Salle 1"
            jeu="Le jeu"
            sonCoupe={muet}
            onSalle={tell("feuille")}
          />
        ) : geo.boutonSalle ? (
          <BoutonSalle
            id="laSalleCote"
            sonCoupe={muet}
            onSalle={tell("feuille")}
            style={placeDe(geo.boutonSalle)}
          />
        ) : null}
        {rectPastille ? (
          <div className="n3-pastille-place" style={placeDe(rectPastille)}>
            <EtatPastille modele={fermeture} onAller={() => {}} />
          </div>
        ) : null}
        {hidden || !m ? null : (
          <div className="n3-manette-boite" style={placeDe(m.rect)}>
            {pro ? (
              <SwitchTouchPad
                source={source}
                console={code}
                bar={0}
                soundOff={muet}
                onFeuille={tell("feuille")}
                cadre={boite}
              />
            ) : (
              <TouchPad bar={0} touch={touch} soundOff={muet} onFeuille={tell("feuille")} cadre={boite} />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Salle />);
