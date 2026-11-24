/**
 * Le paquet du salon : ce que les trois pages du salon (accueil, dépôt,
 * carnet) reçoivent de `front/`, sans la page React de la salle (ADR D41,
 * K17 de la partition).
 *
 * Deux choses, et rien d'autre :
 *
 * - Aïn (`mascotte/salon.ts`) : peint dans le logo de l'en-tête, il joue les
 *   scènes que la page lui demande par `nel3abAin.scene(...)` ;
 * - les gestes d'arcade du socle (`retro/arcade.ts`) : Entrée et le Start
 *   d'une manette pour le geste principal (`surStart`), le mode démo
 *   (`surInactivite`) et les trois initiales (`initiales`), sous
 *   `nel3abSalon`. Le salon s'appuie sur eux plutôt que de les réécrire en
 *   JavaScript à la main : une seule règle pour « l'effet est-il allumé ».
 *
 * Le reste des pages (les mots, la liste, les formulaires) reste du HTML
 * écrit à la main, servi par le salon : `retro.py` pose ce paquet par la
 * marque `<!--RETRO:AIN-->`, dans un script classique en fin de corps.
 * `just ain-salon` le construit (`vite.ain-salon.config.ts`).
 */
import "../mascotte/salon";
import { initiales, surInactivite, surStart } from "../retro/arcade";

const crochet = globalThis as { nel3abSalon?: Record<string, unknown> };
crochet.nel3abSalon = { ...crochet.nel3abSalon, surStart, surInactivite, initiales };
