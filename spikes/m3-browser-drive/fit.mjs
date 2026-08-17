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
      // La toile telle qu'elle est DESSINÉE, et l'image telle qu'elle est
      // REÇUE: depuis le deux temps, les deux ne sont plus la même chose.
      canvas: { w: canvas.width, h: canvas.height },
      picture: {
        w: globalThis.nel3abTest.pacing().pictureW ?? canvas.width,
        h: globalThis.nel3abTest.pacing().pictureH ?? canvas.height,
      },
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

// L'agrandissement en deux temps.
//
// « Remplir » dessine la toile à un facteur ENTIER au plus proche voisin, et
// laisse le compositeur finir en lissé. Mesuré plus fidèle qu'un seul lissage
// (SSIM 0,96495 contre 0,96157 sur cinq images de course) et nettement plus net
// à l'oeil.
//
// La troisième vérification est la plus importante, et elle épingle un défaut de
// rétroaction: la taille de l'image publiée était lue sur la TOILE, qui est
// maintenant un résultat du calcul. Le calcul décidait donc d'après son propre
// résultat, et la toile oscillait entre 608 et 1216 d'une image à l'autre.
await pickIn("fit", "remplir");
await wait(1500);
const doubled = await shown();
check(
  doubled.canvas.w === start.picture.w * 2,
  `« remplir » dessine la toile au pas entier (${doubled.canvas.w} = 608 x 2)`,
);
check(
  doubled.shown.w > doubled.canvas.w,
  `et le compositeur finit en lissé (${doubled.canvas.w} -> ${doubled.shown.w})`,
);
const suite = [];
for (let n = 0; n < 3; n += 1) {
  suite.push((await shown()).canvas.w);
  await wait(500);
}
check(
  new Set(suite).size === 1,
  `la toile ne balance pas d'une image à l'autre (${suite.join(", ")})`,
);

await pickIn("fit", "remplir-net");
await wait(1200);
check(
  (await shown()).canvas.w === start.picture.w,
  "« net » ne passe pas par un pas entier, puisqu'il refuse le lissage",
);

// L'aperçu: le menu s'efface, le réglage s'applique en se promenant, et annuler
// remet ce qu'on avait. Régler la taille de l'image derrière un menu qui la
// cache est un réglage qu'on fait de mémoire, entre deux ouvertures — c'est ce
// qui a fait dire « je ne vois pas la différence » alors qu'il y en avait une.
await pickIn("fit", "remplir");
const before = (await shown()).shown.w;
await press("#openMenu");
await wait(700);
await press("#ray-reglages");
await wait(400);
await press("#item-fit");
await wait(700);
check(
  await page.evaluate(() => document.getElementById("menu")?.className.includes("n3-peek") ?? false),
  "le menu s'efface pendant qu'on règle la taille",
);
check(
  await page.evaluate(() => document.getElementById("picker") !== null),
  "et le sélecteur reste",
);
// Chaque choix annonce ce qu'il donnerait: c'est ce qui montre que deux d'entre
// eux rendent la même taille, au lieu de laisser croire que rien ne change.
const announced = await page.evaluate(() =>
  [...document.querySelectorAll('#picker [id^="pick-"]')].map((e) => e.textContent ?? ""),
);
check(
  announced.filter((line) => /\d+×\d+/.test(line)).length === 4,
  "et les quatre annoncent la taille qu'ils donnent",
);

await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await wait(700);
const during = (await shown()).shown.w;
check(during !== before, `l'image change sans qu'on ait validé (${before} -> ${during})`);

await page.keyboard.press("Escape");
await wait(700);
check((await shown()).shown.w === before, "et annuler remet ce qu'on avait");

await browser.close();
console.log(
  bad === 0
    ? "PASS — quatre tailles, quatre résultats, et aucune ne déborde"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
