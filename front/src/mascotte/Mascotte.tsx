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
  hote,
}: {
  /** La scène à jouer, ou `null` pour le personnage au repos. */
  scene: Scene | null;
  /** Rejoue la scène quand il change: un compteur d'arrivées, par exemple. */
  jeton?: number;
  className?: string;
  /** L'endroit, pour l'arbitre de la salle (`data-hote`) : « barre » porte
   * la tête seule d'Aïn, peinte dès le montage. */
  hote?: "barre" | "coin" | "plateau";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) poserMascotte(ref.current);
  }, []);
  useEffect(() => {
    if (!ref.current || scene === null) return;
    const lecture = jouer(scene, { hote: ref.current });
    return () => lecture.interrompre();
  }, [scene, jeton]);
  return <span ref={ref} className={className} data-hote={hote} aria-hidden="true" />;
}
