/**
 * The room: a picture, and a column of instruments beside it.
 *
 * The picture takes the height of the window and never causes the page to
 * scroll. Everything else lives in a column on the right that scrolls inside
 * itself, so reading a number never moves the image and never asks anybody to
 * scroll away from the game they are playing. Its width is dragged between two
 * bounds (`lib/column`), and the picture takes whatever is left.
 */
import { MUTE_SETTLES_MS, muteNews, type MuteNews } from "./lib/sourdine";
import { typingIn } from "./lib/typing";
import { base, salle } from "./lib/base";
import { Crown } from "./components/Crown";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { closeSalle, type Game, type Room as RoomState } from "./client";
import { SetupProfiles } from "./components/SetupProfiles";
import { GameCard } from "./components/GameCard";
import { Rayonnage } from "./components/Rayonnage";
import { setupGameKey } from "./lib/setups";
import { Preparation, PreparationEnBref, SceneRefus } from "./components/Preparation";
import { lignesManettes, lignesSalle, qui } from "./lib/rubriques";
import { useSetupChoice } from "./lib/useSetupChoice";
import { Entrance } from "./components/Entrance";
import { Lobby } from "./components/Lobby";
import { ControllerStatus, ManetteDansLaBande } from "./components/ControllerStatus";
import { manetteAConfigurer } from "./lib/plug";
import { dire } from "./lib/liaison-mots";
import { useMicro } from "./lib/micro";
import { Booting } from "./components/Booting";
import {
  CeSoir,
  EtatPastille,
  FicheEtat,
  Neige,
  PleinCadre,
  ScenesDesEtats,
} from "./components/EtatSalle";
import { PlacesAuPasse } from "./components/PlacesAuPasse";
import {
  rappelsDeLEtat,
  useAllerAuGeste,
  useAvantLaFermeture,
  useModeleDeLEtat,
} from "./components/useEtatDeLaSalle";
import { signaleDansLaFiche } from "./lib/etat-modele";
import { lieuDeLaFiche, montageDeLaPastille } from "./lib/etat-place";
import { LigneParlee } from "./components/LigneParlee";
import { AnnonceEnLettres } from "./components/AnnonceEnLettres";
import { Ouverture } from "./components/Ouverture";
import {
  attenteDemarrage,
  bootingStep,
  habitudeMesuree,
  seuilLong,
  suiteDuChargement,
} from "./lib/booting";
import { GardeSignalement } from "./lib/garde-signalement";
import { FENETRE_VIDE, fenetrePourProposition, type Liaison } from "./media/liaison";
import {
  AutresReglages,
  BlocRole,
  Colonne,
  RangAgrandir,
  RangManette,
  RangMenu,
  RangSon,
  RangTouches,
} from "./components/Colonne";
import { VueTouches, type Releve } from "./components/VueTouches";
import { CoteBorne } from "./components/CoteBorne";
import { Credit } from "./components/Credit";
import { TempsDeJeu, useLancement } from "./components/TempsDeJeu";
import { Fronton } from "./components/Fronton";
import { identify } from "./media/families";
import { verificationDolphin, verificationPro, type ManetteLue } from "./lib/verification";
import { Coin } from "./components/Coin";
import { EcranEteint, phraseDuRepos } from "./components/EcranEteint";
import { PanneauCommande } from "./components/PanneauCommande";
import { Instruments } from "./components/Instruments";
import { MesuresTechniques } from "./components/MesuresTechniques";
import { Signaler } from "./components/Signaler";
import { Etiquette } from "./components/Etiquette";
import { rangsDeLaColonne } from "./lib/colonne";
import { ColumnHandle } from "./components/ColumnHandle";
import { Menu } from "./components/menu/Menu";
import { useColonneDuMenu, useLectureDesSauvegardes } from "./components/menu/crochets";
import { fermerLaSalle, fermerLeJeu } from "./components/menu/gestes";
import { ficheDuJeu, lignesJeux, type EntreeJeux } from "./components/menu/RubriqueJeux";
import { lignesReglages } from "./components/menu/RubriqueReglages";
import { placeDuMenu, type FicheDeLigne, type Rubrique } from "./lib/menu";
import type { MenuAction } from "./media/menupad";
import { ScreenIcon, WaveIcon } from "./components/XmbIcons";
import { Screen } from "./components/Screen";
import { SwitchTouchPad } from "./components/SwitchTouchPad";
import { TouchPad, type BoiteDuCadre } from "./components/TouchPad";
import { Places } from "./components/Places";
import { CartePlace } from "./components/CartePlace";
import { DemandeRecue, type DemandeEnCours } from "./components/DemandeRecue";
import { IlsRegardent } from "./components/IlsRegardent";
import { Mesures } from "./components/Mesures";
import { ligneDeLaLiaison } from "./lib/mesures";
import { SuiviPlaces } from "./components/SuiviPlaces";
import { encreDuJoueur } from "./lib/etiquette";
import {
  formeDesPlaces,
  hoteDesPlaces,
  lesPlaces,
  regardentDe,
  REPRISE_REPONSE_S,
  sujetDeLaCarte,
} from "./lib/places";
import {
  useCarteDePlace,
  useDireLaReprise,
  useDonDiffere,
  type Annoncer,
  type Nature,
} from "./lib/usePlaces";
import { forgetName, rememberedName } from "./lib/name";
import {
  applyTheme,
  rememberMode,
  rememberTheme,
  storedMode,
  looksLikeAPhone,
  rememberPadOnly,
  rememberTouch,
  showsTouchPad,
  storedPadOnly,
  storedTheme,
  storedTouch,
  oublierLaCoque,
} from "./lib/theme";
import { place, qualities, rememberFit, storedFit } from "./lib/fit";
import { useBare } from "./lib/fullscreen";
import {
  apresCtrl,
  couchesDeLaSalle,
  focusApresFermeture,
  ouvrirLaSalle,
  voileSurImage,
  type HauteurFeuille,
} from "./lib/disposition";
import { entreesDeLaFeuille, OUVRE_LA_FEUILLE } from "./lib/feuille";
import { lireAppareil, pleinEcranPossible } from "./lib/plein-ecran";
import { armerReveilDuSon } from "./media/reveil-son";
import { Bande } from "./components/Bande";
import { BarreSalle, BoutonSalle } from "./components/BarreSalle";
import { FeuilleSalle } from "./components/FeuilleSalle";
import { ManetteSeule } from "./components/ManetteSeule";
import { largeurPanneau, rememberColumn, storedColumn } from "./lib/column";
import {
  enAttente,
  publishProfile,
  reessayer,
  useBindings,
  useRoomReference,
} from "./lib/bindings";
import { ouvrirReglage, useReglage, type Onglet } from "./manettes/entree";
import { HoteReglage } from "./manettes/HoteReglage";
import { ToutesLesTouches } from "./manettes/ToutesLesTouches";
import type { TrameDolphin } from "./manettes/reglage/Dolphin";
import type { TramePro } from "./manettes/reglage/Pro";
import type { Bande as BandeDuReglage } from "./manettes/reglage/Reglage";
import { deviceLabel } from "./lib/faces";
import { cn } from "./lib/cn";
import { aideDeLaSalle, appareilDe } from "./lib/appareil";
import { clavierEnPause, useFocusJeu } from "./lib/focus-jeu";
import { aideDejaVue, aideDolphin, aidePro, retenirAideVue } from "./lib/aide-clavier";
import { keyLabel, keyboardLayout } from "./media/describe";
import { HoteDesSurcouches, Surcouche } from "./components/Surcouche";
import { choisirTransition, transition } from "./retro/transitions";
import { useMe, useRename } from "./lib/me";
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
import type { Session, Snapshot } from "./media/session";
import { clipAide, clipLabel, micAide } from "./lib/clip";
import {
  CONSOLES,
  consoleName,
  formatAttendu,
  moteurDe,
  preparable,
  usesProInput,
} from "./lib/consoles";
import { rememberPad, slotLabel, storedPad, type Pad, type Slot } from "./lib/saves";
import { useClip } from "./lib/useClip";
import {
  CARTE,
  DEMANDE,
  PLACES,
  PLACE,
  SANS_REPONSE,
  chefAbsent,
  chefChoisit,
  prixImageLegere,
  MENU,
  TOUCHES,
  ZONE,
  AGRANDIE,
  pastille as pastilleDeLaPlace,
} from "./lib/mots";
import {
  Cadre,
  useApresLeClic,
  placeDe,
  useFenetre,
  useGeometrie,
  useHauteur,
  useZonesSures,
} from "./components/Cadre";
import {
  MANETTES as DESSINS_MANETTES,
  PROPORTIONS_PAR_DEFAUT,
  etatDuCadre,
  lieuDesAvis,
  modeDuCadre,
  ouEstLaMascotte,
  type Role as RoleDuCadre,
} from "./lib/cadre";
import { pourquoiPasChoisir, repriseDuRole } from "./lib/chef";
import { abonner, effetsDu, instantane } from "./lib/effets";
import { consoleDesTouches, sauvegardeDuLancement, sauvegardeRelancee } from "./lib/lancement";
import {
  entreeDeLAdresse,
  entreeDeLaSession,
  retenirEntree,
  retenirPlace,
  lienDInvitation,
  oublierPlace,
  placeDeLAdresse,
  sortieVers,
  type Entree,
} from "./lib/entree";
import { estLibre } from "./components/Lobby";
import { Aide } from "./components/Aide";
import { Inviter } from "./components/Inviter";
import { useSession, useSnapshot } from "./lib/useSession";

/* La forme du menu (XMB, chaînes Wii, accueil Switch) est partie avec les
   trois formes : la clé qui la retenait s'efface au démarrage (M1). */
oublierLaCoque();

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
  /** « Ce n'est pas toi ? » vient d'oublier le nom gardé : « Qui joue ? » le dit. */
  const [oublie, setOublie] = useState(false);

  // Pas le formulaire tant que l'identité n'a pas répondu: l'afficher une demi
  // seconde avant de le retirer se lit comme un défaut. Mais plus une page
  // blanche non plus: le 22 novembre 2026, un site muet la laissait vide sans
  // limite (audit E8). L'écran d'ouverture le dit, puis a une fin.
  if (!sansAttendre && (isPending || settled.isPending))
    return (
      <Ouverture
        salle={salle()}
        nomGarde={local}
        onReessayer={() => window.location.reload()}
        onEntrer={() => setSansAttendre(true)}
      />
    );

  const identified = me?.login ?? null;
  const name = identified ? me!.name : local;
  if (!name) return <Entrance onName={setLocal} salle={`salle ${salle()}`} oublie={oublie} />;
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
        setOublie(true);
        setLocal("");
      }}
    />
  );
}

/** L'écran d'une manette seule : réduit à rien, mais monté, parce que la
 * toile appartient à la boucle média (ADR D13). */
const SANS_ECRAN: React.CSSProperties = {
  position: "absolute",
  width: 0,
  height: 0,
  overflow: "hidden",
};

/** Le repli de la feuille si le cadre ne la mesure pas (bureau) : toute la
 * fenêtre. Elle ne s'ouvre qu'en main, où le cadre la mesure toujours. */
const TOUTE = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };

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
  /** Une réponse de reprise en vol. Ici et non dans la carte de la place :
   * la carte se remonte en passant dans le menu ouvert (`Surcouche`). */
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
            onEnter={(numero) => {
              // « Prendre la place 3 » : la place va dans l'adresse, et la
              // salle la lit comme celle d'un lien de l'accueil du salon.
              if (numero !== undefined) retenirPlace(numero);
              onEnter();
            }}
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
          // La reprise vit dans la salle depuis le 23 novembre 2026 : la carte
          // de la place et la demande reçue, dans la colonne ou la bande,
          // jamais sur l'image (le panneau fixe de `Recovery` s'en va).
          recovery={recovery}
          recoveryError={recoveryError}
          recoveryBusy={recoveryBusy}
          onRecoveryAction={(action) => {
            setRecoveryBusy(true);
            void recover(action).finally(() => setRecoveryBusy(false));
          }}
          onRecoveryClose={() => {
            setRecovery(null);
            setRecoveryError("");
          }}
          tell={lobby}
          bind={(take, give, boot, pad) => {
            takeSeat.current = take;
            yieldSeat.current = give;
            showBoot.current = boot;
            padTo.current = pad;
          }}
        />
      )}
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

/** Les places qui viennent de s'allumer et de s'éteindre (`usePlaces`). */
type SuiviVu = { vient: ReadonlySet<number>; part: ReadonlySet<number> };
const SANS_SUIVI: SuiviVu = { vient: new Set(), part: new Set() };

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
  recovery,
  recoveryError,
  recoveryBusy,
  onRecoveryAction,
  onRecoveryClose,
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
  /** La reprise en cours, venue du salon : la mienne, ou celle qui vise ma place. */
  recovery: RecoveryNotice | null;
  recoveryError: string;
  recoveryBusy: boolean;
  onRecoveryAction: (action: Record<string, unknown>) => void;
  onRecoveryClose: () => void;
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
  /* Le mode de la salle (`lib/cadre`) : au bureau, étroite à la souris, ou
     tenue en main (portrait, paysage). Il remplace le tiroir de
     `lib/disposition` (23 novembre 2026) : tenue en main, la salle a sa
     barre, sa feuille et sa manette dans la boîte du cadre ; étroite, sa
     colonne passe sous l'image. */
  const fenetre = useFenetre();
  const zonesSures = useZonesSures(fenetre);
  const modeSalle = modeDuCadre({
    largeur: fenetre.width,
    hauteur: fenetre.height,
    grossier: coarse,
    role: padOnly ? "seule" : "joueur",
  });
  const tenu = modeSalle === "portrait" || modeSalle === "paysage";
  /** La feuille « La salle » et sa hauteur, ou `null`. Jamais retenue :
   * rouverte au chargement, elle cacherait la partie qu'on vient rejoindre. */
  const [feuilleVoulue, setFeuille] = useState<HauteurFeuille | null>(null);
  /** La feuille VRAIMENT ouverte : jamais hors d'une salle tenue en main. Une
   * feuille demandée sur un grand écran démontait la manette sans rien ouvrir
   * (relecture du 22 novembre 2026, du temps du tiroir). */
  const feuille = tenu ? feuilleVoulue : null;
  // Une fenêtre qui quitte le mode tenu ne garde pas sa feuille pour la
  // prochaine fois.
  useEffect(() => {
    if (!tenu) setFeuille(null);
  }, [tenu]);
  /** Ce que Ctrl lit au moment où elle est relâchée (`apresCtrl`). Une
   * référence, parce que le menu et le réglage des touches sont déclarés plus
   * bas et changent sans que l'écoute du clavier ait à se rebrancher. */
  const pourCtrl = useRef<{ feuille: HauteurFeuille | null; menu: boolean; touches: boolean }>({
    feuille: null,
    menu: false,
    touches: false,
  });
  const basculerFeuille = useCallback(() => {
    const suite = apresCtrl(pourCtrl.current);
    if (suite === null) return;
    setMenu(suite.menu);
    setFeuille(suite.feuille);
  }, []);
  // Ctrl seule replie la colonne à côté de l'image, et ouvre ou ferme la
  // salle entière quand elle est tenue en main, sans jamais l'empiler sur le
  // menu.
  const { bare, setBare, fullscreen, toggleFullscreen } = useBare(
    coarse,
    tenu ? basculerFeuille : undefined,
  );
  /** Ce que l'appareil permet: plein écran, écran d'accueil, ou rien. Lu une
   * fois: ni l'API ni l'écran d'accueil ne changent pendant une visite. */
  const plein = useRef(pleinEcranPossible(lireAppareil())).current;
  /** La largeur de la colonne, choisie entre deux bornes: voir `lib/column`. */
  const [column, setColumn] = useState(storedColumn);
  const [volume, setVolume] = useState(START_VOLUME);
  const [deviceRate, setDeviceRate] = useState(false);
  const [lipsync, setLipsync] = useState(false);
  /** Le panneau « Touches et manettes », ouvert par `ouvrirReglage` (K05) :
   * il prend la place des rangs de la colonne, jamais celle de l'image. */
  const reglage = useReglage();
  const [preparationError, setPreparationError] = useState("");
  /** Le jeu dont cette page a demandé la fermeture, tant qu'il tourne :
   * « fermer le jeu » le dit au lieu d'un avis (P10). */
  const [fermetureDemandee, setFermeture] = useState<number | null>(null);
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
  /** Ouvre « Touches et manettes » sur `onglet`. Le menu modal se ferme : il
   * rendrait la colonne inerte. Tenue en main, la feuille se ferme aussi : le
   * panneau a sa place à côté de l'image (`Geometrie.reglage`), et la
   * feuille agrandie qui le portait jusqu'au 24 novembre 2026 couvrait
   * l'image. */
  const ouvrirLesTouches = (onglet: Onglet) => {
    setMenu(false);
    if (tenu) setFeuille(null);
    ouvrirReglage(onglet);
  };
  pourCtrl.current = { feuille, menu, touches: reglage !== null };
  // Le menu, ou quelqu'un qui demande ta place, passent avant la feuille :
  // c'est un dialogue modal, qui rendrait le menu ou la demande inertes
  // dessous. La demande ne dure que dix secondes.
  useEffect(() => {
    if (!menu && asked === null) return;
    setFeuille(null);
  }, [menu, asked]);
  /* Les sauvegardes débloquées et l'identité, lues quand une fiche de jeu
     peut s'ouvrir, et relues à chaque ouverture (chantier menus). */
  const { unlockedSaves, checkingIdentity, relireLaBibliotheque } = useLectureDesSauvegardes(
    menu,
    idle,
  );
  /** Le jeu ARMÉ, pour ceux qui n'ont pas de choix de sauvegarde.
   *
   * Un jeu de carte mémoire se confirme par son panneau de sauvegarde. Un jeu
   * Wii n'en a pas, donc il lui faut la confirmation d'avant: ce qu'on confirme
   * est la fin de la partie de tout le monde, et ça ne doit pas tenir en une
   * pression. */
  const [armed, setArmed] = useState<number | null>(null);
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
  /** Comment l'image est posée à l'écran. Séparé du format transporté: le
   * premier se choisit sur le débit qu'on a, le second sur ce qu'on aime voir. */
  const [fit, setFit] = useState(storedFit);
  /** Faut-il montrer la manette à l'écran. Retenu, parce que quelqu'un qui joue
   * au téléphone y rejouera au téléphone. */
  const [touchPref, setTouchPref] = useState(storedTouch);

  /** La place dont l'image dispose, rapportée par l'écran. Sert au menu, qui
   * annonce ce que chaque choix donnerait. */
  const [space, setSpace] = useState({ width: 0, height: 0 });
  useEffect(() => rememberFit(fit), [fit]);
  useEffect(() => rememberTouch(touchPref), [touchPref]);
  useEffect(() => rememberMode(mode), [mode]);
  /** Le jeu demandé et l'image peinte au moment où on l'a demandé.
   *
   * Deux choses parce que la fin du chargement se reconnaît à une IMAGE, pas à
   * une socket: le worker répond avant que Dolphin ait dessiné quoi que ce soit,
   * et cacher l'écran de chargement là montrerait du noir. */
  const [booting, setBooting] = useState<{
    game: string;
    /** Le jeu demandé dans la bibliothèque, pour « Arrêter le lancement »
     * (C7a) ; inconnu quand l'annonce nomme un jeu que la page n'a pas. */
    index?: number;
    /** La sauvegarde annoncée et qui a lancé (C6), relue au rendu contre les
     * places du moment : une place peut arriver après l'annonce. */
    annonce: { save: string; saveSlot?: number; starter?: string };
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
  /** L'instant de lancement du jeu en cours, d'après l'âge que le salon
   * publie (`Room.partie.depuis_s`, ADR D43) : le temps de jeu du panneau. */
  const lancement = useLancement(room?.partie, enPartie);
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
      // propose (`EcranEteint`). Il n'y a plus de dossier où remonter.
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
  /** La manette à l'écran est-elle montée en ce moment. Nommé parce que
   * plusieurs choses en dépendent et doivent être d'accord : la manette
   * elle-même, la pose du cadre et la feuille. Une vraie manette branchée
   * l'efface en automatique (`showsTouchPad`). */
  const onTouch = showsTouchPad(touchPref, coarse, Boolean(shot?.input.padId));
  /** Montrer ou cacher les touches à l'écran. Avec une vraie manette
   * branchée, les cacher revient à l'automatique, qui les rendra quand la
   * manette partira ; sans elle, c'est un choix retenu. */
  const basculerTactile = () => setTouchPref(onTouch ? (shot?.input.padId ? "auto" : "off") : "on");
  /** Le son ne joue pas. Lu à la cadence de l'instantané, deux fois par
   * seconde, comme tout ce que la page affiche. */
  const soundOff = shot ? shot.sound.state !== "running" : false;
  // Le compte à rebours de fermeture, dit par le worker dans le message de
  // salle. Il n'est plus masqué d'un clic : il ne couvre plus rien. La
  // pastille le dit hors de l'image, la fiche porte « Je reste » (ADR D40).
  const closingIn = shot?.input.closingIn ?? 0;
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
  /** Ce que les mots de l'état savent en plus de la liaison
   * (`lib/liaison-mots`). */
  const contexteEtat = {
    moteur: moteurDe(room?.game?.console),
    jeu: room?.game?.name ?? null,
    salon: sortie !== null,
  };

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
      const tranche = alive.current?.veille.prendreFenetre() ?? FENETRE_VIDE;
      const poids = bootingNow.current !== null ? "tenir" : fenetrePourProposition(tranche);
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
      // La feuille se ferme elle-même par Échap: un `preventDefault` ici la
      // garderait ouverte.
      // Le panneau des touches garde son Échap : il annule d'abord, puis ferme.
      if (event.key !== "Escape" || menu || reglage !== null || feuille) return;
      // Sans `preventDefault`, la fin de ce même appui est une « demande de
      // fermeture » pour le navigateur, et le menu, ouvert en dialogue modal
      // pendant l'événement, la recevait: il s'ouvrait et se refermait aussitôt
      // (vu dans Chrome 151 le 22 novembre 2026, par `focus.mjs`).
      event.preventDefault();
      setMenu(true);
    };
    addEventListener("keydown", press);
    return () => removeEventListener("keydown", press);
  }, [menu, reglage, feuille]);

  /* Le modèle de focus (`lib/focus-jeu`): le clavier du jeu vit dans la zone de
     jeu, et partout ailleurs Entrée, Espace et les flèches font ce que fait le
     navigateur (audit A11Y-01, 22 novembre 2026). */
  const { zone, auJeu } = useFocusJeu({ menu, playing, enPartie });

  /** Le jeu que la salle dit faire tourner, par son nom comme `booting`. */
  const jeuEnCours = room?.game?.name ?? null;
  /** L'habitude du jeu qui démarre (D05), lue dans la bibliothèque. */
  const habitudeDuChargement = booting
    ? room?.library.find((one) => one.name === booting.game)?.demarrage
    : null;
  /** Le jeu demandé dans la bibliothèque, pour « Arrêter le lancement »
   * (C7a) : connu au lancement d'ici, retrouvé par son nom sinon. */
  const indexDemande = booting
    ? (booting.index ?? room?.library.find((one) => one.name === booting.game)?.index)
    : undefined;
  /** Où en est l'attente du chargement montré, comme l'écran et la ligne
   * parlée la lisent : normale, longue ou perdue. */
  const attenteDuChargement =
    booting && !padOnly
      ? attenteDemarrage(
          (performance.now() - booting.at) / 1000,
          booting.stalled ?? false,
          seuilLong(habitudeDuChargement),
        )
      : undefined;
  /** L'écran de chargement offre ses gestes, Signaler compris (C7a). */
  const chargementParle = attenteDuChargement !== undefined;
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

  /* Une place précise demandée par l'adresse (`?place=N`, lien de l'accueil
     du salon ou de l'avant-salle). Le worker donne d'abord la première libre ;
     une fois cette place reçue, la page demande CELLE-CI si la salle la dit
     encore libre, puis l'oublie dans l'adresse : un rechargement ne la
     redemande pas, peut-être à quelqu'un qui l'a prise depuis. Prise par
     `take`, la seule demande d'une place précise que la couche média offre :
     la place est vérifiée libre juste avant, pour ne déloger personne. */
  const placeDemandee = useRef(placeDeLAdresse(location.search));
  useEffect(() => {
    const voulue = placeDemandee.current;
    if (voulue === null || !session || watching || port === null || !room) return;
    placeDemandee.current = null;
    oublierPlace();
    const siege = room.seats.find((seat) => seat.port === voulue);
    if (voulue !== port && siege !== undefined && estLibre(siege)) session.input.take(voulue);
  }, [session, watching, port, room]);
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
  /** La vue des touches (`VueTouches`) : « clavier » ou « manette », ouverte
   * par son rang. À la première visite au clavier, la colonne s'ouvre d'elle-
   * même sur « Tes touches au clavier », tant que « Revenir » ne l'a pas
   * fermée. */
  const [vueTouches, setVueTouches] = useState<"clavier" | "manette" | null>(null);
  const [premiereVisite] = useState(() => !aideDejaVue());
  const [vueFermee, setVueFermee] = useState(false);
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
          // Le salon écrit « la sauvegarde de Bo » pour tout le monde ; qui a
          // lancé lit « Sur ta sauvegarde. », les autres son étiquette (C6).
          annonce: { save: told.save, saveSlot: told.saveSlot, starter: told.starter },
          at: performance.now(),
        });
        // Le menu se ferme, comme sur le chemin local.
        //
        // Sans ça, celui qui n'a PAS cliqué garde son menu ouvert par-dessus
        // l'écran de chargement — le menu est au-dessus — et il y lit « aucun
        // jeu » pendant que le jeu demandé démarre.
        setMenu(false);
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

  /** Oubliée dès que le jeu change : rien à fermer de plus, et le même jeu
   * relancé plus tard ne se dit pas en fermeture. */
  const fermeture =
    fermetureDemandee !== null && room?.game?.index === fermetureDemandee
      ? fermetureDemandee
      : null;
  useEffect(() => {
    if (fermetureDemandee !== null && fermeture === null) setFermeture(null);
  }, [fermetureDemandee, fermeture]);
  const pendingSetup = room?.preparation ?? null;
  const [setupChoice, setSetupChoice] = useSetupChoice(pad, pendingSetup);
  /* La préparation ne bloque plus le jeu (P1, 24 novembre 2026) : elle était
     un dialogue modal qui couvrait l'image, coupait l'entrée et ne se fermait
     qu'avec « Plus tard ». Elle est un bloc de la colonne ; seul le réglage
     des touches, ouvert par « Essayer mes touches », retient les gestes. */
  const configuring = reglage !== null;
  // Par sa clé quand le salon la connaît: la position a pu changer depuis le
  // début de la préparation (ADR D23).
  const setupGame = room?.library.find((game) =>
    pendingSetup?.key ? game.key === pendingSetup.key : game.index === pendingSetup?.game,
  );
  const configuringSwitch = usesProInput(setupGame?.console ?? room?.game?.console);
  /** Un écran couvre toute l'image: la salle au repos, un chargement, ou le
   * rideau d'une arrivée sans image. Personne n'y joue, et ces écrans
   * recouvraient la manette à l'écran et son « ••• » : sur un téléphone, la
   * salle (places, signaler, quitter) devenait introuvable pendant une panne
   * (audit P4, E7). La manette n'est donc pas montée, et « La salle » reste
   * dans la barre, hors de ces écrans (23 novembre 2026).
   *
   * Pas pour une page « manette seule »: elle n'a ni image ni écran de
   * chargement, et c'est elle qu'on tient pendant que le jeu démarre
   * (`voileSurImage`). */
  const voile = voileSurImage({
    repos: idle && !menu && !configuring,
    chargement: booting !== null,
    rideau: dire(liaison, salle(), contexteEtat).niveau === "plein",
    padOnly,
  });
  /** La page a choisi de regarder (`input.watching`), et ne tient pas de
   * place. */
  const regardeParChoix = (shot?.input.watching ?? false) && port === null;
  /** Ce que la salle veut monter, avant ce que la feuille et les écrans
   * démontent. Pas de manette pour qui a choisi de regarder : il n'a rien à
   * envoyer, et le portrait sans manette lui donne la bande (`lib/cadre`).
   * Le choix, et pas l'absence de place : à l'entrée, la place arrive après
   * la première image, et une manette apparue ensuite déplaçait l'image (vu
   * par `parcours.mjs`, 23 novembre 2026). */
  const couchesVoulues = {
    tenu,
    etroit: modeSalle === "etroit",
    feuille,
    manette: session !== null && onTouch && (!regardeParChoix || padOnly),
    voile,
    bare,
    reglage: reglage !== null,
  };
  /** Ce qui est monté par-dessus l'image, décidé en un seul endroit. */
  const couches = couchesDeLaSalle(couchesVoulues);
  /* Le focus revient à ce qui a ouvert la feuille.

     « La salle » posé parmi les touches est démonté avec la manette pendant
     que la feuille est ouverte (le démontage relâche les touches tenues),
     donc le dialogue ne peut plus lui rendre le focus : il tombait sur le
     document, et un lecteur d'écran repartait du début de la page (relecture
     du 22 novembre 2026, WCAG 2.4.3). Seulement quand rien d'autre ne s'ouvre
     à la place : une entrée de la feuille peut ouvrir le menu. */
  const coucheAvant = useRef(false);
  useEffect(() => {
    const ouverte = feuille !== null;
    const fermee = coucheAvant.current && !ouverte;
    coucheAvant.current = ouverte;
    if (!fermee || menu) return;
    const ici = document.activeElement;
    const ouvreuse = document.querySelector<HTMLElement>(OUVRE_LA_FEUILLE);
    const suite = focusApresFermeture({
      perdu: ici === null || ici === document.body,
      salle: ouvreuse !== null,
    });
    if (suite === "salle") ouvreuse?.focus({ preventScroll: true });
    else if (suite === "jeu") zone.current?.focus({ preventScroll: true });
    // `zone` est la même référence d'un rendu à l'autre (`useFocusJeu`).
  }, [feuille, menu, zone]);
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

  /** L'état de la salle en UN modèle (`lib/etat-modele`) : une seule
   * pastille, une seule fiche, ou le plein cadre. Une page-manette n'attend
   * pas d'image, et un chargement a son propre écran : seule la fermeture
   * proche leur reste. */
  const modele = useModeleDeLEtat({
    liaison: booting === null && !padOnly ? liaison : { etat: "ok" },
    salle: salle(),
    contexte: contexteEtat,
    fermeDans: closingIn,
    place: port !== null,
    legerePassee: reduced,
    legere: half,
    neige: effetsDu(effets).has("neige"),
    vues: shot?.couvertureVue ?? 0,
  });

  /** Les consoles présentes dans cette bibliothèque, dans l'ordre des sorties.
   *
   * Construites depuis ce que la salle annonce, jamais depuis une liste écrite
   * ici: une console qui n'a aucun jeu n'a pas de groupe, et un code qu'on ne
   * sait pas nommer se range quand même plutôt que de disparaître. Depuis le
   * menu unique, plus de dossier à ouvrir : la rubrique Jeux range les jeux
   * sous le nom de leur console, et un seul groupe ne porte pas de titre. */
  const shelves = CONSOLES.flatMap((one) => {
    const games = (room?.library ?? []).filter((game) => (game.console ?? "?") === one.code);
    return games.length > 0 ? [{ ...one, games }] : [];
  });
  /** Les joueurs que fermer le jeu arrête, dit dans sa fiche (M10). */
  const tenues = occupied.filter(Boolean).length;

  /** Le détail de la connexion, dans la colonne : la feuille agrandie d'une
   * salle tenue en main, la colonne dépliée ailleurs (`ouvrirLaSalle`). */
  const voirDetail = () => {
    setMode("details");
    if ("feuille" in ouvrirLaSalle(tenu)) setFeuille("agrandie");
    else setBare(false);
    setMenu(false);
  };
  /** Lancer un jeu, une fois la sauvegarde décidée quand il y en a une. Le
   * menu et le rayonnage de l'écran éteint passent par ici. */
  const lancerJeu = (game: Game, slot: Slot | null) => {
    // La GameCube passe par la préparation elle aussi depuis le 12
    // septembre 2026 : seul le salon certifie QUI lance. Un disque de
    // console inconnue garde l'ancien chemin.
    if (preparable(game.console)) {
      setPreparationError("");
      void tell
        .prepare({
          action: "begin",
          // La clé désigne ce jeu même si la liste a changé ; la
          // position reste pour un salon d'avant (ADR D23).
          game: game.index,
          key: game.key,
          save: slot ?? 0,
          // Seul à jouer, sur un jeu à un seul appareil, le salon
          // lance tout de suite (audit P6).
          direct: true,
        })
        .then(() => setMenu(false))
        .catch((error: unknown) =>
          setPreparationError(error instanceof Error ? error.message : SANS_REPONSE),
        );
      return;
    }
    // La sauvegarde et la manette AVANT le jeu : le worker retient, et
    // c'est le changement de jeu qui agit.
    if (slot !== null) session?.input.chooseSave(slot);
    session?.input.choosePad(storedPad());
    // Par sa clé quand la salle la publie, sinon par sa position.
    const sent = game.key
      ? session?.input.chooseGameByKey(game.key)
      : session?.input.chooseGame(game.index);
    if (!sent || !session) return;
    // La vidéo doit savoir qu'un redémarrage arrive, et les autres
    // l'apprennent par le salon : le worker part avec ses sockets.
    session.video.expectRestart();
    setRanWith(slot);
    tell.booting(game.index, slot ?? 0);
    setBooting({
      game: game.name,
      index: game.index,
      annonce: {
        save: slot === null ? "" : slotLabel(slot),
        saveSlot: slot ?? undefined,
        starter: session.input.attribution() ?? undefined,
      },
      at: performance.now(),
    });
    setMenu(false);
  };
  /** La fiche d'un jeu, la même dans le menu et sur l'écran éteint (B4 à
   * B8) : la sauvegarde, ce que « Lancer » arrête ou ce qui le suit, et,
   * pour qui ne choisit pas, la phrase de qui choisit à la place du bouton. */
  /** Ce que la rubrique Jeux et la fiche d'un jeu lisent de la salle
   * (`components/menu/RubriqueJeux`, chantier menus). */
  const entreeJeux: EntreeJeux = {
    enCours: room?.game ?? null,
    port,
    tenues,
    login,
    unlockedSaves,
    checkingIdentity,
    mine,
    chef: boss?.name ?? null,
    whyNotChoose,
    lancerJeu,
  };
  const ficheDe = (game: Game): FicheDeLigne => ficheDuJeu(game, entreeJeux);
  /* Les rubriques du menu unique (chantier menus, 24 novembre 2026).
   *
   * Construites ici plutôt que dans le composant : ce que le menu MONTRE
   * dépend de qui est là, de qui décide et de ce que la salle joue. Le menu
   * dessine une ligne selon sa forme (`lib/menu`, `formeDe`) : un choix court
   * en pastilles, une valeur continue en curseur, une décision en fiche. */
  const rubriques: Rubrique[] = [
    {
      id: "jeux",
      label: MENU.rubriques.jeux,
      // Le choix de la sauvegarde vit SUR le jeu, et se fait au lancement,
      // dans la fiche du jeu : un réglage posé loin de ce qu'il décide est un
      // réglage qu'on oublie d'avoir mis.
      lignes: lignesJeux({ ...entreeJeux, shelves, appareil, armed, setArmed }),
    },
    {
      id: "manettes",
      label: MENU.rubriques.manettes,
      // Une rubrique à elle : régler sa manette demandait dix gestes quand
      // elle était la dixième entrée des réglages (audit P12). Construite
      // hors d'ici, et essayée pour chaque console (`lib/rubriques`, M8).
      lignes: lignesManettes({
        aConfigurer: shot ? manetteAConfigurer(shot.input) : false,
        profilClavier: shot?.input.keyProfile ?? "défaut",
        console: room?.game?.console,
        moteur: moteurDe(room?.game?.console),
        pad,
        touchPref,
        padOnly,
        ouvrirTouches: ouvrirLesTouches,
        switchPad,
        setTouchPref,
        onPadOnly,
      }),
    },
    {
      id: "salle",
      label: MENU.rubriques.salle,
      // « [Nour] choisit le jeu. », avec l'étiquette de Nour (M10) : la
      // colonne le disait, et le menu prend sa place au bureau.
      tete: (() => {
        const dit = qui(
          boss && !salleFermee
            ? { nom: boss.name, place: boss.seat ?? null, moi: boss.moi === true }
            : null,
        );
        if (dit === null) return undefined;
        return (
          <p id="menuQuiChoisit">
            {dit.nom !== null ? (
              <>
                <Etiquette nom={dit.nom} place={dit.place} />{" "}
              </>
            ) : null}
            {dit.texte}
          </p>
        );
      })(),
      // Construite hors d'ici, avec ses essais (`lib/rubriques`, M10).
      lignes: lignesSalle({
        chef: boss ? { nom: boss.name, place: boss.seat ?? null, moi: boss.moi === true } : null,
        reprise: repriseDuRole(role, login !== null),
        jeu: room?.game ? { index: room.game.index } : null,
        peutFermer: canClose,
        fermeture,
        tenues,
        sousUnSalon: sortie !== null,
        nomSalle,
        tenu,
        aideSalle: aideDeLaSalle(appareil),
        regarde: watchingNow,
        // Au bureau, le menu prend la place des rangs de la colonne, et
        // Signaler avec eux : il revient ici, en ligne (K25). Tenue en
        // main, la feuille de la salle le porte ; un chargement qui offre
        // ses gestes le porte aussi : jamais deux à l'écran.
        signaler:
          tenu || chargementParle ? null : (
            <Signaler
              id="signalerMenu"
              variante="fiche"
              // Plus bas dans ce composant : appelés au clic, jamais ici.
              onComplain={() => complain()}
              garde={garde.current}
              annoncer={(phrase, nature) => annoncer(phrase, nature)}
            />
          ),
        reprendre: () => {
          setMenu(false);
          onRecover(null);
        },
        // L'iris sur le menu, puis « Fermeture du jeu en cours… » ; la page
        // de qui ferme la salle part après l'extinction (`components/menu/
        // gestes`, K13).
        fermerJeu: (index) =>
          void fermerLeJeu({
            fermer: () => tell.closeGame(index),
            enCours: () => setFermeture(index),
            surface: () => document.getElementById("menu"),
            refus: setPreparationError,
          }),
        fermerSalle: () =>
          void fermerLaSalle({
            fermer: () => closeSalle({ path: { numero: salle() }, throwOnError: true }),
            partir: () => location.assign("/"),
            surface: () => document.getElementById("root") ?? document.body,
            refus: setPreparationError,
          }),
        ouvrirSalle: () => {
          setMenu(false);
          setFeuille("agrandie");
        },
        basculerPlace: () => {
          if (watchingNow) session?.input.play();
          else session?.input.watchOnly();
          setMenu(false);
        },
        // La même sortie que la colonne : la transition sortir-salle du
        // socle, puis le départ (`quitterLaSalle`).
        quitter: () => quitterLaSalle(),
      }),
    },
    {
      id: "reglages",
      label: MENU.rubriques.reglages,
      // Deux groupes, « Image et son » puis « Cet appareil », et les
      // réglages pointus repliés derrière « réglages avancés » (M7a,
      // `lib/settings`).
      lignes: lignesReglages({
        shot,
        session,
        half,
        setHalf,
        sizes,
        prixImage,
        fit,
        setFit,
        picture,
        space,
        volume,
        setVolume,
        theme,
        setTheme,
        effets,
        deviceRate,
        setDeviceRate,
        lipsync,
        setLipsync,
        bare,
        setBare,
        column,
        setColumn,
        rememberColumn,
        fullscreen,
        toggleFullscreen,
        avances,
        setAvances,
        liaison,
        port,
        appareil,
        tenu,
        voirDetail,
        pleinEcranApi: plein === "api",
      }),
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
  const roleDuCadre: RoleDuCadre = padOnly ? "seule" : port === null ? "regarde" : "joueur";
  /** La manette tactile : sa PLACE est réservée qu'elle soit montée ou non
   * (sous la feuille, pendant un chargement), pour que l'image ne bouge pas
   * quand elle se démonte. À la souris aussi, réglée sur « toujours » : le
   * cadre lui donne sa place hors de l'image (relecture du 23 novembre 2026). */
  const manetteDuCadre = couchesVoulues.manette
    ? usesProInput(room?.game?.console)
      ? DESSINS_MANETTES.pro
      : DESSINS_MANETTES.dolphin
    : null;
  const geo = useGeometrie({
    mode: modeSalle,
    fenetre,
    zonesSures,
    image: picture,
    ajustement: fit,
    // Le format que la console annonce, connu avant la première image : le
    // panneau du bureau s'y décide, et l'image qui arrive ne le déplace pas
    // (`baseDuPanneau`, colonne-stable d'etats.mjs).
    formatAttendu: room?.game ? (formatAttendu(room.game.console) ?? PROPORTIONS_PAR_DEFAUT) : null,
    etat: etatDuCadre({
      liaison: liaison.etat,
      chargement: booting !== null,
      jeu: Boolean(room?.game),
    }),
    role: roleDuCadre,
    manette: manetteDuCadre,
    largeurColonne: column,
    // Le panneau des touches demande plus que la colonne : deux dessins côte
    // à côte, puis une table à trois colonnes (`lib/column`, K24).
    largeurPanneau:
      reglage !== null && modeSalle === "bureau" ? largeurPanneau(fenetre.width, column) : null,
    agrandie: bare && !tenu,
    // Tenu en main, le panneau des touches a sa place à côté de l'image
    // (`reglageTenu`), et non plus dans la feuille qui la couvrait.
    reglage: reglage !== null,
  });
  /* Le panneau de commande sous l'image, au bureau, quand l'image n'y perd
     rien (`panneauAuBureau`) ; sinon au pied de la colonne. Tenue en main,
     le cadre le pose lui-même (`panneauTenu`, plus bas). */
  const panneauSous =
    geo.mode === "bureau" && geo.panneau.forme === "sous" ? geo.panneau.rect : null;
  /** La carte ouverte d'une place, qui se ferme et s'oublie quand sa place
   * n'a plus de sujet (`useCarteDePlace`). */
  const {
    carte,
    sujet,
    basculer,
    fermer: fermerLaCarte,
  } = useCarteDePlace((n) =>
    sujetDeLaCarte(n, {
      mienne: port,
      noms: names,
      tenues: occupied,
      comment:
        appareil === "clavier" ? CARTE.auClavier : onTouch ? CARTE.auDoigt : CARTE.aLaManette,
    }),
  );
  /** Les places qui s'allument et s'éteignent, suivies sous le cadre
   * (`SuiviPlaces`, qui lit l'arbitre des scènes). */
  const [suivi, setSuivi] = useState<SuiviVu>(SANS_SUIVI);
  /** La dernière nouvelle des places, de l'invitation ou du signalement,
   * pour la seule ligne parlée de la salle. */
  const [nouvelle, setNouvelle] = useState<{
    texte: string;
    cle: number;
    nature: Nature;
  } | null>(null);
  const annoncer = useCallback<Annoncer>(
    (texte, nature) => setNouvelle((avant) => ({ texte, nature, cle: (avant?.cle ?? 0) + 1 })),
    [],
  );
  // L'issue d'une reprise, pour qui demande comme pour qui tient la place.
  useDireLaReprise(recovery, recoveryError, annoncer);
  /** « Donner » s'annule pendant 4 s ; la réponse part ensuite au bon chemin. */
  const repondre = useRef<(ok: boolean) => void>(() => {});
  const don = useDonDiffere((ok) => repondre.current(ok));
  /* Les places START 1P à 4P (chantier personnes). La rangée est posée par
     le cadre : sous l'image, au pied de la colonne, debout ou en petit. */
  const entreeDesPlaces = {
    places: shot?.input.players ?? 4,
    tenues: occupied,
    noms: names,
    micros: shot?.input.mics ?? [],
    chef: boss?.seat,
    mienne: port,
  };
  /* Une salle fermée garde ses places et sa soirée d'avant la fermeture
     (chantier etats, `useAvantLaFermeture`). */
  const placesDAvant = useAvantLaFermeture(salleFermee, entreeDesPlaces);
  const ceSoir = useAvantLaFermeture(salleFermee, {
    jeu: room?.game?.name ?? null,
    regardaient: regardentDe(people),
  });
  const formeDuPanneau = formeDesPlaces(
    geo.panneau.forme === "absent" ? "petit" : geo.panneau.forme,
  );
  const places = (
    <>
      {salleFermee ? (
        <PlacesAuPasse forme={formeDuPanneau} entree={placesDAvant} />
      ) : (
        <Places
          forme={formeDuPanneau}
          entree={entreeDesPlaces}
          vient={suivi.vient}
          part={suivi.part}
          carte={carte}
          onPrendre={(choisie) => {
            fermerLaCarte();
            session?.input.take(choisie);
          }}
          onCarte={basculer}
          // En petit et trop étroite, la rangée devient un bouton : il ouvre la
          // salle, où les places ont leur taille.
          onToutes={() => {
            if ("feuille" in ouvrirLaSalle(tenu)) setFeuille("agrandie");
            else setBare(false);
          }}
        />
      )}
      {shot?.input.displaced ? (
        <p id="displaced" className="text-note text-alert">
          {PLACES.deplace}
        </p>
      ) : null}
    </>
  );
  /* La carte d'une place, la reprise en cours et la demande reçue : dans la
     colonne au bureau, dans la bande au téléphone, au-dessus du menu quand
     il est ouvert ; jamais sur l'image. */
  /** La reprise qui vise MA place, en attente de réponse. */
  const repriseRecue =
    recovery !== null && !recovery.asking && recovery.reason === null && recovery.port !== null
      ? recovery
      : null;
  /** La demande reçue : la reprise du salon, ou l'ancienne demande (`asked`). */
  const demandeRecue: DemandeEnCours | null = repriseRecue
    ? {
        from: repriseRecue.from,
        port: repriseRecue.port ?? 0,
        lasts: repriseRecue.remaining,
        chemin: "reprise",
      }
    : asked
      ? { from: asked.from, port: asked.port, lasts: room?.ask_lasts ?? 10, chemin: "ancienne" }
      : null;
  repondre.current = (ok) => {
    if (repriseRecue) onRecoveryAction({ action: "answer", id: repriseRecue.id, ok });
    else onAnswer(ok);
  };
  const cartes = (
    <>
      <CartePlace
        sujet={sujet}
        notice={recovery !== null && repriseRecue === null ? recovery : null}
        erreur={recoveryError}
        occupe={recoveryBusy}
        libre={premiereLibre}
        pad={(handler) => session?.input.setMenu(handler)}
        onDemander={(choisie) => {
          fermerLaCarte();
          onRecover(choisie);
        }}
        onPrendre={(choisie) => {
          fermerLaCarte();
          onRecoveryClose();
          session?.input.take(choisie);
        }}
        onAction={onRecoveryAction}
        onFermer={() => {
          fermerLaCarte();
          onRecoveryClose();
        }}
        onRendre={
          salleFermee
            ? undefined
            : () => {
                fermerLaCarte();
                session?.input.watchOnly();
              }
        }
      />
      <DemandeRecue
        demande={demandeRecue}
        donne={don.donne}
        pad={(handler) => session?.input.setMenu(handler)}
        onGarder={don.garder}
        onDonner={don.donner}
        onAnnulerDon={don.annuler}
        onExpire={repriseRecue ? undefined : onExpire}
      />
    </>
  );
  /** Les rangs de la colonne, selon l'état, le rôle et l'appareil. Un
   * chargement qui offre ses gestes porte Signaler : la colonne cache alors
   * le sien, jamais deux à l'écran (K25, C7a). */
  const rangs = rangsDeLaColonne({
    etat: geo.etat,
    role: roleDuCadre,
    appareil,
    // La fiche de l'état porte Signaler pendant une panne (K25), et le
    // chargement qui offre ses gestes le porte aussi (C7a) : la colonne cache
    // alors le sien.
    fiche: signaleDansLaFiche(modele) || chargementParle,
    // À l'arrivée dans une partie en cours, ses rangs sont là avant la
    // première image : elle ne fait pas grandir la colonne (colonne-stable).
    partie: Boolean(room?.game),
  });
  /** La vue des touches montrée : celle qu'un rang a ouverte, ou celle du
   * clavier à la première visite. Seulement tant que son rang existe : une
   * manette branchée en cours de route retire la vue du clavier. */
  const vueVoulue =
    vueTouches ??
    (premiereVisite && !vueFermee && appareil === "clavier" && lignesClavier.length > 0
      ? "clavier"
      : null);
  const vueMontree =
    vueVoulue !== null && rangs.includes(vueVoulue === "clavier" ? "touches" : "manette")
      ? vueVoulue
      : null;
  const consoleDuJeu = room?.game?.console ?? "gc";
  /** Les lignes de « Ta manette », lues dans les tables du produit
   * (`lib/verification`). La manette est relue au navigateur pour compter ses
   * boutons quand sa disposition est inconnue. */
  const lignesDeLaManette = () => {
    const id = shot?.input.padId;
    if (!shot || !id || !session) return [];
    const branchee = [...(navigator.getGamepads?.() ?? [])].find((une) => une?.id === id) ?? null;
    const manette: ManetteLue = {
      id,
      mapping: branchee?.mapping ?? (shot.input.padLayout === "standard" ? "standard" : ""),
      boutons: branchee?.buttons.length ?? 17,
      axes: branchee?.axes.length ?? 4,
    };
    return usesProInput(consoleDuJeu)
      ? verificationPro(manette, session.input.switch.profile, consoleDuJeu === "x360")
      : verificationDolphin(manette, shot.input.profile, { console: consoleDuJeu, pad });
  };
  /** Ce que la vue des touches relit toutes les 50 ms : l'activité de la
   * trame qui part, Dolphin ou Pro, sticks et gâchettes compris (K34,
   * `media/activite`). */
  const lireLEntree = (): Releve => {
    const etat = session?.input.state();
    if (!etat) return { activite: { suivies: new Set(), actives: new Set() }, sinceHeardMs: null };
    // La trame qui part, Dolphin ou Pro : sticks et gâchettes compris (K34).
    return { activite: etat.activite, sinceHeardMs: etat.sinceHeardMs };
  };
  /** La pastille de l'image agrandie : trois secondes après Ctrl, puis
   * trois secondes après chaque mouvement de la souris (colonne.11). */
  const [agrandieVue, setAgrandieVue] = useState(false);
  useEffect(() => {
    if (!bare || tenu) {
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
  }, [bare, tenu]);
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
  /** Le fronton a sa bande quand l'image laisse 40 px au-dessus d'elle. Il
   * cède la bande à la pile des avis le temps d'un avis : les deux ne s'y
   * superposent pas.
   *
   * Décidé sur la géométrie du cadre (`geo.fronton`), calculée depuis la
   * fenêtre et les réglages, et non sur l'image mesurée : l'en-tête de la
   * colonne perd sa ligne de jeu quand le fronton existe, et une décision
   * prise sur la mesure pouvait boucler (la ligne change la hauteur, la
   * mesure change la décision ; « Maximum update depth exceeded » vu une
   * fois dans salle-telephone, 23 novembre 2026). */
  const frontonPossible = !tenu && geo.fronton !== null && jeuEnCours !== null && !bare;
  const frontonVisible = frontonPossible && !(lieuAvis.lieu === "fronton" && hauteurPile > 0);
  /** « La salle » : la feuille à mi-hauteur quand la salle est tenue en main,
   * la colonne dépliée à la souris (la manette « toujours » d'un grand écran
   * le pose parmi ses touches). */
  // Pendant une demande, la feuille s'ouvre agrandie : la carte y est, dans
  // la colonne, quand la bande manque (en travers).
  const ouvrirLaFeuille = () =>
    tenu ? setFeuille(demandeRecue ? "agrandie" : "mi") : setBare(false);
  /** K13 : « Quitter la salle » part par la transition « sortir-salle »
   * (mosaïque, ou fondu en « sobre »), sur toute la page. `transition` cache
   * l'image AVANT de commencer : rien ne passe sur une image vivante. En
   * mouvement réduit, la page part d'un coup. Un second clic pendant la
   * transition ne repart pas. Le menu garde sa propre sortie (chantier
   * menus). */
  const quitte = useRef(false);
  const quitterLaSalle = () => {
    if (quitte.current) return;
    quitte.current = true;
    const surface = document.getElementById("root") ?? document.body;
    void transition(choisirTransition("sortir-salle"), surface, onLeave).finally(() => {
      quitte.current = false;
    });
  };
  /** « Lina · ta place » sur le bouton « La salle » pendant une demande : en
   * paysage, la bande manque, et la demande ne se voit que là. */
  const libelleSalle = demandeRecue ? DEMANDE.libelle(demandeRecue.from) : undefined;
  /** La manette à l'écran, dans la boîte du cadre ou par-dessus l'écran. */
  const manetteTactile = (cadreDeLaManette: BoiteDuCadre | undefined) =>
    session === null ? null : usesProInput(room?.game?.console) ? (
      <SwitchTouchPad
        source={session.input.switch}
        console={room?.game?.console}
        libelleSalle={libelleSalle}
        bar={bande}
        // Le son coupé se voit aussi sur la manette Pro : en salle Xbox
        // 360, rien ne le disait (audit M10).
        soundOff={soundOff}
        onFeuille={ouvrirLaFeuille}
        cadre={cadreDeLaManette}
      />
    ) : (
      <TouchPad
        /* La largeur des bandes noires de chaque côté de l'image, quand la
         * manette se pose par-dessus l'écran (à la souris). Tenue en main,
         * le cadre lui donne sa boîte et ses bandes. */
        bar={bande}
        touch={session.input.touch}
        libelleSalle={libelleSalle}
        soundOff={soundOff}
        onFeuille={ouvrirLaFeuille}
        cadre={cadreDeLaManette}
      />
    );
  /** Ton étiquette tapée (chantier personnes), ton numéro devant, là où le
   * cadre la pose quand la rangée du panneau ne porte pas ta place
   * (en-jeu-tactile.5, `geo.etiquette`) : dans le creux de la manette tenue
   * droite (`fente`, lib/faces), sous « La salle » en travers, ou en tête de
   * la bande quand le panneau n'a que ses lampes. Une chose, une fois : avec
   * la rangée, elle est sur ta place START, et nulle part ailleurs. */
  const maPlace = port === null ? null : (lesPlaces(entreeDesPlaces)[port - 1] ?? null);
  const tonEtiquette =
    tenu && !padOnly && maPlace !== null && geo.etiquette !== null ? (
      <>
        <span
          className="n3-etiquette-numero"
          aria-hidden="true"
          style={{ "--etiquette-encre": encreDuJoueur(maPlace.port) } as React.CSSProperties}
        >
          {pastilleDeLaPlace(maPlace.port)}
        </span>
        <Etiquette nom={maPlace.nom ?? name} place={maPlace.port} lettres={maPlace.lettres} />
      </>
    ) : null;
  /** La boîte de la manette : ses grappes en travers et sur les côtés à la
   * souris, rien tenue droite ou sous l'image ; « La salle » parmi ses
   * touches quand la barre manque, et toujours à la souris. La tête de la
   * mascotte y passe seulement tenue en main (`ouEstLaMascotte`). */
  const boiteDeLaManette: BoiteDuCadre | undefined = geo.manette
    ? {
        bandes: geo.manette.grappes
          ? { left: geo.manette.grappes.g.w, right: geo.manette.grappes.d.w }
          : { left: 0, right: 0 },
        gestes: geo.salleDansLaManette ? ["feuille"] : [],
        dansLesBandes: geo.manette.grappes !== null,
        tete: tenu && geo.salleDansLaManette,
        // En travers, la boîte couvre aussi le dessous de l'image : la fente
        // n'y a pas sa place, le cadre en donne une sous « La salle ».
        etiquette: geo.etiquette?.lieu === "fente" ? tonEtiquette : null,
      }
    : undefined;
  /** La pile des avis va dans la bande d'une salle tenue en main : jamais sur
   * l'image, et pas dans une colonne qu'on ne voit pas. */
  const avisDansLaBande = tenu && geo.bande !== null;
  /** Les cartes de place vont dans la bande d'un téléphone tenu droit,
   * sinon dans la colonne (au bureau, ou dans la feuille agrandie) : jamais
   * deux fois. En travers, la bande a une centaine de pixels de large et la
   * carte en sortait par le bas (salle-telephone, 844x390) : « La salle »
   * dit alors « Bo · ta place » et ouvre la feuille agrandie sur la carte. */
  const cartesDansLaBande =
    avisDansLaBande && couches.colonne !== "feuille" && modeSalle === "portrait";
  /** Le panneau de commande d'une salle tenue en main : où le cadre le pose
   * (sous l'image, debout dans la bande gauche), pas pour une manette seule.
   * La feuille agrandie le couvre : il passe alors dans sa colonne, pour que
   * les places ne soient jamais montées deux fois (leurs identifiants sont
   * lus par les pilotes et par les lecteurs d'écran). */
  const panneauTenu = tenu && !padOnly && couches.colonne !== "feuille" ? geo.panneau.rect : null;
  /** Le crédit de la borne : les places libres, compté comme les places. */
  const credit = <Credit libres={occupied.filter((tenue) => !tenue).length} fermee={salleFermee} />;
  /** Le bout droit du panneau de commande : « Toutes les touches », qui ouvre
   * le panneau des touches sur le clavier, puis le crédit et le temps de jeu. */
  const pastilleAgrandie =
    agrandieVue && bare && !tenu && (lieuAvis.lieu === "fronton" || lieuAvis.lieu === "pied");
  const takeHalf = () => {
    session?.video.setHalf(true);
    setHalf(true);
    rough.current.settled();
    setSuggestHalf(false);
    sending.current.quality("accepté");
  };
  /** Les gestes de la fiche et du plein cadre, avec les moyens de la salle
   * (chantier etats, `rappelsDeLEtat`). */
  const rappels = rappelsDeLEtat({
    session,
    quitter: quitterLaSalle,
    signaler: complain,
    garde: garde.current,
    reduire: takeHalf,
    cale: rough.current,
    qualite: (mot) => sending.current.quality(mot),
    sansProposition: () => setSuggestHalf(false),
    legere: setHalf,
    avisLegere: setReduced,
    refuserLegere: () => setDeclined(true),
  });
  const lieuFiche = lieuDeLaFiche(couches.colonne);
  const fiche = (
    <FicheEtat
      modele={modele}
      rappels={rappels}
      onPropositionVue={() => {
        if (proposalTold.current) return;
        proposalTold.current = true;
        sending.current.quality("proposé");
      }}
      // Un geste parti avec la fiche ne laisse pas le clavier sur le document.
      onFocusPerdu={() => zone.current?.focus({ preventScroll: true })}
    />
  );
  /** La pastille mène au geste de sa fiche (chantier etats). */
  const allerAuGeste = useAllerAuGeste({
    lieu: lieuFiche,
    feuilleOuverte: feuille !== null,
    menu,
    ouvrirFeuille: () => setFeuille("agrandie"),
  });
  /** Où se pose la pastille : dans la pile des avis, à part tenue en main,
   * ou nulle part plutôt que sur l'image (`lib/etat-place`). */
  const pastille = montageDeLaPastille(modele, geo, tenu);
  /** Le bout droit du panneau de commande : au bureau, la pastille d'état
   * quand le cadre l'y pose (`lib/etat-place`, « panneau »), puis « Toutes
   * les touches », le crédit et le temps de jeu. */
  const finDuPanneau = (
    <>
      {pastille.panneau ? <EtatPastille modele={modele} onAller={allerAuGeste} /> : null}
      {/* Pas tenue en main : le panneau y garde sa place aux quatre places, et
          « Touches et manettes » passe par la feuille. */}
      {session && !tenu ? <ToutesLesTouches onOuvrir={() => ouvrirLesTouches("clavier")} /> : null}
      {credit}
      <TempsDeJeu depuisS={lancement} />
    </>
  );
  /** La console et l'appareil que l'écran des touches règle: ceux du jeu
   * préparé pendant une préparation (`consoleDesTouches`). */
  const consoleTouches = consoleDesTouches(
    pendingSetup !== null,
    setupGame?.console,
    room?.game?.console,
  );
  const manetteTenue = pendingSetup ? setupChoice : pad;
  /** Le jeu dont le panneau des touches lit la fiche : celui qu'on prépare,
   * sinon celui de la salle. */
  const jeuDesTouches = setupGame ?? room?.game;
  const envoiDuReglage = { enAttente: () => enAttente(), reessayer };
  /** La trame que règle « Touches et manettes » : la trame Pro pour une
   * Switch ou une Xbox 360, la trame Dolphin sinon. Rien sans session. */
  const trameDuReglage: TrameDolphin | TramePro | null =
    !shot || !session
      ? null
      : configuringSwitch
        ? {
            genre: "pro",
            console:
              consoleName(jeuDesTouches?.console) ??
              (jeuDesTouches?.console === "x360" ? "Xbox 360" : "Switch"),
            xbox: jeuDesTouches?.console === "x360",
            manette:
              deviceLabel(4, jeuDesTouches?.console) ??
              (jeuDesTouches?.console === "x360" ? "manette Xbox 360" : "manette Pro"),
            source: session.input.switch,
            input: session.input,
            guide: jeuDesTouches?.guide,
            place: port as 1 | 2 | 3 | 4 | null,
            envoi: envoiDuReglage,
          }
        : {
            genre: "dolphin",
            console: consoleTouches,
            tenue: manetteTenue,
            actions: jeuDesTouches?.guide?.actions[String(manetteTenue)],
            state: shot.input,
            input: session.input,
            refresh: () => session.refresh(),
            /* Le bouton n'existe que pour celui qui tient la salle. Le service
               vérifie l'adresse de son côté: cacher un bouton n'est pas une
               règle, c'est du confort. */
            publier: publishes
              ? async (chosen) => {
                  const profile = session.input.keyProfileNamed(chosen);
                  if (!profile) return false;
                  const published = await publishProfile(chosen, profile);
                  if (published) {
                    session.input.refreshRoomKeys();
                    session.refresh();
                  }
                  return published;
                }
              : undefined,
            profils: (
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
            ),
            envoi: envoiDuReglage,
          };
  /** Ce que la salle dit d'elle quand elle ne vit pas, en tête du panneau. */
  const ditDuReglage = dire(liaison, salle(), contexteEtat);
  const bandeDuReglage: BandeDuReglage | null =
    geo.etat === "vit" || !ditDuReglage.titre ? null : { phrase: ditDuReglage.titre };
  /** Une partie tourne et une autre place que la mienne est tenue. */
  const autresJouent =
    Boolean(room?.game) && occupied.some((tenue, index) => tenue && index + 1 !== port);

  /* Les avis de la salle, en une pile, et JAMAIS sur l'image : en tête de
     la colonne quand elle est à côté, dans une bande noire où la pile tient
     entière, sinon dans le flux au-dessus de l'écran (`lieuDesAvis`). Jusqu'au
     23 novembre 2026, cette pile se posait en haut de l'image (`#avisDuHaut`),
     et l'avis du format réduit en bas. */
  const avis =
    pastille.pile || pastilleAgrandie || pauseClavier ? (
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
        {/* L'état de la salle en un voyant : la fermeture proche, une image
            figée, l'image légère. Il remplace l'avis de fermeture et celui
            de l'image légère, qui se posaient en haut et en bas de l'image
            jusqu'au 23 novembre 2026 (ADR D40). */}
        {pastille.pile ? <EtatPastille modele={modele} onAller={allerAuGeste} /> : null}
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

  /** Qui tient cette page : sa place, ou « Prendre la place N » pour qui
   * regarde. Dans la colonne, et dans la bande d'une salle tenue en main
   * pour qui regarde : la colonne n'y est montée que dans la feuille
   * agrandie, qui démonte la bande. Jamais deux fois. */
  const blocRole = salleFermee ? null : (
    <BlocRole
      nom={name}
      place={port}
      libre={premiereLibre}
      onPrendre={() => session?.input.play()}
    />
  );
  /** La préparation à plusieurs, en bloc non modal (P1) : en tête de la
   * colonne au bureau, et dans la feuille agrandie d'une salle tenue en
   * main, qu'une ligne de la bande ouvre (P8). Toutes les consoles. Le menu
   * ouvert dans la colonne la cache, comme le rôle, et la rend en se
   * fermant. */
  const blocPreparation =
    pendingSetup && session && shot ? (
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
        onEssayer={port === null ? undefined : () => ouvrirLesTouches("manette")}
        enCours={room?.game?.name ?? null}
        annoncer={(texte) => annoncer(texte, "ordinaire")}
      />
    ) : null;
  /** Le menu unique, jamais sur l'image (`placeDuMenu`, ADR D30 amendé) :
   * au bureau à la place des rangs de la colonne, tenu en main sous l'image
   * ou dans une bande à côté d'elle. Un refus né d'un geste du menu s'écrit
   * dans son bloc, pas dans un avis posé ailleurs. */
  const placeMenu = placeDuMenu(geo, fenetre, zonesSures);
  const menuEnColonne = menu && placeMenu.lieu === "colonne";
  const menuMonte = menu ? (
    <Menu
      rubriques={rubriques}
      partie={!idle}
      joue={port !== null}
      appareil={appareil}
      place={placeMenu}
      onClose={() => setMenu(false)}
      onPad={(handler) => session?.input.setMenu(handler)}
      avis={
        preparationError ? (
          <div className="n3-preparation-error" role="alert">
            {preparationError}
            {/* « Masquer » et non « Fermer » : l'avis le plus courant dit
                « Fermeture du jeu en cours… ». */}
            <button type="button" onClick={() => setPreparationError("")}>
              Masquer
            </button>
          </div>
        ) : null
      }
    />
  ) : null;
  /* La colonne repliée par Ctrl se déplie quand le menu s'y ouvre, et se
     replie à sa fermeture (focus.mjs, agrandir-ctrl). */
  useColonneDuMenu({ menu, bare, dansLaColonne: placeMenu.lieu === "colonne", setBare });
  /** Le panneau « Touches et manettes » ouvert : dans la colonne au bureau,
   * à sa place du cadre tenu en main (`Geometrie.reglage`). */
  const hoteReglage = (
    <HoteReglage
      trame={trameDuReglage}
      autres={autresJouent}
      vit={geo.etat === "vit"}
      hote={ouEstLaMascotte(geo, "fier")}
      bande={bandeDuReglage}
      // L'ouvreur a pu disparaître avec la vue qui l'a ouvert : le focus
      // revient à « Changer » de la vue remontée, sinon au rang des touches,
      // ou à celui de la manette. Tenu en main, la feuille qui portait la vue
      // s'est fermée : à « Vérifier les boutons », sinon à « La salle ».
      repli={() =>
        document.getElementById("changerTouches") ??
        document.getElementById("tesTouches") ??
        document.getElementById("taManette") ??
        document.getElementById("verifierManette") ??
        document.getElementById("laSalle") ??
        document.getElementById("laSalleCote") ??
        document.getElementById("openMenu")
      }
    />
  );
  /** La colonne de la salle, posée selon le mode (`couchesDeLaSalle`). */
  const colonne = (
    <Colonne
      nomSalle={nomSalle}
      // Le nom du jeu une seule fois : au fronton quand il a sa bande,
      // sinon dans l'en-tête de la colonne.
      jeu={frontonPossible ? null : (room?.game?.name ?? null)}
      ancre={!tenu && !frontonVisible}
      onQuitter={quitterLaSalle}
      // Le panneau des touches élargit la colonne : la largeur que le cadre
      // a donnée (`largeurPanneau`), l'image se range dans le reste.
      largeur={
        couches.colonne === "a-cote"
          ? reglage !== null && geo.colonne
            ? geo.colonne.w
            : column
          : null
      }
      forme={couches.colonne ?? "a-cote"}
      margeHaut={lieuAvis.lieu === "colonne" ? hauteurPile : undefined}
      // La carte d'une place et la demande reçue, en tête de la colonne et
      // collées en haut : dans la feuille d'un téléphone en travers, posées
      // plus bas, elles passaient sous le bord (salle-telephone, 844x390).
      avis={
        <>
          {lieuAvis.lieu === "colonne" ? avis : null}
          {cartesDansLaBande ? null : cartes}
        </>
      }
      // La fiche de l'état en tête de la colonne, au bureau comme dans la
      // feuille agrandie.
      etat={fiche}
      preparation={menuEnColonne ? null : blocPreparation}
      role={menuEnColonne ? null : blocRole}
      personnes={
        menuEnColonne ? null : (
          <>
            {/* Une salle fermée : ce soir dans la salle, gardé d'avant. */}
            {salleFermee ? (
              <CeSoir salle={salle()} jeu={ceSoir.jeu} regardaient={ceSoir.regardaient} />
            ) : null}
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
                  className="n3-rang"
                  onClick={() => onRecover(null)}
                >
                  {CARTE.choisir}
                </button>
              </div>
            ) : null}
            {salleFermee ? null : <IlsRegardent people={people} owner={boss} />}
            {salleFermee ? null : (
              <Inviter
                lien={(entree) => lienDInvitation(location.origin, base(), entree)}
                libre={premiereLibre}
                annoncer={annoncer}
              />
            )}
          </>
        )
      }
      panneau={
        panneauSous || panneauTenu || menuEnColonne ? null : (
          <PanneauCommande forme="colonne" fin={finDuPanneau}>
            {places}
          </PanneauCommande>
        )
      }
      rangs={rangs}
      contenus={{
        signaler: <Signaler onComplain={complain} garde={garde.current} annoncer={annoncer} />,
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
            <RangTouches onOuvrir={() => setVueTouches("clavier")} />
          ) : null,
        manette: shot?.input.padId ? (
          <RangManette
            nom={identify(shot.input.padId, shot.input.padLayout ?? "").name}
            aConfigurer={manetteAConfigurer(shot.input)}
            onOuvrir={() => setVueTouches("manette")}
          />
        ) : null,
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
                <span className="font-mono text-note">{Math.round(clip.state.bytes / 1e6)} Mo</span>
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
                Pense à sauvegarder dans le jeu: une salle que tout le monde quitte ferme la partie.
              </p>
            )}
          </AutresReglages>
        ),
      }}
      vue={
        menuEnColonne ? (
          menuMonte
        ) : reglage !== null && !tenu ? (
          hoteReglage
        ) : mode === "details" ? (
          <div id="stats">
            {shot ? (
              <Mesures
                video={shot.video}
                allerRetourMs={shot.input.roundTripMs}
                liaison={shot.liaison}
                salle={salle()}
                moteur={moteurDe(room?.game?.console)}
                onReduce={takeHalf}
                technique={
                  <MesuresTechniques>
                    <Instruments shot={shot} moteur={moteurDe(room?.game?.console)} />
                  </MesuresTechniques>
                }
              />
            ) : (
              <p className="text-corps text-faint">Pas encore de mesures.</p>
            )}
          </div>
        ) : vueMontree ? (
          <VueTouches
            key={vueMontree}
            titre={
              vueMontree === "clavier"
                ? TOUCHES.clavier
                : TOUCHES.manette(
                    identify(shot?.input.padId ?? "", shot?.input.padLayout ?? "").name,
                  )
            }
            lignes={vueMontree === "clavier" ? lignesClavier : lignesDeLaManette()}
            clavier={vueMontree === "clavier"}
            lire={lireLEntree}
            onRevenir={() => {
              setVueTouches(null);
              setVueFermee(true);
              retenirAideVue(true);
            }}
            onChanger={() => ouvrirLesTouches(vueMontree === "clavier" ? "clavier" : "manette")}
          />
        ) : null
      }
      coin={
        <Coin
          mesures={mode === "details"}
          onMesures={() => setMode(mode === "details" ? "normal" : "details")}
          // L'état de la liaison en clair (chantier personnes).
          // Elle se tait quand une fiche dit déjà l'état (`ligneCoin`).
          ligne={
            shot ? (modele.ligneCoin ?? ligneDeLaLiaison(liaison, shot.video).texte) : undefined
          }
        />
      }
    />
  );
  return (
    <Cadre
      geo={geo}
      className={cn("h-full", tenu ? "relative" : "flex", modeSalle === "etroit" && "flex-col")}
    >
      <main
        className={
          tenu
            ? "absolute inset-0"
            : modeSalle === "etroit"
              ? "relative flex shrink-0 flex-col"
              : "relative flex min-w-0 flex-1 flex-col"
        }
        // Étroite, l'écran prend la hauteur que le cadre lui donne, et la
        // colonne le reste, dessous (`lib/cadre`, au moins 240 px).
        style={
          modeSalle === "etroit" && geo.ecran
            ? { height: geo.ecran.h + (geo.margesManette?.bas ?? 0) }
            : undefined
        }
      >
        {/* L'écran, et ce qui se pose à sa place quand il n'a pas d'image. Le
            panneau de commande est son voisin du dessous, jamais dedans : un
            écran éteint posé sur `inset-0` le couvrait. */}
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          // Tenue en main, l'écran est où le cadre le pose. Une manette seule
          // n'en a pas : la toile reste montée (la boucle média la tient par
          // une référence), réduite à rien.
          // À la souris, la manette « toujours » prend ses marges autour de
          // l'écran : l'image se pose dans ce qui reste.
          style={
            tenu
              ? geo.ecran
                ? placeDe(geo.ecran)
                : SANS_ECRAN
              : geo.margesManette
                ? {
                    marginLeft: geo.margesManette.gauche,
                    marginRight: geo.margesManette.droite,
                    marginBottom: geo.margesManette.bas,
                  }
                : undefined
          }
        >
          {!avisDansLaBande && lieuAvis.lieu === "flux" ? avis : null}
          <Screen
            canvasRef={ref}
            zoneRef={zone}
            // Pas pendant un chargement: l'écran de chargement couvre l'image,
            // et Tab s'arrêterait sur une zone qu'on ne voit pas.
            jouable={enPartie}
            libelle={jeuEnCours ? ZONE.nom(jeuEnCours) : ZONE.sansJeu}
            aide={port !== null && appareil === "clavier" ? ZONE.aide : null}
            connected={shot?.video.connected ?? false}
            fit={fit}
            picture={shot?.video.picture ?? { width: 0, height: 0 }}
            onSpace={setSpace}
            onPrescale={(times) => session?.video.setPrescale(times)}
          />
          {!avisDansLaBande && lieuAvis.rect ? avis : null}
          {/* La borne autour de l'image (étape 7) : le fronton dans la bande
              du haut, s'il n'y a pas d'avis à y dire, et le décor dans les
              bandes latérales. Posés en absolu : l'image ne bouge pas. */}
          {frontonVisible && cadre && jeuEnCours ? (
            <Fronton
              jeu={jeuEnCours}
              bande={{ x: cadre.left, y: 0, w: cadre.width, h: cadre.top }}
            />
          ) : null}
          {geo.bordures && cadre ? (
            <CoteBorne gauche={cadre.left} largeur={space.width} hauteur={space.height} />
          ) : null}
          {/* Ce qu'on voit quand cet appareil ne sert que de manette.
            Un écran noir se lit comme une panne, et c'en est une pour qui a
            oublié avoir choisi ce mode. La toile reste montée derrière: elle
            appartient à la boucle média, qui la tient par une référence, et la
            démonter reviendrait à mettre React sur le chemin des images. */}

          {/* Le panneau des touches dit lui-même l'étape : la bande sous
              l'image ne le répète pas (une préparation mise de côté la garde). */}
          {learning && reglage === null ? (
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

          {/* Le plein cadre de la borne, quand il n'y a pas d'image du tout,
            et la neige d'une connexion coupée, à la place de l'image : les
            deux ne se montrent que sous leur jeton de couverture, levé par la
            première image peinte (ADR D40). La pastille et la fiche vivent
            hors de l'image. Rien pour une page-manette. */}
          {booting === null && !padOnly ? <PleinCadre modele={modele} rappels={rappels} /> : null}
          {modele.couverture === "neige" && cadre ? <Neige cadre={cadre} /> : null}

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
              habitude={habitudeDuChargement}
              sauvegarde={sauvegardeDuLancement(
                booting.annonce,
                session?.input.attribution(),
                room?.seats ?? [],
              )}
              stalled={booting.stalled ?? false}
              // Les gestes par rôle (C7a) : qui choisit le jeu arrête le
              // lancement, ou en choisit un autre ; tout le monde signale, et
              // la colonne cache alors son propre Signaler (K25).
              choisit={canClose}
              quiChoisit={boss?.name ?? null}
              onArreter={
                indexDemande === undefined
                  ? undefined
                  : () => {
                      void tell
                        .closeGame(indexDemande)
                        .then(() => setBooting(null))
                        .catch((error: unknown) =>
                          setPreparationError(
                            error instanceof Error ? error.message : SANS_REPONSE,
                          ),
                        );
                    }
              }
              onAutre={() => {
                setBooting(null);
                setMenu(true);
              }}
              signaler={
                chargementParle ? (
                  <Signaler
                    id="signalerChargement"
                    variante="bandeau"
                    court
                    onComplain={complain}
                    garde={garde.current}
                    annoncer={annoncer}
                  />
                ) : null
              }
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
              // Les jeux debout sur l'écran éteint (B1, chantier menus) : le
              // menu ne s'ouvre plus d'office, et une salle vide se choisit
              // ici, à la souris, au clavier ou à la manette.
              rayonnage={
                room && room.library.length > 0 ? (
                  <Rayonnage
                    library={room.library}
                    ficheDe={ficheDe}
                    dernier={room.dernier_jeu ?? null}
                    focusEntree={phraseDuRepos(role, whyNotChoose) === null}
                    cote={modeSalle === "bureau"}
                    onOuvrir={relireLaBibliotheque}
                    onPad={(handler) => session?.input.setMenu(handler)}
                  />
                ) : undefined
              }
            />
          ) : null}

          {/* Une manette branchée ou débranchée, dite cinq secondes au
              lecteur d'écran et jamais peinte : l'avis visible couvrait L
              au téléphone (audit N1, en-jeu-manette.2). */}
          {shot ? <ControllerStatus state={shot.input} /> : null}
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
                    attente: attenteDuChargement,
                    // « d'habitude » se dit seulement mesuré (C5, D05).
                    habitude: habitudeMesuree(habitudeDuChargement) !== null,
                    // Le nom du jeu, le seuil franchi et qui peut relancer
                    // (C9) : le compteur ne parle pas. `relance` a la forme
                    // des états (`Relance`), qui écrivent la phrase : cette
                    // page quand elle peut fermer le jeu, sinon le chef.
                    jeu: booting.game,
                    seuilS: seuilLong(habitudeDuChargement),
                    relance: canClose ? "moi" : boss ? { nom: boss.name } : null,
                  }
                : liaison
            }
            salle={salle()}
            demande={demandeRecue}
            delai={demandeRecue?.chemin === "reprise" ? REPRISE_REPONSE_S : (room?.ask_lasts ?? 10)}
            peintes={shot?.video.painted ?? 0}
            fermeDans={closingIn}
            nouvelle={nouvelle}
          />
          {/* La même nouvelle, écrite lettre par lettre sur l'ancre de
              l'annonce du socle (effet « lettres »). */}
          <AnnonceEnLettres nouvelle={nouvelle} />
          {/* Les scènes d'Aïn par état, par l'arbitre du cadre (K10) : sur le
              plateau du plein cadre, sinon là où la salle la pose. */}
          <ScenesDesEtats
            moment={{
              liaison: booting === null && !padOnly ? liaison : { etat: "ok" },
              fermeDans: closingIn,
            }}
            hote={(scene) => (modele.niveau === "plein" ? "plateau" : ouEstLaMascotte(geo, scene))}
          />
          {/* Les arrivées et les départs, suivis sous le cadre pour son
              arbitre des scènes. */}
          <SuiviPlaces
            // Ni la salle du salon ni l'instantané de la page : la salle
            // n'est pas encore connue, et rien ne s'y compare.
            occupation={
              room !== undefined && shot !== null
                ? { tenues: occupied, noms: names, premieres }
                : null
            }
            mienne={port}
            // Sans qui arrive encore (`seat_pending`) : il ne regarde pas.
            regardent={regardentDe(people)}
            salle={String(salle())}
            stable={booting === null && liaison.etat === "ok"}
            hote={(scene) =>
              hoteDesPlaces(ouEstLaMascotte(geo, scene), {
                tenu,
                panneauSous: panneauSous !== null,
              })
            }
            annoncer={annoncer}
            onVu={setSuivi}
          />
        </div>
        {/* À la souris, la manette « toujours » dans les marges que le cadre
            a prises autour de l'écran, jamais sur l'image : à côté d'elle ou
            dessous (`manetteALaSouris`). Jusqu'au 23 novembre 2026, elle se
            posait par-dessus l'écran. Montée seulement quand elle sert : cent
            boutons au-dessus d'une partie jouée au clavier intercepteraient
            des clics. Les coordonnées sont celles de `<main>`, posé en haut à
            gauche de la fenêtre au bureau comme en fenêtre étroite. */}
        {!tenu && geo.manette && couches.pave ? (
          <div className="n3-manette-boite" style={placeDe(geo.manette.rect)}>
            {manetteTactile(boiteDeLaManette)}
          </div>
        ) : null}
        {panneauSous ? (
          <PanneauCommande forme="sous" hauteur={panneauSous.h} fin={finDuPanneau}>
            {places}
          </PanneauCommande>
        ) : null}
        {/* Tenue en main, chaque pièce est où le cadre la pose, dans la zone
            sûre (`lib/cadre`) : la barre, le panneau, la bande, la manette,
            et « La salle » hors de la barre quand elle manque. */}
        {tenu && geo.barre ? (
          <BarreSalle
            rect={geo.barre}
            nomSalle={nomSalle}
            jeu={padOnly ? null : jeuEnCours}
            sonCoupe={soundOff}
            onSalle={() => setFeuille("mi")}
            pastille={
              pastille.barre ? <EtatPastille modele={modele} onAller={allerAuGeste} /> : null
            }
          />
        ) : null}
        {tenu && !geo.barre && geo.boutonSalle ? (
          <BoutonSalle
            id="laSalleCote"
            sonCoupe={soundOff}
            libelle={libelleSalle}
            onSalle={() => setFeuille(demandeRecue ? "agrandie" : "mi")}
            style={placeDe(geo.boutonSalle)}
            tete
          />
        ) : null}
        {tonEtiquette && geo.etiquette?.lieu === "cote" ? (
          <div
            id="etiquetteManette"
            className="n3-etiquette-cote"
            style={placeDe(geo.etiquette.rect)}
          >
            {tonEtiquette}
          </div>
        ) : null}
        {panneauTenu ? (
          <div style={placeDe(panneauTenu)} className="n3-panneau-tenu">
            <PanneauCommande
              forme={geo.panneau.forme === "absent" ? "petit" : geo.panneau.forme}
              hauteur={panneauTenu.h}
              fin={finDuPanneau}
            >
              {places}
            </PanneauCommande>
          </div>
        ) : null}
        {padOnly && geo.panneau.rect ? (
          <ManetteSeule
            rect={geo.panneau.rect}
            jeu={jeuEnCours}
            place={port}
            allerRetourMs={shot?.input.roundTripMs ?? null}
            entenduIlYaMs={shot?.input.sinceHeardMs ?? null}
          />
        ) : null}
        {avisDansLaBande && geo.bande && couches.colonne !== "feuille" ? (
          <Bande rect={geo.bande} ancre={!geo.barre}>
            {tonEtiquette && geo.etiquette?.lieu === "bande" ? (
              <div id="etiquetteManette" className="n3-etiquette-bande">
                {tonEtiquette}
              </div>
            ) : null}
            {avis}
            {cartesDansLaBande && !menu ? cartes : null}
            {regardeParChoix ? blocRole : null}
            {pendingSetup && !menu ? (
              <PreparationEnBref
                pending={pendingSetup}
                game={setupGame}
                moi={session?.input.attribution() ?? null}
                onOuvrir={() => setFeuille("agrandie")}
              />
            ) : null}
            {shot?.input.padId && port !== null && !padOnly ? (
              <ManetteDansLaBande
                nom={identify(shot.input.padId, shot.input.padLayout ?? "").name}
                place={port}
                aConfigurer={manetteAConfigurer(shot.input)}
                tactile={onTouch}
                conseil={modeSalle === "portrait" && !onTouch}
                onVerifier={() => {
                  setVueTouches("manette");
                  setFeuille("agrandie");
                }}
                onTactile={basculerTactile}
              />
            ) : null}
          </Bande>
        ) : null}
        {tenu && geo.reglage && reglage !== null ? (
          <div className="n3-reglage-tenu" style={placeDe(geo.reglage)}>
            {hoteReglage}
          </div>
        ) : null}
        {pastille.aPart ? (
          <div className="n3-pastille-place" style={placeDe(pastille.aPart)}>
            <EtatPastille modele={modele} onAller={allerAuGeste} />
          </div>
        ) : null}
        {tenu && geo.manette && couches.pave ? (
          <div className="n3-manette-boite" style={placeDe(geo.manette.rect)}>
            {manetteTactile(boiteDeLaManette)}
          </div>
        ) : null}
        {feuille ? (
          <FeuilleSalle
            hauteur={feuille}
            rect={feuille === "mi" ? (geo.feuille?.mi ?? TOUTE) : (geo.feuille?.agrandie ?? TOUTE)}
            titre={nomSalle}
            entrees={entreesDeLaFeuille({
              sonCoupe: soundOff,
              manette: onTouch ? "montree" : "cachee",
              plein,
              pleinActif: fullscreen,
              // Le clip, pendant une partie seulement : rien à garder sans image.
              clip: room?.game && !padOnly ? clip.state : null,
              travers: modeSalle === "paysage",
            })}
            onEntree={(id) => {
              switch (id) {
                case "toute-la-salle":
                  setFeuille("agrandie");
                  return;
                case "son":
                  setFeuille(null);
                  // Démarrer PUIS biper, dans cet ordre et dans le même geste :
                  // le bip ne sort de rien tant que le contexte n'a pas repris.
                  void session?.sound.start().then(() => session.sound.beep());
                  return;
                case "menu":
                  setFeuille(null);
                  setMenu(true);
                  return;
                case "clip":
                  // La feuille reste ouverte : l'entrée dit où en est le clip.
                  takeClip();
                  return;
                case "manette":
                  setFeuille(null);
                  basculerTactile();
                  return;
                case "plein-ecran":
                  setFeuille(null);
                  toggleFullscreen();
                  return;
              }
            }}
            onFermer={() => setFeuille(null)}
          >
            {couches.colonne === "feuille" ? colonne : null}
          </FeuilleSalle>
        ) : null}
      </main>

      {bare || modeSalle !== "bureau" ? null : (
        <ColumnHandle width={column} onWidth={setColumn} onSettle={rememberColumn} />
      )}
      {/* À côté de l'image au bureau, repliée par Ctrl ; sous l'image d'une
          fenêtre étroite à la souris ; dans la feuille agrandie d'une salle
          tenue en main (`couchesDeLaSalle`). La même colonne, entière. */}
      {couches.colonne === "a-cote" || couches.colonne === "dessous" ? colonne : null}

      {/* SANS `&& shot`: le menu ne dépend pas de l'image. Tenu en main, il
          se pose hors de la colonne, sous l'image ou à côté d'elle. */}
      {menu && !menuEnColonne ? menuMonte : null}

      {/* Un refus né d'un geste du menu : la scène « refus » et le son
          d'erreur, dans le cadre qui tient l'arbitre. */}
      <SceneRefus refus={preparationError} />
      {/* Menu ouvert, l'erreur s'écrit dans son bloc (`avis` du menu). */}
      {preparationError && !menu ? (
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
    </Cadre>
  );
}
