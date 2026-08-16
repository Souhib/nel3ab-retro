/**
 * The room: a picture, and a column of instruments beside it.
 *
 * The picture takes the height of the window and never causes the page to
 * scroll. Everything else lives in a fixed column on the right that scrolls
 * inside itself, so reading a number never moves the image and never asks
 * anybody to scroll away from the game they are playing.
 */
import { useEffect, useState } from "react";
import type { Room as RoomState } from "./client";
import { Entrance } from "./components/Entrance";
import { Lobby } from "./components/Lobby";
import { Instruments } from "./components/Instruments";
import { Library } from "./components/Library";
import { Panel } from "./components/Readout";
import { Screen } from "./components/Screen";
import { Seats } from "./components/Seats";
import { Toggle, Volume } from "./components/Settings";
import { forgetName, rememberedName } from "./lib/name";
import { useLobby, useRoom } from "./lib/room";
import { useSession, useSnapshot } from "./lib/useSession";

/** Trois écrans, dans l'ordre: le nom, la salle, la partie. */
export default function App() {
  const [name, setName] = useState(rememberedName);
  const [entered, setEntered] = useState(false);

  if (!name) return <Entrance onName={setName} />;
  return (
    <Named
      name={name}
      entered={entered}
      onEnter={() => setEntered(true)}
      onForget={() => {
        forgetName();
        setEntered(false);
        setName("");
      }}
    />
  );
}

/** Ce qui vaut dès qu'on a un nom: une socket de salon, et une description de
 * la salle. Les deux vivent ici plutôt que dans la partie, pour que l'écran de
 * salle se mette à jour tout seul quand quelqu'un s'assoit. */
function Named({
  name,
  entered,
  onEnter,
  onForget,
}: {
  name: string;
  entered: boolean;
  onEnter: () => void;
  onForget: () => void;
}) {
  const { data: room, isError } = useRoom();
  const announceSeat = useLobby(name);

  if (!entered) {
    return <Lobby room={room} name={name} failed={isError} onEnter={onEnter} onForget={onForget} />;
  }
  return <Room name={name} room={room} announceSeat={announceSeat} />;
}

function Room({
  name,
  room,
  announceSeat,
}: {
  name: string;
  room: RoomState | undefined;
  announceSeat: (port: number | null) => void;
}) {
  const [volume, setVolume] = useState(0.7);
  const [deviceRate, setDeviceRate] = useState(false);
  const [lipsync, setLipsync] = useState(false);

  const { ref, session } = useSession(volume, deviceRate, announceSeat);
  const shot = useSnapshot(session);

  useEffect(() => session?.sound.setVolume(volume), [session, volume]);
  useEffect(() => session?.sound.setDeviceRate(deviceRate), [session, deviceRate]);
  useEffect(() => session?.setLipsync(lipsync), [session, lipsync]);

  const port = shot?.input.port ?? null;
  const learning = shot?.input.learning ?? null;
  // Occupancy from the worker, names from the control plane. Neither knows the
  // other's half, and neither is asked for it.
  const names = new Map(
    (room?.seats ?? []).flatMap((seat) => (seat.player ? [[seat.port, seat.player] as const] : [])),
  );

  return (
    <div className="flex h-full">
      <main className="flex min-w-0 flex-1 flex-col">
        <Screen canvasRef={ref} connected={shot?.video.connected ?? false} />
        {learning ? (
          <div className="flex items-center justify-between gap-4 border-t border-indigo/40 bg-indigo/10 px-4 py-2 text-[12px]">
            <span>
              apprentissage de la manette, appuie sur{" "}
              <strong className="text-indigo">{learning}</strong>
            </span>
            <button
              type="button"
              id="skipStep"
              onClick={() => session?.input.skipLessonStep()}
              className="border border-indigo/50 px-2 py-1 text-[11px] text-indigo"
            >
              passer
            </button>
          </div>
        ) : null}
      </main>

      <aside
        id="side"
        className="flex w-[19rem] shrink-0 flex-col gap-3 overflow-y-auto border-l border-rule bg-panel px-3 py-3"
      >
        <header className="flex flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-indigo">
            nel3ab
          </span>
          <h1 className="truncate text-[15px] font-medium">{room?.name ?? "salon"}</h1>
          <p className="truncate text-[12px] text-muted">{room?.game?.name ?? "aucun jeu"}</p>
          <p id="seat" className="text-[11px] text-faint">
            {name}
            {port === null ? " · sans manette" : ` · manette ${port}`}
          </p>
        </header>

        <Panel title="manettes">
          <Seats
            players={shot?.input.players ?? 4}
            busy={shot?.input.busy ?? []}
            names={names}
            mine={port}
            displaced={shot?.input.displaced ?? false}
            onTake={(chosen) => session?.input.take(chosen)}
          />
        </Panel>

        <Panel title="jeux">
          <Library
            games={room?.library ?? []}
            running={room?.game?.index ?? null}
            canChoose={port !== null}
            onChoose={(index) => session?.input.chooseGame(index) ?? false}
          />
        </Panel>

        <Panel title="réglages">
          {/* A browser refuses to make noise until somebody clicks something,
              and it is right to: a room that starts shouting when a tab opens is
              a room nobody opens twice. */}
          {shot?.sound.state === "running" ? null : (
            <button
              type="button"
              id="sound"
              onClick={() => void session?.sound.start()}
              className="mb-1 w-full border border-indigo/60 px-2 py-1.5 text-[12px] text-indigo hover:bg-indigo/10"
            >
              activer le son
            </button>
          )}
          <Volume value={volume} onChange={setVolume} />
          <Toggle
            id="lipsync"
            label="caler l'image sur le son"
            hint="retarde l'image du retard mesuré du son, au lieu de la montrer en avance"
            on={lipsync}
            onChange={setLipsync}
          />
          <Toggle
            id="deviceRate"
            label="laisser la carte son choisir sa fréquence"
            hint="évite un rééchantillonnage, mais la carte peut imposer un tampon plus long"
            on={deviceRate}
            onChange={setDeviceRate}
          />
          {shot?.input.padLayout === "unknown" ? (
            <button
              type="button"
              id="learnPad"
              onClick={() => session?.input.beginLesson()}
              className="mt-1 w-full border border-rule px-2 py-1.5 text-[12px] text-muted hover:border-indigo hover:text-indigo"
            >
              apprendre cette manette
            </button>
          ) : null}
        </Panel>

        {/* Always rendered, never behind a fold. The numbers are how four
            separate freezes were explained; a panel somebody has to remember to
            open is a panel that is shut when it matters. */}
        <div id="stats">{shot ? <Instruments shot={shot} /> : null}</div>
      </aside>
    </div>
  );
}
