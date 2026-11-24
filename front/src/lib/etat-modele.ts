/**
 * L'état de la salle en UN modèle par rendu : ce qui se dit, où, et ce qui
 * couvre l'image.
 *
 * Trois sources disent un état : la liaison (`media/liaison.ts`), le compte de
 * fermeture du worker (`closingIn`), et l'image légère passée d'elle-même.
 * Avant ce chantier, chacune avait son avis à elle, posé sur l'image ou au
 * bord : trois écrans qui pouvaient parler en même temps. Ici une seule
 * fonction pure décide lequel l'emporte, et la page n'en montre qu'un : une
 * seule pastille, une seule fiche.
 *
 * La priorité, de la plus forte à la plus faible : le plein cadre (rien à
 * voir d'autre), puis une liaison coupée, une salle injoignable ou qui
 * redémarre, la fermeture proche, l'affichage arrêté, l'image figée, l'image
 * légère, et la proposition de l'image légère. Une panne passe avant la
 * fermeture : une salle qui ne répond pas ne ferme pas sous les yeux, elle a
 * déjà disparu.
 *
 * La couverture suit l'état (`media/couverture.ts`, ADR D40) : le plein cadre
 * pour ce qui n'a pas encore eu d'image ou n'en aura plus, la neige pour une
 * connexion coupée (au niveau « sobre », l'image arrêtée assombrie à sa
 * place), et l'image assombrie pour une image figée dont la fiche est là.
 * Jamais rien sur une image qui bouge : la première image peinte lève tout.
 */
import type { Jeton } from "../media/couverture";
import type { Liaison } from "../media/liaison";
import { dire, direFermeture, direLegere, type Contexte, type Dit } from "./liaison-mots";

/** Ce qui décide l'état montré. */
export type Entree = {
  liaison: Liaison;
  salle: number;
  contexte: Contexte;
  /** Les minutes avant la fermeture faute d'activité, 0 sans compte. */
  fermeDans: number;
  /** Cette page tient une place : elle peut dire « je reste ». */
  place: boolean;
  /** L'image est passée en image légère d'elle-même, et l'avis n'est pas
   * encore tranché (« Garder » ou « Revenir »). */
  legerePassee: boolean;
  /** L'image légère est active sur cette page. */
  legere: boolean;
  /** L'effet « neige » est allumé (niveaux « conseillé » et « tout »). */
  neige: boolean;
};

/** L'identifiant de l'état montré, posé en `data-etat` : les noms de la
 * liaison, plus la fermeture proche et l'image légère. */
export type IdEtat = Liaison["etat"] | "fermeture" | "legere";

export type Modele = Dit & {
  id: IdEtat;
  /** Ce que la couverture pose sur l'image, ou rien. */
  couverture: Jeton | null;
  /** La ligne d'état du coin de la mascotte : `null` lui laisse sa phrase de
   * la liaison, `""` la fait taire (une fiche dit déjà l'état : jamais deux
   * fois le même texte), un texte la remplace. */
  ligneCoin: string | null;
};

/** Ce que dit le coin d'une image légère gardée : un réglage de la page,
 * sans pastille ni fiche. */
export const LIGNE_LEGERE = "Image légère, sur ton écran seulement.";

/** Les pannes qui passent avant la fermeture proche. */
const PANNES: readonly Liaison["etat"][] = ["coupee", "injoignable", "redemarre"];

const taitLeCoin = (dit: Dit): string | null =>
  dit.niveau === "fiche" || dit.niveau === "plein" ? "" : null;

/** Ce que l'image reçoit pour un état de la liaison. */
function couvertureDe(liaison: Liaison, dit: Dit, neige: boolean): Jeton | null {
  if (dit.niveau === "plein") return "plein";
  // K20, décision du propriétaire : la neige remplace l'image d'une
  // connexion coupée, et elle seule ; « sobre » n'a pas la neige, l'image
  // arrêtée y est assombrie.
  if (liaison.etat === "coupee") return neige ? "neige" : "passee";
  // Une image ARRÊTÉE peut être assombrie, à la fiche seulement : intacte
  // pendant la pastille, levée par la toute première image nouvelle.
  if ((liaison.etat === "figee" || liaison.etat === "decodeur") && dit.niveau === "fiche")
    return "passee";
  return null;
}

export function modeleEtat(e: Entree): Modele {
  const dit = dire(e.liaison, e.salle, e.contexte);
  const depuisLaLiaison = (): Modele => ({
    ...dit,
    id: e.liaison.etat,
    couverture: couvertureDe(e.liaison, dit, e.neige),
    ligneCoin: taitLeCoin(dit),
  });
  if (dit.niveau === "plein" || PANNES.includes(e.liaison.etat)) return depuisLaLiaison();
  if (e.fermeDans > 0) {
    const ferme = direFermeture(e.fermeDans, e.place);
    return { ...ferme, id: "fermeture", couverture: null, ligneCoin: taitLeCoin(ferme) };
  }
  if (e.liaison.etat === "decodeur" || e.liaison.etat === "figee") return depuisLaLiaison();
  if (e.legerePassee) return { ...direLegere(), id: "legere", couverture: null, ligneCoin: "" };
  if (e.liaison.etat === "irreguliere") return depuisLaLiaison();
  return {
    ...dit,
    id: e.liaison.etat,
    couverture: null,
    ligneCoin: e.legere ? LIGNE_LEGERE : null,
  };
}
