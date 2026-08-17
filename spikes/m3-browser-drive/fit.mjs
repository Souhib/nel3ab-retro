// La taille à l'écran, séparée du format transporté.
//
// Deux décisions qui n'ont rien à voir: ce qu'on TRANSPORTE se choisit sur le
// débit qu'on a, ce qu'on AFFICHE sur ce qu'on aime voir. Les avoir liées
// revenait à dire que celui qui économise sa bande passante veut aussi une
// petite image.
//
// Le pilote vérifie que les quatre choix donnent quatre RÉSULTATS différents, et
// surtout qu'aucun ne déborde: une image plus grande que la place serait coupée,
// et rien à l'écran ne le dirait.
import puppeteer from "puppeteer";
import { enterRoom, openRoom } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url, "taille");
// Grand, sinon un doublement entier ne tient pas et « entier » se confond avec
// « origine »: le pilote ne distinguerait alors plus rien.
await page.setViewport({ width: 1920, height: 1080 });
await enterRoom(page);
await wait(5000);

const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
const pickIn = async (item, choice) => {
  await press("#openMenu");
  await wait(700);
  await press("#ray-reglages");
  await wait(400);
  await press(`#item-${item}`);
  await wait(500);
  await press(`#pick-${choice}`);
  await wait(700);
  await page.keyboard.press("Escape");
  await wait(700);
};
const shown = () =>
  page.evaluate(() => {
    const canvas = document.getElementById("screen");
    const box = canvas.getBoundingClientRect();
    const place = canvas.parentElement.getBoundingClientRect();
    return {
      picture: { w: canvas.width, h: canvas.height },
      shown: { w: Math.round(box.width), h: Math.round(box.height) },
      place: { w: Math.round(place.width), h: Math.round(place.height) },
      crisp: getComputedStyle(canvas).imageRendering === "pixelated",
    };
  });

// En demi-format, où le choix change vraiment quelque chose.
await pickIn("half", "half");
await wait(6000);
const start = await shown();
if (start.picture.w !== 608) {
  console.log(`RIEN TESTÉ — la page ne reçoit pas du 608 mais du ${start.picture.w}`);
  await browser.close();
  process.exit(0);
}

const seen = {};
for (const choice of ["remplir", "remplir-net", "entier", "origine"]) {
  await pickIn("fit", choice);
  const at = await shown();
  seen[choice] = at;
  check(
    at.shown.w <= at.place.w + 1 && at.shown.h <= at.place.h + 1,
    `« ${choice} » ne déborde pas (${at.shown.w}x${at.shown.h} dans ${at.place.w}x${at.place.h})`,
  );
}

check(
  seen.remplir.shown.w > seen.entier.shown.w,
  `remplir est plus grand qu'entier (${seen.remplir.shown.w} contre ${seen.entier.shown.w})`,
);
check(
  seen.entier.shown.w === start.picture.w * 2,
  `entier double exactement (${seen.entier.shown.w} = 608 x 2)`,
);
check(
  seen.origine.shown.w === start.picture.w,
  `origine rend un pixel pour un pixel (${seen.origine.shown.w})`,
);
// Le lissage suit le choix, et c'est la moitié de ce qu'on achète: un
// agrandissement exact veut des pixels francs, un agrandissement bâtard veut
// être lissé sinon il scintille.
check(!seen.remplir.crisp, "« remplir » lisse");
check(seen["remplir-net"].crisp, "« remplir, net » ne lisse pas");
check(
  seen["remplir-net"].shown.w === seen.remplir.shown.w,
  "et il garde exactement la même taille",
);

await browser.close();
console.log(
  bad === 0
    ? "PASS — quatre tailles, quatre résultats, et aucune ne déborde"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
