/**
 * Le menu, en plein écran, comme une console.
 *
 * La colonne de droite est un appareil de mesure: elle est faite pour être lue
 * pendant qu'on joue, en petit et sans bouger. Choisir un jeu n'est pas ça. On
 * lâche la partie, on regarde une liste, on décide — c'est un moment à part, et
 * il mérite tout l'écran.
 *
 * Trois rayons, et un seul à la fois. La navigation marche au clavier de haut en
 * bas parce que c'est une console: quelqu'un qui tient une manette n'a pas
 * forcément une souris à portée.
 */
import { useEffect, useRef, useState } from "react";
import type { Game, Person } from "../client";
import { cn } from "../lib/cn";
import { Socket } from "./Socket";

export type Tab = "jeux" | "salle" | "reglages";

const TABS: { id: Tab; label: string }[] = [
  { id: "jeux", label: "jeux" },
  { id: "salle", label: "salle" },
  { id: "reglages", label: "réglages" },
];

export function Menu({
  room,
  games,
  running,
  canChoose,
  why,
  people,
  players,
  busy,
  names,
  mine,
  stealable,
  onChoose,
  onTake,
  onClose,
  settings,
}: {
  room: string;
  games: Game[];
  running: number | null;
  canChoose: boolean;
  why: string | null;
  people: Person[];
  players: number;
  busy: boolean[];
  names: Map<number, string>;
  mine: number | null;
  /** Les places qu'on a le droit de prendre: une prise tenue par quelqu'un qui
   * est là ne s'arrache pas d'un clic. */
  stealable: (port: number) => boolean;
  onChoose: (index: number) => void;
  onTake: (port: number) => void;
  onClose: () => void;
  settings: React.ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("jeux");
  const [cursor, setCursor] = useState(Math.max(0, running ?? 0));
  const [armed, setArmed] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);

  // Haut, bas, entrée, échap. Une console se tient à une main.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape") return onClose();
      if (tab !== "jeux" || games.length === 0) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setCursor((was) => (was + step + games.length) % games.length);
        setArmed(null);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        choose(games[cursor]?.index ?? 0);
      }
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  });

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-cursor="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [cursor, tab]);

  /* Un clic arme, le second lance. Changer de jeu arrête la partie de tout le
     monde, sans sauvegarde et sans retour: c'est la même forme que prendre la
     manette de quelqu'un, pour la même raison. */
  const choose = (index: number) => {
    if (!canChoose || index === running) return;
    if (armed !== index) return setArmed(index);
    setArmed(null);
    onChoose(index);
  };

  return (
    <div id="menu" className="fixed inset-0 z-50 flex flex-col bg-ink">
      <header className="flex items-center justify-between gap-4 border-b border-rule px-6 py-4">
        <div className="flex items-baseline gap-4">
          <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-indigo">
            nel3ab
          </span>
          <h1 className="text-[18px]">{room}</h1>
        </div>
        <nav className="flex gap-1">
          {TABS.map((choice) => (
            <button
              key={choice.id}
              type="button"
              id={`tab-${choice.id}`}
              onClick={() => setTab(choice.id)}
              className={cn(
                "border px-4 py-1.5 text-[13px] transition-colors",
                tab === choice.id
                  ? "border-indigo text-indigo"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {choice.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          id="closeMenu"
          onClick={onClose}
          className="border border-rule px-3 py-1.5 text-[12px] text-muted hover:border-indigo hover:text-indigo"
        >
          reprendre (Échap)
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {tab === "jeux" ? (
          <div ref={list} className="mx-auto flex max-w-3xl flex-col gap-1.5">
            {games.map((game, row) => {
              const isRunning = game.index === running;
              const isArmed = game.index === armed;
              return (
                <button
                  key={game.index}
                  type="button"
                  id={`game${game.index}`}
                  data-cursor={row === cursor}
                  data-armed={isArmed}
                  disabled={!canChoose || isRunning}
                  onMouseEnter={() => setCursor(row)}
                  onClick={() => choose(game.index)}
                  className={cn(
                    "flex items-baseline justify-between gap-4 border px-5 py-4 text-left text-[16px] transition-colors",
                    isRunning && "border-indigo/60 bg-indigo/10 text-indigo",
                    isArmed && "border-alert bg-alert/10 text-alert",
                    !isRunning && !isArmed && row === cursor && "border-rule-bright text-text",
                    !isRunning && !isArmed && row !== cursor && "border-rule text-muted",
                    !canChoose && !isRunning && "opacity-50",
                  )}
                >
                  <span className="truncate">{game.name}</span>
                  <span className="shrink-0 font-mono text-[11px]">
                    {isRunning ? "en cours" : isArmed ? "confirmer ?" : ""}
                  </span>
                </button>
              );
            })}
            <p className="pt-2 text-[12px] text-faint">
              {canChoose
                ? armed === null
                  ? "haut, bas, entrée. Changer de jeu arrête la partie de tout le monde."
                  : "encore une fois pour lancer"
                : (why ?? "")}
            </p>
          </div>
        ) : null}

        {tab === "salle" ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-6">
            <div className="grid grid-cols-4 gap-4">
              {Array.from({ length: players }, (_, slot) => slot + 1).map((port) => {
                const isMine = port === mine;
                const held = busy[port - 1] ?? false;
                const locked = held && !isMine && !stealable(port);
                return (
                  <button
                    key={port}
                    type="button"
                    id={`port${port}`}
                    data-state={isMine ? "mine" : held ? "busy" : "free"}
                    disabled={isMine || locked}
                    onClick={() => onTake(port)}
                    title={
                      locked
                        ? "cette manette est tenue par quelqu'un qui est dans la salle"
                        : undefined
                    }
                    className={cn("border-0 bg-transparent p-0", locked && "opacity-60")}
                  >
                    <Socket port={port} state={isMine ? "mine" : held ? "busy" : "free"} />
                    <span className="block truncate text-center text-[12px] text-muted">
                      {isMine ? "toi" : held ? (names.get(port) ?? "occupée") : "libre"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col gap-2 border-t border-rule pt-4">
              <span className="text-[10px] uppercase tracking-[0.2em] text-faint">
                {people.length === 0 ? "personne" : `${people.length} dans la salle`}
              </span>
              <ul className="flex flex-wrap gap-2">
                {people.map((person) => (
                  <li
                    key={person.login ?? person.name}
                    className={cn(
                      "border px-3 py-1 text-[13px]",
                      person.seat ? "border-indigo/50 text-indigo" : "border-rule text-muted",
                    )}
                  >
                    {person.name}
                    {person.seat ? ` · manette ${person.seat}` : " · spectateur"}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {tab === "reglages" ? (
          <div className="mx-auto flex max-w-md flex-col gap-3">{settings}</div>
        ) : null}
      </div>
    </div>
  );
}
