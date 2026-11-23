/**
 * The picture, and nothing else.
 *
 * The canvas belongs to the media loop; this component exists to place it and to
 * say when it is empty. It never draws, and it never re-renders on a frame.
 *
 * # Poser l'image est un calcul, pas une classe
 *
 * Un canvas a une taille INTRINSÈQUE égale à son nombre de pixels, et le CSS ne
 * sait pas, à lui seul, faire « le plus grand agrandissement entier qui tient »:
 * ça demande de connaître à la fois la place et la taille de l'image. D'où la
 * mesure, et d'où [`place`], qui est pure et testée à part.
 *
 * La place est mesurée par un `ResizeObserver` plutôt qu'à chaque rendu, parce
 * qu'elle change quand la colonne se replie ou qu'on passe en plein écran, et
 * qu'aucun de ces deux gestes ne rend ce composant.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { place, type Fit } from "../lib/fit";
import { anneauApresTouche, ZONE_JEU } from "../lib/focus-jeu";

export function Screen({
  canvasRef,
  zoneRef,
  jouable = false,
  libelle = "Image du jeu",
  aide = null,
  fit,
  picture,
  onSpace,
  onPrescale,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** La zone de jeu, que la page focalise à l'entrée et en fermant le menu. */
  zoneRef?: React.RefObject<HTMLDivElement | null>;
  /** Vrai quand un jeu tourne: la zone entre alors dans la tabulation. Sans
   * jeu, elle reste focalisable au clic mais Tab ne s'y arrête pas. */
  jouable?: boolean;
  /** Ce que la zone dit d'elle au lecteur d'écran. */
  libelle?: string;
  /** Ce que les touches font dans la zone, dit au lecteur d'écran
   * (`aria-describedby`) ; rien ne s'en voit, rien ne se pose sur l'image. */
  aide?: string | null;
  /** Gardé bien que non utilisé ici: la page s'en sert pour poser l'écran de
   * chargement à la place de l'ancienne étiquette. Le retirer de la signature
   * obligerait l'appelant à savoir que cet écran ne s'en soucie plus. */
  connected?: boolean;
  /** Comment poser l'image. Séparé du format transporté: ce qu'on économise sur
   * le réseau n'a pas à décider de la taille qu'on regarde. */
  fit: Fit;
  /** La taille de l'image décodée, telle que la boucle média la publie. */
  picture: { width: number; height: number };
  /** La place disponible, rapportée vers le haut.
   *
   * Parce que le MENU en a besoin: il annonce à côté de chaque choix la taille
   * qu'il donnerait, et cette taille dépend de la place. Sans ça, deux choix qui
   * rendent exactement la même image se présentent comme deux choix différents,
   * et on croit que le réglage ne fait rien. */
  onSpace?: (space: { width: number; height: number }) => void;
  /** De combien la boucle média doit dessiner la toile plus grande que l'image.
   *
   * Calculé ici parce que seule la page connaît la place; appliqué là-bas parce
   * que seule la boucle dessine. Un nombre qui traverse, pas React sur le chemin
   * des images. */
  onPrescale?: (times: number) => void;
}) {
  const room = useRef<HTMLDivElement | null>(null);
  /* Une fonction stable: recréée à chaque rendu, React la rappellerait avec
     `null` puis l'élément à chaque rendu de la page. */
  const poser = useCallback(
    (el: HTMLDivElement | null) => {
      room.current = el;
      if (zoneRef) zoneRef.current = el;
    },
    [zoneRef],
  );
  const [space, setSpace] = useState({ width: 0, height: 0 });
  /* Par une référence: la fonction vient de la page et serait reconstruite à
     chaque rendu, ce qui reposerait l'observateur en boucle. */
  const told = useRef(onSpace);
  told.current = onSpace;

  useEffect(() => {
    const box = room.current;
    if (!box) return;
    const watch = new ResizeObserver(([entry]) => {
      const size = entry?.contentRect;
      if (!size) return;
      const now = { width: size.width, height: size.height };
      setSpace(now);
      told.current?.(now);
    });
    watch.observe(box);
    return () => watch.disconnect();
  }, []);

  /* L'anneau de focus: posé à l'arrivée par Tab, retiré à la première touche
     qui joue ou au départ du focus (`anneauApresTouche`). Un attribut posé
     directement, et non un état: React n'a rien à rendre pour un trait. */
  useEffect(() => {
    const zone = room.current;
    if (!zone) return;
    let parTab = false;
    const touche = (event: KeyboardEvent) => {
      parTab = event.key === "Tab";
    };
    const pointeur = () => {
      parTab = false;
    };
    const arrive = () => {
      if (parTab) zone.setAttribute("data-anneau", "");
    };
    const part = () => zone.removeAttribute("data-anneau");
    const joue = (event: KeyboardEvent) => {
      if (!anneauApresTouche(event.code)) zone.removeAttribute("data-anneau");
    };
    document.addEventListener("keydown", touche, true);
    document.addEventListener("pointerdown", pointeur, true);
    zone.addEventListener("focus", arrive);
    zone.addEventListener("blur", part);
    zone.addEventListener("keydown", joue);
    return () => {
      document.removeEventListener("keydown", touche, true);
      document.removeEventListener("pointerdown", pointeur, true);
      zone.removeEventListener("focus", arrive);
      zone.removeEventListener("blur", part);
      zone.removeEventListener("keydown", joue);
    };
  }, []);

  const at = place(fit, picture, space);

  useEffect(() => {
    onPrescale?.(at.prescale);
  }, [at.prescale, onPrescale]);

  return (
    // `bg-ecran`: le jeton de la régie, noir dans les deux thèmes (essayé par
    // `regie.test.ts` et `Screen.test.tsx`), plutôt qu'un noir écrit ici.
    /* La ZONE DE JEU: le seul endroit où le clavier pilote la manette
       (`lib/focus-jeu`). Toute la boîte de l'image et pas la seule toile, pour
       qu'un clic dans les bandes noires rende aussi le clavier au jeu. Un clic
       focalise un élément qui a un `tabIndex`, même -1, dans les navigateurs
       qui ne focalisent pas un bouton au clic (Safari): la partie revient
       donc au clavier par le même geste partout.

       `role="application"`: un lecteur d'écran y laisse passer les touches au
       lieu de les prendre pour sa navigation. */
    <div
      ref={poser}
      id="zone-jeu"
      {...{ [ZONE_JEU]: "" }}
      // Le ▶ du socle ne se pose jamais ici (plan salle, en-jeu-clavier.5).
      data-sans-curseur=""
      role="application"
      aria-label={libelle}
      aria-describedby={aide ? "aideZoneJeu" : undefined}
      tabIndex={jouable ? 0 : -1}
      className="n3-zone-jeu relative flex min-h-0 flex-1 items-center justify-center bg-ecran"
    >
      {/* `hidden` : sans boîte, donc rien sur l'image ; aria-describedby lit
          quand même un texte caché. */}
      {aide ? (
        <p id="aideZoneJeu" hidden>
          {aide}
        </p>
      ) : null}
      <canvas
        id="screen"
        ref={canvasRef}
        width={1280}
        height={960}
        style={{
          width: `${at.width}px`,
          height: `${at.height}px`,
          // Le lissage: laissé au navigateur pour « remplir », coupé pour les
          // trois autres. Un agrandissement exact veut des pixels francs; un
          // agrandissement bâtard veut être lissé, sinon il scintille.
          imageRendering: at.smooth ? "auto" : "pixelated",
        }}
      />
      {/* Il y avait ici une petite étiquette « en attente de l'image ». Elle
          disait vrai et n'aidait personne: quand la salle n'envoie plus rien, ce
          qu'on veut lire est CE QUI ARRIVE, pas qu'il n'y a rien. L'écran de
          chargement le dit, avec le nom du jeu, et c'est la page qui le pose —
          voir `App`, où la même absence d'image le déclenche. */}
    </div>
  );
}
