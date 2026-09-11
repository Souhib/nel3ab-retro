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
import { typingIn } from "./typing";
import { useCallback, useEffect, useState } from "react";

const REMEMBERED = "nel3ab:bare";

/**
 * Replié ou non au chargement.
 *
 * Sur un TÉLÉPHONE, replié d'office. La colonne prend près de la moitié de la
 * largeur d'un écran tenu en travers, et l'image se retrouve écrasée dans ce qui
 * reste: mesuré sur un vrai téléphone le 18 août 2026, le jeu tenait dans la
 * moitié gauche pendant que les places et les boutons occupaient l'autre.
 *
 * Un choix explicite l'emporte, dans les deux sens: quelqu'un qui a replié sur
 * son ordinateur retrouve replié, et quelqu'un qui a déplié sur son téléphone
 * retrouve déplié. Ce n'est que le DÉFAUT qui regarde l'appareil.
 */
function stored(coarse: boolean): boolean {
  try {
    const found = localStorage.getItem(REMEMBERED);
    if (found === null) return coarse;
    return found === "1";
  } catch {
    return coarse;
  }
}

export function useBare(coarse = false): {
  bare: boolean;
  setBare: (bare: boolean) => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
} {
  const [bare, setKept] = useState(() => stored(coarse));
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

  // Ctrl seule, appuyée puis relâchée sans rien d'autre, replie et déplie. Pas
  // de raccourci pour le plein écran: le navigateur en a déjà un.
  //
  // C'était `F` jusqu'au 11 septembre 2026, et `F` est une touche de jeu: le
  // profil clavier Switch par défaut y met R, donc chaque R repliait la colonne
  // en pleine partie. Ctrl ne peut pas être assignée à une manette (Ctrl+W
  // fermerait l'onglet), et une combinaison, un clic ou la molette pendant
  // qu'elle est tenue annulent le geste: Ctrl+C ou le zoom ne replient rien.
  useEffect(() => {
    let alone = false;
    const down = (event: KeyboardEvent) => {
      alone = event.key === "Control" && !event.repeat ? !typingIn(event.target) : false;
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === "Control" && alone) setBare(!bare);
      alone = false;
    };
    const cancel = () => {
      alone = false;
    };
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("pointerdown", cancel);
    addEventListener("wheel", cancel);
    addEventListener("blur", cancel);
    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("pointerdown", cancel);
      removeEventListener("wheel", cancel);
      removeEventListener("blur", cancel);
    };
  }, [bare, setBare]);

  return { bare, setBare, fullscreen, toggleFullscreen };
}
