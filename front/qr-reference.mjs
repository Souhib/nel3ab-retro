// Réécrit src/lib/qr-reference.json, la référence de src/lib/qr.test.ts.
//
// La référence vient d'un AUTRE encodeur que celui de la page : celui de
// Kazuhiko Arase (licence MIT), que npm livre dans qrcode-terminal 0.12.0.
// Ce script ne lit jamais src/lib/qr.ts : une référence calculée par le code
// qu'elle doit juger ne jugerait rien.
//
// 28 liens de 1 à 178 octets (versions 1 à 9 du niveau M), chacun sous les
// huit masques : 224 matrices. Chacune est gardée par l'empreinte SHA-256 de
// ses lignes ("0" clair, "1" sombre, une ligne par rangée) ; les deux liens
// de salle réels sont gardés en entier, pour qu'une différence se lise.
//
// Usage : node qr-reference.mjs [dossier de QRCode]
// Par défaut, le dossier vendor/QRCode de qrcode-terminal sous `npm root -g`.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dossier =
  process.argv[2] ??
  path.join(
    execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim(),
    "npm/node_modules/qrcode-terminal/vendor/QRCode",
  );
const Arase = require(path.join(dossier, "index.js"));
const NIVEAU = require(path.join(dossier, "QRErrorCorrectLevel.js"));
const version = JSON.parse(readFileSync(path.join(dossier, "../../package.json"), "utf-8")).version;

/** La matrice de l'oracle, ligne par ligne. */
function lignes(texte, v, masque) {
  const q = new Arase(v, NIVEAU.M);
  q.addData(texte);
  q.makeImpl(false, masque);
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (q.isDark(r, c) ? "1" : "0")).join(""),
  );
}
/** La version que l'oracle choisit seul pour ce texte. */
function versionDe(texte) {
  const q = new Arase(-1, NIVEAU.M);
  q.addData(texte);
  q.make();
  return q.typeNumber;
}
const empreinte = (l) => createHash("sha256").update(l.join("\n")).digest("hex");

const base = "https://nel3ab.exemple/r/";
const textes = [];
for (let n = 1; n <= 178; n += 7)
  textes.push(`${base}1/?entrer=jouer&x=${"a".repeat(200)}`.slice(0, n));
const reels = [`${base}1/?entrer=jouer`, `${base}3/?entrer=regarder`];
textes.push(...reels);

const liens = textes.map((texte) => {
  const v = versionDe(texte);
  const masques = Array.from({ length: 8 }, (_, masque) => lignes(texte, v, masque));
  return {
    texte,
    version: v,
    // L'empreinte de la matrice sous chaque masque, du masque 0 au masque 7.
    empreintes: masques.map(empreinte),
    // Les liens réels, en entier sous le masque 2 : une différence s'y lit.
    ...(reels.includes(texte) ? { masque2: masques[2] } : {}),
  };
});
const sortie = {
  oracle: `qrcode-terminal ${version}, vendor/QRCode (Kazuhiko Arase, MIT)`,
  niveau: "M",
  mode: "octet",
  empreinte: "sha256 des lignes, « 1 » pour un module sombre, jointes par « \\n »",
  liens,
};
const cible = new URL("src/lib/qr-reference.json", import.meta.url);
writeFileSync(cible, `${JSON.stringify(sortie, null, 1)}\n`);
console.log(`${liens.length * 8} cas écrits dans ${cible.pathname}`);
