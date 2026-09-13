/**
 * La salle avant d'y entrer, vue par ses câbles.
 *
 * Le second dessin de cet écran, à côté du classique qu'il ne remplace pas.
 *
 * # Ce qu'il corrige
 *
 * Le classique est une fiche de 448 px au milieu d'une page noire: on y lit
 * l'état de la salle en mots, et le reste de l'écran ne sert à rien. Ici l'état
 * se lit dans la GÉOMÉTRIE avant de se lire dans un mot: un câble tendu part du
 * port vers un nom, un câble libre reste enroulé contre sa prise. On voit d'un
 * coup d'oeil combien de manettes sont prises, sans compter ni lire.
 *
 * # Pourquoi le câble et pas une façade d'appareil
 *
 * Le carnet a déjà tué la façade par expérience: onze directions, six juges, et
 * TROIS agents indépendants proposant spontanément la même « face avant ». Une
 * quatrième exploration le 13 septembre 2026 l'a proposée une quatrième fois et
 * son juge l'a rejetée en citant cette entrée. C'est le réflexe par défaut pour
 * ce genre de projet, donc exactement ce qu'il faut fuir.
 *
 * Le câble est ce qui restait: la seule idée endossée par tous les juges, et
 * retrouvée indépendamment par deux directions sur quatre. Vérifié avant de la
 * prendre: rien ne dessine de câble dans ce dépôt, contrairement à « coque »
 * (cinq emplois dans `Channels.tsx`, `Home.tsx` et le carnet) et à « plaque »
 * (le vocabulaire d'`accueil.html`), qui auraient été des collisions.
 *
 * # Les couleurs, et leurs mesures
 *
 * Calculées ici le 13 septembre 2026, pas reprises d'ailleurs. Deux exigences se
 * disputaient le même fond: des câbles colorés demandent 3:1, du texte demande
 * 4,5:1, et aucune valeur moyenne ne donnait les deux avec du rouge. La sortie
 * est celle que le carnet a déjà écrite pour la jauge du salon: ajouter un
 * élément plutôt que chercher la valeur qui contente tout le monde.
 *
 * Sur l'ardoise `#2f3238`: rouge 3,24:1, bleu 3,49:1, jaune 6,57:1, vert
 * 4,45:1, encre claire 11,15:1, encre sourde 6,28:1. Deux fonds plus clairs ont
 * été essayés et REJETÉS: `#3b3f46` fait tomber le rouge à 2,67 et le bleu à
 * 2,87; `#464b52` les met à 2,22 et 2,39.
 *
 * Dans la baie `#1b1e23`, où vivent les câbles: rouge 4,22:1, bleu 4,54:1,
 * jaune 8,55:1, vert 5,79:1.
 *
 * Les quatre couleurs viennent de `media/players.ts` et ne suivent aucun thème,
 * pour la raison qui y est écrite: tous les jeux ont répondu « lequel es-tu ? »
 * dans ces couleurs-là.
 *
 * # Ce qui ne change pas
 *
 * Les identifiants `#room`, `#people`, `#enter`, `#watch`, `#rename`,
 * `#newName`, `#toRooms` et `#lobbySeats` sont un contrat avec les pilotes de
 * navigateur, pas de la décoration. Les deux dessins les portent à l'identique.
 */
import type { Room } from "../client";
import { cn } from "../lib/cn";
import { PLAYER_COLOURS } from "../media/players";

/** L'ardoise porte le texte, la baie porte les câbles. Mesures dans l'en-tête. */
const ARDOISE = "#2f3238";
const BAIE = "#1b1e23";
const ENCRE = "#eceff4";
const SOURDE = "#aeb6c2";

/** Un câble, du port vers son nom.
 *
 * Tendu quand la place est prise, enroulé contre la prise quand elle est libre.
 * La forme porte l'information AVANT la couleur: quelqu'un qui ne distingue pas
 * le rouge du vert voit quand même qu'un câble part et que l'autre boucle.
 *
 * Deux dessins et non un seul, parce qu'un seul ne pouvait pas s'étirer sans
 * mentir. Le premier jet mettait les deux états dans un `viewBox` de 120 px de
 * large: le câble tendu n'atteignait donc jamais le nom, et la ligne se
 * tassait à gauche d'une baie fluide. Étirer ce `viewBox` aurait déformé la
 * boucle en ovale. La sortie est celle que le carnet écrit déjà pour la jauge
 * du salon: quand deux exigences se disputent une propriété, on ajoute un
 * élément plutôt que de chercher la valeur qui contente les deux.
 *
 * Le câble TENDU est donc une barre qui prend la largeur qu'on lui donne, et la
 * boucle un tracé de largeur fixe qui ne s'étire pas.
 */
function Cable({ colour, taken, port }: { colour: string; taken: boolean; port: number }) {
  /* Le décalage par port. Sans lui les quatre câbles battent ensemble, et une
     rangée qui bat au garde-à-vous se lit comme un chargement en cours plutôt
     que comme quatre fils indépendants. */
  const retard = `${(port - 1) * 320}ms`;
  if (taken) {
    return (
      <span className="flex min-w-0 flex-1 items-center" data-cable="tendu" aria-hidden="true">
        <span className="h-3 w-3 shrink-0 rounded-[2px]" style={{ backgroundColor: colour }} />
        <span
          className="relative h-[4px] min-w-4 flex-1 overflow-hidden rounded-full"
          style={{ backgroundColor: colour }}
        >
          {/* La lueur qui parcourt un câble BRANCHÉ. Un calque de la largeur du
            câble, dont seule la bande centrale est claire: le translater de
            -100 % à +100 % la fait traverser quelle que soit la longueur du
            câble, ce qu'un calque étroit translaté en pourcentage de LUI-MÊME
            ne ferait pas — il ne parcourrait que quelques dizaines de pixels
            sur une barre de 455. */}
          <span
            className="n3-cable-run absolute inset-0"
            style={{
              animationDelay: retard,
              backgroundImage:
                "linear-gradient(90deg, transparent 38%, rgba(255, 255, 255, 0.55) 50%, transparent 62%)",
            }}
          />
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 items-center" data-cable="boucle" aria-hidden="true">
      <span
        className="h-3 w-3 shrink-0 rounded-[2px]"
        style={{ backgroundColor: colour, opacity: 0.75 }}
      />
      {/* La boucle d'un câble LIBRE respire, et ne va nulle part: deux pixels de
        va-et-vient, ce qui suffit à dire « au repos » sans attirer l'oeil sur
        une place que personne ne tient. */}
      <svg
        viewBox="0 0 44 34"
        className="n3-cable-slack block h-[26px] w-[44px] shrink-0"
        style={{ animationDelay: retard }}
        role="presentation"
      >
        <path
          d="M 0 17 C 17 17, 21 5, 11 5 C 1 5, 1 29, 13 29 C 23 29, 21 17, 31 17"
          fill="none"
          stroke={colour}
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    </span>
  );
}

export function LobbyCables({
  room,
  free,
  children,
  actions,
}: {
  room: Room | undefined;
  free: number;
  /** L'identité et le retour au salon, rendus par l'écran commun. */
  children: React.ReactNode;
  actions: React.ReactNode;
}) {
  const seats = room?.seats ?? [];
  const people = room?.people ?? [];
  /** Qui est là SANS tenir de manette. Les autres sont déjà sur leur câble, et
   * les répéter au-dessus était la ligne à moitié vide du dessin classique. */
  const watchers = people.filter((person) => !person.seat);

  return (
    /* Centrée VERTICALEMENT dès qu'il y a de la place, et bornée en largeur.
       Le contenu de cet écran est petit et fixe: un nom, un jeu, quatre places,
       deux boutons. Aligné en haut sur 1440x900, il occupait le tiers supérieur
       et laissait la moitié basse noire — le vide reproché au dessin classique,
       déplacé plutôt que supprimé, ce que la mesure a montré au tour d'avant.
       À 430 la composition dépasse la hauteur disponible et le centrage ne
       s'applique pas: `justify-center` n'agit que sur l'espace restant. */
    <div
      className="flex min-h-full w-full flex-col gap-6 px-6 py-6 sm:px-10 lg:justify-center lg:py-10"
      style={{ backgroundColor: ARDOISE, color: ENCRE }}
    >
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-6">
        {children}

        {/* Les deux colonnes finissent au MÊME trait.
          Avec `items-start` la colonne de gauche mesurait 257 px contre 292 à la
          baie, soit 35 px d'avance, mesurés le 13 septembre 2026 à 1440 px de
          large. C'est ce décrochage qui faisait pencher le bloc à droite. Le
          centrage ne l'aurait pas supprimé, il l'aurait coupé en deux fois 17 px;
          raccourcir la baie aurait défait le poids donné aux lignes.
          `items-stretch` ne touche pas à la baie, et ce n'est pas une intuition:
          en basculant `align-items` sur la page vivante, la baie fait 292 px dans
          les deux cas, la somme de ses lignes 232 px dans les deux cas, et son
          vide intérieur 60 px dans les deux cas. Seule la gauche bouge, de 257 à
          292 px. Ce vide vaut 60 px ici et 44 px à 430 px de large, contre environ
          470 px avant que les lignes ne soient épaissies. Le mou tombe en bas de
          la colonne de gauche, qui n'a pas de fond, et ne se voit pas. */}
        <section
          id="room"
          data-look="cables"
          className="flex flex-col gap-6 lg:flex-row lg:items-stretch"
        >
          <div className="flex min-w-0 flex-col gap-6 lg:w-[34%]">
            <div className="flex flex-col gap-2">
              <h1 className="truncate text-affiche font-medium tracking-tight">
                {room?.name ?? "…"}
              </h1>
              <p
                className="font-mono text-note"
                style={{ color: free > 0 ? "#8fd6a4" : "#ffa08c" }}
              >
                {seats.length === 0
                  ? ""
                  : free > 0
                    ? `${free} manette${free > 1 ? "s" : ""} libre${free > 1 ? "s" : ""}`
                    : "salle pleine"}
              </p>
              <div className="mt-2 flex flex-col gap-0.5">
                <span
                  className="font-mono text-mini uppercase tracking-[0.2em]"
                  style={{ color: SOURDE }}
                >
                  au programme
                </span>
                <span className="text-fort">{room?.game?.name ?? "aucun jeu chargé"}</span>
              </div>
            </div>
            {/* UNE SEULE fois. Deux points de rupture qui rendent tous les
              deux `actions` mettent deux `#enter` et deux `#watch` dans le DOM:
              `querySelector` en choisit alors un au hasard du balisage, et le
              pilote peut cliquer celui qui est caché. */}
            <div>{actions}</div>
          </div>

          {/* La baie. Fond sombre parce que c'est là que vivent les couleurs, et
            qu'aucune valeur moyenne ne portait à la fois un rouge à 3:1 et du
            texte à 4,5:1. */}
          <div
            id="lobbySeats"
            className="flex min-w-0 flex-1 flex-col gap-1 rounded-sm px-5 py-4 lg:px-7 lg:py-6"
            style={{ backgroundColor: BAIE }}
          >
            {seats.map((seat) => {
              const colour = PLAYER_COLOURS[seat.port - 1] ?? PLAYER_COLOURS[0];
              const taken = Boolean(seat.player);
              return (
                <div
                  key={seat.port}
                  data-port={seat.port}
                  data-state={taken ? "busy" : "free"}
                  className="flex items-center gap-3 py-2.5 lg:py-4"
                >
                  {/* Le NUMÉRO est du texte, donc il prend une encre; la COULEUR
                    du port vit sur le câble et son carré, juste à côté.
                    Mesuré le 13 septembre 2026 par `just browser-lobby`: avec
                    `opacity: 0.75`, « P1 » tombait à 2,91:1, « P2 » à 3,14:1 et
                    « P4 » à 3,84:1 sur la baie, sous le seuil de 4,5:1. Et
                    retirer l'alpha n'aurait pas suffi: l'en-tête de ce fichier
                    donne lui-même le rouge à 4,22:1 sur la baie, donc la couleur
                    du port ne peut pas porter du texte de 11 px ici.
                    Deux exigences se disputaient une propriété — la couleur
                    appartient au port, le texte doit se lire — et la sortie est
                    celle que le carnet écrit déjà pour la jauge du salon et pour
                    le câble lui-même: ajouter un élément plutôt que chercher la
                    valeur qui contente les deux. La couleur n'est pas perdue,
                    elle est à trois pixels de là. */}
                  <span
                    className="w-6 shrink-0 font-mono text-mini"
                    style={{ color: taken ? ENCRE : SOURDE }}
                  >
                    P{seat.port}
                  </span>
                  <Cable colour={colour} taken={taken} port={seat.port} />
                  <span
                    className={cn("w-[38%] shrink-0 truncate text-corps lg:w-[28%] lg:text-fort")}
                    style={{ color: taken ? ENCRE : SOURDE, opacity: taken ? 1 : 0.75 }}
                  >
                    {seat.player ?? "libre"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <p id="people" className="mx-auto w-full max-w-[1180px] text-note" style={{ color: SOURDE }}>
        {watchers.length === 0
          ? "personne ne regarde sans manette"
          : `${watchers.map((person) => person.name).join(", ")} ${
              watchers.length > 1 ? "regardent" : "regarde"
            } sans manette`}
      </p>
    </div>
  );
}
