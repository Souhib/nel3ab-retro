// Le clip des trente dernières secondes, joué en vrai.
//
// Ce que la CI ne peut pas prouver: qu'un fichier s'ouvre. Le worker recopie des
// unités d'accès dans un conteneur, et une erreur là-dedans ne donne pas une
// erreur, elle donne un fichier que rien ne lit. Ce pilote demande un clip à la
// vraie salle et le passe à ffprobe, qui est le seul juge qui compte.
//
// Il vérifie aussi la limite de cadence, du côté SERVEUR: un bouton qui promet
// autre chose que ce que le serveur accepte est un bouton qui ment, et ce dépôt
// l'a déjà appris avec « ça saccade ».
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer";

import { enterRoom, openRoom, ROOM_URL } from "./open.mjs";

let bad = 0;
const say = (ok, what) => {
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "RATÉ"}   ${what}`);
};

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await openRoom(browser, ROOM_URL);
await enterRoom(page);

/** Demande un clip et rend ce que la salle a répondu.
 *
 * Depuis NODE et pas depuis la page, alors que la page est le vrai client. La
 * raison est bête et vaut d'être écrite: faire traverser des mégaoctets au pont
 * entre le navigateur et le pilote demande de les encoder, et
 * `String.fromCharCode(...)` sur trois millions d'octets fait déborder la pile.
 * L'en-tête `Origin` est posé à la main, parce que c'est exactement ce que le
 * worker vérifie sur cette route.
 */
const ask = async () => {
  const answer = await fetch(new URL("/clip", ROOM_URL), {
    method: "POST",
    headers: { Origin: new URL(ROOM_URL).origin },
  });
  const ok = answer.status === 200;
  return {
    code: answer.status,
    retry: Number(answer.headers.get("retry-after") ?? 0),
    nom: answer.headers.get("content-disposition") ?? "",
    mp4: ok ? Buffer.from(await answer.arrayBuffer()) : null,
    corps: ok ? "" : await answer.text(),
  };
};

// La salle a besoin de trente secondes derrière une image-clé. On regarde
// quarante-cinq, ce qui laisse la marge d'un GOP.
process.stdout.write("  on regarde quarante-cinq secondes");
for (let i = 0; i < 9; i++) {
  process.stdout.write(".");
  await new Promise((done) => setTimeout(done, 5000));
}
console.log();

const first = await ask();
say(first.code === 200, `la salle rend un clip (HTTP ${first.code} ${first.corps})`);

if (first.code === 200) {
  const file = join(tmpdir(), `nel3ab-drive-${process.pid}.mp4`);
  writeFileSync(file, first.mp4);
  try {
    const probed = JSON.parse(
      execFileSync("ffprobe", [
        "-v", "error", "-print_format", "json",
        "-show_entries", "format=duration:stream=codec_name,width,height",
        file,
      ]).toString(),
    );
    const stream = probed.streams?.[0] ?? {};
    const seconds = Number(probed.format?.duration ?? 0);
    say(stream.codec_name === "h264", `le fichier est du H.264 (${stream.codec_name})`);
    say(stream.width > 0 && stream.height > 0, `il a une image (${stream.width}x${stream.height})`);
    say(seconds >= 29, `il couvre au moins trente secondes (${seconds.toFixed(1)} s)`);
    say(seconds <= 45, `et pas beaucoup plus (${seconds.toFixed(1)} s)`);
  } catch (error) {
    say(false, `ffprobe refuse le fichier: ${String(error).slice(0, 120)}`);
  }
  unlinkSync(file);
  say(/filename="nel3ab-\d+s\.mp4"/.test(first.nom), `il porte un nom qui dit sa durée (${first.nom})`);
}

const second = await ask();
say(second.code === 429, `un deuxième clip aussitôt est refusé (HTTP ${second.code})`);
say(second.retry > 0 && second.retry <= 30, `et la salle dit combien attendre (${second.retry} s)`);

await browser.close();
console.log(bad === 0 ? "PASS — le clip s'ouvre, et on ne peut pas le spammer" : `ÉCHEC — ${bad}`);
process.exit(bad === 0 ? 0 : 1);
