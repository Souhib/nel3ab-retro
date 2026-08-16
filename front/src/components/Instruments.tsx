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
        <Readout label="trames envoyées" value={input.sent} tone="faint" />
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
    </div>
  );
}
