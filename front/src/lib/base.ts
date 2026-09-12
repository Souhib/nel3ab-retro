/** Sous quelle adresse cette salle est servie.
 *
 * Une salle vit sous son préfixe, `/r/1/`, et la page ne peut pas le deviner:
 * elle doit le LIRE. Toutes les adresses qu'elle demande au worker passent donc
 * par ici, et deviennent relatives à ce préfixe. Servie à la racine, comme en
 * développement ou comme la salle unique d'avant, le préfixe vaut `/` et rien
 * ne change.
 *
 * Pourquoi pas `document.baseURI`: une salle atteinte SANS barre finale
 * (`/r/1`) ramènerait au dossier parent, donc `/roms` au lieu de `/r/1/roms`,
 * et la page échouerait sans dire pourquoi. Le proxy redirige vers la barre
 * finale, mais une page ne doit pas dépendre d'une redirection pour savoir où
 * elle est: la normalisation ci-dessous la rend juste dans les deux cas.
 */
export const base = (): string =>
  location.pathname.endsWith("/") ? location.pathname : `${location.pathname}/`;

/** Une adresse du worker, sous le préfixe de cette salle.
 *
 * Accepte `/roms` comme `roms`: les appelants existants écrivent la barre, et
 * une barre oubliée renverrait à la racine du domaine, c'est-à-dire au salon.
 */
export const under = (path: string): URL =>
  new URL(path.replace(/^\/+/, ""), `${location.origin}${base()}`);

/** La même adresse, pour une WebSocket.
 *
 * Même origine, toujours: le worker refuse une poignée de main dont l'`Origin`
 * ne correspond pas à son `Host`, ce qui empêche la page d'un inconnu d'ouvrir
 * la vidéo de cette salle dans le navigateur d'un visiteur.
 */
export const socketUnder = (path: string): string => {
  const url = under(path);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

/** Le numéro de la salle que cette page sert, d'après son adresse.
 *
 * Une salle vit sous `/r/2/`, et c'est la seule chose qui distingue une page de
 * salle d'une autre: le salon, lui, est le même pour toutes. La page le lui dit
 * en se connectant, et le salon lui répond avec les places, les noms et le jeu
 * de CETTE salle.
 *
 * Un: une page servie à la racine est celle d'avant les salles multiples, et la
 * salle 1 est celle qu'elle voyait.
 */
export const salle = (): number => {
  const trouve = /^\/r\/(\d+)\//.exec(base());
  const numero = trouve ? Number(trouve[1]) : 1;
  return Number.isInteger(numero) && numero > 0 ? numero : 1;
};
