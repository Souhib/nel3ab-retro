/**
 * The room, read once and then pushed.
 *
 * There is one copy of the room in this page: the query cache under
 * `["room"]`. The first value comes from `GET /api/room`, every later one from
 * the lobby's `room` event, and both write to the same key. Keeping a second
 * `useState` beside it is the mistake this file exists to avoid: two mutable
 * copies of the same fact drift apart the first time a socket reconnects out of
 * order, and the seats are the visible half of that drift.
 *
 * The worker stays the authority on who really holds a pad (ADR D12). What is
 * here is what each page SAID, which is the only thing that can carry a name.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { readRoom, type Room } from "../client";
import type { Trail, Vitals } from "./vitals";
import { onBench, VISIT } from "./visit";
import { under } from "./base";

export const ROOM_KEY = ["room"] as const;

/** How many pads a room has when nobody is there to say otherwise. */
const PORTS = 4;

/** The room, read from the worker alone.
 *
 * The control plane never touches a frame (ADR D12), so its absence must not
 * stop anybody playing. What is lost when it is down is exactly what it adds:
 * the names beside the seats. The picture, the sound, the pads and the library
 * all come from the worker and keep working.
 */
async function fromWorkerAlone(): Promise<Room> {
  const answer = await fetch(under("/roms"));
  if (!answer.ok) throw new Error(`la salle ne répond pas (${answer.status})`);
  // La forme que le worker sert lui-même. Elle a la même information que celle
  // du plan de contrôle, sans les noms des joueurs, qu'il ne connaît pas.
  const found = (await answer.json()) as {
    current: number | null;
    roms: {
      name: string;
      maker: string | null;
      about: string | null;
      art: boolean;
      console: string;
    }[];
  };
  const library = found.roms.map((game, index) => ({ index, ...game }));
  return {
    name: "salon",
    game: found.current === null ? null : (library[found.current] ?? null),
    library,
    seats: Array.from({ length: PORTS }, (_, slot) => ({ port: slot + 1, player: null })),
    media_url: "",
  };
}

/** The room as the service last described it. */
export function useRoom() {
  return useQuery({
    queryKey: ROOM_KEY,
    queryFn: async (): Promise<Room> => {
      try {
        const answer = (await readRoom({ throwOnError: true })).data;
        // Checked rather than trusted. The worker answers EVERY unknown path
        // with the page itself, so a room served by the worker alone replies
        // `200 text/html` to `/api/room`, and the generated client hands that
        // back as an object with nothing in it. Without this line the page
        // showed an empty library and four empty seats, and blamed nobody.
        if (!Array.isArray(answer?.library) || !Array.isArray(answer?.seats)) {
          throw new Error("ce n'est pas un salon");
        }
        return answer;
      } catch {
        return await fromWorkerAlone();
      }
    },
    // The lobby pushes every change, so a poll would only add requests. The
    // refetch on reconnect below is the safety net for the seconds it is down.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** Ce qu'on peut dire au salon une fois connecté. */
export type Lobby = {
  recover: (
    action: Record<string, unknown>,
  ) => Promise<{ port: number | null; claim: string | null }>;
  closeGame: (game: number) => Promise<void>;
  prepare: (action: Record<string, unknown>) => Promise<void>;
  seat: (port: number | null, claim: string | null) => void;
  renamed: (name: string) => void;
  /** Répondre à une demande reçue. */
  answer: (port: number, ok: boolean) => void;
  /** Un relevé de ce que ce navigateur voit, pour le journal des séances.
   *
   * Par la socket du salon plutôt que par une requête: elle est déjà ouverte,
   * elle sait déjà qui parle, et une requête de plus toutes les dix secondes
   * serait une poignée de main de plus toutes les dix secondes. */
  vitals: (sample: Vitals) => void;
  /** « Je change de jeu, tenez-vous prêts. »
   *
   * Par le SALON et non par le worker, parce que le worker est justement ce qui
   * s'arrête: il écrit le choix, il sort, et systemd le ramène. Toute socket
   * qu'il tient se ferme avec lui, donc rien de ce qu'il pourrait dire ne
   * traverserait les dix secondes qu'on veut couvrir. Le salon, lui, reste
   * debout.
   *
   * On envoie l'INDICE du jeu et le CODE de l'emplacement, pas leurs noms: c'est
   * le serveur qui les traduit, à partir de sa propre bibliothèque. Une page ne
   * peut donc pas écrire un texte de son choix sur l'écran des autres.
   */
  booting: (game: number, save: number) => void;
  /** « Ça saccade, maintenant. »
   *
   * Le geste qui manquait le plus: une plainte arrive le lendemain avec une
   * heure approximative, et il faut la retrouver. Ce bouton pose un repère à
   * l'instant exact, avec ce que la page voyait à ce moment-là. */
  complain: (sample: Vitals & { fin: Trail }) => Promise<void>;
};

/** Ce que le salon dit quand la salle change de jeu: des noms, déjà traduits. */
export type Booting = {
  game: string;
  save: string;
  saveSlot?: 0 | 1;
  pads?: Record<string, number>;
};

/** Une demande reçue: qui, et pour quelle place. */
export type Asked = { from: string; port: number };
/** La réponse à une demande envoyée. */
export type Answered = { ok: boolean; port: number; from: string };

export type RecoveryNotice = {
  id: string;
  port: number | null;
  from: string;
  to: string;
  asking: boolean;
  remaining: number;
  reason: string | null;
};

/** Opens the lobby and keeps the cache fed. Returns what we can tell it. */
export function useLobby(
  key: string,
  name: string,
  /** Vrai quand cette page ne sert que de manette.
   *
   * Voyage à l'arrivée, avec la visite et le drapeau de banc. Le salon l'écrit
   * au journal, et sans lui une page-manette et une page dont la vidéo est
   * cassée se ressemblent exactement: ni l'une ni l'autre n'envoie de relevé,
   * puisqu'il n'y a rien à mesurer. */
  padOnly: boolean,
  onAsked: (asked: Asked) => void,
  onAnswered: (answered: Answered) => void,
  /** La salle change de jeu, et ce n'est pas nous qui l'avons demandé. */
  onBooting: (told: Booting) => void,
  onRecovery?: (notice: RecoveryNotice | null) => void,
): Lobby {
  const client = useQueryClient();
  const socket = useRef<Socket | null>(null);
  const assignment = useRef<{ port: number | null; claim: string | null }>({
    port: null,
    claim: null,
  });
  const heard = useRef({
    asked: onAsked,
    answered: onAnswered,
    booting: onBooting,
    recovery: onRecovery,
  });
  heard.current = {
    asked: onAsked,
    answered: onAnswered,
    booting: onBooting,
    recovery: onRecovery,
  };
  const [, setOpen] = useState(false);

  // La socket se rouvre quand l'IDENTITÉ change, pas quand le pseudo change.
  // Quand le proxy dit qui on est, le serveur ignore le prénom envoyé ici, et
  // rouvrir à chaque changement de pseudo ferait sortir puis rentrer quelqu'un
  // de la salle pour rien.
  useEffect(() => {
    if (!key) return;
    // Same origin, and the path the service mounts. The name travels in `auth`
    // rather than a query string: it is not secret, but a URL is written to
    // every log between here and there, and a name is still a person.
    const lobby = io({
      path: "/socket.io",
      // La VISITE voyage ici aussi, et le drapeau de banc avec elle. Le salon
      // les inscrit dans son journal à chaque événement, ce qui est la seule
      // façon de retrouver une soirée après coup: voir `lib/visit`.
      auth: { name, visite: VISIT, banc: onBench(), manette: padOnly },
      transports: ["websocket"],
      // A room whose control plane is not running still plays; it just has no
      // names beside the seats. Backing off to ten seconds keeps that case from
      // opening a socket every half second for the whole session.
      reconnectionDelayMax: 10_000,
    });
    lobby.on("room", (room: Room) => {
      void client.cancelQueries({ queryKey: ROOM_KEY });
      client.setQueryData(ROOM_KEY, room);
    });
    // Par des références qui ne changent pas: ces deux-là viennent de la page et
    // seraient reconstruites à chaque rendu, ce qui rouvrirait la socket.
    lobby.on("asked", (asked: Asked) => heard.current.asked(asked));
    lobby.on("answered", (answered: Answered) => heard.current.answered(answered));
    lobby.on("booting", (told: Booting) => heard.current.booting(told));
    lobby.on("recovery", (notice: RecoveryNotice) => heard.current.recovery?.(notice));
    lobby.on("disconnect", () => heard.current.recovery?.(null));
    // Réaffirmer seulement la place actuelle, sans rejouer des annonces
    // anciennes mises en file pendant la coupure. Une seconde dépasse aussi
    // le garde de cadence du salon, qui peut refuser une transition rapide.
    const announce = () => {
      if (lobby.connected) lobby.volatile.emit("seat", assignment.current);
    };
    lobby.on("connect", announce);
    const timer = window.setInterval(announce, 1000);
    socket.current = lobby;
    setOpen(true);
    return () => {
      window.clearInterval(timer);
      socket.current = null;
      lobby.removeAllListeners();
      lobby.close();
    };
    // Et quand le mode de la page change. Passer en manette seule reconstruit
    // déjà la session média, donc la place est rendue puis reprise de toute
    // façon: rouvrir la socket du salon au même moment ne coûte rien de plus et
    // garde le journal vrai. Sans ça, une page qui a basculé resterait inscrite
    // sous son mode d'arrivée, et le journal dirait « manette » d'un appareil
    // qui montre l'image.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, client, padOnly]);

  const request = async (event: string, data: Record<string, unknown>) => {
    if (!socket.current?.connected) throw new Error("Le salon ne répond pas.");
    const answer = (await socket.current.timeout(5000).emitWithAck(event, data)) as {
      ok?: boolean;
      error?: string;
      port: number | null;
      claim: string | null;
    } | null;
    if (!answer?.ok)
      throw new Error(answer?.error ?? "La demande n'a pas été confirmée. Réessaie.");
    return answer;
  };
  return {
    recover: (action) => request("recover", action),
    closeGame: async (game) => {
      await request("close_game", { game });
    },
    prepare: async (action) => {
      await request("preparation", action);
    },
    seat: (port: number | null, claim: string | null) => {
      assignment.current = { port, claim };
      if (socket.current?.connected) socket.current.volatile.emit("seat", assignment.current);
    },
    renamed: (chosen: string) => socket.current?.emit("rename", { name: chosen }),
    answer: (port: number, ok: boolean) => socket.current?.emit("answer", { port, ok }),
    booting: (game: number, save: number) =>
      socket.current?.emit("booting", { jeu: game, sauvegarde: save }),
    vitals: (sample: Vitals) => socket.current?.emit("mesures", sample),
    complain: async (sample: Vitals & { fin: Trail }) => {
      await request("plainte", sample);
    },
  };
}
