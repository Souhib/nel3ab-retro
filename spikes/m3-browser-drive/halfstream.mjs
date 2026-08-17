// Le format d'image se choisit par personne, et le choix ne déborde pas.
//
// Le worker encode la même image deux fois, en 1216x896 et en 608x448, et
// chaque page prend celui qu'elle veut. Ce pilote tient les deux moitiés de la
// promesse:
//
// 1. le bouton change bien de flux, ce qui se lit sur la taille du canevas —
//    c'est le décodeur du navigateur qui la fixe, à partir de l'image reçue,
//    donc elle ne peut pas mentir sur ce qui est arrivé;
// 2. une PAGE VOISINE restée en pleine taille ne bouge pas. C'est la moitié qui
//    compte le plus: si les deux flux se mélangeaient, ça ne donnerait pas une
//    erreur mais une bouillie, et seulement chez l'un des deux.
import puppeteer from "puppeteer";
import { enterRoom, openRoom } from "./open.mjs";

const url = process.argv[2] ?? "http://localhost:8100/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FULL = 1216;
const HALF = 608;
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

// DEUX navigateurs et pas deux onglets: Chrome gèle la boucle d'affichage d'un
// onglet en arrière-plan, donc la page témoin ne peindrait jamais et son canevas
// garderait la taille écrite dans le HTML. Le pilote croirait alors avoir mesuré
// quelque chose.
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const other = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
/** La largeur que le décodeur a donnée au canevas, le nombre d'images peintes,
 * et surtout: est-ce que l'image REMPLIT la place qu'on lui donne. */
const shown = (page) =>
  page.evaluate(() => {
    const canvas = document.getElementById("screen");
    const box = canvas?.getBoundingClientRect();
    const place = canvas?.parentElement?.getBoundingClientRect();
    return {
      width: canvas?.width ?? 0,
      painted: globalThis.nel3abTest.counters().painted,
      // « Remplit » veut dire: ne dépasse jamais, et touche au moins un bord.
      //
      // Et pas « fait exactement la taille du parent »: l'image garde ses
      // proportions, donc l'une des deux dimensions est forcément plus petite
      // dès que la place n'est pas en 4/3. C'est ce qu'affirmait la version
      // d'avant, et elle ne tenait que par accident.
      fills:
        box !== undefined &&
        place !== undefined &&
        box.width <= place.width + 1 &&
        box.height <= place.height + 1 &&
        (Math.abs(box.width - place.width) < 2 || Math.abs(box.height - place.height) < 2),
    };
  });

// Une page témoin, qui ne touchera à rien.
const witness = await openRoom(other, url, "temoin");
await enterRoom(witness);
// Et celle qui bascule.
const player = await openRoom(browser, url, "bascule");
await enterRoom(player);
await wait(6000);

const first = await shown(player);
if (first.width !== FULL) {
  console.log(`RIEN TESTÉ — la salle ne diffuse pas du ${FULL} de large mais du ${first.width}`);
  await browser.close();
  await other.close();
  process.exit(0);
}
check(true, `au départ, les deux pages reçoivent du ${FULL}`);
check(first.fills, "et l'image remplit la place qu'on lui donne");

const press = (page, css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
await press(player, "#openMenu");
await wait(1000);
await press(player, "#ray-reglages");
await wait(600);
// Le format est un choix entre deux, donc un sélecteur: on ouvre, on clique la
// ligne « réduit », et le clic vaut validation.
await press(player, "#item-half");
await wait(1200);
check(
  await player.evaluate(() => document.getElementById("picker") !== null),
  "le format ouvre un sélecteur",
);
await press(player, "#pick-half");
await wait(6000);

const switched = await shown(player);
check(switched.width === HALF, `le bouton fait passer en ${HALF} (reçu ${switched.width})`);
check(switched.painted > first.painted, "et l'image continue d'arriver après la bascule");
// Le défaut du 2026-08-17: un canvas a une taille intrinsèque égale à son nombre
// de pixels, et `max-width` ne fait que la plafonner. En demi-format l'image
// était donc plus petite que la place et rien ne la faisait grandir: 28 % de la
// surface, au milieu du noir. Passer en réduit pour sauver son débit coûtait
// aussi les trois quarts de son écran, ce que personne n'avait demandé.
check(switched.fills, "et elle remplit TOUJOURS la place, malgré ses quatre fois moins de pixels");

// Le jumeau qui compte: le voisin n'a rien vu passer.
const untouched = await shown(witness);
check(
  untouched.width === FULL,
  `la page voisine est restée en ${FULL} (reçu ${untouched.width})`,
);
await wait(1500);
check(
  (await shown(witness)).painted > untouched.painted,
  "et elle peint toujours, donc son flux n'a pas été cassé",
);

// Et le retour.
await press(player, "#item-half");
await wait(600);
await press(player, "#pick-full");
await wait(6000);
check((await shown(player)).width === FULL, "le sélecteur ramène en pleine taille");

await browser.close();
await other.close();
console.log(
  bad === 0
    ? "PASS — chacun choisit son format, et personne ne subit le choix d'un autre"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
