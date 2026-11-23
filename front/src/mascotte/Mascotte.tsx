/**
 * La mascotte dans un composant: un hôte, et une scène jouée quand `jeton`
 * change.
 *
 *     <Mascotte scene="arrivee" jeton={arrivees} />
 *
 * React ne fait que tenir l'hôte et dire « joue »; le mouvement vit dans
 * `mascotte/` et le navigateur, jamais dans un rendu de React. Le composant
 * n'a pas sa place sur l'image du jeu: `jouer` le refuserait.
 */
import { useEffect, useRef } from "react";

import { jouer, poserMascotte, type Scene } from "./index";

export function Mascotte({
  scene,
  jeton = 0,
  className,
}: {
  /** La scène à jouer, ou `null` pour le personnage au repos. */
  scene: Scene | null;
  /** Rejoue la scène quand il change: un compteur d'arrivées, par exemple. */
  jeton?: number;
  className?: string;
}) {
  const hote = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (hote.current) poserMascotte(hote.current);
  }, []);
  useEffect(() => {
    if (!hote.current || scene === null) return;
    const lecture = jouer(scene, { hote: hote.current });
    return () => lecture.interrompre();
  }, [scene, jeton]);
  return <span ref={hote} className={className} aria-hidden="true" />;
}
