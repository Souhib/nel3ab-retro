// Geometry check for the pad diagrams, run in a real browser so the SVG
// geometry functions exist.
//
// A plan is "a part on a body": every piece must visually sit INSIDE its shell.
// All the checks we run fall on the parts staying within their declared hull,
// but the hull is data we can declare wrong too. This one samples the actual
// rendered geometry: the shell path's `isPointInFill`, at the corners and the
// centre of each part. What it cannot do is judge taste.
//
// Since 21 November 2026 two kinds of parts are meant to leave the shell: a
// trigger drawn BEHIND it (`data-under`) must keep something visible, and a
// part laid on it that overhangs (`data-hangs`, a whammy bar) must both touch
// and overhang. Everything else must stay entirely on the shell.
import puppeteer from "puppeteer";

const URL = process.env.PADMAP_URL ?? "http://localhost:5199/padmap-preview.html";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1480, height: 4000 });
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForSelector("svg[data-padmap]", { timeout: 10000 });

const report = await page.evaluate(() => {
  const failing = [];
  for (const pad of document.querySelectorAll("[data-padmap]")) {
    const shell = pad.querySelector("path.n3-shell");
    if (!shell) continue;
    const rows = [];
    for (const part of pad.querySelectorAll("[data-part]")) {
      // Le capot lui-même: disque, pastille ou tracé exact. Le logement, la
      // garde et l'ombre d'un stick sont du décor autour, pas la pièce.
      const shape = part.querySelector(".n3-cap");
      if (!shape) {
        rows.push(`${part.dataset.part} n'a pas de capot`);
        continue;
      }
      const box = shape.getBBox();
      // Les points cardinaux de la boîte de la pièce, plus son centre.
      const probes = [
        [box.x + box.width / 2, box.y + box.height / 2],
        [box.x, box.y + box.height / 2],
        [box.x + box.width, box.y + box.height / 2],
        [box.x + box.width / 2, box.y],
        [box.x + box.width / 2, box.y + box.height],
      ];
      const inside = probes.filter(([x, y]) => shell.isPointInFill(new DOMPoint(x, y)));
      const out = probes.filter((probe) => !inside.includes(probe));
      const at = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      if (part.dataset.under === "oui") {
        // Une gâchette passe DERRIÈRE la coque: il faut qu'il en reste à voir.
        if (!out.length) rows.push(`${part.dataset.part} est entièrement cachée par la coque`);
      } else if (part.dataset.hangs === "oui") {
        // Posée sur la coque et en dépasse: il faut les deux.
        if (!inside.length) rows.push(`${part.dataset.part} ne touche pas la coque`);
        if (!out.length) rows.push(`${part.dataset.part} ne dépasse pas, elle n'a pas à le dire`);
      } else if (out.length) {
        rows.push(`${part.dataset.part} pend à ${at(out)}`);
      }
    }
    if (rows.length) failing.push(`${pad.dataset.padmap}: ${rows.join(" | ")}`);
  }
  return failing;
});

await browser.close();
if (report.length) {
  console.error("PIÈCES HORS DU BOÎTIER :");
  for (const line of report) console.error(`  ${line}`);
  process.exit(1);
}
console.log("PASS — chaque pièce se pose sur son boîtier");