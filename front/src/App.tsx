/**
 * The room: a picture, and a column of instruments beside it.
 *
 * The picture takes the height of the window and never causes the page to
 * scroll. Everything else lives in a fixed column on the right that scrolls
 * inside itself, so reading a number never moves the image and never asks
 * anybody to scroll away from the game they are playing.
 */
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
  WatchIcon,
  WaveIcon,
} from "./components/XmbIcons";
import { Panel } from "./components/Readout";
import { Screen } from "./components/Screen";
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
  storedShell,
  storedTheme,
  themeLabel,
} from "./lib/theme";
import { FITS, fitLabel, place, rememberFit, storedFit } from "./lib/fit";
import { useBare } from "./lib/fullscreen";
import { useMe, useRename } from "./lib/me";
import { useLobby, useRoom, type Asked } from "./lib/room";
import {
  Struggling,
  Trailing,
  TRAIL_EVERY,
  vitals,
  worthWriting,
  type Trail,
  type Vitals,
} from "./lib/vitals";
import type { Snapshot } from "./media/session";
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
  const [local, setLocal] = useState(rememberedName);
  /** Comment on est entré: pour jouer, pour regarder, ou pas encore.
   *
   * Trois états et non un booléen, parce que « regarder » se décide AVANT que la
   * session existe. Construite en joueur puis corrigée après, elle prendrait une
   * manette le temps d'un aller-retour et l'aurait affiché à toute la salle. */
  const [entered, setEntered] = useState<null | "play" | "watch">(null);

  // Rien tant que l'identité n'a pas répondu: afficher le formulaire une demi
  // seconde avant de le retirer se lit comme un défaut.
  if (isPending) return null;

  const identified = me?.login ?? null;
  const name = identified ? me!.name : local;
  if (!name) return <Entrance onName={setLocal} />;
  return (
    <Named
      name={name}
      login={identified}
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
  entered,
  onEnter,
  onWatch,
  onLeave,
  onForget,
}: {
  name: string;
  login: string | null;
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

  const lobby = useLobby(
    login ?? name,
    name,
    (heard) => setAsked(heard),
    (answer) => {
      setAsking({ port: answer.port, said: answer.ok ? null : `${answer.from} a dit non` });
      // Accepté: la place vient d'être libérée, on s'y branche. `take` plutôt
      // qu'attendre la reconnexion polie, parce qu'une autre page libre la
      // prendrait entre-temps et que la demande était pour NOUS.
      if (answer.ok) takeSeat.current?.(answer.port);
    },
  );
  const takeSeat = useRef<((port: number) => void) | null>(null);
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
      room={room}
      watching={entered === "watch"}
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
      bind={(take, give) => {
        takeSeat.current = take;
        yieldSeat.current = give;
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

function Room({
  name,
  login,
  room,
  watching,
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
  room: RoomState | undefined;
  /** Vrai quand on est entré pour regarder. Lu une fois, à la construction de la
   * session; changer d'avis ensuite passe par la session. */
  watching: boolean;
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
  bind: (take: (port: number) => void, give: () => void) => void;
  /** Où envoyer ce que ce navigateur mesure. La socket du salon vit à l'étage
   * du dessus, les chiffres vivent ici. */
  tell: {
    vitals: (sample: Vitals) => void;
    /** Un signalement emporte en plus les deux dernières minutes à la seconde:
     * la question devant un « ça saccade » est toujours « et juste avant ? ». */
    complain: (sample: Vitals & { fin: Trail }) => void;
  };
}) {
  const { bare, setBare, fullscreen, toggleFullscreen } = useBare();
  const [volume, setVolume] = useState(0.7);
  const [deviceRate, setDeviceRate] = useState(false);
  const [lipsync, setLipsync] = useState(false);
  const [bindings, setBindings] = useState(false);
  const [menu, setMenu] = useState(false);
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
  /** La place dont l'image dispose, rapportée par l'écran. Sert au menu, qui
   * annonce ce que chaque choix donnerait. */
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useEffect(() => rememberFit(fit), [fit]);
  useEffect(() => rememberShell(shell), [shell]);
  useEffect(() => rememberMode(mode), [mode]);
  /** Le jeu demandé et l'image peinte au moment où on l'a demandé.
   *
   * Deux choses parce que la fin du chargement se reconnaît à une IMAGE, pas à
   * une socket: le worker répond avant que Dolphin ait dessiné quoi que ce soit,
   * et cacher l'écran de chargement là montrerait du noir. */
  const [booting, setBooting] = useState<{ game: string; painted: number } | null>(null);
  /** Le jeu qui attend une confirmation. Changer de jeu arrête la partie de tout
   * le monde, donc la première entrée arme et la seconde lance. */
  const [armedGame, setArmedGame] = useState<number | null>(null);

  const { ref, session } = useSession(volume, deviceRate, announceSeat, watching);
  const shot = useSnapshot(session);

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

  useEffect(() => session?.sound.setVolume(volume), [session, volume]);
  useEffect(() => session?.sound.setDeviceRate(deviceRate), [session, deviceRate]);
  useEffect(() => session?.setLipsync(lipsync), [session, lipsync]);
  // Échap ouvre le menu, comme sur une console. Les écrans qui se ferment avec
  // Échap (menu, touches) le gèrent eux-mêmes, donc on ne l'ouvre que quand
  // rien n'est ouvert.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (event.key === "Escape" && !menu && !bindings) setMenu(true);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [menu, bindings]);

  useEffect(() => {
    if (booting === null || shot === null) return;
    // Une trentaine d'images après la reprise: la toute première est parfois une
    // image-clé du jeu précédent restée dans le décodeur, et disparaître dessus
    // ferait clignoter l'ancien jeu une demi-seconde.
    if (shot.video.painted > booting.painted + 30) setBooting(null);
  }, [booting, shot]);
  useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);

  const port = shot?.input.port ?? null;
  const learning = shot?.input.learning ?? null;
  const people = room?.people ?? [];

  const boss = room?.owner ?? null;
  const mine = boss === null || (login !== null && boss.login === login);
  const whyNotChoose =
    port === null
      ? "prends une manette pour changer de jeu"
      : mine
        ? null
        : `${boss?.name ?? "quelqu'un"} décide du jeu dans cette salle`;

  // De quoi prendre et céder une place, rendu à l'étage du dessus où vit la
  // socket du salon.
  useEffect(() => {
    bind(
      (chosen) => session?.input.take(chosen),
      () => session?.input.yieldSeat(),
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
  useEffect(() => {
    if (session) setHalf(session.video.isHalf());
  }, [session]);

  const rays: XmbCategory[] = [
    {
      id: "jeux",
      label: "jeux",
      icon: <GameIcon className="h-full w-full" />,
      items: (room?.library ?? []).map((game) => ({
        id: `game${game.index}`,
        label: game.name,
        // Une première pression ARME et ne lance rien: ce qu'elle confirme est
        // la fin de la partie de tout le monde. Elle ne se voyait nulle part,
        // donc elle ressemblait à un clic qui n'avait pas pris, ce qui pousse
        // exactement au deuxième clic que la confirmation devait faire réfléchir.
        value:
          armedGame === game.index
            ? "confirmer ?"
            : game.index === room?.game?.index
              ? "en cours"
              : undefined,
        hint:
          armedGame === game.index
            ? "encore une fois pour lancer, ailleurs pour annuler"
            : game.index === room?.game?.index
              ? "c'est ce qui tourne"
              : mine
                ? "entrée deux fois: changer de jeu arrête la partie de tout le monde"
                : (whyNotChoose ?? undefined),
        icon: <GameIcon className="h-full w-full" />,
        game: { index: game.index, art: game.art ?? false },
        by: game.maker ?? undefined,
        note: game.about ?? undefined,
        disabled: !mine || game.index === room?.game?.index,
        onEnter: () => {
          if (armedGame !== game.index) return setArmedGame(game.index);
          setArmedGame(null);
          if (session?.input.chooseGame(game.index)) {
            setBooting({ game: game.name, painted: shot?.video.painted ?? 0 });
            setMenu(false);
          }
        },
      })),
    },
    {
      id: "salle",
      label: "salle",
      icon: <RoomIcon className="h-full w-full" />,
      items: Array.from({ length: shot?.input.players ?? 4 }, (_, slot) => slot + 1)
        .map<XmbItem>((seat) => {
          const held = shot?.input.busy[seat - 1] ?? false;
          const isMine = seat === port;
          const who = people.find((person) => person.seat === seat);
          return {
            id: `port${seat}`,
            label: `manette ${seat}`,
            value: isMine ? "toi" : held ? (who?.name ?? names.get(seat) ?? "occupée") : "libre",
            hint: isMine
              ? "c'est la tienne"
              : who
                ? "entrée: lui demander de te la passer"
                : held
                  ? "personne ne répond dessus: entrée pour la reprendre"
                  : "entrée pour t'y brancher",
            icon: <PadIcon className="h-full w-full" />,
            disabled: isMine,
            onEnter: () => {
              if (who) {
                onAsk(seat);
                setMenu(false);
                return;
              }
              session?.input.take(seat);
            },
          };
        })
        .concat([
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
      items: [
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
          label: "format transporté",
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
          id: "fit",
          label: "taille à l'écran",
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
          label: "ambiance",
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
          label: "menu",
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
          id: "bindings",
          label: "touches",
          hint: "l'antisèche, et de quoi les changer",
          icon: <KeysIcon className="h-full w-full" />,
          // Le menu reste ouvert DERRIÈRE: renvoyer quelqu'un dans la partie
          // pour changer une touche est exactement ce qu'on ne veut pas.
          onEnter: () => setBindings(true),
        },
        {
          id: "deviceRate",
          label: "laisser la carte son choisir sa fréquence",
          value: deviceRate ? "oui" : "non",
          hint: "évite un rééchantillonnage, mais le tampon peut être plus long",
          icon: <WaveIcon className="h-full w-full" />,
          onEnter: () => setDeviceRate(!deviceRate),
        },
        {
          id: "lipsync",
          label: "caler l'image sur le son",
          value: lipsync ? "oui" : "non",
          hint: "retarde l'image du retard mesuré du son",
          icon: <SyncIcon className="h-full w-full" />,
          onEnter: () => setLipsync(!lipsync),
        },
        {
          id: "bare",
          label: "replier la colonne",
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
      ],
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
        {bare ? (
          /* Replié, il reste de quoi revenir. Discret et dans un coin: une barre
             permanente par-dessus l'image rendrait le repli inutile. */
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
            onComplain={() => {
              const now = sample();
              if (now) {
                sending.current.complain({ ...now, fin: trail.current.trail(performance.now()) });
              }
            }}
          />
        </aside>
      )}

      {booting ? (
        <Booting
          game={booting.game}
          step={
            ((shot?.video.connected ?? false)
              ? shot && shot.video.painted > booting.painted
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
              onClose: () => setMenu(false),
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
