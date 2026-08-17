// Le sélecteur: choisir dans une liste, glisser une valeur, valider ou annuler.
//
// Ce que ça remplace: les réglages tournaient en rond, un appui par valeur. Avec
// sept ambiances, ça veut dire appuyer sept fois sans jamais voir ce qui existe.
//
// Quatre choses tenues, et la troisième est celle qui a une vraie raison d'être:
//
// 1. la liste s'ouvre et se parcourt, au clavier;
// 2. valider applique le choix;
// 3. ANNULER remet la valeur d'avant. Pour une glissière ça compte doublement,
//    parce qu'elle s'applique en bougeant — un volume qu'on règle sans
//    l'entendre ne se règle pas — donc annuler doit défaire ce qu'on a entendu;
// 4. le sélecteur prend la main: pousser dedans ne doit pas déplacer le menu
//    derrière.
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
const page = await openRoom(browser, url, "selecteur");
await enterRoom(page);
await wait(3000);

const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
const text = (css) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, css);
const there = (css) => page.evaluate((s) => document.querySelector(s) !== null, css);
/** L'ambiance telle qu'elle est RETENUE, et pas telle qu'elle est écrite: le
 * texte d'une entrée contient aussi son indice quand elle est sélectionnée, donc
 * le comparer ferait échouer ce pilote pour une raison cosmétique. */
const theme = () => page.evaluate(() => localStorage.getItem("nel3ab:theme"));
/** L'entrée du menu sous le curseur, pour voir si le menu a bougé derrière. */
const onMenu = () =>
  page.evaluate(() => document.querySelector('#menu [data-selected="true"][id^="item-"]')?.id ?? null);
/** Ce que le panneau met en avant. */
const cursor = () =>
  page.evaluate(() => document.querySelector('#picker [data-at="true"]')?.id ?? null);

await press("#openMenu");
await wait(900);
await press("#ray-reglages");
await wait(600);

// ── Une liste: l'ambiance.
const themeBefore = await theme();
// Ouvert au CLAVIER et non à la souris: c'est le chemin d'une console, et ça
// laisse le curseur partir sur la valeur en cours.
await press("#item-theme");
await wait(500);
check(await there("#picker"), "choisir « ambiance » ouvre un sélecteur");
const first = await cursor();
check(first !== null, `le curseur part sur ce qui est en cours (${first})`);

const behind = await onMenu();
await page.keyboard.press("ArrowDown");
await wait(300);
const second = await cursor();
check(second !== first, `la flèche bas descend dans la liste (${first} -> ${second})`);
check((await onMenu()) === behind, "et le menu derrière n'a pas bougé");

// Annuler ne change rien.
await page.keyboard.press("Escape");
await wait(400);
check(!(await there("#picker")), "Échap referme le sélecteur");
check((await theme()) === themeBefore, `annuler laisse l'ambiance d'avant (${await theme()})`);

// Valider change.
await page.keyboard.press("Enter");
await wait(400);
await page.keyboard.press("ArrowDown");
await wait(250);
await page.keyboard.press("Enter");
await wait(600);
check(!(await there("#picker")), "Entrée referme le sélecteur");
check(
  (await theme()) !== themeBefore,
  `valider a changé l'ambiance (${themeBefore} -> ${await theme()})`,
);

// Et à la SOURIS: cliquer une ligne valide CETTE ligne.
//
// Séparé du chemin clavier, parce que c'est là qu'était le défaut: le clic
// déplaçait le curseur puis validait, et la validation relisait l'ancien curseur
// — le déplacement étant un changement d'état pas encore appliqué. On validait
// donc toujours l'option d'avant. Invisible au clavier, où les deux gestes sont
// séparés par une pression.
await press("#item-theme");
await wait(500);
await press("#pick-famicom");
await wait(600);
check((await theme()) === "famicom", `cliquer une ligne valide CETTE ligne (${await theme()})`);

// ── Une glissière: le volume.
const volumeOf = () => page.evaluate(() => globalThis.nel3abTest.volume?.() ?? null);
const before = await volumeOf();
await press("#item-volume");
await wait(500);
check(await there("#pickerTrack"), "choisir « volume » ouvre une glissière");

await page.keyboard.press("ArrowLeft");
await page.keyboard.press("ArrowLeft");
await wait(400);
const during = await volumeOf();
check(
  during !== null && before !== null && during < before,
  `la glissière s'entend en bougeant (${before} -> ${during})`,
);

// Et annuler remet ce qu'on avait.
await page.keyboard.press("Escape");
await wait(500);
const after = await volumeOf();
check(
  after !== null && Math.abs(after - before) < 1e-6,
  `annuler remet le volume d'avant (${during} -> ${after})`,
);

await browser.close();
console.log(
  bad === 0
    ? "PASS — on choisit, on glisse, on valide, et on peut annuler"
    : `ÉCHEC — ${bad} vérification(s)`,
);
process.exit(bad === 0 ? 0 : 1);
