// The pad diagrams, printed as ASCII so a non-vision process can reason about
// their layout. A grid of points over each SVG, each point classified as
// air / shell / part by asking the real SVG geometry (isPointInFill + the part
// circles and rects). Enough to checkpoint a silhouette and where the pieces
// sit on it. Not enough to judge taste.
import puppeteer from "puppeteer";

const URL = process.env.PADMAP_URL ?? "http://localhost:5299/padmap-preview.html";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 2000 });
await page.goto(URL, { waitUntil: "networkidle0" });
await page.waitForSelector("svg[data-padmap]", { timeout: 20000 });

const grids = await page.evaluate(() => {
  const COLS = 68;
  const out = {};
  for (const svg of document.querySelectorAll("svg[data-padmap]")) {
    const vb = (svg.getAttribute("viewBox") || "-2 -2 104 66").split(/[\s,]+/).map(Number);
    const L = vb[0], T = vb[1], W = vb[2], H = vb[3];
    const ROWS = Math.round(COLS * H / W);
    const shell = svg.querySelector("path.n3-shell");
    const parts = [...svg.querySelectorAll("[data-part]")].map((g) => {
      const shape = g.querySelector("circle:not(.n3-gate), rect");
      const box = shape.getBBox();
      return { key: g.dataset.part, box };
    });
    const lines = [];
    for (let r = 0; r < ROWS; r += 1) {
      let line = "";
      for (let c = 0; c < COLS; c += 1) {
        const x = L + (W * (c + 0.5)) / COLS;
        const y = T + (H * (r + 0.5)) / ROWS;
        let ch = " ";
        if (shell && shell.isPointInFill(new DOMPoint(x, y))) {
          ch = ".";
          for (const part of parts) {
            const b = part.box;
            if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
              ch = "#";
              break;
            }
          }
        }
        line += ch;
      }
      lines.push(line);
    }
    out[svg.dataset.padmap] = lines;
  }
  return out;
});

await browser.close();
for (const [id, rows] of Object.entries(grids)) {
  console.log(`\n== ${id} ==`);
  console.log(rows.join("\n"));
}