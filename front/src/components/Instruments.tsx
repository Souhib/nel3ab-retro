import { VISIT } from "../lib/visit";
import { FIGEE_MS } from "../media/liaison";
import { NOM_ETAT } from "../lib/liaison-mots";
import type { Snapshot } from "../media/session";
import { Panel, Readout } from "./Readout";
import { etatDuSon } from "../lib/mots";

/**
 * What the room is doing, in numbers.
 *
 * Every figure here was added because a question could not be answered without
 * it, and several were added because an answer given without one turned out to
 * be wrong. They are folded away by default: a person who is playing wants the
 * picture, and a person who is diagnosing wants all of them at once.
 */
/** Ce qu'une mesure absente affiche: un tiret demi-cadratin, jamais un zéro.
 * Une absence ne s'écrit pas comme une mesure, et le tiret cadratin est refusé
 * partout par les règles du dépôt (`lib/mots.test.ts`). */
const RIEN = "–";

/** Une durée en secondes à un chiffre après la virgule, ou `RIEN` pour
 * « jamais ». */
const duree = (ms: number | null) => (ms === null ? RIEN : (ms / 1000).toFixed(1));

export function Instruments({ shot }: { shot: Snapshot }) {
  const { video, sound, input, liaison } = shot;
  const cadence = video.heldRefreshes;
  const even = cadence.p05 === cadence.p95;

  return (
    <div className="flex flex-col gap-3 text-corps">
      {/* Ce que l'état de liaison lit, et ce qu'il en conclut. Les mêmes
          chiffres que `media/liaison.ts`: un gel se lit ici en secondes
          pendant qu'il dure, et la conclusion est écrite en mots. */}
      <Panel title="liaison">
        <Readout
          label="état"
          value={NOM_ETAT[liaison.etat]}
          tone={liaison.etat === "ok" ? "good" : liaison.etat === "cachee" ? "faint" : "alert"}
        />
        <Readout
          label="socket vidéo"
          value={video.connected ? duree(video.sinceOpenedMs) : duree(video.downForMs)}
          unit={video.connected ? "s ouverte" : "s coupée"}
          tone={video.connected ? "faint" : "alert"}
        />
        <Readout
          label="dernier message"
          value={duree(video.sinceHeardMs)}
          unit="s"
          tone="faint"
          hint="Vide compris: la salle en envoie un toutes les 500 ms quand elle n'a pas d'image. Il dit qu'elle est là, rien de plus."
        />
        <Readout
          label="dernière image reçue"
          value={duree(video.sinceUnitMs)}
          unit={`s · ${video.units} reçues`}
          tone={video.sinceUnitMs !== null && video.sinceUnitMs >= FIGEE_MS ? "alert" : "faint"}
          hint="Avant tout décodage: une image jetée parce que l'onglet est caché compte quand même comme arrivée."
        />
        <Readout
          label="dernière image peinte"
          value={duree(video.sincePaintedMs)}
          unit="s"
          tone="faint"
        />
        <Readout
          label="attente d'image"
          value={duree(video.sinceStartedMs)}
          unit="s depuis le départ du flux"
          tone="faint"
        />
      </Panel>

      <Panel title="image">
        <Readout label="arrivées" value={video.shown} />
        <Readout label="peintes" value={video.painted} />
        <Readout
          label="durée d'affichage"
          value={`${cadence.p50}`}
          unit={`rafraîch. (p05 ${cadence.p05}, p95 ${cadence.p95})`}
          tone={even ? "good" : "normal"}
          hint="Sur un écran 240 Hz, une source à 60 images par seconde doit tenir 4 rafraîchissements, toujours."
        />
        <Readout label="écran" value={video.refreshHz.toFixed(0)} unit="Hz" tone="faint" />
        <Readout
          label="source"
          value={video.sourceHz > 0 ? video.sourceHz.toFixed(0) : RIEN}
          unit="Hz"
          tone="faint"
          hint="Lu sur les instants de capture, donc c'est la cadence du JEU. Un jeu PAL donne 50, et une liaison lente ne la fait pas baisser. Un tiret tant qu'il n'y a pas trente images pour la mesurer."
        />
        {/* Un MOT en plus de la couleur: la couleur seule ne porte pas une
            alerte (WCAG 1.4.1, audit A11Y-03). Le même seuil que l'état de
            liaison, qui le dit aussi sur l'image (`media/liaison.ts`). */}
        <Readout
          label="dernière image"
          value={video.sinceArrivalMs === null ? RIEN : video.sinceArrivalMs.toFixed(0)}
          unit={
            video.sinceArrivalMs !== null && video.sinceArrivalMs >= FIGEE_MS ? "ms · figée" : "ms"
          }
          tone={video.sinceArrivalMs !== null && video.sinceArrivalMs > 500 ? "alert" : "faint"}
          hint="Depuis combien de temps la dernière image est arrivée. Au-delà de deux secondes pendant une partie, l'image est figée."
        />
        <Readout
          label="latence ajoutée"
          value={video.slackMs.toFixed(0)}
          unit="ms de marge"
          hint="Ce que l'horaire d'affichage ajoute. Il grandit quand l'image manque, et se rogne quand elle ne manque pas."
        />
        <Readout
          label="écarts d'arrivée"
          value={`${video.gapMs.p50.toFixed(1)} / ${video.gapMs.p95.toFixed(1)}`}
          unit="ms p50/p95"
          tone={video.gapMs.p95 > 33 ? "alert" : "normal"}
          hint="16,7 ms est régulier. Un p95 bien au-dessus veut dire que les images arrivent par paquets."
        />
        {/* Les tailles écrites en dur (608×448, 1216×896) étaient celles de
            Dolphin, fausses pour une Switch: l'image reçue dit la sienne. */}
        <Readout
          label="image"
          value={video.half ? "légère" : "complète"}
          unit={`${video.picture.width}×${video.picture.height}`}
          tone="faint"
          hint="Le worker encode la même image deux fois et chacun choisit. L'image légère demande environ 2,6 fois moins de débit."
        />
        <Readout
          label="jetées avant leur tour"
          value={video.skipped}
          unit="images"
          tone={video.skipped > 0 ? "alert" : "good"}
          hint="Des images arrivées, décodées, puis jetées parce que la file a débordé avant leur tour. Ce n'est pas le réseau: c'est l'horaire d'affichage qui les fait attendre plus longtemps que la file ne peut tenir."
        />
        <Readout
          label="places dans la file"
          value={video.room}
          unit={`pour ${video.backlog} en attente`}
          tone="faint"
          hint="Calculée d'après la marge: la file doit pouvoir garder ce que l'horaire fait attendre."
        />
        <Readout
          label="retard ajouté"
          value={video.addedMs}
          unit={`ms, ancré sur ${video.fastestLag === null ? RIEN : video.fastestLag.toFixed(0)}`}
          tone={video.addedMs > 100 ? "alert" : "faint"}
          hint="Ce que la page attend avant de peindre, pour absorber une liaison irrégulière. Le nombre d'ancrage est l'écart entre l'horloge de la page et celle de la capture pour l'image arrivée le plus vite: il n'a pas de sens seul, seules ses variations comptent. Zéro de retard sur une bonne liaison. Deux incidents de cette semaine se jouaient dessus."
        />
        <Readout
          label="attente avant peinture"
          value={`${video.waitMs.p50.toFixed(0)} / ${video.waitMs.p95.toFixed(0)}`}
          unit="ms p50/p95"
          tone="faint"
          hint="Combien de temps une image reste décodée dans la file avant son tour. Grand veut dire que l'horaire la fait attendre; nul veut dire qu'elle arrive déjà en retard."
        />
        <Readout
          label="gigue de la liaison"
          value={video.jitterMs.toFixed(0)}
          unit="ms absorbés"
          tone={video.jitterMs > 25 ? "alert" : "normal"}
          hint="De combien la plus lente des images ordinaires est plus lente que la plus rapide. La page l'ajoute à son tampon, donc une bonne liaison n'ajoute rien."
        />
      </Panel>

      <Panel title="reprises">
        <Readout
          label="socket muette"
          value={video.stalls}
          tone={video.stalls > 0 ? "alert" : "faint"}
        />
        <Readout
          label="décodeur relancé"
          value={video.restarts}
          tone={video.restarts > 0 ? "alert" : "faint"}
        />
        <Readout
          label="non décodé"
          value={video.undecoded}
          tone="faint"
          hint="Ce que personne ne peignait, donc ce qu'il ne fallait pas décoder."
        />
        <Readout label="images-clés demandées" value={video.keyFramesAsked} tone="faint" />
        <Readout
          label="socket rouverte"
          value={video.reconnects}
          tone={video.reconnects > 2 ? "alert" : "faint"}
          hint="Combien de fois la socket vidéo est repartie de zéro. Un changement de jeu en vaut une; plusieurs sans changement de jeu décrivent une liaison qui lâche."
        />
        <Readout
          label="famines"
          value={video.starved}
          tone={video.starved > 3 ? "alert" : "faint"}
        />
      </Panel>

      <Panel title="son">
        <Readout
          label="état"
          value={etatDuSon(sound.state)}
          tone={sound.state === "running" ? "good" : "faint"}
        />
        <Readout label="joué" value={sound.playedSeconds.toFixed(1)} unit="s" />
        <Readout label="coupures" value={sound.gaps} tone={sound.gaps > 0 ? "alert" : "faint"} />
        <Readout label="morceaux reçus" value={sound.chunks} tone="faint" />
        <Readout
          label="dernier morceau"
          value={duree(sound.sinceChunkMs)}
          unit="s"
          tone="faint"
          hint="Reçu, joué ou non. Un son qui arrive pendant une image figée dit que le jeu tourne."
        />
        {/* Le « transit le plus rapide » n'est plus montré. C'était
            `performance.now()` moins l'horodatage du relais, deux horloges sans
            origine commune: sur la Switch il affichait moins 788 millions de
            millisecondes (2026-09-09). Ce nombre n'a de sens qu'en DIFFÉRENCE
            avec lui-même, ce que la gigue et le retard ajouté font déjà. Ce qui
            compte pour la personne, l'écart entre son et image, est calculé
            dans un seul repère par `gapAgainst` et affiché sous « retard sur
            l'image » juste en dessous. */}
        <Readout
          label="volume appliqué"
          value={sound.gain.toFixed(2)}
          tone={sound.gain > 0 ? "faint" : "alert"}
          hint="Lu sur le noeud de gain et non sur la glissière: c'est ce que l'oreille reçoit. Zéro explique un silence à lui seul."
        />
        <Readout
          label="déblocage iOS"
          value={sound.unlocked}
          tone={sound.unlocked.startsWith("refusé") ? "alert" : "faint"}
          hint="Le silence en boucle qui déplace le son hors du canal de la sonnerie sur un iPhone. Refusé, le téléphone reste muet même quand tout le reste va bien."
        />
        <Readout
          label="ajout du matériel"
          value={sound.output.toFixed(0)}
          unit="ms"
          tone="faint"
          hint="Ce que la carte ou le téléphone ajoute après qu'on lui a donné les échantillons. Zéro veut dire que le navigateur ne le dit pas, ce qui est le cas de WebKit."
        />
        <Readout
          label="sortie"
          value={(sound.sampleRate / 1000).toFixed(1)}
          unit="kHz"
          tone="faint"
        />
        <Readout
          label="retard sur l'image"
          value={shot.soundGapMs === null ? RIEN : shot.soundGapMs.toFixed(0)}
          unit={
            shot.soundGapMs === null
              ? ""
              : `ms · avance ${sound.leadMs.toFixed(0)} · matériel ${(sound.outputMs - sound.browserMs).toFixed(0)} · navigateur ${sound.browserMs.toFixed(0)}`
          }
          hint="Les trois quarts sont le mélangeur du système et le tampon de la carte son : aucune page n'a prise dessus."
        />
      </Panel>

      <Panel title="manette">
        <Readout
          label="place"
          value={input.port ?? "aucune"}
          tone={input.port ? "good" : "alert"}
        />
        <Readout
          label="aller-retour"
          value={input.roundTripMs === null ? "pas encore mesuré" : input.roundTripMs}
          unit={input.roundTripMs === null ? undefined : "ms"}
          tone={
            input.roundTripMs === null
              ? "faint"
              : input.roundTripMs > 80
                ? "alert"
                : input.roundTripMs > 40
                  ? "normal"
                  : "good"
          }
          hint="Le temps qu'un message met à partir d'ici, atteindre la salle et revenir. Mesuré sur une seule horloge, donc il ne suppose rien. C'est la part de la latence qui vient de TA liaison : grand ici veut dire que ça vient de chez toi, petit avec une image qui saccade veut dire que ça vient d'ailleurs."
        />
        <Readout
          label="dernier message de la salle"
          value={duree(input.sinceHeardMs)}
          unit="s"
          tone="faint"
          hint="L'écho part chaque seconde. Un écho qui revient pendant une image figée dit que la salle entend encore ta manette."
        />
        <Readout label="trames envoyées" value={input.sent} tone="faint" />
        <Readout
          label="place refusée"
          value={input.refused ? "oui" : "non"}
          tone={input.refused ? "alert" : "faint"}
          hint="La salle a dit non à la dernière demande de manette. Se produit quand les quatre places sont prises, et n'était écrit nulle part."
        />
        <Readout
          label="matériel"
          value={input.padId ? input.padId.slice(0, 22) : "clavier"}
          tone="faint"
          hint={
            input.padLayout === "unknown"
              ? "Disposition inconnue : il lui faut un profil appris."
              : undefined
          }
        />
        {input.pressed.length > 0 ? (
          <Readout label="appuyé" value={input.pressed.join(" ")} tone="good" />
        ) : null}
      </Panel>

      <Panel title="séance">
        <Readout
          label="numéro"
          value={VISIT}
          id="visit"
          tone="faint"
          hint="Le numéro de cette visite. Le salon l'écrit à chaque événement, donc le donner en signalant un problème permet de retrouver la soirée exacte. Il change à chaque rechargement de la page."
        />
      </Panel>
    </div>
  );
}
