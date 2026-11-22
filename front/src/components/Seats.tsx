/**
 * Les quatre places, et qui est assis dessus.
 *
 * Le dessin est une prise, et c'est voulu: on y branche sa manette. Le MOT est
 * « place » (audit T05, `lib/mots`): « prise », « port » et « manette 2 »
 * désignaient la même chose à trois endroits.
 *
 * Les noms sont rapprochés des attributions lues chez le worker. Une place
 * sans nom connu ne reçoit pas de faux prénom ni de libellé « occupée ».
 * Le dessin conserve l'occupation pour prendre ou demander la bonne place.
 */
import { useEffect, useState } from "react";
import { Branchement, useBranchements } from "../bobine/Branchement";
import { salle } from "../lib/base";
import { cn } from "../lib/cn";
import { Crown } from "./Crown";
import { MicBadge } from "./MicBadge";
import { Socket } from "./Socket";

/** Combien de temps l'armement se souvient de lui-même. */
const ARMED_FOR_MS = 5000;

export function Seats({
  ownerSeat,
  players,
  busy,
  mics,
  names,
  premieres,
  mine,
  displaced,
  onTake,
  onAsk,
}: {
  ownerSeat?: number | null;
  players: number;
  busy: boolean[];
  /** Quelles places ont un micro ouvert, une par place. */
  mics: boolean[];
  names: Map<number, string>;
  /** Ce que le salon dit des prises tenues: première fois dans la salle ou non.
   * Une prise absente veut dire que le salon ne sait pas. */
  premieres?: ReadonlyMap<number, boolean>;
  mine: number | null;
  displaced: boolean;
  onTake: (port: number) => void;
  /** Demander sa manette à quelqu'un qui est là, au lieu de la lui prendre. */
  onAsk: (port: number) => void;
}) {
  const ports = Array.from({ length: players }, (_, slot) => slot + 1);
  const [armed, setArmed] = useState<number | null>(null);
  const [rangee, setRangee] = useState<HTMLDivElement | null>(null);
  // Une prise est « tenue » pour la scène dès qu'elle l'est pour le dessin:
  // la mienne comprise, parce que se voir brancher fait partie de l'accueil.
  const { fiches, scene, branche, fini } = useBranchements(
    {
      tenues: ports.map((port) => port === mine || (busy[port - 1] ?? false)),
      noms: names,
      premieres,
    },
    String(salle()),
  );

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
      <div className="relative">
        {scene ? (
          <Branchement
            key={`${scene.port}:${scene.nom}`}
            scene={scene}
            conteneur={rangee}
            branche={branche}
            fini={fini}
          />
        ) : null}
        <div id="ports" ref={setRangee} className="grid grid-cols-4 gap-1.5">
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
                // Ponctuel: un clic de souris rend le clavier au jeu
                // (`lib/focus-jeu`, `rendreAuJeuApresClic`).
                data-rend-le-jeu=""
                data-state={isMine ? "mine" : held ? "busy" : "free"}
                data-armed={isArmed}
                // L'état dans le nom: il n'était dit que par le dessin de la
                // prise (audit A11Y-11). « tenue » et non « occupée » quand le
                // salon ne nomme personne, comme le dessin. Nommée, elle dit
                // qui la tient et ce que fait un clic: « Bo » seul ne disait
                // ni l'un ni l'autre (relecture du 22 novembre 2026).
                aria-label={`Place ${port}, ${
                  isMine
                    ? "la tienne"
                    : name && held
                      ? `prise par ${name}, demander`
                      : held
                        ? isArmed
                          ? "prise, touche-la encore pour la reprendre"
                          : "prise"
                        : "libre"
                }`}
                // `aria-disabled` et non `disabled`: la tienne reste dans la
                // tabulation, donc lisible. Le clic l'ignore (`click`).
                aria-disabled={isMine ? "true" : undefined}
                onClick={() => click(port)}
                title={
                  isMine
                    ? "c'est la tienne"
                    : names.has(port)
                      ? `demander sa place à ${names.get(port)}`
                      : held
                        ? "personne ne répond sur cette place : touche-la encore pour la reprendre"
                        : "prendre cette place"
                }
                className={cn(
                  "relative cursor-pointer border-0 bg-transparent p-0 leading-none",
                  isMine && "cursor-default",
                )}
              >
                <Socket
                  port={port}
                  state={isMine ? "mine" : isArmed ? "arming" : held ? "busy" : "free"}
                  fiche={fiches.get(port)}
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
                {(held || isMine) && name && port === ownerSeat && fiches.get(port) !== "cachee" ? (
                  <span className="pointer-events-none absolute -top-1 right-0 z-10">
                    <Crown />
                  </span>
                ) : null}
                {/* Le micro, barré quand la voix de cette place n'est pas captée.
                  Hors du flux comme la couronne, pour ne pas couper le nom. */}
                {held || isMine ? (
                  <span className="pointer-events-none absolute -top-1 left-0 z-10">
                    <MicBadge open={mics[port - 1] ?? false} />
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
                  {(held || isMine) && name && fiches.get(port) !== "cachee" ? name : "\u00a0"}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Ce qu'un toucher fait, ÉCRIT: le `title` des places ne s'affiche ni
          au doigt ni au clavier (audit T10). */}
      {displaced ? (
        <p id="displaced" className="text-note text-alert">
          Quelqu&apos;un a repris ta place. Choisis une place libre, ou demande la sienne à un
          joueur.
        </p>
      ) : armed !== null ? (
        <p className="text-note text-alert">
          Personne ne répond sur cette place : touche-la encore pour la reprendre.
        </p>
      ) : (
        <p className="text-note text-faint">
          {mine === null
            ? "Choisis une place libre. Une place prise se demande à son joueur."
            : `Tu es à la place ${mine}. Une place prise se demande à son joueur.`}
        </p>
      )}
    </div>
  );
}
