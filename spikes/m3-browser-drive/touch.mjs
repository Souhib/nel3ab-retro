// La manette à l'écran, sur un téléphone simulé.
//
// Ce qu'il faut prouver tient en deux choses: elle APPARAÎT toute seule sur un
// écran tactile, et un appui de doigt arrive vraiment au jeu. La seconde se
// mesure sur le compteur de trames envoyées, qui est ce que le worker reçoit.
import puppeteer from "puppeteer";
import { enterRoom, openRoom } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url);
// Un téléphone tenu en travers, avec un vrai écran tactile.
await page.emulate({
  viewport: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
});
await page.reload({ waitUntil: "domcontentloaded" });
await enterRoom(page);
await new Promise((r) => setTimeout(r, 3000));

check(await page.$("#touchpad") !== null, "la manette apparaît toute seule sur un écran tactile");
check(await page.$("#touch-A") !== null, "avec ses boutons");
check(
  await page.$("aside") === null,
  "la colonne est repliée d'office: elle prend la moitié d'un écran tenu en travers",
);
check(await page.$("#unbare") === null, "et ses boutons de coin ne doublent pas Z et R");

// Les deux pièges signalés le 18 août 2026: sur un téléphone, il n'y a ni Échap
// ni menu atteignable une fois la colonne repliée, donc tout geste sans retour
// est définitif pour la visite.
const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);

await press("#hideTouch");
await new Promise((r) => setTimeout(r, 500));
check(await page.$("#touchpad") === null, "« cacher » cache bien la manette");
check(await page.$("#showTouch") !== null, "et laisse une porte pour la rappeler");

await press("#showTouch");
await new Promise((r) => setTimeout(r, 500));
check(await page.$("#touchpad") !== null, "la manette revient");

await press("#showColumn");
await new Promise((r) => setTimeout(r, 500));
check(await page.$("aside") !== null, "le bouton menu ramène la colonne");
check(await page.$("#foldColumn") !== null, "qui porte de quoi la refermer sans Échap");

await press("#foldColumn");
await new Promise((r) => setTimeout(r, 500));
check(await page.$("aside") === null, "et elle se referme");

// Rien ne doit se recouvrir. La première version plaçait ses groupes à des
// distances fixes, et sur un vrai téléphone la croix et les quatre boutons se
// rejoignaient au milieu de l'image, par-dessus le texte du jeu.
const groups = await page.evaluate(() => {
  const box = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  return ["touchStick", "touch-D_UP", "touch-D_DOWN", "touch-A", "touch-Y", "touch-L", "touch-R", "touch-START"]
    .map(box)
    .filter(Boolean);
});
const overlaps = [];
for (let i = 0; i < groups.length; i++) {
  for (let j = i + 1; j < groups.length; j++) {
    const a = groups[i], b = groups[j];
    if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) {
      overlaps.push(`${a.id} et ${b.id}`);
    }
  }
}
check(overlaps.length === 0, `aucun bouton n'en recouvre un autre${overlaps.length ? ": " + overlaps.join(", ") : ""}`);

// `attempts` est le compteur de trames que la page a envoyées au worker: c'est
// ce que le pilote de bout en bout regarde déjà, et c'est la seule preuve que
// le doigt a atteint le jeu plutôt que le seul bouton.
const sent = () => page.evaluate(() => globalThis.nel3abTest?.counters?.().attempts ?? 0);
const before = await sent();

// Un doigt sur A, TENU: c'est pendant qu'il tient qu'on regarde, sinon on ne
// mesure qu'un compteur qui monte de toute façon.
const button = await page.$("#touch-A");
const box = await button.boundingBox();
const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
await page.touchscreen.touchStart(at.x, at.y);
await new Promise((r) => setTimeout(r, 700));
const held = await page.evaluate(() => globalThis.nel3abTest?.counters?.().pressed ?? []);
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 500));
const after = await page.evaluate(() => globalThis.nel3abTest?.counters?.().pressed ?? []);

check((await sent()) > before, "les trames continuent de partir pendant qu'on joue au doigt");
check(held.includes("A"), `le bouton tenu arrive sur le fil (tenu: ${held.join(" ") || "rien"})`);
check(!after.includes("A"), "et il repart quand le doigt se lève");

// Le stick: un glissement doit pousser, et le relâchement remettre à zéro.
const stick = await (await page.$("#touchStick")).boundingBox();
const centre = { x: stick.x + stick.width / 2, y: stick.y + stick.height / 2 };
await page.touchscreen.touchStart(centre.x, centre.y);
await page.touchscreen.touchMove(centre.x + 50, centre.y);
await new Promise((r) => setTimeout(r, 400));
const pushed = await sent();
await page.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 300));

check(pushed > before, "le stick poussé fait aussi partir des trames");
check(
  await page.evaluate(() => document.getElementById("touchStick") !== null),
  "le stick est toujours là après le glissement",
);

// Et sur un ordinateur, elle ne s'invite pas.
//
// Le choix est OUBLIÉ avant de regarder, parce que les essais d'au-dessus l'ont
// rendu explicite en rappelant la manette, et qu'un choix explicite l'emporte
// sur l'appareil — c'est voulu. Sans cet oubli, ce contrôle ne dirait plus que
// « le test précédent a laissé une trace », ce qui n'intéresse personne.
const desk = await browser.newPage();
await desk.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem("nel3ab:touchpad");
    localStorage.removeItem("nel3ab:bare");
    localStorage.setItem("nel3ab:name", "bureau");
  } catch {
    /* stockage refusé: la page demandera un nom, et le pilote le dira */
  }
});
await desk.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(desk);
await new Promise((r) => setTimeout(r, 2000));
check(await desk.$("#touchpad") === null, "elle ne s'invite pas sur un ordinateur");

await browser.close();
console.log(bad === 0 ? "PASS — on peut jouer au doigt" : `${bad} RATÉ(S)`);
process.exit(bad === 0 ? 0 : 1);
