/**
 * Le code QR d'un lien d'invitation, dessiné à l'ouverture seulement.
 *
 * L'encodeur (`lib/qr`) est chargé par un import dynamique au montage, et ce
 * composant n'est monté que quand l'invitation est dépliée : la page n'évalue
 * pas l'encodeur pour rien. Ses octets restent dans la page (la construction
 * en un seul fichier inline les imports dynamiques, ADR D13).
 *
 * Le cadre a une taille fixe AVANT le dessin : le code qui arrive ne pousse
 * rien dans la colonne. Les modules sont noirs sur blanc dans les deux
 * thèmes : un code clair sur fond sombre se lit mal par beaucoup de
 * téléphones. Les deux couleurs sont des jetons de la régie (`--noir`,
 * `--blanc`), posés par `places.css`.
 */
import { useEffect, useState } from "react";
import { INVITER } from "../lib/mots";
import "./places.css";

/** Le module de l'encodeur, ou ce qui le remplace dans un essai. */
export type ModuleQR = Pick<typeof import("../lib/qr"), "code" | "chemin">;

const chargerQR = (): Promise<ModuleQR> => import("../lib/qr");

type Dessin = { d: string; cote: number } | "trop-long" | null;

export function CodeQR({
  texte,
  titre,
  charger = chargerQR,
}: {
  texte: string;
  /** Le nom du dessin, pour qui ne le voit pas. */
  titre: string;
  charger?: () => Promise<ModuleQR>;
}) {
  const [dessin, setDessin] = useState<Dessin>(null);
  useEffect(() => {
    let actif = true;
    void charger().then((qr) => {
      if (!actif) return;
      try {
        setDessin(qr.chemin(qr.code(texte)));
      } catch {
        // `code` refuse un lien trop long au lieu de le couper.
        setDessin("trop-long");
      }
    });
    return () => {
      actif = false;
    };
  }, [texte, charger]);
  return (
    <div className="n3-qr-cadre" data-dessine={dessin && dessin !== "trop-long" ? "" : undefined}>
      {dessin === "trop-long" ? (
        <p className="text-note text-muted">{INVITER.tropLong}</p>
      ) : dessin ? (
        <svg
          className="n3-qr rt-nettes"
          viewBox={`0 0 ${dessin.cote} ${dessin.cote}`}
          role="img"
          aria-label={titre}
          shapeRendering="crispEdges"
        >
          <rect className="n3-qr-fond" width={dessin.cote} height={dessin.cote} />
          <path className="n3-qr-modules" d={dessin.d} />
        </svg>
      ) : null}
    </div>
  );
}
