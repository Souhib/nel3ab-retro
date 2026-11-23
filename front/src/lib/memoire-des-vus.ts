/**
 * Les personnes que ce navigateur a déjà vues se brancher dans cette salle.
 *
 * C'est une commodité locale, pas une vérité: un autre appareil a sa propre
 * mémoire, et une fenêtre privée n'en a aucune. Le pire cas est donc une scène
 * de branchement jouée une fois de trop, jamais une information perdue. Depuis
 * le 21 novembre 2026, le salon dit lui-même qui vient pour la première fois,
 * d'après le journal des parties (`Seat.premiere`). Cette mémoire ne décide plus
 * que quand le salon ne sait pas: une personne sans identité, ou un salon plus
 * ancien que la page.
 *
 * Le stockage peut manquer ou lever une exception (fenêtre privée, données
 * bloquées, capture d'aperçu): chaque accès est protégé, et sans stockage la
 * mémoire vit le temps de la page.
 */

const LIMITE = 200;

export type Memoire = {
  vus: () => ReadonlySet<string>;
  retiens: (nom: string) => void;
};

export function memoireDesVus(salle: string, stockage: Storage | null = lire()): Memoire {
  // La clé garde le nom d'avant le déplacement hors de `bobine/` (23 novembre
  // 2026) : la renommer ferait rejouer la scène d'arrivée à tous ceux que ce
  // navigateur a déjà vus. La planche efface les clés de ce préfixe.
  const cle = `n3-bobine-vus:${salle}`;
  let noms: string[] = [];
  try {
    const brut = stockage?.getItem(cle);
    const lu: unknown = brut ? JSON.parse(brut) : [];
    if (Array.isArray(lu)) noms = lu.filter((n): n is string => typeof n === "string");
  } catch {
    noms = [];
  }
  return {
    vus: () => new Set(noms),
    retiens: (nom) => {
      if (noms.includes(nom)) return;
      noms = [...noms, nom].slice(-LIMITE);
      try {
        stockage?.setItem(cle, JSON.stringify(noms));
      } catch {
        // Sans stockage, la mémoire reste celle de la page.
      }
    },
  };
}

function lire(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
