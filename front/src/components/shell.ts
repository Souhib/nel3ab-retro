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
import { useEffect, useState } from "react";
import type { MenuAction } from "../media/menupad";
import type { XmbCategory, XmbItem } from "./Xmb";

/** Un sélecteur ouvert par-dessus le menu.
 *
 * Il vit dans la mécanique partagée et non dans chaque console, pour la même
 * raison que le reste: quatre implémentations d'un même sélecteur finiraient par
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
  Escape: "back",
};

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
    if (action === "back") return onClose();
    if (action === "confirm") return choose(row);
    if (action === "up") return point(Math.max(0, row - perRow));
    if (action === "down") return point(Math.min(items.length - 1, row + perRow));
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
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const action = KEYS[event.key];
      if (action === undefined) return;
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
