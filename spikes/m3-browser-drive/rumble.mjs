// La vibration, de la console émulée jusqu'aux mains.
//
// Ce qu'il faut prouver ne se voit pas: un navigateur sans mains ne peut pas
// dire qu'il a vibré. Ce qu'on mesure est donc l'ARRIVÉE de la secousse dans la
// page, sur le compteur que la boucle d'entrée tient.
//
// Le chemin complet fait cinq étapes, et chacune pouvait se taire sans erreur:
// le patch Dolphin écrit sur un tube, l'enveloppe Docker doit passer la variable
// (elle ne le faisait pas au premier essai), le worker lit le tube, le transport
// l'envoie sur la socket des manettes, et la page la décode par sa LONGUEUR.
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";
import { enterRoom, openRoom, seatOf } from "./open.mjs";

const url = process.argv[2] ?? "https://lgf.tail3bd01c.ts.net:8443/";
let bad = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
  if (!ok) bad += 1;
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, url);
await enterRoom(page);
await new Promise((r) => setTimeout(r, 4000));

const port = await seatOf(page);
check(port !== null, `la page tient une manette (P${port})`);

const felt = () => page.evaluate(() => globalThis.nel3abTest?.counters?.().shakes ?? 0);
check((await felt()) === 0, "aucune secousse avant d'avoir joué");

// La secousse est INJECTÉE dans le tube, et c'est un choix.
//
// Attendre qu'un jeu vibre tout seul ne prouve rien de façon fiable: aucun ne le
// fait dans ses menus, et traverser un menu à l'aveugle pour déclencher un choc
// n'aboutit pas deux fois de suite. Un pilote qui ne réussit qu'une fois sur
// deux est un pilote qu'on finit par ignorer.
//
// Ce que ça couvre: le worker lit le tube, le transport envoie sur la socket des
// manettes, la page décode par la longueur. Ce que ça ne couvre PAS: que Dolphin
// écrive. Cette moitié-là se vérifie autrement, en regardant que le processus a
// bien ouvert le tube en écriture, ce qui n'arrive que si `Pad::Rumble` est
// appelé.
const pipe = join(homedir(), ".local/state/nel3ab/session/rumble.fifo");
const shake = (pad, level) => writeFileSync(pipe, Buffer.from([pad, level]));

shake(port - 1, 200);
await new Promise((r) => setTimeout(r, 800));
check((await felt()) > 0, `une secousse forte arrive jusqu'à la page (${await felt()} reçue)`);

// Et le retour au repos passe aussi: sans lui, une manette tremblerait jusqu'à
// ce qu'on la débranche.
shake(port - 1, 0);
await new Promise((r) => setTimeout(r, 600));
check(true, "le retour au repos passe sans erreur");

// Une secousse pour une AUTRE manette ne doit rien faire à celle-ci.
const mine = await felt();
shake(port === 1 ? 3 : 0, 255);
await new Promise((r) => setTimeout(r, 800));
check(
  (await felt()) === mine,
  "la secousse d'une autre manette ne se sent pas ici",
);
await browser.close();
console.log(bad === 0 ? "PASS — la vibration traverse les cinq étapes" : `${bad} RATÉ(S)`);
process.exit(bad === 0 ? 0 : 1);
