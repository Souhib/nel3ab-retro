/**
 * Le rapport de contraste, et les planchers qui en sortent.
 *
 * # Pourquoi ce fichier existe
 *
 * Les trois coques atténuent du texte pour dire « ceci n'est pas ce qui est
 * choisi ». Elles le faisaient avec des opacités choisies à l'oeil, et mesurées
 * le 31 août 2026 elles tombaient sous le seuil de lisibilité: 3,29:1 pour une
 * entrée non choisie du XMB, 2,74:1 pour un libellé de rayon, et 1,94:1 pour une
 * entrée désactivée — celle-là même qui porte la RAISON pour laquelle on ne peut
 * pas la choisir.
 *
 * Les jetons de couleur, eux, étaient tous corrects. Le défaut ne venait pas de
 * la palette mais de ce qu'on multipliait par-dessus.
 *
 * Ces fonctions rendent le calcul vérifiable plutôt que noté dans un
 * commentaire, pour que la prochaine coque ne recommence pas à l'oeil.
 */

/** Le seuil AA pour du texte de taille normale. */
export const AA_TEXT = 4.5;

/** Une couleur `#rrggbb` en trois composantes de 0 à 255. */
function parse(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(clean.slice(at, at + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/** La luminance relative, telle que WCAG la définit. */
export function luminance(hex: string): number {
  const [r, g, b] = parse(hex).map((raw) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Le rapport entre deux couleurs, de 1 à 21. L'ordre est sans importance. */
export function contrast(one: string, other: string): number {
  const a = luminance(one);
  const b = luminance(other);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Une couleur posée à `alpha` sur une autre, telle que l'oeil la reçoit. */
export function mix(top: string, bottom: string, alpha: number): string {
  const front = parse(top);
  const back = parse(bottom);
  return `#${front
    .map((s, i) => Math.round(s * alpha + (back[i] ?? 0) * (1 - alpha)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Les déclarations `--nom: valeur` des règles d'une feuille qui portent EXACTEMENT
 * ce sélecteur, fusionnées dans l'ordre de la feuille.
 *
 * Écrit pour `src/regie.css`, qui ne contient que des règles plates et une
 * règle sous `@media`: les commentaires sont retirés d'abord, puis chaque bloc
 * sans accolade intérieure est lu. Le sélecteur est comparé espaces resserrés,
 * pour qu'une liste écrite sur deux lignes se retrouve.
 */
export function declarations(css: string, selector: string): Map<string, string> {
  const tight = (text: string) =>
    text
      .replace(/\s+/g, " ")
      .replace(/\s*,\s*/g, ", ")
      .trim();
  const wanted = tight(selector);
  const found = new Map<string, string>();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (tight(rule[1] ?? "") !== wanted) continue;
    for (const line of (rule[2] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(line[1] ?? "", (line[2] ?? "").trim());
    }
  }
  return found;
}

/**
 * La couleur `#rrggbb` qu'un jeton finit par valoir, en suivant ses `var()`.
 *
 * Les portées sont lues dans l'ordre, comme la cascade le ferait pour un thème:
 * d'abord le bloc du thème, puis la racine. Un nom absent ou une valeur qui
 * n'est pas une couleur pleine LÈVE une erreur: rendre `undefined` ferait
 * calculer un contraste sur rien, et un essai qui passe sur rien ne prouve rien.
 */
export function resolve(name: string, ...scopes: Map<string, string>[]): string {
  const seen = new Set<string>();
  let current = name;
  for (;;) {
    if (seen.has(current)) throw new Error(`boucle de jetons autour de ${current}`);
    seen.add(current);
    const value = scopes.find((scope) => scope.has(current))?.get(current);
    if (value === undefined) throw new Error(`jeton inconnu: ${current}`);
    const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
    if (reference) {
      current = reference[1] ?? "";
      continue;
    }
    const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value);
    if (!hex) throw new Error(`${current} ne vaut pas une couleur pleine: ${value}`);
    const digits = (hex[1] ?? "").toLowerCase();
    return digits.length === 3 ? `#${[...digits].map((d) => d + d).join("")}` : `#${digits}`;
  }
}

/**
 * L'opacité minimale à laquelle ce texte tient le seuil sur ce fond.
 *
 * Rend `null` quand aucune ne suffit, ce qui n'est pas un cas d'erreur mais un
 * VERDICT: la paire ne peut pas s'atténuer du tout, et il faut une autre couleur
 * plutôt qu'une transparence. C'est exactement ce qui arrive sur la coque Wii —
 * sur un fond clair, baisser l'opacité rapproche le texte du fond et le rapport
 * s'effondre bien plus vite que sur du sombre.
 */
export function dimFloor(text: string, background: string, target = AA_TEXT): number | null {
  const at = (alpha: number) => contrast(mix(text, background, alpha), background);
  if (at(1) < target) return null;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 40; step += 1) {
    const middle = (low + high) / 2;
    if (at(middle) < target) low = middle;
    else high = middle;
  }
  return high;
}
