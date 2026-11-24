/**
 * La scène d'Aïn quand l'état de la salle change : une fonction pure.
 *
 * Chaque état a SA scène (`sceneDeLEtat`), et une scène ne se joue qu'à
 * l'entrée dans un état qui en a une autre : passer de la pastille à la fiche
 * d'une même image figée ne rejoue rien, et une salle qui dort ne se rendort
 * pas à chaque relevé. Rien ne tourne entre deux scènes ; l'arbitre de la
 * salle (`lib/scenes-salle.ts`, K10) décide si elle passe, et le socle la
 * coupe si la page prend du retard.
 *
 * « premiere-image » n'est jamais rendue ici : la salle la joue seule, au
 * passage d'un écran sans image à une image vivante (K06).
 *
 * Ce que chaque scène dit, et pourquoi elle ne ment pas :
 * - « coupe » : ça décroche de ton côté (le navigateur n'a plus de réseau) ;
 * - « chercher » : rien ne répond, et la page ne sait pas de quel côté ;
 * - « decroche » : ça décroche côté salle, le reste du site répond ou se tait ;
 * - « arret » : l'image ne bouge plus, ou l'appareil ne l'affiche plus ;
 * - « hoquet » : l'image saute, la proposition de l'image légère paraît ;
 * - « endort » : le compte de fermeture commence ; « pret » : une touche l'a
 *   remis à zéro et la salle vit ; « dort » : la salle est fermée.
 */
import type { Liaison } from "../media/liaison";
import type { Scene } from "../mascotte";

/** La scène qui appartient à un état de la liaison, ou rien. */
export function sceneDeLEtat(liaison: Liaison): Scene | null {
  switch (liaison.etat) {
    case "arrivee":
      return liaison.perdue ? "attente" : "rebrancher";
    case "figee":
    case "decodeur":
      return "arret";
    case "coupee":
      return liaison.cause === "reseau" ? "coupe" : "chercher";
    case "injoignable":
      // Un relais à la place du site : on ne sait pas de quel côté.
      return liaison.site === "relais" ? "chercher" : "decroche";
    case "redemarre":
      return "redemarre";
    case "fermee":
      return "dort";
    case "irreguliere":
      return "hoquet";
    case "ok":
    case "cachee":
    case "demarrage":
      return null;
  }
}

/** Ce qu'il faut pour décider : la liaison et le compte de fermeture. */
export type Moment = { liaison: Liaison; fermeDans: number };

/** La scène à jouer au passage de `avant` à `apres`, ou `null`. */
export function sceneDeTransition(avant: Moment, apres: Moment): Scene | null {
  const etait = sceneDeLEtat(avant.liaison);
  const est = sceneDeLEtat(apres.liaison);
  if (est !== null && est !== etait) return est;
  if (avant.fermeDans === 0 && apres.fermeDans > 0) return "endort";
  // Remis à zéro par une touche, la salle vivante : la fermeture est évitée.
  // Une salle qui ferme en même temps a déjà joué « dort » plus haut.
  if (avant.fermeDans > 0 && apres.fermeDans === 0 && apres.liaison.etat === "ok") return "pret";
  return null;
}
