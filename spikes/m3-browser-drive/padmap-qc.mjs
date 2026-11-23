// The controller planche, checked in a real browser (Chrome's SVG geometry and
// layout, which jsdom does not provide).
//
// A plan is "a part on a body": every piece must visually sit INSIDE its shell.
// This samples the actual rendered geometry: the shell path's `isPointInFill`,
// at the corners and the centre of each part. What it cannot do is judge taste.
//
// Since 21 November 2026 two kinds of parts are meant to leave the shell: a
// trigger drawn BEHIND it (`data-under`) must keep something visible, and a
// part laid on it that overhangs (`data-hangs`, a whammy bar) must both touch
// and overhang. Everything else must stay entirely on the shell.
//
// Since 23 November 2026 (chantier manettes, écran « cartes-padmap ») la
// planche a deux groupes, dix manettes et trois tailles chacune. Le pilote
// vérifie aussi :
// - les comptes d'inscriptions affichés égalent ceux qu'il mesure, et la plus
//   petite inscription visible fait au moins 9 px ; à 120 px des inscriptions
//   sont masquées, en grand aucune ;
// - l'appui le plus faible tient 3:1 dans les deux thèmes ;
// - les réglages sont des boutons de 44 px à `aria-pressed` qui font ce
//   qu'ils disent, et « Incliner » pose une pose fixe, sans animation.
//
// `--mutant-contraste` fabrique un appui de la couleur de la touche sur la
// manette Xbox : le pilote doit alors sortir en 1 sur ce seul défaut
// (`padmap-visuel.mjs` le vérifie). Chaque défaut est écrit « genre: détail ».
import puppeteer from "puppeteer";

const URL = process.env.PADMAP_URL ?? "http://localhost:5299/padmap-preview.html";
const MUTANT = process.argv.includes("--mutant-contraste");
const XBOX_360 =
  "salle Xbox 360, dessinée comme la Xbox actuelle : la 360 n'est pas encore relevée";

const fautes = [];
const faute = (genre, detail) => fautes.push(`${genre}: ${detail}`);
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  page.on("pageerror", (erreur) => faute("page", erreur.message));
  page.on("response", (reponse) => {
    if (reponse.status() >= 400) faute("page", `${reponse.status()} ${reponse.url()}`);
  });
  await page.setViewport({ width: 1600, height: 1200 });
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.waitForSelector("svg[data-padmap]", { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.dispatchEvent(new Event("planche:mesurer")));
  if (MUTANT) {
    await page.addStyleTag({
      content:
        '[data-padmap="xbox"] { --pad-lit: var(--pad-cap) !important; --pad-lit-ring: var(--pad-cap) !important; }',
    });
    await page.evaluate(() => window.dispatchEvent(new Event("planche:mesurer")));
  }

  // 1. Deux groupes, dix manettes, trois tailles chacune.
  const forme = await page.evaluate(() => ({
    groupes: [...document.querySelectorAll("[data-groupe]")].map((g) => g.dataset.groupe),
    manettes: [...document.querySelectorAll("[data-manette]")].map((m) => ({
      id: m.dataset.manette,
      tailles: [...m.querySelectorAll("[data-format]")].map((t) => t.dataset.format),
      ou: m.querySelector("[data-ou]")?.textContent ?? "",
    })),
    dessins: document.querySelectorAll("svg[data-padmap]").length,
  }));
  if (forme.groupes.join(",") !== "jeu,tenue") faute("forme", `groupes ${forme.groupes}`);
  if (forme.manettes.length !== 10) faute("forme", `${forme.manettes.length} manettes, 10 voulues`);
  if (forme.dessins !== 30) faute("forme", `${forme.dessins} dessins, 30 voulus`);
  for (const m of forme.manettes) {
    if (m.tailles.join(",") !== "grande,170,120") faute("forme", `${m.id} : tailles ${m.tailles}`);
  }
  for (const m of forme.manettes) if (!m.ou.trim()) faute("légende", `${m.id} sans endroit`);
  const ou = (id) => forme.manettes.find((m) => m.id === id)?.ou;
  if (ou("xbox360") !== XBOX_360) faute("légende", `xbox360 : « ${ou("xbox360")} »`);
  if (!ou("xbox") || ou("xbox").includes("360")) faute("légende", `xbox : « ${ou("xbox")} »`);

  // 2. Chaque pièce sur son boîtier.
  const geometrie = await page.evaluate(() => {
    const failing = [];
    for (const pad of document.querySelectorAll("svg[data-padmap]")) {
      const shell = pad.querySelector("path.n3-shell");
      if (!shell) continue;
      const rows = [];
      for (const part of pad.querySelectorAll("[data-part]")) {
        // Le capot lui-même : disque, pastille ou tracé exact. Le logement, la
        // garde et l'ombre d'un stick sont du décor autour, pas la pièce.
        const shape = part.querySelector(".n3-cap");
        if (!shape) {
          rows.push(`${part.dataset.part} n'a pas de capot`);
          continue;
        }
        const box = shape.getBBox();
        const probes = [
          [box.x + box.width / 2, box.y + box.height / 2],
          [box.x, box.y + box.height / 2],
          [box.x + box.width, box.y + box.height / 2],
          [box.x + box.width / 2, box.y],
          [box.x + box.width / 2, box.y + box.height],
        ];
        const inside = probes.filter(([x, y]) => shell.isPointInFill(new DOMPoint(x, y)));
        const out = probes.filter((probe) => !inside.includes(probe));
        const at = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        if (part.dataset.under === "oui") {
          if (!out.length) rows.push(`${part.dataset.part} est entièrement cachée par la coque`);
        } else if (part.dataset.hangs === "oui") {
          if (!inside.length) rows.push(`${part.dataset.part} ne touche pas la coque`);
          if (!out.length) rows.push(`${part.dataset.part} ne dépasse pas, elle n'a pas à le dire`);
        } else if (out.length) {
          rows.push(`${part.dataset.part} pend à ${at(out)}`);
        }
      }
      if (rows.length) failing.push(`${pad.dataset.padmap}: ${rows.join(" | ")}`);
    }
    return failing;
  });
  for (const ligne of geometrie) faute("géométrie", ligne);

  // 3. Les comptes d'inscriptions, mesurés ici et comparés à ceux affichés.
  const comptes = await page.evaluate(() =>
    [...document.querySelectorAll("[data-format]")].map((bloc) => {
      const svg = bloc.querySelector("svg[data-padmap]");
      const echelle = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width;
      const textes = [...svg.querySelectorAll("text[data-taille]")];
      const visibles = textes.filter((t) => getComputedStyle(t).visibility !== "hidden");
      const tailles = visibles.map(
        (t) => Number(t.getAttribute("font-size") ?? t.dataset.taille) * echelle,
      );
      const sortie = bloc.querySelector("[data-compte]");
      return {
        id: `${svg.dataset.padmap} ${bloc.dataset.format}`,
        taille: bloc.dataset.format,
        lisibles: visibles.length,
        masquees: textes.length - visibles.length,
        plusPetite: tailles.length ? Math.min(...tailles) : null,
        affiche: [sortie?.dataset.lisibles, sortie?.dataset.masquees].map(Number),
        texte: sortie?.textContent ?? "",
      };
    }),
  );
  for (const c of comptes) {
    if (c.affiche[0] !== c.lisibles || c.affiche[1] !== c.masquees) {
      faute("inscriptions", `${c.id} : affiche ${c.affiche}, mesuré ${c.lisibles},${c.masquees}`);
    }
    if (!c.texte.includes(`${c.masquees} masquées`)) faute("inscriptions", `${c.id} : « ${c.texte} »`);
    if (c.plusPetite !== null && c.plusPetite < 8.99) {
      faute("inscriptions", `${c.id} : une inscription visible de ${c.plusPetite.toFixed(1)} px`);
    }
    if (c.taille === "grande" && c.masquees > 0) faute("inscriptions", `${c.id} : masquée en grand`);
  }
  if (!comptes.some((c) => c.taille === "120" && c.masquees > 0)) {
    faute("inscriptions", "aucune inscription masquée à 120 px : le plancher ne mord pas");
  }

  // 4. L'appui le plus faible tient 3:1, dans les deux thèmes.
  for (const theme of ["nuit", "jour"]) {
    await page.click(`#theme-${theme}`);
    await attendre(150);
    const verdicts = await page.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      lignes: [...document.querySelectorAll("[data-manette]")].map((m) => {
        const c = m.querySelector("[data-contraste]");
        return { id: m.dataset.manette, ...c.dataset };
      }),
      echecs: Number(document.getElementById("bilan")?.dataset.echecs),
    }));
    if (verdicts.theme !== theme) faute("thème", `demandé ${theme}, posé ${verdicts.theme}`);
    const tombent = verdicts.lignes.filter((l) => l.verdict !== "tient");
    for (const l of tombent) {
      faute("contraste", `${l.id} ${theme} ${l.contraste}:1 (${l.ou}), ${l.verdict}`);
    }
    if (verdicts.echecs !== tombent.length) {
      faute("bilan", `${theme} : ${verdicts.echecs} annoncés, ${tombent.length} lus`);
    }
  }

  // 5. Les réglages : 44 px, aria-pressed, et ce qu'ils disent.
  const boutons = await page.evaluate(() =>
    [...document.querySelectorAll(".reglages button")].map((b) => {
      const r = b.getBoundingClientRect();
      return { id: b.id, w: r.width, h: r.height, presse: b.getAttribute("aria-pressed") };
    }),
  );
  if (boutons.length < 11) faute("réglages", `${boutons.length} boutons`);
  for (const b of boutons) {
    if (b.w < 44 || b.h < 44) faute("réglages", `${b.id} ${b.w.toFixed(0)}x${b.h.toFixed(0)}`);
    if (b.presse !== "true" && b.presse !== "false") faute("réglages", `${b.id} sans aria-pressed`);
  }
  const etat = () =>
    page.evaluate(() => ({
      parties: document.querySelectorAll("[data-part]").length,
      allumees: document.querySelectorAll('[data-part][data-lit="oui"]').length,
      inclines: [...document.querySelectorAll("[data-stick] > .n3-stick-body[data-drive]")].map(
        (b) => b.getAttribute("transform"),
      ),
      animations: document.getAnimations().length,
      cles: [...document.querySelectorAll("[data-part]")].map((p) => p.dataset.part).join(" "),
      bruts: [...document.querySelectorAll("text[data-taille]:not(.n3-callout)")].filter((t) =>
        /^[ba]\d+[+-]?$/.test(t.textContent ?? ""),
      ).length,
      encadrees: [...document.querySelectorAll("svg[data-padmap]")].map(
        (s) => s.querySelectorAll('[data-selected="oui"]').length,
      ),
      places: [...new Set([...document.querySelectorAll("svg[data-padmap]")].map((s) => s.dataset.place ?? "-"))],
    }));
  const presse = (id) => page.$eval(`#${id}`, (b) => b.getAttribute("aria-pressed"));
  const cliquer = async (id) => {
    await page.click(`#${id}`);
    await attendre(150);
  };

  const depart = await etat();
  if (depart.allumees !== 0) faute("réglages", `${depart.allumees} pièces allumées au départ`);
  if (depart.inclines.some((t) => t)) faute("réglages", "un stick incliné au départ");
  if (depart.encadrees.some((n) => n)) faute("réglages", "une touche encadrée au départ");
  if (depart.bruts !== 0) faute("réglages", `${depart.bruts} indices bruts au départ`);

  await cliquer("toutAllumer");
  const allume = await etat();
  if (allume.allumees !== allume.parties) {
    faute("réglages", `Tout allumer : ${allume.allumees} sur ${allume.parties}`);
  }
  if ((await presse("toutAllumer")) !== "true") faute("réglages", "Tout allumer non pressé");
  await cliquer("toutAllumer");
  if ((await etat()).allumees !== 0) faute("réglages", "Tout allumer ne s'éteint pas");

  await cliquer("incliner");
  const incline = await etat();
  if (!incline.inclines.length || incline.inclines.some((t) => !t)) {
    faute("réglages", `Incliner : ${incline.inclines.filter(Boolean).length} sur ${incline.inclines.length}`);
  }
  await attendre(1000);
  const apres = await etat();
  if (apres.animations !== 0) faute("réglages", `Incliner : ${apres.animations} animations après 1 s`);
  if (apres.inclines.join() !== incline.inclines.join()) faute("réglages", "Incliner bouge encore");
  await cliquer("incliner");

  await cliquer("indicesBruts");
  const brut = await etat();
  if (brut.bruts === 0) faute("réglages", "Indices bruts n'écrit aucun indice");
  if (brut.cles !== depart.cles) faute("réglages", "Indices bruts change les clés");
  await cliquer("indicesBruts");

  await cliquer("encadrer");
  const cadre = await etat();
  if (cadre.encadrees.some((n) => n !== 1)) faute("réglages", `Encadrer : ${cadre.encadrees}`);
  await cliquer("encadrer");

  await cliquer("place-2");
  if ((await etat()).places.join() !== "2") faute("réglages", "Place 2 n'est pas posée partout");
  await cliquer("place-aucune");
  if ((await etat()).places.join() !== "-") faute("réglages", "Aucune place laisse une place");
} finally {
  await browser.close();
}

if (fautes.length) {
  console.error("LA PLANCHE DES MANETTES ÉCHOUE :");
  for (const ligne of fautes) console.error(`  ${ligne}`);
  process.exit(1);
}
console.log("PASS — chaque pièce se pose sur son boîtier, comptes, contrastes et réglages justes");
