// Les mots du salon (ADR D41), posés par `retro.py` dans l'en-tête de chaque
// page. La table vient de
// `front/src/lib/mots.ts`: `salon-retro.test.ts` l'écrit dans `mots.json`, et
// `retro.py` la met à la place de la marque ci-dessous.
//
// `nel3abMots("groupe.cle", { trou: valeur })` rend le texte, ses trous `{trou}`
// remplis. Une clé inconnue ou un trou sans valeur lève une erreur: un texte
// qui manque se voit dans les essais, pas comme un « undefined » à l'écran.
// `nel3abMots.de(nom)` élide « de » comme `de` de `mots.ts`, sur la même table
// d'exemples (`front/src/test/elisions.json`).
globalThis.nel3abMots = (function (table) {
  "use strict";
  var a = Object.prototype.hasOwnProperty;
  var VOYELLES = "aeiouàâäéèêëîïôöùûüœæ";
  function mots(cle, trous) {
    var texte = a.call(table, cle) ? table[cle] : null;
    if (typeof texte !== "string") throw new Error("mot inconnu du salon : " + cle);
    return texte.replace(/\{(\w+)\}/g, function (_tout, trou) {
      if (!trous || !a.call(trous, trou)) throw new Error("trou sans valeur : " + cle + " {" + trou + "}");
      return String(trous[trou]);
    });
  }
  mots.de = function (nom) {
    var premiere = nom.charAt(0).toLowerCase();
    var seconde = nom.charAt(1).toLowerCase();
    var voyelle = premiere !== "" && VOYELLES.indexOf(premiere) >= 0;
    var y = premiere === "y" && seconde !== "" && (VOYELLES + "y").indexOf(seconde) < 0;
    return voyelle || y ? "d'" + nom : "de " + nom;
  };
  return mots;
})(/*__MOTS__*/);
