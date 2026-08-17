// La taverne: un menu de jeu, et le reste de la mécanique dedans.
//
// Ce qui est vérifié n'est pas le dessin — une capture d'écran le montre mieux
// qu'une assertion — mais que la nouvelle forme est bien une forme du MÊME menu:
// les rayons, les entrées, le sélecteur et la manette y marchent comme ailleurs.
// Une console de plus qui aurait sa propre mécanique serait une console de plus
// à réparer à chaque fois.
//
// Et une chose que le dessin peut casser sans que rien n'échoue: les entrées
// doivent être ATTEIGNABLES. Une liste plus haute que l'écran, dans un panneau
// qui ne défile pas, laisse les dernières hors de portée pour toujours.
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
const page = await openRoom(browser, url, "taverne");
await page.setViewport({ width: 1280, height: 720 });
await page.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:shell", "taverne"));
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);
await wait(4000);

const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
const chosen = () =>
  page.evaluate(() => document.querySelector('#menu [data-selected="true"][id^="item-"]')?.id ?? null);
const ray = () =>
  page.evaluate(() => document.querySelector('#menu [data-selected="true"][id^="ray-"]')?.id ?? null);

await press("#openMenu");
await wait(900);
check(await page.evaluate(() => document.getElementById("menu") !== null), "la taverne s'ouvre");
const first = await chosen();
check(first !== null, `elle ouvre sur une entrée (${first})`);

await page.keyboard.press("ArrowDown");
await wait(350);
check((await chosen()) !== first, `bas descend d'une plaque (${first} -> ${await chosen()})`);

await page.keyboard.press("ArrowRight");
await wait(400);
check((await ray()) === "ray-salle", `droite change d'enseigne (${await ray()})`);

// Le sélecteur, dans cette forme aussi: c'est la mécanique partagée, mais elle
// n'est branchée que si la console dessine bien le panneau.
await press("#ray-reglages");
await wait(500);
await press("#item-theme");
await wait(600);
check(
  await page.evaluate(() => document.getElementById("picker") !== null),
  "le sélecteur s'ouvre dans la taverne",
);
await page.keyboard.press("Escape");
await wait(400);

// Toutes les entrées sont atteignables, y compris la dernière.
//
// Sur un écran de 720 pixels de haut, la liste des réglages est plus longue que
// le panneau: si le défilement ne suit pas le curseur, les dernières entrées sont
// perdues sans que rien ne le signale.
const howMany = await page.evaluate(
  () => document.querySelectorAll('#menu [id^="item-"]').length,
);
for (let step = 0; step < howMany + 2; step += 1) await page.keyboard.press("ArrowDown");
await wait(700);
const last = await chosen();
check(last !== null, `la dernière entrée reste désignée (${last})`);
const visible = await page.evaluate((id) => {
  const box = document.getElementById(id)?.getBoundingClientRect();
  if (!box) return false;
  return box.top >= -1 && box.bottom <= window.innerHeight + 1;
}, last);
check(visible, "et elle est dans l'écran, donc le panneau a suivi le curseur");

await page.keyboard.press("Escape");
await wait(500);
check(
  await page.evaluate(() => document.getElementById("menu") === null),
  "B referme la taverne",
);

await browser.close();
console.log(
  bad === 0
    ? "PASS — la taverne se conduit comme les autres, et rien n'est hors de portée"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
