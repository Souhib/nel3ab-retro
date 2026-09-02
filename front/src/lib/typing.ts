/**
 * « Est-ce que quelqu'un est en train d'ÉCRIRE ? »
 *
 * # Pourquoi une fonction et pas la ligne recopiée
 *
 * Elle l'était: la même comparaison de `tagName` vivait dans trois écouteurs de
 * clavier, et le quatrième — la boucle d'entrée, celui qui appelle
 * `preventDefault` — ne l'avait pas. Personne ne pouvait donc taper un `a` ou un
 * `s` dans un champ de texte, parce que ces touches-là sont liées à la manette.
 *
 * Le pseudo du salon en souffrait depuis le début et personne ne l'avait dit;
 * ça s'est vu le jour où un deuxième champ est apparu. Une règle recopiée est
 * une règle qu'un endroit finit par ne pas avoir, et l'endroit qui l'oublie est
 * celui où on n'a pas pensé qu'elle s'appliquait.
 *
 * # Ce que ça couvre
 *
 * Un `input`, une `textarea`, et tout ce qui est `contenteditable` — un éditeur
 * riche n'est ni l'un ni l'autre et se tape quand même.
 */

/** Vrai quand cet élément reçoit du texte, donc quand le clavier ne joue pas. */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return true;
  // `=== true` et pas la valeur brute: `isContentEditable` n'existe pas partout
  // — jsdom ne l'implémente pas — et un `||` sur `undefined` rend `undefined`.
  // La fonction annonçait un booléen et rendait autre chose, ce que le type ne
  // pouvait pas voir. Elle était utilisée dans un `if`, donc ça marchait, et
  // c'est exactement le genre de mensonge qui se paie ailleurs plus tard.
  //
  // L'attribut est le repli, pour la même raison. Il ne suit pas l'héritage —
  // un enfant d'un bloc éditable ne le porte pas — là où la propriété le fait,
  // donc la propriété reste la vraie réponse quand elle existe. Aucune page
  // n'est éditable aujourd'hui: c'est une garde, pas un besoin.
  return target.isContentEditable === true || target.getAttribute("contenteditable") === "true";
}
