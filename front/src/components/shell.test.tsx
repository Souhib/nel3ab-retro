import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useShell } from "./shell";
import type { XmbCategory } from "./Xmb";

const categories: XmbCategory[] = [
  {
    id: "settings",
    label: "Réglages",
    icon: null,
    items: Array.from({ length: 14 }, (_, index) => ({
      id: String(index),
      label: String(index),
      icon: null,
    })),
  },
];

it("garde sa colonne aux bords verticaux de la grille Wii", () => {
  const { result } = renderHook(() => useShell(categories, 4, vi.fn()));
  act(() => result.current.point(2));
  act(() => result.current.act("up"));
  expect(result.current.row).toBe(2);
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(6);
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(10);
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(10);
  act(() => result.current.point(13));
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(13);
  act(() => result.current.act("up"));
  expect(result.current.row).toBe(9);
});

it("le panneau de configuration suspend aussi les raccourcis du navigateur", () => {
  const close = vi.fn();
  const { result, rerender } = renderHook(({ paused }) => useShell(categories, 1, close, paused), {
    initialProps: { paused: true },
  });
  const press = new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true });
  act(() => dispatchEvent(press));
  expect(result.current.row).toBe(0);
  expect(press.defaultPrevented).toBe(false);
  rerender({ paused: false });
  act(() => result.current.act("down"));
  expect(result.current.row).toBe(1);
  act(() => result.current.act("back"));
  expect(close).toHaveBeenCalledOnce();
});

it("Espace valide par la croix, et une touche inconnue ne fait rien", () => {
  const choisi = vi.fn();
  const jeux: XmbCategory[] = [
    {
      id: "jeux",
      label: "Jeux",
      icon: null,
      items: [
        { id: "a", label: "A", icon: null, onEnter: choisi },
        { id: "b", label: "B", icon: null, onEnter: vi.fn() },
      ],
    },
  ];
  const { result } = renderHook(() => useShell(jeux, 1, vi.fn()));
  act(() => result.current.point(0));
  // Espace DOIT passer par la mécanique du menu. Sans ça, il ne reçoit pas le
  // `preventDefault` et déclenche l'activation native du bouton qui a le focus,
  // c'est-à-dire une entrée que la croix ne désigne pas: sur le rayon « jeux »,
  // ça lance un jeu et ça coupe la partie de tout le monde.
  const espace = new KeyboardEvent("keydown", { key: " ", cancelable: true });
  act(() => dispatchEvent(espace));
  expect(espace.defaultPrevented).toBe(true);
  expect(choisi).toHaveBeenCalledOnce();
  // Le jumeau négatif: une touche qui ne conduit pas le menu doit rester au
  // navigateur, sinon on confisquerait tout le clavier de la page.
  const lettre = new KeyboardEvent("keydown", { key: "a", cancelable: true });
  act(() => dispatchEvent(lettre));
  expect(lettre.defaultPrevented).toBe(false);
  expect(choisi).toHaveBeenCalledOnce();
});

/* Le focus et le curseur sont une seule chose (audit A11Y-02, 22 novembre
   2026). Avant, Entrée et Espace validaient l'entrée sous le curseur même
   quand le focus était sur un autre bouton: sur « Échap reprend la partie »,
   Entrée a ouvert le dossier GameCube. Le navigateur active maintenant le
   bouton qui a le focus, et le menu ne garde Entrée que quand personne ne
   l'a. */
const unJeu = (choisi: () => void): XmbCategory[] => [
  {
    id: "jeux",
    label: "Jeux",
    icon: null,
    items: [
      { id: "gc", label: "GameCube", icon: null, onEnter: choisi },
      { id: "wii", label: "Wii", icon: null, onEnter: vi.fn() },
    ],
  },
];

it("Entrée et Espace sur un bouton qui a le focus restent à ce bouton", () => {
  const choisi = vi.fn();
  renderHook(() => useShell(unJeu(choisi), 1, vi.fn()));
  const reprendre = document.createElement("button");
  document.body.append(reprendre);
  for (const key of ["Enter", " "]) {
    const appui = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    act(() => reprendre.dispatchEvent(appui));
    expect(appui.defaultPrevented, key).toBe(false);
  }
  expect(choisi).not.toHaveBeenCalled();
  reprendre.remove();
});

it("Entrée sans bouton focalisé valide l'entrée sous le curseur", () => {
  // Le jumeau: la croix et la manette valident toujours par ce chemin.
  const choisi = vi.fn();
  renderHook(() => useShell(unJeu(choisi), 1, vi.fn()));
  const appui = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  act(() => document.body.dispatchEvent(appui));
  expect(appui.defaultPrevented).toBe(true);
  expect(choisi).toHaveBeenCalledOnce();
});

it("les flèches conduisent le curseur même depuis un bouton du pied", () => {
  // Le curseur revient là où sont les flèches: c'est ce qui rend le focus à la
  // liste quand on est passé par Tab sur « reprendre ».
  const { result } = renderHook(() => useShell(unJeu(vi.fn()), 1, vi.fn()));
  const reprendre = document.createElement("button");
  document.body.append(reprendre);
  const bas = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  act(() => reprendre.dispatchEvent(bas));
  expect(bas.defaultPrevented).toBe(true);
  expect(result.current.row).toBe(1);
  reprendre.remove();
});

/**
 * Un avis posé dans le menu (`Surcouche`) garde ses touches.
 *
 * Aucun essai ne citait `[data-surcouche]` dans la première version: le mutant
 * qui retirait la garde passait les 1 025 essais (relecture du 22 novembre
 * 2026). Et Échap sur le bouton de l'avis fermait le menu, par l'événement
 * `cancel` du dialogue, parce que la garde rendait la main sans
 * `preventDefault`.
 */
it("une flèche et Échap venues d'un avis posé dans le menu ne conduisent pas le menu", () => {
  const fermer = vi.fn();
  const { result } = renderHook(() => useShell(unJeu(vi.fn()), 1, fermer));
  const place = document.createElement("div");
  place.setAttribute("data-surcouche", "");
  const masquer = document.createElement("button");
  place.append(masquer);
  document.body.append(place);
  const bas = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  act(() => masquer.dispatchEvent(bas));
  expect(result.current.row).toBe(0);
  expect(bas.defaultPrevented).toBe(false);
  // Échap: rien pour le menu, et la demande de fermeture du dialogue est
  // annulée dès le `keydown`.
  const echap = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => masquer.dispatchEvent(echap));
  expect(fermer).not.toHaveBeenCalled();
  expect(echap.defaultPrevented).toBe(true);
  place.remove();
});

it("le jumeau: la même flèche et le même Échap sur un bouton du menu le conduisent", () => {
  const fermer = vi.fn();
  const { result } = renderHook(() => useShell(unJeu(vi.fn()), 1, fermer));
  const entree = document.createElement("button");
  document.body.append(entree);
  act(() =>
    entree.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    ),
  );
  expect(result.current.row).toBe(1);
  act(() =>
    entree.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(fermer).toHaveBeenCalledOnce();
  entree.remove();
});
