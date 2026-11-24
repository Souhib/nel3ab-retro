/**
 * La bibliothèque sur l'écran éteint d'une salle sans jeu (chantier menus,
 * 24 novembre 2026, B1 à B12).
 *
 * Une rangée par console, chaque jeu une cartouche dont l'étiquette est sa
 * jaquette. Une cartouche ouvre la fiche du jeu : la sauvegarde, « Lancer »,
 * ce qui suit. Au bureau elle se pose à côté des rangées, qui se
 * parcourent encore ; au téléphone et en paysage, elle prend leur place. Le menu ne s'ouvre plus d'office
 * au repos : sans ce rayonnage, choisir un jeu dans une salle vide passait
 * par un menu plein écran qui cachait la salle.
 *
 * # Le clavier et la manette
 *
 * Les flèches passent d'une cartouche à l'autre sans rien déplacer (← →
 * dans l'ordre, ↑ ↓ vers la plus proche de la rangée voisine,
 * `cartoucheVoisine`) ; Entrée ouvre la fiche et met le focus sur la
 * sauvegarde cochée ; Échap la ferme et rend le focus à la cartouche, sans
 * ouvrir le menu. La manette fait pareil par `onPad`, tant que le menu ne
 * la tient pas : sans elle, une manette ne pourrait plus choisir un jeu
 * dans une salle vide.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DernierJeu, Game } from "../client";
import type { MenuAction } from "../media/menupad";
import { cartoucheVoisine, moment, rangees, type Place } from "../lib/bibliotheque";
import { ZONE_JEU } from "../lib/focus-jeu";
import type { FicheDeLigne } from "../lib/menu";
import { BIBLIO } from "../lib/mots";
import { Art } from "./Art";
import { Fiche } from "./menu/Fiche";
import "./rayonnage.css";

/** Les cartouches d'un rayonnage, dans l'ordre du DOM. */
function cartouchesDe(boite: HTMLElement | null): HTMLButtonElement[] {
  return [...(boite?.querySelectorAll<HTMLButtonElement>("[data-jeu]") ?? [])];
}

const FLECHES = {
  ArrowUp: "haut",
  ArrowDown: "bas",
  ArrowLeft: "gauche",
  ArrowRight: "droite",
} as const;

const DE_LA_MANETTE: Partial<Record<MenuAction, (typeof FLECHES)[keyof typeof FLECHES]>> = {
  up: "haut",
  down: "bas",
  left: "gauche",
  right: "droite",
};

/** L'horloge de l'appareil, remplacée dans les essais. */
const MAINTENANT = () => new Date();

/** La largeur d'une étiquette : trois pour un, 48 px de haut. */
const ETIQUETTE = 144;

export function Rayonnage({
  library,
  ficheDe,
  dernier = null,
  focusEntree,
  cote = false,
  onOuvrir,
  onPad,
  maintenant = MAINTENANT,
}: {
  library: readonly Game[];
  /** La fiche d'un jeu : celle que le menu ouvre aussi. */
  ficheDe: (game: Game) => FicheDeLigne;
  /** Le dernier jeu que la salle a lancé (D06), ou rien. */
  dernier?: DernierJeu | null;
  /** Prendre le focus à l'arrivée, si rien d'autre ne l'a. */
  focusEntree: boolean;
  /** Au bureau, la fiche s'ouvre à côté des rangées, qui restent visibles et
   * se parcourent ; au téléphone et en paysage, elle prend leur place (B1). */
  cote?: boolean;
  /** Une fiche s'ouvre : la salle relit les sauvegardes et l'identité. */
  onOuvrir?: () => void;
  /** Donne au rayonnage la manette, et la lui reprend. Absent pendant que
   * le menu la tient. */
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  maintenant?: () => Date;
}) {
  const boite = useRef<HTMLElement | null>(null);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [coche, setCoche] = useState<string | null>(null);
  /** Où poser le focus après le rendu : la fiche qui s'ouvre, la fiche qui
   * attend ses sauvegardes, ou la cartouche qu'on quitte. */
  const aPoser = useRef<"fiche" | "attente" | number | null>(null);
  const jeu = ouvert === null ? undefined : library.find((g) => g.index === ouvert);
  const fiche = jeu ? ficheDe(jeu) : null;

  useEffect(() => {
    if (!focusEntree) return;
    // Le focus d'entrée, une fois, et seulement si rien d'autre ne l'a pris.
    // La zone de jeu ne compte pas : sans jeu, elle n'envoie rien.
    const ici = document.activeElement;
    if (ici === null || ici === document.body || ici.closest(`[${ZONE_JEU}]`))
      cartouchesDe(boite.current)[0]?.focus({ preventScroll: true });
  }, [focusEntree]);

  useLayoutEffect(() => {
    const ou = aPoser.current;
    if (ou === null) return;
    aPoser.current = null;
    if (ou === "fiche" || ou === "attente") {
      const ici = boite.current;
      const titre = ici?.querySelector<HTMLElement>("#ficheJeuTitre") ?? null;
      // En attente, quelqu'un a pu déplacer le focus : on ne le reprend pas.
      if (ou === "attente" && document.activeElement !== titre) return;
      const cible =
        ici?.querySelector<HTMLElement>("#ficheJeu input[type=radio]:checked:enabled") ??
        ici?.querySelector<HTMLElement>("#ficheJeuAgir:enabled") ??
        null;
      if (cible === null && fiche?.occupe === true) {
        // La fiche relit les sauvegardes : ses choix sont grisés, et un
        // élément grisé ne prend pas le focus. Il attend sur le titre, puis
        // passe au choix coché quand la lecture répond.
        titre?.focus({ preventScroll: true });
        aPoser.current = "attente";
        return;
      }
      (cible ?? ici?.querySelector<HTMLElement>("#ficheJeuRevenir"))?.focus({
        preventScroll: true,
      });
      return;
    }
    boite.current?.querySelector<HTMLElement>(`[data-jeu="${ou}"]`)?.focus();
  });

  const ouvrir = (game: Game) => {
    const f = ficheDe(game);
    setOuvert(game.index);
    setCoche(f.coche ?? f.choix?.[0]?.id ?? null);
    aPoser.current = "fiche";
    onOuvrir?.();
  };
  const fermer = () => {
    aPoser.current = ouvert;
    setOuvert(null);
  };

  /** La flèche, depuis la cartouche qui a le focus. */
  const bouger = (depuis: HTMLElement, geste: (typeof FLECHES)[keyof typeof FLECHES]) => {
    const toutes = cartouchesDe(boite.current);
    const i = toutes.indexOf(depuis as HTMLButtonElement);
    if (i < 0) return false;
    const places: Place[] = toutes.map((c) => {
      const r = c.getBoundingClientRect();
      return { rangee: Number(c.dataset.rangee), centre: r.left + r.width / 2 };
    });
    toutes[cartoucheVoisine(places, i, geste)]?.focus();
    return true;
  };

  const touche = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && ouvert !== null) {
      // Échap ferme la fiche, et n'ouvre pas le menu de la salle.
      event.preventDefault();
      event.stopPropagation();
      fermer();
      return;
    }
    const geste = FLECHES[event.key as keyof typeof FLECHES];
    if (geste === undefined || (ouvert !== null && !cote)) return;
    if (event.target instanceof HTMLElement && bouger(event.target, geste)) event.preventDefault();
  };

  /* La manette conduit le même focus. Reposé à chaque rendu : il ferme sur
     l'état courant. */
  useEffect(() => {
    if (!onPad) return;
    onPad((action) => {
      const ici = document.activeElement;
      const dedans = ici instanceof HTMLElement && boite.current?.contains(ici);
      if (action === "back") {
        if (ouvert !== null) fermer();
        return;
      }
      if (!dedans) {
        cartouchesDe(boite.current)[0]?.focus();
        return;
      }
      if (action === "confirm") return ici.click();
      const geste = DE_LA_MANETTE[action];
      if (geste !== undefined && (ouvert === null || cote)) bouger(ici, geste);
    });
    return () => onPad(null);
  });

  const leDernier = dernier ? library.find((g) => g.key === dernier.cle) : undefined;
  const quand = dernier && leDernier ? moment(dernier.quand, maintenant()) : null;

  return (
    <section
      id="rayonnage"
      ref={boite}
      aria-label={BIBLIO.nom}
      className="n3-rayonnage"
      data-fiche={ouvert === null ? undefined : cote ? "cote" : "place"}
      onKeyDown={touche}
    >
      <div className="n3-rayonnage-rangees" hidden={ouvert !== null && !cote}>
        {rangees(library).map((rangee, r) => (
          <section key={rangee.code} className="n3-rangee" aria-labelledby={`rangee-${r}`}>
            <h3 id={`rangee-${r}`} className="n3-rangee-titre">
              {rangee.titre}
            </h3>
            {rangee.essai ? <p className="n3-rangee-note">{BIBLIO.essai}</p> : null}
            <ul className="n3-rangee-jeux">
              {rangee.jeux.map((game) => (
                <li key={game.index}>
                  <button
                    type="button"
                    className="n3-cartouche"
                    data-jeu={game.index}
                    data-rangee={r}
                    aria-expanded={ouvert === game.index}
                    onClick={() => ouvrir(game)}
                  >
                    <Art
                      index={game.index}
                      has={game.art === true}
                      width={ETIQUETTE}
                      console={game.console}
                    />
                    <span className="n3-cartouche-titre">{game.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {leDernier && dernier && quand ? (
          <p className="n3-rayonnage-dernier">
            <span>{BIBLIO.dernier(dernier.titre, quand)}</span>{" "}
            <button
              type="button"
              id="ouvrirDernier"
              className="rt-boite rt-bouton"
              onClick={() => ouvrir(leDernier)}
            >
              <i className="rt-ombre" aria-hidden="true" />
              {BIBLIO.ouvrirFiche}
            </button>
          </p>
        ) : null}
      </div>
      {jeu && fiche ? (
        <Fiche
          base="ficheJeu"
          titre={jeu.name}
          fiche={fiche}
          coche={coche}
          onCocher={setCoche}
          onRevenir={fermer}
        />
      ) : null}
    </section>
  );
}
