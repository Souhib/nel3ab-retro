// One socket taken by us, one by somebody else, two free: every state at once.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

// L'adresse en ARGUMENT: le port 8100 n'existe plus depuis que les salles
// ont pris les leurs (8110, 8120, 8130). Un pilote qui l'écrit en dur se
// connecte à rien et meurt sur ECONNREFUSED sans que sa recette le dise.
const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const other = await browser.newPage();
await seedName(other);
await other.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(other);
await wait(2000);
const mine = await browser.newPage();
await seedName(mine);
await mine.setViewport({ width: 1400, height: 820 });
mine.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
await mine.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(mine);
await wait(2500);
console.log(`  l'autre page : ${await other.evaluate(() => globalThis.nel3abTest.seat())}`);
console.log(`  cette page   : ${await mine.evaluate(() => globalThis.nel3abTest.seat())}`);
console.log(`  panneau      : ${await mine.evaluate(() =>
  [...document.querySelectorAll("#ports [data-state]")].map((seat) => seat.dataset.state).join(" | "))}`);
await (await mine.$("#ports")).screenshot({ path: "/tmp/claude-1000/-home-souhib-nel3ab-retro/0d1d7749-e76b-413d-af12-878c112fd66e/scratchpad/panel.png" });
await browser.close();
