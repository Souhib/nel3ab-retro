import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";

const FILE = process.argv[2];
if (!FILE) { console.error("usage: shot-ascii.mjs <file.png> [COLS]"); process.exit(1); }
const COLS = Number(process.argv[3] ?? 72);
const ROWS = Math.round(COLS * 0.58);

const b64 = readFileSync(FILE).toString("base64");
const mime = FILE.endsWith(".jpg") || FILE.endsWith(".jpeg") ? "image/jpeg" : "image/png";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setContent(`<canvas id=c></canvas><script>
(async () => {
  const img = new Image();
  img.onload = () => {
    const c = document.getElementById("c");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const data = x.getImageData(0, 0, c.width, c.height).data;
    const rows = [];
    for (let r = 0; r < ${ROWS}; r++) {
      let line = "";
      for (let col = 0; col < ${COLS}; col++) {
        let sr = 0, sg = 0, sb = 0, n = 0;
        const x0 = Math.floor(col / ${COLS} * c.width), x1 = Math.floor((col+1) / ${COLS} * c.width);
        const y0 = Math.floor(r / ${ROWS} * c.height), y1 = Math.floor((r+1) / ${ROWS} * c.height);
        for (let yy = y0; yy < y1; yy += 2) for (let xx = x0; xx < x1; xx += 2) {
          const i = (yy*c.width+xx)*4; sr+=data[i]; sg+=data[i+1]; sb+=data[i+2]; n++;
        }
        sr/=n; sg/=n; sb/=n;
        const lum = (sr*0.299 + sg*0.587 + sb*0.114) / 255;
        line += lum > 0.9 ? " " : lum > 0.72 ? "." : lum > 0.52 ? ":" : lum > 0.34 ? "=" : lum > 0.2 ? "+" : lum > 0.1 ? "#" : "@";
      }
      rows.push(line);
    }
    window.__out = JSON.stringify({ w: c.width, h: c.height, rows });
  };
  img.onerror = () => window.__out = "IMG_ERR";
  img.src = "data:${mime};base64,${b64}";
})();
</script>`);
await page.waitForFunction(() => window.__out !== undefined, { timeout: 20000 });
const raw = await page.evaluate(() => window.__out);
await browser.close();
if (raw === "IMG_ERR") { console.error("image illisible"); process.exit(1); }
const out = JSON.parse(raw);
console.log("image:", out.w + "x" + out.h);
for (const row of out.rows) console.log(row);
