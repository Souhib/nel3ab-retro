/**
 * La salle, avant d'y entrer : l'avant-salle.
 *
 * Une salle et non une liste, parce qu'il y a un émulateur sur un GPU sur une
 * machine : en montrer une liste d'un élément serait une page pour un clic. Ce
 * que cet écran apporte n'est pas le choix, c'est de **voir la salle avant d'y
 * entrer** : quel jeu tourne, qui est déjà là, et quelle place est libre.
 *
 * Rien ne démarre tant qu'on n'est pas entré. Une image décodée derrière un
 * écran que personne ne regarde coûte à la machine sur laquelle un autre joue.
 *
 * # Un seul dessin (24 novembre 2026)
 *
 * Trois dessins existaient depuis le 13 septembre 2026 (« classique »,
 * « câbles », « plan »), choisis par un bouton de la page et retenus dans le
 * navigateur. Ils sont remplacés par UN dessin, celui de l'accueil du salon :
 * la borne de la salle (sa console, son jeu, qui le choisit) et son panneau
 * de commande, quatre boutons START 1P à 4P. Une place prise porte l'étiquette
 * tapée de son joueur, à sa couleur ; une place libre se prend d'un clic, et
 * la PREMIÈRE libre est le seul bouton plein, « Prendre la place N ». Une
 * salle pleine donne ce plein à « Regarder la partie ».
 *
 * Prendre une place précise entre avec `?entrer=jouer&place=N`
 * (`lib/entree`) : la salle demande CETTE place, au lieu de la première libre.
 *
 * Les identifiants `#toRooms`, `#rename`, `#newName`, `#enter`, `#watch`,
 * `#room` et `#lobbySeats [data-port][data-state]` sont un contrat avec les
 * pilotes de navigateur.
 */
import { useState, type CSSProperties } from "react";
import type { Room, Seat } from "../client";
import { NAME_MAX } from "../lib/name";
import { consoleLue } from "../lib/consoles";
import { aplatDuJoueur } from "../lib/etiquette";
import { AVANT_SALLE, chefChoisit, pastille, prendreLaPlace } from "../lib/mots";
import { salonAuDessus } from "../lib/entree";
import { Etiquette } from "./Etiquette";
import { Logo } from "./Logo";
import "./lobby.css";

/* `salonAuDessus` vit dans `lib/entree`, avec la sortie qu'il décide. Réexporté
   ici pour les essais et les pilotes qui le lisaient dans ce fichier. */
export { salonAuDessus } from "../lib/entree";

/** Une place se prend quand personne ne la nomme ET que le worker ne la dit
 * pas tenue : une page sans nom qui tient une manette n'est pas une place
 * libre. Un ancien worker ne dit rien de `held` : seul le nom compte alors. */
export const estLibre = (seat: Seat): boolean => !seat.player && seat.held !== true;

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
}: {
  room: Room | undefined;
  name: string;
  login: string | null;
  failed: boolean;
  /** Entrer pour jouer, à cette place quand elle est donnée. */
  onEnter: (place?: number) => void;
  /** Entrer sans prendre de manette. Une porte séparée plutôt qu'un réglage à
   * changer après : quelqu'un qui vient regarder ne doit pas occuper une place
   * le temps de la rendre. */
  onWatch: () => void;
  onForget: () => void;
  onRename: (name: string) => void;
  /** Vrai quand un salon existe au-dessus. Passé explicitement par les essais,
   * lu sur l'adresse autrement. */
  salon?: boolean;
}) {
  const seats = room?.seats ?? [];
  const libres = seats.filter(estLibre).map((seat) => seat.port);
  const conseillee = libres[0] ?? null;
  const pleine = seats.length > 0 && conseillee === null;
  const spectateurs = (room?.people ?? []).filter((p) => !p.seat).map((p) => p.name);
  const chef = room?.owner?.name ?? null;
  const console = consoleLue(room?.game?.console);

  return (
    /* `min-h-full` et `my-auto` plutôt que `h-full` et un centrage : centrée
       dans une boîte plus petite qu'elle, la fiche débordait par le HAUT, où
       l'on ne peut pas défiler (audit M9, 22 novembre 2026). */
    <div className="n3-avant-salle flex min-h-full flex-col items-center p-6 paysage-bas:px-6 paysage-bas:py-3">
      <div className="my-auto flex w-full max-w-md flex-col gap-5 paysage-bas:grid paysage-bas:max-w-3xl paysage-bas:grid-cols-[3fr_2fr] paysage-bas:items-start paysage-bas:gap-x-5 paysage-bas:gap-y-3">
        <header className="flex flex-col gap-2 paysage-bas:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <Logo />
            {salon ? (
              <a id="toRooms" href="/" className="n3-avant-lien">
                {AVANT_SALLE.autres}
              </a>
            ) : null}
          </div>
          <NameTag name={name} login={login} onRename={onRename} onForget={onForget} />
        </header>

        <main className="contents">
          <section id="room" className="n3-borne paysage-bas:row-span-2">
            <h1 className="n3-borne-titre rt-titre">{room?.name ?? "…"}</h1>
            <div className="n3-borne-jeu">
              {console ? <span className="n3-cartouche">{console}</span> : null}
              <span className="n3-borne-titre-jeu" data-texte="">
                {room?.game?.name ?? AVANT_SALLE.aucunJeu}
              </span>
              {chef || spectateurs.length > 0 ? (
                <span id="people" className="n3-borne-gens">
                  {chef ? `${chefChoisit(chef)} ` : ""}
                  {spectateurs.length > 0 ? AVANT_SALLE.regarde(spectateurs) : ""}
                </span>
              ) : null}
            </div>
            <div id="lobbySeats" className="n3-borne-panneau">
              {seats.map((seat) => (
                <PlaceDuPanneau
                  key={seat.port}
                  seat={seat}
                  conseillee={seat.port === conseillee}
                  onPrendre={() => onEnter(seat.port)}
                />
              ))}
            </div>
          </section>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
              {conseillee !== null || seats.length === 0 ? (
                <button
                  type="button"
                  id="enter"
                  onClick={() => onEnter(conseillee ?? undefined)}
                  className="rt-boite rt-bouton rt-bouton-plein n3-avant-bouton"
                >
                  <i className="rt-ombre" aria-hidden="true" />
                  {conseillee !== null ? prendreLaPlace(conseillee) : AVANT_SALLE.prendre}
                </button>
              ) : null}
              <button
                type="button"
                id="watch"
                onClick={onWatch}
                className={
                  pleine
                    ? "rt-boite rt-bouton rt-bouton-plein n3-avant-bouton sm:col-span-2"
                    : "rt-boite rt-bouton n3-avant-bouton"
                }
              >
                <i className="rt-ombre" aria-hidden="true" />
                {pleine ? AVANT_SALLE.regarderLaPartie : AVANT_SALLE.regarderSansPlace}
              </button>
            </div>
            <p className="text-note leading-relaxed text-faint">
              {failed
                ? AVANT_SALLE.injoignable
                : pleine
                  ? AVANT_SALLE.pleine(seats.length)
                  : AVANT_SALLE.libre}
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Une place du panneau : prise, avec l'étiquette de son joueur ; libre, un
 * bouton qui la prend. `data-state` reste lu par les pilotes et `encres.test`. */
function PlaceDuPanneau({
  seat,
  conseillee,
  onPrendre,
}: {
  seat: Seat;
  conseillee: boolean;
  onPrendre: () => void;
}) {
  const couleur = { "--rt-joueur": aplatDuJoueur(seat.port) } as CSSProperties;
  if (!estLibre(seat)) {
    return (
      <div className="n3-panneau-place" data-port={seat.port} data-state="busy" style={couleur}>
        <span className="rt-bouton-start" aria-hidden="true">
          {pastille(seat.port)}
        </span>
        {seat.player ? (
          <Etiquette nom={seat.player} place={seat.port} />
        ) : (
          <span className="n3-panneau-mot">{pastille(seat.port)}</span>
        )}
      </div>
    );
  }
  return (
    <button
      type="button"
      className="n3-panneau-place"
      data-port={seat.port}
      data-state="free"
      data-conseillee={conseillee ? "" : undefined}
      aria-label={prendreLaPlace(seat.port)}
      onClick={onPrendre}
      style={couleur}
    >
      <span className="rt-bouton-start" data-libre="" aria-hidden="true">
        {pastille(seat.port)}
      </span>
      <span className="n3-panneau-mot">{AVANT_SALLE.prendre}</span>
    </button>
  );
}

/**
 * Le nom qu'on porte, et le seul morceau qu'on a le droit de changer.
 *
 * Quand le proxy dit qui on est, l'adresse est affichée et n'est pas
 * modifiable : c'est ce qui rend le pseudo sûr, puisqu'il est rangé sous elle.
 * Sans identité, « Ce n'est pas toi ? » oublie le prénom gardé dans le
 * navigateur et mène à « Qui joue ? ».
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
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          const chosen = typing.trim().slice(0, NAME_MAX);
          if (chosen) onRename(chosen);
          setTyping(null);
        }}
      >
        <input
          id="newName"
          aria-label={AVANT_SALLE.nouveauNom}
          autoFocus
          maxLength={NAME_MAX}
          value={typing}
          onChange={(event) => setTyping(event.target.value)}
          className="n3-champ min-w-0 flex-1"
        />
        <button type="submit" className="rt-boite rt-bouton n3-avant-bouton">
          <i className="rt-ombre" aria-hidden="true" />
          {AVANT_SALLE.garder}
        </button>
        <button type="button" onClick={() => setTyping(null)} className="n3-avant-lien">
          {AVANT_SALLE.annuler}
        </button>
      </form>
    );
  }

  return (
    <p className="n3-avant-nom">
      <span className="text-muted">{AVANT_SALLE.bonjour}</span> <Etiquette nom={name} />{" "}
      <button type="button" id="rename" onClick={() => setTyping(name)} className="n3-avant-lien">
        {AVANT_SALLE.changer}
      </button>
      {login ? (
        <span className="text-faint" title="l'adresse que Tailscale garantit">
          {" · "}
          {login}
        </span>
      ) : (
        <>
          {" · "}
          <button type="button" id="pasToi" onClick={onForget} className="n3-avant-lien">
            {AVANT_SALLE.pasToi}
          </button>
        </>
      )}
    </p>
  );
}
