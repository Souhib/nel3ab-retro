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

console.log(bad === 0 ? "PASS — toute la manette est câblée" : `FAIL — ${bad} défaut(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
