/**
 * The room: a picture, and a column of instruments beside it.
 *
 * The picture takes the height of the window and never causes the page to
 * scroll. Everything else lives in a fixed column on the right that scrolls
 * inside itself, so reading a number never moves the image and never asks
 * anybody to scroll away from the game they are playing.
 */
import { typingIn } from "./lib/typing";
import { useEffect, useRef, useState } from "react";
import type { Room as RoomState } from "./client";
import { Bindings } from "./components/Bindings";
import { Entrance } from "./components/Entrance";
import { Lobby } from "./components/Lobby";
import { Booting, type Step } from "./components/Booting";
import { Sidebar } from "./components/Sidebar";
import { Asked as AskedBanner, Asking } from "./components/Swap";
import { Channels } from "./components/Channels";
import { Home } from "./components/Home";
import { Xmb, type XmbCategory, type XmbItem } from "./components/Xmb";
import type { MenuAction } from "./media/menupad";
import {
  CubeIcon,
  ExpandIcon,
  GameIcon,
  KeysIcon,
  LayoutIcon,
  LeaveIcon,
  MeasureIcon,
  PadIcon,
  PaletteIcon,
  PanelIcon,
  RoomIcon,
  ScreenIcon,
  SettingsIcon,
  SoundIcon,
  SyncIcon,
  VolumeIcon,
  WandIcon,
  WatchIcon,
  WaveIcon,
} from "./components/XmbIcons";
import { Panel } from "./components/Readout";
import { Screen } from "./components/Screen";
import { TouchPad } from "./components/TouchPad";
import { Seats } from "./components/Seats";
import { forgetName, rememberedName } from "./lib/name";
import {
  SHELLS,
  THEMES,
  applyTheme,
  rememberMode,
  rememberShell,
  rememberTheme,
  shellLabel,
  storedMode,
  looksLikeAPhone,
  rememberPadOnly,
  rememberTouch,
  showsTouchPad,
  storedPadOnly,
  storedShell,
  storedTheme,
  storedTouch,
  TOUCHPADS,
  touchLabel,
  themeLabel,
} from "./lib/theme";
import { FITS, fitLabel, place, rememberFit, storedFit } from "./lib/fit";
import { useBare } from "./lib/fullscreen";
import { useBindings, useRoomReference } from "./lib/bindings";
import { cn } from "./lib/cn";
import { publishProfile } from "./lib/bindings";
import { arrange } from "./lib/settings";
import { useMe, useRename } from "./lib/me";
import { useLobby, useRoom, type Asked, type Booting as Told } from "./lib/room";
import {
  Struggling,
  Trailing,
  TRAIL_EVERY,
  vitals,
  worthWriting,
  type Trail,
  type Vitals,
} from "./lib/vitals";
import type { Session, Snapshot } from "./media/session";
import { clipLabel } from "./lib/clip";
import { CONSOLES } from "./lib/consoles";
import {
  PADS,
  launchPicks,
  padLabel,
  rememberPad,
  slotFromPick,
  slotLabel,
  storedPad,
  type Pad,
  type Slot,
} from "./lib/saves";
import { useClip } from "./lib/useClip";
import { useSession, useSnapshot } from "./lib/useSession";

/**
 * Trois écrans, dans l'ordre: qui joue, la salle, la partie.
 *
 * Le premier disparaît quand le proxy dit déjà qui on est, ce qui est le cas
 * normal: demander son nom à quelqu'un dont on connaît l'adresse vérifiée est un
 * formulaire pour rien. Il reste pour le développement local et pour une salle
 * servie sans plan de contrôle, où il n'y a personne à reconnaître.
 */
export default function App() {
  const { data: me, isPending } = useMe();
  /** Les réglages de manette de cette personne, semés dans le navigateur.
   *
   * Attendus, et pas seulement lancés: la boucle d'entrée lit le navigateur au
   * moment où elle est construite, donc semer après coup laisserait toute une
   * soirée sur les réglages de la machine plutôt que sur les siens. */
  const settled = useBindings(me?.login ?? null);
  const [local, setLocal] = useState(rememberedName);
  /** Comment on est entré: pour jouer, pour regarder, ou pas encore.
   *
   * Trois états et non un booléen, parce que « regarder » se décide AVANT que la
   * session existe. Construite en joueur puis corrigée après, elle prendrait une
   * manette le temps d'un aller-retour et l'aurait affiché à toute la salle. */
  const [entered, setEntered] = useState<null | "play" | "watch">(null);

  // Rien tant que l'identité n'a pas répondu: afficher le formulaire une demi
  // seconde avant de le retirer se lit comme un défaut.
  if (isPending || settled.isPending) return null;

  const identified = me?.login ?? null;
  const name = identified ? me!.name : local;
  if (!name) return <Entrance onName={setLocal} />;
  return (
    <Named
      name={name}
      login={identified}
      publishes={me?.publishes ?? false}
      entered={entered}
      onEnter={() => setEntered("play")}
      onWatch={() => setEntered("watch")}
      onLeave={() => setEntered(null)}
      onForget={() => {
        forgetName();
        setEntered(null);
        setLocal("");
      }}
    />
  );
}

/** Ce qui vaut dès qu'on a un nom: une socket de salon, et une description de
 * la salle. Les deux vivent ici plutôt que dans la partie, pour que l'écran de
 * salle se mette à jour tout seul quand quelqu'un s'assoit. */
function Named({
  name,
  login,
  publishes,
  entered,
  onEnter,
  onWatch,
  onLeave,
  onForget,
}: {
  name: string;
  login: string | null;
  /** Cette personne peut-elle publier la référence de la salle ?
   *
   * Un booléen venu du service, et non une comparaison faite ici: la page
   * n'a pas à connaître l'adresse de qui le peut, et le service refuse de
   * son côté. Cacher un bouton est du confort, pas une règle. */
  publishes: boolean;
  entered: null | "play" | "watch";
  onEnter: () => void;
  onWatch: () => void;
  onLeave: () => void;
  onForget: () => void;
}) {
  const { data: room, isError } = useRoom();
  /** Une demande reçue, à laquelle il faut répondre. */
  const [asked, setAsked] = useState<Asked | null>(null);
  /** Où en est une demande qu'on a envoyée. */
  const [asking, setAsking] = useState<{ port: number; said: string | null } | null>(null);
  const yieldSeat = useRef<(() => void) | null>(null);

  /** Cette page ne sert-elle que de manette.
   *
   * Ici plutôt que dans la salle, parce que DEUX choses en dépendent et
   * qu'elles doivent être d'accord: les canaux que la salle ouvre, et ce que le
   * salon inscrit au journal en voyant arriver quelqu'un. Un réglage rangé plus
   * bas ne pourrait pas atteindre la socket, qui est ouverte ici. */
  const [padOnly, setPadOnly] = useState(storedPadOnly);
  useEffect(() => rememberPadOnly(padOnly), [padOnly]);

  const lobby = useLobby(
    login ?? name,
    name,
    padOnly,
    (heard) => setAsked(heard),
    (answer) => {
      setAsking({ port: answer.port, said: answer.ok ? null : `${answer.from} a dit non` });
      // Accepté: la place vient d'être libérée, on s'y branche. `take` plutôt
      // qu'attendre la reconnexion polie, parce qu'une autre page libre la
      // prendrait entre-temps et que la demande était pour NOUS.
      if (answer.ok) takeSeat.current?.(answer.port);
    },
    // Quelqu'un d'autre a changé de jeu. La salle vit à l'étage du dessous, avec
    // ce qu'elle sait de son image; on ne fait que lui passer le message.
    (told) => showBoot.current?.(told),
  );
  const takeSeat = useRef<((port: number) => void) | null>(null);
  const showBoot = useRef<((told: Told) => void) | null>(null);
  const rename = useRename(lobby.renamed);

  if (entered === null) {
    return (
      <Lobby
        room={room}
        name={name}
        login={login}
        failed={isError}
        onEnter={onEnter}
        onWatch={onWatch}
        onForget={onForget}
        onRename={(chosen) => rename.mutate(chosen)}
      />
    );
  }
  return (
    <Room
      name={name}
      login={login}
      publishes={publishes}
      room={room}
      watching={entered === "watch"}
      padOnly={padOnly}
      onPadOnly={setPadOnly}
      onLeave={onLeave}
      announceSeat={lobby.seat}
      asked={asked}
      asking={asking}
      onAsk={(port) => {
        setAsking({ port, said: null });
        lobby.ask(port);
        // Le service oublie la demande au bout du même délai, donc attendre plus
        // longtemps que lui afficherait une attente qui ne mène nulle part.
        window.setTimeout(
          () =>
            setAsking((was) =>
              was?.port === port && was.said === null ? { port, said: "pas de réponse" } : was,
            ),
          (room?.ask_lasts ?? 10) * 1000,
        );
      }}
      onAnswer={(ok) => {
        if (asked === null) return;
        lobby.answer(asked.port, ok);
        if (ok) yieldSeat.current?.();
        setAsked(null);
      }}
      // Sans réponse, il ne se passe rien: la bannière s'en va et le service a
      // déjà oublié la demande de son côté.
      onExpire={() => setAsked(null)}
      onForgetAsk={() => setAsking(null)}
      tell={lobby}
      bind={(take, give, boot) => {
        takeSeat.current = take;
        yieldSeat.current = give;
        showBoot.current = boot;
      }}
    />
  );
}

/** À quel rythme la page dit ce qu'elle voit, en millisecondes.
 *
 * Dix secondes. Assez fin pour dater une saccade à la fenêtre près, assez large
 * pour qu'une soirée de quatre joueurs tienne dans quelques centaines de
 * kilo-octets. Une seconde donnerait soixante fois plus de lignes sans rien dire
 * de plus: ce qui intéresse ici est la forme d'une minute, pas d'une image.
 */
const VITALS_EVERY = 10_000;

/** Combien de tours de trace fine séparent deux relevés envoyés.
 *
 * Un seul minuteur pour les deux cadences, plutôt que deux qui dériveraient
 * l'un par rapport à l'autre: la trace bat à la seconde, et un tour sur dix part
 * au salon. Deux minuteurs séparés donneraient des fenêtres qui se chevauchent à
 * moitié, et deux lignes voisines du journal compteraient les mêmes images.
 */
const TICKS_PER_VITALS = VITALS_EVERY / TRAIL_EVERY;

/** Le volume au premier son, de zéro à un.
 *
 * Vingt pour cent. Il a valu soixante-dix, et c'était le mauvais sens de
 * l'erreur: une salle qui démarre fort surprend, et la première chose qu'on fait
 * est de chercher où baisser — pendant que tout le monde entend. Une salle qui
 * démarre bas se monte tranquillement, et personne ne sursaute.
 *
 * Il n'est pas retenu d'une visite à l'autre, contrairement au thème ou à la
 * manette: chaque chargement repart d'ici. C'est donc aussi le volume qu'on
 * retrouve en revenant, pas seulement celui du tout premier son.
 */
const START_VOLUME = 0.2;

function Room({
  name,
  login,
  publishes,
  room,
  watching,
  padOnly,
  onPadOnly,
  onLeave,
  announceSeat,
  asked,
  asking,
  onAsk,
  onAnswer,
  onExpire,
  onForgetAsk,
  bind,
  tell,
}: {
  name: string;
  login: string | null;
  /** Cette personne peut-elle publier la référence de la salle ?
   *
   * Un booléen venu du service, et non une comparaison faite ici: la page n'a
   * pas à connaître l'adresse de qui le peut, et le service refuse de son
   * côté. Cacher un bouton est du confort, pas une règle. */
  publishes: boolean;
  room: RoomState | undefined;
  /** Vrai quand on est entré pour regarder. Lu une fois, à la construction de la
   * session; changer d'avis ensuite passe par la session. */
  watching: boolean;
  /** Vrai quand cette page ne sert que de manette: ni image, ni son. */
  padOnly: boolean;
  onPadOnly: (only: boolean) => void;
  /** Sortir de la salle et revenir à l'écran d'accueil. */
  onLeave: () => void;
  announceSeat: (port: number | null) => void;
  asked: Asked | null;
  asking: { port: number; said: string | null } | null;
  onAsk: (port: number) => void;
  onAnswer: (ok: boolean) => void;
  onExpire: () => void;
  onForgetAsk: () => void;
  /** Rend à l'étage du dessus de quoi prendre et céder une place: la socket du
   * salon vit là-haut, la manette vit ici, et la négociation traverse les deux. */
  bind: (take: (port: number) => void, give: () => void, boot: (told: Told) => void) => void;
  /** Où envoyer ce que ce navigateur mesure. La socket du salon vit à l'étage
   * du dessus, les chiffres vivent ici. */
  tell: {
    /** Prévenir la salle qu'on change de jeu. Par le salon, parce que le worker
     * est justement ce qui s'arrête. */
    booting: (game: number, save: number) => void;
    vitals: (sample: Vitals) => void;
    /** Un signalement emporte en plus les deux dernières minutes à la seconde:
     * la question devant un « ça saccade » est toujours « et juste avant ? ». */
    complain: (sample: Vitals & { fin: Trail }) => void;
  };
}) {
  const coarse = useRef(looksLikeAPhone()).current;
  const { bare, setBare, fullscreen, toggleFullscreen } = useBare(coarse);
  const [volume, setVolume] = useState(START_VOLUME);
  const [deviceRate, setDeviceRate] = useState(false);
  const [lipsync, setLipsync] = useState(false);
  const [bindings, setBindings] = useState(false);
  /** Combien d'images ont été peintes, lisible sans redéclencher d'effet.
   *
   * L'annonce venue du salon a besoin de ce nombre au moment où elle arrive. Le
   * prendre dans les dépendances rebrancherait les fonctions de la salle deux
   * fois par seconde, au rythme de l'instantané, pour une valeur qu'on ne fait
   * que lire. */
  /** Depuis combien de millisecondes l'image ne bouge plus.
   *
   * Mesuré plutôt que déduit d'un compteur de reconnexions: ce qui distingue un
   * hoquet d'un changement de jeu est la durée du noir, une seconde contre
   * trente. Remis à zéro dès qu'une image arrive. */
  const darkSince = useRef<number | null>(null);
  const [menu, setMenu] = useState(false);
  /** Le jeu ARMÉ, pour ceux qui n'ont pas de choix de sauvegarde.
   *
   * Un jeu de carte mémoire se confirme par son panneau de sauvegarde. Un jeu
   * Wii n'en a pas, donc il lui faut la confirmation d'avant: ce qu'on confirme
   * est la fin de la partie de tout le monde, et ça ne doit pas tenir en une
   * pression. */
  const [armed, setArmed] = useState<number | null>(null);
  /** Le dossier de console ouvert, ou rien quand on voit les dossiers.
   *
   * Deux étages plutôt qu'une liste: la bibliothèque mêle deux consoles, et
   * l'ordre alphabétique faisait tomber « Mario Kart Wii » entre deux Mario
   * Party. */
  const [folder, setFolder] = useState<string | null>(null);
  const [theme, setTheme] = useState(storedTheme);
  /** Ce que la colonne montre. Retenu, parce que quelqu'un qui veut les mesures
   * les veut encore au prochain chargement. */
  const [mode, setMode] = useState(storedMode);
  /** La forme du menu. Un réglage à part du thème: l'un change des couleurs,
   * l'autre change la façon de se déplacer. */
  const [shell, setShell] = useState(storedShell);
  /** Comment l'image est posée à l'écran. Séparé du format transporté: le
   * premier se choisit sur le débit qu'on a, le second sur ce qu'on aime voir. */
  const [fit, setFit] = useState(storedFit);
  /** Faut-il montrer la manette à l'écran. Retenu, parce que quelqu'un qui joue
   * au téléphone y rejouera au téléphone. */
  const [touchPref, setTouchPref] = useState(storedTouch);
  /** La manette à l'écran est-elle montée en ce moment. Nommé parce que DEUX
   * choses en dépendent, et qu'elles doivent être d'accord: la manette
   * elle-même, et les boutons de coin du mode replié, qui tombaient sinon
   * exactement sur Z et R. */
  const onTouch = showsTouchPad(touchPref, coarse);

  /** La place dont l'image dispose, rapportée par l'écran. Sert au menu, qui
   * annonce ce que chaque choix donnerait. */
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useEffect(() => rememberFit(fit), [fit]);
  useEffect(() => rememberTouch(touchPref), [touchPref]);
  useEffect(() => rememberShell(shell), [shell]);
  useEffect(() => rememberMode(mode), [mode]);
  /** Le jeu demandé et l'image peinte au moment où on l'a demandé.
   *
   * Deux choses parce que la fin du chargement se reconnaît à une IMAGE, pas à
   * une socket: le worker répond avant que Dolphin ait dessiné quoi que ce soit,
   * et cacher l'écran de chargement là montrerait du noir. */
  const [booting, setBooting] = useState<{
    game: string;
    save: string;
    /** Quand on a lancé, pour ne pas rester coincé si rien n'arrive jamais. */
    at: number;
  } | null>(null);
  /** L'emplacement sur lequel CETTE page a lancé le jeu en cours.
   *
   * Sert à une seule chose: relancer pour changer de manette ne doit pas
   * annoncer « partie neuve » aux autres. Le worker garde son choix et repart au
   * bon endroit de toute façon; c'est l'ANNONCE qui envoyait zéro en dur, donc
   * qui affichait le mauvais nom de sauvegarde sur l'écran de chargement des
   * autres pages. Un chiffre faux sur l'écran de quelqu'un d'autre est le genre
   * de défaut que personne ne signale et que tout le monde remarque.
   *
   * `null` quand ce n'est pas nous qui avons lancé: on ne devine pas.
   */
  const [ranWith, setRanWith] = useState<Slot | null>(null);
  /** Le jeu qui attend une confirmation. Changer de jeu arrête la partie de tout
   * le monde, donc la première entrée arme et la seconde lance. */
  /** Sur quelle sauvegarde le prochain jeu démarrera.
   *
   * Retenu dans le navigateur, comme les autres réglages: quelqu'un qui joue en
   * soirée sur les parties débloquées y rejouera le lendemain. */

  const { ref, session } = useSession(volume, deviceRate, announceSeat, watching, padOnly);

  /** Ce que la salle propose, relu pendant la visite.
   *
   * La boucle d'entrée lisait la référence une seule fois, à sa construction:
   * publier un profil n'arrivait donc qu'aux gens qui ouvraient la page ENSUITE.
   * Le service répondait 200 et le bouton avait l'air cassé — il l'était pour
   * tout le monde sauf celui qui appuyait.
   *
   * La référence arrive dans le navigateur, puis on demande à la boucle de la
   * relire: sans ce second geste, la case du navigateur serait à jour et l'écran
   * montrerait toujours l'ancienne liste. */
  const alive = useRef<Session | null>(null);
  alive.current = session;
  useRoomReference(() => alive.current?.input.refreshRoomKeys());
  const clip = useClip();
  const shot = useSnapshot(session);
  {
    // DEPUIS QUAND la salle n'envoie plus rien, et non « combien de temps
    // accumulé »: additionner à chaque rendu fait dépendre la mesure du rythme
    // des rendus, qui s'arrête dans un onglet en arrière-plan. Un instant retenu
    // reste vrai même si personne ne regarde pendant une minute.
    //
    // Sur la CONNEXION et pas sur le compteur d'images: un jeu qui affiche un
    // écran noir peint quand même.
    const live = shot?.video.connected ?? true;
    if (live) darkSince.current = null;
    else darkSince.current ??= performance.now();
  }
  /** Depuis combien de temps il n'y a plus d'image, en millisecondes. */
  const darkFor = darkSince.current === null ? 0 : performance.now() - darkSince.current;

  /* Le relevé qui part au salon toutes les dix secondes.
     Par des références et non par des dépendances: `shot` change deux fois par
     seconde et `tell` est reconstruit à chaque rendu, donc les mettre en
     dépendances reposerait le minuteur avant qu'il n'ait jamais tiré. C'est le
     même piège que l'observateur de taille dans `Screen`. */
  const seen = useRef(shot);
  seen.current = shot;
  const sending = useRef(tell);
  sending.current = tell;
  const previous = useRef<Snapshot | null>(null);
  const opened = useRef(performance.now());
  /** Les deux dernières minutes, à la seconde. Ne part QUE sur un signalement:
   * l'envoyer en continu multiplierait le journal par quarante pour décrire des
   * minutes dont personne ne se plaindra jamais. */
  const trail = useRef(new Trailing());
  /** Ce qui décide de proposer le format réduit, et de ne le proposer qu'une
   * fois. La page voit la dégradation avant la personne qui la subit. */
  const rough = useRef(new Struggling());
  const [suggestHalf, setSuggestHalf] = useState(false);
  const sample = () => {
    const now = seen.current;
    if (!now) return null;
    return vitals(now, previous.current, performance.now() - opened.current);
  };
  useEffect(() => {
    /* UN seul minuteur pour les deux cadences. La trace bat à la seconde, et un
       tour sur dix part au salon. Deux minuteurs séparés dériveraient l'un par
       rapport à l'autre, et deux lignes voisines du journal finiraient par
       compter les mêmes images. */
    let ticks = 0;
    const timer = window.setInterval(() => {
      const now = seen.current;
      if (!now) return;
      trail.current.push(now, performance.now());
      ticks += 1;
      if (ticks < TICKS_PER_VITALS) return;
      ticks = 0;
      const taken = sample();
      if (!taken) return;
      previous.current = now;
      opened.current = performance.now();
      if (worthWriting(taken)) sending.current.vitals(taken);
      if (rough.current.saw(taken)) setSuggestHalf(true);
    }, TRAIL_EVERY);
    return () => window.clearInterval(timer);
  }, []);

  /* Le son démarre au PREMIER GESTE, quel qu'il soit.
   *
   * Un navigateur ne joue rien avant qu'on le lui ait demandé, et cette demande
   * doit venir d'un geste de la personne. Sur un ordinateur il y avait un bouton
   * dans la colonne; sur un téléphone la colonne est repliée et le bouton était
   * introuvable, donc il n'y avait tout simplement pas de son. Signalé le
   * 18 août 2026.
   *
   * N'importe quel geste fait l'affaire, et le premier appui sur la manette à
   * l'écran en est un: on écoute une fois, on démarre, on se retire. Le bouton
   * de la colonne reste, pour qui aurait refusé au premier tour. */
  useEffect(() => {
    if (!session) return;
    // On réessaie tant que ça n'a pas PRIS, et pas seulement une fois.
    //
    // Ce que `start` demande n'est pas ce que le navigateur accorde. Sur iOS le
    // premier essai échoue souvent, et se retirer après lui laissait le son
    // coupé pour toute la visite sans que rien ne le dise. On écoute donc
    // jusqu'à ce que le contexte joue vraiment.
    const kinds = ["pointerup", "touchend", "click", "keydown"];
    const wake = () => {
      void session.sound.start().then(() => {
        if (!session.sound.running()) return;
        for (const kind of kinds) window.removeEventListener(kind, wake);
      });
    };
    for (const kind of kinds) window.addEventListener(kind, wake, { passive: true });
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, wake);
    };
  }, [session]);

  useEffect(() => session?.sound.setVolume(volume), [session, volume]);
  useEffect(() => session?.sound.setDeviceRate(deviceRate), [session, deviceRate]);
  useEffect(() => session?.setLipsync(lipsync), [session, lipsync]);
  // Échap ouvre le menu, comme sur une console. Les écrans qui se ferment avec
  // Échap (menu, touches) le gèrent eux-mêmes, donc on ne l'ouvre que quand
  // rien n'est ouvert.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (typingIn(event.target)) return;
      if (event.key === "Escape" && !menu && !bindings) setMenu(true);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [menu, bindings]);

  useEffect(() => {
    if (booting === null) return;
    // L'instantané LU MAINTENANT, et surtout pas celui du rendu.
    //
    // Le défaut, mesuré le 31 août 2026 sur la vraie salle: `setBooting` change
    // `booting`, donc cet effet se rejoue — avec le `shot` d'AVANT la demande,
    // où le redémarrage n'est pas encore annoncé et où le compteur d'images de
    // l'ancien flux vaut des centaines. Les deux conditions étaient vraies, et
    // l'écran de chargement se retirait dans le rendu même qui l'affichait.
    //
    // Il n'apparaissait donc JAMAIS au lancement. Ce qu'on voyait était le repli
    // « la socket est coupée depuis 700 ms », arrivé trois secondes plus tard et
    // reparti dès la reconnexion, c'est-à-dire avant que le nouveau jeu ait
    // peint quoi que ce soit. D'où l'ancienne image figée, découverte deux fois.
    //
    // `shot` reste en dépendance: c'est lui qui fait REJOUER l'effet deux fois
    // par seconde. Ce qui était faux est de le LIRE.
    // `video.stats()` et NON `getSnapshot()`: le second rend l'instantané mis en
    // cache, celui-là même que React vient de nous passer. Le lire ne corrigeait
    // donc rien, et la première version de ce correctif a échoué exactement de
    // la même façon que le défaut — mesuré, pas deviné.
    const live = session?.video.stats();
    if (!live) return;
    // Deux conditions, et il en faut deux. Le flux doit avoir REDÉMARRÉ, sinon
    // on compte les images de l'ancien jeu; et le nouveau doit avoir peint une
    // trentaine d'images, parce que la toute première est parfois une image-clé
    // restée dans le décodeur, et disparaître dessus ferait clignoter l'ancien
    // jeu une demi-seconde.
    // L'image doit avoir DISPARU, puis être revenue. Compter les images ne
    // suffisait pas: changer de jeu arrête le worker en une seconde environ, et
    // l'ancien flux en peint une soixantaine avant que sa socket ne tombe.
    // L'écran s'effaçait donc en une demi-seconde, et on regardait « en attente
    // de l'image » pendant les trente secondes de démarrage d'un jeu Wii.
    //
    // Compter les reconnexions ne suffisait pas non plus: un simple hoquet en
    // provoque une, et l'écran repartait pareil. Ce qui distingue un hoquet d'un
    // changement de jeu est la DURÉE du noir — une seconde contre trente.
    // Le redémarrage demandé doit être ARRIVÉ, et le nouveau flux doit peindre.
    // Une trentaine d'images, parce que la première est parfois une image-clé
    // restée dans le décodeur, et disparaître dessus ferait clignoter l'ancien
    // jeu une demi-seconde.
    // Trois conditions. Le flux doit avoir REDÉMARRÉ, le nouveau doit peindre,
    // et l'image ne doit plus être noire.
    //
    // La troisième vient de la mesure du 31 août 2026: sans elle, l'écran se
    // retirait sur le démarrage de Dolphin — quatre secondes de noir sur Mario
    // Kart Double Dash, aucune sur Mario Party 4, donc un défaut qui se montre
    // un jeu sur deux. La sonde qui répond ne tourne QUE dans cette fenêtre,
    // pour zéro coût pendant une partie; voir `video.sampleDark`.
    if (!live.awaitingRestart && live.paintedSince > 30 && !live.dark) return setBooting(null);
    // Et un plafond, pour le cas où rien n'arrive jamais: un changement de jeu
    // refusé ne provoque aucune reconnexion, et un écran de chargement qui ne
    // part plus est pire que celui qui partait trop tôt.
    if (performance.now() - booting.at > 60_000) setBooting(null);
  }, [booting, shot, session]);
  useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);

  const port = shot?.input.port ?? null;
  const learning = shot?.input.learning ?? null;
  const people = room?.people ?? [];

  const boss = room?.owner ?? null;
  /** Peut-on changer le jeu ? C'est le WORKER qui répond.
   *
   * La page en jugeait par elle-même, à partir du propriétaire que le salon
   * nomme. Les deux ne disaient pas la même chose: le salon nomme une PERSONNE,
   * le worker tranche par PLACE. Deux onglets de la même personne suffisaient à
   * les mettre en désaccord, et la page annonçait alors un droit que le worker
   * refusait ensuite en silence.
   *
   * Le worker répond oui aussi quand le propriétaire n'a rien touché depuis
   * trois minutes, ce que la page ne peut pas savoir: elle ne voit pas les
   * manettes des autres. */
  const mine = shot?.input.deciding ?? false;
  /** Le propriétaire est là, mais il ne joue plus. */
  const away = mine && boss !== null && (login === null || boss.login !== login);
  const whyNotChoose =
    port === null
      ? "prends une manette pour changer de jeu"
      : mine
        ? away
          ? `${boss?.name ?? "quelqu'un"} ne joue plus: la salle est à qui la prend`
          : null
        : `${boss?.name ?? "quelqu'un"} décide du jeu dans cette salle`;

  // De quoi prendre et céder une place, rendu à l'étage du dessus où vit la
  // socket du salon.
  useEffect(() => {
    bind(
      (chosen) => session?.input.take(chosen),
      () => session?.input.yieldSeat(),
      // L'annonce des AUTRES. On repart du nombre d'images peint MAINTENANT,
      // exactement comme celui qui a cliqué: l'écran s'efface quand la salle
      // repeint, et c'est la même règle pour tout le monde.
      (told) => {
        session?.video.expectRestart();
        setBooting({
          game: told.game,
          save: told.save,
          at: performance.now(),
        });
      },
    );
  }, [bind, session]);

  // Occupancy from the worker, names from the control plane. Neither knows the
  // other's half, and neither is asked for it.
  const names = new Map(
    (room?.seats ?? []).flatMap((seat) => (seat.player ? [[seat.port, seat.player] as const] : [])),
  );

  /* Les rayons du menu.
   *
   * Construits ici plutôt que dans le composant: ce que le menu MONTRE dépend de
   * qui est là, de qui décide et de ce que la salle joue, et le XMB n'a pas à
   * connaître ces règles. Il sait afficher une croix, c'est tout.
   */
  /** Regarde-t-on, en ce moment ? Lu sur la session et non sur `watching`, qui
   * ne dit que par quelle porte on est entré. */
  const watchingNow = shot?.input.watching ?? false;
  const picture = shot?.video.picture ?? { width: 0, height: 0 };
  /** Le format choisi. Gardé ici en plus de la session pour que le menu se
   * redessine tout de suite: l'instantané ne revient que deux fois par seconde,
   * et un réglage qui met une demi-seconde à afficher son nouvel état se lit
   * comme un réglage qui n'a pas pris. */
  const [half, setHalf] = useState(false);
  /** La manette que les jeux Wii présentent. Un réglage, pas une décision de
   * partie: voir `lib/saves`. */
  const [pad, setPad] = useState<Pad>(storedPad);
  useEffect(() => {
    if (session) setHalf(session.video.isHalf());
  }, [session]);
  // La console du jeu en cours, dite à la boucle d'entrée: elle NOMME les
  // commandes pendant l'apprentissage, et rien d'autre. Ce qu'on envoie ne
  // change pas — c'est Dolphin qui relit la même trame comme une manette
  // GameCube ou comme une Wiimote.
  useEffect(() => {
    session?.input.playing(room?.game?.console ?? "gc");
  }, [session, room?.game?.console]);
  // Et ce qu'on TIENT, dès qu'une session existe et non seulement au lancement.
  // Sans cette ligne, quelqu'un qui règle sa guitare puis recharge la page ouvre
  // l'écran des touches sur le profil de la manette GameCube: le réglage est
  // bien rangé, simplement personne n'a dit lequel relire.
  useEffect(() => {
    session?.input.choosePad(pad);
  }, [session, pad]);

  /** Changer de manette, et donc de jeu de touches.
   *
   * UNE fonction pour les deux écrans qui l'offrent — les réglages et « touches »
   * — parce que deux copies d'un même geste finissent par ne plus faire la même
   * chose. Le premier jet en avait bien deux, et l'une des deux lisait le choix
   * avec un repli qui ramenait la guitare sur la manette GameCube.
   */
  /** Demander un clip, ou enregistrer celui qui est prêt.
   *
   * UNE fonction, parce que le clip a deux gestes dans le même bouton — demander
   * puis enregistrer — et que deux copies de cette bascule finiraient par ne pas
   * être d'accord sur laquelle des deux on est en train de faire.
   */
  const takeClip = () => {
    // Prêt: on télécharge, et le bouton se réarme. Un lien qu'on a déjà pris ne
    // doit pas rester en travers du suivant.
    if (clip.state.phase === "fait") {
      const link = document.createElement("a");
      link.href = clip.state.url;
      link.download = clip.state.name;
      link.click();
      clip.forget();
      return;
    }
    clip.ask();
  };

  const switchPad = (wanted: Pad) => {
    const held = pad;
    setPad(wanted);
    rememberPad(wanted);
    session?.input.choosePad(wanted);

    // Passer du Nunchuk à la guitare ne relance RIEN.
    //
    // Les deux sont la même Wiimote avec autre chose au bout, et Dolphin échange
    // une extension en cours de partie — comme on débranche un Nunchuk pour
    // brancher une guitare sans éteindre la console. Seul un changement
    // d'APPAREIL, vers ou depuis la manette GameCube, demande de repartir.
    //
    // `choosePad` est quand même envoyé juste au-dessus: il décide de ce que la
    // salle présentera au prochain démarrage, et le laisser en arrière ferait
    // revenir l'ancienne extension à la première relance.
    if (held !== 0 && wanted !== 0) {
      session?.input.chooseExtension(wanted === 2 ? 1 : 0);
      return;
    }
    // Dolphin lit sa configuration de manette au démarrage, donc le changement
    // demande de relancer. On ne le fait que si un jeu Wii tourne: pour un jeu
    // GameCube le réglage ne décide de rien, et couper une partie pour ça serait
    // gratuit.
    if (room?.game?.console !== "wii" || room.game.index === undefined) return;
    if (!session?.input.chooseGame(room.game.index)) return;
    session.video.expectRestart();
    // L'emplacement SUR LEQUEL on tourne, pas zéro. Le worker garde son choix et
    // repart au bon endroit; c'est cette annonce qui mettait « partie neuve » sur
    // l'écran de chargement des autres alors que le jeu redémarrait sur la
    // sauvegarde complète.
    tell.booting(room.game.index, ranWith ?? 0);
    setBooting({ game: room.game.name, save: padLabel(wanted), at: performance.now() });
    setMenu(false);
  };
  /** La salle a refusé le demi-format pour l'image de ce jeu.
   *
   * Lu sur l'instantané: la page l'apprend en demandant à la salle, une fois le
   * flux ouvert, donc pas au premier rendu. */
  const denied = shot?.video.halfDenied ?? false;
  useEffect(() => {
    if (denied) setHalf(false);
  }, [denied]);

  /** Le lien ne porte pas le grand format: on réduit, et on le DIT.
   *
   * # Pourquoi la page décide toute seule
   *
   * Le demi-format existait déjà et personne ne s'en servait: il fallait le
   * trouver dans les réglages, et quelqu'un dont l'image traîne cherche une
   * panne, pas une case à cocher. Le 4 septembre 2026 un ami a passé une soirée
   * à 24 Mbit/s sur un lien qui ne suivait pas, pendant que le flux réduit à
   * 5 Mbit/s l'attendait, coché par personne.
   *
   * # Pourquoi c'est une bascule et pas une proposition
   *
   * Une proposition demande de l'attention à quelqu'un qui joue. Le geste est
   * réversible d'un clic, il est annoncé, et le pire cas est une image plus
   * petite pendant quelques secondes chez quelqu'un qui avait un hoquet. Le
   * pire cas de l'inverse est une soirée gâchée.
   *
   * # Et jamais dans l'autre sens
   *
   * On ne remonte pas tout seul. Un lien qui vient d'être jugé trop étroit
   * redeviendrait large dès que la marge redescend, c'est-à-dire dès que le
   * format réduit fait son effet: on oscillerait entre les deux toute la
   * soirée. Remonter est une décision de la personne.
   */
  const overloaded = shot?.video.overloaded ?? false;
  const [reduced, setReduced] = useState(false);
  /** La personne a dit non: on ne réduit plus de la visite.
   *
   * Sans ce verrou, « revenir en pleine taille » était annulé dans la foulée:
   * remonter remettait `half` à faux, l'effet se rejouait, `overloaded` était
   * toujours vrai, et la page réduisait à nouveau avant le rendu suivant. Le
   * bouton avait l'air de ne rien faire. Trouvé par l'audit du 2026-09-05, sur
   * le correctif de la veille. */
  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    if (!overloaded || half || denied || declined || !session) return;
    // Sans le retenir: ce choix est celui de la page pour ce lien, pas celui de
    // la personne pour toutes ses visites.
    session.video.setHalf(true, false);
    setHalf(true);
    setReduced(true);
  }, [overloaded, half, denied, declined, session]);

  /** Les consoles présentes dans cette bibliothèque, dans l'ordre des sorties.
   *
   * Construites depuis ce que la salle annonce, jamais depuis une liste écrite
   * ici: une console qui n'a aucun jeu n'a pas de dossier, et un code qu'on ne
   * sait pas nommer se range quand même plutôt que de disparaître. */
  const shelves = CONSOLES.flatMap((one) => {
    const games = (room?.library ?? []).filter((game) => (game.console ?? "?") === one.code);
    return games.length > 0 ? [{ ...one, games }] : [];
  });
  /** Les jeux à montrer: ceux du dossier ouvert, ou tous quand il n'y en a qu'un. */
  const shown =
    folder === null ? (room?.library ?? []) : (shelves.find((s) => s.code === folder)?.games ?? []);

  const rays: XmbCategory[] = [
    {
      id: "jeux",
      label: "jeux",
      icon: <GameIcon className="h-full w-full" />,
      // Le choix de la sauvegarde vit SUR le jeu, et se fait au lancement.
      //
      // Il était avant une entrée à part, en tête de la colonne: on réglait
      // « tout débloqué » quelque part, puis on lançait un jeu ailleurs, et rien
      // à l'écran ne reliait les deux. Un réglage posé loin de ce qu'il décide
      // est un réglage qu'on oublie d'avoir mis.
      //
      // Le sélecteur remplace aussi l'armement à deux pressions. Il coûte le
      // même nombre de gestes, et le second DIT ce qu'il va faire au lieu de
      // demander « confirmer ? »: on ne confirme bien que ce qu'on lit.
      // Deux étages: les consoles, puis leurs jeux.
      //
      // La bibliothèque mêle maintenant deux consoles, et une seule liste les
      // mélangeait par ordre alphabétique — « Mario Kart Wii » tombait entre deux
      // Mario Party. Un dossier par console range ce que l'étagère range déjà.
      //
      // Un seul étage quand il n'y a qu'une console: un dossier qu'on est obligé
      // d'ouvrir pour arriver au seul endroit possible est un clic pour rien.
      items:
        folder === null && shelves.length > 1
          ? shelves.map<XmbItem>((shelf) => ({
              id: `shelf-${shelf.code}`,
              label: shelf.label,
              value: `${shelf.games.length} jeu${shelf.games.length > 1 ? "x" : ""}`,
              hint: shelf.note,
              icon:
                shelf.code === "wii" ? (
                  <WandIcon className="h-full w-full" />
                ) : (
                  <CubeIcon className="h-full w-full" />
                ),
              onEnter: () => setFolder(shelf.code),
            }))
          : shown.map<XmbItem>((game) => {
              // Le choix de sauvegarde n'existe que pour un disque dont on sait la console.
              //
              // Les deux consoles en ont, à deux endroits différents: une GameCube
              // dans une carte mémoire, une Wii dans sa propre mémoire sous
              // l'identifiant du titre. Le worker sait lequel et pose le lien.
              //
              // Un disque dont la console est INCONNUE n'a pas de choix: l'outil n'a
              // pas répondu, donc on ne sait pas où sa partie ira, et proposer un
              // choix qui ne décide peut-être rien est pire que ne pas le proposer.
              const saves = game.console === "gc" || game.console === "wii";
              const running = game.index === room?.game?.index;
              /** Lancer, une fois la sauvegarde décidée quand il y en a une. */
              const launch = (slot: Slot | null) => {
                // La sauvegarde AVANT le jeu: le worker retient le choix sans rien
                // déclencher, et c'est le changement de jeu qui agit. L'ordre compte,
                // parce que l'ordre de jeu fait redémarrer la salle.
                if (slot !== null) session?.input.chooseSave(slot);
                // La manette AVANT le jeu, comme la sauvegarde: le worker
                // retient, et c'est le changement de jeu qui agit. Elle vient du
                // réglage, pas du panneau.
                session?.input.choosePad(storedPad());
                if (!session?.input.chooseGame(game.index)) return;
                // La vidéo doit savoir qu'un redémarrage arrive: sans ça elle ne peut
                // pas distinguer les images de l'ancien jeu de celles du nouveau.
                session.video.expectRestart();
                // Prévenir les autres, par le salon. Le worker s'arrête dans la
                // seconde, donc il ne peut prévenir personne: ses sockets partent avec
                // lui. Sans cette ligne, tout le monde sauf celui qui a cliqué regarde
                // dix secondes de noir sans savoir si c'est cassé.
                setRanWith(slot);
                tell.booting(game.index, slot ?? 0);
                setBooting({
                  game: game.name,
                  save: slot === null ? "" : slotLabel(slot),
                  at: performance.now(),
                });
                setMenu(false);
              };
              return {
                id: `game${game.index}`,
                label: game.name,
                value: running ? "en cours" : armed === game.index ? "confirmer ?" : undefined,
                hint: running
                  ? saves
                    ? "entrée: le relancer sur une autre sauvegarde ou une autre manette"
                    : "c'est ce qui tourne"
                  : !mine
                    ? (whyNotChoose ?? undefined)
                    : saves
                      ? "entrée: choisir la sauvegarde, et lancer. Ça arrête la partie de tout le monde."
                      : armed === game.index
                        ? "encore une fois pour lancer, ailleurs pour annuler"
                        : "entrée deux fois: ce disque n'a pas dit de quelle console il est",
                icon: <GameIcon className="h-full w-full" />,
                game: { index: game.index, art: game.art ?? false },
                by: game.maker ?? undefined,
                note: game.about ?? undefined,
                // Le jeu QUI TOURNE reste choisissable, et c'est nouveau: le
                // relancer change de sauvegarde ou de manette, ce qui est la
                // seule façon de passer à la Wiimote sans lancer un autre jeu
                // pour revenir. Avant, cette entrée ne décidait de rien une fois
                // le jeu lancé, donc la griser était juste.
                //
                // Elle reste grisée pour qui ne décide pas du jeu.
                disabled: !mine,
                // Une seule décision ici, la sauvegarde, et la MÊME pour les deux
                // consoles. La manette se choisit sous « manettes »: voir
                // `launchPicks`, qui dit pourquoi les deux moitiés du choix vivent
                // ensemble plutôt qu'ici.
                picks: saves ? launchPicks() : undefined,
                // Sans emplacements il n'y a pas de panneau, donc plus rien ne
                // confirme. On remet l'armement à deux pressions, qui est ce que cette
                // entrée faisait avant que le choix de sauvegarde existe: ce qu'on
                // confirme reste la fin de la partie de tout le monde.
                onEnter: saves
                  ? undefined
                  : () => {
                      if (armed !== game.index) return setArmed(game.index);
                      setArmed(null);
                      launch(null);
                    },
                // La manette ne se choisit plus ici: c'est un réglage qu'on pose une
                // fois, pas une décision de partie. Elle vit sous « manettes », et
                // `launch` la relit au moment de lancer.
                //
                // Un identifiant qu'on ne reconnaît pas ne lance RIEN, plutôt que de
                // retomber sur « partie neuve »: c'est ce repli silencieux qui a fait
                // démarrer tous les jeux Wii sur la mauvaise sauvegarde.
                onPick: (id: string) => {
                  const slot = slotFromPick(id);
                  if (slot !== null) launch(slot);
                },
              };
            }),
    },
    {
      id: "salle",
      label: "salle",
      icon: <RoomIcon className="h-full w-full" />,
      // Les quatre places ont quitté ce rayon.
      //
      // Elles y montraient qui tient quoi, et permettaient de s'asseoir ou de
      // demander sa manette à quelqu'un. La COLONNE fait déjà exactement ça, y
      // compris les deux clics pour reprendre une place tenue par un fantôme —
      // et elle est visible en permanence, là où il fallait ouvrir un menu.
      //
      // Deux endroits pour un même geste, c'est deux endroits à tenir d'accord.
      // Ce qui reste ici est ce qui n'existe nulle part ailleurs: le clip, le
      // passage en spectateur, et la sortie.
      items: ([] as XmbItem[]).concat([
        // Le clip a quitté ce rayon pour la COLONNE, où il est atteignable sans
        // ouvrir de menu — c'est un geste qu'on fait pendant qu'il se passe
        // quelque chose, et poser un menu par-dessus le jeu qu'on voulait garder
        // est exactement le mauvais moment.
        //
        // Déplacé, pas dupliqué: deux endroits pour un même geste sont deux
        // endroits à tenir d'accord, et c'est la leçon des quatre places.
        {
          id: "watch",
          label: watchingNow ? "reprendre une manette" : "regarder sans manette",
          value: watchingNow ? "spectateur" : undefined,
          hint: watchingNow
            ? "la première place libre"
            : "rend ta place à la salle, l'image et le son continuent",
          icon: <WatchIcon className="h-full w-full" />,
          onEnter: () => {
            if (watchingNow) session?.input.play();
            else session?.input.watchOnly();
            setMenu(false);
          },
        },
        {
          id: "leave",
          label: "quitter la salle",
          hint: "retour à l'accueil, la partie continue sans toi",
          icon: <LeaveIcon className="h-full w-full" />,
          onEnter: onLeave,
        },
      ]),
    },
    {
      id: "reglages",
      label: "réglages",
      icon: <SettingsIcon className="h-full w-full" />,
      items: arrange([
        {
          id: "sound",
          label: "son",
          value: shot?.sound.state === "running" ? "activé" : "éteint",
          hint: "un navigateur ne fait pas de bruit avant qu'on le lui demande",
          icon: <SoundIcon className="h-full w-full" />,
          onEnter: () => void session?.sound.start(),
        },
        {
          id: "half",
          // « transporté » était du vocabulaire interne: personne ne dit ça
          // d'une image. Ce qu'on choisit est la qualité qu'on REÇOIT.
          label: "qualité reçue",
          value: shot?.video.half ? "réduit" : "pleine taille",
          // Ce que la personne a besoin de savoir pour choisir, et rien de plus:
          // combien ça coûte, et que ça ne regarde qu'elle.
          hint: half
            ? "608×448, environ 5,6 Mbit/s. Le choix est le tien seul."
            : "1216×896, environ 14 Mbit/s. Réduis si l'image saccade.",
          icon: <ScreenIcon className="h-full w-full" />,
          picks: [
            { id: "full", label: "pleine taille", hint: "1216×896 · ~14 Mbit/s" },
            { id: "half", label: "réduit", hint: "608×448 · ~5 Mbit/s" },
          ],
          picked: half ? "half" : "full",
          onPick: (id) => {
            const wanted = id === "half";
            session?.video.setHalf(wanted);
            setHalf(wanted);
          },
        },
        {
          id: "touchpad",
          label: "manette à l'écran",
          value: touchLabel(touchPref),
          hint: "Pour jouer au téléphone. Elle se fond avec le clavier et les manettes: on peut tenir les deux.",
          icon: <PadIcon className="h-full w-full" />,
          picks: TOUCHPADS.map((choice) => ({
            id: choice.id,
            label: choice.label,
            hint: choice.note,
          })),
          picked: touchPref,
          onPick: (id) => setTouchPref(id as typeof touchPref),
        },
        {
          id: "padonly",
          label: "cette page en manette",
          value: padOnly ? "sans image" : "avec l'image",
          hint: "Pour un téléphone posé à côté d'un écran qui montre déjà le jeu. Il cesse de décoder une vidéo que personne ne regarde : mesuré à 13,6 Mbit/s par appareil, c'est autant de wifi et de batterie rendus.",
          icon: <PadIcon className="h-full w-full" />,
          picks: [
            { id: "avec", label: "avec l'image", hint: "le jeu s'affiche ici" },
            {
              id: "sans",
              label: "manette seule",
              hint: "ni image ni son sur cet appareil",
            },
          ],
          picked: padOnly ? "sans" : "avec",
          // Changer de mode reconstruit la session, donc la place tenue est
          // rendue puis reprise. C'est visible, et c'est le prix de ne plus
          // ouvrir la socket vidéo du tout.
          onPick: (id) => onPadOnly(id === "sans"),
        },
        {
          id: "fit",
          label: "image à l'écran",
          value: fitLabel(fit),
          hint: "ce qu'on affiche, séparé de ce qu'on transporte",
          icon: <ExpandIcon className="h-full w-full" />,
          // Chaque choix annonce la taille QU'IL DONNERAIT, et pas seulement ce
          // qu'il promet. Sans ça, deux choix qui rendent exactement la même
          // image — ce qui arrive dès que la source est proche de l'écran — se
          // présentent comme deux choix différents, et on croit que le réglage
          // ne fait rien.
          picks: FITS.map((choice) => {
            const would = place(choice.id, picture, space);
            const size =
              would.width > 0 ? `${Math.round(would.width)}×${Math.round(would.height)}` : "";
            return {
              id: choice.id,
              label: choice.label,
              hint: size ? `${size} · ${choice.note}` : choice.note,
            };
          }),
          picked: fit,
          preview: true,
          onPick: (id) => {
            const found = FITS.find((choice) => choice.id === id);
            if (found) setFit(found.id);
          },
        },
        {
          id: "volume",
          label: "volume",
          value: `${Math.round(volume * 100)}`,
          hint: "A pour ouvrir la glissière",
          icon: <VolumeIcon className="h-full w-full" />,
          // En pour-cent et non en fraction: la glissière avance par crans
          // entiers, et un cran de 0,05 sur une valeur de 0 à 1 se lit mal quand
          // il faut l'arrondir à la souris.
          slide: {
            value: Math.round(volume * 100),
            min: 0,
            max: 100,
            step: 5,
            say: (at) => `${at} %`,
            onSet: (at) => setVolume(at / 100),
          },
        },
        {
          id: "theme",
          label: "couleurs",
          value: themeLabel(theme),
          hint: "A pour voir les sept",
          icon: <PaletteIcon className="h-full w-full" />,
          picks: THEMES.map((choice) => ({
            id: choice.id,
            label: choice.label,
            hint: choice.note,
          })),
          picked: theme,
          onPick: (id) => {
            const found = THEMES.find((choice) => choice.id === id);
            if (found) setTheme(found.id);
          },
        },
        {
          id: "shell",
          // Une entrée nommée « menu », dans un menu, est une devinette. Ce
          // qu'elle choisit est le tableau de bord de quelle console.
          label: "tableau de bord",
          value: shellLabel(shell),
          hint: "A pour voir les consoles",
          icon: <LayoutIcon className="h-full w-full" />,
          picks: SHELLS.map((choice) => ({ id: choice.id, label: choice.label })),
          picked: shell,
          onPick: (id) => {
            const found = SHELLS.find((choice) => choice.id === id);
            if (found) setShell(found.id);
          },
        },
        {
          id: "pad",
          label: "manette des jeux Wii",
          value: padLabel(pad),
          // La manette d'un jeu Wii est un RÉGLAGE, pas une décision de partie.
          // Elle a vécu une journée dans le panneau de lancement, à côté de la
          // sauvegarde: c'était le mauvais endroit. Une sauvegarde se choisit
          // par partie, une manette se choisit une fois.
          //
          // Une seule des deux à la fois: elles lisent le même tuyau, et un jeu
          // qui voit les deux compte deux manettes pour une personne. À deux
          // joueurs, le premier occupe deux places et le second n'entre jamais.
          // Deux choses changent d'un coup, et taire la seconde ferait croire à
          // un réglage perdu: la manette que le jeu voit, ET le jeu de touches
          // qu'on règle sous « touches ».
          // Ce que ça coûte de changer, et ce n'est plus le même prix pour les
          // trois. Passer du Nunchuk à la guitare ne relance rien: c'est la même
          // Wiimote avec autre chose au bout, et Dolphin échange une extension
          // en cours de partie. Aller vers la manette GameCube, ou en revenir,
          // change d'APPAREIL et demande de repartir.
          hint:
            room?.game?.console === "wii"
              ? pad === 0
                ? "chaque manette a ses propres touches. Passer à la Wiimote relance le jeu."
                : "chaque manette a ses propres touches. Entre Wiimote et guitare, rien ne relance."
              : "chaque manette a ses propres touches. Vaudra pour le prochain jeu Wii lancé.",
          icon: <PadIcon className="h-full w-full" />,
          picks: PADS.map((one) => ({
            id: String(one.id),
            label: one.label,
            hint: one.note,
          })),
          picked: String(pad),
          // Relu dans la table, jamais deviné: la version d'avant faisait
          // `id === "1" ? 1 : 0`, donc la guitare retombait sur la manette
          // GameCube sans un mot.
          onPick: (id: string) => {
            const wanted = PADS.find((one) => String(one.id) === id)?.id;
            if (wanted !== undefined) switchPad(wanted);
          },
        },
        {
          id: "bindings",
          // « touches » sous-vendait: cet écran règle aussi les manettes.
          label: "touches et manettes",
          // Dit quel jeu de touches on va régler. Il y en a un par type de
          // manette, et personne ne peut le deviner depuis une entrée qui
          // s'appelle « touches ».
          hint: `l'antisèche, et de quoi les changer · ${padLabel(pad)}`,
          icon: <KeysIcon className="h-full w-full" />,
          // Le menu reste ouvert DERRIÈRE: renvoyer quelqu'un dans la partie
          // pour changer une touche est exactement ce qu'on ne veut pas.
          onEnter: () => setBindings(true),
        },
        {
          id: "deviceRate",
          label: "fréquence de la carte son",
          value: deviceRate ? "oui" : "non",
          hint: "évite un rééchantillonnage, mais le tampon peut être plus long",
          icon: <WaveIcon className="h-full w-full" />,
          onEnter: () => setDeviceRate(!deviceRate),
        },
        {
          id: "lipsync",
          label: "image calée sur le son",
          value: lipsync ? "oui" : "non",
          hint: "retarde l'image du retard mesuré du son",
          icon: <SyncIcon className="h-full w-full" />,
          onEnter: () => setLipsync(!lipsync),
        },
        {
          id: "bare",
          // Un nom, comme les treize autres. La phrase à l'impératif est le
          // travail de l'aide, pas du titre.
          label: "colonne de droite",
          value: bare ? "repliée" : "visible",
          hint: "rend toute la largeur à l'image (F)",
          icon: <PanelIcon className="h-full w-full" />,
          onEnter: () => setBare(!bare),
        },
        {
          id: "fullscreen",
          label: "plein écran",
          value: fullscreen ? "oui" : "non",
          icon: <ExpandIcon className="h-full w-full" />,
          onEnter: toggleFullscreen,
        },
      ]),
    },
    {
      id: "mesures",
      label: "mesures",
      icon: <MeasureIcon className="h-full w-full" />,
      items: [
        {
          id: "images",
          label: "images",
          value: `${shot?.video.painted ?? 0} peintes`,
          hint: `${(shot?.video.refreshHz ?? 0).toFixed(0)} Hz à l'écran, marge ${(shot?.video.slackMs ?? 0).toFixed(0)} ms`,
          icon: <ScreenIcon className="h-full w-full" />,
        },
        {
          id: "son",
          label: "son",
          value: shot?.sound.state ?? "absent",
          hint:
            shot?.soundGapMs == null
              ? "aucun écart mesuré"
              : `${shot.soundGapMs.toFixed(0)} ms derrière l'image`,
          icon: <SoundIcon className="h-full w-full" />,
        },
        {
          id: "manette",
          label: "manette",
          value: port === null ? "aucune" : `port ${port}`,
          hint: `${shot?.input.sent ?? 0} trames envoyées`,
          icon: <PadIcon className="h-full w-full" />,
        },
      ],
    },
  ];

  return (
    <div className="flex h-full">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Screen
          canvasRef={ref}
          connected={shot?.video.connected ?? false}
          fit={fit}
          picture={shot?.video.picture ?? { width: 0, height: 0 }}
          onSpace={setSpace}
          onPrescale={(times) => session?.video.setPrescale(times)}
        />
        {/* Ce qu'on voit quand cet appareil ne sert que de manette.
            Un écran noir se lit comme une panne, et c'en est une pour qui a
            oublié avoir choisi ce mode. La toile reste montée derrière: elle
            appartient à la boucle média, qui la tient par une référence, et la
            démonter reviendrait à mettre React sur le chemin des images. */}
        {/* Le format a été réduit tout seul: on le DIT, et on laisse revenir.
            Réduire en silence ferait chercher pourquoi l'image est devenue
            moins nette, ce qui est exactement le temps qu'on essaie de rendre. */}
        {reduced ? (
          <div
            id="reducedNotice"
            className="absolute inset-x-0 bottom-4 z-20 mx-auto flex max-w-[46ch] flex-col gap-2 border border-rule bg-panel px-4 py-3 text-center"
          >
            <p className="text-[13px] leading-relaxed text-bright">
              Ton lien ne suivait pas: l&apos;image est passée en format réduit.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                id="keepReduced"
                onClick={() => setReduced(false)}
                className="border border-rule px-2 py-0.5 text-[11px] text-muted hover:border-rule-bright"
              >
                d&apos;accord
              </button>
              <button
                type="button"
                id="undoReduced"
                onClick={() => {
                  setDeclined(true);
                  session?.video.setHalf(false);
                  setHalf(false);
                  setReduced(false);
                }}
                className="border border-indigo px-2 py-0.5 text-[11px] text-indigo"
              >
                revenir en pleine taille
              </button>
            </div>
          </div>
        ) : null}
        {padOnly ? (
          <div
            id="padOnlyNotice"
            className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink px-6 text-center"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
              manette seule
            </span>
            <p className="max-w-[42ch] text-[13px] leading-relaxed text-muted">
              Cet appareil ne décode ni l&apos;image ni le son. Il envoie les boutons et il vibre,
              c&apos;est tout.
            </p>
            <p className="font-mono text-[12px] text-muted">
              aller-retour{" "}
              {shot?.input.roundTripMs === null || shot === null
                ? "pas encore mesuré"
                : `${shot.input.roundTripMs} ms`}
            </p>
          </div>
        ) : null}
        {/* La manette à l'écran, par-dessus l'image et sous le menu.
            Montée seulement quand elle sert: cent boutons invisibles au-dessus
            d'une partie jouée au clavier intercepteraient des clics. */}
        {/* Cachée, elle laisse une porte pour revenir.
            « Cacher » sans retour est un piège: sur un téléphone il n'y a ni
            Échap ni menu atteignable une fois la colonne repliée, donc le geste
            était définitif pour la visite. Signalé le 18 août 2026. */}
        {session && !onTouch && coarse ? (
          <button
            type="button"
            id="showTouch"
            onClick={() => setTouchPref("on")}
            className="absolute bottom-3 left-3 z-30 rounded-full border border-rule bg-panel/70 px-4 py-2 text-[11px] uppercase tracking-[0.14em] text-faint"
          >
            manette
          </button>
        ) : null}
        {session && onTouch ? (
          <TouchPad
            /* La largeur des bandes noires de chaque côté de l'image.
             *
             * La page la connaît déjà: elle mesure la place et calcule le
             * placement pour le menu. La manette s'en sert pour se ranger DANS
             * les bandes plutôt que par-dessus le jeu, ce qui est la différence
             * entre des boutons posés sur du noir et des boutons posés sur les
             * pieds du personnage. Quand il n'y a pas de bande, elle retombe sur
             * les coins. */
            bar={Math.max(0, (space.width - place(fit, picture, space).width) / 2)}
            touch={session.input.touch}
            soundOff={shot ? shot.sound.state !== "running" : false}
            onSound={() => {
              // Démarrer PUIS biper, dans cet ordre et dans le même geste: le
              // bip ne sort de rien tant que le contexte n'a pas repris.
              void session.sound.start().then(() => session.sound.beep());
            }}
            onLeave={() => setTouchPref("off")}
            onMenu={() => setMenu(true)}
          />
        ) : null}
        {bare && !onTouch ? (
          /* Replié, il reste de quoi revenir. Discret et dans un coin: une barre
             permanente par-dessus l'image rendrait le repli inutile.
             Pas quand la manette à l'écran est là: elle porte les mêmes gestes,
             et ces deux boutons-ci tombaient pile sur Z et R. */
          <div className="absolute top-2 right-2 flex gap-1 opacity-30 transition-opacity hover:opacity-100">
            <button
              type="button"
              id="unbare"
              onClick={() => setBare(false)}
              className="border border-rule bg-panel px-2 py-1 text-[11px] text-muted"
            >
              montrer (F)
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              className="border border-rule bg-panel px-2 py-1 text-[11px] text-muted"
            >
              {fullscreen ? "fenêtre" : "plein écran"}
            </button>
          </div>
        ) : null}
        {asked ? (
          <AskedBanner
            from={asked.from}
            port={asked.port}
            lasts={room?.ask_lasts ?? 10}
            onAnswer={onAnswer}
            onExpire={onExpire}
          />
        ) : asking ? (
          <Asking port={asking.port} said={asking.said} onClose={onForgetAsk} />
        ) : null}

        {learning ? (
          <div className="flex items-center justify-between gap-4 border-t border-indigo/40 bg-indigo/10 px-4 py-2 text-[12px]">
            <span>
              apprentissage de la manette, appuie sur{" "}
              <strong className="text-indigo">{learning}</strong>
            </span>
            <button
              type="button"
              id="skipStep"
              onClick={() => session?.input.skipLessonStep()}
              className="border border-indigo/50 px-2 py-1 text-[11px] text-indigo"
            >
              passer
            </button>
          </div>
        ) : null}
      </main>

      {bare ? null : (
        <aside
          id="side"
          className="flex w-[19rem] shrink-0 flex-col gap-3 overflow-y-auto border-l border-rule bg-panel px-3 py-3"
        >
          <header className="flex flex-col gap-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-indigo">
              nel3ab
            </span>
            <h1 className="truncate text-[15px] font-medium">{room?.name ?? "salon"}</h1>
            <p className="truncate text-[12px] text-muted">{room?.game?.name ?? "aucun jeu"}</p>
            <p id="seat" className="text-[11px] text-faint">
              {name}
              {port === null ? " · sans manette" : ` · manette ${port}`}
            </p>
          </header>

          <Panel title="manettes">
            <Seats
              players={shot?.input.players ?? 4}
              busy={shot?.input.busy ?? []}
              names={names}
              mine={port}
              displaced={shot?.input.displaced ?? false}
              onTake={(chosen) => session?.input.take(chosen)}
              onAsk={onAsk}
            />
          </Panel>

          {/* Le clip, à portée sans ouvrir le menu.
              Trente secondes ne se demandent pas après coup: on appuie pendant
              que ça se passe, et poser un menu plein écran par-dessus le jeu
              qu'on voulait garder est le mauvais moment. C'est ce qui l'a fait
              descendre du menu vers ici.
              Un seul bouton pour deux gestes — demander, puis enregistrer —
              parce que c'est une seule chose du point de vue de la personne. */}
          <button
            type="button"
            id="clip"
            onClick={takeClip}
            disabled={clip.state.phase === "en cours" || clip.state.phase === "attendre"}
            title={
              clip.state.phase === "fait"
                ? "l'enregistrer, puis le partager"
                : clip.state.phase === "attendre"
                  ? "un clip couvre trente secondes, donc deux clips plus rapprochés se recouvrent"
                  : clip.state.phase === "raté"
                    ? clip.state.why
                    : "les trente dernières secondes, en un fichier"
            }
            className={cn(
              "flex items-center justify-between gap-2 border px-3 py-2 text-[13px] transition-colors",
              clip.state.phase === "fait"
                ? "border-good/60 text-good hover:bg-good/10"
                : clip.state.phase === "raté"
                  ? "border-alert/60 text-alert"
                  : "border-rule text-muted hover:border-rule-bright hover:text-text",
              (clip.state.phase === "en cours" || clip.state.phase === "attendre") &&
                "cursor-not-allowed",
            )}
          >
            <span className="flex items-center gap-2">
              <span className="flex h-4 w-4 [&>svg]:h-full [&>svg]:w-full">
                <ScreenIcon className="h-full w-full" />
              </span>
              {clipLabel(clip.state)}
            </span>
            {clip.state.phase === "fait" ? (
              <span className="font-mono text-[11px]">{Math.round(clip.state.bytes / 1e6)} Mo</span>
            ) : null}
          </button>

          <button
            type="button"
            id="openMenu"
            onClick={() => setMenu(true)}
            className="border border-indigo/60 px-3 py-2 text-[13px] text-indigo transition-colors hover:bg-indigo/10"
          >
            menu (Échap)
          </button>

          <Sidebar
            mode={mode}
            onMode={setMode}
            people={people}
            players={shot?.input.players ?? 4}
            busy={shot?.input.busy ?? []}
            names={names}
            mine={port}
            shot={shot}
            volume={volume}
            onVolume={setVolume}
            onSound={() => void session?.sound.start()}
            seated={port !== null}
            onWatch={() => session?.input.watchOnly()}
            onPlay={() => session?.input.play()}
            onLeave={onLeave}
            suggestHalf={suggestHalf}
            onTakeHalf={() => {
              session?.video.setHalf(true);
              setHalf(true);
              rough.current.settled();
              setSuggestHalf(false);
            }}
            onKeepFull={() => {
              rough.current.settled();
              setSuggestHalf(false);
            }}
            onFold={coarse ? () => setBare(true) : undefined}
            onComplain={() => {
              const now = sample();
              if (now) {
                sending.current.complain({ ...now, fin: trail.current.trail(performance.now()) });
              }
            }}
          />
        </aside>
      )}

      {/* L'écran de chargement prend AUSSI la place de l'ancienne étiquette
          « en attente de l'image », qui ne disait rien d'utile. La salle s'arrête
          pour toutes sortes de raisons — quelqu'un d'autre change de jeu, le
          worker est relancé — et dans tous ces cas ce qu'on veut lire est ce qui
          arrive, avec le nom du jeu.

          Sept centièmes de seconde de noir avant de le montrer: plus court ne se
          voit pas, et un hoquet ne doit pas faire clignoter un écran plein. Rien
          pour une page-manette, qui n'a pas d'image à attendre. */}
      {booting === null && darkFor > 700 && shot && !shot.padOnly ? (
        <Booting game={room?.game?.name ?? "la salle"} step="asked" />
      ) : null}

      {booting ? (
        <Booting
          game={booting.game}
          save={booting.save}
          step={
            ((shot?.video.connected ?? false)
              ? shot && !shot.video.awaitingRestart && shot.video.paintedSince > 0
                ? "painting"
                : "waiting"
              : "asked") as Step
          }
        />
      ) : null}

      {menu && shot
        ? (() => {
            const common = {
              categories: rays,
              onClose: () => {
                // Retour: on remonte d'un ÉTAGE avant de fermer. Sortir du menu
                // depuis l'intérieur d'un dossier obligerait à rouvrir et à
                // redescendre pour corriger un clic, et c'est le geste qu'on
                // fait le plus souvent après s'être trompé de console.
                if (folder !== null) return setFolder(null);
                setMenu(false);
              },
              onPad: (handler: ((action: MenuAction) => void) | null) =>
                session?.input.setMenu(handler),
              // Pendant que l'écran des touches est ouvert par-dessus, le menu
              // reste affiché mais n'écoute plus: sinon réassigner une flèche
              // ferait aussi défiler la liste dessous.
              paused: bindings,
              footer: `${room?.name ?? "salon"} · ${people.length} présent${people.length > 1 ? "s" : ""}`,
            };
            if (shell === "wii") return <Channels {...common} />;
            if (shell === "switch") return <Home {...common} who={name} />;
            return <Xmb {...common} />;
          })()
        : null}

      {bindings && shot ? (
        <Bindings
          console={room?.game?.console ?? "gc"}
          held={pad}
          onPickKeys={(chosen) => {
            session?.input.pickKeys(chosen);
            session?.refresh();
          }}
          onNewKeys={(chosen) => {
            session?.input.newKeys(chosen);
            session?.refresh();
          }}
          onForgetKeys={(chosen) => {
            session?.input.forgetKeys(chosen);
            session?.refresh();
          }}
          /* Le bouton n'existe que pour celui qui tient la salle. Le service
             vérifie l'adresse de son côté: cacher un bouton n'est pas une
             règle, c'est du confort. */
          onPublish={
            publishes
              ? (chosen) => {
                  const profile = session?.input.keyProfileNamed(chosen);
                  if (profile) void publishProfile(chosen, profile);
                }
              : undefined
          }
          state={shot.input}
          // Chaque action est suivie d'un `refresh`: ce sont des changements
          // locaux et immédiats, et attendre le prochain instantané ferait
          // clignoter l'écran une demi-seconde plus tard.
          onUse={(index) => {
            session?.input.useP(index);
            session?.refresh();
          }}
          onCapture={(control, source) => {
            session?.input.beginCapture(control, source);
            session?.refresh();
          }}
          onCancel={() => {
            session?.input.cancelCapture();
            session?.refresh();
          }}
          onLearn={() => {
            session?.input.beginLesson();
            setBindings(false);
          }}
          onResetPad={() => {
            session?.input.resetPad();
            session?.refresh();
          }}
          onResetKeys={() => {
            session?.input.resetKeys();
            session?.refresh();
          }}
          onClose={() => {
            session?.input.cancelCapture();
            setBindings(false);
          }}
        />
      ) : null}
    </div>
  );
}
