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
import { Bindings, PadSummary } from "./components/Bindings";
import { cn } from "./lib/cn";
import { Entrance } from "./components/Entrance";
import { Lobby } from "./components/Lobby";
import { Instruments } from "./components/Instruments";
import { Booting, type Step } from "./components/Booting";
import { Menu } from "./components/Menu";
import { Panel } from "./components/Readout";
import { Screen } from "./components/Screen";
import { Seats } from "./components/Seats";
import { Toggle, Volume } from "./components/Settings";
import { forgetName, rememberedName } from "./lib/name";
import { THEMES, applyTheme, rememberTheme, storedTheme } from "./lib/theme";
import { useBare } from "./lib/fullscreen";
import { useMe, useRename } from "./lib/me";
import { useLobby, useRoom } from "./lib/room";
import { useSession, useSnapshot } from "./lib/useSession";

/**
 * Trois écrans, dans l'ordre: qui joue, la salle, la partie.
 *
 * Le premier disparaît quand le proxy dit déjà qui on est, ce qui est le cas
 * normal: demander son nom à quelqu'un dont on connaît l'adresse vérifiée est un
 * formulaire pour rien. Il reste pour le développement local et pour une salle
 * servie sans plan de contrôle, où il n'y a personne à reconnaître.
 */
export default function App() {
  const { data: me, isPending } = useMe();
  const [local, setLocal] = useState(rememberedName);
  const [entered, setEntered] = useState(false);

  // Rien tant que l'identité n'a pas répondu: afficher le formulaire une demi
  // seconde avant de le retirer se lit comme un défaut.
  if (isPending) return null;

  const identified = me?.login ?? null;
  const name = identified ? me!.name : local;
  if (!name) return <Entrance onName={setLocal} />;
  return (
    <Named
      name={name}
      login={identified}
      entered={entered}
      onEnter={() => setEntered(true)}
      onForget={() => {
        forgetName();
        setEntered(false);
        setLocal("");
      }}
    />
  );
}

/** Ce qui vaut dès qu'on a un nom: une socket de salon, et une description de
 * la salle. Les deux vivent ici plutôt que dans la partie, pour que l'écran de
 * salle se mette à jour tout seul quand quelqu'un s'assoit. */
function Named({
  name,
  login,
  entered,
  onEnter,
  onForget,
}: {
  name: string;
  login: string | null;
  entered: boolean;
  onEnter: () => void;
  onForget: () => void;
}) {
  const { data: room, isError } = useRoom();
  const lobby = useLobby(login ?? name, name);
  const rename = useRename(lobby.renamed);

  if (!entered) {
    return (
      <Lobby
        room={room}
        name={name}
        login={login}
        failed={isError}
        onEnter={onEnter}
        onForget={onForget}
        onRename={(chosen) => rename.mutate(chosen)}
      />
    );
  }
  return <Room name={name} login={login} room={room} announceSeat={lobby.seat} />;
}

function Room({
  name,
  login,
  room,
  announceSeat,
}: {
  name: string;
  login: string | null;
  room: RoomState | undefined;
  announceSeat: (port: number | null) => void;
}) {
  const { bare, setBare, fullscreen, toggleFullscreen } = useBare();
  const [volume, setVolume] = useState(0.7);
  const [deviceRate, setDeviceRate] = useState(false);
  const [lipsync, setLipsync] = useState(false);
  const [bindings, setBindings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState(storedTheme);
  /** Le jeu demandé et l'image peinte au moment où on l'a demandé.
   *
   * Deux choses parce que la fin du chargement se reconnaît à une IMAGE, pas à
   * une socket: le worker répond avant que Dolphin ait dessiné quoi que ce soit,
   * et cacher l'écran de chargement là montrerait du noir. */
  const [booting, setBooting] = useState<{ game: string; painted: number } | null>(null);

  const { ref, session } = useSession(volume, deviceRate, announceSeat);
  const shot = useSnapshot(session);

  useEffect(() => session?.sound.setVolume(volume), [session, volume]);
  useEffect(() => session?.sound.setDeviceRate(deviceRate), [session, deviceRate]);
  useEffect(() => session?.setLipsync(lipsync), [session, lipsync]);
  // Échap ouvre le menu, comme sur une console. Les écrans qui se ferment avec
  // Échap (menu, touches) le gèrent eux-mêmes, donc on ne l'ouvre que quand
  // rien n'est ouvert.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape" && !menu && !bindings) setMenu(true);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [menu, bindings]);

  useEffect(() => {
    if (booting === null || shot === null) return;
    // Une trentaine d'images après la reprise: la toute première est parfois une
    // image-clé du jeu précédent restée dans le décodeur, et disparaître dessus
    // ferait clignoter l'ancien jeu une demi-seconde.
    if (shot.video.painted > booting.painted + 30) setBooting(null);
  }, [booting, shot]);
  useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);

  const port = shot?.input.port ?? null;
  const learning = shot?.input.learning ?? null;
  const people = room?.people ?? [];

  /* Les mêmes réglages dans la colonne et dans le menu. Deux copies auraient
     fini par diverger, et c'est le genre d'écart qu'on ne voit qu'en montrant
     l'écran à quelqu'un. */
  const settings = (
    <>
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
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          id="bare"
          onClick={() => setBare(true)}
          className="flex-1 border border-rule px-2 py-1.5 text-[12px] text-muted transition-colors hover:border-indigo hover:text-indigo"
        >
          replier (F)
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex-1 border border-rule px-2 py-1.5 text-[12px] text-muted transition-colors hover:border-indigo hover:text-indigo"
        >
          {fullscreen ? "fenêtre" : "plein écran"}
        </button>
      </div>

      <div className="mt-1 flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-faint">thème</span>
        <div className="grid grid-cols-2 gap-1">
          {THEMES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              id={`theme-${choice.id}`}
              title={choice.note}
              onClick={() => setTheme(choice.id)}
              className={cn(
                "border px-2 py-1 text-left text-[11px] transition-colors",
                theme === choice.id
                  ? "border-indigo text-indigo"
                  : "border-rule text-muted hover:border-rule-bright",
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
  // Le propriétaire décide du jeu. Quand la salle n'en a pas — aucun proxy
  // devant, donc personne d'identifié — elle retombe sur sa règle d'avant, où
  // tenir une manette suffit: refuser tout laisserait une salle où plus
  // personne ne peut rien.
  const boss = room?.owner ?? null;
  const mine = boss === null || (login !== null && boss.login === login);
  // Occupancy from the worker, names from the control plane. Neither knows the
  // other's half, and neither is asked for it.
  const names = new Map(
    (room?.seats ?? []).flatMap((seat) => (seat.player ? [[seat.port, seat.player] as const] : [])),
  );

  return (
    <div className="flex h-full">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Screen canvasRef={ref} connected={shot?.video.connected ?? false} />
        {bare ? (
          /* Replié, il reste de quoi revenir. Discret et dans un coin: une barre
             permanente par-dessus l'image rendrait le repli inutile. */
          <div className="absolute top-2 right-2 flex gap-1 opacity-30 transition-opacity hover:opacity-100">
            <button
              type="button"
              id="unbare"
              onClick={() => setBare(false)}
              className="border border-rule bg-panel px-2 py-1 text-[11px] text-muted"
            >
              montrer (F)
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="border border-rule bg-panel px-2 py-1 text-[11px] text-muted"
            >
              {fullscreen ? "fenêtre" : "plein écran"}
            </button>
          </div>
        ) : null}
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

      {bare ? null : (
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

          <button
            type="button"
            id="openMenu"
            onClick={() => setMenu(true)}
            className="border border-indigo/60 px-3 py-2 text-[13px] text-indigo transition-colors hover:bg-indigo/10"
          >
            menu (Échap)
          </button>

          <Panel title="réglages">{settings}</Panel>

          <Panel title="manette">
            {shot ? <PadSummary state={shot.input} onOpen={() => setBindings(true)} /> : null}
          </Panel>

          {/* Always rendered, never behind a fold. The numbers are how four
            separate freezes were explained; a panel somebody has to remember to
            open is a panel that is shut when it matters. */}
          <div id="stats">{shot ? <Instruments shot={shot} /> : null}</div>
        </aside>
      )}

      {booting ? (
        <Booting
          game={booting.game}
          step={
            ((shot?.video.connected ?? false)
              ? shot && shot.video.painted > booting.painted
                ? "painting"
                : "waiting"
              : "asked") as Step
          }
        />
      ) : null}

      {menu && shot ? (
        <Menu
          room={room?.name ?? "salon"}
          games={room?.library ?? []}
          running={room?.game?.index ?? null}
          canChoose={port !== null && mine}
          why={
            port === null
              ? "prends une manette pour changer de jeu"
              : `${boss?.name ?? "quelqu'un"} décide du jeu dans cette salle`
          }
          people={people}
          players={shot.input.players}
          busy={shot.input.busy}
          names={names}
          mine={port}
          stealable={(seat) => !people.some((person) => person.seat === seat)}
          onChoose={(index) => {
            const chosen = room?.library.find((game) => game.index === index);
            if (session?.input.chooseGame(index)) {
              setBooting({ game: chosen?.name ?? "le jeu", painted: shot.video.painted });
              setMenu(false);
            }
          }}
          onTake={(chosen) => session?.input.take(chosen)}
          onClose={() => setMenu(false)}
          settings={settings}
        />
      ) : null}

      {bindings && shot ? (
        <Bindings
          state={shot.input}
          // Chaque action est suivie d'un `refresh`: ce sont des changements
          // locaux et immédiats, et attendre le prochain instantané ferait
          // clignoter l'écran une demi-seconde plus tard.
          onUse={(index) => {
            session?.input.useP(index);
            session?.refresh();
          }}
          onCapture={(control, source) => {
            session?.input.beginCapture(control, source);
            session?.refresh();
          }}
          onCancel={() => {
            session?.input.cancelCapture();
            session?.refresh();
          }}
          onLearn={() => {
            session?.input.beginLesson();
            setBindings(false);
          }}
          onResetPad={() => {
            session?.input.resetPad();
            session?.refresh();
          }}
          onResetKeys={() => {
            session?.input.resetKeys();
            session?.refresh();
          }}
          onClose={() => {
            session?.input.cancelCapture();
            setBindings(false);
          }}
        />
      ) : null}
    </div>
  );
}
