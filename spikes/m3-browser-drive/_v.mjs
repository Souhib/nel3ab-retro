import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer";
import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";
// Sous `/tmp/nel3ab-*`, comme le reste du dépôt: ce chemin a porté un scratchpad
// propre à une session, donc un dossier absent pour tout autre lecteur.
const OUT = process.env.NEL3AB_OUT ?? "/tmp/nel3ab-v";
mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] ?? "v";
const b = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const p = await openRoom(b, ROOM_URL);
await p.setViewport({ width: 1300, height: 900 });
await p.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:touchpad", "on"));
await p.reload({ waitUntil: "domcontentloaded" });
await enterRoom(p);
await new Promise((r) => setTimeout(r, 14000));
const tap = async (id, wait = 2400) => {
  await p.evaluate((s) => {
    const el = document.getElementById(s);
    el?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    setTimeout(() => el?.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 })), 150);
  }, id);
  await new Promise((r) => setTimeout(r, wait));
};
for (let i = 0; i < 6; i++) { await tap("touch-A"); await (await p.$("canvas")).screenshot({ path: `${OUT}/${tag}-${i}.png` }); }
await b.close();
