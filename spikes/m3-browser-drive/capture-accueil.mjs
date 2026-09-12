/** Une image de l'accueil, pour la regarder plutôt que la décrire. */
import puppeteer from "puppeteer";

const vers = process.argv[2];
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto("http://127.0.0.1:8200/", { waitUntil: "networkidle0" });
  await page.waitForFunction(
    () => document.querySelectorAll("a.salle, .vide").length > 0,
    { timeout: 15_000 },
  );
  // Le temps que la cascade d'apparition se pose.
  await new Promise(done => setTimeout(done, 700));
  await page.screenshot({ path: vers });
  console.log(`capture écrite: ${vers}`);
} finally {
  await browser.close();
}
