/**
 * « Qui joue ? » : un nom, et rien d'autre, pour une page sans identité.
 *
 * La vidéo ne démarre pas tant qu'aucun nom n'est donné. Non parce que quoi
 * que ce soit le vérifie, mais parce qu'une image qui tourne derrière un
 * formulaire est une image que personne ne regarde, décodée sur une machine
 * où quelqu'un d'autre joue.
 *
 * Depuis le 24 novembre 2026, le champ est celui du chantier personnes
 * (`ChampNom`, `useNom`) : un libellé visible, une aide, l'aperçu de
 * l'étiquette tapée telle que les autres la verront, et un bouton TOUJOURS
 * actif. Un nom vide est refusé avec sa raison et le focus revient au champ,
 * au lieu d'un bouton grisé qui ne disait pas pourquoi (audits A11Y-10 et
 * A11Y-17). Une personne identifiée change son nom dans l'avant-salle : cet
 * écran ne sert qu'à une page sans identité. « Ce n'est pas toi ? » y mène,
 * champ vide, et le dit (`autreNom`).
 */
import { useEffect, useRef } from "react";

import { rememberName } from "../lib/name";
import { QUI_JOUE } from "../lib/mots";
import { useNom } from "../lib/useNom";
import { poserMascotte } from "../mascotte";
import { ChampNom } from "./ChampNom";
import { Logo } from "./Logo";
import "./lobby.css";

export function Entrance({
  onName,
  salle = null,
  oublie = false,
}: {
  onName: (name: string) => void;
  /** « salle 1 », pour le bouton ; rien quand la page ne la connaît pas. */
  salle?: string | null;
  /** Vrai quand cet appareil vient d'oublier un autre nom (« Ce n'est pas toi ? »). */
  oublie?: boolean;
}) {
  const nom = useNom();
  // La maison d'Aïn sur cet écran : le logo au-dessus du formulaire (plan
  // salon, entree-nom#3, traduit pour Aïn). Posé au montage, au repos :
  // aucune scène ne joue pendant qu'on tape son nom.
  const maison = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (maison.current) poserMascotte(maison.current);
  }, []);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        noValidate
        className="flex w-full max-w-sm flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          nom.soumettre((garde) => {
            rememberName(garde);
            onName(garde);
          });
        }}
      >
        <header className="flex flex-col gap-2">
          <div ref={maison} className="n3-avant-maison" data-hote="logo">
            <Logo />
          </div>
          <h1 className="rt-titre text-large">{QUI_JOUE.titre}</h1>
          <p className="text-corps text-muted">{QUI_JOUE.intro}</p>
          {oublie ? <p className="text-corps text-muted">{QUI_JOUE.autreNom}</p> : null}
        </header>
        <main className="flex flex-col gap-3">
          <ChampNom nom={nom} autoFocus />
          <button
            type="submit"
            id="entrerNom"
            className="rt-boite rt-bouton rt-bouton-plein n3-avant-bouton"
          >
            <i className="rt-ombre" aria-hidden="true" />
            {QUI_JOUE.entrer(salle)}
          </button>
        </main>
      </form>
    </div>
  );
}
