// La page de dépôt: estimer, retrouver, envoyer par morceaux, suivre.
//
// Un module, posé tel quel dans la page par `importer.py`. Il exporte
// `estimer` et `empreinteRapide`, qu'un essai exécute sous Node sur les mêmes
// octets que le serveur: l'empreinte doit être IDENTIQUE à l'octet près, sinon
// aucune reprise ne retrouverait son envoi; l'estimation doit dire la même
// console que le serveur partout où le début du fichier suffit.
//
// L'estimation n'est qu'une estimation, et la page l'écrit: le serveur relit
// toujours le fichier entier et c'est lui qui range.

/** Les 4 premiers et les 4 derniers Mio entrent dans l'empreinte rapide. */
export const BOUT = 4 * 1024 * 1024;
/** Ce que l'estimation lit du début: assez pour le secteur 32 d'une image Xbox. */
export const LU = 0x11000;
/** Un morceau d'envoi. Le serveur en accepte 32 Mio; 16 Mio perdent moins à
 * une coupure, et passent en six secondes à 20 Mbit/s. */
export const MORCEAU = 16 * 1024 * 1024;

const MAGIE_WII = 0x5d1c9ea3;
const MAGIE_GC = 0xc2339f3d;
const LOGO_GB = [
  0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d, 0x00, 0x0b, 0x03, 0x73, 0x00, 0x83, 0x00, 0x0c, 0x00, 0x0d,
  0x00, 0x08, 0x11, 0x1f, 0x88, 0x89, 0x00, 0x0e, 0xdc, 0xcc, 0x6e, 0xe6, 0xdd, 0xdd, 0xd9, 0x99,
  0xbb, 0xbb, 0x67, 0x63, 0x6e, 0x0e, 0xec, 0xcc, 0xdd, 0xdc, 0x99, 0x9f, 0xbb, 0xb9, 0x33, 0x3e,
];
const LOGO_GBA = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21];

/**
 * Le nom qu'une personne lit, pour chaque code de console.
 *
 * Le salon le pose dans la page (`#noms-consoles`, par `importer.py`), tiré du
 * manifeste des consoles et des consoles que l'identifiant reconnaît sans les
 * servir (`destinations.noms`). Ce module en gardait sa propre copie jusqu'au
 * 22 novembre 2026. Sans page, sous Node, ou avec un texte illisible: aucun
 * nom, et la carte dit le code de la console.
 */
export function nomsConsoles(page = globalThis.document) {
  const brut = page?.getElementById?.("noms-consoles")?.textContent;
  if (!brut) return {};
  try {
    const lus = JSON.parse(brut);
    return lus && typeof lus === "object" && !Array.isArray(lus) ? lus : {};
  } catch {
    return {};
  }
}

export const CONSOLES = nomsConsoles();

function egal(b, a, texte) {
  if (a + texte.length > b.length) return false;
  for (let i = 0; i < texte.length; i += 1) if (b[a + i] !== texte.charCodeAt(i)) return false;
  return true;
}
function egalOctets(b, a, octets) {
  if (a + octets.length > b.length) return false;
  return octets.every((v, i) => b[a + i] === v);
}
function be32(b, a) {
  return a + 4 <= b.length ? ((b[a] << 24) | (b[a + 1] << 16) | (b[a + 2] << 8) | b[a + 3]) >>> 0 : null;
}
function le32(b, a) {
  return a + 4 <= b.length ? (b[a] | (b[a + 1] << 8) | (b[a + 2] << 16) | (b[a + 3] << 24)) >>> 0 : null;
}
function le16(b, a) {
  return a + 2 <= b.length ? b[a] | (b[a + 1] << 8) : null;
}
function texte(b, a, n) {
  let s = "";
  for (let i = a; i < a + n && i < b.length; i += 1) {
    if (b[i] === 0) break;
    s += b[i] >= 32 && b[i] < 127 ? String.fromCharCode(b[i]) : " ";
  }
  return s.split(/\s+/).filter(Boolean).join(" ");
}
function r(console_, format, preuve, plus = {}) {
  return { console: console_, format, preuve, titre: "", ...plus };
}

function disque(b, a) {
  if (be32(b, a + 0x18) === MAGIE_WII) return "wii";
  if (be32(b, a + 0x1c) === MAGIE_GC) return "gc";
  return null;
}

/**
 * Ce qu'est probablement un fichier, d'après ses `LU` premiers octets.
 *
 * Les mêmes codes que le serveur (`identifier.py`). Ce que le début ne dit pas
 * (un GCZ à décompresser, une image Xbox 360 complète, une partition XCZ), le
 * serveur le lira: l'estimation répond alors sans console.
 */
export function estimer(b) {
  const tete = texte(b, 0, 4);
  if (egal(b, 0, "RVZ\u0001") || egal(b, 0, "WIA\u0001")) {
    const format = egal(b, 0, "RVZ\u0001") ? "rvz" : "wia";
    const type = be32(b, 0x48);
    const console_ = type === 1 ? "gc" : type === 2 ? "wii" : null;
    return r(console_, format, `type de disque ${type} à 0x48`, { titre: texte(b, 0x78, 64) });
  }
  if (le32(b, 0) === 0xb10bc001) return r(null, "gcz", "GCZ: la console se lit après décompression");
  if (egal(b, 0, "CISO")) {
    return r(disque(b, 0x8000), "ciso", "disque lu à 0x8000", { titre: texte(b, 0x8020, 64) });
  }
  if (egal(b, 0, "WBFS")) {
    const secteur = 1 << (b[8] ?? 0);
    const console_ = disque(b, secteur) === "wii" ? "wii" : null;
    return r(console_, "wbfs", "« WBFS » à 0", { titre: texte(b, secteur + 0x20, 64) });
  }
  if (egal(b, 0, "PFS0")) {
    const n = le32(b, 4) ?? 0;
    const longueur = le32(b, 8) ?? 0;
    const debut = 0x10 + 24 * n;
    const noms = lireNoms(b, debut, longueur);
    const format = noms.some((nom) => nom.endsWith(".ncz")) ? "nsz" : "nsp";
    return r("switch", format, `« PFS0 » à 0, ${n} fichiers`);
  }
  if (egal(b, 0, "NUP\u0001")) return r("switch2", "nup", "« NUP\\x01 » à 0, à vérifier");
  if (egal(b, 0, "XEX2")) return r("x360", "xex", "« XEX2 » à 0");
  if (tete === "CON" || tete === "LIVE" || tete === "PIRS") {
    const god = be32(b, 0x344) === 0x7000;
    return r("x360", god ? "god" : "stfs", `« ${tete} » à 0`);
  }
  if (egal(b, 0, "MComprHD")) return r(null, "chd", "« MComprHD » à 0");
  if (egal(b, 0, "PK\u0003\u0004") || egal(b, 0, "PK\u0005\u0006")) return r(null, "zip", "archive zip");
  if (egalOctets(b, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return r(null, "7z", "archive 7z");
  if (egal(b, 0, "Rar!\u001a\u0007")) return r(null, "rar", "archive rar");
  if (egal(b, 0, "NES\u001a")) return r("nes", ((b[7] ?? 0) & 0x0c) === 0x08 ? "nes2" : "ines", "« NES\\x1A » à 0");
  const nintendo = disque(b, 0);
  if (nintendo) {
    return r(nintendo, "iso", "image brute", { titre: texte(b, 0x20, 64), nkit: egal(b, 0x200, "NKIT") });
  }
  if (egal(b, 0x100, "HEAD") || egal(b, 0x1100, "HEAD")) return r("switch", "xci", "« HEAD » à 0x100");
  const n64 = be32(b, 0);
  const ordres = { 0x80371240: "z64", 0x37804012: "v64", 0x40123780: "n64" };
  if (n64 !== null && ordres[n64]) return r("n64", ordres[n64], "mot de tête N64");
  if (b[0xb2] === 0x96 && egalOctets(b, 4, LOGO_GBA)) {
    let somme = 0;
    for (let i = 0xa0; i < 0xbd; i += 1) somme += b[i];
    if (((-somme - 0x19) & 0xff) === b[0xbd]) return r("gba", "gba", "logo, 0x96 et complément", { titre: texte(b, 0xa0, 12) });
  }
  if (le16(b, 0x15c) === 0xcf56) return r("ds", "nds", "CRC du logo à 0x15C", { titre: texte(b, 0, 12) });
  if (egalOctets(b, 0x104, LOGO_GB)) {
    let somme = 0;
    for (let i = 0x134; i < 0x14d; i += 1) somme = (somme - b[i] - 1) & 0xff;
    if (somme === b[0x14d]) {
      const console_ = b[0x143] & 0x80 ? "gbc" : "gb";
      return r(console_, console_, "logo Nintendo à 0x104", { titre: texte(b, 0x134, 15) });
    }
  }
  if (egal(b, 0x100, "SEGA")) return r("md", "md", "« SEGA » à 0x100", { titre: texte(b, 0x150, 48) });
  if (egal(b, 0x10000, "MICROSOFT*XBOX*MEDIA")) return r(null, "xiso", "image Xbox: le serveur lit sa racine");
  for (const [secteur, debut] of [[2048, 0], [2352, 24], [2352, 16]]) {
    const a = 16 * secteur + debut;
    if (b[a] === 1 && egal(b, a + 1, "CD001")) {
      const systeme = texte(b, a + 8, 32);
      if (systeme !== "PLAYSTATION") return r(null, "iso9660", `système « ${systeme} »`);
      return r("ps1", secteur === 2352 ? "bin" : "iso", "« PLAYSTATION »: le serveur lit SYSTEM.CNF");
    }
  }
  return r(null, "inconnu", "aucune signature reconnue au début du fichier");
}

function lireNoms(b, debut, longueur) {
  const noms = [];
  let nom = "";
  for (let i = debut; i < Math.min(b.length, debut + longueur); i += 1) {
    if (b[i] === 0) {
      if (nom) noms.push(nom);
      nom = "";
    } else nom += String.fromCharCode(b[i]);
  }
  return noms;
}

function hex(tampon) {
  return [...new Uint8Array(tampon)].map((o) => o.toString(16).padStart(2, "0")).join("");
}

/**
 * L'empreinte rapide, exactement comme `empreinte.py`: SHA-256 des 4 premiers
 * Mio, des 4 derniers sans recouvrement, puis de la taille sur 8 octets
 * gros-boutistes. `fichier` est un `Blob`: un `File` de la page, ou un `Blob`
 * construit par l'essai.
 */
export async function empreinteRapide(fichier) {
  const taille = fichier.size;
  const tete = Math.min(taille, BOUT);
  const queue = Math.max(tete, taille - BOUT);
  const debut = new Uint8Array(await fichier.slice(0, tete).arrayBuffer());
  const fin = new Uint8Array(await fichier.slice(queue, taille).arrayBuffer());
  const tout = new Uint8Array(debut.length + fin.length + 8);
  tout.set(debut, 0);
  tout.set(fin, debut.length);
  new DataView(tout.buffer).setBigUint64(debut.length + fin.length, BigInt(taille), false);
  return hex(await crypto.subtle.digest("SHA-256", tout));
}

// ── La page ───────────────────────────────────────────────────────────────

const API = "/api/imports";
const POSES = {
  loupe: ["loupe", "loupe"],
  range: ["tampon", "salue"],
  reconnu: ["tampon", "repos"],
  pause: ["aucune", "dort"],
  rate: ["aucune", "essuie"],
};
const RETENTES = 8;

const nombre = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

export function octets(n) {
  if (n < 1024) return `${n} o`;
  const unites = ["Kio", "Mio", "Gio", "Tio"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < unites.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${nombre.format(v)} ${unites[i]}`;
}

export function duree(secondes) {
  if (!Number.isFinite(secondes)) return "";
  if (secondes < 60) return "moins d'une minute";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

async function lireJson(reponse) {
  try {
    return await reponse.json();
  } catch {
    return {};
  }
}

function attendre(ms) {
  return new Promise((fin) => setTimeout(fin, ms));
}

/**
 * La salle à rejoindre plutôt que d'en ouvrir une, ou `null`.
 *
 * Ouverte, ou en train de redémarrer pour un changement de jeu: une salle que
 * systemd relance vaut `ouverte: false, redemarre: true`
 * (`api/schemas/salle.py`). La première version n'acceptait que la première
 * forme, et ouvrait une seconde salle pendant le redémarrage de la première:
 * un autre émulateur sur la carte graphique commune, et le groupe séparé
 * (relecture du 22 novembre 2026).
 */
export function aRejoindre(salles) {
  if (!Array.isArray(salles)) return null;
  return salles.find((salle) => salle && (salle.ouverte || salle.redemarre) && typeof salle.chemin === "string") ?? null;
}

/**
 * Ce que dit le bouton qui suit un dépôt, d'après les salles.
 *
 * Le worker lit sa bibliothèque au démarrage seulement: une salle déjà ouverte
 * ne montre le jeu déposé qu'à son prochain changement de jeu. Le bouton la
 * nomme donc par ce qu'il fait, et dit quand le jeu apparaîtra. Sans salle à
 * rejoindre, il en ouvre une, qui lit le jeu au démarrage: « Jouer
 * maintenant » dit alors vrai.
 */
export function libelleJouer(salles) {
  const salle = aRejoindre(salles);
  if (!salle) return { texte: "Jouer maintenant", note: "" };
  return {
    texte: `Aller dans la salle ${salle.numero}`,
    note: "Le jeu apparaîtra au prochain changement de jeu.",
  };
}

/**
 * Où aller jouer après un dépôt (audit P14, 22 novembre 2026).
 *
 * Une salle ouverte ne relit pas sa bibliothèque avant son prochain changement
 * de jeu: elle ne montre donc pas tout de suite le jeu rangé. Une salle qu'on
 * OUVRE le lit au démarrage. Sans salle à rejoindre (`aRejoindre`), on en
 * ouvre une; avec une salle ouverte ou qui redémarre, on la rejoint plutôt que
 * d'en allumer une seconde sur la même carte graphique, et le bouton le dit
 * (`libelleJouer`). Rend l'adresse où aller, avec `?entrer=jouer`, et la
 * raison d'un refus.
 *
 * `demander` est `fetch`, remplacé dans l'essai.
 */
export async function ouJouer(demander = fetch) {
  try {
    const liste = await demander("/api/salles", { cache: "no-store" });
    const salles = liste.ok ? await lireJson(liste) : [];
    const ouverte = aRejoindre(salles);
    if (ouverte) return { vers: `${ouverte.chemin}?entrer=jouer`, ouverte: true };
    const ouvre = await demander("/api/salles", { method: "POST" });
    const dit = await lireJson(ouvre);
    if (ouvre.ok && typeof dit.chemin === "string") return { vers: `${dit.chemin}?entrer=jouer`, ouverte: false };
    return { vers: null, refus: dit.detail ?? "la salle n'a pas voulu s'ouvrir" };
  } catch {
    return { vers: null, refus: "pas de réponse, réessaie dans un instant" };
  }
}

/** Un morceau par XMLHttpRequest: c'est le seul à dire où en est l'envoi. */
function envoyerMorceau(url, corps, progres) {
  const xhr = new XMLHttpRequest();
  const promesse = new Promise((fin, echec) => {
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => progres(e.loaded);
    xhr.onload = () => {
      let corpsLu = {};
      try {
        corpsLu = JSON.parse(xhr.responseText || "{}");
      } catch {
        corpsLu = {};
      }
      fin({ status: xhr.status, json: corpsLu });
    };
    xhr.onerror = () => echec(new Error("réseau"));
    xhr.onabort = () => echec(new DOMException("arrêté", "AbortError"));
    xhr.send(corps);
  });
  return { promesse, arreter: () => xhr.abort() };
}

class Carte {
  constructor(liste, modele, rang) {
    this.noeud = modele.content.firstElementChild.cloneNode(true);
    this.noeud.style.setProperty("--joueur", `var(--joueur-${(rang % 4) + 1})`);
    this.ici = (cle) => this.noeud.querySelector(`[data-ici="${cle}"]`);
    liste.prepend(this.noeud);
    this.fichier = null;
    this.envoi = null;
    this.etat = "estimation";
    this.enCours = null;
    this.mesures = [];
    this.ici("pause").addEventListener("click", () => this.basculer());
    this.ici("annuler").addEventListener("click", () => this.annuler());
    this.ici("jouer").addEventListener("click", async () => {
      const bouton = this.ici("jouer");
      bouton.disabled = true;
      const ou = await ouJouer();
      if (ou.vers) return location.assign(ou.vers);
      bouton.disabled = false;
      this.dire(ou.refus, true);
    });
  }

  pose(nom) {
    const [tenue, pose] = POSES[nom];
    for (const dessin of this.noeud.querySelectorAll("[data-tenue]")) {
      dessin.hidden = dessin.dataset.tenue !== tenue;
      dessin.querySelector("svg")?.setAttribute("data-pose", pose);
    }
  }

  dire(texteDit, alerte = false) {
    const ligne = this.ici("etat");
    ligne.textContent = texteDit;
    ligne.dataset.alerte = alerte ? "oui" : "non";
  }

  boutons({ pause = false, reprendre = false, annuler = false } = {}) {
    const bouton = this.ici("pause");
    bouton.hidden = !(pause || reprendre);
    bouton.textContent = reprendre ? "reprendre" : "pause";
    this.ici("annuler").hidden = !annuler;
  }

  progres(recus, taille) {
    const part = taille ? recus / taille : 0;
    this.ici("barre").style.transform = `scaleX(${part})`;
    this.ici("compte").textContent = `${Math.floor(part * 100)} % · ${octets(recus)} sur ${octets(taille)}`;
    const maintenant = performance.now();
    this.mesures.push([maintenant, recus]);
    while (this.mesures.length > 2 && maintenant - this.mesures[0][0] > 8000) this.mesures.shift();
    const [t0, o0] = this.mesures[0];
    const debit = maintenant > t0 ? ((recus - o0) * 1000) / (maintenant - t0) : 0;
    this.ici("debit").textContent =
      debit > 0 && recus < taille
        ? `${octets(Math.round(debit))}/s · reste ${duree((taille - recus) / debit)}`
        : "";
  }

  estimation(trouve) {
    this.ici("nature").textContent = trouve.console
      ? `${CONSOLES[trouve.console] ?? trouve.console} · ${trouve.format.toUpperCase()}`
      : trouve.format === "inconnu"
        ? "console non reconnue au début du fichier"
        : `${trouve.format.toUpperCase()} · console lue par le serveur`;
    this.ici("titre").textContent = trouve.titre || "";
  }

  async demarrer(fichier) {
    this.fichier = fichier;
    this.ici("nom").textContent = fichier.name;
    this.ici("compte").textContent = octets(fichier.size);
    this.pose("loupe");
    this.dire("lecture du début du fichier…");
    const debut = new Uint8Array(await fichier.slice(0, LU).arrayBuffer());
    this.estimation(estimer(debut));
    this.dire("calcul de l'empreinte rapide…");
    const empreinte = await empreinteRapide(fichier);
    const reponse = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nom: fichier.name, taille: fichier.size, empreinte_rapide: empreinte }),
    });
    const dit = await lireJson(reponse);
    if (reponse.status === 201) {
      this.envoi = dit;
      return this.envoyer();
    }
    const detail = dit.detail ?? {};
    if (reponse.status === 409 && detail.raison === "en-cours" && detail.id) {
      fantomes.get(detail.id)?.remove();
      this.envoi = { id: detail.id, taille: fichier.size, decalage: detail.decalage };
      if (detail.etat === "envoi") return this.envoyer();
      return this.suivre();
    }
    // Refusé dès l'annonce: rien n'existe sur le serveur, « retirer » ne fait
    // qu'enlever la carte.
    this.pose("rate");
    this.boutons({ annuler: true });
    this.ici("annuler").textContent = "retirer";
    if (reponse.status === 409 && detail.raison === "deja-la") {
      this.etat = "fini";
      this.ici("barre").style.transform = "scaleX(1)";
      return this.dire(`Déjà dans la bibliothèque: ${detail.fichier}.`, true);
    }
    this.etat = "rate";
    this.dire(detail.message ?? (typeof detail === "string" ? detail : `refus ${reponse.status}`), true);
  }

  async envoyer() {
    this.etat = "envoi";
    this.pose("loupe");
    this.boutons({ pause: true, annuler: true });
    this.dire("envoi en cours");
    let decalage = this.envoi.decalage;
    let ratees = 0;
    const taille = this.fichier.size;
    this.progres(decalage, taille);
    while (decalage < taille) {
      if (this.etat !== "envoi") return;
      const fin = Math.min(taille, decalage + MORCEAU);
      const morceau = envoyerMorceau(
        `${API}/${this.envoi.id}?decalage=${decalage}`,
        this.fichier.slice(decalage, fin),
        (lus) => this.progres(decalage + lus, taille),
      );
      this.enCours = morceau;
      try {
        const { status, json } = await morceau.promesse;
        this.enCours = null;
        if (status === 200) {
          decalage = json.decalage;
          ratees = 0;
          continue;
        }
        const detail = json.detail ?? {};
        if ((status === 409 || status === 400) && typeof detail.decalage === "number") {
          // Le serveur dit où il en est vraiment: on repart de là.
          decalage = detail.decalage;
          continue;
        }
        if (status >= 500 && status !== 507 && ratees < RETENTES) throw new Error(String(status));
        this.etat = "rate";
        this.pose("rate");
        this.boutons({ annuler: true });
        return this.dire(detail.message ?? `refus ${status}`, true);
      } catch (erreur) {
        this.enCours = null;
        if (erreur.name === "AbortError") return;
        ratees += 1;
        if (ratees > RETENTES) {
          this.etat = "pause";
          this.pose("pause");
          this.boutons({ reprendre: true, annuler: true });
          return this.dire("La connexion a coupé. « reprendre » repart d'où le serveur en est.", true);
        }
        this.dire(`connexion coupée, nouvel essai (${ratees}/${RETENTES})…`, true);
        await attendre(Math.min(30000, 1000 * 2 ** (ratees - 1)));
        decalage = await this.decalageServeur(decalage);
      }
    }
    this.progres(taille, taille);
    return this.terminer();
  }

  async decalageServeur(repli) {
    try {
      const reponse = await fetch(`${API}/${this.envoi.id}`, { cache: "no-store" });
      if (reponse.ok) return (await reponse.json()).decalage;
    } catch {
      // Le serveur ne répond toujours pas: on garde ce qu'on croyait.
    }
    return repli;
  }

  async terminer() {
    this.boutons({ annuler: true });
    this.dire("vérification par le serveur: empreinte complète, console, rangement…");
    const reponse = await fetch(`${API}/${this.envoi.id}/fin`, { method: "POST" });
    if (!reponse.ok && reponse.status !== 202) {
      const detail = (await lireJson(reponse)).detail ?? {};
      this.etat = "rate";
      this.pose("rate");
      return this.dire(detail.message ?? `refus ${reponse.status}`, true);
    }
    return this.suivre();
  }

  async suivre() {
    this.etat = "verification";
    this.pose("loupe");
    this.boutons();
    for (;;) {
      const reponse = await fetch(`${API}/${this.envoi.id}`, { cache: "no-store" });
      const envoi = await lireJson(reponse);
      if (!reponse.ok) return this.dire("le serveur ne retrouve plus cet envoi", true);
      if (envoi.etat === "envoi") {
        this.envoi = envoi;
        return this.fichier ? this.envoyer() : this.montrer(envoi);
      }
      if (envoi.etat === "termine" || envoi.etat === "erreur") return this.montrer(envoi);
      this.dire("vérification par le serveur…");
      await attendre(1000);
    }
  }

  /** Ce que le serveur a reconnu et fait. C'est le seul verdict qui compte. */
  montrer(envoi) {
    this.envoi = envoi;
    this.etat = "fini";
    this.ici("nom").textContent = this.fichier?.name ?? envoi.nom;
    this.ici("barre").style.transform = `scaleX(${envoi.taille ? envoi.decalage / envoi.taille : 0})`;
    this.ici("compte").textContent = octets(envoi.taille);
    this.ici("debit").textContent = "";
    this.ici("estimation").hidden = true;
    this.boutons({ annuler: true });
    this.ici("annuler").textContent = "retirer";
    if (envoi.etat === "erreur") {
      this.pose("rate");
      return this.dire(envoi.message || "la vérification a échoué", true);
    }
    if (envoi.etat === "envoi") {
      this.pose("pause");
      this.ici("estimation").hidden = false;
      this.ici("nature").textContent = "interrompu";
      return this.dire(`Arrêté à ${Math.floor((envoi.decalage / envoi.taille) * 100)} %. Redépose « ${envoi.nom} » pour reprendre.`);
    }
    const resultats = this.ici("resultats");
    resultats.replaceChildren();
    for (const element of envoi.elements) resultats.append(resultat(element));
    const range = envoi.elements.some((e) => e.etat === "range");
    const reconnu = envoi.elements.some((e) => e.console);
    this.pose(range ? "range" : reconnu ? "reconnu" : "rate");
    // Un jeu rangé se joue: le dépôt finit sur l'action, pas sur une phrase.
    this.ici("jouer").hidden = !range;
    if (range) void this.nommerJouer();
    this.dire(envoi.elements.length > 1 ? `${envoi.elements.length} fichiers dans l'archive` : "");
  }

  /** Le bouton dit ce qu'il fera: rejoindre une salle ouverte, ou en ouvrir
   * une (`libelleJouer`). Sans réponse du salon, il garde son premier mot. */
  async nommerJouer() {
    try {
      const reponse = await fetch("/api/salles", { cache: "no-store" });
      if (!reponse.ok) return;
      const dit = libelleJouer(await lireJson(reponse));
      this.ici("jouer").textContent = dit.texte;
      const note = this.ici("jouer-note");
      note.textContent = dit.note;
      note.hidden = dit.note === "";
    } catch {
      // Le bouton garde « Jouer maintenant », et `ouJouer` décide au clic.
    }
  }

  basculer() {
    if (this.etat === "envoi") {
      this.etat = "pause";
      this.enCours?.arreter();
      this.pose("pause");
      this.boutons({ reprendre: true, annuler: true });
      this.dire("en pause");
    } else if (this.etat === "pause") {
      this.decalageServeur(this.envoi.decalage).then((decalage) => {
        this.envoi.decalage = decalage;
        this.envoyer();
      });
    }
  }

  async annuler() {
    const avant = this.etat;
    this.etat = "annule";
    this.enCours?.arreter();
    if (this.envoi?.id) {
      const reponse = await fetch(`${API}/${this.envoi.id}`, { method: "DELETE" });
      if (!reponse.ok && reponse.status !== 404) {
        this.etat = avant;
        const detail = (await lireJson(reponse)).detail ?? {};
        return this.dire(detail.message ?? `refus ${reponse.status}`, true);
      }
    }
    this.noeud.dataset.part = "oui";
    setTimeout(() => this.noeud.remove(), 250);
  }

  remove() {
    this.noeud.remove();
  }
}

/** Une ligne de résultat: le tampon de la console, l'état, et ce qui suit. */
function resultat(element) {
  const ligne = document.createElement("div");
  ligne.className = "resultat";
  ligne.dataset.etat = element.etat;
  const tampon = document.createElement("span");
  tampon.className = "tampon";
  tampon.textContent = element.console ? element.console_libelle : element.format === "inconnu" ? "?" : element.format.toUpperCase();
  const corps = document.createElement("div");
  const haut = document.createElement("p");
  haut.className = "resultat-etat";
  const quoi = [element.libelle];
  if (element.titre) quoi.push(`« ${element.titre} »`);
  if (element.destination) quoi.push(`dans ${element.destination}`);
  haut.textContent = quoi.join(" · ");
  const bas = document.createElement("p");
  bas.className = "resultat-mot";
  bas.textContent = element.message;
  const preuve = document.createElement("p");
  preuve.className = "resultat-preuve";
  preuve.textContent = [element.nom, element.preuve].filter(Boolean).join(" · ");
  corps.append(haut, bas, preuve);
  ligne.append(tampon, corps);
  return ligne;
}

// ── Le trousseau: qui a la clé du quai (administrateur seulement) ─────────

const CLES = "/api/importeurs";

/** Une des quatre couleurs de prise, tirée de l'adresse: toujours la même. */
export function priseDe(login) {
  let h = 0;
  for (const c of login) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return (h % 4) + 1;
}

/** Le nom qu'on montre: le pseudo du salon, puis celui du fournisseur, puis l'adresse. */
export function nomDe(personne) {
  return personne.pseudo || personne.nom || personne.login.split("@")[0];
}

/** Les petites étiquettes sous le nom, dans l'ordre où on les lit. */
export function pucesDe(personne) {
  const puces = [];
  if (personne.droit === "configuration") puces.push(["CONFIGURATION", false]);
  if (personne.sources.includes("tailnet")) {
    puces.push([personne.partage ? "INVITÉ PAR PARTAGE" : "TAILNET", false]);
  }
  if (personne.sources.includes("salon")) puces.push(["DÉJÀ VENU", false]);
  if (personne.en_ligne) puces.push(["EN LIGNE", true]);
  if (personne.appareils > 1) puces.push([`${personne.appareils} APPAREILS`, false]);
  if (personne.sources.length === 0 && personne.droit === "nomme") {
    puces.push(["PLUS SUR LE TAILNET", false]);
  }
  return puces;
}

/** Le rang d'une ligne dans sa colonne: même ordre que le serveur. */
export function rangDe(personne) {
  const ordre = { administrateur: 0, configuration: 1, nomme: 2, aucun: 3 };
  return `${ordre[personne.droit]}${nomDe(personne).toLocaleLowerCase("fr")}`;
}

const reduit = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Déplace des lignes en les faisant glisser de leur ancienne place à la
 * nouvelle (premier, dernier, inverse, joue). Seul `transform` bouge.
 */
function glisser(lignes, deplacer) {
  const avant = new Map(lignes.map((li) => [li, li.getBoundingClientRect()]));
  deplacer();
  if (reduit()) return;
  for (const li of lignes) {
    const a = avant.get(li);
    const b = li.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (dx === 0 && dy === 0) continue;
    li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: 420,
      easing: "cubic-bezier(.2, .7, .3, 1)",
    });
  }
}

class Trousseau {
  constructor(racine) {
    this.racine = racine;
    this.avec = racine.querySelector("#avec-cle");
    this.sans = racine.querySelector("#sans-cle");
    this.avis = racine.querySelector("#cles-avis");
    this.dit = racine.querySelector("#cles-dit");
    this.bobine = racine.querySelector("#cles-bobine svg");
    this.modele = document.getElementById("modele-personne");
    this.lignes = new Map();
    this.ecrire = true;
    this.minuteur = 0;
  }

  async ouvrir() {
    const reponse = await fetch(CLES, { cache: "no-store" });
    if (!reponse.ok) return;
    const liste = await lireJson(reponse);
    this.ecrire = liste.registre_lisible !== false;
    const avis = [];
    if (liste.tailnet === false) {
      avis.push(
        "tailscaled n'a pas répondu: la liste ne montre que les personnes déjà venues et celles qui ont la clé.",
      );
    }
    if (!this.ecrire) {
      avis.push(
        "Le fichier des droits ne se lit pas, donc rien n'y sera écrit. Répare-le ou retire-le, puis redémarre le salon.",
      );
    }
    this.avis.textContent = avis.join(" ");
    this.avis.dataset.alerte = this.ecrire ? "non" : "oui";
    this.avis.hidden = avis.length === 0;
    for (const personne of liste.personnes ?? []) this.poser(personne);
    this.racine.hidden = false;
  }

  poser(personne) {
    const li = this.modele.content.firstElementChild.cloneNode(true);
    li.style.setProperty("--prise", `var(--joueur-${priseDe(personne.login)})`);
    li.querySelector('[data-ici="bouton"]').addEventListener("click", () => this.basculer(li));
    this.lignes.set(personne.login, li);
    this.remplir(li, personne);
    this.colonneDe(personne).append(li);
  }

  colonneDe(personne) {
    return personne.droit === "aucun" ? this.sans : this.avec;
  }

  remplir(li, personne) {
    li.personne = personne;
    li.dataset.rang = rangDe(personne);
    li.dataset.cle = personne.droit === "aucun" ? "non" : "oui";
    li.querySelector('[data-ici="nom"]').textContent = nomDe(personne);
    li.querySelector('[data-ici="adresse"]').textContent = personne.login;
    const puces = li.querySelector('[data-ici="puces"]');
    puces.replaceChildren(
      ...pucesDe(personne).map(([mot, vert]) => {
        const span = document.createElement("span");
        span.className = "puce";
        span.textContent = mot;
        if (vert) span.dataset.enLigne = "oui";
        return span;
      }),
    );
    const tampon = li.querySelector('[data-ici="tampon"]');
    const bouton = li.querySelector('[data-ici="bouton"]');
    const mots = { administrateur: "ADMIN", configuration: "FIXÉ", nomme: "CLÉ" };
    tampon.textContent = mots[personne.droit] ?? "";
    tampon.hidden = personne.droit === "aucun";
    const modifiable = personne.droit === "nomme" || personne.droit === "aucun";
    bouton.hidden = !modifiable;
    bouton.disabled = !this.ecrire;
    bouton.textContent = personne.droit === "nomme" ? "reprendre la clé" : "donner la clé";
    bouton.setAttribute(
      "aria-label",
      `${bouton.textContent} à ${nomDe(personne)} (${personne.login})`,
    );
  }

  /** Bobine joue une pose, puis revient au repos. */
  jouer(pose, duree) {
    if (!this.bobine) return;
    clearTimeout(this.minuteur);
    this.bobine.setAttribute("data-pose", pose);
    this.minuteur = setTimeout(() => this.bobine.setAttribute("data-pose", "repos"), duree);
  }

  async basculer(li) {
    const avant = li.personne;
    const donner = avant.droit === "aucun";
    const bouton = li.querySelector('[data-ici="bouton"]');
    bouton.disabled = true;
    this.dire("");
    let reponse;
    try {
      reponse = await fetch(`${CLES}/${encodeURIComponent(avant.login)}`, {
        method: donner ? "PUT" : "DELETE",
      });
    } catch {
      reponse = null;
    }
    if (!reponse?.ok) {
      const detail = reponse ? (await lireJson(reponse)).detail : null;
      this.dire(`Rien n'a changé: ${detail ?? "le salon n'a pas répondu"}.`, true);
      bouton.disabled = !this.ecrire;
      return;
    }
    const apres = await lireJson(reponse);
    this.jouer(donner ? "pousse" : "tire", donner ? 900 : 700);
    if (donner) setTimeout(() => this.jouer("salue", 1000), 420);
    this.remplir(li, apres);
    const cible = this.colonneDe(apres);
    const toutes = [...this.avec.children, ...this.sans.children];
    glisser(toutes, () => {
      const suivante = [...cible.children].find(
        (autre) => autre !== li && autre.dataset.rang > li.dataset.rang,
      );
      cible.insertBefore(li, suivante ?? null);
    });
    this.dire(
      donner
        ? `${nomDe(apres)} peut maintenant déposer des jeux.`
        : `${nomDe(apres)} ne peut plus déposer de jeux.`,
    );
    li.querySelector('[data-ici="bouton"]').focus({ preventScroll: true });
  }

  dire(texte, alerte = false) {
    this.dit.textContent = texte;
    this.dit.dataset.alerte = alerte ? "oui" : "non";
  }
}

const fantomes = new Map();

async function demarrerPage() {
  const liste = document.getElementById("cartes");
  const modele = document.getElementById("modele-carte");
  const zone = document.getElementById("depot");
  const entree = document.getElementById("fichiers");
  const refus = document.getElementById("refus");
  const bobineZone = zone.querySelector("svg");
  let rang = 0;

  const droits = await fetch(`${API}/droits`, { cache: "no-store" }).then(lireJson);
  if (!droits.peut_importer) {
    zone.hidden = true;
    refus.hidden = false;
    return;
  }
  // La liste ne s'ouvre que pour l'administrateur; l'API la refuse à tout autre.
  if (droits.administrateur) {
    new Trousseau(document.getElementById("cles")).ouvrir().catch(() => {});
  }

  const deposer = (fichiers) => {
    for (const fichier of fichiers) {
      const carte = new Carte(liste, modele, rang);
      rang += 1;
      carte.demarrer(fichier).catch((erreur) => {
        carte.pose("rate");
        carte.dire(`échec: ${erreur.message}`, true);
      });
    }
  };
  entree.addEventListener("change", () => {
    deposer([...entree.files]);
    entree.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      zone.dataset.survol = "oui";
      bobineZone?.setAttribute("data-pose", "loupe");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, (e) => {
      e.preventDefault();
      if (type === "dragleave" && zone.contains(e.relatedTarget)) return;
      zone.dataset.survol = "non";
      bobineZone?.setAttribute("data-pose", "repos");
    });
  }
  zone.addEventListener("drop", (e) => deposer([...(e.dataTransfer?.files ?? [])]));
  // Un fichier lâché à côté de la zone ne doit pas faire quitter la page.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  // Les envois d'avant le rechargement: terminés, ou à reprendre en redéposant.
  const anciens = await fetch(API, { cache: "no-store" }).then((r) => (r.ok ? r.json() : []));
  for (const envoi of anciens) {
    const carte = new Carte(liste, modele, rang);
    rang += 1;
    carte.montrer(envoi);
    if (envoi.etat === "envoi") fantomes.set(envoi.id, carte);
    if (envoi.etat === "verification") carte.suivre();
  }
}

if (typeof document !== "undefined") {
  demarrerPage();
}
