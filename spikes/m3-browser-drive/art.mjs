// Les jaquettes: est-ce qu'elles arrivent, et est-ce que ce sont des images.
//
// C'est ici que l'encodeur PNG du worker est vraiment prouvé. Les tests Rust
// vérifient la signature et les dimensions écrites dans l'en-tête, ce qui est de
// notre code contrôlé par notre code. `naturalWidth` en revanche est ce que le
// décodeur de Chrome a réussi à lire: un octet de travers dans la somme de
// contrôle ou dans le flux compressé donne zéro, et zéro fait rougir ce fichier.
//
// Trois choses sont tenues, et la troisième est celle qui manquerait le plus:
//
// 1. chaque jeu qui annonce une jaquette en sert une, décodée à 96 par 32;
// 2. une position qui n'existe pas répond 404, pas la page — sinon une image
//    absente ferait décoder un document HTML au navigateur avant d'abandonner;
// 3. les mots du disque arrivent jusqu'à l'écran, ce qui est la moitié de ce
//    qu'on est allé chercher dans le disque.
import puppeteer from "puppeteer";
import { enterRoom } from "./open.mjs";

const url = process.argv[2] ?? "https://lgf.tail3bd01c.ts.net:8443/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const catalogue = await (await fetch(new URL("/roms", url))).json();
const withArt = catalogue.roms.filter((game) => game.art).length;
if (withArt === 0) {
  console.log("RIEN TESTÉ — aucun jeu de cette salle n'a donné sa jaquette");
  process.exit(0);
}

// Le refus, avant même d'ouvrir un navigateur: une position hors bibliothèque.
const beyond = await fetch(new URL(`/art/${catalogue.roms.length + 50}.png`, url));
check(beyond.status === 404, `une position qui n'existe pas répond 404 (${beyond.status})`);

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox"],
  acceptInsecureCerts: true,
  protocolTimeout: 30000,
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:shell", "wii"));
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(8000);
await page.evaluate(() => document.querySelector("#openMenu")?.click());
await wait(2000);

const seen = await page.evaluate(() =>
  [...document.querySelectorAll("#menu img")].map((img) => ({
    src: img.getAttribute("src"),
    width: img.naturalWidth,
    height: img.naturalHeight,
  })),
);
check(seen.length === withArt, `${withArt} jaquettes annoncées, ${seen.length} dessinées`);
const decoded = seen.filter((img) => img.width === 96 && img.height === 32);
check(
  decoded.length === seen.length,
  `toutes décodées à 96×32 par le navigateur (${decoded.length}/${seen.length})`,
);

// Les mots. Le studio d'au moins un jeu doit être écrit quelque part.
const maker = catalogue.roms.find((game) => game.maker)?.maker;
if (maker) {
  const written = await page.evaluate(
    (what) => document.querySelector("#menu")?.textContent?.includes(what) ?? false,
    maker,
  );
  check(written, `le studio lu sur le disque est à l'écran (« ${maker} »)`);
}

await browser.close();
console.log(
  bad === 0
    ? "PASS — les disques donnent leur image, et le navigateur la décode"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
