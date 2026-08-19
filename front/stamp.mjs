// What the committed page was built from.
//
// The page is a build artefact that is committed, so `cargo build` never needs
// node. The failure that trade invites is a change to `front/src` that nobody
// rebuilt, shipping a binary with yesterday's page in it.
//
// Comparing the built HTML itself does not catch it: the minifier picks its
// short identifiers differently between two runs of the SAME sources, so a
// byte comparison fails on identical input. Measured on this repository, three
// lines out of a 350 kB file, all of them a renamed local. So the stamp is over
// the INPUTS, which are stable text: every source file, the lockfile, and the
// build configuration.
//
//   node stamp.mjs          writes the stamp beside the page
//   node stamp.mjs --check   fails if the stamp does not match the sources
import { createHash } from "node:crypto";
import { brotliCompressSync, constants } from "node:zlib";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = import.meta.dirname;
const PAGE = join(ROOT, "..", "core", "crates", "worker", "src", "page", "index.html");
const STAMP = join(ROOT, "..", "core", "crates", "worker", "src", "page", "SOURCES");
/** Ce que la page a le droit de peser une fois compressée, en octets.
 *
 * C'est ce qu'une première visite coûte vraiment: le worker sert du brotli, et
 * l'ETag fait qu'une visite suivante ne coûte rien du tout.
 *
 * Cent quarante mille. La page en fait 118 874 le 19 août 2026, donc il reste
 * dix-sept pour cent de marge. Le nombre est choisi sur le TEMPS et pas sur une
 * habitude: à 400 kbit/s, qui est ce qu'une mauvaise 3G donne, 140 ko font 2,8 s
 * avant la première image. Au-delà, la salle met plus de trois secondes à
 * s'ouvrir chez quelqu'un, et une salle qu'on attend est une salle qu'on
 * n'ouvre pas.
 *
 * Mesuré plutôt que deviné, et c'est ce qui a motivé ce garde: la page a grossi
 * de 25 % en trois jours, du 16 au 19 août, sans que personne le remarque.
 */
const WEIGHT_MAX = 140_000;

/** Everything the page is built from, in a fixed order. */
const INPUTS = ["src", "index.html", "package-lock.json", "vite.config.ts", "tsconfig.app.json"];

/** Ce qui ne part JAMAIS dans la page, et n'a donc rien à faire dans l'empreinte.
 *
 * Les tests et leur mise en place vivent sous `src`, mais Vite ne les rassemble
 * pas: la page construite est identique qu'ils existent ou non. Les compter
 * rendait l'empreinte rouge à chaque test ajouté, ce qui obligeait à
 * reconstruire la page pour rien et faisait passer la CI au rouge sur un
 * commit qui n'avait pas touché à l'interface. Arrivé le 18 août 2026, en
 * ajoutant les trois premiers tests de composant.
 *
 * Le risque de trop exclure est réel et borné: si un fichier de test finissait
 * dans la page, l'empreinte cesserait de le voir. Le motif ne prend que
 * `*.test.*` et le dossier `src/test/`, qui sont par construction hors du
 * paquet.
 */
function bundled(path) {
  return !/\.test\.[jt]sx?$/.test(path) && !path.includes(`${sep}test${sep}`);
}

function* walk(path) {
  if (statSync(path).isFile()) {
    if (bundled(path)) yield path;
    return;
  }
  for (const entry of readdirSync(path).sort()) yield* walk(join(path, entry));
}

const digest = createHash("sha256");
for (const input of INPUTS) {
  for (const file of walk(join(ROOT, input))) {
    digest.update(relative(ROOT, file));
    digest.update(readFileSync(file));
  }
}
const sources = digest.digest("hex");

// And the page itself, so reverting the artefact alone is caught too. Hashing
// the OUTPUT against what this build produced is deterministic; it is only
// comparing two separate BUILDS that is not.
const built = readFileSync(PAGE);
const page = createHash("sha256").update(built).digest("hex");
const stamp = `sources ${sources}\npage    ${page}\n`;
// Le poids, sur ce que le worker envoie vraiment.
const weight = brotliCompressSync(built, {
  params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
}).length;
if (weight > WEIGHT_MAX) {
  console.error(
    `La page pèse ${weight} octets en brotli, au-dessus du budget de ${WEIGHT_MAX}.`,
  );
  console.error("  Alléger, ou relever le budget en écrivant pourquoi dans stamp.mjs.");
  process.exit(1);
}

if (process.argv.includes("--check")) {
  const found = readFileSync(STAMP, "utf8");
  if (found !== stamp) {
    const [wantedSources, wantedPage] = found.trim().split("\n").map((line) => line.split(/\s+/)[1]);
    console.error(
      wantedSources !== sources
        ? "Les sources de la page ont changé sans que la page soit reconstruite."
        : wantedPage !== page
          ? "La page compilée dans le worker n'est pas celle que cette construction a produite."
          : "La page et sa marque ne concordent pas.",
    );
    console.error("  Lancer `just front-build` et committer le résultat.");
    process.exit(1);
  }
  console.log(`la page est à jour (${weight} o en brotli, budget ${WEIGHT_MAX})`);
} else {
  writeFileSync(STAMP, stamp);
}
