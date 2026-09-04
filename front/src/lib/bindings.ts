/**
 * Où vivent les réglages de manette, et pourquoi ils ont déménagé.
 *
 * Apprendre une manette GameCube demande seize réponses. Elles vivaient dans le
 * `localStorage` d'un navigateur, donc elles appartenaient à une MACHINE: passer
 * du portable du salon à la tour du bureau voulait dire recommencer les seize,
 * et vider son navigateur aussi.
 *
 * Elles appartiennent maintenant à la PERSONNE, sous l'adresse que le proxy
 * garantit, exactement comme le pseudo. Le navigateur reste le cache: c'est lui
 * qu'on lit à chaque image, parce que la boucle d'entrée ne peut pas attendre
 * une requête. Le service ne fait que le semer à l'arrivée et le recevoir à
 * chaque changement.
 *
 * **Sans identité, rien ne change.** Pas de proxy devant veut dire pas de
 * dossier à ouvrir: les réglages restent dans le navigateur, comme avant. C'est
 * la même dégradation que pour le pseudo, et elle ramène à hier plutôt qu'à pire.
 *
 * **Le dernier qui écrit gagne.** Deux machines réglées en même temps ne
 * fusionnent pas. Fusionner ferait survivre une manette qu'on vient justement
 * d'oublier, et « oublier cette manette » est un bouton qui doit marcher.
 */
import { useQuery } from "@tanstack/react-query";
import { keepBindings, publishRoomBindings, readBindings, readRoomBindings } from "../client";

/** Le préfixe d'un profil de manette dans le navigateur, une clé par manette. */
export const PAD_PREFIX = "nel3ab.pad.";
/** Et les touches du clavier, qui tiennent en une seule. */
export const KEYS_STORED = "nel3ab.keys";

/** La RÉFÉRENCE de la salle, gardée en copie dans le navigateur.
 *
 * # Pourquoi une copie et pas seulement la requête
 *
 * D12 promet qu'une salle déjà ouverte continue de jouer quand le plan de
 * contrôle s'arrête. Sans cette copie, l'arrêter ferait disparaître les profils
 * de la salle de la liste — et si l'un d'eux jouait, la personne se retrouverait
 * sans touches au milieu d'une partie. Une promesse tenue partout sauf sur le
 * chemin qu'on vient d'ajouter n'est plus une promesse.
 *
 * La copie est rafraîchie à chaque fois que la requête aboutit, donc une
 * publication arrive au prochain chargement de page.
 */
export const ROOM_STORED = "nel3ab.room";

export type Bindings = { pads: Record<string, unknown>; keys: Record<string, unknown> };

/** Tout ce que ce navigateur a gardé, prêt à partir au service. */
export function gather(): Bindings {
  const pads: Record<string, unknown> = {};
  let keys: Record<string, unknown> = {};
  try {
    for (let at = 0; at < localStorage.length; at += 1) {
      const key = localStorage.key(at);
      if (key === null || !key.startsWith(PAD_PREFIX)) continue;
      const found = localStorage.getItem(key);
      if (found) pads[key.slice(PAD_PREFIX.length)] = JSON.parse(found);
    }
    const stored = localStorage.getItem(KEYS_STORED);
    if (stored) keys = JSON.parse(stored) as Record<string, unknown>;
  } catch {
    // Navigation privée, ou une entrée illisible: on envoie ce qu'on a pu lire.
  }
  return { pads, keys };
}

/** Écrit dans le navigateur ce que le service gardait pour cette personne.
 *
 * Rend vrai quand quelque chose a été semé. Un dossier vide ne touche à RIEN:
 * quelqu'un qui règle sa manette pour la première fois sur une machine neuve ne
 * doit pas voir son réglage effacé par le vide qui l'a précédé. */
export function seed(kept: Bindings): boolean {
  let sown = false;
  try {
    for (const [id, profile] of Object.entries(kept.pads ?? {})) {
      localStorage.setItem(`${PAD_PREFIX}${id}`, JSON.stringify(profile));
      sown = true;
    }
    if (Object.keys(kept.keys ?? {}).length > 0) {
      localStorage.setItem(KEYS_STORED, JSON.stringify(kept.keys));
      sown = true;
    }
  } catch {
    // Navigation privée: les réglages valent pour cet onglet.
  }
  return sown;
}

/** Envoie au service ce que ce navigateur a maintenant.
 *
 * Sans attendre la réponse, et sans la regarder: un réglage vient d'être
 * appliqué localement, il marche déjà, et une erreur réseau ne doit pas défaire
 * ce que la personne vient de faire. Le pire cas est qu'il ne suive pas sur
 * l'autre machine, ce qui est l'état d'avant.
 */
export function push(): void {
  void keepBindings({ body: gather() }).catch(() => {
    /* Pas de plan de contrôle, ou pas d'identité: les réglages restent locaux. */
  });
}

/** Ce que la salle propose, tel que ce navigateur l'a vu la dernière fois.
 *
 * Lu SANS réseau: c'est la boucle d'entrée qui appelle, au moment où elle se
 * construit, et elle ne peut pas attendre une requête.
 */
export function roomReference(): Bindings {
  try {
    const found = localStorage.getItem(ROOM_STORED);
    if (!found) return { pads: {}, keys: {} };
    const held = JSON.parse(found) as Partial<Bindings>;
    return { pads: held.pads ?? {}, keys: held.keys ?? {} };
  } catch {
    return { pads: {}, keys: {} };
  }
}

/** Garde ce que la salle propose, pour la prochaine fois. */
export function keepReference(kept: Bindings): void {
  try {
    localStorage.setItem(ROOM_STORED, JSON.stringify(kept));
  } catch {
    /* navigation privée: la référence vaut le temps de l'onglet. */
  }
}

/**
 * Publie UN profil de touches, plus les manettes de ce navigateur.
 *
 * # Ce que ça ajoute et ce que ça remplace
 *
 * Le profil nommé est ajouté à la référence, ou remplace celui du même nom si
 * elle en portait déjà un: c'est ainsi qu'on met la référence à jour. Les autres
 * profils de la salle ne bougent pas — publier « mario striker » ne doit pas
 * effacer « défaut ».
 *
 * Les manettes, elles, sont remplacées en bloc. Apprendre une manette demande
 * seize questions, et c'est la partie de la configuration qui a le plus de
 * valeur pour quelqu'un qui arrive avec le même modèle.
 */
export function publishProfile(name: string, profile: unknown): Promise<boolean> {
  const held = roomReference();
  const keys = (held.keys ?? {}) as { byName?: Record<string, unknown>; active?: string };
  const byName = { ...(keys.byName ?? {}), [name]: profile };
  return publish({
    pads: gather().pads,
    keys: { byName, active: keys.active && byName[keys.active] ? keys.active : name },
  });
}

/** Publie la configuration de ce navigateur comme référence de la salle.
 *
 * Refusée par le service pour tout le monde sauf une adresse, donc l'échec est
 * normal et silencieux: la page ne montre le bouton qu'à qui a le droit, et le
 * service ne croit pas la page sur parole.
 */
export function publish(kept: Bindings): Promise<boolean> {
  return publishRoomBindings({ body: kept, throwOnError: true })
    .then(() => {
      // La copie locale tout de suite: sans ça, la personne qui vient de
      // publier ne verrait son profil de salle qu'au prochain chargement, et
      // douterait que le bouton ait fait quelque chose.
      keepReference(kept);
      return true;
    })
    .catch(() => false);
}

/** Va chercher les réglages de cette personne et les sème dans le navigateur.
 *
 * En requête plutôt qu'en effet, pour que la page puisse ATTENDRE: la boucle
 * d'entrée lit le navigateur au moment où elle est construite, donc semer après
 * coup laisserait une soirée entière sur les réglages de la machine.
 */
/** Combien de temps une publication met à atteindre les gens déjà là.
 *
 * Trente secondes est un jugement et non une mesure: une référence change
 * quelques fois par soirée, jamais par seconde, et la réponse pèse quelques
 * centaines d'octets. Plus court coûterait des requêtes pour rien; plus long
 * ferait douter de la publication, ce qui est exactement le défaut qu'on répare.
 */
const REFERENCE_EVERY = 30_000;

/**
 * Ce que la salle propose, RELU pendant la visite.
 *
 * # Pourquoi c'est une requête à part
 *
 * `useBindings` ne se relit jamais, et pour une bonne raison: le dossier
 * personnel est écrit par cette page, donc relire écraserait le plus récent par
 * le plus ancien. La référence de la salle est l'inverse — personne ici ne
 * l'écrit, sauf l'administrateur, et elle est rangée dans sa propre case du
 * navigateur. La relire ne peut donc rien perdre.
 *
 * Les avoir confondues faisait que « publier dans la salle » n'arrivait qu'aux
 * gens qui ouvraient la page APRÈS. Le service répondait 200, le bouton avait
 * l'air cassé, et il l'était pour tout le monde sauf celui qui appuyait.
 */
export function useRoomReference(onChange?: () => void) {
  return useQuery({
    queryKey: ["room-bindings"],
    queryFn: async () => {
      const proposed = await readRoomBindings({ throwOnError: true })
        .then((got) => got.data ?? null)
        .catch(() => null);
      const kept: Bindings = {
        pads: (proposed?.pads ?? {}) as Record<string, unknown>,
        keys: (proposed?.keys ?? {}) as Record<string, unknown>,
      };
      // Rangé AVANT de prévenir: celui qu'on prévient relit le navigateur.
      keepReference(kept);
      onChange?.();
      return kept;
    },
    refetchInterval: REFERENCE_EVERY,
    // Et au retour sur l'onglet: quelqu'un qui revient d'un autre écran est
    // exactement celui à qui on vient de dire « c'est publié, regarde ».
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

export function useBindings(login: string | null) {
  return useQuery({
    queryKey: ["bindings", login],
    queryFn: async () => {
      // La RÉFÉRENCE d'abord, et sans identité: c'est ce que la salle propose à
      // qui entre, donc elle doit arriver même quand la personne n'a encore rien
      // réglé. Une erreur ici n'est pas une erreur — une salle sans référence se
      // comporte comme avant, et la copie du navigateur reste ce qu'elle était.
      const proposed = await readRoomBindings({ throwOnError: true })
        .then((got) => got.data ?? null)
        .catch(() => null);
      if (proposed) {
        keepReference({
          pads: (proposed.pads ?? {}) as Record<string, unknown>,
          keys: (proposed.keys ?? {}) as Record<string, unknown>,
        });
      }
      const answer = (await readBindings({ throwOnError: true })).data;
      const kept: Bindings = {
        pads: (answer?.pads ?? {}) as Record<string, unknown>,
        keys: (answer?.keys ?? {}) as Record<string, unknown>,
      };
      // Les manettes de la salle sèment celui qui n'a RIEN, et lui seul:
      // apprendre une manette demande seize questions, et quelqu'un qui a le
      // même modèle que la référence n'a aucune raison de les repasser. Ne pas
      // écraser un dossier existant, en revanche: ce serait reprendre à
      // quelqu'un ce qu'il a réglé.
      if (proposed && Object.keys(kept.pads).length === 0) {
        kept.pads = (proposed.pads ?? {}) as Record<string, unknown>;
      }
      seed(kept);
      return kept;
    },
    // Une fois par visite. Ce qui change ensuite vient de cette page, qui écrit
    // dans le navigateur avant d'envoyer: relire écraserait le plus récent.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
