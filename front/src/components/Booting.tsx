/**
 * L'écran de chargement, quand la salle change de jeu.
 *
 * Changer de jeu arrête l'émulateur, redémarre le worker et fait se reconnecter
 * toutes les pages. Ça prend une dizaine de secondes, pendant lesquelles il ne
 * se passait rien à l'écran sauf une petite ligne dans la colonne: on ne savait
 * pas si on avait cliqué, si ça marchait, ou si c'était cassé.
 *
 * Ce qu'il montre est ce que la page SAIT: le nom du jeu demandé, et l'étape où
 * elle en est. Pas une barre qui avance toute seule, parce qu'aucun des deux
 * services ne dit où il en est et qu'une barre inventée est un mensonge poli.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  attenteDemarrage,
  dureeSansImage,
  etapesAffichees,
  gestesDuChargement,
  habitudeMesuree,
  seuilLong,
  soireeDe,
  STEPS,
  versionDuChargement,
  type Case,
  type Habitude,
  type Step,
} from "../lib/booting";
import type { SauvegardeDuLancement } from "../lib/lancement";
import { CHARGEMENT } from "../lib/mots";
import { ecrireChiffres, poserAfficheur, poserCalquesAttente } from "../retro";
import { useArbitre } from "./Cadre";
import { Etiquette } from "./Etiquette";
import "./chargement.css";

/** La soirée du dernier chargement vu dans ce navigateur (C11). */
const CLE_SOIREE = "nel3ab:chargement-soiree";

/* Le type et la liste vivent avec la fonction qui les CALCULE, pas avec l'écran
   qui les affiche. Deux listes d'étapes finiraient par ne plus être d'accord,
   et c'est précisément ce que cet écran doit garantir: un ordre. */
export type { Step };

/** Le signe de chaque case, dessiné dans sa boîte de 22 px (C4). */
const SIGNE: Record<Case, string> = {
  faite: "✓",
  "en-cours": "",
  "a-venir": "",
  inconnue: "?",
  echec: "✕",
};

/** Les secondes du compteur, sur deux chiffres au moins : une valeur qui
 * garde sa longueur roule chiffre par chiffre (effet « compteur »). */
const secondes = (s: number) => `${String(s).padStart(2, "\u2007")} s`;

export function Booting({
  game,
  sauvegarde = null,
  step,
  stalled = false,
  habitude,
  choisit = false,
  quiChoisit = null,
  onArreter,
  onAutre,
  signaler,
}: {
  game: string;
  /** Combien de temps ce jeu met d'habitude (D05), ou rien avant cinq
   * démarrages réussis. */
  habitude?: Habitude | null;
  /** Sur quelle sauvegarde, et qui l'a lancé (C6). */
  sauvegarde?: SauvegardeDuLancement | null;
  step: Step;
  /** Vrai quand la page a cessé d'attendre: plus rien n'arrivera tout seul. */
  stalled?: boolean;
  /** Cette page choisit le jeu : elle peut arrêter le lancement ou en
   * choisir un autre (C7a). */
  choisit?: boolean;
  /** Le nom de qui choisit le jeu, pour la phrase des autres. */
  quiChoisit?: string | null;
  /** « Arrêter le lancement » : ferme le jeu demandé (C7a). */
  onArreter?: () => void;
  /** « Choisir un autre jeu » : la rubrique Jeux (C7a). */
  onAutre?: () => void;
  /** Le bouton Signaler de la page (K25), posé ici quand l'écran parle :
   * la colonne cache alors le sien. */
  signaler?: ReactNode;
}) {
  /** Depuis combien de secondes on attend.
   *
   * Compté ICI, et pas reçu de la page: quand plus rien n'arrive, la page ne se
   * redessine plus, et c'est EXACTEMENT le cas où cet écran doit proposer une
   * sortie. Remis à zéro quand le jeu demandé change. */
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    setWaited(0);
    const depuis = performance.now();
    const battement = window.setInterval(
      () => setWaited(Math.round((performance.now() - depuis) / 1000)),
      1000,
    );
    return () => window.clearInterval(battement);
  }, [game]);
  const mesuree = habitudeMesuree(habitude);
  const attente = attenteDemarrage(waited, stalled, seuilLong(habitude));
  const perdu = attente !== undefined;

  /* Aïn cherche le jeu (C11), une fois par jeu demandé : en entier au premier
     chargement de la soirée dans ce navigateur, en court ensuite. Puis, une
     fois, l'attente d'un chargement long. Par l'arbitre de la salle (K10) :
     une panne ou une scène plus haute les refuse, et la première image coupe
     le plateau (K06). */
  const arbitre = useArbitre();
  /** Le jeu pour lequel Aïn a déjà cherché : une fois par jeu demandé, même
   * si l'arbitre change d'identité entre deux rendus. */
  const cherche = useRef<string | null>(null);
  useEffect(() => {
    if (!arbitre || cherche.current === game) return;
    cherche.current = game;
    let vu: string | null = null;
    try {
      vu = localStorage.getItem(CLE_SOIREE);
      localStorage.setItem(CLE_SOIREE, soireeDe(new Date()));
    } catch {
      // Sans stockage, chaque chargement est le premier de la soirée.
    }
    arbitre.demander({
      scene: "chercher",
      par: "menus",
      hote: "plateau",
      version: versionDuChargement(vu, new Date()),
    });
  }, [arbitre, game]);
  const longDit = useRef(false);
  useEffect(() => {
    longDit.current = false;
  }, [game]);
  useEffect(() => {
    if (attente !== "long" || longDit.current || !arbitre) return;
    longDit.current = true;
    arbitre.demander({ scene: "attente-chargement", par: "menus", hote: "plateau" });
  }, [attente, arbitre]);

  const cases = etapesAffichees(step, attente);
  const gestes = gestesDuChargement(attente, choisit);

  /* Le compteur de la case en cours, tenu par l'afficheur du socle et non
     par React : ses chiffres roulent au niveau « tout » (effet compteur).
     L'afficheur est posé une fois par case en cours, puis seulement écrit. */
  const compteur = useRef<HTMLSpanElement>(null);
  const valeur = useRef<HTMLElement | null>(null);
  const enCours = cases.indexOf("en-cours");
  useEffect(() => {
    const el = compteur.current;
    valeur.current = el ? poserAfficheur(el, secondes(0)) : null;
  }, [enCours]);
  useEffect(() => {
    if (valeur.current) ecrireChiffres(valeur.current, secondes(waited));
  }, [waited, enCours]);

  /* Le tube autour de la mire (balayage, vignette, roulement) : dans
     l'écran de chargement seulement, sous la plaque du texte. Le socle
     refuse une surface qui touche l'image du jeu. */
  const ecran = useRef<HTMLDivElement>(null);
  useEffect(() => (ecran.current ? poserCalquesAttente(ecran.current) : undefined), []);

  return (
    <div
      id="booting"
      ref={ecran}
      /* SOUS le menu (z 50), dans la zone de l'image. Il a été au-dessus, en
         z 60, pour que le menu n'annonce pas « aucun jeu » pendant un
         démarrage; c'est réglé ailleurs depuis: un démarrage ferme le menu, et
         son pied dit « chargement ». Au-dessus, il cachait le menu que son
         propre bouton ouvrait, et ce menu invisible captait le clavier et la
         manette (audit P2 et E5, 22 novembre 2026). En style et non en classe:
         l'essai lit la couche, et jsdom ne lit pas Tailwind. */
      style={{ zIndex: 40 }}
      className="regie-nuit n3-chargement absolute inset-0 flex flex-col items-center justify-center gap-4 bg-ecran"
      data-attente={attente ?? "normale"}
    >
      {/* La plaque du texte : fond plein, au-dessus du tube. */}
      <div className="n3-charge-plaque">
        {/* Le titre dit le fait, en casse de phrase (C12) : plus de
            sur-titre « chargement » en capitales espacées. */}
        <h2 className="n3-ecran-titre max-w-[70vw] truncate text-center">
          {CHARGEMENT.titre(game)}
        </h2>
        {/* La mire du démarrage : sept barres, fixes ; au niveau « tout »,
            une seule s'allume à la fois, une par seconde (K14). Jamais de
            pourcentage : le salon ne connaît pas l'avancement. */}
        <div className="rt-mire-charge n3-charge-mire" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        {/* Sur quelle sauvegarde on part, et qui l'a lancé (C6). Le choix se
            fait juste avant, puis l'écran devient noir pour une dizaine de
            secondes : sans ce rappel, la seule façon de savoir ce qu'on a
            choisi est d'attendre le jeu et de regarder. */}
        {sauvegarde ? (
          <p className="n3-charge-sauvegarde" data-qui={sauvegarde.qui}>
            {sauvegarde.qui === "autre" ? (
              <>
                <Etiquette nom={sauvegarde.nom} place={sauvegarde.place} />{" "}
              </>
            ) : null}
            {sauvegarde.texte}
          </p>
        ) : null}
        {/* L'habitude, seulement mesurée (D05) : une valeur non mesurée ne
            s'affiche pas comme une mesure. */}
        {mesuree ? (
          <p className="n3-charge-phrase">{CHARGEMENT.habitude(mesuree.mediane_s)}</p>
        ) : null}

        {/* Les trois étapes en cases de pixels (C4) : faite, en cours avec
            son compteur, à venir, inconnue, échec. Une liste ordonnée qui
            ne recule jamais (`etapesAffichees`). */}
        <ol className="n3-charge-etapes">
          {STEPS.map((name, rang) => {
            const etat = cases[rang] ?? "a-venir";
            return (
              <li
                key={name}
                data-case={etat}
                aria-current={etat === "en-cours" ? "step" : undefined}
              >
                <span className="n3-charge-case" aria-hidden="true">
                  {SIGNE[etat]}
                </span>
                <span>
                  {CHARGEMENT.etapes[rang]}
                  <span className="sr-only">, {CHARGEMENT.cases[etat]}</span>
                </span>
                {etat === "en-cours" ? (
                  <span ref={compteur} className="n3-charge-compteur" aria-hidden="true" />
                ) : null}
              </li>
            );
          })}
        </ol>

        {/* La lenteur, puis l'absence d'image. Dix secondes de noir sont
            supportables quand on sait qu'on attend ; soixante sans rien à
            toucher sont indiscernables d'une panne. */}
        {perdu ? (
          <p className="n3-charge-phrase">
            {stalled
              ? CHARGEMENT.aucuneImage(dureeSansImage(waited))
              : mesuree
                ? CHARGEMENT.plusLong
                : CHARGEMENT.encore(waited)}
          </p>
        ) : null}
        {stalled && !choisit ? (
          <p className="n3-charge-phrase">{CHARGEMENT.relancePar(quiChoisit)}</p>
        ) : null}
        {/* Plus de bouton de menu ici (C2, 24 novembre 2026) : « Menu du jeu »
            de la colonne ouvre le menu à côté de cet écran, jamais dessus.
            Les gestes, par rôle (C7a) : qui choisit le jeu arrête le
            lancement, ou en choisit un autre ; tout le monde signale. */}
        {gestes.length > 0 ? (
          <div className="n3-charge-gestes">
            {gestes.map((geste) =>
              geste === "signaler" ? (
                signaler ? (
                  <span key={geste} className="n3-charge-signaler">
                    {signaler}
                  </span>
                ) : null
              ) : (geste === "arreter" ? onArreter : onAutre) ? (
                <button
                  key={geste}
                  type="button"
                  id={geste === "arreter" ? "bootingArreter" : "bootingAutre"}
                  className="rt-boite rt-bouton n3-charge-bouton"
                  onClick={geste === "arreter" ? onArreter : onAutre}
                >
                  <i className="rt-ombre" aria-hidden="true" />
                  {geste === "arreter" ? CHARGEMENT.arreter : CHARGEMENT.autre}
                </button>
              ) : null,
            )}
          </div>
        ) : null}
      </div>

      {/* Le plateau d'Aïn pendant le chargement. Cet écran couvre celui de
          la salle sans jeu : son plateau vient avant dans la page, et
          l'arbitre prend le premier `[data-hote="plateau"]` qu'il trouve.
          La bobine de Bobine y était jusqu'au 24 novembre 2026. */}
      <div className="n3-plateau" data-hote="plateau" aria-hidden="true" style={{ height: 96 }} />
    </div>
  );
}
