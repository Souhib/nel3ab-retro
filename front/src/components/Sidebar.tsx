/**
 * Trois crans de texte, et rien entre les deux.
 *
 * La colonne portait quatre tailles mêlées — 10, 11, 12 et 13 px — sans qu'aucune
 * ne dise ce qu'elle voulait dire. L'état des quatre manettes, qui est ce qu'on
 * regarde le plus souvent de cette page, était le plus petit de tous.
 *
 * Trois crans désormais: 12 px pour les ÉTIQUETTES en capitales, 13 px pour le
 * COURANT, 15 px pour l'IDENTITÉ, c'est-à-dire qui tient quelle manette.
 *
 * Pourquoi pas plus gros: la colonne fait 304 px de large par défaut, 256 au
 * moins (`lib/column`), et défile (`overflow-y-auto`). Tout grossir ne la
 * déborderait pas, ça pousserait les places sous la ligne de flottaison, ce qui
 * est pire que du petit texte. Les
 * étiquettes en capitales, espacées de 0,2em, montent donc d'un seul cran.
 */
/**
 * La colonne, en deux modes.
 *
 * **Salle**: qui regarde, le son, la sortie. Les places vivent juste au-dessus,
 * en un seul bloc (`App`, audit P7): la liste « joueurs » qui suivait répétait
 * les mêmes noms trois cents pixels plus bas, et poussait « signaler un
 * problème » sous la ligne de flottaison.
 *
 * **Mesures**: les mesures techniques. Elles ont expliqué quatre blocages
 * différents et elles restent à un clic, mais les avoir en permanence sous les
 * yeux fait une colonne que personne ne lit. Leurs mots d'atelier n'ont le
 * droit d'exister que là (`MesuresTechniques`, `lib/mots.test.ts`).
 *
 * Les réglages n'y sont plus: ils vivent dans le menu, qui est fait pour ça. Une
 * colonne qui porte à la fois l'état de la salle et sept boutons de réglage ne
 * porte bien ni l'un ni l'autre.
 */
import { Canape } from "../bobine/Canape";
import { ouvrirLeMenu, type Appareil } from "../lib/appareil";
import type { Person } from "../client";
import { cn } from "../lib/cn";
import { SORTIES } from "../lib/mots";
import type { Snapshot } from "../media/session";
import { ConnectionDiagnostic } from "./ConnectionDiagnostic";
import { Crown } from "./Crown";
import { Instruments } from "./Instruments";
import { MesuresTechniques } from "./MesuresTechniques";
import { Volume } from "./Settings";
import type { GardeSignalement } from "../lib/garde-signalement";
import { Signaler } from "./Signaler";

export type Mode = "normal" | "details";

export function Sidebar({
  appareil = "clavier",
  idle,
  mode,
  onMode,
  owner,
  people,
  shot,
  volume,
  onVolume,
  onSound,
  onLeave,
  onComplain,
  garde,
  onTakeHalf,
}: {
  /** Ce que la personne tient: l'aide ne promet Échap qu'au clavier. */
  appareil?: Appareil;
  idle: boolean;
  mode: Mode;
  onMode: (mode: Mode) => void;
  owner?: Person | null;
  people: Person[];
  shot: Snapshot | null;
  volume: number;
  onVolume: (volume: number) => void;
  onSound: () => void;
  /** Quitter la salle: la seule sortie, vers les autres salles (audit P8). */
  onLeave: () => void;
  /** « Ça saccade, maintenant. »
   *
   * Le geste qui manquait le plus. Une plainte arrive le lendemain avec une
   * heure approximative, et il a fallu deux fois demander une capture d'écran à
   * quelqu'un qui jouait. Ce bouton pose un repère à l'instant exact, avec ce
   * que la page voyait à ce moment-là. */
  onComplain: () => Promise<void>;
  /** Le garde de vingt secondes de la page, partagé avec le bandeau de l'image. */
  garde: GardeSignalement;
  /** Basculer en format réduit, depuis le diagnostic replié.
   *
   * La PROPOSITION de format réduit a quitté la colonne le 22 novembre 2026:
   * elle vit sur l'image (`EtatSalle`), le seul endroit visible aussi sur un
   * téléphone, où la colonne est repliée d'office (audit E2). */
  onTakeHalf: () => void;
  /* Le bouton qui referme le tiroir a quitté la colonne pour le haut du
     tiroir (`BarreDuTiroir`), où il ne défile plus avec elle. Un BOUTON et
     pas seulement Échap, depuis le 18 août 2026: sur un téléphone, il n'y a
     pas de touche Échap. */
}) {
  const watching = people.filter((person) => person.seat == null && person.seat_pending === false);
  const pending = people.filter((person) => person.seat == null && person.seat_pending !== false);

  return (
    <>
      <div className="flex gap-1">
        {(["normal", "details"] as Mode[]).map((choice) => (
          <button
            key={choice}
            type="button"
            id={`mode-${choice}`}
            // Ponctuel: un clic de souris rend le clavier au jeu
            // (`lib/focus-jeu`, `rendreAuJeuApresClic`).
            data-rend-le-jeu=""
            onClick={() => onMode(choice)}
            // Le mode choisi n'était dit que par la bordure indigo (A11Y-11).
            aria-pressed={mode === choice}
            // En casse normale et sans interlettrage: en capitales espacées,
            // « MESURES » sortait d'une colonne de téléphone (195 px).
            className={cn(
              "min-w-0 flex-1 border px-2 py-1 text-corps transition-colors",
              mode === choice
                ? "border-indigo text-indigo"
                : "border-rule text-faint hover:border-rule-bright",
            )}
          >
            {/* « essentiel » et plus « salle »: le tiroir entier s'appelle « La
                salle », et un bouton « salle » à l'intérieur nommait un
                quatrième endroit (relecture du 22 novembre 2026). */}
            {choice === "normal" ? "essentiel" : "mesures"}
          </button>
        ))}
      </div>

      {mode === "normal" ? (
        <>
          <section
            aria-label="spectateurs"
            className="flex flex-col gap-2 border-t border-rule pt-2"
          >
            <span className="n3-etiquette">spectateurs · {watching.length}</span>
            {watching.length ? <Canape noms={watching.map((person) => person.name)} /> : null}
            {watching.length ? (
              watching.map((person) => (
                <div
                  key={person.id ?? person.name}
                  className="flex items-center gap-2 text-corps text-muted"
                >
                  <span
                    className="h-6 w-6 shrink-0 rounded-full border border-rule bg-panel text-center leading-6"
                    aria-hidden="true"
                  >
                    {person.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate">{person.name}</span>
                  {owner?.id && owner.id === person.id ? <Crown /> : null}
                </div>
              ))
            ) : (
              <p className="text-corps text-faint">personne pour l'instant</p>
            )}
          </section>

          {pending.length ? (
            <section
              aria-label="attributions en attente"
              className="border-t border-rule pt-2 text-corps text-muted"
            >
              {pending.map((person) => (
                <p key={person.id ?? person.name}>
                  {person.name} {owner?.id && owner.id === person.id ? <Crown /> : null}
                  {" · place à confirmer"}
                </p>
              ))}
              <p>Si tu joues déjà, recharge la page pour retrouver ton nom.</p>
            </section>
          ) : null}

          {/* UNE sortie, nommée sans ambiguïté (audit P8). « quitter » ramenait à
              l'avant-salle de la même salle, « les salles » à la liste, et le
              menu promettait « retour à l'accueil » pour la première. Prendre
              ou rendre sa place vit maintenant avec les places. */}
          <button
            type="button"
            id="leaveRoom"
            onClick={onLeave}
            className="border border-rule px-2 py-1.5 text-left text-corps text-muted transition-colors pointer-coarse:min-h-11 hover:border-indigo hover:text-indigo"
          >
            {SORTIES.quitter}
          </button>

          <section className="flex flex-col gap-1 border-t border-rule pt-2">
            <span className="n3-etiquette">son</span>
            {shot?.sound.state === "running" ? (
              <Volume value={volume} onChange={onVolume} />
            ) : (
              <button
                type="button"
                id="sound"
                onClick={onSound}
                className="border border-indigo/60 px-2 py-1.5 text-corps text-indigo hover:bg-indigo/10"
              >
                activer le son
              </button>
            )}
          </section>

          {/* Le compte des manettes tenues est parti: les places, juste
              au-dessus, le montrent déjà (audit P7). L'aide du menu reste. */}
          <p className="border-t border-rule pt-2 text-corps leading-relaxed text-faint">
            {ouvrirLeMenu(appareil)}
          </p>

          {idle ? null : (
            <p id="saveReminder" className="text-corps leading-relaxed text-faint">
              Pense à sauvegarder dans le jeu: une salle que tout le monde quitte ferme la partie.
            </p>
          )}

          {!idle && shot && !shot.padOnly ? (
            <ConnectionDiagnostic video={shot.video} onReduce={onTakeHalf} />
          ) : null}
          <Signaler onComplain={onComplain} garde={garde} />
        </>
      ) : (
        <div id="stats">
          <MesuresTechniques>
            {shot ? (
              <Instruments shot={shot} />
            ) : (
              <p className="text-corps text-faint">Pas encore de mesures.</p>
            )}
          </MesuresTechniques>
        </div>
      )}
    </>
  );
}
