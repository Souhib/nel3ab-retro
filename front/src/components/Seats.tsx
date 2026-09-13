/**
 * Les quatre prises, et qui est assis dedans.
 *
 * Les noms sont rapprochés des attributions lues chez le worker. Une prise
 * sans nom connu ne reçoit pas de faux prénom ni de libellé « occupée ».
 * Le dessin conserve l'occupation pour prendre ou demander la bonne manette.
 */
import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { Crown } from "./Crown";
import { Socket } from "./Socket";

/** Combien de temps l'armement se souvient de lui-même. */
const ARMED_FOR_MS = 5000;

export function Seats({
  ownerSeat,
  players,
  busy,
  names,
  mine,
  displaced,
  onTake,
  onAsk,
}: {
  ownerSeat?: number | null;
  players: number;
  busy: boolean[];
  names: Map<number, string>;
  mine: number | null;
  displaced: boolean;
  onTake: (port: number) => void;
  /** Demander sa manette à quelqu'un qui est là, au lieu de la lui prendre. */
  onAsk: (port: number) => void;
}) {
  const ports = Array.from({ length: players }, (_, slot) => slot + 1);
  const [armed, setArmed] = useState<number | null>(null);

  useEffect(() => {
    if (armed === null) return;
    const timer = window.setTimeout(() => setArmed(null), ARMED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  /* Trois gestes, et ils ne se ressemblent pas.
     Une prise LIBRE ne coûte rien à personne: on s'y branche tout de suite.
     Une prise tenue par QUELQU'UN QUI EST LÀ ne s'arrache plus: on lui demande,
     et il répond. C'est le seul geste de cette page qui se voit sur l'écran d'un
     autre, et il ne doit pas se faire d'un clic.
     Une prise tenue par un FANTÔME — la salle ne connaît personne dessus — se
     reprend en deux clics, parce qu'il n'y a personne à qui demander et qu'il
     faut bien pouvoir s'asseoir. */
  const click = (port: number) => {
    if (port === mine) return;
    if (!busy[port - 1]) return onTake(port);
    const who = names.get(port);
    if (who !== undefined) return onAsk(port);
    if (armed !== port) return setArmed(port);
    setArmed(null);
    onTake(port);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* `id` et `data-state` sont lus par les pilotes de navigateur. Une classe
          ou un attribut `title` disait la même chose jusqu'au jour où un style
          change sous eux, ce qui est arrivé. */}
      <div id="ports" className="grid grid-cols-4 gap-1.5">
        {ports.map((port) => {
          const isMine = port === mine;
          const held = busy[port - 1] ?? false;
          const isArmed = port === armed;
          const name = names.get(port);
          return (
            <button
              key={port}
              type="button"
              id={`port${port}`}
              data-state={isMine ? "mine" : held ? "busy" : "free"}
              data-armed={isArmed}
              aria-label={`Manette ${port}${name ? ` · ${name}` : ""}${isArmed ? " · reprendre ?" : ""}`}
              disabled={isMine}
              onClick={() => click(port)}
              title={
                isMine
                  ? "c'est la tienne"
                  : names.has(port)
                    ? `demander sa manette à ${names.get(port)}`
                    : held
                      ? "personne ne répond sur cette prise: reclique pour la reprendre"
                      : "prendre cette manette"
              }
              className={cn(
                "relative cursor-pointer border-0 bg-transparent p-0 leading-none",
                isMine && "cursor-default",
              )}
            >
              <Socket
                port={port}
                state={isMine ? "mine" : isArmed ? "arming" : held ? "busy" : "free"}
              />
              {/* La couronne HORS du flux, posée sur la prise.
                Dans la cellule elle coûtait sa place au nom: 65 px utiles,
                « Souhib » en occupe 55 en sans-serif et 58 en chasse fixe, et
                la couronne 16. Le nom se coupait donc en « Sou… » dès qu'on
                était chef — mesuré le 13 septembre 2026, et signalé par Souhib
                sur sa propre partie.

                La sortir du cadre qui tronque n'aurait PAS suffi: elle aurait
                continué d'occuper la cellule et le nom aurait été coupé dans un
                cadre plus étroit. Il faut qu'elle quitte le flux.

                Changer de police n'était pas la réponse non plus: entre les
                deux familles l'écart est de 3 px sur ce nom, quand la couronne
                en coûte 16.

                Elle reste DANS le bouton `#portN`, ce que `Seats.test.tsx`
                épingle: c'est la prise qu'elle marque, pas le nom. */}
              {(held || isMine) && name && port === ownerSeat ? (
                <span className="pointer-events-none absolute -top-1 right-0 z-10">
                  <Crown />
                </span>
              ) : null}
              <span
                className={cn(
                  "block truncate text-center text-note",
                  isArmed
                    ? "text-alert"
                    : isMine
                      ? "text-indigo"
                      : held
                        ? "text-text"
                        : "text-faint",
                )}
              >
                {(held || isMine) && name ? name : "\u00a0"}
              </span>
            </button>
          );
        })}
      </div>
      {displaced ? (
        <p id="displaced" className="text-note text-alert">
          quelqu'un a repris ta manette. Choisis une prise libre ou demande une manette.
        </p>
      ) : mine === null ? (
        <p className="text-note text-faint">
          {armed === null
            ? "clique une prise libre, ou demande la sienne à quelqu'un"
            : "personne ne répond dessus: reclique pour la reprendre"}
        </p>
      ) : null}
    </div>
  );
}
