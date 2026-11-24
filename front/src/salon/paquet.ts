/**
 * Le paquet du salon : ce que les trois pages du salon (accueil, dépôt,
 * carnet) reçoivent de `front/`, sans la page React de la salle (ADR D41,
 * K17 de la partition).
 *
 * Quatre choses, et rien d'autre :
 *
 * - Aïn (`mascotte/salon.ts`) : peint dans le logo de l'en-tête, il joue les
 *   scènes que la page lui demande par `nel3abAin.scene(...)` ;
 * - les gestes d'arcade du socle (`retro/arcade.ts`) : Entrée et le Start
 *   d'une manette pour le geste principal (`surStart`), le mode démo
 *   (`surInactivite`) et les trois initiales (`initiales`), sous
 *   `nel3abSalon`. Le salon s'appuie sur eux plutôt que de les réécrire en
 *   JavaScript à la main : une seule règle pour « l'effet est-il allumé » ;
 * - la boucle d'attention de l'accueil à zéro salle (`attention.ts`,
 *   `surAttention`) : « attente » trois fois, puis « dort » ;
 * - de quoi peindre la mire du socle : ses calques d'attente (balayage,
 *   vignette, roulement) et le filtre de l'écran bombé (`retro/calques.ts`),
 *   puis la flèche en pixels de l'effet « pointeur » (`retro/pointeur.ts`),
 *   posée une fois dans `--rt-pointeur` sur la racine.
 *
 * Le reste des pages (les mots, la liste, les formulaires) reste du HTML
 * écrit à la main, servi par le salon : `retro.py` pose ce paquet par la
 * marque `<!--RETRO:AIN-->`, dans un script classique en fin de corps.
 * `just ain-salon` le construit (`vite.ain-salon.config.ts`).
 */
import "../mascotte/salon";
import { initiales, surInactivite, surStart } from "../retro/arcade";
import { poserCalquesAttente, poserFiltreBombe } from "../retro/calques";
import { pointeurCSS } from "../retro/pointeur";
import { surAttention } from "./attention";

const crochet = globalThis as { nel3abSalon?: Record<string, unknown> };
crochet.nel3abSalon = {
  ...crochet.nel3abSalon,
  surStart,
  surInactivite,
  initiales,
  surAttention,
  poserCalquesAttente,
  poserFiltreBombe,
};

if (typeof document !== "undefined")
  document.documentElement.style.setProperty("--rt-pointeur", pointeurCSS());
