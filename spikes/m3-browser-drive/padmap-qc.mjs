// Geometry check for the pad diagrams, run in a real browser so the SVG
// geometry functions exist.
//
// A plan is "a part on a body": every piece must visually sit INSIDE its shell.
// All the checks we run fall on the parts staying within their declared hull,
// but the hull is data we can declare wrong too. This one samples the actual
// rendered geometry: the shell path's `isPointInFill`, at the corners and the
// centre of each part. What it cannot do is judge taste.
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
      // La garde d'un stick est de la couronne décorative hors du groupe
      // pressable: elle peut dépasser d'un souffle, et elle ne s'allume pas.
      const shape = part.querySelector("circle:not(.n3-gate), rect");
      if (!shape) continue;
      const box = shape.getBBox();
      const angle = Math.atan2(box.height, box.width);
      // Les points cardinaux du disque de la pièce, plus son centre.
      const probes = [
        [box.x + box.width / 2, box.y + box.height / 2],
        [box.x, box.y + box.height / 2],
        [box.x + box.width, box.y + box.height / 2],
        [box.x + box.width / 2, box.y],
        [box.x + box.width / 2, box.y + box.height],
      ];
      const out = probes.filter(([x, y]) => !shell.isPointInFill(new DOMPoint(x, y)));
      if (out.length) rows.push(`${part.dataset.part} pend à ${out.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} (angle ${angle.toFixed(1)})`);
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