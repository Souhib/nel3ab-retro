/**
 * La racine de la salle, qui porte le cadre.
 *
 * Elle écrit l'état et la géométrie de `lib/cadre` en attributs (`data-mode`,
 * `data-etat`, `data-role`, `data-panneau`, `data-sans-image`,
 * `data-agrandie`) et en variables CSS (`--cadre-<nom>-gauche`, `-haut`,
 * `-largeur`, `-hauteur`). Les feuilles de chaque chantier les lisent au lieu
 * de recalculer : une seule source pour « où est l'image ».
 *
 * Rien de tout cela n'est sur le chemin d'image. La géométrie change sur un
 * redimensionnement, une taille d'image (l'instantané, deux fois par seconde
 * au plus), un réglage ou un état ; jamais à chaque image peinte.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  SANS_ZONES,
  attributsDuCadre,
  miseEnPage,
  ouEstLaMascotte,
  premiereImage,
  variablesDuCadre,
  type Entree,
  type Geometrie,
  type Rect,
  type ZonesSures,
} from "../lib/cadre";
import type { Size } from "../lib/fit";
import { creerArbitre, type Arbitre } from "../lib/scenes-salle";
import "./cadre.css";

/** L'arbitre des scènes de cette salle (K10), pour les chantiers qui jouent
 * une scène de la mascotte dans le cadre. `null` hors d'un `Cadre`. */
export const ContexteArbitre = createContext<Arbitre | null>(null);
export const useArbitre = (): Arbitre | null => useContext(ContexteArbitre);

export function Cadre({
  geo,
  className,
  children,
}: {
  geo: Geometrie;
  className?: string;
  children: ReactNode;
}) {
  const racine = useRef<HTMLDivElement>(null);
  const etat = useRef(geo.etat);
  useEffect(() => {
    etat.current = geo.etat;
  }, [geo.etat]);
  /* Un arbitre par salle, créé une fois : il trouve ses hôtes dans la racine
     (`data-hote`), et lit l'état du cadre à chaque demande. */
  const [arbitre] = useState(() =>
    creerArbitre({
      hote: (hote) => racine.current?.querySelector<HTMLElement>(`[data-hote="${hote}"]`) ?? null,
      etat: () => etat.current,
    }),
  );
  /* K06 : la première image, un seul appelant. Au passage d'un état sans
     image à « vit », le plateau est coupé et la scène « premiere-image »
     joue là où la mascotte vit maintenant (le coin au bureau, la barre au
     téléphone). Le retour à « vit » après une image figée ne joue rien :
     « figee » a une image. */
  const avant = useRef(geo.etat);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  useEffect(() => {
    const precedent = avant.current;
    avant.current = geo.etat;
    if (!premiereImage(precedent, geo.etat)) return;
    arbitre.couper("plateau");
    const hote = ouEstLaMascotte(geoRef.current, "premiere-image");
    if (hote) arbitre.demander({ scene: "premiere-image", par: "salle", hote });
  }, [geo.etat, arbitre]);
  return (
    <div
      ref={racine}
      data-cadre=""
      className={className}
      style={variablesDuCadre(geo) as CSSProperties}
      {...attributsDuCadre(geo)}
    >
      <ContexteArbitre.Provider value={arbitre}>{children}</ContexteArbitre.Provider>
    </div>
  );
}

/** La géométrie, recalculée seulement quand une de ses entrées change. */
export function useGeometrie(e: Entree): Geometrie {
  const { fenetre, zonesSures, image } = e;
  return useMemo(
    () => miseEnPage(e),
    // Les champs un par un, et pas `e` : la salle construit un objet neuf à
    // chaque rendu, qui recalculerait la géométrie à chaque instantané. Le
    // prix de cette liste : un champ ajouté à `Entree` doit l'être ici aussi,
    // sinon sa valeur reste celle du dernier calcul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      e.mode,
      fenetre.width,
      fenetre.height,
      zonesSures.haut,
      zonesSures.droite,
      zonesSures.bas,
      zonesSures.gauche,
      image.width,
      image.height,
      e.ajustement,
      e.etat,
      e.role,
      e.manette,
      e.largeurColonne,
      e.largeurPanneau,
      e.agrandie,
    ],
  );
}

const lireFenetre = (): Size =>
  typeof window === "undefined"
    ? { width: 0, height: 0 }
    : { width: window.innerWidth, height: window.innerHeight };

/** La taille de la fenêtre, suivie. */
export function useFenetre(): Size {
  const [taille, poser] = useState(lireFenetre);
  useEffect(() => {
    const suivre = () =>
      poser((avant) => {
        const apres = lireFenetre();
        return avant.width === apres.width && avant.height === apres.height ? avant : apres;
      });
    window.addEventListener("resize", suivre);
    window.addEventListener("orientationchange", suivre);
    return () => {
      window.removeEventListener("resize", suivre);
      window.removeEventListener("orientationchange", suivre);
    };
  }, []);
  return taille;
}

/**
 * Les zones sûres en pixels, lues sur un témoin.
 *
 * `env(safe-area-inset-*)` n'existe qu'en CSS : un témoin invisible prend les
 * jetons `--zone-*` d'`index.css` (ADR D35) en marge intérieure, et la page lit
 * ce que le navigateur en a fait. Relu à chaque redimensionnement : tourner
 * un téléphone déplace l'encoche.
 */
export function useZonesSures(fenetre: Size): ZonesSures {
  const [zones, poser] = useState<ZonesSures>(SANS_ZONES);
  useEffect(() => {
    const temoin = document.createElement("div");
    temoin.setAttribute("aria-hidden", "true");
    Object.assign(temoin.style, {
      position: "fixed",
      visibility: "hidden",
      pointerEvents: "none",
      padding:
        "var(--zone-haut, 0px) var(--zone-droite, 0px) var(--zone-bas, 0px) var(--zone-gauche, 0px)",
    });
    document.body.append(temoin);
    const style = getComputedStyle(temoin);
    const px = (valeur: string) => Math.max(0, Math.round(Number.parseFloat(valeur) || 0));
    const lues = {
      haut: px(style.paddingTop),
      droite: px(style.paddingRight),
      bas: px(style.paddingBottom),
      gauche: px(style.paddingLeft),
    };
    temoin.remove();
    poser((avant) =>
      avant.haut === lues.haut &&
      avant.droite === lues.droite &&
      avant.bas === lues.bas &&
      avant.gauche === lues.gauche
        ? avant
        : lues,
    );
  }, [fenetre.width, fenetre.height]);
  return zones;
}

/**
 * La hauteur d'un élément, suivie : la pile des avis la donne à `lieuDesAvis`,
 * qui ne la pose dans une bande noire que si elle y tient entière.
 */
export function useHauteur(element: HTMLElement | null): number {
  const [hauteur, poser] = useState(0);
  useEffect(() => {
    if (!element) {
      poser(0);
      return;
    }
    const lire = () => poser(Math.ceil(element.getBoundingClientRect().height));
    lire();
    if (typeof ResizeObserver === "undefined") return;
    const suivi = new ResizeObserver(lire);
    suivi.observe(element);
    return () => suivi.disconnect();
  }, [element]);
  return hauteur;
}

/**
 * Une valeur qui ne change pas pendant un clic.
 *
 * L'avis « le jeu ne reçoit plus tes touches » naît du clic même qui quitte
 * l'image : le bouton pressé prend le focus, l'avis apparaît en tête de la
 * colonne, pousse tout vers le bas, et le relâchement tombait sur le bouton
 * d'à côté (`clic-colonne` de focus.mjs, `place-suit-adresse` de
 * parcours.mjs, 23 novembre 2026). La valeur rendue reste donc celle d'avant
 * tant qu'un pointeur est enfoncé, et suit après le clic, une fois son
 * gestionnaire passé. Au clavier, rien n'est retenu.
 */
export function useApresLeClic<T>(valeur: T): T {
  const [tenue, poser] = useState(valeur);
  const enfonce = useRef(false);
  const derniere = useRef(valeur);
  derniere.current = valeur;
  useEffect(() => {
    let minuteur = 0;
    const descend = () => {
      enfonce.current = true;
    };
    // Après le clic : `click` part juste après `pointerup`, dans la même
    // tâche ; un minuteur à zéro passe derrière lui.
    const remonte = () => {
      window.clearTimeout(minuteur);
      minuteur = window.setTimeout(() => {
        enfonce.current = false;
        poser(derniere.current);
      }, 0);
    };
    window.addEventListener("pointerdown", descend, true);
    window.addEventListener("pointerup", remonte, true);
    window.addEventListener("pointercancel", remonte, true);
    return () => {
      window.clearTimeout(minuteur);
      window.removeEventListener("pointerdown", descend, true);
      window.removeEventListener("pointerup", remonte, true);
      window.removeEventListener("pointercancel", remonte, true);
    };
  }, []);
  useEffect(() => {
    if (!enfonce.current) poser(valeur);
  }, [valeur]);
  return tenue;
}

/** Un rectangle du cadre en position absolue : les coordonnées de la
 * fenêtre, que la racine de la salle partage quand elle est tenue en main. */
export const placeDe = (r: Rect): CSSProperties => ({
  position: "absolute",
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});
