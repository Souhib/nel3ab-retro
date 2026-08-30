// Deux sauvegardes par jeu, et le choix qui décide sur laquelle on joue.
//
// Ce que la CI ne peut pas prouver: qu'un jeu écrit bien dans l'emplacement
// choisi. Le worker fait pointer le dossier de carte de Dolphin vers cet
// emplacement, et une erreur là ne donne pas une erreur: elle donne une partie
// qui écrase la mauvaise sauvegarde, ce qui ne se voit qu'une fois trop tard.
import { execFileSync } from "node:child_process";
import { existsSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const SESSION = join(homedir(), ".local/state/nel3ab/session");
const card = (region) => join(SESSION, "GC", region, "Card A");
const pointedAt = (region) => (existsSync(card(region)) ? readlinkSync(card(region)) : null);

/** Ce que le worker a retenu, lu sur le disque plutôt que déduit. */
const kept = (name) => {
  try {
    return execFileSync("cat", [join(SESSION, name)]).toString().trim();
  } catch {
    return null;
  }
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, ROOM_URL);
await enterRoom(page);
await new Promise((r) => setTimeout(r, 5000));

const before = pointedAt("USA");
say(before !== null, `le dossier de carte pointe quelque part (${before})`);
say(
  ["USA", "EUR", "JAP"].every((r) => pointedAt(r) === before),
  "et les trois régions pointent au même endroit",
);

// Le jeu qui tourne, pour en demander un autre.
const room = JSON.parse(
  await page.evaluate(async () => (await fetch("/api/room")).text()),
);
const other = room.library.find((g) => g.index !== room.game?.index);
say(Boolean(other), `un autre jeu à demander (${other?.name})`);

// On demande ce jeu sur l'emplacement « tout débloqué », par l'INTERFACE et pas
// par un raccourci: ce qu'on vérifie est justement que le choix de la page
// arrive jusqu'au disque.
const press = (css) => page.evaluate((s) => document.querySelector(s)?.click(), css);
await press("#openMenu");
await new Promise((r) => setTimeout(r, 1200));
// Le choix de sauvegarde vit en tête de la colonne des jeux.
await press("#item-save");
await new Promise((r) => setTimeout(r, 900));
// Les choix portent le code de l'emplacement: « 1 » est celui où tout est
// débloqué, et ce nombre vient de `saves::Slot` côté worker.
await press("#pick-1");
await new Promise((r) => setTimeout(r, 900));
say(
  (await page.evaluate(() => document.getElementById("item-save")?.textContent ?? "")).includes(
    "débloqué",
  ),
  "l'interface montre « tout débloqué »",
);

// Puis le jeu: une pression arme, la seconde lance.
await press(`#item-game${other.index}`);
await new Promise((r) => setTimeout(r, 1200));
await press(`#item-game${other.index}`);
await new Promise((r) => setTimeout(r, 22000));

say(kept("chosen-save") === "1", `l'emplacement retenu est « tout débloqué » (${kept("chosen-save")})`);
const after = pointedAt("USA");
say(after !== before, "le dossier de carte a changé d'emplacement");
say(
  after?.endsWith("/debloquee") ?? false,
  `et il pointe vers l'emplacement débloqué (${after})`,
);
say(
  after?.includes(other.name.toLowerCase().split(" ")[0] ?? "?") ?? false,
  "sous le dossier du jeu demandé",
);

await browser.close();
console.log(bad === 0 ? "PASS — chaque jeu a ses deux sauvegardes" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
