// Ce que la page d'ENTRÉE montre vraiment, mesuré au lieu d'être calculé.
//
// Le trou que ce fichier bouche. `contraste.mjs` et `debordement.mjs` appellent
// tous les deux `enterRoom(page)` juste après `goto`, puis ouvrent le menu: ils
// mesurent DANS la salle. La page qu'on voit AVANT d'entrer n'est donc vue par
// aucun des deux, et ça vaut pour ses trois dessins. Le 13 septembre 2026, les
// rapports de contraste du dessin « câbles » ont été écrits dans son en-tête à
// partir d'un calcul sur des couleurs choisies, jamais d'une mesure dans un
// rendu. Ce pilote est là pour que ce ne soit plus vrai.
//
// Il s'arrête donc AVANT `enterRoom`, et c'est tout son intérêt.
//
//   node lobby-visuel.mjs [adresse]
import puppeteer from "puppeteer";

const url = process.argv[2] ?? process.env.NEL3AB_URL ?? "http://localhost:8110/";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// Les trois dessins, nommés comme `LOBBIES` les nomme. Si une entrée est
// ajoutée là-bas sans l'être ici, ce pilote mesurera un dessin de moins sans
// rien dire: c'est la limite connue, et elle est écrite plutôt que tue.
const DESSINS = ["classique", "cables", "sol"];

// Deux largeurs, parce que ces dessins changent de forme au point de rupture:
// « câbles » passe d'une rangée à une colonne, « au sol » replie ses chaises.
// Une seule largeur ne verrait que la moitié des cas.
const LARGEURS = [
  { width: 1440, height: 900 },
  { width: 430, height: 930 },
];

const mesurer = () =>
  page.evaluate(() => {
    const lire = (couleur) => {
      const n = (couleur.match(/[\d.]+/g) ?? []).map(Number);
      if (n.length < 3) return null;
      return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    };
    // Composer un calque sur un autre. L'alpha s'accumule: c'est précisément ce
    // qu'aucun fichier source ne montre, et la raison d'être d'une mesure.
    const sur = (haut, bas) => {
      const a = haut[3];
      return [0, 1, 2].map((i) => haut[i] * a + bas[i] * (1 - a)).concat(1);
    };
    const luminance = (c) => {
      const v = c.slice(0, 3).map((x) => {
        const s = x / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const rapport = (a, b) => {
      const x = luminance(a);
      const y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    // Le fond EFFECTIF: le premier ancêtre qui peint, puis tous ceux au-dessus.
    // On part du blanc du navigateur, pas d'une couleur supposée du thème.
    const fondDe = (el) => {
      const pile = [];
      for (let n = el; n; n = n.parentElement) pile.push(n);
      let fond = [255, 255, 255, 1];
      for (const n of pile.reverse()) {
        const c = lire(getComputedStyle(n).backgroundColor);
        if (c && c[3] > 0) fond = sur(c, fond);
      }
      return fond;
    };

    // L'opacité des ancêtres se multiplie et s'applique AUSSI au texte.
    const opaciteDe = (el) => {
      let o = 1;
      for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity || 1);
      return o;
    };

    const faibles = [];
    const coupes = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      // Le DÉBORDEMENT horizontal, dès le premier pixel: c'est là que les
      // libellés se coupent. Ce qui défile est censé dépasser.
      const defile = /auto|scroll/.test(style.overflow + style.overflowX);
      const large = el.scrollWidth - el.clientWidth;
      if (!defile && large > 1) {
        const t = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 44);
        if (t) coupes.push({ quoi: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""), large, texte: t });
      }

      // Le CONTRASTE, sur les seules boîtes qui portent du texte en propre.
      const propre = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(" ")
        .trim();
      if (!propre) continue;
      const encre = lire(style.color);
      if (!encre) continue;
      const fond = fondDe(el);
      const opacite = opaciteDe(el);
      if (opacite === 0) continue;
      const vue = sur([encre[0], encre[1], encre[2], encre[3] * opacite], fond);
      const taille = Number.parseFloat(style.fontSize);
      const gras = Number(style.fontWeight) >= 700;
      // Les seuils WCAG AA: 3:1 pour du gros texte, 4,5:1 sinon.
      const seuil = taille >= 24 || (taille >= 18.66 && gras) ? 3 : 4.5;
      const r = rapport(vue, fond);
      if (r + 0.005 < seuil) {
        faibles.push({
          quoi: el.tagName.toLowerCase() + (el.id ? "#" + el.id : ""),
          texte: propre.slice(0, 44),
          rapport: Math.round(r * 100) / 100,
          seuil,
          taille: Math.round(taille),
        });
      }
    }
    return {
      faibles,
      coupes,
      page_deborde: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
let page;
const soucis = [];

for (const dessin of DESSINS) {
  page = await browser.newPage();
  await page.setViewport(LARGEURS[0]);
  // Semé AVANT la navigation, comme `contraste.mjs` sème sa coque: une clé
  // posée après le chargement arriverait trop tard pour le premier rendu.
  await page.evaluateOnNewDocument((choix) => {
    localStorage.setItem("nel3ab:name", "banc");
    localStorage.setItem("nel3ab:banc", "1");
    localStorage.setItem("nel3ab:lobby", choix);
  }, dessin);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await attendre(2500);

  // On VÉRIFIE qu'on regarde le bon écran avant de mesurer. Sans ce contrôle,
  // une clé mal orthographiée ou un repli silencieux sur « classique » rendrait
  // un vert obtenu en mesurant trois fois la même page.
  const vu = await page.evaluate(() => ({
    look: document.querySelector("#room")?.getAttribute("data-look") ?? null,
    entrer: document.querySelectorAll("#enter").length,
    regarder: document.querySelectorAll("#watch").length,
  }));
  if (vu.look !== dessin) {
    console.log(`RIEN MESURÉ — demandé « ${dessin} », la page rend « ${vu.look} »`);
    await browser.close();
    process.exit(1);
  }
  // Un seul bouton d'entrée dans le DOM: deux points de rupture qui rendent
  // tous les deux les commandes en mettaient deux, dont un caché.
  if (vu.entrer !== 1 || vu.regarder !== 1) {
    soucis.push(`${dessin}: ${vu.entrer} #enter et ${vu.regarder} #watch dans le DOM, il en faut un de chaque`);
  }

  for (const taille of LARGEURS) {
    await page.setViewport(taille);
    await attendre(900);
    const m = await mesurer();
    console.log(`  ${dessin} à ${taille.width}px : ${m.faibles.length} texte(s) sous le seuil, ${m.coupes.length} coupé(s), la page déborde de ${m.page_deborde}px`);
    for (const f of m.faibles) {
      console.log(`    FAIBLE ${f.quoi} ${f.taille}px « ${f.texte} » ${f.rapport}:1 < ${f.seuil}:1`);
      soucis.push(`${dessin} ${taille.width}px: « ${f.texte} » à ${f.rapport}:1 sous ${f.seuil}:1`);
    }
    for (const c of m.coupes) {
      console.log(`    COUPÉ  ${c.quoi} « ${c.texte} » dépasse de ${c.large}px`);
      soucis.push(`${dessin} ${taille.width}px: « ${c.texte} » coupé de ${c.large}px`);
    }
    if (m.page_deborde > 1) soucis.push(`${dessin} ${taille.width}px: la page déborde de ${m.page_deborde}px`);
  }
  await page.close();
}

await browser.close();
console.log(
  soucis.length === 0
    ? `PASS — ${DESSINS.length} dessins × ${LARGEURS.length} largeurs, rien sous le seuil, rien de coupé`
    : `FAIL — ${soucis.length} souci(s)`,
);
process.exit(soucis.length === 0 ? 0 : 1);
