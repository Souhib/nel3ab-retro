/**
 * Ce que tous les menus ont en commun.
 *
 * Trois consoles, trois façons de dessiner, une seule façon de se conduire: un
 * rayon choisi, une entrée choisie dedans, et six ordres possibles. Écrire ça
 * une fois évite que la croix et la grille finissent par ne plus être d'accord
 * sur ce que « bas » veut dire.
 *
 * Ce qui reste propre à chaque forme est la GÉOMÉTRIE: dans une colonne, bas
 * avance d'une entrée; dans une grille, bas avance d'une ligne entière. D'où le
 * `perRow`.
 */
import { typingIn } from "../lib/typing";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MenuAction } from "../media/menupad";
import { STEP, swipeFrom } from "../media/swipe";
import type { XmbCategory, XmbItem } from "./Xmb";

/** Un sélecteur ouvert par-dessus le menu.
 *
 * Il vit dans la mécanique partagée et non dans chaque console, pour la même
 * raison que le reste: trois implémentations d'un même sélecteur finiraient par
 * ne plus être d'accord sur ce que « valider » veut dire.
 */
export type Picking = {
  /** L'entrée dont le sélecteur est ouvert. */
  item: XmbItem;
  /** L'option sous le curseur pour une liste, la valeur en cours pour une
   * glissière. Un seul champ pour les deux: il n'y a jamais qu'une chose en
   * train d'être réglée. */
  cursor: number;
  /** Déplace le curseur, ou la valeur. Pour la souris. */
  moveTo: (cursor: number) => void;
  /** Valide et referme.
   *
   * Prend l'option à valider quand on la connaît déjà, ce qui est le cas d'un
   * CLIC: déplacer le curseur puis valider ne marche pas, parce que le
   * déplacement est un changement d'état asynchrone et que la validation
   * relirait l'ancien. Le défaut était invisible au clavier, où les deux gestes
   * sont séparés par une pression. */
  confirm: (cursor?: number) => void;
  /** Referme, et remet la valeur d'avant. */
  cancel: () => void;
  /** Vrai quand ce réglage s'applique en se promenant, et que le menu doit
   * s'effacer pour qu'on le voie. */
  previewing: boolean;
};

export type Shell = {
  ray: number;
  row: number;
  category: XmbCategory | undefined;
  items: XmbItem[];
  goTo: (ray: number) => void;
  point: (row: number) => void;
  choose: (row: number) => void;
  act: (action: MenuAction) => void;
  /** Le sélecteur ouvert, s'il y en a un. Chaque console le dessine à sa
   * couleur, mais aucune ne décide de son comportement. */
  picking: Picking | null;
};

/** Les touches qui conduisent un menu, et rien d'autre. */
const KEYS: Record<string, MenuAction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "confirm",
  // Espace vaut A quand personne n'a le focus (voir `activeNatif`).
  " ": "confirm",
  Escape: "back",
};

/**
 * Vrai quand le navigateur active lui-même cet élément sur Entrée ou Espace.
 *
 * # L'histoire de cette fonction
 *
 * Le menu prenait Entrée et Espace pour l'entrée sous le curseur, où que soit
 * le focus. Une première correction avait ajouté Espace à la table parce que
 * l'activation native du bouton focalisé lançait un jeu que la croix ne
 * désignait pas. Elle traitait le symptôme: le focus et le curseur étaient
 * deux choses, et Entrée sur « Échap reprend la partie » ouvrait encore le
 * dossier GameCube sous le curseur (audit A11Y-02, 22 novembre 2026).
 *
 * Le curseur EST maintenant le focus (`useMenuDialogue`): l'entrée choisie a
 * le focus, et l'activation native du bouton focalisé est exactement « valider
 * l'entrée choisie ». Sur un autre bouton (le pied, une rubrique, une option du
 * sélecteur), elle active ce bouton-là. Le menu ne garde Entrée et Espace que
 * quand rien d'activable n'a le focus: la glissière, ou le document.
 */
export function activeNatif(cible: EventTarget | null): boolean {
  return cible instanceof HTMLElement && cible.matches("button, a[href], summary, [role=button]");
}

/** Échange les deux axes.
 *
 * Une colonne se parcourt de haut en bas et change de rayon à gauche et à
 * droite; une RANGÉE fait l'inverse. Écrire l'échange ici plutôt que dans la
 * forme concernée garde une seule mécanique, et surtout garde le clavier et la
 * manette d'accord: ils passent tous les deux par là.
 */
const SWAPPED: Record<MenuAction, MenuAction> = {
  up: "left",
  down: "right",
  left: "up",
  right: "down",
  confirm: "confirm",
  back: "back",
  jeu: "jeu",
};

export function useShell(
  categories: XmbCategory[],
  perRow: number,
  onClose: () => void,
  /** Vrai quand un écran est ouvert par-dessus: le menu reste là, mais il
   * n'écoute plus. Sinon réassigner une flèche ferait aussi défiler la liste. */
  paused = false,
  /** Vrai pour une forme en rangée, où haut et bas changent de rayon. */
  swapAxes = false,
): Shell {
  const [ray, setRay] = useState(0);
  /** Le sélecteur ouvert: sur quelle entrée, où en est le curseur, et ce que
   * valait la valeur avant qu'on y touche. Le dernier champ est ce qui permet
   * d'annuler un volume qu'on a déjà entendu bouger. */
  const [picking, setPicking] = useState<{ row: number; cursor: number; was: number } | null>(null);
  /** Une position retenue par rayon: revenir sur « jeux » doit retrouver le jeu
   * qu'on regardait, comme sur une console. */
  const [rows, setRows] = useState<number[]>(() => categories.map(() => 0));

  const at = Math.min(ray, Math.max(0, categories.length - 1));
  const category = categories[at];
  const items = category?.items ?? [];
  const row = Math.min(rows[at] ?? 0, Math.max(0, items.length - 1));

  /* Sans `useCallback`: les entrées sont reconstruites à chaque rendu par la
     page, donc mémoriser ces fonctions ne mémoriserait rien. Elles ne servent
     qu'à des gestionnaires d'événements reposés à chaque rendu de toute façon. */
  const point = (next: number) =>
    setRows((was) => {
      const copy = [...was];
      copy[at] = next;
      return copy;
    });

  const choose = (index: number) => {
    const item = items[index];
    point(index);
    if (!item || item.disabled) return;
    // Une entrée qui porte une VALEUR se règle aussi en la choisissant.
    //
    // Sans ça, régler dépendait de l'axe libre, qui n'est pas le même selon la
    // forme: dans une rangée, gauche et droite parcourent la file, donc pousser
    // à droite sur « menu » changeait de page au lieu de changer le menu. Un
    // réglage doit se régler pareil partout, et « A » est partout.
    // Une liste ou une glissière ouvre son sélecteur. Choisir puis valider,
    // plutôt que de tourner en rond: avec sept ambiances, tourner en rond veut
    // dire appuyer sept fois sans jamais voir ce qui existe.
    if (item.picks) {
      const already = item.picks.findIndex((choice) => choice.id === item.picked);
      const start = Math.max(0, already);
      return setPicking({ row: index, cursor: start, was: start });
    }
    if (item.slide) {
      return setPicking({ row: index, cursor: item.slide.value, was: item.slide.value });
    }
    if (item.onEnter) item.onEnter();
    else item.onAdjust?.(1);
  };

  const closePicking = () => setPicking(null);

  const validate = (which?: number) => {
    const open = picking;
    if (open === null) return;
    const cursor = which ?? open.cursor;
    const item = items[open.row];
    if (item?.picks) item.onPick?.(item.picks[cursor]?.id ?? "");
    else if (item?.slide) item.slide.onSet(cursor);
    closePicking();
  };

  const abandon = () => {
    const open = picking;
    if (open === null) return;
    // Une glissière a déjà été entendue bouger, donc annuler doit remettre la
    // valeur d'avant. Une liste aussi, dès lors qu'elle s'applique en se
    // promenant; celles qui attendent la validation n'ont rien changé.
    const item = items[open.row];
    item?.slide?.onSet(open.was);
    if (item?.preview) item.onPick?.(item.picks?.[open.was]?.id ?? "");
    closePicking();
  };

  /** Les ordres pendant qu'un sélecteur est ouvert.
   *
   * Sur l'action BRUTE, jamais échangée: un sélecteur est un panneau et pas une
   * disposition. Haut et bas y parcourent la liste même dans un menu en rangée,
   * où haut et bas changent de rayon partout ailleurs.
   */
  const inPicker = (action: MenuAction) => {
    const open = picking;
    if (open === null) return;
    const item = items[open.row];
    if (item === undefined) return closePicking();
    if (action === "back") return abandon();
    if (action === "confirm") return validate();
    if (item.picks) {
      const last = item.picks.length - 1;
      const to = (cursor: number) => {
        setPicking({ ...open, cursor });
        // Un réglage qui se voit s'applique en se promenant: c'est ce qui rend
        // le choix lisible. Les autres attendent la validation, sinon lire une
        // liste de sept ambiances ferait clignoter la page sept fois.
        if (item.preview) item.onPick?.(item.picks?.[cursor]?.id ?? "");
      };
      if (action === "up") return to(Math.max(0, open.cursor - 1));
      if (action === "down") return to(Math.min(last, open.cursor + 1));
      return;
    }
    if (item.slide) {
      const by = action === "right" ? item.slide.step : action === "left" ? -item.slide.step : 0;
      if (by === 0) return;
      const next = Math.min(item.slide.max, Math.max(item.slide.min, open.cursor + by));
      setPicking({ ...open, cursor: next });
      item.slide.onSet(next);
    }
  };

  const act = (raw: MenuAction) => {
    if (paused) return;
    // Le sélecteur prend la main sur tout: sinon régler le volume ferait aussi
    // défiler la liste derrière.
    if (picking !== null) return inPicker(raw);
    const action = swapAxes ? SWAPPED[raw] : raw;
    if (action === "back" || action === "jeu") return onClose();
    if (action === "confirm") return choose(row);
    if (action === "up") return point(row >= perRow ? row - perRow : row);
    if (action === "down") return point(row + perRow < items.length ? row + perRow : row);
    const by = action === "right" ? 1 : -1;
    // Sur une entrée qui porte une valeur, gauche et droite la règlent plutôt
    // que de changer de rayon: c'est ce que fait un curseur de volume.
    const item = items[row];
    if (item?.onAdjust && !item.disabled) return item.onAdjust(by);
    // Dans une grille, gauche et droite se déplacent DANS la ligne tant qu'il
    // reste une case; au bord, on change de rayon.
    if (perRow > 1) {
      const next = row + by;
      const sameRow = Math.floor(next / perRow) === Math.floor(row / perRow);
      if (next >= 0 && next < items.length && sameRow) return point(next);
    }
    setRay(Math.min(categories.length - 1, Math.max(0, at + by)));
  };

  /* Le clavier, pour les trois formes. Il vit ici et pas dans chacune, sinon
     deux d'entre elles s'en passaient — ce qui était le cas. */
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (paused) return;
      if (typingIn(event.target)) return;
      // Un avis posé au-dessus du menu (une demande du chef, une erreur de
      // lancement) garde ses touches: ses flèches ne déplacent pas la liste.
      // Échap non plus ne ferme pas le menu: sans `preventDefault`, il
      // devenait une demande de fermeture du dialogue (`cancel`), qui le
      // fermait quand même (relecture du 22 novembre 2026).
      if (event.target instanceof Element && event.target.closest("[data-surcouche]")) {
        if (event.key === "Escape") event.preventDefault();
        return;
      }
      const action = KEYS[event.key];
      if (action === undefined) return;
      if (action === "confirm" && activeNatif(event.target)) return;
      event.preventDefault();
      act(action);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  });

  const open = picking === null ? undefined : items[picking.row];
  return {
    ray: at,
    row,
    category,
    items,
    goTo: setRay,
    point,
    choose,
    act,
    picking:
      picking === null || open === undefined
        ? null
        : {
            item: open,
            cursor: picking.cursor,
            moveTo: (cursor) => {
              setPicking({ ...picking, cursor });
              // La souris entend, et voit, ce qu'elle déplace.
              open.slide?.onSet(cursor);
              if (open.preview) open.onPick?.(open.picks?.[cursor]?.id ?? "");
            },
            confirm: validate,
            cancel: abandon,
            previewing: open.preview === true,
          },
  };
}

/**
 * Le menu est un dialogue modal, et son curseur est le focus.
 *
 * # Pourquoi un `<dialog>`
 *
 * Le menu couvrait l'écran sans être modal: le focus restait sur le bouton
 * « menu » caché dessous, et Tab passait d'abord par douze boutons de la
 * colonne recouverte (audit A11Y-04, 22 novembre 2026). `showModal()` rend le
 * reste de la page inerte, garde Tab dans le menu, et rend le focus à
 * l'élément d'avant quand il se ferme. L'écran des touches le faisait déjà.
 *
 * # Le curseur est le focus
 *
 * Chaque fois que l'entrée choisie change, par la croix, la manette, la souris
 * ou le doigt, elle reçoit le focus. Une seule entrée est dans l'ordre de
 * tabulation (`tabIndex` 0, les autres -1): Tab va de l'entrée choisie au pied,
 * et revient. Le clavier, la manette et un lecteur d'écran désignent donc la
 * même chose.
 *
 * Le focus ne se déplace pas tant qu'un écran est ouvert par-dessus (`paused`)
 * ou qu'un sélecteur a la main: chacun tient le sien.
 *
 * # Échap
 *
 * Le menu traite Échap lui-même (`back`: il remonte d'un dossier avant de
 * fermer), et son `preventDefault` sur `keydown` empêche le dialogue de se
 * fermer seul. Vérifié dans Chrome 151 le 22 novembre 2026: sans lui, la
 * seconde demande de fermeture d'affilée n'est plus annulable et le dialogue
 * se ferme. Le geste « retour » d'Android arrive par `cancel`, et fait la même
 * chose qu'Échap. Si le navigateur ferme quand même, `onQuitte` remet la page
 * d'accord avec lui.
 */
export function useMenuDialogue(
  shell: Shell,
  paused: boolean,
  onQuitte: () => void,
): {
  ref: React.RefObject<HTMLDialogElement | null>;
  id: string;
  "aria-label": string;
  onCancel: (event: React.SyntheticEvent<HTMLDialogElement>) => void;
  onClose: (event: React.SyntheticEvent<HTMLDialogElement>) => void;
} {
  const ref = useRef<HTMLDialogElement>(null);
  const parNous = useRef(false);

  // Avant le premier effet, pour que l'entrée choisie soit focalisable: un
  // dialogue fermé est `display: none`, et `focus()` n'y fait rien.
  useLayoutEffect(() => {
    const boite = ref.current;
    if (!boite) return;
    parNous.current = false;
    if (!boite.open) boite.showModal();
    return () => {
      parNous.current = true;
      if (boite.open) boite.close();
    };
  }, []);

  const choisie = shell.items[shell.row]?.id ?? null;
  const libre = shell.picking === null;
  useEffect(() => {
    if (paused || !libre) return;
    const boite = ref.current;
    if (!boite?.open) return;
    const ici = document.activeElement;
    // Le focus est dans un autre dialogue, ou sur un avis posé au-dessus du
    // menu: on ne le lui prend pas.
    if (ici && ici !== document.body && !boite.contains(ici)) return;
    if (ici?.closest("[data-surcouche]")) return;
    const cible =
      (choisie === null ? null : boite.querySelector<HTMLElement>(`[id="item-${choisie}"]`)) ??
      boite.querySelector<HTMLElement>("#closeMenu");
    cible?.focus({ preventScroll: true });
  }, [paused, libre, shell.ray, choisie]);

  return {
    ref,
    id: "menu",
    "aria-label": "menu de la salle",
    onCancel: (event) => {
      event.preventDefault();
      // Le geste « retour » d'Android, le focus sur un avis: l'avis garde la
      // main, comme pour Échap au clavier.
      if (document.activeElement?.closest("[data-surcouche]")) return;
      if (!paused) shell.act("back");
    },
    // Seulement si le dialogue est VRAIMENT fermé quand l'événement arrive.
    // Le navigateur l'envoie plus tard que `close()`: en développement, React
    // referme puis rouvre le menu au montage, et l'événement de la fermeture
    // du milieu arrivait après la réouverture, avec `parNous` déjà remis à
    // faux. Le menu ne s'ouvrait jamais sous Vite (`dialogue-fermeture.test`,
    // 22 novembre 2026).
    onClose: (event) => {
      if (!parNous.current && !event.currentTarget.open) onQuitte();
    },
  };
}

/**
 * Conduire un menu au doigt.
 *
 * Rend les gestionnaires de pointeur à poser sur la racine d'un habillage. Les
 * trois — la croix du XMB, le tableau des chaînes, la rangée de la Switch —
 * s'en servent, parce qu'une liste qu'on ne peut pas faire défiler au doigt est
 * une liste dont on n'atteint que le haut. Signalé depuis un téléphone le
 * 18 août 2026.
 *
 * Une seule implémentation et trois usages: trois copies de la même arithmétique
 * finiraient par diverger sur le cas qui compte, celui du geste diagonal.
 *
 * Par des références et non un état: on lit et on écrit à chaque mouvement du
 * doigt, et rendre la page à chaque pixel ferait ramer le menu qu'on essaie
 * justement de faire défiler.
 */
export function useSwipe(act: (action: MenuAction) => void) {
  const from = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      from.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event: React.PointerEvent) => {
      const start = from.current;
      if (start === null) return;
      const swipe = swipeFrom(event.clientX - start.x, event.clientY - start.y);
      if (swipe === null) return;
      // Le point de départ AVANCE d'autant de crans qu'on en a consommés, au
      // lieu d'être remis là où le doigt se trouve: sans ça un glissement lent
      // perdrait le reste du geste à chaque cran, et un long glissement
      // parcourrait moins de lignes qu'un court.
      const moved = swipe.steps * STEP;
      from.current =
        swipe.axis === "y"
          ? { x: start.x, y: start.y + moved }
          : { x: start.x + moved, y: start.y };
      const way =
        swipe.axis === "y" ? (swipe.steps > 0 ? "down" : "up") : swipe.steps > 0 ? "right" : "left";
      for (let done = 0; done < Math.abs(swipe.steps); done += 1) act(way);
    },
    onPointerUp: () => {
      from.current = null;
    },
    onPointerCancel: () => {
      from.current = null;
    },
  };
}
