/**
 * The room: a picture, and a column of instruments beside it.
 *
 * The picture takes the height of the window and never causes the page to
 * scroll. Everything else lives in a column on the right that scrolls inside
 * itself, so reading a number never moves the image and never asks anybody to
 * scroll away from the game they are playing. Its width is dragged between two
 * bounds (`lib/column`), and the picture takes whatever is left.
 */
import { Bobine } from "./bobine/Bobine";
import { MUTE_SETTLES_MS, muteNews, type MuteNews } from "./lib/sourdine";
import { typingIn } from "./lib/typing";
import { base, salle, under } from "./lib/base";
import { Crown } from "./components/Crown";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { closeSalle, type Room as RoomState } from "./client";
import { SetupProfiles } from "./components/SetupProfiles";
import { GameCard } from "./components/GameCard";
import { setupGameKey } from "./lib/setups";
import { Preparation } from "./components/Preparation";
import { useSetupChoice } from "./lib/useSetupChoice";
import { Bindings } from "./components/Bindings";
import { Entrance } from "./components/Entrance";
import { Lobby } from "./components/Lobby";
import { ControllerStatus } from "./components/ControllerStatus";
import { manetteAConfigurer } from "./lib/plug";
import { dire } from "./lib/liaison-mots";
import { ETROIT_SOUS } from "./lib/menu-xmb";
import { entreeConnexion } from "./lib/rayons";
import { useMicro } from "./lib/micro";
import { Booting } from "./components/Booting";
import { EtatSalle } from "./components/EtatSalle";
import { LigneParlee } from "./components/LigneParlee";
import { Ouverture } from "./components/Ouverture";
import { attenteDemarrage, bootingStep, suiteDuChargement } from "./lib/booting";
import { GardeSignalement } from "./lib/garde-signalement";
import { FENETRE_VIDE, fenetrePourProposition, type Liaison } from "./media/liaison";
import {
  AutresReglages,
  BlocRole,
  Colonne,
  IlsRegardent,
  RangAgrandir,
  RangManette,
  RangMenu,
  RangSon,
} from "./components/Colonne";
import { Coin } from "./components/Coin";
import { EcranEteint, phraseDuRepos } from "./components/EcranEteint";
import { PanneauCommande } from "./components/PanneauCommande";
import { ConnectionDiagnostic } from "./components/ConnectionDiagnostic";
import { Instruments } from "./components/Instruments";
import { MesuresTechniques } from "./components/MesuresTechniques";
import { Signaler } from "./components/Signaler";
import { rangsDeLaColonne } from "./lib/colonne";
import { ColumnHandle } from "./components/ColumnHandle";
import { Recovery } from "./components/Recovery";
import { Asked as AskedBanner } from "./components/Swap";
import { Channels } from "./components/Channels";
import { Home } from "./components/Home";
import { Xmb, type XmbCategory, type XmbItem } from "./components/Xmb";
import type { MenuAction } from "./media/menupad";
import {
  ConsoleIcon,
  ExpandIcon,
  GameIcon,
  KeysIcon,
  LayoutIcon,
  LeaveIcon,
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
import { Screen } from "./components/Screen";
import { SwitchTouchPad } from "./components/SwitchTouchPad";
import { TouchPad } from "./components/TouchPad";
import { Seats } from "./components/Seats";
import { forgetName, rememberedName } from "./lib/name";
import {
  SHELLS,
  THEMES,
  applyTheme,
  rememberMode,
  rememberLobby,
  rememberShell,
  rememberTheme,
  shellLabel,
  storedMode,
  looksLikeAPhone,
  rememberPadOnly,
  rememberTouch,
  showsTouchPad,
  storedPadOnly,
  storedLobby,
  storedShell,
  storedTheme,
  storedTouch,
  TOUCHPADS,
  touchLabel,
  themeLabel,
} from "./lib/theme";
import { FITS, fitLabel, place, qualities, rememberFit, storedFit } from "./lib/fit";
import { useBare } from "./lib/fullscreen";
import {
  apresCtrl,
  couchesDeLaSalle,
  focusApresFermeture,
  ouvrirLaSalle,
  useEnTiroir,
  voileSurImage,
} from "./lib/disposition";
import { entreesDeLaFeuille, nomDuPlus, OUVRE_LA_FEUILLE } from "./lib/feuille";
import { lireAppareil, pleinEcranPossible } from "./lib/plein-ecran";
import { armerReveilDuSon } from "./media/reveil-son";
import { FeuilleDuBas } from "./components/FeuilleDuBas";
import { BarreDuTiroir, TiroirSi } from "./components/Tiroir";
import { COLUMN, rememberColumn, storedColumn, widest } from "./lib/column";
import { publishProfile, useBindings, useRoomReference } from "./lib/bindings";
import { cn } from "./lib/cn";
import { arrange, avecAvances, MANETTES, selonAppareil } from "./lib/settings";
import { aideDeLaSalle, appareilDe, pour } from "./lib/appareil";
import { clavierEnPause, useFocusJeu } from "./lib/focus-jeu";
import { aideDejaVue, aideDolphin, aidePro, retenirAideVue } from "./lib/aide-clavier";
import { keyLabel, keyboardLayout } from "./media/describe";
import { AideClavier } from "./components/AideClavier";
import { HoteDesSurcouches, Surcouche } from "./components/Surcouche";
import { useMe, useMenuIdentity, useRename } from "./lib/me";
import {
  useLobby,
  useRoom,
  type Asked,
  type RecoveryNotice,
  type Booting as Told,
} from "./lib/room";
import {
  HiddenTime,
  Struggling,
  Trailing,
  TRAIL_EVERY,
  vitals,
  VITALS_EVERY,
  worthWriting,
  type Trail,
  type Vitals,
} from "./lib/vitals";
import type { ControlKey } from "./media/pad";
import type { Session, Snapshot } from "./media/session";
import { clipAide, clipLabel, micAide } from "./lib/clip";
import { SwitchBindings } from "./components/SwitchBindings";
import { CONSOLES, launchable, moteurDe, preparable, usesProInput } from "./lib/consoles";
import {
  PADS,
  launchPicks,
  readUnlocked,
  padLabel,
  rememberPad,
  slotFromPick,
  slotLabel,
  storedPad,
  type Pad,
  type Slot,
} from "./lib/saves";
import { useClip } from "./lib/useClip";
import {
  EFFETS_RETRO,
  IMAGE,
  PLACE,
  SANS_REPONSE,
  chefAbsent,
  chefChoisit,
  enMenu,
  prixImageLegere,
  prixManetteSeule,
  MANETTE_SEULE,
  SORTIES,
  sortieDuMenu,
  TACTILE,
  AGRANDIE,
} from "./lib/mots";
import {
  Cadre,
  useApresLeClic,
  useFenetre,
  useGeometrie,
  useHauteur,
  useZonesSures,
} from "./components/Cadre";
import {
  MANETTES as DESSINS_MANETTES,
  etatDuCadre,
  lieuDesAvis,
  modeDuCadre,
  type Role as RoleDuCadre,
} from "./lib/cadre";
import { pourquoiPasChoisir, repriseDuRole } from "./lib/chef";
import { abonner, changerNiveau, changerSons, estNiveau, instantane, NIVEAUX } from "./lib/effets";
import { consoleDesTouches, sauvegardeAnnoncee, sauvegardeRelancee } from "./lib/lancement";
import {
  entreeDeLAdresse,
  entreeDeLaSession,
  retenirEntree,
  lienDInvitation,
  sortieVers,
  type Entree,
} from "./lib/entree";
import { Aide } from "./components/Aide";
import { Inviter } from "./components/Inviter";
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
  const settled = useBindings(me?.login ?? null, !isPending);
  const [local, setLocal] = useState(rememberedName);
  /** Comment on est entré: pour jouer, pour regarder, ou pas encore.
   *
   * Trois états et non un booléen, parce que « regarder » se décide AVANT que la
   * session existe. Construite en joueur puis corrigée après, elle prendrait une
   * manette le temps d'un aller-retour et l'aurait affiché à toute la salle. */
  //
  // Lu dans l'adresse depuis le 22 novembre 2026 (audit P9): `?entrer=jouer`
  // et `?entrer=regarder` entrent directement. L'accueil des salles et le lien
  // d'invitation y mènent, et un rechargement revient dans la salle au lieu de
  // l'avant-salle, qui rendait la place.
  const [entered, setEntered] = useState<Entree | null>(() => entreeDeLAdresse(location.search));
  /** Entrer ou sortir, et l'écrire dans l'adresse sans créer d'étape
   * d'historique: « retour » mène à la page d'avant la salle, pas à
   * l'avant-salle de la même salle. */
  const entrer = (mode: Entree | null) => {
    setEntered(mode);
    retenirEntree(mode);
  };
  /** La personne a choisi d'entrer sans attendre le site. Voir `Ouverture`. */
  const [sansAttendre, setSansAttendre] = useState(false);

  // Pas le formulaire tant que l'identité n'a pas répondu: l'afficher une demi
  // seconde avant de le retirer se lit comme un défaut. Mais plus une page
  // blanche non plus: le 22 novembre 2026, un site muet la laissait vide sans
  // limite (audit E8). L'écran d'ouverture le dit, puis a une fin.
  if (!sansAttendre && (isPending || settled.isPending))
    return (
      <Ouverture
        salle={salle()}
        onReessayer={() => window.location.reload()}
        onEntrer={() => setSansAttendre(true)}
      />
    );

  const identified = me?.login ?? null;
  const name = identified ? me!.name : local;
  if (!name) return <Entrance onName={setLocal} />;
  return (
    <Named
      name={name}
      login={identified}
      publishes={me?.publishes ?? false}
      entered={entered}
      onEnter={() => entrer("play")}
      onWatch={() => entrer("watch")}
      onLeave={() => {
        // Une seule sortie, vers les autres salles (audit P8). Servie seule,
        // sans salon au-dessus, la page revient à son avant-salle.
        const vers = sortieVers(location.pathname);
        if (vers === null) entrer(null);
        else location.assign(vers);
      }}
      onForget={() => {
        forgetName();
        entrer(null);
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
  const yieldSeat = useRef<(() => void) | null>(null);
  const [recovery, setRecovery] = useState<RecoveryNotice | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  /** Une réponse de reprise en vol. Ici et non dans `Recovery`: le panneau se
   * remonte en passant dans le menu ouvert (`Surcouche`). */
  const [recoveryBusy, setRecoveryBusy] = useState(false);

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
    () => {},
    // Quelqu'un d'autre a changé de jeu. La salle vit à l'étage du dessous, avec
    // ce qu'elle sait de son image; on ne fait que lui passer le message.
    (told) => showBoot.current?.(told),
    (notice) => {
      setRecovery(notice);
      setRecoveryError("");
    },
  );
  const takeSeat = useRef<((port: number, expected?: string) => void) | null>(null);
  const showBoot = useRef<((told: Told) => void) | null>(null);
  const padTo = useRef<((handler: ((action: MenuAction) => void) | null) => void) | null>(null);
  const rename = useRename(lobby.renamed);

  const recover = async (action: Record<string, unknown>) => {
    setRecoveryError("");
    try {
      const result = await lobby.recover(action);
      if (result.port !== null && result.claim !== null)
        takeSeat.current?.(result.port, result.claim);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : SANS_REPONSE);
    }
  };
  /* Le dessin de l'écran d'ENTRÉE, retenu comme la coquille et pour la même
     raison: quelqu'un qui a choisi son écran ne veut pas le rechoisir à chaque
     visite.
     ICI, dans le composant qui rend `<Lobby>`, et pas plus bas avec les
     réglages de la salle. Mes deux insertions y avaient atterri parce que ce
     fichier porte plusieurs `useState(storedX)` et que j'ai remplacé la
     première occurrence en supposant l'état et son effet voisins: l'état s'est
     posé dans un composant, son usage dans un autre, et rien ne pouvait
     marcher. */
  const [look, setLook] = useState(storedLobby);
  useEffect(() => rememberLobby(look), [look]);

  return (
    <HoteDesSurcouches>
      {entered === null ? (
        /* Hors des zones sûres: depuis `viewport-fit=cover`, la page va
           jusque sous l'encoche, et l'avant-salle n'a pas d'image à y mettre. */
        <div className="n3-zones h-full">
          <Lobby
            room={room}
            name={name}
            login={login}
            failed={isError}
            look={look}
            onLook={setLook}
            onEnter={onEnter}
            onWatch={onWatch}
            onForget={onForget}
            onRename={(chosen) => rename.mutate(chosen)}
          />
        </div>
      ) : (
        <Room
          name={name}
          login={login}
          publishes={publishes}
          room={room}
          watching={entered === "watch"}
          padOnly={padOnly}
          onPadOnly={setPadOnly}
          onLeave={() => {
            if (recovery?.asking && !recovery.reason)
              void recover({ action: "cancel", id: recovery.id });
            takeSeat.current = null;
            onLeave();
          }}
          announceSeat={lobby.seat}
          asked={asked}
          onRecover={(port) => {
            void recover({ action: "begin", port });
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
          tell={lobby}
          bind={(take, give, boot, pad) => {
            takeSeat.current = take;
            yieldSeat.current = give;
            showBoot.current = boot;
            padTo.current = pad;
          }}
        />
      )}
      {/* Au-dessus du menu quand il est ouvert: voir `Surcouche`. */}
      <Surcouche>
        <Recovery
          notice={recovery}
          error={recoveryError}
          busy={recoveryBusy}
          onBusy={setRecoveryBusy}
          onAction={recover}
          pad={(handler) => padTo.current?.(handler)}
          onClose={() => {
            setRecovery(null);
            setRecoveryError("");
          }}
        />
      </Surcouche>
    </HoteDesSurcouches>
  );
}

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
  onAnswer,
  onExpire,
  onRecover,
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
  /** Quitter la salle: vers les autres salles, ou vers l'avant-salle quand la
   * page est servie seule (`lib/entree`, `sortieVers`). */
  onLeave: () => void;
  announceSeat: (port: number | null, claim: string | null) => void;
  asked: Asked | null;
  onAnswer: (ok: boolean) => void;
  onExpire: () => void;
  onRecover: (port: number | null) => void;
  /** Rend à l'étage du dessus de quoi prendre et céder une place: la socket du
   * salon vit là-haut, la manette vit ici, et la négociation traverse les deux. */
  bind: (
    take: (port: number, expected?: string) => void,
    give: () => void,
    boot: (told: Told) => void,
    /** De quoi donner la manette au panneau de reprise, qui vit à l'étage du
     * dessus alors que le flux d'entrée vit ici. Même trajet que les trois
     * autres, et pour la même raison. */
    pad: (handler: ((action: MenuAction) => void) | null) => void,
  ) => void;
  /** Où envoyer ce que ce navigateur mesure. La socket du salon vit à l'étage
   * du dessus, les chiffres vivent ici. */
  tell: {
    closeGame: (game: number) => Promise<void>;
    prepare: (action: Record<string, unknown>) => Promise<void>;
    /** Prévenir la salle qu'on change de jeu. Par le salon, parce que le worker
     * est justement ce qui s'arrête. */
    booting: (game: number, save: number) => void;
    vitals: (sample: Vitals) => void;
    /** Un signalement emporte en plus les deux dernières minutes à la seconde:
     * la question devant un « ça saccade » est toujours « et juste avant ? ». */
    complain: (sample: Vitals & { fin: Trail }) => Promise<void>;
    /** La proposition de format réduit, et sa réponse. Sans elle, le journal ne
     * dit pas si une mauvaise soirée a été proposée à quelqu'un. */
    quality: (what: "proposé" | "accepté" | "refusé") => void;
    /** La sourdine, coupée ou remise, pour le journal du salon. */
    sound: (what: MuteNews) => void;
  };
}) {
  const coarse = useRef(looksLikeAPhone()).current;
  /** Sous 900 px ou au doigt, la colonne est un tiroir par-dessus l'image, et
   * les gestes de page passent par la feuille du bas (`lib/disposition`). */
  const compact = useEnTiroir();
  /** Le tiroir et la feuille, ouverts ou non. Jamais retenus: rouverte au
   * chargement, la colonne cacherait la partie qu'on vient rejoindre. */
  const [tiroir, setTiroir] = useState(false);
  const [feuille, setFeuille] = useState(false);
  /** Le tiroir VRAIMENT ouvert: jamais hors du mode compact. Un tiroir demandé
   * sur un grand écran démontait la manette sans rien ouvrir (relecture du
   * 22 novembre 2026). La même règle que `couchesDeLaSalle`, lue plus tôt. */
  const tiroirOuvert = compact && tiroir;
  // Une fenêtre agrandie au-delà de 900 px, tiroir ouvert, ne le garde pas
  // pour la prochaine fois qu'elle rétrécit.
  useEffect(() => {
    if (!compact) setTiroir(false);
  }, [compact]);
  /** Ce que Ctrl lit au moment où elle est relâchée (`apresCtrl`). Une
   * référence, parce que le menu et le réglage des touches sont déclarés plus
   * bas et changent sans que l'écoute du clavier ait à se rebrancher. */
  const pourCtrl = useRef({
    tiroir: false,
    menu: false,
    feuille: false,
    touches: false,
  });
  const basculerTiroir = useCallback(() => {
    const suite = apresCtrl(pourCtrl.current);
    if (suite === null) return;
    setTiroir(suite.tiroir);
    setMenu(suite.menu);
    setFeuille(suite.feuille);
  }, []);
  // Ctrl seule replie la colonne à côté de l'image, et ouvre ou ferme le
  // tiroir quand elle en est un, sans jamais l'empiler sur le menu.
  const { bare, setBare, fullscreen, toggleFullscreen } = useBare(
    coarse,
    compact ? basculerTiroir : undefined,
  );
  /** Ce que l'appareil permet: plein écran, écran d'accueil, ou rien. Lu une
   * fois: ni l'API ni l'écran d'accueil ne changent pendant une visite. */
  const plein = useRef(pleinEcranPossible(lireAppareil())).current;
  /** La largeur de la colonne, choisie entre deux bornes: voir `lib/column`. */
  const [column, setColumn] = useState(storedColumn);
  const [volume, setVolume] = useState(START_VOLUME);
  const [deviceRate, setDeviceRate] = useState(false);
  const [lipsync, setLipsync] = useState(false);
  const [bindings, setBindings] = useState(false);
  /** L'onglet où s'ouvre « touches et manettes »: la carte du clavier l'ouvre
   * sur les touches, le menu sur la manette. */
  const [ongletTouches, setOngletTouches] = useState<"pad" | "key">("pad");
  /** La préparation est-elle mise de côté par quelqu'un qui ne l'a pas lancée ?
   *
   * Locale, et surtout pas partagée: mettre le panneau de côté ne quitte pas la
   * préparation et ne change rien pour les autres. Le lancement reste bloqué
   * tant que cette personne n'est pas prête, exactement comme avant. */
  const [setupHidden, setSetupHidden] = useState(false);
  const [preparationError, setPreparationError] = useState("");
  /* L'attente d'une image (arrivée, coupure, gel) ne se mesure plus ici: la
     couche média calcule un seul état de liaison (`media/liaison.ts`), qui
     distingue aussi « pas ENCORE d'image » de « plus d'image ». Ce rendu
     mesurait le noir sur la CONNEXION, et le gel du 21 novembre 2026, socket
     ouverte, passait entre ses mailles. */
  const idle = room?.game === null;
  /** Une partie tourne-t-elle ? `null` tant que le salon n'a pas répondu.
   *
   * `idle` ne distingue pas: `room?.game === null` vaut faux quand `room` est
   * encore `undefined`, donc la page se croyait EN PARTIE avant même de savoir
   * s'il y en avait une, et s'alarmait en conséquence. */
  const playing = room === undefined ? null : room.game !== null;
  /* Fermé à l'entrée, même au repos : une salle sans jeu ouvrait son menu
     d'office, à tout le monde, et cachait l'écran dessous. L'écran éteint
     dit maintenant qu'il n'y a pas de jeu, et « Choisir un jeu » l'ouvre
     (`EcranEteint`, 23 novembre 2026). */
  const [menu, setMenu] = useState(false);
  pourCtrl.current = { tiroir: tiroirOuvert, menu, feuille, touches: bindings };
  // Le menu, ou quelqu'un qui demande ta place, passent avant le tiroir et la
  // feuille: les deux sont des dialogues modaux, qui rendraient le menu ou la
  // demande inertes dessous. La demande ne dure que dix secondes.
  useEffect(() => {
    if (!menu && asked === null) return;
    setTiroir(false);
    setFeuille(false);
  }, [menu, asked]);
  const checkingIdentity = useMenuIdentity(menu);
  const [unlockedSaves, setUnlockedSaves] = useState<readonly boolean[] | null>(null);
  useEffect(() => {
    if (!menu) {
      setUnlockedSaves(null);
      return;
    }
    let current = true;
    void readUnlocked(under("/saves"))
      .then((available) => {
        if (current) setUnlockedSaves(available);
      })
      .catch(() => {
        if (current) setUnlockedSaves([]);
      });
    return () => {
      current = false;
    };
  }, [menu]);
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
  /** Les réglages avancés, dépliés ou non. Repliés à chaque ouverture de la
   * page: ils servent à chercher une panne, pas à jouer (audit P12). */
  const [avances, setAvances] = useState(false);
  const [theme, setTheme] = useState(storedTheme);
  // Le réglage des effets rétro de cet appareil (`lib/effets`): lu, jamais
  // copié, pour qu'un changement fait dans un autre onglet arrive ici aussi.
  const effets = useSyncExternalStore(abonner, instantane);
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
    /** Vrai quand le plafond est atteint: on a cessé d'attendre, et l'écran
     * propose une sortie au lieu de s'effacer sur du noir. */
    stalled?: boolean;
  } | null>(null);
  /** Le chargement en cours, lisible depuis un effet sans l'y mettre en
   * dépendance.
   *
   * Même raison que `seen` plus bas: `booting` change au rythme des étapes, et
   * le mettre dans les dépendances de l'effet qui démarre et arrête la vidéo
   * relancerait le flux à chaque changement d'étape. */
  const bootingNow = useRef(booting);
  bootingNow.current = booting;
  /** Un jeu tourne et a fini de démarrer: la partie, au sens de la page. */
  const enPartie = playing === true && booting === null;
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

  const { ref, session } = useSession(volume, deviceRate, announceSeat, watching, padOnly);
  useEffect(() => {
    if (!session) return;
    session.sound.setIdle(idle || padOnly);
    if (idle || padOnly) session.video.stop();
    else session.video.start();
    if (!idle) setMenu(false);
    if (idle) {
      setPreparationError("");
      // Un chargement EN COURS survit au passage au repos.
      //
      // C'est le prolongement de la correction du 12 septembre 2026: au tout
      // premier lancement d'une salle vide, le worker redémarre, donc la salle
      // repasse « au repos » PENDANT que le jeu se charge. Effacer l'écran ici
      // et ouvrir le menu revenait à annoncer « aucun jeu » à quelqu'un qui
      // venait justement d'en choisir un: le rendu avait été corrigé le
      // 12 septembre, cet effet le défaisait.
      //
      // Le cas où rien n'arrive jamais est déjà couvert par le plafond de
      // soixante secondes plus bas.
      // Le menu ne s'ouvre plus d'office au repos : l'écran éteint le
      // propose (`EcranEteint`). On remonte seulement aux consoles.
      if (bootingNow.current === null) setFolder(null);
    }
  }, [idle, padOnly, session]);

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
  /** Le son ne joue pas. Lu à la cadence de l'instantané, deux fois par
   * seconde, comme tout ce que la page affiche. */
  const soundOff = shot ? shot.sound.state !== "running" : false;
  // Le compte à rebours de fermeture, dit par le worker dans le message de
  // salle. Masqué d'un clic, et RÉARMÉ quand le compte s'efface: une salle
  // sauvée puis redélaissée doit prévenir de nouveau.
  const closingIn = shot?.input.closingIn ?? 0;
  const [closingHidden, setClosingHidden] = useState(false);
  useEffect(() => {
    if (closingIn === 0) setClosingHidden(false);
  }, [closingIn]);
  const closingSoon = closingIn > 0 && !closingHidden ? closingIn : null;
  /** L'état de la liaison, tel que la couche média l'a calculé. */
  const liaison: Liaison = shot?.liaison ?? { etat: "ok" };
  /** La salle est fermée: la colonne ne propose plus ni place, ni invitation,
   * ni chef. « Inviter » copiait le lien d'une salle fermée, et « Prendre une
   * place » ne faisait rien (vérification finale du 22 novembre 2026). */
  const salleFermee = liaison.etat === "fermee";
  /** Le nom de la salle, ou son numéro tant que le salon ne l'a pas dit. */
  const nomSalle = room?.name ?? `salle ${salle()}`;
  /** Où mène la sortie: les autres salles sous un salon, `null` servie seule. */
  const sortie = sortieVers(location.pathname);

  /* Le relevé qui part au salon toutes les dix secondes.
     Par des références et non par des dépendances: `shot` change deux fois par
     seconde et `tell` est reconstruit à chaque rendu, donc les mettre en
     dépendances reposerait le minuteur avant qu'il n'ait jamais tiré. C'est le
     même piège que l'observateur de taille dans `Screen`. */
  const seen = useRef(shot);
  seen.current = shot;
  /** Un jeu tourne et ne démarre plus: c'est seulement là qu'attendre une image
   * est un gel. Une salle sans jeu, ou un jeu qui charge, n'en envoie pas. */
  const inGame = useRef(false);
  inGame.current = enPartie;
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
  /** Le garde de vingt secondes du signalement, UN pour la page: la colonne et
   * le bandeau de l'image le lisent tous les deux (`lib/garde-signalement`). */
  const garde = useRef(new GardeSignalement());
  const [suggestHalf, setSuggestHalf] = useState(false);
  /** « proposé » est-il déjà parti pour CETTE proposition ? Le journal ne
   * l'écrit qu'à l'affichage (audit E3), et une seule fois même si un gel la
   * cache puis la rend. */
  const proposalTold = useRef(false);
  /** Le temps que l'onglet a passé caché. Un onglet caché ne peint plus, et son
   * relevé ressemble sinon à celui d'une vidéo cassée. */
  const hidden = useRef(new HiddenTime(document.visibilityState === "hidden", performance.now()));
  useEffect(() => {
    const changed = () =>
      hidden.current.change(document.visibilityState === "hidden", performance.now());
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  /** `take` remet le temps caché à zéro: vrai pour le relevé de dix secondes,
   * faux pour un signalement, qui ne doit pas voler sa fenêtre au relevé. */
  const sample = (take = false) => {
    const now = seen.current;
    if (!now) return null;
    const at = performance.now();
    const cachéeMs = take ? hidden.current.take(at) : hidden.current.peek(at);
    return vitals(
      now,
      previous.current,
      at - opened.current,
      { visible: document.visibilityState === "visible", cachéeMs },
      inGame.current,
    );
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
      const taken = sample(true);
      if (!taken) return;
      previous.current = now;
      opened.current = performance.now();
      if (worthWriting(taken)) sending.current.vitals(taken);
      // Un jeu qui démarre tient la proposition trente secondes, comme avant.
      // Une fenêtre qui ne dit rien de la liaison (un gel de la salle pendant
      // lequel le son passait, une salle qui redémarre, un onglet caché) ne
      // compte ni pour ni contre. Une coupure COMPTE: c'est la liaison qui
      // cale, le cas pour lequel la proposition existe (`fenetrePourProposition`,
      // relecture du 22 novembre 2026).
      const fenetre = alive.current?.veille.prendreFenetre() ?? FENETRE_VIDE;
      const poids = bootingNow.current !== null ? "tenir" : fenetrePourProposition(fenetre);
      if (poids === "ignorer") {
        rough.current.ignore();
        return;
      }
      if (poids === "tenir") rough.current.hold();
      // « proposé » ne part PLUS d'ici: une proposition décidée n'est pas une
      // proposition vue. Il part de l'affichage (`EtatSalle`).
      if (rough.current.saw(taken)) {
        proposalTold.current = false;
        setSuggestHalf(true);
      }
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
  // On réessaie tant que ça n'a pas PRIS, et l'écoute RESTE: une coupure
  // d'iOS (un appel, une autre application) se relance au geste suivant
  // (`media/reveil-son`, audit M10). Elle s'arrêtait au premier succès.
  useEffect(() => {
    if (!session) return;
    return armerReveilDuSon(session.sound);
  }, [session]);

  useEffect(() => session?.sound.setVolume(volume), [session, volume]);
  // La sourdine, dite au salon une fois le volume stable (voir `lib/sourdine`).
  const muted = volume <= 0;
  const toldMuted = useRef<boolean | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const news = muteNews(toldMuted.current, muted);
      toldMuted.current = muted;
      if (news) sending.current.sound(news);
    }, MUTE_SETTLES_MS);
    return () => window.clearTimeout(timer);
  }, [muted]);
  useEffect(() => session?.sound.setDeviceRate(deviceRate), [session, deviceRate]);
  useEffect(() => session?.setLipsync(lipsync), [session, lipsync]);
  // Échap ouvre le menu, comme sur une console. Les écrans qui se ferment avec
  // Échap (menu, touches) le gèrent eux-mêmes, donc on ne l'ouvre que quand
  // rien n'est ouvert.
  useEffect(() => {
    const press = (event: KeyboardEvent) => {
      if (typingIn(event.target)) return;
      // Le tiroir et la feuille se ferment eux-mêmes par Échap: leur
      // `preventDefault` ici les garderait ouverts.
      if (event.key !== "Escape" || menu || bindings || tiroirOuvert || feuille) return;
      // Sans `preventDefault`, la fin de ce même appui est une « demande de
      // fermeture » pour le navigateur, et le menu, ouvert en dialogue modal
      // pendant l'événement, la recevait: il s'ouvrait et se refermait aussitôt
      // (vu dans Chrome 151 le 22 novembre 2026, par `focus.mjs`).
      event.preventDefault();
      setMenu(true);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [menu, bindings, tiroirOuvert, feuille]);

  /* Le modèle de focus (`lib/focus-jeu`): le clavier du jeu vit dans la zone de
     jeu, et partout ailleurs Entrée, Espace et les flèches font ce que fait le
     navigateur (audit A11Y-01, 22 novembre 2026). */
  const { zone, auJeu } = useFocusJeu({ menu, playing, enPartie });

  /** Le jeu que la salle dit faire tourner, par son nom comme `booting`. */
  const jeuEnCours = room?.game?.name ?? null;
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
    const live = session?.video.stats() ?? null;
    // Trois conditions, et il en faut trois. Le flux doit avoir REDÉMARRÉ, le
    // nouveau doit peindre une trentaine d'images, et l'image ne doit plus
    // être noire: c'est l'étape « première image » (`bootingStep`), et la
    // règle vit avec elle dans `lib/booting` (`suiteDuChargement`).
    //
    // Compter les images seules ne suffisait pas: changer de jeu arrête le
    // worker en une seconde environ, et l'ancien flux en peint une soixantaine
    // avant que sa socket ne tombe. Compter les reconnexions non plus: un
    // simple hoquet en provoque une. Et sans la troisième, mesurée le 31 août
    // 2026, l'écran se retirait sur le démarrage de Dolphin: quatre secondes de
    // noir sur Mario Kart Double Dash, aucune sur Mario Party 4. La sonde qui
    // répond ne tourne QUE dans cette fenêtre; voir `video.sampleDark`.
    //
    // Le plafond de soixante secondes ne fait plus DISPARAÎTRE l'écran: il
    // s'effaçait sur du noir, sans un mot. C'est le seul endroit où la page
    // SAIT qu'elle a échoué, donc c'est là que la sortie est proposée.
    //
    // Une page « manette seule » n'a pas d'image: son chargement s'efface quand
    // la salle annonce le jeu demandé, et ne retenait plus ses touches sans fin
    // (relecture du 22 novembre 2026).
    const suite = suiteDuChargement({
      padOnly,
      demande: booting.game,
      enCours: jeuEnCours,
      depuisMs: performance.now() - booting.at,
      cale: booting.stalled === true,
      image: live,
    });
    if (suite === "effacer") setBooting(null);
    else if (suite === "caler") setBooting({ ...booting, stalled: true });
  }, [booting, shot, session, padOnly, jeuEnCours]);
  useEffect(() => {
    applyTheme(theme);
    rememberTheme(theme);
  }, [theme]);
  // Ce que la couche média ne peut pas savoir seule: un jeu tourne-t-il, un
  // changement de jeu est-il en cours, le format réduit est-il proposé.
  const bootingAt = booting?.at ?? null;
  useEffect(() => {
    session?.contexte({
      jeu: playing,
      demarrageA: bootingAt,
      proposer: suggestHalf,
    });
  }, [session, playing, bootingAt, suggestHalf]);

  const port = shot?.input.port ?? null;
  /** Ce que la personne tient, pour que chaque aide nomme ses touches à elle:
   * Entrée et Échap au clavier, A et B à la manette (audit T02). */
  const appareil = appareilDe(shot?.input.padId ?? null, coarse);
  /** Les touches imprimées sur le clavier de la personne, quand le navigateur
   * sait les dire (Chrome); sinon les noms d'un clavier américain. */
  const [disposition, setDisposition] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    let vivant = true;
    void keyboardLayout().then((lue) => {
      if (vivant) setDisposition(lue);
    });
    return () => {
      vivant = false;
    };
  }, []);
  /** La carte « Tu joues au clavier »: ouverte à la première visite. */
  const [aideOuverte, setAideOuverte] = useState(() => !aideDejaVue());
  const nomTouche = (code: string) => keyLabel(code, disposition);
  // Une fois qu'on a joué, la carte est lue: elle reste ouverte pour cette
  // visite, et la suivante commence repliée. Seulement au clavier: la carte
  // n'existe pas pour une manette ni au doigt.
  const aJoue = (shot?.input.pressed.length ?? 0) > 0;
  useEffect(() => {
    if (aJoue && appareil === "clavier") retenirAideVue(true);
  }, [aJoue, appareil]);
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
  /** Le propriétaire est là, mais il ne joue plus.
   *
   * `boss.moi` et plus une comparaison d'adresses: l'état de la salle ne porte
   * plus l'adresse de personne, et le salon calcule `moi` pour CETTE page. Il
   * n'est jamais vrai sans identité, comme l'était `login !== null`. */
  const canClose = boss ? boss.moi === true : mine;
  /** Ce que la page sait du rôle, lu par `lib/chef`: la règle y est testée. */
  const role = {
    port,
    mine,
    chef: boss?.name ?? null,
    moi: boss?.moi === true,
  };
  const whyNotChoose = pourquoiPasChoisir(role);

  // De quoi prendre et céder une place, rendu à l'étage du dessus où vit la
  // socket du salon.
  useEffect(() => {
    bind(
      (chosen, expected) => session?.input.take(chosen, expected),
      () => session?.input.yieldSeat(),
      // L'annonce des AUTRES. On repart du nombre d'images peint MAINTENANT,
      // exactement comme celui qui a cliqué: l'écran s'efface quand la salle
      // repeint, et c'est la même règle pour tout le monde.
      (told) => {
        if (told.solo === true) session?.input.prepareSoloPlayer();
        else if (told.solo === false) session?.input.watchOnly();
        const relance = sauvegardeRelancee(told, session?.input.attribution());
        if (relance !== undefined) setRanWith(relance);
        const chosen = told.pads?.[session?.input.attribution() ?? ""];
        if (chosen !== undefined && [0, 1, 2, 3].includes(chosen)) {
          const kind = chosen as Pad;
          session?.input.choosePad(kind);
          rememberPad(kind);
          setPad(kind);
        }
        session?.video.expectRestart();
        setBooting({
          game: told.game,
          // Le salon écrit « la sauvegarde de Bo » pour tout le monde; celui
          // qui a lancé lit son propre mot, « ma sauvegarde » (audit T06).
          save: sauvegardeAnnoncee(told, session?.input.attribution()),
          at: performance.now(),
        });
        // Le menu et le dossier se ferment, comme sur le chemin local.
        //
        // Sans ça, celui qui n'a PAS cliqué garde son menu ouvert par-dessus
        // l'écran de chargement — le menu est au-dessus — et il y lit « aucun
        // jeu » pendant que le jeu demandé démarre.
        setMenu(false);
        setFolder(null);
      },
      (handler) => session?.input.setMenu(handler),
    );
  }, [bind, session]);

  // La relève du salon reste fraîche même sans socket de manette, donc aussi
  // pour les spectateurs. Un ancien worker laisse held à null.
  const occupied = Array.from({ length: shot?.input.players ?? 4 }, (_, index) => {
    const seat = room?.seats.find((entry) => entry.port === index + 1);
    return (
      seat?.held ??
      (shot?.input.watching ? Boolean(seat?.player) : (shot?.input.busy[index] ?? false))
    );
  });
  /** La place qu'un spectateur prendrait : la première libre, ou `null`. */
  const premiereLibre = occupied.indexOf(false) >= 0 ? occupied.indexOf(false) + 1 : null;
  const names = new Map(
    (room?.seats ?? []).flatMap((seat) =>
      seat.player && occupied[seat.port - 1] ? [[seat.port, seat.player] as const] : [],
    ),
  );
  /** Ce que le salon sait des prises tenues: première fois dans cette salle ou
   * non. La même réponse pour toutes les pages, donc la même scène partout. */
  const premieres = new Map(
    (room?.seats ?? []).flatMap((seat) =>
      typeof seat.premiere === "boolean" && occupied[seat.port - 1]
        ? [[seat.port, seat.premiere] as const]
        : [],
    ),
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
  /** L'adresse suit la session, pas la porte d'entrée (`lib/entree`).
   *
   * Entré pour regarder puis assis, un rechargement rendait la place; entré
   * pour jouer puis levé, il la reprenait (relecture du 22 novembre 2026).
   * Seulement l'adresse: l'état d'`App` garde la porte, et le changer
   * reconstruirait la session. Attend le premier instantané, qui porte
   * l'intention que la session a reçue à sa construction. */
  const sessionVue = shot !== null;
  useEffect(() => {
    if (sessionVue) retenirEntree(entreeDeLaSession(watchingNow));
  }, [sessionVue, watchingNow]);
  const picture = shot?.video.picture ?? { width: 0, height: 0 };
  /** Le format choisi. Gardé ici en plus de la session pour que le menu se
   * redessine tout de suite: l'instantané ne revient que deux fois par seconde,
   * et un réglage qui met une demi-seconde à afficher son nouvel état se lit
   * comme un réglage qui n'a pas pris. */
  const [half, setHalf] = useState(false);
  /** Les deux qualités, dites d'après l'image reçue: voir `qualities`. */
  const sizes = qualities(shot?.video.picture ?? { width: 0, height: 0 }, half);
  /** Ce que l'image légère coûte en moins, chiffré seulement pour Dolphin. */
  const prixImage = prixImageLegere(moteurDe(room?.game?.console));
  /** La manette que les jeux Wii présentent. Un réglage, pas une décision de
   * partie: voir `lib/saves`. */
  const [pad, setPad] = useState<Pad>(storedPad);
  /** La carte du clavier, lue dans le profil actif et nommée pour l'appareil
   * de la place (`lib/aide-clavier`). Après `pad`, qu'elle lit. */
  const lignesClavier = !shot
    ? []
    : usesProInput(room?.game?.console)
      ? aidePro(session?.input.switch.profile.keys ?? {}, room?.game?.console === "x360", nomTouche)
      : // L'appareil que la place présente au jeu: dans une salle Wii, la même
        // trame se lit Wiimote ou guitare (`lib/aide-clavier`).
        aideDolphin(shot.input.keys, nomTouche, {
          console: room?.game?.console ?? "gc",
          pad,
        });
  useEffect(() => {
    if (shot?.input.device !== undefined) setPad(shot.input.device);
  }, [shot?.input.device]);
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

  const pendingSetup = room?.preparation ?? null;
  const [setupChoice, setSetupChoice] = useSetupChoice(pad, pendingSetup);
  const setupPlayer = pendingSetup?.players.find((p) => p.claim === session?.input.attribution());
  /* Une préparation qui liste ma place montait le panneau MODAL sans que rien ne
     puisse le refermer: la croix est cachée pendant une préparation, Échap et le
     clic sur le fond ne faisaient que `setBindings(false)` — sans effet, puisque
     c'est `setupPlayer` qui monte le panneau — et le seul bouton d'annulation
     appartient à l'initiateur. Le menu, « quitter la salle » et l'image sont
     dessous. C'était le seul endroit de la page dont on ne pouvait pas sortir. */
  const configuring = bindings || (Boolean(setupPlayer) && !setupHidden);
  /* Une NOUVELLE préparation se montre, même si la précédente avait été mise de
     côté: ce qu'on a écarté est cette préparation-là, pas toutes les suivantes. */
  const setupId = pendingSetup?.id ?? null;
  useEffect(() => setSetupHidden(false), [setupId]);
  // Par sa clé quand le salon la connaît: la position a pu changer depuis le
  // début de la préparation (ADR D23).
  const setupGame = room?.library.find((game) =>
    pendingSetup?.key ? game.key === pendingSetup.key : game.index === pendingSetup?.game,
  );
  const configuringSwitch = usesProInput(setupGame?.console ?? room?.game?.console);
  /** Un écran couvre toute l'image: la salle au repos, un chargement, ou le
   * rideau d'une arrivée sans image. Personne n'y joue, et ces écrans
   * recouvraient la manette à l'écran avec son « ••• »: sur un téléphone, le
   * tiroir de la salle (places, signaler, quitter) devenait introuvable
   * pendant une panne (audit P4, E7). La manette n'est donc pas montée, et le
   * « ••• » se pose seul, au-dessus de ces écrans.
   *
   * Pas pour une page « manette seule »: elle n'a ni image ni écran de
   * chargement, et c'est elle qu'on tient pendant que le jeu démarre
   * (`voileSurImage`). */
  const voile = voileSurImage({
    repos: idle && !menu && !configuring,
    chargement: booting !== null,
    rideau: dire(liaison, salle(), moteurDe(room?.game?.console)).niveau === "rideau",
    padOnly,
  });
  /** Ce qui est monté par-dessus l'image, décidé en un seul endroit. */
  const couches = couchesDeLaSalle({
    compact,
    tiroir,
    feuille,
    manette: session !== null && onTouch,
    voile,
    bare,
  });
  /* Le focus revient à ce qui a ouvert la feuille ou le tiroir.

     Le « ••• » de la manette est démonté pendant que la feuille est ouverte
     (le démontage relâche les touches tenues), donc le dialogue ne peut plus
     lui rendre le focus: il tombait sur le document, et un lecteur d'écran
     repartait du début de la page (relecture du 22 novembre 2026, WCAG
     2.4.3). Seulement quand rien d'autre ne s'ouvre à la place: une entrée
     de la feuille peut ouvrir le tiroir ou le menu. */
  const coucheAvant = useRef(false);
  useEffect(() => {
    const ouverte = feuille || tiroirOuvert;
    const fermee = coucheAvant.current && !ouverte;
    coucheAvant.current = ouverte;
    if (!fermee || menu) return;
    const ici = document.activeElement;
    const plus = document.querySelector<HTMLElement>(OUVRE_LA_FEUILLE);
    const suite = focusApresFermeture({
      perdu: ici === null || ici === document.body,
      plus: plus !== null,
    });
    if (suite === "plus") plus?.focus({ preventScroll: true });
    else if (suite === "jeu") zone.current?.focus({ preventScroll: true });
    // `zone` est la même référence d'un rendu à l'autre (`useFocusJeu`).
  }, [feuille, tiroirOuvert, menu, zone]);
  useEffect(() => {
    session?.input.blockGameplay(configuring, configuringSwitch ? "switch" : "dolphin");
    return () => session?.input.blockGameplay(false);
  }, [session, configuring, configuringSwitch]);

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

  /** Le micro, pour mêler sa voix aux clips (`lib/micro`). */
  const { micDevice, micDevices, toggleMic, pickMic } = useMicro(session);

  const switchPad = (wanted: Pad) => {
    if (wanted === pad) return;
    const game = room?.game;
    if (game?.console === "wii" && (wanted === 0 || pad === 0)) {
      if (ranWith === null) {
        setPreparationError(
          "Pour relancer avec cet appareil, ouvre ce jeu dans la bibliothèque et choisis sa sauvegarde avant la préparation. Cette page ne connaît pas l'emplacement du lancement précédent.",
        );
        return;
      }
      // Changer d'appareil nécessite un démarrage de Dolphin. Les quatre
      // personnes le préparent ensemble avant que quoi que ce soit s'arrête.
      setSetupChoice(wanted);
      void tell
        .prepare({
          action: "begin",
          game: game.index,
          key: game.key,
          save: ranWith ?? 0,
        })
        .then(() => setMenu(false))
        .catch((error) =>
          setPreparationError(error instanceof Error ? error.message : SANS_REPONSE),
        );
      return;
    }
    setPad(wanted);
    rememberPad(wanted);
    session?.input.choosePad(wanted);
    if (game?.console === "wii")
      session?.input.chooseExtension(wanted === 2 ? 1 : wanted === 3 ? 2 : 0);
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

  /** Le détail de la connexion, dans la colonne: le tiroir sur un téléphone,
   * la colonne dépliée ailleurs (`ouvrirLaSalle`). */
  const voirDetail = () => {
    setMode("details");
    if ("tiroir" in ouvrirLaSalle(compact)) setTiroir(true);
    else setBare(false);
    setMenu(false);
  };
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
              icon: <ConsoleIcon console={shelf.code} className="h-full w-full" />,
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
              // Les consoles que le manifeste dit jouables (ADR D22).
              const saves = preparable(game.console);
              const running = game.index === room?.game?.index;
              /** Lancer, une fois la sauvegarde décidée quand il y en a une. */
              const launch = (slot: Slot | null) => {
                // La GameCube passe par la préparation elle aussi depuis le 12
                // septembre 2026. Elle se lançait en deux pressions, sans
                // passer par le salon, et seul le salon certifie QUI lance:
                // « ta sauvegarde » retombait donc en silence sur la partie
                // neuve. Un disque de console inconnue garde l'ancien chemin,
                // faute de savoir quel appareil lui présenter.
                if (preparable(game.console)) {
                  setPreparationError("");
                  void tell
                    .prepare({
                      action: "begin",
                      // La clé désigne ce jeu même si la liste a changé; la
                      // position reste pour un salon d'avant (ADR D23).
                      game: game.index,
                      key: game.key,
                      save: slot ?? 0,
                      // Seul à jouer, sur un jeu à un seul appareil, le salon
                      // lance tout de suite: choisir la sauvegarde suffit
                      // (audit P6). Sinon la préparation s'ouvre, comme avant.
                      direct: true,
                    })
                    .then(() => setMenu(false))
                    .catch((error: unknown) =>
                      setPreparationError(error instanceof Error ? error.message : SANS_REPONSE),
                    );
                  return;
                }
                // La sauvegarde AVANT le jeu: le worker retient le choix sans rien
                // déclencher, et c'est le changement de jeu qui agit. L'ordre compte,
                // parce que l'ordre de jeu fait redémarrer la salle.
                if (slot !== null) session?.input.chooseSave(slot);
                // La manette AVANT le jeu, comme la sauvegarde: le worker
                // retient, et c'est le changement de jeu qui agit. Elle vient du
                // réglage, pas du panneau.
                session?.input.choosePad(storedPad());
                // Par sa clé quand la salle la publie, sinon par sa position:
                // un worker d'avant le 21 novembre 2026 ne connaît que celle-ci.
                const sent = game.key
                  ? session?.input.chooseGameByKey(game.key)
                  : session?.input.chooseGame(game.index);
                if (!sent || !session) return;
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
                // La touche de l'appareil qu'on tient. « entrée: » voulait dire
                // la touche Entrée, alors que le pied du menu appelait
                // « entrée » une ligne de la liste (audit T02).
                hint: running
                  ? saves
                    ? pour(appareil, "le relancer sur une autre sauvegarde ou une autre manette")
                    : "c'est ce qui tourne"
                  : !mine
                    ? (whyNotChoose ?? undefined)
                    : saves
                      ? `${pour(appareil, "choisir la sauvegarde, puis lancer")}. Ça arrête la partie de tout le monde.`
                      : armed === game.index
                        ? "encore une fois pour lancer, ailleurs pour annuler"
                        : `${pour(appareil, "lancer, deux fois")}: ce disque n'a pas dit de quelle console il est.`,
                icon: <GameIcon className="h-full w-full" />,
                game: {
                  index: game.index,
                  art: game.art ?? false,
                  console: game.console,
                },
                details: <GameCard game={game} />,
                by: game.maker ?? undefined,
                note: game.about ?? undefined,
                // Le jeu QUI TOURNE reste choisissable, et c'est nouveau: le
                // relancer change de sauvegarde ou de manette, ce qui est la
                // seule façon de passer à la Wiimote sans lancer un autre jeu
                // pour revenir. Avant, cette entrée ne décidait de rien une fois
                // le jeu lancé, donc la griser était juste.
                //
                // Elle reste grisée pour qui ne décide pas du jeu.
                // Une console décrite mais pas encore jouable reste grisée.
                disabled:
                  !mine ||
                  !launchable(game.console) ||
                  (saves && (unlockedSaves === null || checkingIdentity)),
                // Une seule décision ici, la sauvegarde, et la MÊME pour les deux
                // consoles. La manette se choisit sous « manettes »: voir
                // `launchPicks`, qui dit pourquoi les deux moitiés du choix vivent
                // ensemble plutôt qu'ici.
                // La sauvegarde personnelle n'est proposée QUE si le salon sait qui
                // tu es: le worker ne peut pas nommer un dossier d'après quelqu'un
                // qu'il ne connaît pas, et la proposer sans identité ferait cliquer
                // sur un choix qui retombe en silence sur la partie neuve.
                picks: saves
                  ? launchPicks(login !== null, unlockedSaves?.[game.index] === true)
                  : undefined,
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
                  if (unlockedSaves === null) return;
                  const slot = slotFromPick(id, unlockedSaves[game.index] === true);
                  if (slot !== null) launch(slot);
                },
              };
            }),
    },
    {
      id: "manettes",
      label: "manettes",
      icon: <PadIcon className="h-full w-full" />,
      // Une rubrique à elle. Régler sa manette demandait Échap, deux flèches,
      // neuf flèches bas et Entrée: « touches et manettes » était la dixième
      // entrée sur quinze des réglages, et trois autres réglages de manette
      // l'entouraient (audit P12, 22 novembre 2026).
      items: arrange(
        [
          {
            id: "bindings",
            // « touches » sous-vendait: cet écran règle aussi les manettes.
            label: "touches et manettes",
            // Le même titre que le dialogue qu'elle ouvre. Le profil clavier est
            // nommé; les correspondances des manettes sont par modèle.
            // Une manette qui attend ses correspondances le dit ici aussi:
            // l'avis de branchement s'efface au bout de cinq secondes (P12).
            ...(shot && manetteAConfigurer(shot.input)
              ? {
                  value: "à configurer",
                  hint: "la manette branchée attend ses correspondances: ouvre pour la configurer",
                }
              : {
                  hint: `tester et changer tes touches, profil clavier « ${shot?.input.keyProfile ?? "défaut"} »`,
                }),
            icon: <KeysIcon className="h-full w-full" />,
            // Le menu reste ouvert DERRIÈRE: renvoyer quelqu'un dans la partie
            // pour changer une touche est exactement ce qu'on ne veut pas.
            onEnter: () => {
              setOngletTouches("pad");
              setBindings(true);
            },
          },
          {
            id: "pad",
            // « appareil »: ce choix dit ce que le jeu voit (manette GameCube,
            // Wiimote, guitare), pas quelle manette on tient (audit P12).
            label: "appareil des jeux Wii",
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
                  ? "Appareil présenté aux jeux Wii. Passer à la Wiimote relance le jeu."
                  : "Extension de ta place. Entre Nunchuk et guitare, rien ne relance."
                : "Appareil du prochain jeu Wii. Les profils clavier restent indépendants.",
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
            id: "touchpad",
            label: TACTILE,
            value: touchLabel(touchPref),
            hint: "Pour jouer au téléphone. Elles se fondent avec le clavier et les manettes: on peut tenir les deux.",
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
            // Un seul nom pour ce mode, ici comme sur l'écran qu'il montre.
            label: MANETTE_SEULE,
            value: padOnly ? "oui" : "non",
            hint: `Pour un téléphone posé à côté d'un écran qui montre déjà le jeu. Il cesse de décoder une vidéo que personne ne regarde : ${prixManetteSeule(moteurDe(room?.game?.console))}.`,
            icon: <PadIcon className="h-full w-full" />,
            picks: [
              {
                id: "avec",
                label: "non, avec l'image",
                hint: "le jeu s'affiche ici",
              },
              {
                id: "sans",
                label: "oui, sans image",
                hint: "ni image ni son sur cet appareil",
              },
            ],
            picked: padOnly ? "sans" : "avec",
            // Changer de mode reconstruit la session, donc la place tenue est
            // rendue puis reprise. C'est visible, et c'est le prix de ne plus
            // ouvrir la socket vidéo du tout.
            onPick: (id) => onPadOnly(id === "sans"),
          },
        ],
        MANETTES,
      ),
    },
    {
      id: "salle",
      label: "salle",
      icon: <RoomIcon className="h-full w-full" />,
      // Les quatre places ont quitté ce rayon.
      //
      // Elles y montraient qui tient quoi, et permettaient de s'asseoir ou de
      // demander sa manette à quelqu'un. La COLONNE fait déjà exactement ça, y
      // compris les deux clics pour reprendre une place tenue par un fantôme.
      // Elle n'est pas « visible en permanence » partout, comme ce commentaire
      // l'a cru: sur un téléphone, elle est un tiroir fermé (audit P5). Ce
      // rayon l'ouvre donc, sous 900 px ou au doigt (« places et spectateurs »).
      //
      // Deux endroits pour un même geste, c'est deux endroits à tenir d'accord.
      // Ce qui reste ici est ce qui n'existe nulle part ailleurs: le clip, le
      // passage en spectateur, et la sortie.
      items: ([] as XmbItem[]).concat([
        // Seulement quand le chef ne joue plus (`repriseDuRole`, que le worker décide):
        // proposé à tous et tout le temps, c'était la première action offerte
        // à un nouveau venu, celle de prendre la place de l'hôte (audit T12).
        ...(boss && repriseDuRole(role, login !== null)
          ? [
              {
                id: "recover-owner",
                label: "prendre le rôle de chef",
                hint: `${chefAbsent(boss.name)} ${boss.name} sera prévenu.`,
                icon: <RoomIcon className="h-full w-full" />,
                onEnter: () => {
                  setMenu(false);
                  onRecover(null);
                },
              },
            ]
          : []),
        ...(room?.game
          ? [
              {
                id: "close-game",
                label: "fermer le jeu",
                hint: canClose
                  ? "Arrête la partie de tous. Les sauvegardes sont conservées, la salle reste ouverte."
                  : `${boss?.name ?? "Le chef"} peut fermer le jeu.`,
                icon: <GameIcon className="h-full w-full" />,
                disabled: !canClose,
                picks: [
                  { id: "close", label: "fermer le jeu", hint: room.game.name },
                  { id: "cancel", label: "continuer à jouer" },
                ],
                onPick: (id: string) => {
                  if (id !== "close" || !room.game) return;
                  void tell
                    .closeGame(room.game.index)
                    .then(() => setPreparationError("Fermeture du jeu en cours…"))
                    .catch((error: unknown) =>
                      setPreparationError(error instanceof Error ? error.message : SANS_REPONSE),
                    );
                },
              },
            ]
          : []),
        // Fermer la SALLE, et pas seulement le jeu: l'API existait, aucun
        // bouton ne l'appelait (audit P14). Pour le chef, et seulement sous un
        // salon: servie seule, la page n'a pas de liste où revenir.
        ...(canClose && sortie !== null
          ? [
              {
                id: "close-room",
                label: "fermer la salle",
                hint: "Arrête la partie de tous et libère la carte graphique. Les sauvegardes sont conservées.",
                icon: <RoomIcon className="h-full w-full" />,
                picks: [
                  { id: "close", label: "fermer la salle", hint: nomSalle },
                  { id: "cancel", label: "continuer à jouer" },
                ],
                onPick: (id: string) => {
                  if (id !== "close") return;
                  void closeSalle({
                    path: { numero: salle() },
                    throwOnError: true,
                  })
                    .then(() => location.assign("/"))
                    .catch((error: unknown) =>
                      // Le client généré rejette avec le corps de la réponse,
                      // `{ detail }`, et non avec une `Error`.
                      setPreparationError(
                        typeof error === "object" &&
                          error !== null &&
                          "detail" in error &&
                          typeof error.detail === "string"
                          ? `La salle n'a pas fermé : ${error.detail}.`
                          : "La salle n'a pas pu fermer. Réessaie.",
                      ),
                    );
                },
              },
            ]
          : []),
        // Le clip a quitté ce rayon pour la COLONNE, où il est atteignable sans
        // ouvrir de menu — c'est un geste qu'on fait pendant qu'il se passe
        // quelque chose, et poser un menu par-dessus le jeu qu'on voulait garder
        // est exactement le mauvais moment.
        //
        // Déplacé, pas dupliqué: deux endroits pour un même geste sont deux
        // endroits à tenir d'accord, et c'est la leçon des quatre places.
        // Le tiroir de la colonne, quand elle en est un: les places, demander
        // celle d'un autre, signaler, le diagnostic, les spectateurs.
        ...(compact
          ? [
              {
                id: "places",
                // Le même nom que l'entrée de la feuille et que le tiroir:
                // « places et spectateurs » nommait un quatrième endroit.
                label: "la salle",
                hint: aideDeLaSalle(appareil),
                icon: <RoomIcon className="h-full w-full" />,
                onEnter: () => {
                  setMenu(false);
                  setTiroir(true);
                },
              },
            ]
          : []),
        {
          id: "watch",
          label: enMenu(watchingNow ? PLACE.prendre : PLACE.rendre),
          value: watchingNow ? "tu regardes" : undefined,
          hint: watchingNow
            ? "la première place libre"
            : "tu regardes, l'image et le son continuent",
          icon: <WatchIcon className="h-full w-full" />,
          onEnter: () => {
            if (watchingNow) session?.input.play();
            else session?.input.watchOnly();
            setMenu(false);
          },
        },
        {
          id: "leave",
          label: enMenu(SORTIES.quitter),
          // « retour à l'accueil » désignait deux pages différentes (audit P8).
          hint:
            sortie === null
              ? "retour à l'entrée de la salle. La partie continue sans toi."
              : "vers les autres salles. La partie continue sans toi.",
          icon: <LeaveIcon className="h-full w-full" />,
          onEnter: onLeave,
        },
      ]),
    },
    {
      id: "reglages",
      label: "réglages",
      icon: <SettingsIcon className="h-full w-full" />,
      // Les réglages pointus sont repliés derrière « réglages avancés »:
      // `lib/settings`, `avecAvances`.
      items: avecAvances(
        arrange(
          selonAppareil(
            [
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
                label: IMAGE.reglage,
                value: shot?.video.half ? "légère" : "complète",
                // Ce que la personne a besoin de savoir pour choisir, et rien de plus:
                // combien ça coûte, et que ça ne regarde qu'elle.
                //
                // Les tailles viennent de l'image REÇUE, comme celles du réglage
                // « image à l'écran », et non d'une table: les 1216×896 et 608×448
                // écrits ici étaient ceux de Dolphin, et la Switch envoie du
                // 1280×720. Un seul prix, et seulement là où il a été mesuré
                // (`prixImageLegere`): la page disait ici « le quart » et ailleurs
                // « 2,6 fois moins » (audit T11), et donnait le chiffre d'une
                // course Dolphin à une salle Switch (relecture du 22 novembre).
                hint: half
                  ? `${sizes.half || IMAGE.legere}, ${prixImage}. Ne change que ton écran.`
                  : `${sizes.full || IMAGE.complete}. Passe en image légère si l'image saccade.`,
                icon: <ScreenIcon className="h-full w-full" />,
                picks: [
                  {
                    id: "full",
                    label: IMAGE.complete,
                    hint: sizes.full || "toute l'image",
                  },
                  {
                    id: "half",
                    label: IMAGE.legere,
                    hint: sizes.half ? `${sizes.half} · ${prixImage}` : prixImage,
                  },
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
                label: "image à l'écran",
                value: fitLabel(fit),
                hint: "Comment l'image remplit ta fenêtre. Ne change pas ce que tu reçois.",
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
                // À zéro, le son n'est pas joué en silence: il n'est plus envoyé du
                // tout (`SoundStream.setMuted`). Le dire, pour qu'une liaison faible
                // sache qu'elle vient de gagner 1,5 Mbit/s.
                value: volume <= 0 ? "sourdine" : `${Math.round(volume * 100)}`,
                hint:
                  volume <= 0 ? "le son n'est plus envoyé" : pour(appareil, "ouvrir la glissière"),
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
                hint: pour(appareil, "voir les trois"),
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
                id: "effets",
                label: EFFETS_RETRO.reglage,
                value: EFFETS_RETRO.niveaux[effets.niveau].label,
                hint: pour(appareil, "voir les trois"),
                icon: <PaletteIcon className="h-full w-full" />,
                picks: NIVEAUX.map((id) => ({
                  id,
                  label: EFFETS_RETRO.niveaux[id].label,
                  hint: EFFETS_RETRO.niveaux[id].note,
                })),
                picked: effets.niveau,
                onPick: (id) => {
                  if (estNiveau(id)) changerNiveau(id);
                },
              },
              {
                // Coupés par défaut, et jamais pendant une partie
                // (`retro/sons.ts`): ce réglage ne fait que les permettre.
                id: "sonsMenu",
                label: EFFETS_RETRO.sons,
                value: effets.sons ? "oui" : "non",
                hint: EFFETS_RETRO.sonsNote,
                icon: <SoundIcon className="h-full w-full" />,
                onEnter: () => changerSons(!effets.sons),
              },
              {
                id: "shell",
                // Une entrée nommée « menu », dans un menu, est une devinette. Ce
                // qu'elle choisit est le tableau de bord de quelle console.
                label: "tableau de bord",
                value: shellLabel(shell),
                hint: pour(appareil, "voir les consoles"),
                icon: <LayoutIcon className="h-full w-full" />,
                picks: SHELLS.map((choice) => ({
                  id: choice.id,
                  label: choice.label,
                })),
                picked: shell,
                onPick: (id) => {
                  const found = SHELLS.find((choice) => choice.id === id);
                  if (found) setShell(found.id);
                },
              },
              {
                id: "deviceRate",
                label: "son sans conversion",
                value: deviceRate ? "oui" : "non",
                hint: "Peut réduire un grésillement. Peut ajouter un peu de retard.",
                icon: <WaveIcon className="h-full w-full" />,
                onEnter: () => setDeviceRate(!deviceRate),
              },
              {
                id: "lipsync",
                label: "image calée sur le son",
                value: lipsync ? `+${Math.round(shot?.soundSyncMs ?? 0)} ms` : "non",
                hint: lipsync
                  ? "compensation ajustée au son ; elle ajoute aussi du retard aux commandes"
                  : "retarde l'image pour suivre le son, seulement sur cet écran",
                icon: <SyncIcon className="h-full w-full" />,
                onEnter: () => setLipsync(!lipsync),
              },
              {
                id: "bare",
                // Un nom, comme les autres. La phrase à l'impératif est le
                // travail de l'aide, pas du titre.
                label: "colonne de droite",
                value: bare ? "repliée" : "visible",
                hint: "rend toute la largeur à l'image (Ctrl)",
                icon: <PanelIcon className="h-full w-full" />,
                onEnter: () => setBare(!bare),
              },
              {
                id: "columnWidth",
                label: "largeur de la colonne",
                value: `${column} px`,
                hint: `ou tirer son bord gauche · double-clic : ${COLUMN.normal} px`,
                icon: <PanelIcon className="h-full w-full" />,
                // La glissière du menu, parce que la poignée n'a pas de clavier:
                // voir `ColumnHandle`. Au clavier et à la manette, c'est ici.
                slide: {
                  value: column,
                  min: COLUMN.min,
                  // Relue à chaque rendu du menu: une fenêtre étroite ne permet pas
                  // la même largeur qu'un grand écran.
                  max: widest(window.innerWidth),
                  step: COLUMN.step,
                  say: (at) => `${at} px`,
                  onSet: (at) => {
                    setColumn(at);
                    rememberColumn(at);
                  },
                },
              },
              {
                id: "fullscreen",
                label: "plein écran",
                value: fullscreen ? "oui" : "non",
                icon: <ExpandIcon className="h-full w-full" />,
                onEnter: toggleFullscreen,
              },
              {
                id: "advanced",
                label: "réglages avancés",
                value: avances ? "affichés" : "3 de plus",
                hint: avances
                  ? "son sans conversion, image calée sur le son, état de la connexion"
                  : pour(
                      appareil,
                      "les afficher: son sans conversion, image calée sur le son, état de la connexion",
                    ),
                icon: <SettingsIcon className="h-full w-full" />,
                onEnter: () => setAvances(!avances),
              },
              entreeConnexion({
                liaison,
                images: shot?.video.painted ?? 0,
                hz: shot?.video.refreshHz ?? 0,
                port,
                appareil,
                compact,
                etroit: window.innerWidth < ETROIT_SOUS,
                voirDetail,
              }),
            ],
            { tiroir: compact, pleinEcran: plein === "api" },
          ),
        ),
        avances,
      ),
    },
  ];

  /** Un repère au journal, avec les deux dernières minutes. Le même pour la
   * colonne et pour le bandeau d'état: deux copies finiraient par ne pas
   * emporter la même trace. */
  const complain = async () => {
    const now = sample();
    if (now) {
      await sending.current.complain({
        ...now,
        fin: trail.current.trail(performance.now()),
      });
    } else {
      throw new Error("Les mesures ne sont pas encore disponibles.");
    }
  };
  /** Où l'image est posée dans `<main>`: le même calcul que l'écran, centré
   * comme lui. Les états s'y posent, et laissent libres les bandes noires où
   * vit la manette à l'écran. `null` tant que l'image n'a pas de taille. */
  const posee = place(fit, picture, space);
  const cadre =
    picture.width > 0 && space.width > 0 && posee.width > 0
      ? {
          top: Math.max(0, (space.height - posee.height) / 2),
          left: Math.max(0, (space.width - posee.width) / 2),
          width: Math.min(space.width, posee.width),
          height: Math.min(space.height, posee.height),
        }
      : null;
  /** La largeur d'une bande noire à côté de l'image, où se pose la manette. */
  const bande = Math.max(0, (space.width - posee.width) / 2);
  /* Le cadre de la salle (`lib/cadre`) : l'état, le rôle et la géométrie,
     posés sur la racine en attributs et en variables CSS que les feuilles de
     chaque chantier lisent. */
  const fenetre = useFenetre();
  const zonesSures = useZonesSures(fenetre);
  const roleDuCadre: RoleDuCadre = padOnly ? "seule" : port === null ? "regarde" : "joueur";
  const geo = useGeometrie({
    mode: modeDuCadre({
      largeur: fenetre.width,
      hauteur: fenetre.height,
      grossier: coarse,
      role: roleDuCadre,
    }),
    fenetre,
    zonesSures,
    image: picture,
    ajustement: fit,
    etat: etatDuCadre({
      liaison: liaison.etat,
      chargement: booting !== null,
      jeu: Boolean(room?.game),
    }),
    role: roleDuCadre,
    manette: couches.pave
      ? usesProInput(room?.game?.console)
        ? DESSINS_MANETTES.pro
        : DESSINS_MANETTES.dolphin
      : null,
    largeurColonne: column,
    largeurPanneau: null,
    agrandie: bare && !compact,
  });
  /* Le panneau de commande sous l'image, au bureau, quand l'image n'y perd
     rien (`panneauAuBureau`) ; sinon au pied de la colonne. Au téléphone, il
     reste dans la colonne du tiroir jusqu'à la feuille unique (étape 4). */
  const panneauSous =
    geo.mode === "bureau" && geo.panneau.forme === "sous" ? geo.panneau.rect : null;
  /* Les places, que le chantier personnes remplacera par START 1P à 4P. */
  const places = (
    <Seats
      ownerSeat={boss?.seat}
      players={shot?.input.players ?? 4}
      busy={occupied}
      mics={shot?.input.mics ?? []}
      names={names}
      premieres={premieres}
      mine={port}
      displaced={shot?.input.displaced ?? false}
      onTake={(chosen) => session?.input.take(chosen)}
      onAsk={(chosen) => onRecover(chosen)}
    />
  );
  /** Les rangs de la colonne, selon l'état, le rôle et l'appareil. */
  const rangs = rangsDeLaColonne({
    etat: geo.etat,
    role: roleDuCadre,
    appareil,
    fiche: false,
  });
  /** La pastille de l'image agrandie : trois secondes après Ctrl, puis
   * trois secondes après chaque mouvement de la souris (colonne.11). */
  const [agrandieVue, setAgrandieVue] = useState(false);
  useEffect(() => {
    if (!bare || compact) {
      setAgrandieVue(false);
      return;
    }
    let minuteur = 0;
    const montrer = () => {
      setAgrandieVue(true);
      window.clearTimeout(minuteur);
      minuteur = window.setTimeout(() => setAgrandieVue(false), 3000);
    };
    montrer();
    window.addEventListener("mousemove", montrer);
    return () => {
      window.clearTimeout(minuteur);
      window.removeEventListener("mousemove", montrer);
    };
  }, [bare, compact]);
  /** Le clavier rendu à la colonne, retenu pendant un clic (`useApresLeClic`). */
  const pauseClavier = useApresLeClic(
    clavierEnPause({
      partie: enPartie,
      place: port !== null,
      appareil,
      menu: menu || configuring,
      auJeu,
    }),
  );
  /** La pile des avis, mesurée, et son lieu hors de l'image (`lieuDesAvis`). */
  const [pile, setPile] = useState<HTMLDivElement | null>(null);
  const hauteurPile = useHauteur(pile);
  const lieuAvis = lieuDesAvis({
    zone: space,
    image: cadre ? { x: cadre.left, y: cadre.top, w: cadre.width, h: cadre.height } : null,
    colonneACote: couches.colonne === "a-cote",
    hauteur: hauteurPile,
  });
  const pastilleAgrandie =
    agrandieVue && bare && !compact && (lieuAvis.lieu === "fronton" || lieuAvis.lieu === "pied");
  const takeHalf = () => {
    session?.video.setHalf(true);
    setHalf(true);
    rough.current.settled();
    setSuggestHalf(false);
    sending.current.quality("accepté");
  };
  /** Un geste du réglage des touches, suivi d'un `refresh`: ce sont des
   * changements locaux et immédiats, et attendre le prochain instantané ferait
   * clignoter l'écran une demi-seconde plus tard. */
  const puis =
    <A extends unknown[]>(geste: (...args: A) => void) =>
    (...args: A) => {
      geste(...args);
      session?.refresh();
    };
  /** La console et l'appareil que l'écran des touches règle: ceux du jeu
   * préparé pendant une préparation (`consoleDesTouches`). */
  const consoleTouches = consoleDesTouches(
    pendingSetup !== null,
    setupGame?.console,
    room?.game?.console,
  );
  const tenu = pendingSetup ? setupChoice : pad;

  /* Les avis de la salle, en une pile, et JAMAIS sur l'image : en tête de
     la colonne quand elle est à côté, dans une bande noire où la pile tient
     entière, sinon dans le flux au-dessus de l'écran (`lieuDesAvis`). Jusqu'au
     23 novembre 2026, cette pile se posait en haut de l'image (`#avisDuHaut`),
     et l'avis du format réduit en bas. */
  const avis =
    (shot && port !== null && !menu && !configuring) ||
    closingSoon !== null ||
    reduced ||
    pastilleAgrandie ||
    pauseClavier ? (
      <div
        id="avisDuCadre"
        ref={setPile}
        data-lieu={lieuAvis.lieu}
        className="pointer-events-none z-30 flex flex-col items-center gap-2 empty:hidden"
        style={
          lieuAvis.rect
            ? {
                position: "absolute",
                left: "calc(var(--zone-gauche) + 0.75rem)",
                right: "calc(var(--zone-droite) + 0.75rem)",
                top: lieuAvis.rect.y + Math.max(0, (lieuAvis.rect.h - hauteurPile) / 2),
              }
            : {
                padding: lieuAvis.lieu === "flux" ? "0.5rem 0.75rem" : undefined,
              }
        }
      >
        {/* Une manette branchée ou débranchée, cinq secondes (choix du
            7 septembre 2026). */}
        {shot ? (
          <ControllerStatus
            visible={port !== null && !menu && !configuring}
            state={shot.input}
            onConfigure={() => {
              setOngletTouches("pad");
              setBindings(true);
            }}
          />
        ) : null}
        {/* La salle va fermer faute d'activité, cliquable pour disparaître: un
            message qu'on ne peut pas faire taire finit par être contourné en
            fermant l'onglet. */}
        {closingSoon !== null ? (
          <button
            type="button"
            id="closingNotice"
            onClick={() => setClosingHidden(true)}
            className="pointer-events-auto w-full max-w-[52ch] border border-alert/60 bg-panel px-4 py-3 text-center text-corps leading-relaxed text-bright"
          >
            <span className="float-left -mt-1 mr-3" aria-hidden="true">
              <Bobine pose="dort" taille={44} />
            </span>
            Personne n&apos;a joué depuis un moment: la salle ferme dans {closingSoon}
            {closingSoon > 1 ? " minutes" : " minute"}. Touche une manette pour rester.
          </button>
        ) : null}
        {/* Le clavier ne joue plus: le focus est sur la colonne (`lib/focus-jeu`,
            `clavierEnPause`). */}
        {pauseClavier ? (
          <div
            id="clavierEnPause"
            className="regie-nuit pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border border-rule bg-panel px-3 py-2 text-corps text-muted"
          >
            <span>Le jeu ne reçoit plus tes touches.</span>
            <button
              type="button"
              id="rejouerAuClavier"
              onClick={() => zone.current?.focus({ preventScroll: true })}
              className="flex min-h-11 items-center gap-2 text-indigo hover:underline"
            >
              Rendre les touches au jeu
            </button>
          </div>
        ) : null}
        {/* L'image est passée en image légère toute seule: on le DIT, et on
            laisse revenir. */}
        {reduced ? (
          <div
            id="reducedNotice"
            className="pointer-events-auto flex max-w-[46ch] flex-col gap-2 border border-rule bg-panel px-4 py-3 text-center"
          >
            <p className="text-corps leading-relaxed text-bright">
              Ta connexion ne suivait pas : passage en image légère.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                id="keepReduced"
                onClick={() => setReduced(false)}
                className="border border-rule px-2 py-0.5 text-note text-muted hover:border-rule-bright"
              >
                Garder
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
                className="border border-indigo px-2 py-0.5 text-note text-indigo"
              >
                Revenir en {IMAGE.complete}
              </button>
            </div>
          </div>
        ) : null}
        {/* L'image agrandie par Ctrl : trois secondes, puis à chaque mouvement
            de la souris, et seulement dans une bande noire. Les boutons de
            coin à 30 % (« montrer (Ctrl) ») posés sur l'image sont partis. */}
        {pastilleAgrandie ? (
          <p
            id="pastilleAgrandie"
            role="status"
            className="regie-nuit border border-rule bg-panel px-3 py-1 text-corps text-muted"
          >
            {AGRANDIE.pastille}
          </p>
        ) : null}
      </div>
    ) : null;

  return (
    <Cadre geo={geo} className="flex h-full">
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* L'écran, et ce qui se pose à sa place quand il n'a pas d'image. Le
            panneau de commande est son voisin du dessous, jamais dedans : un
            écran éteint posé sur `inset-0` le couvrait. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {lieuAvis.lieu === "flux" ? avis : null}
          <Screen
            canvasRef={ref}
            zoneRef={zone}
            // Pas pendant un chargement: l'écran de chargement couvre l'image,
            // et Tab s'arrêterait sur une zone qu'on ne voit pas.
            jouable={enPartie}
            libelle={
              port === null
                ? "Image du jeu"
                : "Zone de jeu. Au clavier, tes touches y pilotent ta manette."
            }
            connected={shot?.video.connected ?? false}
            fit={fit}
            picture={shot?.video.picture ?? { width: 0, height: 0 }}
            onSpace={setSpace}
            onPrescale={(times) => session?.video.setPrescale(times)}
          />
          {lieuAvis.rect ? avis : null}
          {/* Ce qu'on voit quand cet appareil ne sert que de manette.
            Un écran noir se lit comme une panne, et c'en est une pour qui a
            oublié avoir choisi ce mode. La toile reste montée derrière: elle
            appartient à la boucle média, qui la tient par une référence, et la
            démonter reviendrait à mettre React sur le chemin des images. */}
          {padOnly ? (
            <div
              id="padOnlyNotice"
              className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ink px-6 text-center"
            >
              <span className="font-mono text-note uppercase tracking-[0.16em] text-faint">
                {MANETTE_SEULE}
              </span>
              <p className="max-w-[42ch] text-corps leading-relaxed text-muted">
                Cet appareil ne décode ni l&apos;image ni le son. Il envoie les boutons et il vibre,
                c&apos;est tout.
              </p>
              <p className="font-mono text-corps text-muted">
                aller-retour{" "}
                {shot?.input.roundTripMs === null || shot === null
                  ? "pas encore mesuré"
                  : `${shot.input.roundTripMs} ms`}
              </p>
            </div>
          ) : null}
          {/* Les gestes de PAGE d'un téléphone vivent dans la feuille du bas,
            ouverte par un seul « ••• » (`FeuilleDuBas`, audit M1, M2, P5). Avec
            la manette à l'écran, le « ••• » est l'une de ses pièces, placé loin
            des touches par `placePad`; sans elle, il se pose seul en haut à
            droite, dans les zones sûres. Cachée, la manette revient par la
            feuille: « cacher » sans retour était un piège (18 août 2026).
            La manette n'est pas montée sous le tiroir ni sous la feuille: le
            démontage relâche ce qu'un doigt tenait encore (audit M6). */}
          {couches.plusSeul ? (
            <button
              type="button"
              id="ouvrirFeuille"
              className="n3-plus regie-nuit"
              data-alerte={soundOff ? "" : undefined}
              aria-label={nomDuPlus(soundOff)}
              aria-haspopup="dialog"
              // Comme celui de la manette: un clic de souris laisse le clavier
              // au jeu (`TouchPad`).
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFeuille(true)}
            >
              •••
            </button>
          ) : null}
          {/* La manette à l'écran, par-dessus l'image et sous le menu.
            Montée seulement quand elle sert: cent boutons invisibles au-dessus
            d'une partie jouée au clavier intercepteraient des clics. */}
          {session && couches.pave && usesProInput(room?.game?.console) ? (
            <SwitchTouchPad
              source={session.input.switch}
              console={room?.game?.console}
              bar={bande}
              // Le son coupé se voit aussi sur la manette Pro: en salle Xbox
              // 360, rien ne le disait (audit M10).
              soundOff={soundOff}
              onFeuille={() => setFeuille(true)}
            />
          ) : session && couches.pave ? (
            <TouchPad
              /* La largeur des bandes noires de chaque côté de l'image.
               *
               * La page la connaît déjà: elle mesure la place et calcule le
               * placement pour le menu. La manette s'en sert pour se ranger DANS
               * les bandes plutôt que par-dessus le jeu, ce qui est la différence
               * entre des boutons posés sur du noir et des boutons posés sur les
               * pieds du personnage. Quand il n'y a pas de bande, elle retombe sur
               * les coins. */
              bar={bande}
              touch={session.input.touch}
              soundOff={soundOff}
              onFeuille={() => setFeuille(true)}
            />
          ) : null}
          {feuille ? (
            <FeuilleDuBas
              titre={`${nomSalle}${room?.game ? ` · ${room.game.name}` : ""}`}
              entrees={entreesDeLaFeuille({
                sonCoupe: soundOff,
                manette: coarse || onTouch ? (onTouch ? "montree" : "cachee") : null,
                plein,
                pleinActif: fullscreen,
              })}
              onEntree={(id) => {
                setFeuille(false);
                switch (id) {
                  case "son":
                    // Démarrer PUIS biper, dans cet ordre et dans le même geste:
                    // le bip ne sort de rien tant que le contexte n'a pas repris.
                    void session?.sound.start().then(() => session.sound.beep());
                    return;
                  case "menu":
                    setMenu(true);
                    return;
                  case "salle":
                    // Le tiroir sur un téléphone, la colonne dépliée sur un
                    // grand écran: la manette à l'écran « toujours » y ouvre
                    // aussi la feuille (`ouvrirLaSalle`).
                    if ("tiroir" in ouvrirLaSalle(compact)) setTiroir(true);
                    else setBare(false);
                    return;
                  case "manette":
                    setTouchPref(onTouch ? "off" : "on");
                    return;
                  case "plein-ecran":
                    toggleFullscreen();
                    return;
                }
              }}
              onFermer={() => setFeuille(false)}
              garde={garde.current}
              onComplain={complain}
            />
          ) : null}
          {asked ? (
            <AskedBanner
              from={asked.from}
              port={asked.port}
              lasts={room?.ask_lasts ?? 10}
              onAnswer={onAnswer}
              onExpire={onExpire}
            />
          ) : null}

          {learning ? (
            <div className="flex items-center justify-between gap-4 border-t border-indigo/40 bg-indigo/10 px-4 py-2 text-corps">
              <span>
                apprentissage de la manette, appuie sur{" "}
                <strong className="text-indigo">{learning}</strong>
              </span>
              <button
                type="button"
                id="skipStep"
                onClick={() => session?.input.skipLessonStep()}
                className="border border-indigo/50 px-2 py-1 text-note text-indigo"
              >
                passer
              </button>
            </div>
          ) : null}

          {/* L'état de la salle, à UN seul endroit: ici, sur l'image, et jamais
            sur toute la page. La colonne reste vivante pendant une panne, avec
            les places, « quitter » et « signaler » (audit P4, E7). Rien pour
            une page-manette, qui n'a pas d'image à attendre. */}
          {booting === null && !padOnly ? (
            <EtatSalle
              liaison={liaison}
              salle={salle()}
              moteur={moteurDe(room?.game?.console)}
              cadre={cadre}
              onRelancer={() => session?.relancerImage()}
              onReessayer={() => session?.relancerImage()}
              onQuitter={onLeave}
              onSignaler={complain}
              garde={garde.current}
              onReduire={takeHalf}
              onGarder={() => {
                rough.current.settled();
                setSuggestHalf(false);
                sending.current.quality("refusé");
              }}
              onPropositionVue={() => {
                if (proposalTold.current) return;
                proposalTold.current = true;
                sending.current.quality("proposé");
              }}
            />
          ) : null}

          {/* L'écran de chargement d'un changement de jeu, dans la zone de
            l'image lui aussi, et SOUS le menu: son bouton « ouvrir le menu »
            ouvrait un menu invisible (audit P2, E5).

            SANS `!idle`, et c'est la correction du 12 septembre 2026: au tout
            premier lancement d'une salle vide, le jeu n'est pas encore chargé
            côté worker, donc la salle est encore « au repos » pendant qu'il
            redémarre. */}
          {booting && !padOnly ? (
            <Booting
              game={booting.game}
              console={room?.library.find((one) => one.name === booting.game)?.console}
              save={booting.save}
              stalled={booting.stalled ?? false}
              onMenu={() => setMenu(true)}
              onGiveUp={() => {
                setBooting(null);
                setMenu(true);
              }}
              step={bootingStep(
                // Pas d'instantané: la demande vient de partir, donc « envoyée ».
                shot?.video ?? {
                  connected: true,
                  awaitingRestart: true,
                  paintedSince: 0,
                  dark: true,
                },
              )}
            />
          ) : null}

          {idle && !menu && !configuring ? (
            <EcranEteint
              phrase={phraseDuRepos(role, whyNotChoose)}
              onChoisir={() => setMenu(true)}
            />
          ) : null}

          {/* La ligne parlée: montée dès l'entrée, vide, et seul son texte
            change (audit A11Y-03, A11Y-07, A11Y-09). */}
          <LigneParlee
            liaison={
              booting && !padOnly
                ? {
                    etat: "demarrage",
                    depuisMs: performance.now() - booting.at,
                    // Ce que l'écran de chargement montre, dit aussi en mots:
                    // la lenteur à vingt secondes, puis l'échec (audit A11Y-07).
                    attente: attenteDemarrage(
                      (performance.now() - booting.at) / 1000,
                      booting.stalled ?? false,
                    ),
                  }
                : liaison
            }
            salle={salle()}
            demande={asked}
            delai={room?.ask_lasts ?? 10}
            peintes={shot?.video.painted ?? 0}
          />
        </div>
        {panneauSous ? (
          <PanneauCommande forme="sous" hauteur={panneauSous.h}>
            {places}
          </PanneauCommande>
        ) : null}
      </main>

      {bare || compact ? null : (
        <ColumnHandle width={column} onWidth={setColumn} onSettle={rememberColumn} />
      )}
      {/* À côté de l'image sur un grand écran, repliée par Ctrl; dans un
          tiroir par-dessus l'image sous 900 px ou au doigt (`lib/disposition`),
          ouvert par la feuille du bas, par le menu ou par Ctrl. La même
          colonne, entière, dans les deux formes. */}
      {couches.colonne === null ? null : (
        <TiroirSi actif={couches.colonne === "tiroir"} onFermer={() => setTiroir(false)}>
          <Colonne
            nomSalle={nomSalle}
            jeu={room?.game?.name ?? null}
            onQuitter={onLeave}
            largeur={compact ? null : column}
            tiroir={
              couches.colonne === "tiroir" ? (
                <BarreDuTiroir onFermer={() => setTiroir(false)} />
              ) : null
            }
            margeHaut={lieuAvis.lieu === "colonne" ? hauteurPile : undefined}
            avis={lieuAvis.lieu === "colonne" ? avis : null}
            etat={
              !idle && shot && !shot.padOnly ? (
                <ConnectionDiagnostic
                  video={shot.video}
                  liaison={shot.liaison}
                  salle={salle()}
                  moteur={moteurDe(room?.game?.console)}
                  onReduce={takeHalf}
                />
              ) : null
            }
            role={
              <BlocRole
                nom={name}
                place={port}
                libre={premiereLibre}
                onPrendre={salleFermee ? undefined : () => session?.input.play()}
              />
            }
            personnes={
              <>
                {/* Le rôle dit en clair: « Bo choisit le jeu. » La reprise du
                    rôle ne se montre que quand le worker dit que le chef ne
                    joue plus (`repriseDuRole`, audit T12). */}
                {/* Au repos, l'écran éteint le dit déjà : une chose, une fois. */}
                {boss && !salleFermee && !idle ? (
                  <p className="flex items-center gap-1 text-corps text-muted">
                    <Crown />
                    {boss.moi ? "Tu choisis le jeu." : chefChoisit(boss.name)}
                  </p>
                ) : null}
                {boss && !salleFermee && repriseDuRole(role, login !== null) ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-corps text-muted">{chefAbsent(boss.name)}</p>
                    <button
                      id="recoverOwner"
                      type="button"
                      className="border border-rule px-3 py-2 text-corps text-muted hover:text-indigo"
                      onClick={() => onRecover(null)}
                    >
                      Prendre le rôle de chef
                    </button>
                  </div>
                ) : null}
                <IlsRegardent people={people} owner={boss} />
                {salleFermee ? null : <Inviter lien={lienDInvitation(location.origin, base())} />}
              </>
            }
            panneau={
              panneauSous ? null : <PanneauCommande forme="colonne">{places}</PanneauCommande>
            }
            rangs={rangs}
            contenus={{
              signaler: <Signaler onComplain={complain} garde={garde.current} />,
              son: (
                <RangSon
                  joue={shot?.sound.state === "running"}
                  volume={volume}
                  onVolume={setVolume}
                  onActiver={() => void session?.sound.start()}
                />
              ),
              menu: <RangMenu appareil={appareil} onMenu={() => setMenu(true)} />,
              /* Les touches du clavier, sans ouvrir de menu (audit T02). */
              touches:
                lignesClavier.length > 0 ? (
                  <AideClavier
                    lignes={lignesClavier}
                    ouverte={aideOuverte}
                    onBascule={(ouverte) => {
                      setAideOuverte(ouverte);
                      retenirAideVue(!ouverte);
                    }}
                    onChanger={() => {
                      setOngletTouches("key");
                      setBindings(true);
                    }}
                  />
                ) : null,
              manette: (
                <RangManette
                  onOuvrir={() => {
                    setOngletTouches("pad");
                    setBindings(true);
                  }}
                />
              ),
              /* Le clip, à portée sans ouvrir le menu: quarante-cinq secondes
                 ne se demandent pas après coup. Un seul bouton pour deux
                 gestes, demander puis enregistrer. */
              garder: (
                <Aide texte={clipAide(clip.state)} sujet="le clip">
                  <button
                    type="button"
                    id="clip"
                    // Ponctuel: un clic de souris rend le clavier au jeu (`lib/focus-jeu`).
                    data-rend-le-jeu=""
                    onClick={takeClip}
                    disabled={clip.state.phase === "en cours" || clip.state.phase === "attendre"}
                    title={clipAide(clip.state)}
                    className={cn(
                      "n3-rang flex-1 justify-between",
                      clip.state.phase === "fait"
                        ? "border-good/60 text-good hover:bg-good/10"
                        : clip.state.phase === "raté"
                          ? "border-alert/60 text-alert"
                          : null,
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
                      <span className="font-mono text-note">
                        {Math.round(clip.state.bytes / 1e6)} Mo
                      </span>
                    ) : null}
                  </button>
                </Aide>
              ),
              agrandir: <RangAgrandir appareil={appareil} onAgrandir={() => setBare(true)} />,
              autres: (
                <AutresReglages>
                  {port !== null && !salleFermee ? (
                    <button
                      type="button"
                      id="watchOnly"
                      data-rend-le-jeu=""
                      onClick={() => session?.input.watchOnly()}
                      className="n3-rang"
                    >
                      {PLACE.rendre}
                    </button>
                  ) : null}
                  {/* Le micro, pour que les clips portent aussi la voix:
                      rien n'est rejoué, la voix part seulement vers le worker
                      et revient mêlée au son au prochain clip. */}
                  <Aide texte={micAide(shot?.mic)} sujet="le micro">
                    <button
                      type="button"
                      id="mic"
                      data-rend-le-jeu=""
                      onClick={toggleMic}
                      title={micAide(shot?.mic)}
                      className={cn(
                        "n3-rang flex-1",
                        shot?.mic === "on"
                          ? "border-good/60 text-good hover:bg-good/10"
                          : shot?.mic === "refused"
                            ? "border-alert/60 text-alert"
                            : null,
                      )}
                    >
                      <span className="flex h-4 w-4 [&>svg]:h-full [&>svg]:w-full">
                        <WaveIcon className="h-full w-full" />
                      </span>
                      {shot?.mic === "on"
                        ? "micro ouvert"
                        : shot?.mic === "asking"
                          ? "micro…"
                          : shot?.mic === "refused"
                            ? "micro refusé"
                            : "micro pour les clips"}
                    </button>
                  </Aide>
                  {micDevices.length > 0 ? (
                    <select
                      id="micDevice"
                      value={micDevice}
                      onChange={(event) => pickMic(event.target.value)}
                      title="choisir le micro"
                      className="border border-rule bg-transparent px-2 py-2 text-note text-corps"
                    >
                      <option value="">micro par défaut</option>
                      {micDevices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {idle ? null : (
                    <p id="saveReminder" className="text-corps leading-relaxed text-faint">
                      Pense à sauvegarder dans le jeu: une salle que tout le monde quitte ferme la
                      partie.
                    </p>
                  )}
                </AutresReglages>
              ),
            }}
            mesures={
              mode === "details" ? (
                <div id="stats">
                  <MesuresTechniques>
                    {shot ? (
                      <Instruments shot={shot} moteur={moteurDe(room?.game?.console)} />
                    ) : (
                      <p className="text-corps text-faint">Pas encore de mesures.</p>
                    )}
                  </MesuresTechniques>
                </div>
              ) : null
            }
            coin={
              <Coin
                mesures={mode === "details"}
                onMesures={() => setMode(mode === "details" ? "normal" : "details")}
              />
            }
          />
        </TiroirSi>
      )}

      {/* SANS `&& shot`: le menu ne dépend pas de l'image.
          Avec, cliquer « Choisir un jeu » dans une salle au repos faisait
          disparaître le panneau sans monter le menu — écran noir, aucune
          commande, jusqu'à l'arrivée du premier instantané. La bascule
          « manette seule » reconstruit la session, donc elle
          faisait s'évaporer le menu sous les doigts pour la même raison.
          Les entrées lisent déjà l'instantané en optionnel, avec un repli. */}
      {menu
        ? (() => {
            const common = {
              categories: rays,
              idle,
              appareil,
              // Le navigateur a fermé le dialogue lui-même (le geste « retour »
              // d'Android répété sans autre geste entre deux): la page suit.
              onQuitte: () => {
                setFolder(null);
                setMenu(false);
              },
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
              paused: configuring,
              // Un lancement en cours passe AVANT le repos: la salle est encore
              // vide le temps que le worker redémarre, et lui dire « aucun jeu »
              // à cet instant contredit ce qu'on vient de faire.
              footer: `${booting ? `${booting.game} · chargement` : idle ? "aucun jeu · choisis un jeu" : nomSalle} · ${people.length} présent${people.length > 1 ? "s" : ""}`,
            };
            // Dans un dossier, la sortie remonte d'abord aux consoles: le
            // bouton le dit, au lieu de promettre « reprendre la partie ». Un
            // seul nom pour les trois formes (`sortieDuMenu`).
            const sortieMenu = sortieDuMenu({ dossier: folder !== null, idle });
            if (shell === "wii")
              return <Channels key={String(idle)} {...common} sortie={sortieMenu} />;
            if (shell === "switch")
              return <Home key={String(idle)} {...common} who={name} sortie={sortieMenu} />;
            return <Xmb key={String(idle)} {...common} sortie={sortieMenu} />;
          })()
        : null}

      {/* Au-dessus du menu: l'erreur naît d'un lancement choisi dans le menu
          (voir `Surcouche`). */}
      {preparationError ? (
        <Surcouche>
          <div className="n3-preparation-error" role="alert">
            {preparationError}
            {/* « Masquer » et non « Fermer »: l'avis le plus courant dit
                « Fermeture du jeu en cours… », et deux « fermer » de sens
                différent se suivaient. */}
            <button type="button" onClick={() => setPreparationError("")}>
              Masquer
            </button>
          </div>
        </Surcouche>
      ) : null}
      {pendingSetup && (!setupPlayer || setupHidden) ? (
        <Surcouche>
          <div className="n3-preparation-watching" role="status">
            Préparation de {setupGame?.name} · {pendingSetup.players.filter((p) => p.ready).length}/
            {pendingSetup.players.length} joueurs prêts
            {setupHidden ? (
              <button
                type="button"
                id="resumePreparation"
                className="n3-action"
                onClick={() => setSetupHidden(false)}
              >
                Reprendre la préparation
              </button>
            ) : null}
          </div>
        </Surcouche>
      ) : null}
      {configuring && shot && session && configuringSwitch ? (
        <SwitchBindings
          source={session.input.switch}
          input={session.input}
          pending={pendingSetup}
          game={setupGame ?? room?.game}
          send={tell.prepare}
          close={() => {
            setBindings(false);
            setSetupHidden(true);
          }}
        />
      ) : configuring && shot ? (
        <Bindings
          onglet={ongletTouches}
          console={consoleTouches}
          held={tenu}
          readOnly={Boolean(setupPlayer?.ready)}
          actions={(setupGame ?? room?.game)?.guide?.actions[String(tenu)]}
          preparation={
            pendingSetup && session ? (
              <Preparation
                key={pendingSetup.id}
                pending={pendingSetup}
                game={setupGame}
                input={session.input}
                state={shot.input}
                selected={setupChoice}
                onSelect={(kind) => {
                  setSetupChoice(kind);
                  session.refresh();
                }}
                send={tell.prepare}
                onLater={() => setSetupHidden(true)}
              />
            ) : undefined
          }
          profiles={
            !pendingSetup && session ? (
              <section className="n3-preparation" aria-label="Mes profils complets">
                {room?.game ? <GameCard game={room.game} kind={pad} compact /> : null}
                <SetupProfiles
                  key={room?.game ? setupGameKey(room.game) : "idle"}
                  game={room?.game ?? undefined}
                  input={session.input}
                  state={shot.input}
                  selected={pad}
                  allowed={[pad]}
                  onSelect={() => session.refresh()}
                  disabled={shot.input.capturing !== null || shot.input.lesson !== null}
                />
              </section>
            ) : undefined
          }
          onPickKeys={puis((chosen: string) => session?.input.pickKeys(chosen))}
          onNewKeys={puis((chosen: string) => session?.input.newKeys(chosen))}
          onForgetKeys={puis((chosen: string) => session?.input.forgetKeys(chosen))}
          /* Le bouton n'existe que pour celui qui tient la salle. Le service
             vérifie l'adresse de son côté: cacher un bouton n'est pas une
             règle, c'est du confort. */
          onPublish={
            publishes
              ? async (chosen) => {
                  const profile = session?.input.keyProfileNamed(chosen);
                  if (!profile) return false;
                  const published = await publishProfile(chosen, profile);
                  if (published) {
                    session?.input.refreshRoomKeys();
                    session?.refresh();
                  }
                  return published;
                }
              : undefined
          }
          state={shot.input}
          // Chaque action est suivie d'un `refresh` (`puis`).
          onUse={puis((index: number | null) => session?.input.useP(index))}
          onCapture={puis((control: ControlKey, source: "pad" | "key", sign?: 1 | -1) =>
            session?.input.beginCapture(control, source, sign),
          )}
          onCancel={puis(() => session?.input.cancelCapture())}
          onLearn={puis(() => session?.input.beginLesson(consoleTouches, tenu))}
          onSkip={puis(() => session?.input.skipLessonStep())}
          onResetPad={puis(() => session?.input.resetPad(consoleTouches, tenu))}
          onResetKeys={puis(() => session?.input.resetKeys())}
          onClose={() => {
            session?.input.cancelCapture();
            setBindings(false);
            // Échap et le clic sur le fond doivent aussi pouvoir écarter une
            // préparation, sinon ils ne font rien du tout quand c'est elle qui
            // monte le panneau.
            setSetupHidden(true);
          }}
        />
      ) : null}
    </Cadre>
  );
}
