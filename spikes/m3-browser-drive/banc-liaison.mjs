// Ce qu'une page voit derrière une liaison dégradée, pour le banc `just banc-liaison`.
//
// Lancé DANS l'espace réseau du banc, où `tc netem` perd, retarde et plafonne
// les paquets pour de vrai. `throttle.mjs` plafonne un débit dans un relais TCP,
// et un relais TCP ne peut pas perdre un paquet: la perte y devient un simple
// retard. Or le cas de Hyde est justement de la perte, et le blocage en tête de
// ligne de TCP qu'elle provoque (plan d'exécution du 23 septembre 2026, 0.3).
//
// Un spectateur comme `watch.mjs`, qui ne prend pas de place. Il relève la page
// chaque seconde plutôt qu'une fois à la fin: le pire écart entre deux images
// est celui d'une fenêtre glissante de la page, et une lecture unique perdrait
// les trous tombés avant elle.
//
// Sortie: une ligne JSON, lue par la recette.
import puppeteer from "puppeteer";
import { enterRoom, seedName } from "./open.mjs";

const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 60);
if (!url) throw new Error("usage: banc-liaison.mjs <url> [secondes]");

// WebCodecs n'existe que dans un contexte sûr. `localhost` en est un, l'adresse du
// banc non: sans ce drapeau, la page n'a pas de `VideoDecoder`, ne décode rien, et
// le premier essai a rendu des zéros qui avaient l'air d'une mesure.
const origin = new URL(url).origin;
const browser = await puppeteer.launch({
  headless: true,
  // Le son joue sans geste: un navigateur sans écran n'en fait aucun, et une
  // page dont le contexte audio reste suspendu ne demande pas le son du tout.
  args: [
    "--no-sandbox",
    `--unsafely-treat-insecure-origin-as-secure=${origin}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
try {
  const page = await browser.newPage();
  await seedName(page, "banc-liaison");
  page.on("pageerror", (e) => console.error(`[pageerror] ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  try {
    await enterRoom(page, 30000);
  } catch (error) {
    // Dire CE QUE la page montre: un délai dépassé seul ne dit pas si elle a
    // chargé, ni ce qu'elle attendait.
    const shown = await page.evaluate(() => document.body?.innerText.slice(0, 400) ?? "");
    console.error(`la page n'a pas laissé entrer; elle montrait:\n${shown}`);
    throw error;
  }

  // Le son démarre au premier geste APRÈS l'entrée, comme pour une personne
  // (`App.tsx`, `wake`). Sans lui, la page ne demandait jamais le son, et le
  // banc « sans trou de son » n'avait rien écouté.
  await page.evaluate(() => window.dispatchEvent(new Event("pointerup")));

  // Chauffe: l'horaire d'affichage se pose en une vingtaine de secondes.
  await new Promise((r) => setTimeout(r, 20000));
  const read = () =>
    page.evaluate(() => ({
      counters: globalThis.nel3abTest.counters(),
      pacing: globalThis.nel3abTest.pacing(),
      audio: globalThis.nel3abTest.audio(),
    }));
  const first = await read();
  // Une salle qui sert une page d'avant `gapMax` rendrait NaN partout, et un NaN
  // qui passe par Math.max se lit « aucun écart ». Le binaire doit être celui
  // qui a été reconstruit avec la page.
  if (typeof first.pacing.gapMax !== "number")
    throw new Error("la salle sert une page sans gapMax: reconstruire le worker");
  const startedAt = Date.now();
  let worstGap = 0;
  const gapsP95 = [];
  let last = first;
  while (Date.now() - startedAt < seconds * 1000) {
    await new Promise((r) => setTimeout(r, 1000));
    last = await read();
    worstGap = Math.max(worstGap, last.pacing.gapMax);
    gapsP95.push(last.pacing.gapP95);
  }
  const elapsed = (Date.now() - startedAt) / 1000;
  const since = (key) => last.counters[key] - first.counters[key];
  // Une fenêtre sans image n'est pas une liaison parfaite, c'est une page qui
  // ne regarde pas. Le dire plutôt que rendre des zéros.
  if (since("shown") === 0) throw new Error("aucune image reçue pendant la fenêtre: rien n'est mesuré");
  gapsP95.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      // Le début de la fenêtre mesurée, pour que la recette ne compte pas dans
      // le journal du worker ce qui s'est passé pendant la connexion et la chauffe.
      debut: new Date(startedAt).toISOString(),
      secondes: Math.round(elapsed * 10) / 10,
      arrivees_par_s: Math.round((since("shown") / elapsed) * 10) / 10,
      peintes_par_s: Math.round((since("painted") / elapsed) * 10) / 10,
      pire_ecart_ms: Math.round(worstGap),
      ecart_p95_median_ms: Math.round(gapsP95[Math.floor(gapsP95.length / 2)] ?? 0),
      gigue_ms: Math.round(last.pacing.jitter * 10) / 10,
      socket_muette: since("stalls"),
      decodeur_relance: since("restarts"),
      trous_de_son: since("soundGaps"),
      // Des secondes de son jouées: zéro veut dire que le son n'est pas venu,
      // ce qui se lirait sinon « aucun trou ».
      son_joue_s: Math.round(since("soundPlayed") * 10) / 10,
      etat_son: last.audio.state,
      format: `${last.pacing.pictureW}x${last.pacing.pictureH}`,
    }),
  );
} finally {
  await browser.close();
}
