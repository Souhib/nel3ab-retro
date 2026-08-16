/**
 * La salle, avant d'y entrer.
 *
 * Une salle et non une liste, parce qu'il y a un émulateur sur un GPU sur une
 * machine: en montrer une liste d'un élément serait une page pour un clic. Ce
 * que cet écran apporte n'est pas le choix, c'est de **voir la salle avant d'y
 * entrer**: quel jeu tourne, qui est déjà là, et s'il reste une manette.
 *
 * Rien ne démarre tant qu'on n'est pas entré. Une image décodée derrière un
 * écran que personne ne regarde coûte à la machine sur laquelle un autre joue.
 */
import { useState } from "react";
import type { Room } from "../client";
import { NAME_MAX } from "../lib/name";
import { cn } from "../lib/cn";

export function Lobby({
  room,
  name,
  login,
  failed,
  onEnter,
  onWatch,
  onForget,
  onRename,
}: {
  room: Room | undefined;
  name: string;
  login: string | null;
  failed: boolean;
  onEnter: () => void;
  /** Entrer sans prendre de manette. Une porte séparée plutôt qu'un réglage à
   * changer après: quelqu'un qui vient regarder ne doit pas occuper une place le
   * temps de la rendre. */
  onWatch: () => void;
  onForget: () => void;
  onRename: (name: string) => void;
}) {
  const seats = room?.seats ?? [];
  const people = room?.people ?? [];
  const free = seats.filter((seat) => !seat.player).length;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-indigo">
            nel3ab
          </span>
          <NameTag name={name} login={login} onRename={onRename} onForget={onForget} />
        </header>

        <section id="room" className="flex flex-col gap-3 border border-rule bg-panel p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-[18px] font-medium tracking-tight">{room?.name ?? "…"}</h1>
            <span className={cn("font-mono text-[11px]", free > 0 ? "text-good" : "text-alert")}>
              {seats.length === 0
                ? ""
                : free > 0
                  ? `${free} manette${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`
                  : "salle pleine"}
            </span>
          </div>

          <div className="flex flex-col gap-0.5 border-t border-rule pt-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-faint">au programme</span>
            <span className="text-[14px]">{room?.game?.name ?? "aucun jeu chargé"}</span>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-rule pt-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-faint">
              {people.length === 0 ? "personne pour l'instant" : `${people.length} dans la salle`}
            </span>
            {people.length > 0 ? (
              <ul id="people" className="flex flex-wrap gap-1.5 pb-1">
                {people.map((person) => (
                  <li
                    key={person.login ?? person.name}
                    title={person.login ?? "sans identité"}
                    className={cn(
                      "border px-2 py-0.5 text-[11px]",
                      person.seat ? "border-indigo/50 text-indigo" : "border-rule text-muted",
                    )}
                  >
                    {person.name}
                    {person.seat ? ` · P${person.seat}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid grid-cols-4 gap-1.5">
              {seats.map((seat) => (
                <div key={seat.port} className="flex flex-col gap-1 border border-rule px-2 py-1.5">
                  <span className="font-mono text-[10px] text-faint">P{seat.port}</span>
                  <span
                    className={cn("truncate text-[12px]", seat.player ? "text-text" : "text-faint")}
                  >
                    {seat.player ?? "libre"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-[2fr_1fr] gap-2">
          <button
            type="button"
            id="enter"
            onClick={onEnter}
            disabled={free === 0 && seats.length > 0}
            className="border border-indigo bg-indigo/10 px-3 py-2.5 text-[13px] text-indigo transition-colors hover:bg-indigo/20 disabled:opacity-40"
          >
            {free === 0 && seats.length > 0 ? "salle pleine" : "entrer et jouer"}
          </button>
          <button
            type="button"
            id="watch"
            onClick={onWatch}
            className="border border-rule px-3 py-2.5 text-[13px] text-muted transition-colors hover:border-indigo hover:text-indigo"
          >
            regarder
          </button>
        </div>

        <p className="text-[11px] leading-relaxed text-faint">
          {failed
            ? "Le salon ne répond pas: tu peux jouer, mais les places n'afficheront pas de nom."
            : "Entrer prend une manette s'il en reste une, sinon tu regardes. Changer de jeu arrête la partie de tout le monde."}
        </p>
      </div>
    </div>
  );
}

/**
 * Le nom qu'on porte, et le seul morceau qu'on a le droit de changer.
 *
 * Quand le proxy dit qui on est, l'adresse est affichée et n'est pas
 * modifiable: c'est ce qui rend le pseudo sûr, puisqu'il est rangé sous elle.
 * Sans identité, on retombe sur « ce n'est pas toi ? », qui oublie le prénom
 * gardé dans le navigateur.
 */
function NameTag({
  name,
  login,
  onRename,
  onForget,
}: {
  name: string;
  login: string | null;
  onRename: (name: string) => void;
  onForget: () => void;
}) {
  const [typing, setTyping] = useState<string | null>(null);

  if (typing !== null) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const chosen = typing.trim().slice(0, NAME_MAX);
          if (chosen) onRename(chosen);
          setTyping(null);
        }}
      >
        <input
          id="newName"
          autoFocus
          maxLength={NAME_MAX}
          value={typing}
          onChange={(event) => setTyping(event.target.value)}
          className="min-w-0 flex-1 border border-rule bg-panel px-2 py-1 text-[12px] outline-none focus:border-indigo"
        />
        <button type="submit" className="border border-indigo px-2 py-1 text-[11px] text-indigo">
          garder
        </button>
        <button
          type="button"
          onClick={() => setTyping(null)}
          className="px-1 text-[11px] text-faint hover:text-text"
        >
          annuler
        </button>
      </form>
    );
  }

  return (
    <p className="text-[12px] text-muted">
      bonjour <span className="text-text">{name}</span>.{" "}
      <button
        type="button"
        id="rename"
        onClick={() => setTyping(name)}
        className="text-faint underline hover:text-indigo"
      >
        changer de pseudo
      </button>
      {login ? (
        <span className="ml-1 text-faint" title="l'adresse que Tailscale garantit">
          · {login}
        </span>
      ) : (
        <>
          {" · "}
          <button
            type="button"
            onClick={onForget}
            className="text-faint underline hover:text-indigo"
          >
            ce n'est pas toi ?
          </button>
        </>
      )}
    </p>
  );
}
