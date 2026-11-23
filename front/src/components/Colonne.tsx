/**
 * La colonne de la salle au bureau, qui remplace `Sidebar` (23 novembre 2026).
 *
 * De haut en bas : l'en-tête (Salle N et Quitter), le bloc d'état (le chantier
 * etats), le bloc de rôle (`#seat`), ce que le chantier personnes pose (qui
 * choisit le jeu, Ils regardent, Inviter), le panneau de commande quand il
 * n'a pas de place sous l'image, les rangs de `lib/colonne`, et le coin.
 *
 * Avant, la colonne avait deux onglets, « essentiel » et « mesures », et
 * montrait tout tout le temps. Les onglets sont partis : les mesures s'ouvrent
 * depuis la ligne du coin, et un rang qui ne sert à rien disparaît au lieu
 * d'être grisé (`rangsDeLaColonne`).
 *
 * La colonne défile en elle-même. Deux règles la gardent lisible au clavier :
 * une marge de défilement de 60 px en bas, pour qu'un rang focalisé ne passe
 * pas sous « Plus bas », et « Plus bas » lui-même, qui dit qu'une suite est
 * cachée tant que le bas n'est pas visible (focus.mjs, colonne-deborde).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Person } from "../client";
import type { Appareil } from "../lib/appareil";
import { cn } from "../lib/cn";
import type { Rang } from "../lib/colonne";
import { COLONNE, SORTIES, TOUCHES, placeN, prendreLaPlace } from "../lib/mots";
import { activerCurseur, type Curseur } from "../retro/curseur";
import { iconePixelSVG, type IconePixel } from "../retro/icones";
import { Crown } from "./Crown";
import { Touche } from "./Reperes";
import { Volume } from "./Settings";

/** La marge de défilement du bas : plus haute que « Plus bas » (40 px). */
export const MARGE_BAS = 60;

/** Une icône en pixels du socle ; elle ne se montre qu'avec l'effet « icones ». */
export function IconeRang({ nom }: { nom: IconePixel }) {
  return (
    <span
      className="n3-rang-icone"
      aria-hidden="true"
      // Le dessin vient de `retro/icones`, une table du dépôt : aucune
      // donnée de la salle n'y passe.
      dangerouslySetInnerHTML={{ __html: iconePixelSVG(nom) }}
    />
  );
}

/** Un titre de section : Pixelify Sans, casse de phrase, sans interlettrage. */
export function TitreColonne({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="n3-colonne-titre">
      {children}
    </h2>
  );
}

export function Colonne({
  nomSalle,
  jeu,
  ancre = false,
  onQuitter,
  largeur,
  forme = "a-cote",
  margeHaut,
  avis,
  etat,
  role,
  personnes,
  panneau,
  rangs,
  contenus,
  vue,
  coin,
}: {
  nomSalle: string;
  jeu: string | null;
  /** L'en-tête porte l'ancre de l'annonce (`ANCRE_ANNONCE`) : au bureau,
   * quand le fronton ne la porte pas. */
  ancre?: boolean;
  onQuitter: () => void;
  /** La largeur choisie au bureau ; `null` sous l'image ou dans la feuille. */
  largeur: number | null;
  /** À côté de l'image (bureau), dessous (fenêtre étroite à la souris), ou
   * dans la feuille agrandie d'une salle tenue en main, qui porte son propre
   * en-tête et « Fermer » (`FeuilleSalle`). */
  forme?: "a-cote" | "dessous" | "feuille";
  /** La hauteur de la pile des avis collée en tête, pour la marge du haut. */
  margeHaut?: number;
  /** La pile des avis quand elle vit en tête de la colonne (`lieuDesAvis`). */
  avis?: ReactNode;
  /** Le bloc d'état, que le chantier etats remplit. */
  etat?: ReactNode;
  /** Le bloc de rôle (`BlocRole`). */
  role: ReactNode;
  /** Qui choisit le jeu, Ils regardent, Inviter : le chantier personnes. */
  personnes?: ReactNode;
  /** Le panneau de commande, quand l'image n'a pas de place pour lui. */
  panneau?: ReactNode;
  rangs: readonly Rang[];
  contenus: Partial<Record<Rang, ReactNode>>;
  /** Les mesures ouvertes depuis le coin, ou la vue des touches
   * (`VueTouches`) : elles prennent la place des rangs. */
  vue: ReactNode | null;
  coin: ReactNode;
}) {
  const [boite, setBoite] = useState<HTMLElement | null>(null);
  const suite = useSuiteCachee(boite);
  // Le ▶ du socle devant le rang visé, au clavier comme à la souris. La
  // colonne ne contient jamais l'image : `activerCurseur` refuserait.
  const [curseur, setCurseur] = useState<Curseur | null>(null);
  useEffect(() => {
    if (!boite) return;
    const actif = activerCurseur(boite);
    setCurseur(actif);
    // Caché, le ▶ n'a pas de taille : sa première pose le met 10 px trop à
    // droite, sur sa cible. Il se repose à l'image suivante, visible.
    const reposer = () =>
      requestAnimationFrame(() => {
        const ici = document.activeElement;
        if (ici && ici !== boite && boite.contains(ici)) actif.placer(ici);
      });
    boite.addEventListener("focusin", reposer);
    return () => {
      boite.removeEventListener("focusin", reposer);
      actif.arreter();
    };
  }, [boite]);
  // Le ▶ se pose au focus, puis ne bouge plus : l'avis du clavier qui naît
  // du même focus pousse la colonne de 97 px, et le ▶ restait devant le
  // vide (vu par focus.mjs, anneau, 23 novembre 2026). Après chaque rendu
  // de la colonne, il se repose devant ce qui a le focus.
  useLayoutEffect(() => {
    const ici = document.activeElement;
    if (curseur && boite && ici && ici !== boite && boite.contains(ici)) curseur.placer(ici);
  });
  return (
    <aside
      id="side"
      ref={setBoite}
      aria-label={nomSalle}
      style={{
        ...(largeur === null ? {} : { width: largeur, maxWidth: "50vw" }),
        scrollPaddingTop: margeHaut ? margeHaut + 16 : undefined,
        scrollPaddingBottom: MARGE_BAS,
      }}
      className={cn(
        "n3-colonne relative flex flex-col gap-3 overflow-y-auto bg-panel",
        forme === "a-cote" && "shrink-0 border-l border-rule px-3 pt-3",
        forme === "dessous" && "min-h-0 flex-1 border-t border-rule px-3 pt-3",
      )}
    >
      {/* En tête quand aucune bande noire ne tient la pile (`lieuDesAvis`),
          collée en haut de ce qui se voit : une tête qui défilait avec la
          colonne laissait l'avis hors de vue (focus.mjs, avis-haut). */}
      {avis ? (
        <div className="sticky top-0 z-30 -mx-3 bg-panel px-3 pb-2 empty:hidden">{avis}</div>
      ) : null}
      <header className="n3-colonne-tete">
        <div className="flex items-center justify-between gap-2">
          <h1 className="n3-colonne-salle truncate">{nomSalle}</h1>
          <button
            type="button"
            id="leaveRoom"
            onClick={onQuitter}
            className="n3-rang-lien flex shrink-0 items-center gap-1.5"
          >
            <IconeRang nom="quitter" />
            {SORTIES.quitter}
          </button>
        </div>
        {jeu ? <p className="truncate text-corps text-muted">{jeu}</p> : null}
        {ancre ? <span data-ancre="annonce" /> : null}
      </header>
      {etat}
      {role}
      {personnes}
      {panneau}
      {vue ?? (
        <nav aria-label={COLONNE.rangs} className="flex flex-col gap-2">
          {rangs.map((rang) =>
            contenus[rang] ? (
              <div key={rang} data-rang={rang} className="flex">
                {contenus[rang]}
              </div>
            ) : null,
          )}
        </nav>
      )}
      <div className="mt-auto">{coin}</div>
      {suite ? (
        // Un repère et pas une commande : hors de la tabulation (Tab descend
        // déjà rang par rang) et sans prise au doigt, pour ne recouvrir aucune
        // cible de la colonne (salle-telephone.mjs, « recouvre plusBas »).
        <div id="plusBas" aria-hidden="true" className="n3-plus-bas">
          <IconeRang nom="chevron" />
          {COLONNE.plusBas}
        </div>
      ) : null}
    </aside>
  );
}

/** Vrai tant que le bas de la boîte n'est pas visible. */
function useSuiteCachee(boite: HTMLElement | null): boolean {
  const [suite, setSuite] = useState(false);
  const raf = useRef(0);
  useEffect(() => {
    if (!boite) return;
    const lire = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() =>
        setSuite(boite.scrollTop + boite.clientHeight < boite.scrollHeight - 2),
      );
    };
    lire();
    boite.addEventListener("scroll", lire, { passive: true });
    const taille = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(lire);
    taille?.observe(boite);
    for (const enfant of boite.children) taille?.observe(enfant);
    const ajouts = typeof MutationObserver === "undefined" ? null : new MutationObserver(lire);
    ajouts?.observe(boite, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(raf.current);
      boite.removeEventListener("scroll", lire);
      taille?.disconnect();
      ajouts?.disconnect();
    };
  }, [boite]);
  return suite;
}

/** Le bloc de rôle : qui tu es, et ce que tu tiens. Lu par les pilotes
 * (`#seat`, parcours.mjs). Un spectateur y trouve « Prendre une place ». */
export function BlocRole({
  nom,
  place,
  libre,
  onPrendre,
}: {
  nom: string;
  /** La place tenue, ou `null` pour qui regarde. */
  place: number | null;
  /** La première place libre, celle qu'un spectateur prendra ; `null` quand
   * la salle est pleine. */
  libre: number | null;
  /** Prendre la première place libre ; absent dans une salle fermée. */
  onPrendre?: () => void;
}) {
  return (
    <section className="n3-bloc-role flex flex-col gap-2" aria-label={COLONNE.role}>
      <p id="seat" className="text-corps text-muted">
        <span className="text-text">{nom}</span>
        {place === null ? " · tu regardes" : ` · ${placeN(place)}`}
      </p>
      {/* « Prendre la place 4 », et pas « une place » : le spectateur sait
          laquelle il aura. Le geste reste poli (`play`, la première libre,
          sans déloger personne) : si quelqu'un la prend juste avant, le worker
          en donne une autre plutôt que de la lui reprendre. */}
      {place === null && libre !== null && onPrendre ? (
        <button
          type="button"
          id="takePad"
          data-rend-le-jeu=""
          onClick={onPrendre}
          className="rt-boite rt-bouton rt-bouton-plein n3-rang-bouton"
        >
          <i className="rt-ombre" aria-hidden="true" />
          <IconeRang nom="manette" />
          {prendreLaPlace(libre)}
        </button>
      ) : null}
    </section>
  );
}

/** « Ils regardent » : les spectateurs, et les places à confirmer. */
export function IlsRegardent({ people, owner }: { people: Person[]; owner?: Person | null }) {
  const regardent = people.filter((p) => p.seat == null && p.seat_pending === false);
  const attente = people.filter((p) => p.seat == null && p.seat_pending !== false);
  const chef = (p: Person) => (owner?.id && owner.id === p.id ? <Crown /> : null);
  return (
    <section aria-labelledby="ilsRegardent" className="flex flex-col gap-1.5">
      <TitreColonne id="ilsRegardent">
        {COLONNE.regardent} · {regardent.length}
      </TitreColonne>
      {regardent.length ? (
        regardent.map((p) => (
          <p key={p.id ?? p.name} className="flex items-center gap-2 text-corps text-muted">
            <span className="truncate">{p.name}</span>
            {chef(p)}
          </p>
        ))
      ) : (
        <p className="text-corps text-faint">{COLONNE.personne}</p>
      )}
      {attente.length ? (
        <div aria-label="attributions en attente" className="text-corps text-muted">
          {attente.map((p) => (
            <p key={p.id ?? p.name}>
              {p.name} {chef(p)}
              {" · place à confirmer"}
            </p>
          ))}
          <p>Si tu joues déjà, recharge la page pour retrouver ton nom.</p>
        </div>
      ) : null}
    </section>
  );
}

/** Le rang Son : le curseur quand le son joue, sinon le bouton qui l'allume. */
export function RangSon({
  joue,
  volume,
  onVolume,
  onActiver,
}: {
  joue: boolean;
  volume: number;
  onVolume: (v: number) => void;
  onActiver: () => void;
}) {
  return joue ? (
    <div className="flex w-full items-center gap-2">
      <IconeRang nom="son" />
      <div className="min-w-0 flex-1">
        <Volume value={volume} onChange={onVolume} />
      </div>
    </div>
  ) : (
    <button type="button" id="sound" onClick={onActiver} className="n3-rang">
      <IconeRang nom="son" />
      {COLONNE.activerSon}
    </button>
  );
}

/** Le rang Menu du jeu, et Échap au clavier. */
export function RangMenu({ appareil, onMenu }: { appareil: Appareil; onMenu: () => void }) {
  return (
    <button type="button" id="openMenu" onClick={onMenu} className="n3-rang">
      <IconeRang nom="curseurs" />
      <span className="flex-1">{COLONNE.menu}</span>
      {appareil === "clavier" ? <Touche>Échap</Touche> : null}
    </button>
  );
}

/** Le rang Agrandir l'image : Ctrl fait la même chose. */
export function RangAgrandir({
  appareil,
  onAgrandir,
}: {
  appareil: Appareil;
  onAgrandir: () => void;
}) {
  return (
    <button
      type="button"
      id="agrandir"
      data-rend-le-jeu=""
      onClick={onAgrandir}
      className="n3-rang"
    >
      <IconeRang nom="chevron" />
      <span className="flex-1">{COLONNE.agrandir}</span>
      {appareil === "clavier" ? <Touche>Ctrl</Touche> : null}
    </button>
  );
}

/** Le rang Tes touches au clavier : il ouvre la vue des touches. */
export function RangTouches({ onOuvrir }: { onOuvrir: () => void }) {
  return (
    <button type="button" id="tesTouches" onClick={onOuvrir} className="n3-rang">
      <IconeRang nom="clavier" />
      {TOUCHES.clavier}
    </button>
  );
}

/** Le rang Ta manette : il ouvre la vue de vérification de la manette
 * tenue, avec « à configurer » quand elle n'a ni disposition standard ni
 * profil (`manetteAConfigurer`). */
export function RangManette({
  nom,
  aConfigurer,
  onOuvrir,
}: {
  /** « manette Xbox », lu dans `media/families`. */
  nom: string;
  aConfigurer: boolean;
  onOuvrir: () => void;
}) {
  return (
    <button type="button" id="taManette" onClick={onOuvrir} className="n3-rang">
      <IconeRang nom="manette" />
      <span className="min-w-0 flex-1 truncate">{TOUCHES.manette(nom)}</span>
      {aConfigurer ? <span className="shrink-0 text-alerte">{TOUCHES.aConfigurer}</span> : null}
    </button>
  );
}

/** Autres réglages : ce qu'on cherche rarement, replié par défaut. */
export function AutresReglages({ children }: { children: ReactNode }) {
  return (
    <details id="autresReglages" className="n3-autres w-full">
      <summary className="n3-rang">
        <IconeRang nom="curseurs" />
        {COLONNE.autres}
      </summary>
      <div className="flex flex-col gap-2 pt-2">{children}</div>
    </details>
  );
}
