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
import type { Room } from "../client";
import { cn } from "../lib/cn";

export function Lobby({
  room,
  name,
  failed,
  onEnter,
  onForget,
}: {
  room: Room | undefined;
  name: string;
  failed: boolean;
  onEnter: () => void;
  onForget: () => void;
}) {
  const seats = room?.seats ?? [];
  const inside = seats.filter((seat) => seat.player).length;
  const free = seats.length - inside;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col gap-5">
        <header className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-indigo">
            nel3ab
          </span>
          <p className="text-[12px] text-muted">
            bonjour {name}.{" "}
            <button
              type="button"
              onClick={onForget}
              className="text-faint underline hover:text-indigo"
            >
              ce n'est pas toi ?
            </button>
          </p>
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
              {inside === 0 ? "personne pour l'instant" : `${inside} à table`}
            </span>
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

        <button
          type="button"
          id="enter"
          onClick={onEnter}
          className="border border-indigo bg-indigo/10 px-3 py-2.5 text-[13px] text-indigo transition-colors hover:bg-indigo/20"
        >
          {free === 0 && seats.length > 0 ? "entrer et regarder" : "entrer"}
        </button>

        <p className="text-[11px] leading-relaxed text-faint">
          {failed
            ? "Le salon ne répond pas: tu peux jouer, mais les places n'afficheront pas de nom."
            : "Entrer prend une manette s'il en reste une, sinon tu regardes. Changer de jeu arrête la partie de tout le monde."}
        </p>
      </div>
    </div>
  );
}
