/**
 * Cacher tout ce qui n'est pas l'image.
 *
 * Deux gestes différents, et il faut les deux. **Replier la colonne** laisse la
 * fenêtre telle quelle et rend toute sa largeur à l'image: c'est ce qu'on veut à
 * quatre autour d'un écran, sans quitter le navigateur. Le **plein écran** du
 * navigateur retire en plus les onglets et la barre du système.
 *
 * Le repli est gardé, le plein écran ne l'est pas: on ne rend pas quelqu'un
 * plein écran au chargement sans qu'il l'ait demandé, et les navigateurs le
 * refusent de toute façon hors d'un geste.
 */
import { useCallback, useEffect, useState } from "react";

const REMEMBERED = "nel3ab:bare";

function stored(): boolean {
  try {
    return localStorage.getItem(REMEMBERED) === "1";
  } catch {
    return false;
  }
}

export function useBare(): {
  bare: boolean;
  setBare: (bare: boolean) => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
} {
  const [bare, setKept] = useState(stored);
  const [fullscreen, setFullscreen] = useState(false);

  const setBare = useCallback((next: boolean) => {
    setKept(next);
    try {
      localStorage.setItem(REMEMBERED, next ? "1" : "0");
    } catch {
      /* navigation privée */
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // Le navigateur peut sortir du plein écran sans nous demander (Échap), donc on
  // écoute plutôt que de tenir un compte de notre côté.
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);

  // `F` replie et déplie. Pas de raccourci pour le plein écran: le navigateur en
  // a déjà un, et en ajouter un qui fait presque la même chose fait deux choses
  // à retenir pour une.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Pas pendant qu'on tape un pseudo ou qu'on réassigne une touche.
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "f" || event.key === "F") setBare(!bare);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [bare, setBare]);

  return { bare, setBare, fullscreen, toggleFullscreen };
}
