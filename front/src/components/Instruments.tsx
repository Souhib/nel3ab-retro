import { VISIT } from "../lib/visit";
import type { Snapshot } from "../media/session";
import { Panel, Readout } from "./Readout";

/**
 * What the room is doing, in numbers.
 *
 * Every figure here was added because a question could not be answered without
 * it, and several were added because an answer given without one turned out to
 * be wrong. They are folded away by default: a person who is playing wants the
 * picture, and a person who is diagnosing wants all of them at once.
 */
export function Instruments({ shot }: { shot: Snapshot }) {
  const { video, sound, input } = shot;
  const cadence = video.heldRefreshes;
  const even = cadence.p05 === cadence.p95;

  return (
    <div className="flex flex-col gap-3 text-[12px]">
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
          value={video.sourceHz.toFixed(0)}
          unit="Hz"
          tone="faint"
          hint="Lu sur les instants de capture, donc c'est la cadence du JEU. Un jeu PAL donne 50, et une liaison lente ne la fait pas baisser."
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
        <Readout
          label="format"
          value={video.half ? "réduit" : "plein"}
          unit={video.half ? "608×448" : "1216×896"}
          tone="faint"
          hint="Le worker encode la même image deux fois et chacun choisit. Le format réduit demande environ 2,6 fois moins de débit."
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
          unit={`ms, ancré sur ${video.fastestLag === null ? "—" : video.fastestLag.toFixed(0)}`}
          tone={video.addedMs > 100 ? "alert" : "faint"}
          hint="Ce que la page attend avant de peindre, pour absorber une liaison irrégulière, et le transit le plus rapide sur lequel elle se cale. Zéro sur une bonne liaison. Deux incidents de cette semaine se jouaient dessus."
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
          value={sound.state}
          tone={sound.state === "running" ? "good" : "faint"}
        />
        <Readout label="joué" value={sound.playedSeconds.toFixed(1)} unit="s" />
        <Readout label="coupures" value={sound.gaps} tone={sound.gaps > 0 ? "alert" : "faint"} />
        <Readout label="morceaux reçus" value={sound.chunks} tone="faint" />
        <Readout
          label="transit le plus rapide"
          value={sound.fastestLag === null ? "—" : sound.fastestLag.toFixed(0)}
          unit="ms"
          tone="faint"
          hint="Le meilleur temps qu'un morceau de son ait mis à arriver. Comparé à celui de l'image, il dit lequel des deux flux traîne."
        />
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
          value={shot.soundGapMs === null ? "—" : shot.soundGapMs.toFixed(0)}
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
