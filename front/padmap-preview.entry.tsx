/**
 * Toutes les manettes du configurateur, dessinées par le VRAI composant.
 *
 * Jusqu'au 21 novembre 2026, cet aperçu redessinait le SVG à la main, et il
 * avait fini par ne plus ressembler à ce que voit un joueur. Il monte
 * maintenant `PadMapView` tel quel : ce que `padmap-qc.mjs` mesure ici est ce
 * que la salle affiche. « tout allumer » et « simuler » posent les mêmes
 * attributs que la boucle d'affichage (`paintWiring`).
 */
import { createRoot } from "react-dom/client";
import "./src/index.css";
import { PadMapView } from "./src/components/PadMap";
import { EMULATED, PHYSICAL, SWITCH_PRO } from "./src/lib/padmap";

const MAPS = [...EMULATED, ...PHYSICAL, SWITCH_PRO];
const root = document.getElementById("pads")!;
createRoot(root).render(
  <>
    {MAPS.map((map) => (
      <PadMapView key={map.id} map={map} title={map.name} className="card" />
    ))}
  </>,
);

const all = document.getElementById("padmap-lit") as HTMLInputElement;
const sim = document.getElementById("padmap-sim") as HTMLInputElement;
const HELD = new Set([
  "A",
  "X",
  "START",
  "D_UP",
  "x",
  "cx",
  "L",
  "Z",
  "b0",
  "b1",
  "b3",
  "b10",
  "b12",
  "b15",
  "b6",
]);
const TILT: Record<string, [number, number]> = {
  x: [0.75, -0.55],
  cx: [-0.2, 0.4],
  a0: [0.65, -0.5],
  a2: [-0.3, 0.6],
};
HELD.add("ZR").add("UP").add("LS");

function paint() {
  for (const piece of document.querySelectorAll<SVGGElement>("[data-part]")) {
    const on = all.checked || (sim.checked && HELD.has(piece.dataset.part ?? ""));
    piece.setAttribute("data-lit", on ? "oui" : "non");
    const body = piece.querySelector<SVGGElement>(".n3-stick-body");
    const tilt = sim.checked ? TILT[piece.dataset.stick ?? ""] : undefined;
    if (!body?.dataset.drive) continue;
    const travel = Number(body.dataset.drive);
    if (tilt) body.setAttribute("transform", `translate(${tilt[0] * travel} ${tilt[1] * travel})`);
    else body.removeAttribute("transform");
  }
}
all.addEventListener("change", paint);
sim.addEventListener("change", paint);
const params = new URLSearchParams(location.search);
all.checked = params.has("lit");
sim.checked = params.has("sim");
requestAnimationFrame(() => requestAnimationFrame(paint));
