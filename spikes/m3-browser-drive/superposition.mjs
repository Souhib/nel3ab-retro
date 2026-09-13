// La colonne se voit-elle à travers la bande des rayons ?
//
// Le XMB fait défiler la colonne sous un croisement fixe. Au septième rang
// d'une liste de quatorze, l'entrée d'un cran au-dessus arrive dans la bande.
// `z-10` met bien la rangée DEVANT, mais l'ordre de peinture n'est pas
// l'opacité: elle n'a aucun fond et ses boutons portent `bg-transparent`, si
// bien que l'entrée se voit au travers. Mesuré le 13 septembre 2026: le texte
// « volume » croisait l'ICÔNE du rayon sur 32×17 px.
//
// # Le critère, et pourquoi celui-là
//
// Pour chaque encre de la colonne qui croise la bande, on évalue l'OPACITÉ
// EFFECTIVE du masque à sa position, en lisant les arrêts du dégradé calculé.
// Déterministe, instantané, insensible aux transitions comme à la composition.
//
// Six critères ont été essayés avant celui-ci, et les cinq premiers ne
// pouvaient pas échouer:
//   - le libellé du rayon seul, alors que la collision est sur l'icône;
//   - « un élément opaque s'interpose », vrai partout puisque
//     `elementsFromPoint` rend les ancêtres, dont le fond de page;
//   - un `find` sans garde, qui ne cachait rien et comparait deux fois la même
//     image;
//   - une zone de capture tombant à côté;
//   - une extraction d'alpha rendant NaN, donc un PASS sur du néant.
// La comparaison de PIXELS a été abandonnée en dernier: basculer la visibilité
// change la composition, et un élément masqué ne compose pas comme un élément
// nu, si bien que retirer le masque RÉDUISAIT l'écart mesuré (566 contre 794).
//
// # Ce que ce pilote ne sait pas juger
//
// Il vérifie le remède EN PLACE, qui est un masque. Un remède qui occulterait
// par un fond opaque le ferait crier à tort. C'est un filet borné, et le dire
// vaut mieux qu'un vert qui ne couvre pas ce qu'on croit.
//
//   node superposition.mjs [adresse]
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await seedName(page, "superposition");
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
await attendre(3000);

const menuOuvert = () => page.evaluate(() => document.getElementById("menu") !== null);
if (!(await menuOuvert())) { await page.keyboard.press("Escape"); await attendre(1500); }
if (!(await menuOuvert())) {
  console.log("RIEN MESURÉ — le menu ne s'ouvre pas.");
  await browser.close(); process.exit(1);
}

await page.keyboard.press("ArrowRight"); await attendre(250);
await page.keyboard.press("ArrowRight"); await attendre(700);

const rang = () => page.evaluate(() => {
  const ids = [...document.querySelectorAll('#menu [id^="item-"]')].map((n) => n.id);
  const ici = document.querySelector('#menu [data-selected="true"][id^="item-"]')?.id ?? "";
  return { index: ids.indexOf(ici), total: ids.length };
});
const depart = await rang();
for (let n = 0; n < 6; n++) { await page.keyboard.press("ArrowDown"); await attendre(220); }
const arrivee = await rang();
// On AFFIRME d'être descendu: mesurer au premier rang ne croise rien et rendrait
// un vert qui ne prouve rien.
if (arrivee.index <= depart.index) {
  console.log(`RIEN MESURÉ — la sélection n'a pas descendu (${depart.index} -> ${arrivee.index}).`);
  await browser.close(); process.exit(1);
}
console.log(`  rang ${arrivee.index + 1}/${arrivee.total}`);

const vu = await page.evaluate(() => {
  const fenetre = [...document.querySelectorAll("#menu div")].find(
    (d) => typeof d.className === "string"
      && d.className.includes("overflow-hidden") && d.className.includes("w-[62%]"));
  if (!fenetre) return { erreur: "colonne introuvable" };
  const F = fenetre.getBoundingClientRect();

  // Les arrêts du dégradé, lus sur le style CALCULÉ. `rgba(0, 0, 0, 0)` donne
  // une opacité de 0, `rgb(0, 0, 0)` de 1. Sans masque, aucun arrêt: tout est
  // opaque, ce qui est exactement l'état fautif.
  const arrets = [];
  const re = /(rgba?\(([^)]*)\))\s+([0-9.]+)(px|%)/g;
  let m;
  while ((m = re.exec(getComputedStyle(fenetre).maskImage)) !== null) {
    const parts = m[2].split(",").map((v) => Number(v.trim()));
    arrets.push({
      pos: m[4] === "%" ? (Number(m[3]) / 100) * F.height : Number(m[3]),
      alpha: parts.length >= 4 ? parts[3] : 1,
    });
  }
  const opacite = (y) => {
    if (arrets.length === 0) return 1;
    if (y <= arrets[0].pos) return arrets[0].alpha;
    for (let i = 1; i < arrets.length; i++) {
      if (y <= arrets[i].pos) {
        const p = arrets[i - 1], q = arrets[i];
        const t = q.pos === p.pos ? 1 : (y - p.pos) / (q.pos - p.pos);
        return p.alpha + t * (q.alpha - p.alpha);
      }
    }
    return arrets[arrets.length - 1].alpha;
  };

  const rayon = document.querySelector('[id^="ray-"][data-selected="true"]');
  if (!rayon) return { erreur: "aucun rayon choisi" };
  const parts = [...rayon.querySelectorAll(":scope > span")].map((s) => s.getBoundingClientRect());
  if (parts.length < 2) return { erreur: "le rayon n'a pas son icône et son libellé" };
  // La bande ENTIÈRE: l'icône ET le libellé. La collision est sur l'icône.
  const B = {
    left: Math.min(...parts.map((b) => b.left)), right: Math.max(...parts.map((b) => b.right)),
    top: Math.min(...parts.map((b) => b.top)), bottom: Math.max(...parts.map((b) => b.bottom)),
  };

  const croise = [];
  const tous = [...document.querySelectorAll('#menu [id^="item-"]')];
  const iSel = tous.findIndex((n) => n.dataset.selected === "true");
  let lisiblesDessus = 0;
  for (const [i, item] of tous.entries()) {
    let compte = false;
    for (const ink of item.querySelectorAll("span, svg")) {
      const R = ink.getBoundingClientRect();
      if (R.width === 0 || R.height === 0) continue;
      const centre = (R.top + R.bottom) / 2 - F.top;
      if (i < iSel && !compte && opacite(centre) > 0.5 && R.bottom > F.top && R.top < F.bottom) {
        lisiblesDessus += 1; compte = true;
      }
      const l = Math.min(B.right, R.right) - Math.max(B.left, R.left);
      const h = Math.min(B.bottom, R.bottom) - Math.max(B.top, R.top);
      if (l <= 0 || h <= 0) continue;
      const dans = (Math.max(B.top, R.top) + Math.min(B.bottom, R.bottom)) / 2 - F.top;
      croise.push({ id: item.id, croise: `${Math.round(l)}×${Math.round(h)}`,
                    decalage: Math.round(dans), alpha: Number(opacite(dans).toFixed(3)) });
      break;
    }
  }
  return {
    arrets: arrets.map((a) => `${Math.round(a.pos)}:${a.alpha}`).join(" ") || "(aucun masque)",
    bande: `${Math.round(B.right - B.left)}×${Math.round(B.bottom - B.top)}`,
    croise, lisiblesDessus,
  };
});

if (vu.erreur) {
  console.log(`RIEN MESURÉ — ${vu.erreur}.`);
  await browser.close(); process.exit(1);
}
console.log(`  bande du rayon : ${vu.bande} px`);
console.log(`  masque         : ${vu.arrets}`);
for (const c of vu.croise) {
  console.log(`  ${c.alpha > 0.02 ? "VISIBLE" : "avalée "} ${c.id} croise ${c.croise} au décalage ${c.decalage} (opacité ${c.alpha})`);
}
console.log(`  entrées encore lisibles au-dessus du curseur : ${vu.lisiblesDessus}`);

const pire = vu.croise.length === 0 ? 0 : Math.max(...vu.croise.map((c) => c.alpha));
console.log(pire <= 0.02
  ? "PASS — rien de la colonne ne se peint dans la bande des rayons"
  : `FAIL — une encre de la colonne y reste visible (opacité ${pire})`);
await browser.close();
process.exit(pire <= 0.02 ? 0 : 1);
