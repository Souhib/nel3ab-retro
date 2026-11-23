/**
 * « chiffres » et « compteur »: l'afficheur de borne, et les chiffres qui
 * roulent quand ils changent.
 *
 * `poserAfficheur` construit l'afficheur dans un élément `.rt-afficheur`: le
 * fantôme (les segments éteints, « 88:88:88 », caché aux lecteurs d'écran) et
 * la valeur. La police est Departure, la police machine existante: rien de
 * plus n'est téléchargé. `ecrireChiffres` change la valeur; quand l'effet
 * « compteur » est allumé, chaque chiffre qui change roule vers le haut.
 *
 * Le texte reste du texte: un lecteur d'écran lit « 21:14:07 », pas huit
 * éléments. Il n'y a pas d'animation en mouvement réduit.
 */
import { effetActif, mouvementReduit } from "../lib/effets";

/** Le fantôme d'une valeur: chaque chiffre devient un 8, le reste ne bouge pas. */
export const fantome = (gabarit: string): string => gabarit.replace(/[0-9]/g, "8");

/** Prépare un afficheur dans `el` et y écrit sa première valeur. Rend
 * l'élément de la valeur, à passer à `ecrireChiffres`. */
export function poserAfficheur(el: HTMLElement, valeur: string): HTMLElement {
  el.classList.add("rt-afficheur");
  el.replaceChildren();
  const ombre = document.createElement("span");
  ombre.className = "rt-afficheur-fantome";
  ombre.setAttribute("aria-hidden", "true");
  ombre.textContent = fantome(valeur);
  const texte = document.createElement("span");
  texte.className = "rt-afficheur-valeur";
  el.append(ombre, texte);
  ecrireChiffres(texte, valeur);
  return texte;
}

/** Écrit une valeur. Les caractères qui changent roulent, si l'effet est
 * allumé, le mouvement permis, et la valeur garde sa longueur. */
export function ecrireChiffres(el: HTMLElement, valeur: string): void {
  const ancien = el.textContent ?? "";
  const roule = effetActif("compteur") && !mouvementReduit() && ancien.length === valeur.length;
  const caracteres = [...valeur].map((caractere, rang) => {
    const span = document.createElement("span");
    span.textContent = caractere;
    if (roule && ancien[rang] !== caractere) span.className = "rt-roule";
    return span;
  });
  el.replaceChildren(...caracteres);
}
