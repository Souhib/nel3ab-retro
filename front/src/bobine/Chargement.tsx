/**
 * Le chargement raconté par Bobine: il prépare le jeu, l'insère quand la salle
 * le lance, et souffle dedans si rien ne vient.
 *
 * Les gestes suivent les ÉTAPES que la page connaît (`lib/booting.ts`), pas une
 * horloge: le jeu entre dans la fente quand l'émulateur démarre vraiment, et
 * pas au bout d'un délai inventé. Le texte des étapes reste affiché à côté:
 * la scène illustre, elle ne remplace pas ce qu'on sait.
 */
import type { Step } from "../lib/booting";
import { Bobine, type Pose } from "./Bobine";
import { Console, type Diode } from "./Console";
import type { Support } from "./support";

export function Chargement({
  support,
  etape,
  perdu,
}: {
  support: Support;
  etape: Step;
  perdu: boolean;
}) {
  const insere = etape === "waiting" || etape === "painting";
  const diode: Diode = perdu ? "coince" : etape === "painting" ? "allumee" : "eteinte";
  let pose: Pose;
  let tenue: Parameters<typeof Bobine>[0]["tenue"];
  if (perdu) {
    // Le geste que tout le monde a fait un jour, et qui ne marchait pas non plus.
    pose = support === "cartouche" ? "souffle" : "loupe";
    tenue = support === "cartouche" ? "cartouche" : "loupe";
  } else if (insere) {
    pose = etape === "painting" ? "salue" : "pousse";
    tenue = undefined;
  } else if (support === "disque") {
    pose = "essuie";
    tenue = "disque";
  } else if (support === "cartouche") {
    pose = "souffle";
    tenue = "cartouche";
  } else {
    pose = "porte";
    tenue = "carte";
  }
  return (
    <div className="n3-chargement" data-etape={etape} data-perdu={perdu}>
      <div className="n3-chargement-bob">
        <Bobine pose={pose} tenue={tenue} taille={76} />
      </div>
      <Console support={support} diode={diode} avale={insere && !perdu} />
    </div>
  );
}
