/**
 * Le sélecteur: un panneau posé par-dessus le menu, où on choisit puis on
 * valide.
 *
 * # Pourquoi il existe
 *
 * Les réglages tournaient en rond: appuyer sur A passait à la valeur suivante.
 * Avec sept ambiances, ça veut dire appuyer sept fois sans jamais voir ce qui
 * existe, et sans pouvoir revenir en arrière sans refaire le tour. Un sélecteur
 * montre la liste, laisse se promener dedans, et attend une validation.
 *
 * # Deux formes, une seule mécanique
 *
 * Une **liste** pour un choix parmi quelques valeurs nommées, et une
 * **glissière** pour une valeur continue. Le comportement des deux vit dans
 * `useShell`, pas ici: ce fichier ne fait que les dessiner. C'est ce qui garantit
 * que les quatre consoles sont d'accord sur ce que « valider » veut dire.
 *
 * # La différence entre les deux, et elle est voulue
 *
 * La glissière s'applique **en bougeant**, parce qu'un volume qu'on règle sans
 * l'entendre ne se règle pas. Annuler remet donc la valeur d'avant. Une liste,
 * elle, ne change rien avant la validation: une ambiance qui clignoterait à
 * chaque cran ferait de la lecture de la liste un effet stroboscopique.
 *
 * # Le costume
 *
 * Chaque console passe ses couleurs. Un panneau unique en gris clasherait avec
 * le vert de la 360 comme avec le blanc de la Wii, et un menu qui porte les
 * couleurs de sa console ne peut pas s'arrêter à mi-chemin.
 */
import { useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import type { Picking } from "./shell";

/** Les quatre couleurs qu'un sélecteur a besoin de connaître. */
export type Costume = {
  /** Le fond du panneau. */
  panel: string;
  /** Le texte. */
  ink: string;
  /** Les traits. */
  edge: string;
  /** Ce qui est choisi. */
  accent: string;
  /** Le voile posé sur le menu derrière. */
  veil?: string;
};

export function Picker({ picking, costume }: { picking: Picking | null; costume: Costume }) {
  if (picking === null) return null;
  const { item } = picking;
  return (
    <div
      id="picker"
      className={cn(
        "n3-pop fixed inset-0 z-[70] flex justify-center p-6",
        // Quand il montre, il descend en bas et ne pose plus de voile: l'image
        // qu'on règle est au milieu, et la cacher pour la régler n'aurait aucun
        // sens.
        picking.previewing ? "items-end" : "items-center",
      )}
      style={{
        background: picking.previewing ? "transparent" : (costume.veil ?? "rgba(0,0,0,.45)"),
      }}
      // Cliquer à côté annule, comme partout ailleurs.
      onClick={picking.cancel}
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-[10px] p-4 shadow-2xl"
        style={{
          background: costume.panel,
          color: costume.ink,
          border: `1px solid ${costume.edge}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-[13px] opacity-70">{item.label}</p>

        {item.picks ? (
          <List picking={picking} costume={costume} />
        ) : item.slide ? (
          <Slider picking={picking} costume={costume} />
        ) : null}

        <div className="flex items-center justify-between pt-1 text-[11px] opacity-55">
          <span>{item.slide ? "← → régler" : "↑ ↓ choisir"}</span>
          <span className="flex gap-3">
            <button type="button" id="pickerCancel" onClick={picking.cancel} className="opacity-80">
              B annuler
            </button>
            <button
              type="button"
              id="pickerConfirm"
              // Enveloppé: un gestionnaire de clic passe l'événement en premier
              // argument, et `confirm` prendrait la souris pour un curseur.
              onClick={() => picking.confirm()}
              style={{ color: costume.accent }}
            >
              A valider
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** La liste des valeurs possibles. */
function List({ picking, costume }: { picking: Picking; costume: Costume }) {
  const picks = picking.item.picks ?? [];
  const list = useRef<HTMLDivElement>(null);

  // Le curseur reste visible: une liste plus longue que le panneau se défile
  // toute seule, sinon choisir la septième ambiance demande une souris.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-at="true"]')?.scrollIntoView({
      block: "nearest",
    });
  }, [picking.cursor]);

  return (
    <div ref={list} className="flex max-h-[46vh] flex-col gap-0.5 overflow-y-auto">
      {picks.map((choice, index) => {
        const here = index === picking.cursor;
        return (
          <button
            key={choice.id}
            type="button"
            id={`pick-${choice.id}`}
            data-at={here}
            // `mousemove` et non `mouseenter`: le second se déclenche aussi quand
            // le panneau APPARAÎT sous un pointeur immobile, donc ouvrir le
            // sélecteur à la souris envoyait le curseur là où la souris se
            // trouvait par hasard, au lieu de la valeur en cours. Bouger la
            // souris déplace le curseur; poser un panneau dessous, non.
            onMouseMove={() => picking.moveTo(index)}
            // On valide CETTE option, pas celle sous le curseur: déplacer puis
            // valider relirait l'ancien curseur, le déplacement n'étant pas
            // encore appliqué.
            onClick={() => picking.confirm(index)}
            className={cn(
              "flex items-baseline justify-between gap-3 rounded-[5px] px-3 py-1.5 text-left text-[13px] transition-colors",
              here ? "opacity-100" : "opacity-65",
            )}
            style={{
              background: here ? `color-mix(in srgb, ${costume.accent} 18%, transparent)` : "none",
              border: `1px solid ${here ? costume.accent : "transparent"}`,
            }}
          >
            {/* Le libellé ne se tronque pas, l'explication oui: c'est le nom du
                choix qui permet de choisir, et une taille annoncée qui pousse
                « remplir l'écran » à « rem... » retire l'information utile pour
                garder l'accessoire. */}
            <span className="shrink-0">{choice.label}</span>
            <span className="flex min-w-0 items-baseline gap-2 truncate text-[11px]">
              {choice.hint ? <span className="truncate opacity-50">{choice.hint}</span> : null}
              {choice.id === picking.item.picked ? (
                <span style={{ color: costume.accent }}>en cours</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Une valeur continue, qu'on pousse ou qu'on glisse. */
function Slider({ picking, costume }: { picking: Picking; costume: Costume }) {
  const slide = picking.item.slide;
  if (!slide) return null;
  const span = Math.max(1e-9, slide.max - slide.min);
  const part = Math.min(1, Math.max(0, (picking.cursor - slide.min) / span));

  /** Où la souris est tombée sur la piste, ramené à un cran. */
  const fromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const raw = slide.min + ratio * span;
    // Arrondi au cran, sinon un volume tiré à la souris se retient sur une
    // valeur qu'aucun appui de touche ne peut retrouver.
    const stepped = slide.min + Math.round((raw - slide.min) / slide.step) * slide.step;
    picking.moveTo(Math.min(slide.max, Math.max(slide.min, stepped)));
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="font-mono text-[22px]" style={{ color: costume.accent }}>
        {slide.say(picking.cursor)}
      </p>
      {/* La piste. `setPointerCapture` pour que le glissement suive la souris
          même quand elle sort du panneau, ce qui arrive tout le temps au bord. */}
      <div
        id="pickerTrack"
        className="relative h-8 cursor-pointer touch-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
        }}
      >
        <span
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ background: `color-mix(in srgb, ${costume.ink} 22%, transparent)` }}
        />
        <span
          className="pointer-events-none absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full"
          style={{ width: `${part * 100}%`, background: costume.accent }}
        />
        <span
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${part * 100}%`, background: costume.accent }}
        />
      </div>
    </div>
  );
}
