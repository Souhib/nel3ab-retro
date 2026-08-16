// Un lien lent, pour de vrai.
//
// L'étranglement réseau des outils de développement de Chrome NE TOUCHE PAS les
// WebSockets: vérifié le 2026-08-16 en plafonnant à 2 Mbit/s une page qui a
// continué à peindre 50 images par seconde. Or tout ce que ce projet envoie est
// une WebSocket, donc cet outil-là ne mesure rien ici.
//
// D'où ce relais: un serveur TCP qui recopie octet pour octet vers le worker, à
// travers un seau à jetons. Comme il est en TCP brut et pas en HTTP, la montée
// en WebSocket le traverse sans qu'il ait à la comprendre, et la page, l'image,
// le son et la manette passent tous par le même goulot — ce qui est justement la
// situation qu'on veut reproduire.
import net from "node:net";

/** Combien de temps de débit peut s'accumuler quand rien ne passe.
 *
 * Un quart de seconde. À zéro, le seau ne laisserait jamais passer une rafale et
 * modéliserait un lien parfaitement lisse, ce qu'aucun lien n'est. Trop grand,
 * il absorberait tout et ne modéliserait plus rien. */
const BURST_SECONDS = 0.25;
/** À quelle fréquence on verse des jetons. 5 ms est bien plus fin qu'une image. */
const TICK_MS = 5;

/**
 * Un lien étroit n'est pas la même chose qu'un lien IRRÉGULIER, et c'est le
 * second qui fait mal.
 *
 * Un seau à débit constant reproduit mal ce que vit quelqu'un chez lui: là-bas
 * le débit disponible bouge, parce que quelqu'un d'autre télécharge, parce que
 * le Wi-Fi respire. La file d'attente grossit pendant les creux et se vide en
 * rafale pendant les pointes, et ce sont ces rafales que la page doit absorber.
 *
 * On fait donc osciller le débit autour de sa moyenne. Osciller plutôt que
 * retarder au hasard chaque morceau: un flux TCP est une suite d'octets, et
 * retarder inégalement deux morceaux les remettrait dans le désordre, ce qui
 * n'arrive jamais sur un vrai lien.
 */
const SWING_PERIOD_MS = 700;

/** Recopie `from` vers `to` sans dépasser `bytesPerSecond`. */
function meter(from, to, rateOf, swing) {
  const waiting = [];
  let tokens = 0;
  let ended = false;
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    // Une sinusoïde autour de la moyenne: le débit instantané vaut entre
    // (1 - swing) et (1 + swing) fois le débit demandé.
    const phase = ((now % SWING_PERIOD_MS) / SWING_PERIOD_MS) * 2 * Math.PI;
    const mean = rateOf();
    const rate = mean * (1 + swing * Math.sin(phase));
    tokens = Math.min(mean * BURST_SECONDS, tokens + (rate * (now - last)) / 1000);
    last = now;
    while (waiting.length > 0 && tokens >= 1) {
      const chunk = waiting[0];
      const take = Math.min(chunk.length, Math.floor(tokens));
      tokens -= take;
      to.write(chunk.subarray(0, take));
      if (take === chunk.length) waiting.shift();
      else waiting[0] = chunk.subarray(take);
    }
    if (ended && waiting.length === 0) {
      clearInterval(timer);
      to.end();
    }
  }, TICK_MS);
  from.on("data", (chunk) => waiting.push(chunk));
  // La fin de la source n'est PAS la fin de la copie: le seau retient encore des
  // octets. Fermer là coupait la page en plein téléchargement, et le navigateur
  // répondait ERR_EMPTY_RESPONSE — un lien lent qui n'aurait jamais servi une
  // seule page n'aurait mesuré que lui-même.
  from.on("end", () => {
    ended = true;
  });
  const shut = () => {
    clearInterval(timer);
    to.destroy();
  };
  from.on("error", shut);
  return shut;
}

/**
 * Ouvre le goulot et rend de quoi le refermer.
 *
 * `megabits` s'applique dans le sens serveur vers page, qui est celui qui porte
 * l'image. Le sens page vers serveur n'est pas bridé: une manette fait quelques
 * octets, et l'étrangler mesurerait autre chose que ce qu'on cherche.
 */
export function throttled({ port, toPort = 8100, megabits, swing = 0 }) {
  // Le débit se change en cours de route, et c'est ce qui rend la mesure
  // honnête: la PAGE se charge à pleine vitesse, comme chez n'importe qui, et le
  // goulot ne se referme qu'ensuite. Sinon on mesure un téléchargement de
  // quatre cents kilo-octets en concurrence avec le flux, ce qui n'arrive
  // qu'une fois et fausse les douze premières secondes.
  let rate = (megabits * 1000 * 1000) / 8;
  const shutters = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(toPort, "127.0.0.1");
    upstream.setNoDelay(true);
    client.setNoDelay(true);
    const a = meter(upstream, client, () => rate, swing);
    // Vers le serveur, tout de suite: une pression sur un bouton ne doit pas
    // attendre le seau, sinon on mesure une latence de manette qu'on a inventée.
    client.on("data", (chunk) => upstream.write(chunk));
    const b = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", b);
    client.on("end", b);
    upstream.on("error", b);
    shutters.add(() => {
      a();
      b();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        squeeze: (nowMegabits) => {
          rate = (nowMegabits * 1000 * 1000) / 8;
        },
        close: () => {
          for (const shut of shutters) shut();
          server.close();
        },
      }),
    );
  });
}
