// Every button of a standard gamepad, one at a time, against the bits the
// protocol defines. A synthetic pad rather than a real one: what is being
// checked is the MAPPING, and a mapping can be wrong in a way that only shows
// up on the button nobody thought to press.
import puppeteer from "puppeteer";

const BUTTON = {
  A: 1 << 0, B: 1 << 1, X: 1 << 2, Y: 1 << 3, Z: 1 << 4,
  L: 1 << 5, R: 1 << 6, START: 1 << 7,
  D_UP: 1 << 8, D_DOWN: 1 << 9, D_LEFT: 1 << 10, D_RIGHT: 1 << 11,
};
// index → what a GameCube player expects it to do.
const EXPECTED = [
  [0, "A"], [1, "B"], [2, "X"], [3, "Y"],
  [4, "L"], [5, "Z"], [9, "START"],
  [12, "D_UP"], [13, "D_DOWN"], [14, "D_LEFT"], [15, "D_RIGHT"],
];

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 3000));

const read = (buttons, axes) =>
  page.evaluate(
    (b, a) =>
      globalThis.nel3abTest.readPad({
        buttons: b.map((v) => ({ pressed: v > 0.5, value: v })),
        axes: a,
        id: "test",
        mapping: "standard",
      }),
    buttons,
    axes,
  );

let bad = 0;
for (const [index, name] of EXPECTED) {
  const buttons = Array.from({ length: 17 }, (_, i) => (i === index ? 1 : 0));
  const got = await read(buttons, [0, 0, 0, 0]);
  const ok = got.buttons === BUTTON[name];
  if (!ok) bad += 1;
  console.log(`  bouton ${String(index).padStart(2)} → ${name.padEnd(7)} ${ok ? "ok" : `FAUX (${got.buttons})`}`);
}

// The triggers are analogue AND click at the bottom of their travel.
const half = await read(Array.from({ length: 17 }, (_, i) => (i === 6 ? 0.5 : 0)), [0, 0, 0, 0]);
const full = await read(Array.from({ length: 17 }, (_, i) => (i === 6 ? 1 : 0)), [0, 0, 0, 0]);
const halfOk = half.l === 128 && (half.buttons & BUTTON.L) === 0;
const fullOk = full.l === 255 && (full.buttons & BUTTON.L) !== 0;
console.log(`  gâchette L à mi-course : ${half.l}/255, clic ${half.buttons & BUTTON.L ? "oui" : "non"} ${halfOk ? "ok" : "FAUX"}`);
console.log(`  gâchette L à fond      : ${full.l}/255, clic ${full.buttons & BUTTON.L ? "oui" : "non"} ${fullOk ? "ok" : "FAUX"}`);
if (!halfOk || !fullOk) bad += 1;

// Sticks: up is positive, and the C-stick exists at all.
const sticks = await read(Array(17).fill(0), [0.5, -0.5, -0.25, 0.75]);
const sticksOk =
  Math.abs(sticks.x - 0.5) < 0.01 && Math.abs(sticks.y - 0.5) < 0.01 &&
  Math.abs(sticks.cx + 0.25) < 0.01 && Math.abs(sticks.cy + 0.75) < 0.01;
console.log(`  sticks : principal (${sticks.x}, ${sticks.y}) · C (${sticks.cx}, ${sticks.cy}) ${sticksOk ? "ok" : "FAUX"}`);
if (!sticksOk) bad += 1;

const dead = await read(Array(17).fill(0), [0.1, 0.1, 0.1, 0.1]);
const deadOk = dead.x === 0 && dead.y === 0 && dead.cx === 0 && dead.cy === 0;
console.log(`  zone morte : ${deadOk ? "ok" : "FAUX — un stick au repos bouge"}`);
if (!deadOk) bad += 1;


// ── a learned profile ──────────────────────────────────────────────────────
//
// A real GameCube controller on an adapter reports an UNKNOWN layout: its
// buttons sit at indices of their own and its triggers are AXES, not buttons.
// The profile the page learns has to read both shapes, and a stick whose axis
// runs the other way.
const profile = {
  id: "adapter",
  buttons: { A: { button: 1 }, B: { button: 2 }, Z: { button: 7 }, START: { button: 9 },
             D_UP: { button: 12 } },
  // Trigger at rest -1, fully pressed +1: half travel is 0 on the axis.
  triggers: { L: { axis: 4, rest: -1, full: 1 }, R: { axis: 5, rest: -1, full: 1 } },
  sticks: { x: { axis: 0, sign: 1 }, y: { axis: 1, sign: -1 },
            cx: { axis: 2, sign: 1 }, cy: { axis: 3, sign: -1 } },
};
const readWith = (buttons, axes) =>
  page.evaluate(
    (b, a, prof) =>
      globalThis.nel3abTest.readPad(
        { buttons: b.map((v) => ({ pressed: v > 0.5, value: v })), axes: a, id: "adapter", mapping: "" },
        prof,
      ),
    buttons, axes, profile,
  );

const none = Array(16).fill(0);
const rest = [0, 0, 0, 0, -1, -1];
console.log("\n  profil appris (adaptateur) :");
for (const [name, index] of [["A", 1], ["B", 2], ["Z", 7], ["START", 9], ["D_UP", 12]]) {
  const buttons = none.map((_, i) => (i === index ? 1 : 0));
  const got = await readWith(buttons, rest);
  const ok = got.buttons === BUTTON[name];
  if (!ok) bad += 1;
  console.log(`    bouton ${String(index).padStart(2)} → ${name.padEnd(7)} ${ok ? "ok" : `FAUX (${got.buttons})`}`);
}
const halfAxis = await readWith(none, [0, 0, 0, 0, 0, -1]);
const fullAxis = await readWith(none, [0, 0, 0, 0, 1, -1]);
const axisOk = halfAxis.l === 128 && !(halfAxis.buttons & BUTTON.L) &&
  fullAxis.l === 255 && (fullAxis.buttons & BUTTON.L);
console.log(`    gâchette sur un AXE : mi-course ${halfAxis.l}/255, à fond ${fullAxis.l}/255 avec clic ${axisOk ? "ok" : "FAUX"}`);
if (!axisOk) bad += 1;

const pushed = await readWith(none, [0.5, -0.5, -0.25, 0.75, -1, -1]);
const signOk = Math.abs(pushed.x - 0.5) < 0.01 && Math.abs(pushed.y - 0.5) < 0.01 &&
  Math.abs(pushed.cx + 0.25) < 0.01 && Math.abs(pushed.cy + 0.75) < 0.01;
console.log(`    sticks inversés : (${pushed.x}, ${pushed.y}) · C (${pushed.cx}, ${pushed.cy}) ${signOk ? "ok" : "FAUX"}`);
if (!signOk) bad += 1;

// A trigger at rest must read zero, not half: `rest` is -1 here, and a profile
// that ignored it would report 128 with nothing pressed.
const idle = await readWith(none, rest);
const idleOk = idle.l === 0 && idle.r === 0 && idle.buttons === 0;
console.log(`    au repos : ${idleOk ? "ok" : `FAUX — L ${idle.l}, R ${idle.r}, boutons ${idle.buttons}`}`);
if (!idleOk) bad += 1;

console.log(bad === 0 ? "\nPASS — toute la manette est câblée, standard et profil appris"
  : `\nFAIL — ${bad} défaut(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
