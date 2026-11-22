/**
 * Le bouton « Inviter » de la colonne: un lien qui entre dans cette salle pour
 * jouer (audit P11). La logique vit dans `lib/invitation`; ici, l'affichage.
 */
import { useState } from "react";
import {
  ditInvitation,
  inviter,
  outilsDuNavigateur,
  RESEAU_PRIVE,
  type Invitation,
  type Outils,
} from "../lib/invitation";

export function Inviter({ lien, outils }: { lien: string; outils?: Outils }) {
  const [etat, setEtat] = useState<Invitation | null>(null);
  const dit = ditInvitation(etat);
  return (
    <section aria-label="inviter" className="flex flex-col gap-1 border-t border-rule pt-2">
      <button
        type="button"
        id="inviter"
        data-rend-le-jeu=""
        onClick={() => void inviter(lien, outils ?? outilsDuNavigateur()).then(setEtat)}
        className="border border-rule px-3 py-2 text-left text-corps text-muted transition-colors hover:border-rule-bright hover:text-text"
      >
        Inviter quelqu&apos;un
      </button>
      {dit ? (
        <p role="status" className="text-note text-muted">
          {dit}
        </p>
      ) : null}
      {etat === "a-copier" ? (
        <input
          readOnly
          aria-label="lien d'invitation"
          value={lien}
          onFocus={(event) => event.currentTarget.select()}
          className="border border-rule bg-transparent px-2 py-1 font-mono text-note"
        />
      ) : null}
      {etat !== null && etat !== "annulee" ? (
        <p className="text-note text-faint">{RESEAU_PRIVE}</p>
      ) : null}
    </section>
  );
}
