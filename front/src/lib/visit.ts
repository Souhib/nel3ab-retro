/**
 * Le numéro de cette visite, pour pouvoir la retrouver après coup.
 *
 * # Pourquoi il a fallu en arriver là
 *
 * Le 16 août 2026, quelqu'un a joué vers 16 h 43 et s'est plaint de saccades.
 * Rien, nulle part, ne permettait de retrouver ce moment: le worker ne note pas
 * qui il sert, le salon n'écrivait aucune trace, et le seul fichier gardé ne
 * contient que les pseudos choisis. La réponse a donc été « je ne peux pas
 * savoir », ce qui est la mauvaise réponse à donner deux fois.
 *
 * Ce numéro est la première moitié du remède. La seconde est le journal du
 * salon, qui l'écrit à chaque événement: un identifiant que personne n'inscrit
 * ne relie rien.
 *
 * # Ce qu'il est, et ce qu'il n'est pas
 *
 * Il naît au CHARGEMENT de la page et vit tant qu'elle vit. Donc:
 *
 * - une socket qui se rouvre garde le même numéro, ce qui est tout l'intérêt:
 *   une mauvaise connexion se reconnecte dix fois et reste une seule séance;
 * - un rechargement en donne un nouveau, et c'est voulu. Un rechargement au
 *   milieu d'une partie suit presque toujours un problème: le voir comme deux
 *   séances raconte mieux la soirée qu'un seul bloc continu. L'identité du
 *   proxy, elle, relie les deux.
 *
 * Ce n'est PAS un secret ni une authentification. Il ne donne aucun droit, il ne
 * sert qu'à ranger des lignes de journal ensemble. Qui décide, c'est le proxy
 * qui le dit, et ça ne passe pas par ici.
 *
 * Huit caractères et pas un UUID: une ligne de journal se lit à l'oeil, et
 * trente-six caractères de bruit au milieu la rendent illisible. Sur quatre
 * milliards de valeurs et quelques centaines de séances par an, deux visites qui
 * tombent sur le même numéro ne se produiront pas, et le jour où ça arriverait,
 * l'heure et le pseudo les sépareraient.
 */

/** Le drapeau qu'un pilote d'essai pose pour se signaler. */
const BENCH = "nel3ab:banc";

function fresh(): string {
  try {
    const bits = new Uint32Array(1);
    crypto.getRandomValues(bits);
    return bits[0]!.toString(16).padStart(8, "0");
  } catch {
    // Un contexte sans `crypto` reste jouable: il perd juste sa place dans le
    // journal. Une page qui refuse de démarrer parce qu'elle ne sait pas se
    // numéroter serait une panne fabriquée par l'outil de diagnostic.
    return "inconnue";
  }
}

/** Cette visite-ci. Calculé une fois, au chargement du module. */
export const VISIT = fresh();

/**
 * Vrai quand c'est un pilote d'essai et pas quelqu'un.
 *
 * Sans ce drapeau, le journal se remplit dès le premier jour de mes propres
 * pilotes, qui ouvrent la salle des dizaines de fois par soirée et prennent des
 * places. Ils ressemblent alors exactement à des joueurs, et une trace qu'on ne
 * peut pas distinguer du bruit ne sert à rien.
 *
 * Posé par `seedName` dans les pilotes, donc par le seul chemin que tous
 * empruntent: un drapeau qu'il faut penser à mettre est un drapeau qu'on oublie.
 */
export function onBench(): boolean {
  try {
    return localStorage.getItem(BENCH) === "1";
  } catch {
    return false;
  }
}
