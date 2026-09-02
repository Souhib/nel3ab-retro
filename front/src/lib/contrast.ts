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
  const front = parse(text);
  const back = parse(background);
  const at = (alpha: number) =>
    contrast(
      `#${front
        .map((s, i) => Math.round(s * alpha + (back[i] ?? 0) * (1 - alpha)))
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("")}`,
      background,
    );
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
