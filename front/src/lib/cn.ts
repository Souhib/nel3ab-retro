import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Les sept paliers de texte sont des TAILLES, et il faut le dire à l'outil.
 *
 * `tailwind-merge` ne connaît que les classes standard. Devant `text-note`, il
 * ne peut pas deviner s'il s'agit d'une taille, d'une couleur ou d'un
 * alignement: il la range avec les couleurs. Comme il ne garde qu'une classe
 * par groupe, `cn("text-note", "text-faint")` rendait `text-faint` SEUL. La
 * taille disparaissait sans bruit et l'élément retombait sur les 16 px hérités
 * du document.
 *
 * Trouvé le 13 septembre 2026: Souhib signale son pseudo coupé dans la colonne
 * de droite. Le nom sous une prise porte `text-note`, c'est-à-dire 13 px, et
 * calculait 16. Ce n'était ni la police ni le palier choisi: c'était l'outil
 * qui effaçait le palier.
 *
 * L'étendue relevée avant de corriger: 19 appels `cn()` sur 45 mêlent un palier
 * et une couleur — neuf dans `Lobby.tsx`, trois dans `Sidebar.tsx`, deux dans
 * `Xmb.tsx`, un dans `App`, `Library`, `Readout`, `Seats` et `Settings`. Tous
 * s'affichaient un cran au-dessus de ce que leur code demandait.
 *
 * La liste doit suivre les jetons `--text-*` d'`index.css`. Un palier ajouté
 * là-bas et oublié ici redeviendrait silencieusement une couleur.
 */
const PALIERS = ["mini", "note", "corps", "fort", "titre", "large", "affiche"] as const;

const fusion = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...PALIERS] }],
    },
  },
});

export const cn = (...inputs: ClassValue[]): string => fusion(clsx(inputs));
