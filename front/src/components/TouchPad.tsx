/**
 * La manette à l'écran, pour jouer depuis un téléphone.
 *
 * # La première version se marchait dessus
 *
 * Elle plaçait ses groupes à des distances FIXES du bord: la croix à 176 pixels
 * de la gauche, les quatre boutons à 32 de la droite. Sur un ordinateur ça
 * tenait; sur un vrai téléphone tenu en travers, vu le 18 août 2026, la zone de
 * jeu ne faisait que quelques centaines de pixels et les deux groupes se
 * recouvraient au milieu de l'image, par-dessus le texte du jeu.
 *
 * Tout est donc dimensionné en `vmin` maintenant, avec des bornes: un bouton ne
 * descend jamais sous 34 pixels — la taille d'un doigt — et ne dépasse jamais 56,
 * où il deviendrait une cible pour la souris. Les groupes sont ancrés aux QUATRE
 * COINS, et le milieu reste libre parce que c'est là qu'est le jeu.
 *
 * # Ce qu'elle dessine, et pourquoi là
 *
 * Les deux pouces tiennent les coins du bas: le stick à gauche, les quatre
 * boutons à droite, comme sur la console. La croix directionnelle monte à gauche
 * au-dessus du stick, parce qu'elle ne sert presque jamais en jeu et souvent
 * dans les menus, et que le pouce gauche atteint les deux. Les gâchettes sont
 * aux coins du haut, là où les index tombent.
 *
 * # Elle ne repasse pas par React
 *
 * Les événements de pointeur écrivent dans le module `media/touch`, que la
 * boucle d'entrée lit cent fois par seconde. Rien ici ne provoque de rendu en
 * jouant: un rendu par appui ferait exactement ce que ce projet interdit depuis
 * le début, remettre React sur le chemin des commandes.
 *
 * # Les détails qui font la différence entre jouable et pénible
 *
 * - `touch-action: none` partout, sinon un glissement du pouce fait défiler la
 *   page au lieu de pousser le stick;
 * - la capture du pointeur sur le stick, pour que le doigt puisse sortir du
 *   cercle sans que le mouvement s'arrête net;
 * - `pointercancel` relâche, parce qu'un appel entrant ou une notification
 *   annule les pointeurs et laisserait sinon un bouton enfoncé pour toujours;
 * - aucun retour visuel calculé en JavaScript: l'état pressé est du CSS
 *   (`:active`), donc il coûte zéro rendu.
 */
import { useEffect, useRef } from "react";
import type { ButtonName } from "../media/pad";
import { clusterKeys, stickFrom, type Touch } from "../media/touch";

/** Le rayon du stick, en pixels d'écran.
 *
 * Lu une fois au montage plutôt que calculé en CSS, parce que la conversion des
 * coordonnées du pointeur en position de stick en a besoin comme d'un nombre. Le
 * `clamp` reproduit ce que ferait la feuille de style: un pouce a besoin d'au
 * moins 44 pixels de course, et au-delà de 68 le stick mange l'image.
 */
function stickRadius(): number {
  const smaller = Math.min(window.innerWidth, window.innerHeight);
  return Math.max(44, Math.min(68, smaller * 0.17));
}

export function TouchPad({
  bar,
  touch,
  soundOff,
  onSound,
  onLeave,
  onMenu,
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
   * raisons qu'aucun code ne distingue — un geste que le navigateur n'a pas
   * accepté, ou le petit interrupteur sur le côté du téléphone. Dire « il n'y a
   * pas de son » laisse au moins chercher du bon côté. */
  soundOff: boolean;
  /** Rallumer le son. Le tapotement est lui-même le geste que le navigateur
   * attend, donc c'est le chemin le plus court qui existe. */
  onSound: () => void;
  /** Cacher la manette. */
  onLeave: () => void;
  /** Ouvrir le menu du jeu.
   *
   * Le MENU et non la colonne, et la nuance compte. Le bouton qui ouvre le menu
   * vit dans la colonne, la colonne est repliée d'office sur un téléphone, et le
   * menu s'ouvre sinon par Échap: il était donc simplement inatteignable. Or
   * c'est lui qui porte tout, y compris de quoi déplier la colonne.
   *
   * Trouvé en écrivant le pilote, qui cherchait un bouton qui n'existait pas. */
  onMenu: () => void;
}) {
  const knob = useRef<HTMLDivElement>(null);
  const well = useRef<HTMLDivElement>(null);
  const radius = useRef(stickRadius());

  // Un onglet qu'on quitte lâche tout. Sans ça, passer sur une autre
  // application en tenant une direction laisse le personnage courir.
  useEffect(() => {
    const drop = () => {
      touch.releaseAll();
      if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
    };
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

  const hold = (button: ButtonName) => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      touch.press(button);
    },
    onPointerUp: () => touch.release(button),
    onPointerCancel: () => touch.release(button),
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  });

  const move = (event: React.PointerEvent) => {
    const box = well.current?.getBoundingClientRect();
    if (!box) return;
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    const pushed = stickFrom(centre, { x: event.clientX, y: event.clientY }, radius.current);
    touch.push(pushed.x, pushed.y);
    if (knob.current) {
      // Le pouce voit où il pousse. Écrit directement dans le style plutôt que
      // par un état: c'est du dessin, pas de la donnée.
      const reach = radius.current * 0.55;
      knob.current.style.transform = `translate(${pushed.x * reach}px, ${-pushed.y * reach}px)`;
    }
  };

  /** Assez large pour tenir un groupe de touches sans mordre sur l'image.
   *
   * Cent trente pixels: la largeur d'un stick plus sa marge. En dessous, les
   * boutons déborderaient de la bande et on gagnerait un demi-recouvrement au
   * lieu d'aucun, ce qui est pire que de les assumer aux coins. */
  const roomy = bar >= 130;

  const rest = () => {
    touch.push(0, 0);
    if (knob.current) knob.current.style.transform = "translate(0px, 0px)";
  };

  /* Les groupes se rangent DANS les bandes noires quand il y en a, et aux coins
     sinon. `left`/`right` sont donc des positions calculées et non des classes:
     la largeur de la bande n'est connue qu'à l'exécution. */
  const leftAt = roomy ? Math.max(6, (bar - 132) / 2) : 8;
  const rightAt = roomy ? Math.max(6, (bar - 132) / 2) : 8;

  /* Les quatre boutons sont le groupe le plus LARGE: trois colonnes, là où le
     stick n'en fait qu'une et la croix trois petites. À la taille par défaut il
     fait cent soixante-quatre pixels et la bande d'un téléphone en fait cent
     quarante, donc B dépassait sur l'image — attrapé par le pilote, pas à l'oeil.
     On le redimensionne sur la bande quand elle décide. */
  const cluster: React.CSSProperties = roomy ? clusterKeys(bar) : {};

  return (
    <div
      id="touchpad"
      className="pointer-events-none absolute inset-0 z-30 select-none"
      style={{ touchAction: "none" }}
    >
      {/* BANDE GAUCHE, de haut en bas: la gâchette, la croix, le stick.
          Le pouce gauche les atteint toutes les trois sans lâcher le téléphone. */}
      <div className="pointer-events-auto absolute top-0" style={{ left: leftAt }}>
        <Key name="L" label="L" shoulder hold={hold} />
      </div>

      <div
        className="pointer-events-auto absolute grid grid-cols-3 grid-rows-3 gap-0.5"
        style={{ left: leftAt, bottom: "calc(var(--n3-stick) * 2 + 1.5rem)" }}
      >
        <Key at="col-start-2" name="D_UP" label="▲" small hold={hold} />
        <Key at="col-start-1 row-start-2" name="D_LEFT" label="◀" small hold={hold} />
        <Key at="col-start-3 row-start-2" name="D_RIGHT" label="▶" small hold={hold} />
        <Key at="col-start-2 row-start-3" name="D_DOWN" label="▼" small hold={hold} />
      </div>

      <div
        ref={well}
        id="touchStick"
        className="pointer-events-auto absolute bottom-3 flex items-center justify-center rounded-full border border-rule-bright/60 bg-ink/60"
        style={{
          left: leftAt,
          width: "calc(var(--n3-stick) * 2)",
          height: "calc(var(--n3-stick) * 2)",
          touchAction: "none",
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0 && event.pointerType === "mouse") return;
          move(event);
        }}
        onPointerUp={rest}
        onPointerCancel={rest}
      >
        <div
          ref={knob}
          className="rounded-full border border-indigo/70 bg-indigo/40 transition-transform duration-75"
          style={{ width: "var(--n3-stick)", height: "var(--n3-stick)" }}
        />
      </div>

      {/* BANDE DROITE: les gâchettes en haut, les quatre boutons en bas. */}
      {/* Les gâchettes, dessinées comme sur la console: L et R sont des palettes
          larges collées au bord du haut, et Z une petite touche mauve posée
          contre R. Sur une vraie manette Z est violet et se trouve au-dessus de
          R, sous l'index droit; ici elle est à côté, faute de troisième doigt. */}
      <div
        className="pointer-events-auto absolute top-0 flex items-start gap-1.5"
        style={{ right: rightAt }}
      >
        <Key name="Z" label="Z" tint="z" pill hold={hold} />
        <Key name="R" label="R" shoulder hold={hold} />
      </div>

      {/* La géométrie de la console: A gros au milieu, B en bas à gauche de lui,
          X à sa droite, Y au-dessus. La première version les mettait en croix
          régulière, ce qu'aucune main n'a appris. */}
      <div
        /* Des colonnes qui suivent leur CONTENU et non trois parts égales:
           `grid-cols-3` donne à chaque colonne la largeur de la plus large, donc
           celle du gros bouton A, et le groupe faisait cent cinquante-cinq
           pixels dans une bande de cent quarante. Mesuré, pas deviné. */
        className="pointer-events-auto absolute bottom-3 grid grid-cols-[auto_auto_auto] grid-rows-3 gap-1"
        style={{ right: rightAt, ...cluster }}
      >
        <Key at="col-start-2 row-start-1" name="Y" label="Y" hold={hold} />
        <Key at="col-start-2 row-start-2" name="A" label="A" big tint="a" hold={hold} />
        <Key at="col-start-3 row-start-2" name="X" label="X" hold={hold} />
        <Key at="col-start-1 row-start-3" name="B" label="B" tint="b" hold={hold} />
      </div>

      {/* Start et les deux gestes de la page.
          Dans la bande droite quand il y en a une, en haut au milieu sinon: ils
          ne se cherchent qu'une fois, et ils ne doivent jamais tomber sous un
          pouce qui joue. */}
      <div
        className="pointer-events-auto absolute flex items-center gap-2"
        style={
          roomy
            ? { right: rightAt, top: "calc(var(--n3-key) + 1.25rem)", flexDirection: "column" }
            : { top: "0.5rem", left: "50%", transform: "translateX(-50%)" }
        }
      >
        <Key name="START" label="START" wide hold={hold} />
        {/* Empilés dans la bande, côte à côte sinon: deux pastilles l'une à
            côté de l'autre font cent trente pixels de large, et la bande d'un
            téléphone en fait cent quarante. Mesuré: la seconde mordait de
            dix-sept pixels sur l'image. */}
        <div className={roomy ? "flex flex-col gap-2" : "flex gap-2"}>
          {/* Toujours là, et pas seulement quand le son est coupé.
              Rouge tant que rien ne joue, terne ensuite. Le taper démarre le son
              ET fait un bip franc: s'il s'entend, la sortie fonctionne et le
              problème est dans le flux; s'il ne s'entend pas alors que la page
              dit jouer, c'est le téléphone. Une question fermée à la place d'une
              conversation. */}
          <button
            type="button"
            id="wakeSound"
            onClick={onSound}
            title="démarrer le son, et le tester par un bip"
            className={`rounded-full border px-3 text-[11px] uppercase tracking-[0.14em] ${
              soundOff ? "border-alert text-alert" : "border-rule text-faint"
            }`}
            style={{ height: "var(--n3-key)", touchAction: "none" }}
          >
            son
          </button>
          <Small id="showColumn" label="menu" onClick={onMenu} />
          <Small id="hideTouch" label="cacher" onClick={onLeave} />
        </div>
      </div>
    </div>
  );
}

/** Un bouton de manette, dessiné et tenu.
 *
 * L'état pressé vient de `:active`, donc appuyer ne provoque aucun rendu. C'est
 * la moitié invisible de « React ne touche pas au chemin des commandes ».
 */
function Key({
  name,
  label,
  at = "",
  big = false,
  small = false,
  wide = false,
  shoulder = false,
  pill = false,
  tint,
  hold,
}: {
  name: ButtonName;
  label: string;
  at?: string;
  big?: boolean;
  small?: boolean;
  wide?: boolean;
  /** Une palette large collée au bord du haut, comme L et R sur la console. */
  shoulder?: boolean;
  /** Une petite touche allongée, comme Z. */
  pill?: boolean;
  /** La couleur de la console, pour les trois boutons qui en ont une.
   *
   * A est vert et B est rouge sur une GameCube, et une main qui a joué dessus
   * les vise à la couleur avant de lire la lettre. Les autres restent neutres,
   * comme sur la vraie manette: teinter les quatre ferait un arc-en-ciel qui
   * n'aide personne. */
  tint?: "a" | "b" | "z";
  hold: (button: ButtonName) => Record<string, unknown>;
}) {
  const size = big
    ? { width: "var(--n3-key-big)", height: "var(--n3-key-big)" }
    : small
      ? { width: "var(--n3-key-small)", height: "var(--n3-key-small)" }
      : { width: "var(--n3-key)", height: "var(--n3-key)" };
  return (
    <button
      type="button"
      id={`touch-${name}`}
      {...hold(name)}
      className={`${at} flex items-center justify-center border font-mono transition-colors ${
        shoulder
          ? "rounded-b-[14px] rounded-t-none border-t-0 text-[15px] tracking-[0.1em]"
          : pill
            ? "rounded-b-[10px] rounded-t-none border-t-0 text-[13px]"
            : "rounded-full text-[13px]"
      } ${
        tint === "a"
          ? "border-[#5ac26a]/70 bg-[#2f6b39]/70 text-[#d9f2de] active:bg-[#5ac26a]/70"
          : tint === "b"
            ? "border-[#d1545e]/70 bg-[#6b2f35]/70 text-[#f6dcde] active:bg-[#d1545e]/70"
            : tint === "z"
              ? "border-[#8b7bd8]/70 bg-[#3a3270]/80 text-[#ded8f7] active:bg-[#8b7bd8]/70"
              : "border-rule-bright/70 bg-panel/80 text-text active:border-indigo active:bg-indigo/40"
      }`}
      style={{
        ...(shoulder
          ? { height: "calc(var(--n3-key) * 0.86)", width: "calc(var(--n3-key) * 1.9)" }
          : pill
            ? { height: "calc(var(--n3-key) * 0.86)", width: "calc(var(--n3-key) * 0.95)" }
            : wide
              ? { height: "var(--n3-key)", padding: "0 0.9rem" }
              : size),
        touchAction: "none",
      }}
    >
      {label}
    </button>
  );
}

/** Un geste de la PAGE et non de la manette: plus petit, plus terne, et sans
 * capture de pointeur. Les distinguer à l'oeil évite de cacher la manette en
 * visant Start. */
function Small({ id, label, onClick }: { id: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      id={id}
      onClick={onClick}
      className="rounded-full border border-rule px-3 text-[11px] uppercase tracking-[0.14em] text-faint"
      style={{ height: "var(--n3-key)", touchAction: "none" }}
    >
      {label}
    </button>
  );
}
