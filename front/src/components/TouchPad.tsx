/**
 * La manette à l'écran, pour jouer depuis un téléphone.
 *
 * # Une seule façon de poser les touches, pour toutes les consoles
 *
 * `Pave` mesure sa boîte, demande à `placePad` (lib/faces) un rectangle par
 * pièce, et les pose en position absolue. `TouchPad` (GameCube, Wii) et
 * `SwitchTouchPad` (Switch, Switch 2, Xbox 360) ne diffèrent que par la trame
 * qu'ils écrivent et la face qu'ils montrent.
 *
 * Les versions d'avant le 22 novembre 2026 posaient leurs groupes en CSS, aux
 * coins. Mesuré ce jour-là sur un iPhone tenu droit : START et « cacher »
 * étaient posés sur L, Z et R, si bien que taper R cachait la manette et taper
 * L mettait le jeu en pause. En paysage, le haut de Y tombait sur « cacher ».
 * La première version, le 18 août 2026, se marchait déjà dessus au milieu de
 * l'image. Une position calculée se vérifie sur des centaines de tailles sans
 * navigateur (`faces.test.ts`), et la garde `manette-garde.mjs` vérifie ce
 * que le navigateur en fait.
 *
 * # Ce qu'elle dessine, et pourquoi là
 *
 * Les deux pouces tiennent les coins du bas : le stick à gauche, les quatre
 * boutons à droite, comme sur la console. La croix monte au-dessus du stick,
 * parce qu'elle sert surtout dans les menus. Les gâchettes sont aux coins du
 * haut, là où les index tombent. Un seul geste de la PAGE peut se poser parmi
 * les touches, « La salle », qui ouvre la feuille (`FeuilleSalle`), et
 * seulement quand la barre de la salle manque ; il prend la première place
 * libre à 16 px de toute touche de jeu : un geste de page sous un pouce qui
 * joue fait perdre la partie.
 *
 * Tenue en main, la manette se pose dans la boîte que le cadre lui donne
 * (`lib/cadre`), sous l'image ou dans ses deux grappes, jamais dessus.
 *
 * # Elle ne repasse pas par React
 *
 * Les événements de pointeur écrivent dans le module `media/touch` (ou dans
 * `SwitchInput`), que la boucle d'entrée lit cent fois par seconde. Rien ici ne
 * provoque de rendu en jouant : un rendu par appui remettrait React sur le
 * chemin des commandes. Seul un changement de taille de la boîte rend le pavé.
 *
 * # Les détails qui font la différence entre jouable et pénible
 *
 * - `touch-action: none` partout, sinon un glissement du pouce fait défiler la
 *   page au lieu de pousser le stick ;
 * - la capture du pointeur, pour que le doigt puisse sortir d'une touche sans
 *   que l'appui s'arrête net ;
 * - `pointercancel` et la perte de capture relâchent, parce qu'un appel entrant
 *   annule les pointeurs et laisserait sinon un bouton enfoncé pour toujours ;
 * - l'état pressé d'une touche est du CSS (`:active`), donc il coûte zéro rendu.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ButtonName } from "../media/pad";
import { stickFrom, type Touch } from "../media/touch";
import {
  DOLPHIN_FACE,
  crossFrom,
  placePad,
  type FaceOf,
  type Frame,
  type Geste,
  type Piece,
  type Rect,
  type Touche,
} from "../lib/faces";
import { nomDeLaSalle } from "../lib/feuille";
import { RoomIcon } from "./XmbIcons";
import "./manette-tactile.css";

/** Le rayon du stick GameCube, en pixels d'écran.
 *
 * Lu une fois au montage plutôt que calculé en CSS, parce que la conversion des
 * coordonnées du pointeur en position de stick en a besoin comme d'un nombre. Un
 * pouce a besoin d'au moins 44 pixels de course, et au-delà de 68 le stick
 * demande un geste plus long que le puits dessiné.
 */
function stickRadius(): number {
  const smaller = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(44, Math.min(68, smaller * 0.17));
}

const at = (rect: Rect): React.CSSProperties => ({
  left: rect.x,
  top: rect.y,
  width: rect.w,
  height: rect.h,
});

/** Les quatre directions d'une croix, dans l'ordre où on les lit. */
const DIRECTIONS = ["up", "down", "left", "right"] as const;

/** Une croix d'un seul bloc, lue à l'angle du doigt.
 *
 * Quatre boutons de 28 px laissaient le doigt tomber entre deux branches. Le
 * bloc se vise partout, donne les diagonales, et suit un doigt qui glisse d'une
 * direction à l'autre. Les branches allumées sont écrites dans le style, pas
 * dans un état : c'est du dessin. */
function Croix<K extends string>({
  rect,
  keys,
  press,
  release,
  id,
}: {
  rect: Rect;
  keys: Record<(typeof DIRECTIONS)[number], K>;
  press: (key: K) => void;
  release: (key: K) => void;
  id?: string;
}) {
  const block = useRef<HTMLDivElement>(null);
  const held = useRef(new Set<K>());

  const set = (wanted: Set<K>) => {
    for (const key of held.current) if (!wanted.has(key)) release(key);
    for (const key of wanted) if (!held.current.has(key)) press(key);
    held.current = wanted;
    const el = block.current;
    if (el) for (const way of DIRECTIONS) el.toggleAttribute(`data-${way}`, wanted.has(keys[way]));
  };
  const read = (event: React.PointerEvent) => {
    const box = block.current?.getBoundingClientRect();
    if (!box) return;
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const ways = crossFrom(centre, { x: event.clientX, y: event.clientY }, box.width / 2);
    set(new Set(DIRECTIONS.filter((way) => ways[way]).map((way) => keys[way])));
  };
  const rest = () => set(new Set());
  // Par une référence, comme le puits: l'écoute est posée une fois, et lâche
  // avec les `press` et `release` du dernier rendu.
  const restRef = useRef(rest);
  restRef.current = rest;
  // Un onglet qu'on quitte lâche la croix, et un démontage aussi.
  useEffect(() => {
    const drop = () => restRef.current();
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", drop);
    return () => {
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", drop);
      drop();
    };
  }, []);
  return (
    <div
      ref={block}
      id={id}
      className="n3-pave-croix"
      data-touche="croix"
      role="group"
      aria-label="croix directionnelle"
      style={at(rect)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        read(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0 && event.pointerType === "mouse") return;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId) ?? true) read(event);
      }}
      onPointerUp={rest}
      onPointerCancel={rest}
      onLostPointerCapture={rest}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* Du dessin : le groupe se nomme « croix directionnelle », et un lecteur
          d'écran lisait sinon quatre triangles noirs. */}
      <span data-bras="up" aria-hidden="true">
        ▲
      </span>
      <span data-bras="left" aria-hidden="true">
        ◀
      </span>
      <span data-bras="right" aria-hidden="true">
        ▶
      </span>
      <span data-bras="down" aria-hidden="true">
        ▼
      </span>
    </div>
  );
}

/** Ce qu'un stick fait de la poussée du pouce : la trame qu'il écrit, et sa course. */
export type StickSpec = {
  id: string;
  label: string;
  /** La course du stick, en pixels, pour un puits de cette taille. */
  radius: (box: DOMRect) => number;
  onPush: (x: number, y: number) => void;
  onRest: () => void;
};

/** Le puits d'un stick, poussé au pouce.
 *
 * Par des références et non par un état : la valeur est relue à chaque
 * mouvement du doigt, et rendre la page à chaque pixel ferait ramer ce qu'on
 * essaie de conduire. Le rond qui suit le pouce est écrit directement dans son
 * style. */
function Puits({
  rect,
  side,
  spec: { id, label, radius, onPush, onRest },
}: {
  rect: Rect;
  side: "l" | "r";
  spec: StickSpec;
}) {
  const well = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const rest = () => {
    onRest();
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };
  const restRef = useRef(rest);
  restRef.current = rest;
  // Un onglet qu'on quitte lâche le stick. Sans ça, partir en tenant une
  // direction laisse le personnage courir tout seul.
  useEffect(() => {
    const drop = () => restRef.current();
    window.addEventListener("blur", drop);
    document.addEventListener("visibilitychange", drop);
    return () => {
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", drop);
      drop();
    };
  }, []);
  const move = (event: React.PointerEvent) => {
    const box = well.current?.getBoundingClientRect();
    if (!box) return;
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const reach = radius(box);
    const pushed = stickFrom(centre, { x: event.clientX, y: event.clientY }, reach);
    onPush(pushed.x, pushed.y);
    if (knob.current) {
      // `stickFrom` rend `y` vers le HAUT, comme une manette ; l'écran compte
      // vers le bas, d'où le signe remis pour le dessin.
      const drawn = Math.min(reach, box.width / 2) * 0.5;
      knob.current.style.transform = `translate(${pushed.x * drawn}px, ${-pushed.y * drawn}px)`;
    }
  };
  return (
    <div
      ref={well}
      id={id}
      className="n3-pave-puits"
      data-touche={`stick-${side}`}
      role="group"
      aria-label={label}
      style={at(rect)}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        move(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 0 && event.pointerType === "mouse") return;
        move(event);
      }}
      onPointerUp={rest}
      onPointerCancel={rest}
      onLostPointerCapture={rest}
    >
      <div ref={knob} className="n3-pave-bouton" />
    </div>
  );
}

/** Ce que chaque geste de page affiche, et son identifiant pour les pilotes.
 *
 * Trois jusqu'au 22 novembre 2026 (son, menu, cacher, sous les identifiants
 * `wakeSound`, `showColumn` et `hideTouch`); un seul depuis, le « ••• » qui
 * ouvrait la feuille du bas. Le 23 novembre, il devient « La salle » : l'icône
 * de la salle, le nom dit par `nomDeLaSalle`, et seulement quand la barre de
 * la salle manque (`salleDansLaManette`). */
const GESTE: Record<Geste, { id: string; label: React.ReactNode }> = {
  feuille: {
    id: "laSalleManette",
    label: (
      <span className="n3-salle-icone" aria-hidden="true">
        <RoomIcon className="h-full w-full" />
      </span>
    ),
  },
};

/** La boîte que le cadre donne à la manette (`lib/cadre`) : ses bandes (les
 * grappes en travers et sur les côtés à la souris, rien tenue droite), ses
 * gestes, la règle qui garde chaque pièce dans sa bande, et la tête de la
 * mascotte dans « La salle » (tenue en main, quand la barre manque). Sans
 * elle, la manette se pose par-dessus l'écran : la salle ne le fait plus
 * depuis le 23 novembre 2026, et la garde de `manette-garde` la pose
 * encore ainsi. */
export type BoiteDuCadre = {
  bandes: { left: number; right: number };
  gestes: readonly Geste[];
  dansLesBandes: boolean;
  tete: boolean;
};

/** Le pavé commun : il mesure, place et pose. Les deux manettes le partagent. */
export function Pave<K extends string>({
  face,
  bar,
  press,
  release,
  stickOf,
  idOf,
  soundOff,
  onFeuille,
  id,
  cadre,
  libelleSalle,
}: {
  face: FaceOf<Frame, K>;
  /** La largeur d'une bande noire à côté de l'image, en pixels de la salle. */
  bar: number;
  press: (key: K) => void;
  release: (key: K) => void;
  /** Ce que fait chaque stick du pavé. */
  stickOf: (side: "l" | "r") => StickSpec;
  /** L'identifiant d'une touche, pour les pilotes qui la cherchent. */
  idOf?: (key: K) => string;
  /** Le son ne joue pas: le « ••• » le montre, pour les deux manettes. */
  soundOff: boolean;
  /** Ouvrir la feuille « La salle ». */
  onFeuille: () => void;
  id?: string;
  cadre?: BoiteDuCadre;
  /** Ce que « La salle » dit en plus, parmi les touches : l'emplacement du
   * chantier personnes (« Lina · ta place »). Montré sous l'icône, et dit en
   * tête de son nom accessible. */
  libelleSalle?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  // Ce que les zones sûres retirent à gauche et à droite: la bande se mesure
  // depuis le bord de la salle, les touches depuis le bord de cette boîte.
  const [inset, setInset] = useState({ left: 0, right: 0 });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const outer = el.parentElement?.getBoundingClientRect();
      // jsdom ne mesure rien : la fenêtre sert alors de boîte.
      if (r.width > 0 && r.height > 0)
        setSize((was) =>
          was.width === r.width && was.height === r.height
            ? was
            : { width: r.width, height: r.height },
        );
      if (outer && outer.width > 0) {
        const left = Math.max(0, r.left - outer.left);
        const right = Math.max(0, outer.right - r.right);
        setInset((was) => (was.left === left && was.right === right ? was : { left, right }));
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const pose = useMemo(
    () =>
      cadre
        ? placePad(face, size, cadre.bandes, cadre.gestes, cadre.dansLesBandes)
        : placePad(face, size, {
            left: Math.max(0, bar - inset.left),
            right: Math.max(0, bar - inset.right),
          }),
    [face, size, bar, inset, cadre],
  );

  const key = (touche: Touche<K>, rect: Rect) => (
    <button
      key={touche.key}
      type="button"
      id={idOf?.(touche.key)}
      className="n3-pave-touche"
      data-touche={touche.key}
      data-forme={touche.forme}
      data-long={touche.forme === "rond" && touche.label.length > 3 ? "" : undefined}
      data-teinte={touche.teinte}
      data-encre={touche.ink === undefined ? undefined : ""}
      aria-label={touche.spoken}
      // La couleur de la lettre passe par une variable : la feuille la pose sur
      // un fond sombre fixe, lisible dans tous les thèmes. Écrite en `color`,
      // elle tombait à 1,05:1 sur le fond clair du thème instrument clair.
      style={{ ...at(rect), ...(touche.ink ? { "--lettre": touche.ink } : {}) }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        press(touche.key);
      }}
      onPointerUp={() => release(touche.key)}
      onPointerCancel={() => release(touche.key)}
      onLostPointerCapture={() => release(touche.key)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {touche.label}
    </button>
  );

  const draw = (piece: Piece<K>) => {
    switch (piece.kind) {
      case "touche":
        return key(piece.touche, piece.rect);
      case "croix":
        return (
          <Croix
            key="croix"
            id={idOf ? "touch-croix" : undefined}
            rect={piece.rect}
            keys={piece.groupe}
            press={press}
            release={release}
          />
        );
      case "stick":
        return (
          <Puits
            key={`stick-${piece.side}`}
            side={piece.side}
            rect={piece.rect}
            spec={stickOf(piece.side)}
          />
        );
      case "geste": {
        const said = GESTE[piece.geste];
        return (
          <button
            key={piece.geste}
            type="button"
            id={said.id}
            className="n3-pave-geste"
            data-geste={piece.geste}
            data-alerte={soundOff ? "" : undefined}
            data-tete={cadre?.tete ? "" : undefined}
            // Le nom dit le son coupé: la pastille rouge seule ne se lit pas
            // à voix haute, et ne se distingue pas sans les couleurs.
            aria-label={nomDeLaSalle(soundOff, libelleSalle)}
            aria-haspopup="dialog"
            style={at(piece.rect)}
            // Un clic de souris n'enlève pas le clavier au jeu: le focus pris
            // ici faisait monter l'avis « le jeu ne reçoit plus tes touches »
            // sous le pointeur, entre l'appui et le relâché, et le clic tombait
            // sur l'avis (manette « toujours » sur un grand écran, relecture du
            // 22 novembre 2026). Le dialogue rend ensuite le focus au jeu.
            onMouseDown={(event) => event.preventDefault()}
            onClick={onFeuille}
          >
            {/* Tenue en main, « La salle » n'est parmi les touches que
                quand la barre manque : la tête de la mascotte y passe
                (`ouEstLaMascotte` rend « barre »). Sans cet hôte, les scènes
                de la salle ne jouaient nulle part (relecture du
                23 novembre 2026). */}
            {cadre?.tete ? (
              <span className="n3-salle-tete" data-hote="barre" aria-hidden="true" />
            ) : null}
            {said.label}
            {libelleSalle ? <span className="n3-pave-geste-libelle">{libelleSalle}</span> : null}
          </button>
        );
      }
    }
  };

  return (
    <div
      ref={root}
      id={id}
      className={cadre ? "n3-pave n3-pave-cadre" : "n3-pave"}
      // Ni ▶ du socle ni anneau de menu sur une touche de jeu.
      data-sans-curseur=""
      role="group"
      aria-label={face.title}
      // Une pose qui n'a pas tout tenu le dit, pour les pilotes et les outils
      // du navigateur : la manette s'affiche quand même.
      data-degradee={pose.degraded ?? undefined}
    >
      {pose.pieces.map(draw)}
    </div>
  );
}

/** La manette de la trame Dolphin: GameCube, et Wii par ses correspondances. */
export function TouchPad({
  bar,
  touch,
  soundOff,
  onFeuille,
  cadre,
  libelleSalle,
}: {
  /** La largeur d'une bande noire à côté de l'image, en pixels.
   *
   * Une image 4:3 sur un téléphone tenu en travers en laisse deux, larges de
   * cent cinquante pixels environ. Y ranger les touches change tout: elles
   * cessent d'être posées sur les pieds du personnage. Zéro quand l'image
   * remplit la largeur, et alors on retombe sur les coins. */
  bar: number;
  touch: Touch;
  /** Vrai quand le navigateur ne joue toujours rien.
   *
   * Montré plutôt que deviné: sur un iPhone, le son peut rester coupé pour deux
   * raisons qu'aucun code ne distingue : un geste que le navigateur n'a pas
   * accepté, ou le petit interrupteur sur le côté du téléphone. */
  soundOff: boolean;
  /** Ouvrir la feuille du bas: le son, le menu du jeu, la salle, cacher la
   * manette, le plein écran, signaler. Le tapotement sur « ••• » est lui-même un
   * geste, donc il rallume aussi un son coupé (`media/reveil-son`). */
  onFeuille: () => void;
  /** La boîte du cadre, quand la salle est tenue en main. */
  cadre?: BoiteDuCadre;
  /** Ce que « La salle » dit en plus (`Pave`). */
  libelleSalle?: string;
}) {
  const radius = useRef(stickRadius());

  // Un onglet qu'on quitte lâche tout. Sans ça, passer sur une autre
  // application en tenant A laisse le personnage courir.
  useEffect(() => {
    const drop = () => touch.releaseAll();
    const resize = () => {
      radius.current = stickRadius();
    };
    document.addEventListener("visibilitychange", drop);
    window.addEventListener("blur", drop);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("visibilitychange", drop);
      window.removeEventListener("blur", drop);
      window.removeEventListener("resize", resize);
      drop();
    };
  }, [touch]);

  return (
    <Pave<ButtonName>
      id="touchpad"
      face={DOLPHIN_FACE}
      bar={bar}
      press={(key) => touch.press(key)}
      release={(key) => touch.release(key)}
      idOf={(key) => `touch-${key}`}
      soundOff={soundOff}
      onFeuille={onFeuille}
      cadre={cadre}
      libelleSalle={libelleSalle}
      stickOf={() => ({
        id: "touchStick",
        label: "stick",
        radius: () => radius.current,
        onPush: (x, y) => touch.push(x, y),
        onRest: () => touch.push(0, 0),
      })}
    />
  );
}
