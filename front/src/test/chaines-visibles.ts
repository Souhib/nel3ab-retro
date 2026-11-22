/**
 * Les chaînes qu'un joueur peut lire, extraites des sources par le compilateur
 * TypeScript.
 *
 * # Ce qui compte comme visible
 *
 * - le texte entre deux balises JSX;
 * - une chaîne posée comme enfant d'une balise, directement ou par une
 *   condition (`a ? "x" : "y"`), une concaténation ou un `??`;
 * - les attributs qu'un navigateur montre ou lit à voix haute (`title`,
 *   `aria-label`, `placeholder`, `alt`) et, sur un composant de la page, ceux
 *   qui portent un texte (`label`, `hint`, `value`, `unit`, `note`...);
 * - les propriétés d'objet du même nom: les entrées du menu sont des objets;
 * - le message d'une `Error`, et l'argument des fonctions qui posent un avis.
 *
 * Une chaîne comparée (`state === "running"`) n'est pas visible: elle est le
 * test, pas le texte. Un commentaire non plus, et c'est pour ça qu'on passe par
 * le compilateur plutôt que par une recherche de texte, qui aurait refusé
 * toutes les explications du code.
 *
 * # Ce qu'elle ne voit pas
 *
 * Une valeur qui n'existe qu'à l'exécution (l'état du son que le navigateur
 * renvoie, un nom de manette). Celles-là se traduisent par une fonction de
 * `lib/mots.ts`, que son propre essai vérifie.
 *
 * # Les mesures techniques
 *
 * Une chaîne écrite sous `<MesuresTechniques>` est marquée `technique`. Un
 * fichier entier peut l'être aussi (`FICHIERS_TECHNIQUES`), mais seulement si
 * chacun de ses composants n'est monté que sous `<MesuresTechniques>`:
 * `montagesHorsDuPli` le vérifie, sinon la permission serait un trou.
 */
import ts from "typescript";

/** Une chaîne qu'un joueur peut lire, et d'où elle vient. */
export type Chaine = {
  fichier: string;
  ligne: number;
  texte: string;
  /** Vrai sous `<MesuresTechniques>` ou dans un fichier technique. */
  technique: boolean;
};

/** Le composant qui ouvre la zone des mesures techniques. */
export const PLI = "MesuresTechniques";

/** Les attributs lus sur une balise du navigateur. */
const ATTRIBUTS_NATIFS = new Set(["title", "aria-label", "aria-description", "placeholder", "alt"]);

/** Les attributs et propriétés qui portent un texte, sur un composant ou un objet. */
const PORTEURS = new Set([
  ...ATTRIBUTS_NATIFS,
  "label",
  "hint",
  "value",
  "unit",
  "note",
  "footer",
  "sortie",
  "what",
  "titre",
  "texte",
  "detail",
  "phrase",
  "nom",
  "valeur",
  "message",
  "why",
]);

/** Les fonctions dont l'argument s'affiche. */
const AVIS = /^(?:set\w*(?:Error|Notice)|setNotice|pour|chefChoisit|chefAbsent)$/;

function texteDe(noeud: ts.Node): string | null {
  if (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud)) return noeud.text;
  if (ts.isTemplateExpression(noeud))
    return noeud.head.text + noeud.templateSpans.map((span) => `…${span.literal.text}`).join("");
  return null;
}

/** La chaîne est-elle montrée? Remonte les parents jusqu'à ce qui la reçoit.
 *
 * `lexique` vaut pour `lib/mots.ts`, où une table en capitales est une table de
 * mots. Ailleurs, la même forme range des codes (`frame: "dolphin"`). */
function visible(noeud: ts.Node, lexique: boolean): boolean {
  let ici: ts.Node = noeud;
  let parent: ts.Node | undefined = noeud.parent;
  while (parent) {
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent)) {
      ici = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isConditionalExpression(parent)) {
      if (parent.condition === ici) return false;
      ici = parent;
      parent = parent.parent;
      continue;
    }
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.right === ici
    ) {
      // `source.message = "…"`: une propriété qui porte un texte, écrite.
      const cible = parent.left;
      const nom = ts.isPropertyAccessExpression(cible) ? cible.name.text : cible.getText();
      return PORTEURS.has(nom);
    }
    if (ts.isBinaryExpression(parent)) {
      const op = parent.operatorToken.kind;
      const suit =
        op === ts.SyntaxKind.PlusToken ||
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.BarBarToken ||
        (op === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === ici);
      if (!suit) return false;
      ici = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isTemplateSpan(parent)) {
      ici = parent.parent;
      parent = ici.parent;
      continue;
    }
    if (ts.isJsxExpression(parent)) {
      const recoit = parent.parent;
      if (ts.isJsxAttribute(recoit)) return porteur(recoit);
      return true;
    }
    if (ts.isJsxAttribute(parent)) return porteur(parent);
    if (ts.isPropertyAssignment(parent)) {
      if (parent.initializer !== ici) return false;
      if (PORTEURS.has(parent.name.getText().replace(/["']/g, ""))) return true;
      // Une table de mots: `const IMAGE = { legere: "image légère" } as const`.
      return lexique && constanteDeTexte(parent.parent.parent);
    }
    if (ts.isVariableDeclaration(parent))
      return parent.initializer === ici && CONSTANTE.test(parent.name.getText());
    if (ts.isNewExpression(parent)) return parent.expression.getText() === "Error";
    if (ts.isCallExpression(parent)) return AVIS.test(parent.expression.getText());
    if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) return true;
    return false;
  }
  return false;
}

/** Une constante nommée en capitales: `SANS_REPONSE`, `CHEF`. Les textes
 * du lexique sont déclarés ainsi; une constante de code (`PAD_KEY`) l'est
 * aussi, et ne porte aucun mot refusé. */
const CONSTANTE = /^[A-Z][A-Z0-9_]*$/;

/** L'objet est-il la valeur d'une constante en capitales, `as const` compris? */
function constanteDeTexte(noeud: ts.Node): boolean {
  let ici: ts.Node = noeud;
  while (
    ts.isAsExpression(ici) ||
    ts.isSatisfiesExpression(ici) ||
    ts.isParenthesizedExpression(ici)
  )
    ici = ici.parent;
  return ts.isVariableDeclaration(ici) && CONSTANTE.test(ici.name.getText());
}

/** Un attribut JSX porte-t-il un texte? Sur une balise native, seuls ceux
 * que le navigateur montre: `value` d'une `<option>` n'est pas lu. */
function porteur(attribut: ts.JsxAttribute): boolean {
  const nom = attribut.name.getText();
  const balise = attribut.parent.parent;
  const natif =
    (ts.isJsxOpeningElement(balise) || ts.isJsxSelfClosingElement(balise)) &&
    /^[a-z]/.test(balise.tagName.getText());
  return natif ? ATTRIBUTS_NATIFS.has(nom) : PORTEURS.has(nom);
}

function nomDeBalise(noeud: ts.Node): string | null {
  if (ts.isJsxElement(noeud)) return noeud.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(noeud)) return noeud.tagName.getText();
  return null;
}

/** La chaîne est-elle écrite sous `<MesuresTechniques>`? */
function sousLePli(noeud: ts.Node): boolean {
  for (let p: ts.Node | undefined = noeud.parent; p; p = p.parent)
    if (nomDeBalise(p) === PLI) return true;
  return false;
}

/** Les chaînes visibles d'une source. `toutTechnique` marque le fichier entier,
 * `lexique` le fichier des mots (`lib/mots.ts`). */
export function chainesDe(
  fichier: string,
  source: string,
  toutTechnique = false,
  lexique = false,
): Chaine[] {
  const arbre = ts.createSourceFile(
    fichier,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const trouvees: Chaine[] = [];
  const noter = (noeud: ts.Node, texte: string) =>
    trouvees.push({
      fichier,
      ligne: arbre.getLineAndCharacterOfPosition(noeud.getStart()).line + 1,
      texte,
      technique: toutTechnique || sousLePli(noeud),
    });
  const visiter = (noeud: ts.Node) => {
    if (ts.isJsxText(noeud)) {
      const texte = noeud.text.replace(/\s+/g, " ").trim();
      if (texte) noter(noeud, texte);
    } else {
      const texte = texteDe(noeud);
      if (texte !== null && texte.trim() && visible(noeud, lexique)) noter(noeud, texte);
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(arbre);
  return trouvees;
}

/** Les montages d'un composant qui ne sont PAS sous `<MesuresTechniques>`. */
export function montagesHorsDuPli(
  fichier: string,
  source: string,
  composant: string,
): { fichier: string; ligne: number }[] {
  const arbre = ts.createSourceFile(
    fichier,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const dehors: { fichier: string; ligne: number }[] = [];
  const visiter = (noeud: ts.Node) => {
    if (nomDeBalise(noeud) === composant && !sousLePli(noeud))
      dehors.push({
        fichier,
        ligne: arbre.getLineAndCharacterOfPosition(noeud.getStart()).line + 1,
      });
    ts.forEachChild(noeud, visiter);
  };
  visiter(arbre);
  return dehors;
}
