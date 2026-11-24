/**
 * Le menu de la salle : un seul, à quatre rubriques (chantier menus,
 * 24 novembre 2026).
 *
 * Il remplace les trois formes d'avant, le XMB de la PlayStation 3, les
 * chaînes de la Wii et l'accueil de la Switch. Chacune indexait sa sélection
 * sur sa propre géométrie (une croix, une grille de quatre, une file), et les
 * trois couvraient tout l'écran, image comprise. Celui-ci est une liste :
 * le curseur est le focus, et il ne se pose jamais sur l'image.
 *
 * # Non modal (ADR D30 amendé)
 *
 * Le menu n'est plus un `<dialog>` ouvert par `showModal()`. Au bureau il
 * prend la place des rangs de la colonne ; tenu en main, celle du panneau et
 * de la manette sous l'image, ou une bande à côté d'elle (`placeDuMenu`).
 * L'image reste vivante et visible à côté. Un téléphone couché sans bande
 * lisible (une image 16:9) le pose à la place de l'écran : l'image s'y cache
 * le temps du menu, sans changer de taille, et revient à sa fermeture. Rien
 * ne passe sur une image qu'on voit. Le focus entre dans le menu à
 * l'ouverture ; Échap le ferme ; un focus qui arrive dans la zone de jeu le
 * ferme aussi (un clic sur l'image, ou Tab) ; à la fermeture, le focus va au
 * jeu pendant une partie (`useFocusJeu`) et revient à l'ouvreur sans partie.
 *
 * # Le clavier et la manette
 *
 * ↑ ↓ passent de ligne en ligne, ← → changent de rubrique hors d'un choix
 * (`lib/menu`, `pas`), Entrée et Espace restent l'activation native du
 * bouton qui a le focus. La manette conduit le même focus par `onPad` : A
 * active ce qui a le focus, B revient, Start rend la main au jeu.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MenuAction } from "../../media/menupad";
import { piedDuMenu, type Appareil } from "../../lib/appareil";
import { cn } from "../../lib/cn";
import {
  enGroupes,
  formeDe,
  ICONE_DE_RUBRIQUE,
  pas,
  RUBRIQUES,
  voisin,
  type Geste,
  type IdRubrique,
  type Ligne,
  type PlaceDuMenu,
  type Rubrique,
  type Sous,
} from "../../lib/menu";
import { COLONNE, MENU, SORTIES_MENU } from "../../lib/mots";
import { IconeRang } from "../Colonne";
import { activerCurseur, sonMenu, zonesDeJeu } from "../../retro";
import { Reperes } from "../Reperes";
import { Fiche } from "./Fiche";
import "./menu.css";

const FLECHES: Record<string, Geste> = {
  ArrowUp: "haut",
  ArrowDown: "bas",
  ArrowLeft: "gauche",
  ArrowRight: "droite",
};

const DE_LA_MANETTE: Partial<Record<MenuAction, Geste>> = {
  up: "haut",
  down: "bas",
  left: "gauche",
  right: "droite",
};

/** Ce qui a le focus, dans les mots de `lib/menu`. */
function sousLeFocus(cible: EventTarget | null): Sous {
  if (!(cible instanceof HTMLElement)) return "ailleurs";
  if (cible.getAttribute("role") === "tab") return "onglet";
  if (cible instanceof HTMLInputElement && cible.type === "radio")
    return cible.closest("[data-ligne]") ? "choix" : "ailleurs";
  if (cible instanceof HTMLInputElement && cible.type === "range") return "glissiere";
  return cible.closest("[data-ligne]") ? "ligne" : "ailleurs";
}

/** L'élément qui reçoit le focus pour une ligne : le bouton, la pastille
 * cochée (ou la première), le curseur. */
function cibleDe(ligne: HTMLElement | null): HTMLElement | null {
  if (!ligne) return null;
  if (ligne.matches("button")) return ligne;
  // Une ligne « composant » (Signaler, K25) : son premier bouton.
  return (
    ligne.querySelector<HTMLElement>("input[type=radio]:checked") ??
    ligne.querySelector<HTMLElement>("input") ??
    ligne.querySelector<HTMLElement>("button")
  );
}

/** La marque que le menu pose sur la zone de jeu quand il prend la place de
 * l'écran (`menu.css` la cache). La sienne, et non `IMAGE_CACHEE` des
 * transitions : la neige d'une connexion coupée pose et retire aussi
 * celle-là, et la fin de l'une aurait rendu l'image que l'autre cache
 * encore. */
export const IMAGE_SOUS_MENU = "data-image-sous-menu";

/** La place du menu au bureau : la colonne, à la place de ses rangs. */
const DANS_LA_COLONNE: PlaceDuMenu = { lieu: "colonne" };

export function Menu({
  rubriques,
  initiale = "jeux",
  partie,
  joue,
  appareil,
  onClose,
  onPad,
  avis,
  place = DANS_LA_COLONNE,
}: {
  rubriques: readonly Rubrique[];
  /** La rubrique ouverte d'abord. */
  initiale?: IdRubrique;
  /** Un jeu tourne : la sortie dit « Reprendre la partie ». */
  partie: boolean;
  /** Cette page tient une place : ses touches pilotent le menu (M3a). */
  joue: boolean;
  appareil: Appareil;
  onClose: () => void;
  /** Donne au menu de quoi recevoir la manette, et la lui reprend. */
  onPad?: (handler: ((action: MenuAction) => void) | null) => void;
  /** Un refus ou un avis né d'un geste du menu, écrit dans le bloc. */
  avis?: ReactNode;
  place?: PlaceDuMenu;
}) {
  const boite = useRef<HTMLElement | null>(null);
  const panneau = useRef<HTMLDivElement | null>(null);
  const [rubrique, setRubrique] = useState(() =>
    Math.max(
      0,
      rubriques.findIndex((r) => r.id === initiale),
    ),
  );
  const [courante, setCourante] = useState(0);
  const [ficheDe, setFicheDe] = useState<string | null>(null);
  const [coche, setCoche] = useState<string | null>(null);
  /** Le pied ne se montre qu'après un premier usage du clavier ou de la
   * manette (M6) ; une manette branchée compte comme un usage. */
  const [pied, setPied] = useState<"clavier" | "manette" | null>(
    appareil === "manette" ? "manette" : null,
  );
  const lignes = rubriques[rubrique]?.lignes ?? [];
  const fiche = ficheDe === null ? null : (lignes.find((l) => l.id === ficheDe) ?? null);

  const sortie = partie ? SORTIES_MENU.reprendre : SORTIES_MENU.fermer;
  const cache = place.lieu !== "colonne" && place.cacheImage;
  const phrase = partie
    ? joue
      ? MENU.tesTouches
      : cache
        ? MENU.regardeCachee
        : MENU.regarde
    : null;

  /* Sur l'écran, l'image se cache le temps du menu (`placeDuMenu`) : cachée,
     pas modifiée, elle garde sa taille et continue de peindre dessous. Posé
     avant la peinture, pour qu'aucune image ne paraisse sous le menu, et
     rendue au démontage. */
  useLayoutEffect(() => {
    if (!cache) return;
    const zones = zonesDeJeu(document);
    for (const zone of zones) zone.setAttribute(IMAGE_SOUS_MENU, "");
    return () => {
      for (const zone of zones) zone.removeAttribute(IMAGE_SOUS_MENU);
    };
  }, [cache]);

  /** Focus sur la ligne `i` de la rubrique affichée. */
  const allerA = (i: number) => {
    setCourante(i);
    const id = lignes[i]?.id;
    if (id === undefined) return;
    cibleDe(
      panneau.current?.querySelector<HTMLElement>(`#item-${CSS.escape(id)}`) ?? null,
    )?.focus();
  };

  /** Change de rubrique ; `ligne` : poser le focus sur sa première ligne. */
  const changer = (sens: 1 | -1, versLigne: boolean) => {
    const suivante = voisin(rubrique, rubriques.length, sens);
    if (suivante === rubrique) return;
    setRubrique(suivante);
    setCourante(0);
    setFicheDe(null);
    aPoser.current = versLigne ? "ligne" : "onglet";
  };
  /** Ce que le focus doit rejoindre après le rendu d'une rubrique ou d'une
   * fiche : le DOM de la nouvelle n'existe pas encore au moment du geste. */
  const aPoser = useRef<"ligne" | "onglet" | "fiche" | "attente" | "retour" | null>("ligne");

  /** Le focus dans la fiche ouverte : le choix coché, le bouton qui agit, ou
   * « Revenir », pourvu qu'il le prenne. Un élément grisé ne prend pas le
   * focus : sans cette garde, une fiche en refus (B8), qui lit ses
   * sauvegardes ou ferme le jeu le laissait tomber sur <body>, où Échap ne
   * faisait plus rien (relecture du 24 novembre 2026, comme `Rayonnage`).
   * Pendant une lecture, il attend sur le titre et passe au choix coché
   * quand elle répond. */
  const poserDansLaFiche = () => {
    const ici = boite.current;
    const titre = ici?.querySelector<HTMLElement>("#ficheTitre") ?? null;
    const cible =
      ici?.querySelector<HTMLElement>("#fiche input[type=radio]:checked:enabled") ??
      ici?.querySelector<HTMLElement>("#ficheAgir:enabled") ??
      null;
    if (cible === null && fiche?.fiche?.occupe === true && titre !== null) {
      titre.focus({ preventScroll: true });
      aPoser.current = "attente";
      return;
    }
    (cible ?? ici?.querySelector<HTMLElement>("#ficheRevenir"))?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    const ou = aPoser.current;
    aPoser.current = null;
    if (ou === null) {
      // Le geste a grisé ce qui avait le focus (« Fermer le jeu » qui passe à
      // « Fermeture du jeu en cours… ») : le navigateur l'envoie sur <body>.
      const ici = document.activeElement;
      const perdu = ici === null || ici === document.body;
      const dansFiche = ici instanceof HTMLElement && ici.closest("#fiche") !== null;
      if (fiche?.fiche && (perdu || (dansFiche && ici.matches(":disabled")))) poserDansLaFiche();
      return;
    }
    if (ou === "onglet") {
      boite.current?.querySelector<HTMLElement>(`#ray-${rubriques[rubrique]?.id ?? ""}`)?.focus();
      return;
    }
    if (ou === "fiche" || ou === "attente") {
      // En attente, quelqu'un a pu déplacer le focus : on ne le reprend pas.
      if (ou === "attente" && document.activeElement?.id !== "ficheTitre") return;
      poserDansLaFiche();
      return;
    }
    const id = lignes[courante]?.id;
    const ligne = id
      ? (panneau.current?.querySelector<HTMLElement>(`#item-${CSS.escape(id)}`) ?? null)
      : null;
    const cible = cibleDe(ligne);
    if (cible) cible.focus();
    else
      boite.current?.querySelector<HTMLElement>(`#ray-${rubriques[rubrique]?.id ?? ""}`)?.focus();
  });

  /* La ligne de la fiche a quitté sa rubrique (le jeu fermé emporte
     « Fermer le jeu ») : la fiche s'est démontée sous le focus, qui revient
     à la liste. */
  const ficheDisparue = ficheDe !== null && fiche === null;
  useLayoutEffect(() => {
    if (!ficheDisparue) return;
    const ici = document.activeElement;
    setFicheDe(null);
    if (ici === null || ici === document.body) aPoser.current = "retour";
  }, [ficheDisparue]);

  /** Ouvre la fiche d'une ligne, sa première sauvegarde cochée. */
  const ouvrirFiche = (ligne: Ligne) => {
    if (!ligne.fiche) return;
    setFicheDe(ligne.id);
    setCoche(ligne.fiche.coche ?? ligne.fiche.choix?.[0]?.id ?? null);
    aPoser.current = "fiche";
  };
  const fermerFiche = () => {
    setFicheDe(null);
    aPoser.current = "retour";
  };

  /** Une flèche, du clavier ou de la manette. Rend vrai si le menu l'a prise. */
  const fleche = (geste: Geste, cible: EventTarget | null): boolean => {
    if (fiche) return false;
    const sous = sousLeFocus(cible);
    const p = pas(geste, sous);
    if (p === null) return false;
    if (p.vers === "rubrique") changer(p.sens, sous !== "onglet");
    else allerA(sous === "onglet" ? 0 : voisin(courante, lignes.length, p.sens));
    return true;
  };

  const revenir = () => {
    if (fiche) fermerFiche();
    else onClose();
  };

  /* La manette conduit le même focus. Reposé à chaque rendu : il ferme sur
     l'état courant, et c'est une affectation, pas un abonnement. */
  useEffect(() => {
    onPad?.((action) => {
      setPied("manette");
      const ici = document.activeElement;
      const dedans = ici instanceof HTMLElement && boite.current?.contains(ici);
      if (action === "jeu") return onClose();
      if (action === "back") return revenir();
      if (!dedans) {
        // Le focus est parti ailleurs dans la page : la manette le ramène.
        allerA(Math.min(courante, Math.max(0, lignes.length - 1)));
        return;
      }
      if (action === "confirm") return ici.click();
      const geste = DE_LA_MANETTE[action];
      if (geste === undefined || fleche(geste, ici)) return;
      // ← → sur une pastille ou un curseur : la manette fait ce que les
      // flèches du clavier font nativement.
      if (geste !== "gauche" && geste !== "droite") return;
      const sens = geste === "droite" ? 1 : -1;
      if (ici instanceof HTMLInputElement && ici.type === "range") {
        const pasDeValeur = Number(ici.step) || 1;
        const valeur = Math.min(
          Number(ici.max),
          Math.max(Number(ici.min), Number(ici.value) + sens * pasDeValeur),
        );
        ici.value = String(valeur);
        ici.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      if (ici instanceof HTMLInputElement && ici.type === "radio") {
        const groupe = [
          ...(ici.form ?? document).querySelectorAll<HTMLInputElement>(
            `input[type=radio][name="${CSS.escape(ici.name)}"]`,
          ),
        ];
        const voisine = groupe[voisin(groupe.indexOf(ici), groupe.length, sens)];
        if (voisine && voisine !== ici) {
          voisine.focus();
          voisine.click();
        }
      }
    });
    return () => onPad?.(null);
  });

  /* Un focus qui arrive dans la zone de jeu ferme le menu : un clic sur
     l'image, ou Tab qui y arrive (ADR D30 amendé). */
  useEffect(() => {
    const entre = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-zone-jeu]")) onClose();
    };
    document.addEventListener("focusin", entre);
    return () => document.removeEventListener("focusin", entre);
  }, [onClose]);

  /* À la fermeture, sans partie, le focus revient à ce qui a ouvert le menu.
     Pendant une partie, `useFocusJeu` le rend à la zone de jeu. */
  useEffect(() => {
    const ouvreur = document.activeElement;
    return () => {
      const ici = document.activeElement;
      if (ici !== null && ici !== document.body) return;
      const retour =
        ouvreur instanceof HTMLElement && ouvreur.isConnected
          ? ouvreur
          : document.getElementById("openMenu");
      retour?.focus({ preventScroll: true });
    };
  }, []);

  /* Le ▶ du socle, hors de la colonne : la colonne pose déjà le sien. */
  const horsColonne = place.lieu !== "colonne";
  useEffect(() => {
    const surface = boite.current;
    if (!horsColonne || !surface) return;
    const curseur = activerCurseur(surface);
    const reposer = () => {
      const ici = document.activeElement;
      if (ici && surface.contains(ici)) curseur.placer(ici);
    };
    surface.addEventListener("focusin", reposer);
    return () => {
      surface.removeEventListener("focusin", reposer);
      curseur.arreter();
    };
  }, [horsColonne]);

  /* Le fondu et le défilé déplacent les lignes le temps de leur animation :
     le ▶ posé à l'ouverture restait devant le vide (vu par etats.mjs au
     niveau « tout »). Il se repose quand une animation du menu finit. */
  useEffect(() => {
    const surface = boite.current;
    if (!surface) return;
    const fini = () => {
      const ici = document.activeElement;
      if (ici && surface.contains(ici))
        ici.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    };
    surface.addEventListener("animationend", fini);
    return () => surface.removeEventListener("animationend", fini);
  }, []);

  /* Un menu ouvert au clavier montre son pied tout de suite : le navigateur
     marque le focus posé après une touche comme visible. */
  useEffect(() => {
    try {
      const ici = document.activeElement;
      if (pied === null && ici && boite.current?.contains(ici) && ici.matches(":focus-visible"))
        setPied("clavier");
    } catch {
      // Un navigateur sans :focus-visible : le pied attend la première touche.
    }
  }, [pied]);

  const reperes = pied === null ? [] : piedDuMenu(pied, partie);
  const suite = useSuiteCachee(boite);

  return (
    <section
      id="menu"
      ref={boite}
      aria-label={MENU.nom}
      data-lieu={place.lieu}
      data-image-cachee={place.lieu === "colonne" ? undefined : cache ? "oui" : "non"}
      // La flèche en pixels au niveau « tout », jamais pendant une partie
      // (effet « pointeur », `effets.css`).
      className={cn("n3-menu-unique", horsColonne && "n3-menu-pose", !partie && "rt-pointeur")}
      style={
        horsColonne
          ? {
              left: place.rect.x,
              top: place.rect.y,
              width: place.rect.w,
              height: place.rect.h,
            }
          : undefined
      }
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setPied((avant) => avant ?? "clavier");
          revenir();
          return;
        }
        const geste = FLECHES[event.key];
        if (geste === undefined) return;
        setPied((avant) => avant ?? "clavier");
        if (fleche(geste, event.target)) event.preventDefault();
      }}
      onFocus={(event) => {
        const ligne = (event.target as Element).closest?.("[data-ligne]");
        if (!ligne) return;
        const i = lignes.findIndex((l) => l.id === ligne.getAttribute("data-ligne"));
        if (i >= 0 && i !== courante) setCourante(i);
      }}
    >
      <header className="n3-menu-tete">
        <button
          type="button"
          id="closeMenu"
          onClick={onClose}
          className="rt-boite rt-bouton n3-menu-sortie"
        >
          <i className="rt-ombre" aria-hidden="true" />
          {sortie}
        </button>
        {phrase ? <p className="n3-menu-phrase">{phrase}</p> : null}
      </header>
      {avis ? <div className="n3-menu-avis">{avis}</div> : null}
      <div role="tablist" aria-label={MENU.nom} className="n3-menu-onglets">
        {rubriques.map((r, i) => (
          <button
            key={r.id}
            type="button"
            role="tab"
            id={`ray-${r.id}`}
            aria-selected={i === rubrique}
            // Les pilotes d'avant lisent la rubrique choisie par cette marque.
            data-selected={i === rubrique ? "true" : "false"}
            aria-controls="menuPanneau"
            tabIndex={i === rubrique ? 0 : -1}
            className="n3-menu-onglet rt-halo-boite"
            onClick={() => {
              if (i === rubrique) return;
              setRubrique(i);
              setCourante(0);
              setFicheDe(null);
              aPoser.current = "onglet";
            }}
          >
            <IconeRang nom={ICONE_DE_RUBRIQUE[r.id]} />
            <span data-nom>{r.label}</span>
          </button>
        ))}
      </div>
      <div
        id="menuPanneau"
        ref={panneau}
        role="tabpanel"
        aria-labelledby={`ray-${rubriques[rubrique]?.id ?? RUBRIQUES[0]}`}
        key={`${rubrique}-${ficheDe ?? ""}`}
        className="n3-menu-panneau"
      >
        {fiche?.fiche ? (
          <Fiche
            titre={fiche.label}
            fiche={fiche.fiche}
            coche={coche}
            onCocher={setCoche}
            onRevenir={fermerFiche}
          />
        ) : lignes.length === 0 ? (
          <p className="n3-menu-ligne-aide">{MENU.aucuneLigne}</p>
        ) : (
          <>
            {rubriques[rubrique]?.tete ? (
              <div className="n3-menu-tete-rubrique">{rubriques[rubrique]?.tete}</div>
            ) : null}
            {enGroupes(lignes).map((bloc) => (
              // Un bloc se nomme par sa première ligne : un groupe peut revenir
              // après un autre, et son titre seul ne suffirait pas.
              <div key={bloc.lignes[0]?.id} className="n3-menu-groupe">
                {bloc.group ? <h3 className="n3-menu-titre">{bloc.group}</h3> : null}
                {bloc.lignes.map((ligne) => (
                  <LigneDuMenu
                    key={ligne.id}
                    ligne={ligne}
                    actif={lignes[courante]?.id === ligne.id}
                    onFiche={ouvrirFiche}
                  />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
      {reperes.length > 0 ? (
        <footer aria-label={MENU.pied} className="n3-menu-pied">
          <Reperes liste={reperes} />
        </footer>
      ) : null}
      {/* Un repère, pas une commande : hors de la tabulation et sans prise
          au doigt, comme celui de la colonne. Pas dans une fiche : sa barre
          « Lancer » est déjà collée au même bas. */}
      {suite && fiche === null ? (
        <div id="menuPlusBas" aria-hidden="true" className="n3-plus-bas n3-menu-plus-bas">
          <IconeRang nom="chevron" />
          {COLONNE.plusBas}
        </div>
      ) : null}
    </section>
  );
}

/** Vrai tant que le bas du menu n'est pas en vue : il défile dans sa propre
 * boîte. Lu au défilement, quand sa taille ou son contenu change, une fois
 * par image au plus ; jamais à chaque image du jeu. */
function suiteCachee(boite: HTMLElement): boolean {
  return boite.scrollTop + boite.clientHeight < boite.scrollHeight - 2;
}

function useSuiteCachee(boite: React.RefObject<HTMLElement | null>): boolean {
  const [suite, setSuite] = useState(false);
  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    let image = 0;
    const lire = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => setSuite(suiteCachee(el)));
    };
    lire();
    el.addEventListener("scroll", lire, { passive: true });
    const taille = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(lire);
    taille?.observe(el);
    const ajouts = typeof MutationObserver === "undefined" ? null : new MutationObserver(lire);
    ajouts?.observe(el, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(image);
      el.removeEventListener("scroll", lire);
      taille?.disconnect();
      ajouts?.disconnect();
    };
  }, [boite]);
  return suite;
}

/** Les attributs que toute ligne porte : son identifiant, sa forme, et la
 * marque du curseur que les pilotes lisent. */
function marques(ligne: Ligne, actif: boolean) {
  return {
    id: `item-${ligne.id}`,
    "data-ligne": ligne.id,
    "data-forme": formeDe(ligne),
    "data-selected": actif ? "true" : "false",
    "aria-current": actif ? ("true" as const) : undefined,
  };
}

function Tete({ ligne }: { ligne: Ligne }) {
  return (
    <span className="n3-menu-ligne-tete">
      <span data-libelle id={`libelle-${ligne.id}`} className="n3-menu-ligne-libelle">
        {ligne.label}
      </span>
      {ligne.value ? (
        <span data-valeur id={`valeur-${ligne.id}`} className="n3-menu-ligne-valeur">
          {ligne.value}
        </span>
      ) : null}
    </span>
  );
}

function Aide({ ligne }: { ligne: Ligne }) {
  return ligne.hint ? (
    <span id={`aide-${ligne.id}`} className="n3-menu-ligne-aide">
      {ligne.hint}
    </span>
  ) : null;
}

function LigneDuMenu({
  ligne,
  actif,
  onFiche,
}: {
  ligne: Ligne;
  actif: boolean;
  onFiche: (ligne: Ligne) => void;
}) {
  const forme = formeDe(ligne);
  const aide = ligne.hint ? `aide-${ligne.id}` : undefined;
  const nom = ligne.value ? `libelle-${ligne.id} valeur-${ligne.id}` : `libelle-${ligne.id}`;

  if (forme === "choix") {
    const coche = ligne.picked ?? null;
    const choix = ligne.picks ?? [];
    const premiere = coche === null || !choix.some((c) => c.id === coche);
    return (
      <fieldset {...marques(ligne, actif)} aria-describedby={aide} className="n3-menu-ligne">
        <legend className="n3-menu-ligne-tete">
          <span data-libelle className="n3-menu-ligne-libelle">
            {ligne.label}
          </span>
        </legend>
        <div className="n3-menu-pastilles">
          {choix.map((c, i) => {
            const coché = c.id === coche;
            return (
              <label key={c.id} className="n3-menu-pastille">
                <input
                  type="radio"
                  name={`choix-${ligne.id}`}
                  id={`pick-${ligne.id}-${c.id}`}
                  value={c.id}
                  checked={coché}
                  disabled={ligne.disabled}
                  tabIndex={actif && (coché || (premiere && i === 0)) ? 0 : -1}
                  onChange={() => ligne.onPick?.(c.id)}
                />
                <span className="n3-menu-point" aria-hidden="true" />
                <span>{c.label}</span>
              </label>
            );
          })}
        </div>
        <Aide ligne={ligne} />
      </fieldset>
    );
  }

  if (forme === "glissiere" && ligne.slide) {
    const g = ligne.slide;
    return (
      <div {...marques(ligne, actif)} className="n3-menu-ligne">
        <label htmlFor={`range-${ligne.id}`} className="n3-menu-ligne-tete">
          <span data-libelle className="n3-menu-ligne-libelle">
            {ligne.label}
          </span>
          <span data-valeur className="n3-menu-ligne-valeur">
            {g.say(g.value)}
          </span>
        </label>
        <input
          type="range"
          id={`range-${ligne.id}`}
          min={g.min}
          max={g.max}
          step={g.step}
          value={g.value}
          aria-valuetext={g.say(g.value)}
          aria-describedby={aide}
          disabled={ligne.disabled}
          tabIndex={actif ? 0 : -1}
          onChange={(event) => g.onSet(Number(event.target.value))}
          className="n3-menu-glissiere"
        />
        <Aide ligne={ligne} />
      </div>
    );
  }

  if (forme === "composant") {
    // Un composant d'un autre chantier, tel quel (Signaler, K25) : il porte
    // son propre bouton et ses propres mots.
    return (
      <div {...marques(ligne, actif)} className="n3-menu-ligne n3-menu-ligne-composant">
        {ligne.element}
        <Aide ligne={ligne} />
      </div>
    );
  }

  const activer = () => {
    if (ligne.disabled) {
      sonMenu("erreur");
      return;
    }
    if (forme === "fiche") onFiche(ligne);
    else ligne.onEnter?.();
  };
  return (
    <button
      type="button"
      {...marques(ligne, actif)}
      role={forme === "bascule" ? "switch" : undefined}
      aria-checked={forme === "bascule" ? Boolean(ligne.bascule) : undefined}
      aria-expanded={forme === "depli" ? Boolean(ligne.deplie) : undefined}
      aria-disabled={ligne.disabled ? true : undefined}
      aria-labelledby={nom}
      aria-describedby={aide}
      tabIndex={actif ? 0 : -1}
      onClick={activer}
      className="n3-menu-ligne n3-menu-ligne-bouton"
    >
      <Tete ligne={ligne} />
      <Aide ligne={ligne} />
    </button>
  );
}
