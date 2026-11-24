/**
 * Le code QR de « Inviter quelqu'un » (23 novembre 2026).
 *
 * `lib/invitation` l'avait écarté le 22 novembre : « il faudrait un encodeur,
 * soit une dépendance, soit trois cents lignes à prouver ». Celui-ci est porté
 * de la maquette du chantier personnes (`ecrans/personnes/qr.js`), et il est
 * prouvé module par module : `qr.test.ts` compare ses matrices à une référence
 * figée (`qr-reference.json`), écrite par l'encodeur de Kazuhiko Arase (licence
 * MIT, livré par npm dans `qrcode-terminal`) pour 28 liens de 1 à 178 octets,
 * chacun sous les huit masques (`front/qr-reference.mjs` la réécrit).
 *
 * Portée volontairement étroite : mode octet, niveau de correction M,
 * versions 1 à 9, 180 octets au plus. Un lien de salle en fait une
 * cinquantaine. Un lien plus long est REFUSÉ, pas coupé : un code qui mène à
 * une moitié d'adresse serait pire que pas de code.
 *
 * Le module n'est évalué qu'à l'ouverture de l'invitation (`CodeQR`, import
 * dynamique). Ses octets sont tout de même dans la page : la construction en
 * un seul fichier y inline les imports dynamiques (ADR D13).
 */

/** Les blocs de Reed-Solomon du niveau M : octets de correction par bloc, puis
 * [nombre de blocs, octets de données] par groupe (ISO/IEC 18004, tableau 9). */
const BLOCS: Record<number, readonly [number, readonly (readonly [number, number])[]]> = {
  1: [10, [[1, 16]]],
  2: [16, [[1, 28]]],
  3: [26, [[1, 44]]],
  4: [18, [[2, 32]]],
  5: [24, [[2, 43]]],
  6: [16, [[4, 27]]],
  7: [18, [[4, 31]]],
  8: [
    22,
    [
      [2, 38],
      [2, 39],
    ],
  ],
  9: [
    22,
    [
      [3, 36],
      [2, 37],
    ],
  ],
};
/** Les centres des motifs d'alignement, par version (tableau E.1). */
const ALIGN: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
};

/** La version la plus grande que ce module sait écrire. */
export const VERSION_MAX = 9;

/* Le corps de Galois GF(256), polynôme 0x11d. */
const EXP: number[] = new Array<number>(512).fill(0);
const LOG: number[] = new Array<number>(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x;
  LOG[x] = i;
  x <<= 1;
  if (x & 256) x ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mulG = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Les `n` octets de correction d'un bloc. */
function correction(donnees: readonly number[], n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const s = new Array<number>(g.length + 1).fill(0);
    g.forEach((c, j) => {
      s[j] ^= c;
      s[j + 1] ^= mulG(c, EXP[i]);
    });
    g = s;
  }
  const r = [...donnees, ...new Array<number>(n).fill(0)];
  for (let i = 0; i < donnees.length; i++) {
    const f = r[i];
    if (f) for (let j = 0; j < g.length; j++) r[i + j] ^= mulG(g[j], f);
  }
  return r.slice(donnees.length);
}

/** Les octets de données que tient une version. */
export function capacite(v: number): number {
  return BLOCS[v][1].reduce((a, [n, d]) => a + n * d, 0);
}

/** Les mots de code entrelacés (données puis correction), prêts à poser. */
export function motsDeCode(data: readonly number[], v: number): number[] {
  const bits: number[] = [];
  const met = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  met(4, 4); // mode octet
  met(data.length, 8); // longueur, sur 8 bits jusqu'à la version 9
  for (const b of data) met(b, 8);
  const cap = capacite(v) * 8;
  for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const mots: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    mots.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let k = 0; mots.length < capacite(v); k++) mots.push(k % 2 ? 0x11 : 0xec);
  const [nc, groupes] = BLOCS[v];
  const blocs: number[][] = [];
  let p = 0;
  for (const [n, d] of groupes) {
    for (let i = 0; i < n; i++) {
      blocs.push(mots.slice(p, p + d));
      p += d;
    }
  }
  const ecs = blocs.map((b) => correction(b, nc));
  const out: number[] = [];
  const maxD = Math.max(...blocs.map((b) => b.length));
  for (let i = 0; i < maxD; i++) for (const b of blocs) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < nc; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

/** Les huit masques de la norme (tableau 10), ligne `r`, colonne `c`. */
export const MASQUES: readonly ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0,
];

/** Le reste d'une division de polynômes sur GF(2), pour le format et la version. */
function bch(val: number, poly: number, nPoly: number): number {
  let v = val << (nPoly - 1);
  const deg = (x: number) => 31 - Math.clz32(x);
  while (deg(v) >= deg(poly)) v ^= poly << (deg(v) - deg(poly));
  return v;
}

/** Une matrice de modules : `true` est un module sombre. */
export type Matrice = boolean[][];

/** La matrice pour une version et un masque donnés. */
export function matrice(mots: readonly number[], v: number, masque: number): Matrice {
  const n = v * 4 + 17;
  const m: (boolean | null)[][] = Array.from({ length: n }, () =>
    new Array<boolean | null>(n).fill(null),
  );
  const fixe = (r: number, c: number, d: boolean) => {
    if (r >= 0 && r < n && c >= 0 && c < n) m[r][c] = d;
  };
  // Les trois motifs de repérage, avec leur séparateur clair.
  for (const [R, C] of [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const d =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        fixe(R + r, C + c, d);
      }
    }
  }
  const a = ALIGN[v];
  for (const r of a) {
    for (const c of a) {
      if (m[r][c] !== null) continue;
      for (let i = -2; i <= 2; i++)
        for (let j = -2; j <= 2; j++) m[r + i][c + j] = Math.max(Math.abs(i), Math.abs(j)) !== 1;
    }
  }
  // Les lignes de synchronisation.
  for (let i = 8; i < n - 8; i++) {
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
  }
  // Le format : niveau M (00) et masque, BCH 0x537, xor 0x5412.
  const f = ((masque << 10) | bch(masque, 0x537, 11)) ^ 0x5412;
  for (let i = 0; i < 15; i++) {
    const d = ((f >> i) & 1) === 1;
    if (i < 6) m[i][8] = d;
    else if (i < 8) m[i + 1][8] = d;
    else m[n - 15 + i][8] = d;
    if (i < 8) m[8][n - i - 1] = d;
    else if (i < 9) m[8][15 - i] = d;
    else m[8][15 - i - 1] = d;
  }
  m[n - 8][8] = true;
  // La version, à partir de la 7.
  if (v >= 7) {
    const vi = (v << 12) | bch(v, 0x1f25, 13);
    for (let i = 0; i < 18; i++) {
      const d = ((vi >> i) & 1) === 1;
      m[Math.floor(i / 3)][(i % 3) + n - 11] = d;
      m[(i % 3) + n - 11][Math.floor(i / 3)] = d;
    }
  }
  // Les données, en zigzag par colonnes de deux, masquées.
  const mk = MASQUES[masque];
  let k = 0;
  for (let col = n - 1, haut = true; col > 0; col -= 2, haut = !haut) {
    if (col === 6) col--;
    for (let t = 0; t < n; t++) {
      const r = haut ? n - 1 - t : t;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (m[r][c] !== null) continue;
        const octet = k >> 3;
        let d = octet < mots.length ? ((mots[octet] >> (7 - (k & 7))) & 1) === 1 : false;
        k++;
        if (mk(r, c)) d = !d;
        m[r][c] = d;
      }
    }
  }
  return m.map((ligne) => ligne.map((x) => x === true));
}

/** La pénalité de la norme (N1 à N4), pour choisir le masque. */
export function penalite(m: Matrice): number {
  const n = m.length;
  let p = 0;
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < n; i++) {
      let suite = 1;
      for (let j = 1; j <= n; j++) {
        const a = j < n ? (s ? m[j][i] : m[i][j]) : null;
        const b = s ? m[j - 1][i] : m[i][j - 1];
        if (a === b) suite++;
        else {
          if (suite >= 5) p += suite - 2;
          suite = 1;
        }
      }
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < n - 1; j++) {
      const d = m[i][j];
      if (d === m[i + 1][j] && d === m[i][j + 1] && d === m[i + 1][j + 1]) p += 3;
    }
  }
  const motif = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const inverse = [...motif].reverse();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j + 11 <= n; j++) {
      for (const mo of [motif, inverse]) {
        if (mo.every((v, k) => (m[i][j + k] ? 1 : 0) === v)) p += 40;
        if (mo.every((v, k) => (m[j + k][i] ? 1 : 0) === v)) p += 40;
      }
    }
  }
  let sombres = 0;
  for (const ligne of m) for (const d of ligne) if (d) sombres++;
  p += Math.floor(Math.abs((sombres * 100) / (n * n) - 50) / 5) * 10;
  return p;
}

/** Le code d'un texte. */
export type Code = { version: number; masque: number; n: number; m: Matrice };

/** Ce qu'un essai peut imposer : la version, le masque, ou une altération des
 * mots de code (le jumeau négatif de `qr.test.ts`). */
export type Options = {
  version?: number;
  masque?: number;
  mots?: (mots: number[]) => number[];
};

/** Le code d'un texte, au masque de plus petite pénalité. Refusé au-delà de la
 * version 9 : une `RangeError`, jamais un code tronqué. */
export function code(texte: string, options: Options = {}): Code {
  const data = Array.from(new TextEncoder().encode(texte));
  let v = options.version ?? 0;
  if (!v) for (v = 1; v <= VERSION_MAX && capacite(v) < data.length + 2; v++);
  if (v > VERSION_MAX || capacite(v) < data.length + 2)
    throw new RangeError(`lien de ${data.length} octets : trop long pour ce code`);
  const bruts = motsDeCode(data, v);
  const mots = options.mots ? options.mots(bruts) : bruts;
  const masques = options.masque === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.masque];
  let meilleur: Code = { version: v, masque: masques[0], n: 0, m: [] };
  let moindre = Infinity;
  for (const masque of masques) {
    const m = matrice(mots, v, masque);
    const p = masques.length > 1 ? penalite(m) : 0;
    if (p < moindre) {
      moindre = p;
      meilleur = { version: v, masque, n: m.length, m };
    }
  }
  return meilleur;
}

/** Le chemin SVG des modules sombres, un carré par module, avec la marge de
 * quatre modules que la norme demande autour du code. `cote` est la taille
 * totale, marge comprise. */
export function chemin(c: Code): { d: string; cote: number } {
  let d = "";
  c.m.forEach((ligne, r) =>
    ligne.forEach((sombre, k) => {
      if (sombre) d += `M${k + 4} ${r + 4}h1v1h-1z`;
    }),
  );
  return { d, cote: c.n + 8 };
}
