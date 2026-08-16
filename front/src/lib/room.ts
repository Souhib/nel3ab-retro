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
  const answer = await fetch("/roms");
  if (!answer.ok) throw new Error(`la salle ne répond pas (${answer.status})`);
  const found = (await answer.json()) as { current: number | null; roms: string[] };
  const library = found.roms.map((name, index) => ({ index, name }));
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

/** Opens the lobby and keeps the cache fed. Returns a way to say which pad we hold. */
export function useLobby(name: string): (port: number | null) => void {
  const client = useQueryClient();
  const socket = useRef<Socket | null>(null);
  const [, setOpen] = useState(false);

  useEffect(() => {
    if (!name) return;
    // Same origin, and the path the service mounts. The name travels in `auth`
    // rather than a query string: it is not secret, but a URL is written to
    // every log between here and there, and a name is still a person.
    const lobby = io({
      path: "/socket.io",
      auth: { name },
      transports: ["websocket"],
      // A room whose control plane is not running still plays; it just has no
      // names beside the seats. Backing off to ten seconds keeps that case from
      // opening a socket every half second for the whole session.
      reconnectionDelayMax: 10_000,
    });
    lobby.on("room", (room: Room) => client.setQueryData(ROOM_KEY, room));
    // A reconnection may have missed a change while it was down, so ask.
    lobby.io.on("reconnect", () => void client.invalidateQueries({ queryKey: ROOM_KEY }));
    socket.current = lobby;
    setOpen(true);
    return () => {
      socket.current = null;
      lobby.removeAllListeners();
      lobby.close();
    };
  }, [name, client]);

  return (port: number | null) => socket.current?.emit("seat", { port });
}
