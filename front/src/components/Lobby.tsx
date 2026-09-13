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
import { PLAYER_COLOURS } from "../media/players";
import { LOBBIES, type LobbyLook } from "../lib/theme";
import { LobbyCables } from "./LobbyCables";

/** Le salon est-il au-dessus de cette page ?
 *
 * Derrière le proxy, une salle est servie sous `/r/N/` et la racine porte la
 * liste des salles. Servie EN DIRECT par le worker, la même page est déjà la
 * racine: un retour y rechargerait la salle qu'on voulait quitter. On ne montre
 * donc le retour que lorsqu'il mène quelque part, plutôt que d'afficher un
 * bouton qui ment. C'est la même règle que partout ici: pas de commande qui
 * ressemble à une commande sans en être une.
 */
export const salonAuDessus = (chemin: string): boolean => /^\/r\/[1-9]\d*\//.test(chemin);

export function Lobby({
  room,
  name,
  login,
  failed,
  onEnter,
  onWatch,
  onForget,
  onRename,
  salon = typeof window === "undefined" ? false : salonAuDessus(window.location.pathname),
  look = "classique",
  onLook,
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
  /** Vrai quand un salon existe au-dessus. Passé explicitement par les essais,
   * lu sur l'adresse autrement. */
  salon?: boolean;
  /** Lequel des deux dessins. Le classique tant que rien n'est choisi. */
  look?: LobbyLook;
  /** Changer de dessin. Absent dans les essais qui n'en testent qu'un. */
  onLook?: (look: LobbyLook) => void;
}) {
  const seats = room?.seats ?? [];
  const people = room?.people ?? [];
  const free = seats.filter((seat) => !seat.player).length;

  /* L'en-tête et les commandes sont PARTAGÉS par les deux dessins.
     Les identifiants `#toRooms`, `#rename`, `#newName`, `#enter` et `#watch`
     sont un contrat avec les pilotes de navigateur. Les écrire deux fois, une
     par dessin, serait deux endroits à tenir d'accord, et c'est exactement la
     faute que ce dépôt a déjà payée sur les quatre places. */
  const entete = (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={cn(
            "font-mono text-mini uppercase tracking-[0.3em]",
            look === "cables" ? "" : "text-indigo",
          )}
          style={look === "cables" ? { color: "#8fa4c4" } : undefined}
        >
          nel3ab
        </span>
        <span className="flex items-baseline gap-3">
          {onLook ? <LookSwitch look={look} onLook={onLook} /> : null}
          {salon ? (
            <a
              id="toRooms"
              href="/"
              className={cn(
                "text-note underline transition-colors",
                look === "cables" ? "opacity-70 hover:opacity-100" : "text-faint hover:text-indigo",
              )}
            >
              toutes les salles
            </a>
          ) : null}
        </span>
      </div>
      <NameTag name={name} login={login} onRename={onRename} onForget={onForget} />
    </header>
  );

  const commandes = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[2fr_1fr] gap-2">
        <button
          type="button"
          id="enter"
          onClick={onEnter}
          disabled={free === 0 && seats.length > 0}
          className="border border-indigo bg-indigo/10 px-3 py-2.5 text-corps text-indigo transition-colors hover:bg-indigo/20 disabled:opacity-40"
        >
          {free === 0 && seats.length > 0 ? "salle pleine" : "entrer et jouer"}
        </button>
        <button
          type="button"
          id="watch"
          onClick={onWatch}
          className="border border-rule px-3 py-2.5 text-corps text-muted transition-colors hover:border-indigo hover:text-indigo"
        >
          regarder
        </button>
      </div>
      <p className="text-note leading-relaxed text-faint">
        {failed
          ? "Le salon ne répond pas: tu peux jouer, mais les places n'afficheront pas de nom."
          : "Entrer prend une manette s'il en reste une, sinon tu regardes. Changer de jeu arrête la partie de tout le monde."}
      </p>
    </div>
  );

  if (look === "cables") {
    return (
      <LobbyCables room={room} free={free} actions={commandes}>
        {entete}
      </LobbyCables>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-5">
        {entete}

        <section id="room" className="flex flex-col gap-3 border border-rule bg-panel p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-titre font-medium tracking-tight">{room?.name ?? "…"}</h1>
            <span className={cn("font-mono text-note", free > 0 ? "text-good" : "text-alert")}>
              {seats.length === 0
                ? ""
                : free > 0
                  ? `${free} manette${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`
                  : "salle pleine"}
            </span>
          </div>

          <div className="flex flex-col gap-0.5 border-t border-rule pt-3">
            <span className="text-mini uppercase tracking-[0.2em] text-faint">au programme</span>
            <span className="text-fort">{room?.game?.name ?? "aucun jeu chargé"}</span>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-rule pt-3">
            <span className="text-mini uppercase tracking-[0.2em] text-faint">
              {people.length === 0 ? "personne pour l'instant" : `${people.length} dans la salle`}
            </span>
            {people.length > 0 ? (
              <ul id="people" className="flex flex-wrap gap-1.5 pb-1">
                {people.map((person) => (
                  <li
                    key={person.login ?? person.name}
                    title={person.login ?? "sans identité"}
                    className={cn(
                      "border px-2 py-0.5 text-note",
                      person.seat ? "border-indigo/50 text-indigo" : "border-rule text-muted",
                    )}
                  >
                    {person.name}
                    {person.seat ? ` · P${person.seat}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <div id="lobbySeats" className="grid grid-cols-4 gap-px border border-rule">
              {seats.map((seat) => {
                const colour = PLAYER_COLOURS[seat.port - 1] ?? PLAYER_COLOURS[0];
                const taken = Boolean(seat.player);
                return (
                  <div
                    key={seat.port}
                    data-port={seat.port}
                    data-state={taken ? "busy" : "free"}
                    className="flex min-w-0 flex-col gap-1 px-2 py-2"
                    style={{
                      borderTop: `3px solid ${colour}`,
                      backgroundColor: taken ? `${colour}1f` : "transparent",
                    }}
                  >
                    <span
                      className="font-mono text-mini"
                      style={{ color: colour, opacity: taken ? 1 : 0.7 }}
                    >
                      P{seat.port}
                    </span>
                    <span className={cn("truncate text-corps", taken ? "text-text" : "text-faint")}>
                      {seat.player ?? "libre"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {commandes}
      </div>
    </div>
  );
}

/** Le petit bouton qui change de dessin.
 *
 * Sur la PAGE et pas dans un menu: il n'y a aucun menu avant d'entrer, et un
 * réglage qu'on ne peut atteindre qu'après être entré ne sert à rien pour
 * choisir l'écran d'entrée. Il annonce le dessin vers lequel il emmène, pas
 * celui où l'on est: un bouton dit ce qu'il FAIT.
 */
function LookSwitch({ look, onLook }: { look: LobbyLook; onLook: (look: LobbyLook) => void }) {
  const suivant = LOBBIES.find((choice) => choice.id !== look) ?? LOBBIES[0];
  return (
    <button
      type="button"
      id="lookSwitch"
      onClick={() => onLook(suivant.id)}
      title={suivant.note}
      className="text-note underline opacity-60 transition-opacity hover:opacity-100"
    >
      {suivant.label}
    </button>
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
          className="min-w-0 flex-1 border border-rule bg-panel px-2 py-1 text-corps outline-none focus:border-indigo"
        />
        <button type="submit" className="border border-indigo px-2 py-1 text-note text-indigo">
          garder
        </button>
        <button
          type="button"
          onClick={() => setTyping(null)}
          className="px-1 text-note text-faint hover:text-text"
        >
          annuler
        </button>
      </form>
    );
  }

  return (
    <p className="text-corps text-muted">
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
