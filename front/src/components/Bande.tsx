/**
 * La bande d'une salle tenue en main : la place sous le panneau de commande,
 * où se dit ce qui ne se pose pas sur l'image.
 *
 * Au bureau, la pile des avis (manette branchée, fermeture proche, clavier en
 * pause) va dans une bande noire ou en tête de la colonne (`lieuDesAvis`). Au
 * téléphone, elle va ici, dans la zone sûre, entre l'image et la manette. Les
 * autres chantiers y poseront leurs phrases (qui regarde, l'état de la
 * liaison) par la prop `children`.
 */
import type { Rect } from "../lib/cadre";
import { placeDe } from "./Cadre";
import "./telephone.css";

export function Bande({ rect, children }: { rect: Rect; children: React.ReactNode }) {
  return (
    <section id="bande" className="n3-bande" aria-label="La salle en bref" style={placeDe(rect)}>
      {children}
    </section>
  );
}
