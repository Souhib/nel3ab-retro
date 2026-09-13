import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

// L'adresse en ARGUMENT: le port 8100 n'existe plus depuis que les salles
// ont pris les leurs (8110, 8120, 8130). Un pilote qui l'écrit en dur se
// connecte à rien et meurt sur ECONNREFUSED sans que sa recette le dise.
const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await seedName(page);
await page.goto(url, { waitUntil: "domcontentloaded" });
await enterRoom(page);
// `new URL("video", location.href)` et non `location.origin + "/video"`:
// l'origine seule JETTE le préfixe de la salle. Derrière le proxy la page vit
// sous `/r/1/`, et la socket partait donc vers `wss://<hôte>/video`, c'est-à-dire
// le salon, qui n'envoie aucune image. Mesuré le 13 septembre 2026 sur la vraie
// salle: sans préfixe 0 image et une erreur, avec préfixe 350 images en 7 s.
// La PAGE, elle, fait déjà juste (`front/src/lib/base.ts`, `under()`).
const measure = async (label) => {
  const out = await page.evaluate(async () => {
    const ws = new WebSocket(new URL("video", location.href).href.replace(/^http/, "ws"));
    ws.binaryType = "arraybuffer";
    let bytes = 0, n = 0;
    await new Promise((done) => {
      ws.onmessage = (e) => { if (e.data.byteLength > 8) { bytes += e.data.byteLength; n++; } if (n >= 300) done(); };
      setTimeout(done, 8000);
    });
    ws.close();
    return { bytes, n };
  });
  console.log(out.n === 0
    ? `  ${label} : aucune image reçue en 8 s`
    : `  ${label} : ${(out.bytes / out.n / 1024).toFixed(1)} Kio par image sur ${out.n} images`);
  return out.bytes / out.n;
};
const before = await measure("au repos");
// Une salle sur son menu ne PEINT rien: la socket s'ouvre, elle parle, et elle
// n'envoie aucune image. Mesuré le 13 septembre 2026 sur une salle sans jeu:
// quinze messages de huit octets ou moins en huit secondes, zéro image. Sans
// cette garde, `bytes / n` divisait par zéro, imprimait « NaN Kio par image sur
// 0 images » et sortait 0. Un pilote qui ne mesure rien et se déclare content
// est pire qu'un pilote absent: il fait croire que le débit a été vérifié.
if (!Number.isFinite(before) || before === 0) {
  // Ce que la garde a VU, et non la cause qu'elle croit deviner. Sa première
  // écriture affirmait « aucun jeu ne tourne »; elle l'a affirmé alors qu'un
  // jeu tournait, la vraie cause étant l'adresse de la socket. Un message qui
  // se trompe de cause envoie chercher la panne au mauvais endroit.
  console.log("RIEN MESURÉ — aucune image reçue sur /video en 8 s.");
  console.log("  Ce pilote mesure un DÉBIT: sans image, il n'y a rien à comparer.");
  console.log("  Deux causes connues: aucun jeu ne tourne dans cette salle, ou");
  console.log("  l'adresse donnée n'est pas celle de la salle (le préfixe compte).");
  await browser.close();
  process.exit(1);
}
// One socket asking for a key frame as fast as it can.
await page.evaluate(() => {
  const ws = new WebSocket(new URL("video", location.href).href.replace(/^http/, "ws"));
  ws.binaryType = "arraybuffer";
  ws.onopen = () => { globalThis.__flood = setInterval(() => ws.send(new Uint8Array([1])), 2); };
  globalThis.__floodSocket = ws;
});
await new Promise((r) => setTimeout(r, 2000));
const during = await measure("pendant la rafale");
await page.evaluate(() => { clearInterval(globalThis.__flood); globalThis.__floodSocket.close(); });
if (!Number.isFinite(during) || during === 0) {
  console.log("RIEN MESURÉ — le flux s'est tu pendant la rafale, rien à comparer.");
  await browser.close();
  process.exit(1);
}
console.log(`  → ${(during / before).toFixed(1)}× la taille d'image, pour un client qui envoie un octet`);
await browser.close();
