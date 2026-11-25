/**
 * Ce qu'on voit pendant que le site dit qui on est : le squelette de la salle.
 *
 * La page attend deux réponses avant d'ouvrir la salle : l'identité et les
 * réglages de manette (voir `App`). Le 22 novembre 2026, l'audit des états a
 * laissé un site muet douze secondes : aucun texte, le seul fond sombre, et
 * rien pour dire s'il fallait attendre ou recharger (E8). Cet écran le dit
 * tout de suite, puis a une FIN : passé la limite, il propose de réessayer, ou
 * d'entrer quand même avec le nom gardé dans ce navigateur.
 *
 * Depuis le 24 novembre 2026, il dessine la borne avant qu'elle arrive :
 * l'écran noir, la colonne avec « Salle 1 » et la maison d'Aïn, le panneau
 * de commande avec ses quatre START éteints. Les rectangles viennent de la
 * même géométrie que la salle (`useGeometrie`, état « connexion »), et la
 * colonne prend la largeur gardée par ce navigateur : rien ne saute quand la
 * salle prend sa place (etats.mjs, étape `ouverture-sans-saut`). Les
 * identifiants de la salle (`#side`, `#panneau`) n'y sont pas : un pilote qui
 * les attend attend la vraie salle.
 *
 * Aïn est posé dans le logo, immobile. Rien ne tourne pendant l'attente ;
 * à la limite, il joue « attente » une fois. Le thème est celui de la page,
 * l'écran reste noir dans les deux.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { modeDuCadre, type Rect } from "../lib/cadre";
import { BANDE_MIN, HAUTEUR_MIN } from "../lib/menu";
import { storedColumn } from "../lib/column";
import { storedFit } from "../lib/fit";
import { OUVERTURE } from "../lib/mots";
import { looksLikeAPhone, storedPadOnly } from "../lib/theme";
import { jouer, poserMascotte } from "../mascotte";
import { placeDe, useFenetre, useGeometrie, useZonesSures } from "./Cadre";
import { SCENE_DU_COIN } from "./Coin";
import "./ouverture.css";

/** Au-delà, le site ne répond pas, en millisecondes.
 *
 * Huit secondes. Sur le lien lent émulé de l'audit (22 novembre 2026), les
 * trois requêtes du premier écran prenaient 2,4 s à elles trois, et 1,1 s en
 * relais Tailscale : huit secondes, c'est plus de trois fois le pire mesuré. */
export const OUVERTURE_LIMITE_MS = 8000;

const RIEN = { width: 0, height: 0 };

export function Ouverture({
  salle,
  nomGarde,
  onReessayer,
  onEntrer,
}: {
  salle: number;
  /** Le nom gardé dans ce navigateur, ou vide : il nomme le second bouton. */
  nomGarde: string;
  onReessayer: () => void;
  /** Entrer sans attendre : le nom gardé dans ce navigateur, ou le formulaire. */
  onEntrer: () => void;
}) {
  /** Les secondes d'attente, comptées seulement passé la limite. */
  const [secondes, setSecondes] = useState(0);
  const longue = secondes > 0;
  useEffect(() => {
    let compte = 0;
    const fin = window.setTimeout(() => {
      setSecondes(OUVERTURE_LIMITE_MS / 1000);
      compte = window.setInterval(() => setSecondes((s) => s + 1), 1000);
    }, OUVERTURE_LIMITE_MS);
    return () => {
      window.clearTimeout(fin);
      window.clearInterval(compte);
    };
  }, []);

  /* La maison d'Aïn : peinte au montage, une scène à la limite, rien entre. */
  const maison = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (maison.current) poserMascotte(maison.current);
  }, []);
  useEffect(() => {
    if (longue && maison.current) jouer("attente", { hote: maison.current });
  }, [longue]);

  /* La géométrie de la salle à son arrivée : pas encore d'image, l'état
     « connexion », la colonne gardée par ce navigateur. */
  const fenetre = useFenetre();
  const zonesSures = useZonesSures(fenetre);
  const mode = modeDuCadre({
    largeur: fenetre.width,
    hauteur: fenetre.height,
    grossier: looksLikeAPhone(),
    role: storedPadOnly() ? "seule" : "joueur",
  });
  const [largeur] = useState(storedColumn);
  const geo = useGeometrie({
    mode,
    fenetre,
    zonesSures,
    image: RIEN,
    ajustement: storedFit(),
    // La salle n'est pas encore lue : aucune console, donc le panneau d'un
    // écran noir (`baseDuPanneau`).
    formatAttendu: null,
    etat: "connexion",
    role: "joueur",
    manette: null,
    largeurColonne: largeur,
    largeurPanneau: null,
    agrandie: false,
    reglage: false,
  });
  const tenu = mode === "portrait" || mode === "paysage";

  const ecran = <div className="n3-ouverture-ecran" aria-hidden="true" />;
  const panneau = (hauteur?: number) => (
    <div
      className="n3-panneau n3-ouverture-panneau"
      data-forme={hauteur === undefined ? "colonne" : "sous"}
      aria-hidden="true"
      style={
        hauteur === undefined ? undefined : ({ "--panneau-h": `${hauteur}px` } as CSSProperties)
      }
    >
      <div className="n3-panneau-places">
        {[1, 2, 3, 4].map((n) => (
          <span key={n} className="n3-ouverture-start">
            <span className="rt-bouton-start" data-libre="">
              {n}P
            </span>
          </span>
        ))}
      </div>
    </div>
  );
  const colonne = (contenu: { panneau: ReactNode; surEcran?: boolean }) => (
    <aside
      id="ouvertureColonne"
      aria-label={OUVERTURE.salle(salle)}
      className={
        contenu.surEcran
          ? "n3-colonne n3-ouverture-colonne max-h-full w-full max-w-[22.5rem] border border-rule bg-panel p-3"
          : tenu
            ? "n3-colonne n3-ouverture-colonne min-w-0 flex-1 bg-panel px-3 pt-3"
            : mode === "etroit"
              ? "n3-colonne n3-ouverture-colonne min-h-0 flex-1 border-t border-rule bg-panel px-3 pt-3"
              : "n3-colonne n3-ouverture-colonne shrink-0 border-l border-rule bg-panel px-3 pt-3"
      }
      style={mode === "bureau" ? { width: largeur, maxWidth: "50vw" } : undefined}
    >
      <header className="n3-colonne-tete">
        <h1 className="n3-colonne-salle">{OUVERTURE.salle(salle)}</h1>
      </header>
      <Parole
        salle={salle}
        secondes={secondes}
        nomGarde={nomGarde}
        onReessayer={onReessayer}
        onEntrer={onEntrer}
      />
      {contenu.panneau}
      {/* Le pied a la forme du coin de la salle (`Coin`, `.n3-coin`) : un
          filet, la place de sa ligne, puis la maison. Sans la ligne, Aïn
          descendait de 44 px quand la salle arrivait. En main, pas de
          maison : la salle n'y montre que sa tête, dans la barre, et le logo
          entier débordait d'une bande de 160 px. */}
      {tenu ? null : (
        <div className="n3-coin mt-auto" aria-hidden="true">
          <div className="n3-coin-ligne" />
          <div
            ref={maison}
            className="n3-coin-scene"
            data-hote="ouverture"
            style={{ height: SCENE_DU_COIN }}
          />
        </div>
      )}
    </aside>
  );

  if (tenu) {
    // En main, l'écran est où le cadre le posera ; la colonne prend la plus
    // grande place libre autour de lui, ou se pose sur l'écran noir quand
    // aucune bande ne se lit (`placeDeLaParole`).
    const libre = placeDeLaParole(geo.ecran, fenetre.width, fenetre.height);
    return (
      <div id="ouverture" className="n3-ouverture relative h-full" data-perdue={longue}>
        <main>
          <div style={geo.ecran ? placeDe(geo.ecran) : undefined} className="flex">
            {ecran}
          </div>
          <div
            style={placeDe(libre.rect)}
            className={libre.surEcran ? "flex items-center justify-center" : "flex"}
            data-sur-ecran={libre.surEcran ? "" : undefined}
          >
            {colonne({ panneau: panneau(), surEcran: libre.surEcran })}
          </div>
        </main>
      </div>
    );
  }
  const sous = mode === "bureau" && geo.panneau.forme === "sous" ? geo.panneau.rect : null;
  return (
    <div
      id="ouverture"
      className={
        mode === "etroit" ? "n3-ouverture flex h-full flex-col" : "n3-ouverture flex h-full"
      }
      data-perdue={longue}
    >
      <main
        className={
          mode === "etroit"
            ? "relative flex shrink-0 flex-col"
            : "relative flex min-w-0 flex-1 flex-col"
        }
        style={mode === "etroit" && geo.ecran ? { height: geo.ecran.h } : undefined}
      >
        {ecran}
        {sous ? panneau(sous.h) : null}
      </main>
      {colonne({ panneau: sous ? null : panneau() })}
    </div>
  );
}

/** Ce que dit la colonne : une phrase annoncée, puis, passé la limite, le
 * compte et deux gestes. Le compte avance hors de la région annoncée : une
 * seconde de plus ne se relit pas à voix haute. */
function Parole({
  salle,
  secondes,
  nomGarde,
  onReessayer,
  onEntrer,
}: {
  salle: number;
  secondes: number;
  nomGarde: string;
  onReessayer: () => void;
  onEntrer: () => void;
}) {
  const longue = secondes > 0;
  return (
    <section className="n3-ouverture-parole" aria-labelledby="ouvertureTitre">
      <div role="status" aria-atomic="true">
        <p id="ouvertureTitre" className="n3-ouverture-titre">
          {longue ? OUVERTURE.muet : OUVERTURE.ouvre(salle)}
        </p>
      </div>
      {longue ? (
        <>
          <p id="ouvertureCompte" className="n3-ouverture-compte">
            {OUVERTURE.depuis(secondes)}
          </p>
          <div className="n3-ouverture-actions">
            <button
              type="button"
              className="rt-boite rt-bouton rt-bouton-plein n3-ouverture-bouton"
              data-plein=""
              onClick={onReessayer}
            >
              <i className="rt-ombre" aria-hidden="true" />
              {OUVERTURE.reessayer}
            </button>
            <button
              type="button"
              className="rt-boite rt-bouton n3-ouverture-bouton"
              onClick={onEntrer}
            >
              <i className="rt-ombre" aria-hidden="true" />
              {nomGarde ? OUVERTURE.entrerEnTantQue(nomGarde) : OUVERTURE.entrerQuandMeme}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

/** La bande la plus étroite où la colonne se lit encore : celle du menu
 * (`BANDE_MIN`, `HAUTEUR_MIN` de `lib/menu`). */
const LISIBLE = { w: BANDE_MIN, h: HAUTEUR_MIN };

/** L'écart gardé entre la colonne posée sur l'écran et ses bords, en px. */
const BORD_PX = 16;

/**
 * Où se pose la colonne de l'ouverture tenue en main : la plus grande bande
 * libre autour de l'écran si elle se lit, sinon sur l'écran noir, qui ne
 * porte encore aucune image de jeu.
 *
 * Une tablette couchée n'a pas de bande : l'écran d'une fenêtre 4:3 la
 * remplit presque. La colonne y recevait 0 px de haut à 1024x768, 43,5 px
 * de large à 1180x820 et 0,5 px à 1366x1024, où elle débordait à droite et
 * élargissait la page jusque dans la salle (relecture finale du 25 novembre
 * 2026).
 */
export function placeDeLaParole(
  ecran: Rect | null,
  W: number,
  H: number,
): { rect: Rect; surEcran: boolean } {
  const bande = plusGrandLibre(ecran, W, H);
  if (ecran === null || (bande.w >= LISIBLE.w && bande.h >= LISIBLE.h))
    return { rect: bande, surEcran: false };
  const x = Math.max(0, ecran.x) + BORD_PX;
  const y = Math.max(0, ecran.y) + BORD_PX;
  return {
    rect: {
      x,
      y,
      w: Math.min(ecran.x + ecran.w, W) - BORD_PX - x,
      h: Math.min(ecran.y + ecran.h, H) - BORD_PX - y,
    },
    surEcran: true,
  };
}

/** La plus grande bande libre autour de l'écran : dessous, dessus, à droite
 * ou à gauche. Sans écran, toute la fenêtre. */
export function plusGrandLibre(ecran: Rect | null, W: number, H: number): Rect {
  if (!ecran) return { x: 0, y: 0, w: W, h: H };
  const bas = ecran.y + ecran.h;
  const droite = ecran.x + ecran.w;
  const bandes: Rect[] = [
    { x: 0, y: bas, w: W, h: Math.max(0, H - bas) },
    { x: 0, y: 0, w: W, h: Math.max(0, ecran.y) },
    { x: droite, y: 0, w: Math.max(0, W - droite), h: H },
    { x: 0, y: 0, w: Math.max(0, ecran.x), h: H },
  ];
  return bandes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
}
