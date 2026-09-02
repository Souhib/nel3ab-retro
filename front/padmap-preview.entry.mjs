import "/src/index.css";
import { GAMECUBE, GUITAR, STANDARD_PAD, WIIMOTE, DUALSHOCK, XBOX } from "/src/lib/padmap.ts";

const NS = "http://www.w3.org/2000/svg";

const tint = (colour) => (colour ? { "--n3-tint": colour } : undefined);

function shield(map) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", map.viewBox ?? "-2 -2 104 66");
  svg.setAttribute("data-padmap", map.id);
  if (map.flat) svg.setAttribute("data-flat", "oui");
  svg.setAttribute("role", "img");
  svg.classList.add("w-full");
  svg.style.setProperty("--n3-cap", `url(#cap-${map.id})`);

  const defs = document.createElementNS(NS, "defs");
  const shell = document.createElementNS(NS, "linearGradient");
  shell.id = `shell-${map.id}`;
  shell.setAttribute("x1", "0");
  shell.setAttribute("y1", "0");
  shell.setAttribute("x2", "0");
  shell.setAttribute("y2", "1");
  const stops = [[0, "var(--rule-bright)"], [0.4, "var(--rule)"]];
  if (!map.flat) stops.push([1, "var(--pit)"]);
  for (const [off, value] of stops) {
    const stop = document.createElementNS(NS, "stop");
    stop.setAttribute("offset", String(off));
    stop.setAttribute("stop-color", value);
    shell.appendChild(stop);
  }
  defs.appendChild(shell);
  const cap = document.createElementNS(NS, "radialGradient");
  cap.id = `cap-${map.id}`;
  cap.setAttribute("cx", "0.35");
  cap.setAttribute("cy", "0.28");
  cap.setAttribute("r", "0.85");
  for (const [off, value] of [
    [0, "color-mix(in srgb, var(--n3-tint, var(--rule)) 62%, #fff)"],
    [0.55, "var(--n3-tint, var(--rule))"],
    [1, "color-mix(in srgb, var(--n3-tint, var(--rule)) 60%, #000)"],
  ]) {
    const stop = document.createElementNS(NS, "stop");
    stop.setAttribute("offset", String(off));
    stop.setAttribute("stop-color", value);
    cap.appendChild(stop);
  }
  defs.appendChild(cap);
  svg.appendChild(defs);

  const shellPath = document.createElementNS(NS, "path");
  shellPath.setAttribute("class", "n3-shell");
  shellPath.setAttribute("d", map.body);
  shellPath.setAttribute("fill", `url(#shell-${map.id})`);
  svg.appendChild(shellPath);

  if (map.recess) {
    const recess = document.createElementNS(NS, "path");
    recess.setAttribute("class", "n3-recess");
    recess.setAttribute("d", map.recess);
    svg.appendChild(recess);
  }
  if (map.slots) {
    const slots = document.createElementNS(NS, "path");
    slots.setAttribute("class", "n3-slots");
    slots.setAttribute("d", map.slots);
    svg.appendChild(slots);
  }
  if (map.wire) {
    const wire = document.createElementNS(NS, "path");
    wire.setAttribute("class", "n3-wire");
    wire.setAttribute("d", map.wire);
    svg.appendChild(wire);
  }

  for (const part of map.parts) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("data-part", part.key);
    g.setAttribute("data-lit", "non");
    if (part.stick) g.setAttribute("data-stick", part.stick);
    const isRound = part.shape === "rond";
    const half = part.r * (isRound ? 1 : (part.wide ?? 1));
    const props = isRound
      ? { cx: part.x, cy: part.y, r: part.r }
      : {
          x: part.x - half,
          y: part.y - part.r,
          width: half * 2,
          height: part.r * 2,
          rx: Math.min(half, part.r),
        };
    if (part.gate) {
      const gate = document.createElementNS(NS, "circle");
      gate.setAttribute("class", "n3-gate");
      gate.setAttribute("cx", String(part.x));
      gate.setAttribute("cy", String(part.y));
      gate.setAttribute("r", String(part.r + 2));
      gate.setAttribute("fill", "none");
      g.appendChild(gate);
    }
    const add = (tag, extra = {}) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries({ ...props, ...extra })) {
        if (k === "style") continue;
        el.setAttribute(k, String(v));
      }
      return el;
    };
    // Le corps d'un stick vit dans son propre groupe, que la boucle déplace
    // (« simuler »); la garde, elle, ne bouge pas.
    const body = document.createElementNS(NS, "g");
    body.setAttribute("class", "n3-stick-body");
    if (part.stick) body.setAttribute("data-drive", String(part.r * 0.72));
    const base = add(isRound ? "circle" : "rect");
    Object.assign(base.style, tint(part.tint) ?? {});
    body.appendChild(base);
    if (!map.flat) {
      const dome = add(isRound ? "circle" : "rect", { class: "n3-cap" });
      Object.assign(dome.style, tint(part.tint) ?? {});
      body.appendChild(dome);
    }
    if (part.glyph) {
      const wrap = document.createElementNS(NS, "g");
      wrap.setAttribute("transform", `translate(${part.x} ${part.y})`);
      const glyph = document.createElementNS(NS, "path");
      glyph.setAttribute("class", "n3-glyph");
      glyph.setAttribute("d", part.glyph);
      wrap.appendChild(glyph);
      body.appendChild(wrap);
    }
    g.appendChild(body);
    if (part.label) {
      const text = document.createElementNS(NS, "text");
      text.setAttribute("x", String(part.x));
      text.setAttribute("y", String(part.y + 1.3));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "3.4");
      text.textContent = part.label;
      g.appendChild(text);
    }
    svg.appendChild(g);
  }
  return svg;
}

const all = document.getElementById("padmap-lit");
const root = document.getElementById("pads");
const maps = [GAMECUBE, WIIMOTE, GUITAR, STANDARD_PAD, DUALSHOCK, XBOX];

let drawn = [];
function draw() {
  root.textContent = "";
  drawn = [];
  for (const map of maps) {
    const card = document.createElement("section");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = map.name;
    card.appendChild(title);
    const svg = shield(map);
    card.appendChild(svg);
    root.appendChild(card);
    drawn.push(svg);
  }
}

const sim = document.getElementById("padmap-sim");

function tiltSticks(svg, tag, vx, vy) {
  for (const piece of svg.querySelectorAll(`[data-stick="${tag}"]`)) {
    const body = piece.querySelector(".n3-stick-body");
    if (!body) continue;
    const travel = Number(body.dataset.drive ?? 0);
    const dx = Math.max(-1, Math.min(1, vx)) * travel;
    const dy = Math.max(-1, Math.min(1, vy)) * travel;
    body.setAttribute("transform", `translate(${dx.toFixed(2)} ${dy.toFixed(2)})`);
  }
}

// Simule une manette pour voir ce que la boucle ferait en vrai: quelques
// touches tenues, les deux sticks inclinés (le droit, sur une manette
// standard, est plus bas que le gauche).
function simulate() {
  const on = new Set([
    "A", "X", "START", "D_UP", "x", "cx", "L", "R", "1", "2",
    "b0", "b1", "b3", "b10", "b11", "b12", "b15",
  ]);
  for (const svg of drawn) {
    for (const piece of svg.querySelectorAll("[data-part]")) {
      piece.setAttribute("data-lit", on.has(piece.dataset.part) ? "oui" : "non");
    }
    tiltSticks(svg, "x", 0.75, -0.55);
    tiltSticks(svg, "cx", -0.2, 0.4);
    tiltSticks(svg, "a0", 0.65, -0.5);
    tiltSticks(svg, "a2", -0.3, 0.6);
  }
}

function resetSim() {
  for (const svg of drawn) {
    for (const piece of svg.querySelectorAll("[data-part]")) {
      piece.setAttribute("data-lit", all.checked ? "oui" : "non");
    }
    for (const body of svg.querySelectorAll(".n3-stick-body")) {
      body.removeAttribute("transform");
    }
  }
}

all.addEventListener("change", () => (sim.checked ? simulate() : resetSim()));
sim.addEventListener("change", () => (sim.checked ? simulate() : resetSim()));
draw();