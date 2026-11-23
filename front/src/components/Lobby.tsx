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
import { PLAYER_COLOURS, PLAYER_INKS } from "../media/players";
import { LOBBIES, type LobbyLook } from "../lib/theme";
import { LobbyCables } from "./LobbyCables";
import { LobbyPlan } from "./LobbyPlan";
import { Logo } from "./Logo";
import { ENTREES, pastille, placesLibres, SORTIES } from "../lib/mots";
import { salonAuDessus } from "../lib/entree";

/* `salonAuDessus` vit dans `lib/entree`, avec la sortie qu'il décide. Réexporté
   ici pour les essais et les pilotes qui le lisaient dans ce fichier. */
export { salonAuDessus } from "../lib/entree";

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
  /* Les dessins PEINTS posent leur propre fond, donc l'encre d'accent du
     classique n'y tient pas son contraste. Nommer la propriété plutôt que le
     dessin évite d'ajouter une condition par dessin à chaque fois. */
  /* Les dessins PEINTS posent leur propre fond, donc les encres du thème n'y
     tiennent pas leur contraste: elles sont calibrées contre `--panel`, qui vaut
     `#0e0e11` en sombre, et non contre l'ardoise `#2f3238` ni le sol `#191512`.
     Mesuré le 13 septembre 2026 par `just browser-lobby`, le premier garde qui
     ait jamais regardé cette page: sur l'ardoise, « changer de pseudo » tombait
     à 3:1, « entrer et jouer » à 3,34:1 et la phrase d'explication à 3:1; sur le
     sol, 4,24:1 et 4,47:1. Ces chiffres sont des MESURES dans un rendu, pas des
     calculs sur des couleurs choisies — c'est toute la différence avec l'en-tête
     du dessin câbles, écrit le matin même à partir d'un calcul.

     Une encre FIXE par dessin peint est correcte et ne dépend d'aucun des sept
     thèmes, puisque le fond, lui, est fixe. */
  const PEINTURE = {
    cables: { encre: "#eceff4", sourde: "#aeb6c2" },
    plan: { encre: "#f0e9e0", sourde: "#9c9086" },
  } as const;
  const peinture = look === "cables" || look === "plan" ? PEINTURE[look] : null;
  const peint = peinture !== null;

  const entete = (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        {/* Le logo lit les jetons de la page. Les dessins peints sont sombres
            dans les deux thèmes: il y prend ceux de la nuit. */}
        <Logo className={peint ? "regie-nuit" : undefined} />
        <span className="flex items-baseline gap-3">
          {onLook ? <LookSwitch look={look} onLook={onLook} /> : null}
          {salon ? (
            <a
              id="toRooms"
              href="/"
              className={cn(
                "text-note underline transition-colors",
                peint ? "opacity-70 hover:opacity-100" : "text-faint hover:text-indigo",
              )}
            >
              {SORTIES.autres}
            </a>
          ) : null}
        </span>
      </div>
      <NameTag
        name={name}
        login={login}
        onRename={onRename}
        onForget={onForget}
        encre={peinture?.encre}
        sourde={peinture?.sourde}
      />
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
          className={cn(
            "border px-3 py-2.5 text-corps transition-colors disabled:opacity-40",
            peint ? "" : "border-indigo bg-indigo/10 text-indigo hover:bg-indigo/20",
          )}
          style={peinture ? { borderColor: peinture.sourde, color: peinture.encre } : undefined}
        >
          {free === 0 && seats.length > 0 ? "salle pleine" : ENTREES.rejoindre}
        </button>
        <button
          type="button"
          id="watch"
          onClick={onWatch}
          className={cn(
            "border px-3 py-2.5 text-corps transition-colors",
            peint ? "" : "border-rule text-muted hover:border-indigo hover:text-indigo",
          )}
          style={peinture ? { borderColor: peinture.sourde, color: peinture.sourde } : undefined}
        >
          {ENTREES.regarder}
        </button>
      </div>
      <p
        className={cn("text-note leading-relaxed", peint ? "" : "text-faint")}
        style={peinture ? { color: peinture.sourde } : undefined}
      >
        {/* Ce que fait le bouton, et rien d'autre: l'avertissement sur le
            changement de jeu arrivait ici avant le contexte qui le rend utile,
            et le menu le donne déjà (audit T07). */}
        {failed
          ? "Les noms des joueurs ne s'affichent pas pour l'instant. Tu peux jouer quand même."
          : free === 0 && seats.length > 0
            ? `Les ${seats.length} places sont prises. Entre pour regarder : une place peut se libérer.`
            : "Tu prends la première place libre. Tu pourras en changer dans la salle."}
      </p>
    </div>
  );

  if (look === "plan") {
    return (
      <LobbyPlan room={room} free={free} failed={failed} actions={commandes}>
        {entete}
      </LobbyPlan>
    );
  }

  if (look === "cables") {
    return (
      <LobbyCables room={room} free={free} actions={commandes}>
        {entete}
      </LobbyCables>
    );
  }

  return (
    /* `min-h-full` et `my-auto` plutôt que `h-full` et un centrage: centrée
       dans une boîte plus petite qu'elle, la fiche débordait par le HAUT, où
       l'on ne peut pas défiler. Mesuré le 22 novembre 2026 sur un téléphone
       tenu en travers: « autres salles » commençait à -25 px en 844 sur 390,
       à -33 px en 667 sur 375 (audit M9). */
    <div className="flex min-h-full flex-col items-center p-6 paysage-bas:px-6 paysage-bas:py-3">
      {/* Tenu en travers, la fiche et les commandes côte à côte: en colonne,
          « Rejoindre » finissait à 438 px sur un écran de 390 (vérification
          finale du 22 novembre 2026). */}
      <div className="my-auto flex w-full max-w-md flex-col gap-5 paysage-bas:grid paysage-bas:max-w-3xl paysage-bas:grid-cols-[3fr_2fr] paysage-bas:items-start paysage-bas:gap-x-5 paysage-bas:gap-y-3">
        <div className="paysage-bas:col-span-2">{entete}</div>

        <section
          id="room"
          data-look="classique"
          className="flex flex-col gap-3 border border-rule bg-panel p-4 paysage-bas:row-span-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="truncate text-titre font-medium tracking-tight">{room?.name ?? "…"}</h1>
            <span className={cn("font-mono text-note", free > 0 ? "text-good" : "text-alert")}>
              {seats.length === 0 ? "" : free > 0 ? placesLibres(free) : "salle pleine"}
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
                    key={person.id ?? person.name}
                    title={person.id ? "identité vérifiée" : "sans identité"}
                    className={cn(
                      "border px-2 py-0.5 text-note",
                      person.seat ? "border-indigo/50 text-indigo" : "border-rule text-muted",
                    )}
                  >
                    {person.name}
                    {person.seat ? ` · ${pastille(person.seat)}` : ""}
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
                    {/* L'encre PLEINE, jamais un alpha.
                      `opacity: 0.7` faisait tomber « P1 » à 2,92:1 et « P2 » à
                      3,12:1, mesurés le 13 septembre 2026, sur l'écran que ce
                      dépôt regarde le plus souvent. Aucun garde ne l'avait vu
                      parce qu'aucun garde ne regardait cette page. Le carnet
                      écrivait déjà la règle pour les sept thèmes: on atténue en
                      changeant d'encre, pas en baissant l'alpha.
                      Et l'encre du JOUEUR, pas son aplat: l'aplat du joueur 3
                      tombait à 1,81:1 sur le thème clair (22 novembre 2026). */}
                    <span
                      className="font-machine text-mini"
                      style={{ color: PLAYER_INKS[seat.port - 1] ?? PLAYER_INKS[0] }}
                    >
                      {pastille(seat.port)}
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
  /* Un CYCLE, pas « la première autre ».
     `LOBBIES.find((choice) => choice.id !== look)` marchait tant qu'il n'y avait
     que deux dessins et rendait le troisième inatteignable: depuis `classique`
     elle donnait `cables`, depuis `cables` elle redonnait `classique`, et `sol`
     n'était jamais proposé. Un dessin qu'aucun chemin n'atteint est un dessin
     mort. `findIndex` rend -1 sur une valeur inconnue, donc le modulo retombe
     sur la première entrée. */
  const suivant = LOBBIES[(LOBBIES.findIndex((choice) => choice.id === look) + 1) % LOBBIES.length];
  return (
    <button
      type="button"
      id="lookSwitch"
      onClick={() => onLook(suivant.id)}
      title={suivant.note}
      // « câbles » seul ne disait pas que le bouton change le dessin de
      // l'écran (audit A11Y-10).
      aria-label={`dessin suivant : ${suivant.label}`}
      className="text-note underline opacity-60 transition-opacity hover:opacity-100"
    >
      affichage : {suivant.label}
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
  encre,
  sourde,
}: {
  name: string;
  login: string | null;
  onRename: (name: string) => void;
  onForget: () => void;
  /** Les encres du dessin peint, absentes sur le classique qui suit son thème. */
  encre?: string;
  sourde?: string;
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
          aria-label="nouveau pseudo"
          autoFocus
          maxLength={NAME_MAX}
          value={typing}
          onChange={(event) => setTyping(event.target.value)}
          className="min-w-0 flex-1 border border-rule bg-panel px-2 py-1 text-corps focus:border-indigo"
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
    <p
      className={cn("text-corps", sourde ? "" : "text-muted")}
      style={sourde ? { color: sourde } : undefined}
    >
      bonjour{" "}
      <span className={encre ? "" : "text-text"} style={encre ? { color: encre } : undefined}>
        {name}
      </span>
      .{" "}
      <button
        type="button"
        id="rename"
        onClick={() => setTyping(name)}
        className={cn("underline", sourde ? "" : "text-faint hover:text-indigo")}
        style={sourde ? { color: encre } : undefined}
      >
        changer de pseudo
      </button>
      {login ? (
        <span
          className={cn("ml-1", sourde ? "" : "text-faint")}
          style={sourde ? { color: sourde } : undefined}
          title="l'adresse que Tailscale garantit"
        >
          · {login}
        </span>
      ) : (
        <>
          {" · "}
          <button
            type="button"
            onClick={onForget}
            className={cn("underline", sourde ? "" : "text-faint hover:text-indigo")}
            style={sourde ? { color: encre } : undefined}
          >
            ce n'est pas toi ?
          </button>
        </>
      )}
    </p>
  );
}
