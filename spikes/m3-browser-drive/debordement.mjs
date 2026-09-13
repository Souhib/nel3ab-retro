// Ce qui est COUPÉ à l'écran, mesuré au lieu d'être regardé.
//
// Le panneau des touches est une boîte de hauteur fixe dont le contenu ne
// défile pas hors préparation: ce qui y grossit trop se coupe sans prévenir.
// `capture-salle.mjs` le dit depuis longtemps et s'en remettait à l'oeil, qui
// rate la moitié des cas. Le 13 septembre 2026, agrandir l'échelle de texte a
// coupé « Modifier cette commande » en « Modifier cette comman » sans qu'aucun
// garde ne bronche: ni `layout` (qui regarde la colonne face à l'image), ni
// `contraste` (qui regarde des rapports de luminance), ni `just check`.
//
// Un conteneur en pixels fixes est calibré pour une taille de texte donnée.
// Quand le texte grandit, c'est le conteneur qui doit suivre, et ce pilote dit
// lesquels ne l'ont pas fait.
//
//   node debordement.mjs [adresse]
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await seedName(page, "debordement");
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await attendre(3000);

// Le menu, puis le panneau. On VÉRIFIE qu'on regarde le bon écran avant de
// mesurer: une sonde qui mesure autre chose rend un vert qui ne prouve rien.
if (!(await page.evaluate(() => document.getElementById("menu") !== null))) {
  await page.keyboard.press("Escape");
  await attendre(1500);
}
await page.evaluate(() => document.querySelector("#ray-reglages")?.click());
await attendre(600);
await page.evaluate(() => document.querySelector("#item-bindings")?.click());
await attendre(1500);
if ((await page.$("#bindingsPanel")) === null) {
  console.log("RIEN MESURÉ — le panneau des touches ne s'est pas ouvert.");
  await browser.close();
  process.exit(1);
}

const mesurer = () => page.evaluate(() => {
  const dehors = [];
  for (const el of document.querySelectorAll("#bindingsPanel *")) {
    const style = getComputedStyle(el);
    // Ce qui défile est censé dépasser: ce n'est pas une coupure.
    const defile = /auto|scroll/.test(style.overflow + style.overflowX + style.overflowY);
    if (defile || style.display === "none") continue;
    const large = el.scrollWidth - el.clientWidth;
    const haut = el.scrollHeight - el.clientHeight;
    // Un dépassement VERTICAL de 2px ou moins n'est pas une coupure: c'est la
    // boîte de ligne. `.n3-command-editor h3` porte `line-height: 1` pour un
    // texte de 31px, si bien que l'encre du glyphe dépasse sa ligne de deux
    // pixels sans que rien ne soit rogné — vérifié le 13 septembre 2026, aucun
    // ancêtre proche ne masque. Le signaler à chaque passage ferait de ce
    // pilote un garde qu'on apprend à ignorer. L'horizontal, lui, compte dès
    // le premier pixel: c'est là que les libellés se coupent.
    if (large <= 1 && haut <= 2) continue;
    const texte = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!texte) continue;
    dehors.push({
      quoi: `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${
        el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
          : ""
      }`,
      large,
      haut,
      texte,
    });
  }
  return dehors;
});

// Les TROIS onglets, et pas seulement celui qui s'ouvre par défaut.
//
// Le premier jet ne visitait que « Manette ». Il a rendu PASS alors que les
// libellés les plus longs du panneau vivent ailleurs: un vert partiel présenté
// comme un vert complet est exactement ce que ce fichier existe pour empêcher.
const onglets = await page.evaluate(() =>
  [...document.querySelectorAll(".n3-bindings-tabs button")].map((b) => b.textContent.trim()),
);
const coupes = [];
for (const nom of onglets.length > 0 ? onglets : ["(onglet unique)"]) {
  if (onglets.length > 0) {
    await page.evaluate((voulu) => {
      const node = [...document.querySelectorAll(".n3-bindings-tabs button")].find(
        (b) => b.textContent.trim() === voulu,
      );
      node?.click();
    }, nom);
    await attendre(1200);
  }
  for (const c of await mesurer()) coupes.push({ ...c, onglet: nom });
}

for (const c of coupes) {
  const de = [c.large > 1 ? `${c.large}px en largeur` : null, c.haut > 1 ? `${c.haut}px en hauteur` : null]
    .filter(Boolean)
    .join(", ");
  console.log(`  COUPÉ  [${c.onglet}] ${c.quoi}\n         « ${c.texte} » dépasse de ${de}`);
}
console.log(
  coupes.length === 0
    ? `PASS — rien n'est coupé, sur ${onglets.length || 1} onglet(s): ${onglets.join(", ")}`
    : `FAIL — ${coupes.length} élément(s) coupé(s)`,
);
await browser.close();
process.exit(coupes.length === 0 ? 0 : 1);
