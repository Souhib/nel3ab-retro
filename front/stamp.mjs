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
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = import.meta.dirname;
const PAGE = join(ROOT, "..", "core", "crates", "worker", "src", "page", "index.html");
const STAMP = join(ROOT, "..", "core", "crates", "worker", "src", "page", "SOURCES");

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
const page = createHash("sha256").update(readFileSync(PAGE)).digest("hex");
const stamp = `sources ${sources}\npage    ${page}\n`;

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
  console.log("la page est à jour");
} else {
  writeFileSync(STAMP, stamp);
}
