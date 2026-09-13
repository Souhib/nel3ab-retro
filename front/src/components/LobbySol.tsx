/**
 * La salle avant d'y entrer, vue d'en haut.
 *
 * Le troisième dessin de cet écran, à côté du classique et des câbles, qu'il ne
 * remplace ni l'un ni l'autre.
 *
 * # Ce que c'est
 *
 * Un RELEVÉ: un écran contre un mur, une chaise par port dans sa couleur, un
 * pion par personne, une porte pour ceux qui arrivent. Le plan ne montre que ce
 * que le serveur sait vraiment, y compris quand il sait qu'une manette est
 * tenue sans savoir par qui.
 *
 * # Ce que le plan ne prétend PAS
 *
 * Le serveur ne connaît aucune position. L'axe gauche-droite est l'ordre des
 * PORTS, et rien d'autre: c'est la seule position qu'il publie. Les spectateurs
 * le long du mur du fond et les arrivants à la porte sont rangés dans l'ordre
 * d'envoi, qui ne veut rien dire. C'est la faiblesse assumée de ce dessin, et
 * elle est écrite ici plutôt que cachée. En étroit, les chaises restent sur UNE
 * colonne de P1 à P4: un repli en 2x2 mettrait P3 derrière P1 et contredirait
 * la seule position que le plan encode.
 *
 * # Les couleurs, et leurs mesures
 *
 * Calculées le 13 septembre 2026 avec la formule WCAG, sur le sol `#191512`, un
 * noir CHAUD. Ce fond est choisi pour une raison mesurée: il porte les quatre
 * couleurs de port au-dessus de 4,5:1, donc les numéros P1 à P4 peuvent être du
 * TEXTE coloré, ce qui était impossible sur l'ardoise des câbles où le rouge
 * tombe à 3,24:1.
 *
 * Sur le sol: chalk 15,07:1, sourde 5,83:1, trait 3,44:1, P1 4,58:1, P2 4,93:1,
 * P3 9,28:1, P4 6,28:1. Sur la dalle noire: chalk 17,44:1, sourde 6,75:1.
 *
 * Deux fonds ont été essayés et REJETÉS. `#2a231d`, plus clair: le rouge tombe
 * à 3,91:1 et le bleu à 4,20:1, donc les numéros ne pourraient plus porter la
 * couleur de leur port, et le filet tombe à 2,94:1, sous le seuil non textuel.
 * `#0f0d0b`, presque noir: ses chiffres sont MEILLEURS (P1 4,90:1), et il est
 * rejeté sur l'identité, ce qui se dit franchement — à cette obscurité la
 * chaleur disparaît et la page redevient le même noir neutre que l'accueil
 * (`#15171b`), la coque Switch (`#2b2b2b`) et la baie des câbles (`#1b1e23`).
 *
 * `TRAIT` ne porte JAMAIS de texte: 3,44:1 passe le seuil de 3:1 des éléments
 * non textuels, pas celui de 4,5:1 du texte. On atténue en changeant d'encre,
 * jamais en baissant l'alpha: c'est la leçon déjà écrite pour les sept thèmes.
 *
 * # La typographie dit d'où vient chaque mot
 *
 * Chasse fixe et capitales pour ce que la MACHINE sait seule: numéros de port,
 * libellés, comptes, code de console, date de vérification. Sans-serif bas de
 * casse pour ce qu'un HUMAIN a tapé ou nommé: le nom de la salle, les pseudos,
 * le titre du jeu. La direction d'origine voulait une seule main pour toute la
 * page; son juge a nommé ce point comme son défaut réparable, parce qu'une page
 * qui a beaucoup à dire s'appauvrit d'une seule voix. La règle de provenance
 * ajoute une information au lieu d'une décoration.
 *
 * # Ce qui ne change pas
 *
 * `#room`, `#people`, `#lobbySeats`, `data-port` et `data-state` sont un contrat
 * avec les pilotes de navigateur. `data-state` reste `busy`/`free` selon le seul
 * `seat.player`: l'anneau « tenue, sans nom » est une encre de plus, jamais un
 * troisième état d'attribut.
 *
 * `actions` est rendu UNE SEULE FOIS, dans le cartouche, à toutes les largeurs.
 * Deux points de rupture qui dupliquent les commandes mettent deux `#enter`
 * dans le DOM, et `querySelector` en choisit alors un au hasard du balisage.
 */
import type { Person, Room, Seat } from "../client";
import { cn } from "../lib/cn";
import { PLAYER_COLOURS } from "../media/players";

/** Le sol, la dalle, et les trois encres. Mesures dans l'en-tête. */
const SOL = "#191512";
const ECRAN = "#000000";
const CHALK = "#f0e9e0";
const SOURDE = "#9c9086";
/** Non textuel UNIQUEMENT: filets, arc de porte, hachure, crochet. 3,44:1. */
const TRAIT = "#756a5f";

/** Combien de spectateurs on nomme avant de compter le reste.
 *
 * Rien ne borne cette liste côté serveur: une salle très fréquentée pousserait
 * le mur du fond sur plusieurs lignes et ferait descendre le cartouche hors de
 * l'écran. Douze est un choix, pas une mesure, et il est écrit comme tel.
 */
const NOMMES = 12;

/** Ce que le disque a répondu, en clair.
 *
 * « ? » n'est pas « gc »: le type le dit lui-même, et ce dépôt a déjà vu un
 * glyphe seul se lire comme une panne. On écrit donc la phrase entière.
 */
function consoleLue(code: string | undefined): string | null {
  if (!code) return null;
  if (code === "gc") return "GAMECUBE";
  if (code === "wii") return "WII";
  return "CONSOLE NON LUE";
}

/** Une chaise vue d'en haut.
 *
 * Un carré à la couleur du port, dont un seul côté est épais: le dossier, qui
 * dit dans quel sens elle regarde. Dedans, exactement un des trois états, tous
 * lisibles SANS la couleur:
 *
 * - un pion PLEIN quand `seat.player` porte un nom;
 * - un ANNEAU quand personne n'a annoncé de nom mais que `seat.held` est vrai,
 *   c'est-à-dire « le worker voit une manette tenue »;
 * - RIEN quand la place est libre.
 *
 * `held` nul est une quatrième chose: un worker ancien, ou une lecture ratée.
 * On ne dessine pas une ignorance, donc ce cas rend exactement le cas libre.
 *
 * Le carré garde sa couleur dans les trois cas, y compris vide: c'est quand la
 * salle est déserte qu'on veut voir laquelle est la rouge.
 */
function Chaise({ seat, hors }: { seat: Seat; hors: boolean }) {
  const couleur = PLAYER_COLOURS[seat.port - 1] ?? PLAYER_COLOURS[0];
  const nom = seat.player ?? null;
  const tenue = nom === null && seat.held === true;
  return (
    <div
      className="relative flex h-[84px] w-[84px] shrink-0 items-center justify-center"
      style={{
        border: `2px ${hors ? "dashed" : "solid"} ${couleur}`,
        borderBottomWidth: "6px",
        /* La hachure du sol: le jeu chargé ne se sert pas de cette manette. */
        backgroundImage: hors
          ? `repeating-linear-gradient(45deg, ${TRAIT} 0 1px, transparent 1px 6px)`
          : undefined,
      }}
    >
      {nom !== null ? (
        <span
          data-pion="plein"
          className="block h-[28px] w-[28px] rounded-full"
          style={{ backgroundColor: CHALK }}
        />
      ) : tenue ? (
        <span
          data-pion="anneau"
          className="block h-[28px] w-[28px] rounded-full"
          style={{ border: `3px solid ${CHALK}` }}
        />
      ) : null}
    </div>
  );
}

/** Les gens qu'on nomme, bornés, avec le reste compté. */
function noms(gens: Person[]): string {
  const vus = gens.slice(0, NOMMES).map((person) => person.name);
  const reste = gens.length - vus.length;
  return reste > 0 ? `${vus.join(", ")} et ${reste} autres` : vus.join(", ");
}

/** Une cellule du cartouche: son libellé, puis ce qu'elle vaut. */
function Cellule({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 border-t px-4 py-3 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0"
      style={{ borderColor: TRAIT }}
    >
      <span className="font-mono text-mini uppercase tracking-[0.22em]" style={{ color: SOURDE }}>
        {titre}
      </span>
      {children}
    </div>
  );
}

export function LobbySol({
  room,
  free,
  failed = false,
  children,
  actions,
}: {
  room: Room | undefined;
  free: number;
  /** Le salon ne répond pas: le relevé n'est pas confirmé, les murs pointillent. */
  failed?: boolean;
  /** L'identité et le retour au salon, rendus par l'écran commun. */
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  const seats = room?.seats ?? [];
  const people = room?.people ?? [];
  const guide = room?.game?.guide ?? null;
  /* `seat_pending` dit en toutes lettres « cette personne n'est pas un
     spectateur ». Les deux autres dessins rangent pourtant les deux tas
     ensemble; ici la porte et le mur du fond sont deux endroits. */
  const aLaPorte = people.filter((person) => !person.seat && person.seat_pending);
  const spectateurs = people.filter((person) => !person.seat && !person.seat_pending);
  /* Un relevé non confirmé se dessine en tirets: c'est la convention du dessin
     technique, et elle tombe juste ici. */
  const incertain = room === undefined || failed;
  const mur = `2px ${incertain ? "dashed" : "solid"} ${SOURDE}`;
  const tenuesSansNom = seats.filter((seat) => !seat.player && seat.held === true).length;
  const consoleDite = consoleLue(room?.game?.console);

  return (
    <div
      className="flex min-h-full w-full flex-col justify-center px-6 py-6 sm:px-10 lg:py-10"
      style={{ backgroundColor: SOL, color: CHALK }}
    >
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5">
        {children}

        <section id="room" data-look="sol" className="flex flex-col">
          {/* LA PIÈCE. L'écran est collé au mur du haut, la porte troue le mur
              de gauche, les chaises regardent l'écran. */}
          <div className="relative flex flex-col gap-5 p-5 sm:p-7" style={{ border: mur }}>
            {/* LE MUR DU HAUT: la dalle, et contre elle l'annotation du mur droit.
                Mesuré le 13 septembre 2026 à 1440 px: la dalle s'arrêtait à
                657 px sur une pièce de 1120 et laissait 433 px de mur mort, la
                bibliothèque étant reléguée SOUS la pièce. Deux vides pour une
                seule cause. La dalle prend maintenant la place qui reste, et
                l'annotation occupe le mur qu'elle longe, comme sur un plan. */}
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-end">
              <div
                className="flex min-h-[96px] min-w-0 flex-1 flex-col justify-center gap-1 px-4 py-3"
                style={{ backgroundColor: ECRAN, border: `2px solid ${CHALK}` }}
              >
                <span
                  className="font-mono text-mini uppercase tracking-[0.22em]"
                  style={{ color: SOURDE }}
                >
                  au programme
                </span>
                <span
                  className={cn(
                    "text-affiche leading-tight [overflow-wrap:anywhere]",
                    room?.game ? "" : "text-large",
                  )}
                  style={{ color: room?.game ? CHALK : SOURDE }}
                >
                  {room === undefined ? "…" : (room.game?.name ?? "aucun jeu chargé")}
                </span>
                {room?.game ? (
                  <span
                    className="font-mono text-mini uppercase tracking-[0.22em]"
                    style={{ color: SOURDE }}
                  >
                    {[
                      guide?.players != null ? `${guide.players} joueurs` : null,
                      consoleDite,
                      room.game.maker,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </div>

              <p
                className="shrink-0 self-end border-r-0 pr-0 font-mono text-mini uppercase tracking-[0.22em] whitespace-nowrap sm:border-r sm:pr-3 sm:pb-2"
                style={{ color: SOURDE, borderColor: TRAIT }}
              >
                {room === undefined
                  ? ""
                  : room.library.length === 0
                    ? "bibliothèque vide"
                    : `bibliothèque — ${room.library.length} jeux`}
              </p>
            </div>

            {/* La porte. Ceux qui sont arrivés sans que leur place soit encore
                annoncée s'y tiennent. Rendue seulement quand il y a quelqu'un:
                une porte vide dessinerait une information absente. */}
            {aLaPorte.length > 0 ? (
              <p className="flex items-center gap-2 text-note" style={{ color: SOURDE }}>
                <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" role="presentation">
                  <path
                    d="M 1 23 L 1 1 M 1 1 A 22 22 0 0 1 23 23"
                    fill="none"
                    stroke={TRAIT}
                    strokeWidth="2"
                  />
                </svg>
                <span className="min-w-0 truncate">
                  à la porte:{" "}
                  <span className="font-sans" style={{ color: CHALK }}>
                    {noms(aLaPorte)}
                  </span>
                  {" — place pas encore annoncée"}
                </span>
              </p>
            ) : null}

            {/* Les chaises. UNE colonne en étroit, une rangée dès qu'il y a la
                place: l'ordre P1..P4 est la seule position que le serveur
                publie, et un repli en deux rangées le contredirait. */}
            <div
              id="lobbySeats"
              className="flex flex-col gap-6 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-14 sm:gap-y-8"
            >
              {seats.map((seat) => {
                const couleur = PLAYER_COLOURS[seat.port - 1] ?? PLAYER_COLOURS[0];
                const nom = seat.player ?? null;
                const tenue = nom === null && seat.held === true;
                const hors =
                  guide !== null && guide.allowed.length > 0 && !guide.allowed.includes(seat.port);
                return (
                  <div
                    key={seat.port}
                    data-port={seat.port}
                    data-state={nom !== null ? "busy" : "free"}
                    className="flex min-w-0 flex-row items-center gap-4 sm:w-[176px] sm:flex-col sm:items-start sm:gap-2"
                  >
                    <Chaise seat={seat} hors={hors} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span
                        className="font-mono text-mini uppercase tracking-[0.22em]"
                        style={{ color: couleur }}
                      >
                        P{seat.port}
                      </span>
                      <span
                        className="max-w-[176px] truncate text-corps"
                        style={{ color: nom !== null ? CHALK : SOURDE }}
                        title={nom ?? undefined}
                      >
                        {nom ?? (tenue ? "tenue, sans nom" : "libre")}
                      </span>
                      {hors ? (
                        <span className="text-note" style={{ color: SOURDE }}>
                          hors jeu
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Le mur du fond. Toujours rendu, même vide: `#people` est lu par
                les pilotes, et une absence d'élément se lit comme une panne. */}
            <p id="people" className="min-w-0 text-note" style={{ color: SOURDE }}>
              {spectateurs.length === 0 ? (
                "personne ne regarde sans place"
              ) : (
                <>
                  <span className="font-sans" style={{ color: CHALK }}>
                    {noms(spectateurs)}
                  </span>
                  {spectateurs.length > 1 ? " regardent sans place" : " regarde sans place"}
                </>
              )}
            </p>
          </div>
        </section>

        {/* LE CARTOUCHE. Un plan porte toujours le sien: ce que la feuille
            représente, et ce qu'on peut en faire. */}
        <div
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1.6fr]"
          style={{ border: `1px solid ${TRAIT}` }}
        >
          <Cellule titre="salle">
            <span className="truncate text-titre font-sans">{room?.name ?? "…"}</span>
            {/* Ce que le disque a répondu, ici plutôt que dans la dalle: le
                cartouche d'un plan porte la provenance, et ces trois cellules
                tenaient 65, 57 et 83 px de contenu pour 192 px de haut,
                mesurés le 13 septembre 2026. On les remplit de vrai plutôt que
                de rétrécir la boîte autour du vide. */}
            {consoleDite ? (
              <span
                className="font-mono text-mini uppercase tracking-[0.22em]"
                style={{ color: SOURDE }}
              >
                {consoleDite}
              </span>
            ) : null}
            {guide?.checked ? (
              <span
                className="font-mono text-mini uppercase tracking-[0.22em]"
                style={{ color: SOURDE }}
              >
                fiche vérifiée le {guide.checked}
              </span>
            ) : null}
          </Cellule>
          <Cellule titre="places">
            {/* `free` compte des NOMS annoncés, pas des manettes réellement
                libres. Quand une place est tenue sans nom, les deux lignes de
                cette cellule disent deux choses vraies du même siège. */}
            <span className="text-corps">
              {seats.length === 0
                ? ""
                : free > 0
                  ? `${free} libre sur ${seats.length}`
                  : "aucune place libre"}
            </span>
            {tenuesSansNom > 0 ? (
              <span className="text-note" style={{ color: SOURDE }}>
                {tenuesSansNom} tenue{tenuesSansNom > 1 ? "s" : ""}, sans nom
              </span>
            ) : null}
          </Cellule>
          <Cellule titre="présents">
            <span className="font-mono text-corps tabular-nums">{people.length}</span>
            {room?.owner ? (
              <span className="truncate text-note font-sans" style={{ color: SOURDE }}>
                chef · {room.owner.name}
              </span>
            ) : null}
            {people.length > 0 ? (
              <span className="text-note font-sans" style={{ color: SOURDE }}>
                {noms(people)}
              </span>
            ) : null}
          </Cellule>
          <Cellule titre="entrer">
            {actions}
            {room?.ask_lasts ? (
              <span className="text-note" style={{ color: SOURDE }}>
                Une place demandée expire en {room.ask_lasts} s.
              </span>
            ) : null}
          </Cellule>
        </div>
      </div>
    </div>
  );
}
