// What the page shows in its library, with the names a person reads.
import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("http://localhost:8100/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 4000));
const text = await page.evaluate(() => document.body.innerText);
let bad = 0;
for (const wanted of ["Super Smash Bros Melee", "Mario Kart Double Dash (Retro Track Grand Prix)"]) {
  const ok = text.includes(wanted);
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok    " : "ABSENT"} ${wanted}`);
}
for (const gone of ["v2.1", "melee-ntsc", "melee.rvz"]) {
  const ok = !text.includes(gone);
  if (!ok) bad += 1;
  console.log(`  ${ok ? "ok    " : "ENCORE"} plus de « ${gone} »`);
}
console.log(bad === 0 ? "PASS — la bibliothèque dit ce qu'il faut" : `FAIL — ${bad} écart(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
