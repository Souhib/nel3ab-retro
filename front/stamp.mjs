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
//
// The inputs are the files git tracks or would track under those paths, never
// what happens to lie in the folder (`entreesDeLaPage`): a cache ignored by git
// once made the stamp right in one worktree and wrong in every clean copy.
import { createHash } from "node:crypto";
import { brotliCompressSync, constants } from "node:zlib";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = import.meta.dirname;
const PAGE = join(ROOT, "..", "core", "crates", "worker", "src", "page", "index.html");
const STAMP = join(ROOT, "..", "core", "crates", "worker", "src", "page", "SOURCES");
/** Ce que la page a le droit de peser une fois compressée, en octets.
 *
 * C'est ce qu'une première visite coûte vraiment: le worker sert du brotli, et
 * l'ETag fait qu'une visite suivante ne coûte rien du tout.
 *
 * Le 19 août 2026, le plafond était de 140 000 octets, soit 2,8 secondes
 * de transfert au débit supposé de 400 kbit/s. La page pesait alors 118 874
 * octets et avait grossi de 25 % en trois jours. Ce garde rend la hausse visible.
 *
 * Le 6 septembre, le premier build avec reprise, aide au branchement et
 * diagnostic pesait 141 531 octets, contre 139 959 avant ces ajouts. Les
 * 1 572 octets supplémentaires représentent 31 ms au même débit supposé.
 * Le plafond passe à 150 000 octets, soit les trois secondes de transfert
 * visées à l'origine. Ce calcul ne mesure
 * pas l'arrivée de la première image : allers-retours et décodage s'ajoutent.
 *
 * Le 12 septembre 2026, le plafond passe à 300 000 octets, et c'est l'HYPOTHÈSE
 * DE DÉBIT qui change, pas la tolérance à la graisse.
 *
 * Les 400 kbit/s supposés étaient une prudence d'origine, du temps où la salle
 * pouvait être ouverte à n'importe qui. Elle ne l'est pas: elle vit dans un
 * tailnet privé, pour une dizaine de personnes, sur des liaisons domestiques.
 * À 20 Mbit/s, 300 000 octets valent 120 ms, contre 6 s au débit supposé
 * d'avant. La page pesait 149 617 octets ce jour-là, à 383 octets du plafond,
 * et l'interface de la salle avait du travail devant elle.
 *
 * Ce que ce garde protège ne change pas, et c'est pourquoi il reste: il rend
 * une DÉRIVE visible. En août, la page avait grossi de 25 % en trois jours sans
 * que personne s'en aperçoive. Un plafond qu'on relève en écrivant pourquoi
 * reste un plafond; un plafond qu'on supprime ne dit plus jamais rien.
 */
const WEIGHT_MAX = 300_000;

/** Everything the page is built from, in a fixed order.
 *
 * Le manifeste des consoles en fait partie depuis le 21 novembre 2026: la page
 * l'importe hors de `front/` (ADR D22). Sans lui ici, changer une console dans
 * le fichier laisserait la page compilée avec l'ancienne liste, et l'empreinte
 * resterait verte.
 *
 * Les polices du salon depuis le 22 novembre 2026, pour la même raison: la page
 * les embarque depuis `control/.../routes/polices` (`src/index.css`), et une
 * police re-sous-ensemblée côté salon doit rendre la page périmée. Le dossier
 * entier, licences comprises: elles ne partent pas dans la page, mais un
 * fichier de plus dans l'empreinte coûte moins qu'une police oubliée. */
const INPUTS = [
  "src",
  "index.html",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.app.json",
  "../consoles/consoles.json",
  "../control/nel3ab_control/api/routes/polices",
];

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
  return !/\.test\.[jt]sx?$/.test(path) && !`/${path}`.includes("/test/");
}

/** Les fichiers d'entrée de la page, relatifs à `root`, dans un ordre fixe.
 *
 * Ceux que git suit, plus ceux qu'il ne suit pas ENCORE mais n'ignore pas:
 * exactement ce qu'un commit peut emporter. Le 22 novembre 2026, la marque
 * parcourait les dossiers et hachait aussi un cache de vitest de 83 octets,
 * `src/node_modules/.vite/vitest/.../results.json`, ignoré par git et présent
 * dans un seul worktree. `just check` y sortait 0; sur une copie propre du même
 * commit, la marque était fausse, et la CI l'aurait été après la fusion.
 *
 * Les fichiers non suivis comptent, parce que la marque se pose AVANT le
 * `git add` d'un fichier neuf: sans eux, elle serait juste ici et fausse sur
 * la CI, où le fichier est suivi. Un fichier suivi puis effacé ne compte plus,
 * puisque la construction ne le lit pas.
 *
 * Hors d'un dépôt git, la marque refuse plutôt que de tout hacher: c'est
 * tout hacher qui l'avait rendue fausse. */
export function entreesDeLaPage(root = ROOT, inputs = INPUTS) {
  let listed;
  try {
    listed = execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--deduplicate", "--", ...inputs],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(`la marque lit ses entrées par git, et git ne répond pas dans ${root}: ${error.message}`);
  }
  const files = new Set();
  for (const path of listed.split("\0")) {
    if (path === "" || !bundled(path)) continue;
    const full = join(root, path);
    if (existsSync(full) && statSync(full).isFile()) files.add(path);
  }
  // Par octets et non selon la langue: le même ordre sur toutes les machines.
  return [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** L'empreinte des entrées: leur chemin et leur contenu. */
export function empreinteDesSources(root = ROOT, inputs = INPUTS) {
  const digest = createHash("sha256");
  for (const path of entreesDeLaPage(root, inputs)) {
    digest.update(path);
    digest.update(readFileSync(join(root, path)));
  }
  return digest.digest("hex");
}

function main() {
  const sources = empreinteDesSources();

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
}

// Lancé comme commande seulement: l'essai importe les deux fonctions sans rien écrire.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
