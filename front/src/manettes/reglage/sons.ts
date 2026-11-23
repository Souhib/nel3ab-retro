/** Les sons du réglage, ceux du socle (`retro/sons`) : une pièce quand une
 * réponse est retenue, un son grave quand la manette se débranche au milieu
 * du pas à pas. Ils suivent les moments de la boucle, jamais la boucle
 * d'image. Le socle les coupe par défaut, et quand la zone de jeu a le focus. */
import { sonMenu, type SonMenu } from "../../retro/sons";
import type { Moment } from "./marques";

export function sonnerReglage(
  abonner: (ecoute: (moment: Moment) => void) => () => void,
  jouer: (son: SonMenu) => boolean = sonMenu,
): () => void {
  return abonner((moment) => {
    if (moment.type === "recu") jouer("piece");
    else if (moment.type === "suspendu") jouer("erreur");
  });
}
