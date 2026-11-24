/**
 * Les rubriques du menu de la salle, une par fonction.
 *
 * Le tableau des rubriques (`rays`) faisait 730 lignes dans la fonction `Room`
 * d'`App.tsx`, elle-même longue de 2600 lignes (vérification finale du
 * 22 novembre 2026). Une rubrique sortie ici reçoit ce qu'elle lit et les
 * gestes qu'elle déclenche: elle ne tient aucun état.
 */
import type { Liaison } from "../media/liaison";
import { pour, type Appareil } from "./appareil";
import { NOM_ETAT, resumeConnexion } from "./liaison-mots";
import type { Ligne } from "./menu";
import { FICHE } from "./mots";

/**
 * « mesures techniques » (« état de la connexion » jusqu'au 24 novembre 2026,
 * M5), l'entrée qui a remplacé la rubrique « mesures ».
 *
 * La rubrique « mesures » en tenait une sur quatre, au même rang que « jeux »,
 * pour trois chiffres de diagnostic (audit T13). Ils sont ici, repliés, et le
 * détail vit dans la colonne. La valeur est l'état par son nom, et non un
 * compte d'images: le nom promettait un état (relecture du 22 novembre 2026).
 */
export function entreeConnexion({
  liaison,
  images,
  hz,
  port,
  appareil,
  compact,
  fiche,
  voirDetail,
}: {
  liaison: Liaison;
  /** Les images peintes par cette page. */
  images: number;
  /** La cadence de l'écran de cet appareil. */
  hz: number;
  port: number | null;
  appareil: Appareil;
  /** La colonne est un tiroir. */
  compact: boolean;
  /** Le menu est posé hors de la colonne, tenu en main : le résumé s'ouvre
   * dans sa fiche, et la colonne reste un choix. */
  fiche: boolean;
  /** Ouvre le détail dans la colonne et ferme le menu. */
  voirDetail: () => void;
}): Ligne {
  const resume = resumeConnexion(liaison, { images, hz, port });
  const ou = compact ? "dans la salle" : "dans la colonne";
  return {
    id: "connexion",
    label: "mesures techniques",
    value: NOM_ETAT[liaison.etat],
    ...(appareil === "tactile" || fiche
      ? {
          // Sur un téléphone, le détail dans la colonne coupait l'écran en
          // deux moitiés de 195 px: le résumé s'ouvre dans la fiche du menu,
          // et la colonne reste un choix.
          hint: pour(appareil, "voir le résumé"),
          fiche: {
            consequence: `Tout le détail ${ou}, à la place du menu.`,
            agir: FICHE.detail,
            annuler: FICHE.revenir,
            contenu: (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-corps">
                {resume.map((ligne) => (
                  <div key={ligne.nom} className="contents">
                    <dt className="text-muted">{ligne.nom}</dt>
                    <dd>{ligne.valeur}</dd>
                  </div>
                ))}
              </dl>
            ),
            onAgir: () => voirDetail(),
          },
        }
      : {
          hint: `${resume
            .slice(1)
            .map((ligne) => `${ligne.nom}: ${ligne.valeur}`)
            .join(", ")}. ${pour(appareil, `voir le détail ${ou}`)}.`,
          onEnter: voirDetail,
        }),
  };
}
