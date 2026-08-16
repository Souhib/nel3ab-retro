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

export type Shell = {
  ray: number;
  row: number;
  category: XmbCategory | undefined;
  items: XmbItem[];
  goTo: (ray: number) => void;
  point: (row: number) => void;
  choose: (row: number) => void;
  act: (action: MenuAction) => void;
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
    if (item.onEnter) item.onEnter();
    else item.onAdjust?.(1);
  };

  const act = (raw: MenuAction) => {
    if (paused) return;
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

  return { ray: at, row, category, items, goTo: setRay, point, choose, act };
}
