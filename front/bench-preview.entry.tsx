/**
 * L'aperçu du banc d'essai, servi par Vite tout seul.
 *
 * Ici et pas dans les essais parce que ce qui se regarde ici ne se mesure pas:
 * un chiffre qui déborde de sa case, une jauge trop fine pour se voir, une
 * grille qui casse à cinq colonnes. La largeur d'un mot dépend de la police, et
 * aucun essai de géométrie ne la connaît.
 *
 * Il monte le VRAI composant et appelle le VRAI remplissage: un aperçu qui
 * redirait l'un ou l'autre pourrait être beau pendant que la page est cassée.
 */
import { createRoot } from "react-dom/client";

import "./src/index.css";
import { paintBench } from "./src/lib/bench";
import { Bench } from "./src/components/Bench";
import { PadMapView } from "./src/components/PadMap";
import { EMULATED, STANDARD_PAD } from "./src/lib/padmap";

const BUTTONS = 17;
const AXES = 5; // impair EXPRÈS: c'est le cas que les adaptateurs produisent.

const root = document.getElementById("banc")!;
createRoot(root).render(
  <>
    {/* Les VRAIS schémas, montés à côté du banc: le pilote mesure ainsi le
        contraste des traits sur le composant lui-même. L'autre aperçu
        (`padmap-preview`) redessine le SVG à la main, et un double finit
        toujours par diverger de ce qu'il double. */}
    <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
      {[...EMULATED, STANDARD_PAD].map((map) => (
        <PadMapView key={map.id} map={map} title={map.name} className="flex-1" />
      ))}
    </div>
    <Bench
      name="DualSense"
      id="DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)"
      index={0}
      layout="standard"
      buttons={BUTTONS}
      axes={AXES}
    />
  </>,
);

// Une manette qui bouge, pour voir les jauges et les cadrans vivre.
const tick = () => {
  const t = performance.now() / 1000;
  paintBench(root, {
    buttons: Array.from({ length: BUTTONS }, (_, at) => ({
      value: at === 6 ? 0.65 : at === 7 ? 0.28 : at === 0 || at === 12 ? 1 : 0,
    })),
    axes: [Math.cos(t) * 0.8, Math.sin(t) * 0.8, -0.2, 0.4, -0.97],
    timestamp: performance.now(),
  });
  requestAnimationFrame(tick);
};
requestAnimationFrame(tick);
