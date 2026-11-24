/**
 * La rubrique Jeux du menu et la fiche d'un jeu (chantier menus).
 *
 * Elles vivaient dans `App.tsx` jusqu'à la relecture du 24 novembre 2026 :
 * la partition ne donne à chaque chantier qu'un commit de câblage dans ce
 * fichier, et sa logique dans des fichiers à lui. Le texte est celui qui
 * tournait, déplacé tel quel ; ce qu'il lisait de la salle arrive par
 * `EntreeJeux`.
 *
 * La fiche sert au menu (lignes `game*`) et au rayonnage de l'écran éteint
 * (B4 à B8) : la sauvegarde, ce que « Lancer » arrête ou ce qui le suit, et,
 * pour qui ne choisit pas, la phrase de qui choisit à la place du bouton.
 */
import type { Game } from "../../client";
import { pour, type Appareil } from "../../lib/appareil";
import { consequence, suiteDuLancement } from "../../lib/bibliotheque";
import { launchable, preparable } from "../../lib/consoles";
import type { FicheDeLigne, Ligne } from "../../lib/menu";
import { BIBLIO, FICHE } from "../../lib/mots";
import { launchPicks, slotFromPick, type Slot } from "../../lib/saves";
import { GameCard } from "../GameCard";

/** Ce que la rubrique et la fiche lisent de la salle. */
export type EntreeJeux = {
  /** Le jeu qui tourne, ou `null`. */
  enCours: Game | null;
  /** La place de cette page, `null` pour qui regarde. */
  port: number | null;
  /** Les places tenues dans la salle. */
  tenues: number;
  /** Une identité connue : la sauvegarde personnelle se propose. */
  login: string | null;
  /** Les sauvegardes débloquées de chaque jeu, `null` tant que /saves n'a
   * pas répondu pour la lecture en cours. */
  unlockedSaves: readonly boolean[] | null;
  checkingIdentity: boolean;
  /** Cette page choisit le jeu. */
  mine: boolean;
  /** Le nom de qui choisit, s'il y en a un. */
  chef: string | null;
  /** Pourquoi cette page ne choisit pas, en une phrase. */
  whyNotChoose: string | null;
  lancerJeu: (game: Game, slot: Slot | null) => void;
};

/** La fiche d'un jeu, la même dans le menu et sur l'écran éteint. */
export function ficheDuJeu(game: Game, e: EntreeJeux): FicheDeLigne {
  const { port, tenues, login, unlockedSaves, checkingIdentity, mine, whyNotChoose, lancerJeu } = e;
  const room = { game: e.enCours };
  const boss = e.chef === null ? null : { name: e.chef };
  // Le choix de sauvegarde n'existe que pour un disque dont on sait la
  // console (ADR D22) : proposer un choix qui ne décide peut-être rien est
  // pire que ne pas le proposer.
  const saves = preparable(game.console);
  const enCours = room?.game ?? null;
  const assis = port !== null;
  const arrete = consequence({ enCours, choisi: game, tenues, assis });
  const suite = suiteDuLancement({
    console: game.console,
    allowed: game.guide?.allowed,
    tenues,
    assis,
  });
  return {
    consequence: arrete ?? suite,
    suite: arrete === null ? undefined : suite,
    agir: enCours?.index === game.index ? BIBLIO.relancer : FICHE.lancer,
    annuler: FICHE.revenir,
    choix: saves ? launchPicks(login !== null, unlockedSaves?.[game.index] === true) : undefined,
    contenu: <GameCard game={game} />,
    refus: !mine
      ? port !== null
        ? BIBLIO.choisit(boss?.name ?? "Quelqu'un")
        : (whyNotChoose ?? undefined)
      : launchable(game.console)
        ? undefined
        : BIBLIO.pasJouable,
    // Tant que /saves n'a pas répondu ou que l'identité se vérifie, les
    // choix ne sont pas sûrs : rien ne part (B6a).
    occupe: saves && (unlockedSaves === null || checkingIdentity),
    // Un identifiant qu'on ne reconnaît pas ne lance RIEN, plutôt que de
    // retomber sur « partie neuve » : c'est ce repli silencieux qui a fait
    // démarrer tous les jeux Wii sur la mauvaise sauvegarde.
    onAgir: (id) => {
      if (!saves) return lancerJeu(game, null);
      if (unlockedSaves === null || id === null) return;
      const slot = slotFromPick(id, unlockedSaves[game.index] === true);
      if (slot !== null) lancerJeu(game, slot);
    },
  };
}

/** Une rangée de la rubrique : les jeux d'une console. */
export type Etagere = { label: string; games: Game[] };

/** La rubrique Jeux, et ce qu'elle lit de plus que la fiche. */
export type EntreeRubriqueJeux = EntreeJeux & {
  shelves: readonly Etagere[];
  appareil: Appareil;
  /** Le jeu armé d'une première pression (un jeu sans sauvegarde). */
  armed: number | null;
  setArmed: (index: number | null) => void;
};

/** Les lignes de la rubrique Jeux : un jeu par ligne, rangés par console. */
export function lignesJeux(e: EntreeRubriqueJeux): Ligne[] {
  const {
    shelves,
    appareil,
    armed,
    setArmed,
    mine,
    whyNotChoose,
    unlockedSaves,
    checkingIdentity,
    lancerJeu,
  } = e;
  const room = { game: e.enCours };
  const plusieursConsoles = shelves.length > 1;
  return shelves.flatMap((shelf) =>
    shelf.games.map<Ligne>((game) => {
      // Le choix de sauvegarde n'existe que pour un disque dont on sait
      // la console (ADR D22) : proposer un choix qui ne décide peut-être
      // rien est pire que ne pas le proposer.
      const saves = preparable(game.console);
      const running = game.index === room?.game?.index;
      /** Lancer, une fois la sauvegarde décidée quand il y en a une. */
      return {
        id: `game${game.index}`,
        label: game.name,
        group: plusieursConsoles ? shelf.label : undefined,
        value: running ? "en cours" : armed === game.index ? "confirmer ?" : undefined,
        hint: running
          ? saves
            ? pour(appareil, "le relancer sur une autre sauvegarde")
            : "c'est ce qui tourne"
          : !mine
            ? (whyNotChoose ?? undefined)
            : saves
              ? pour(appareil, "choisir la sauvegarde, puis lancer")
              : armed === game.index
                ? "encore une fois pour lancer, ailleurs pour annuler"
                : `${pour(appareil, "lancer, deux fois")} : console inconnue.`,
        // Le jeu QUI TOURNE reste choisissable : le relancer change de
        // sauvegarde ou de manette. Grisé pour qui ne décide pas du jeu,
        // et pour une console décrite mais pas encore jouable.
        disabled:
          !mine ||
          !launchable(game.console) ||
          (saves && (unlockedSaves === null || checkingIdentity)),
        // Sans sauvegarde à choisir, l'armement à deux pressions : ce
        // qu'on confirme reste la fin de la partie de tout le monde.
        onEnter: saves
          ? undefined
          : () => {
              if (armed !== game.index) return setArmed(game.index);
              setArmed(null);
              lancerJeu(game, null);
            },
        // La décision s'ouvre dans la fiche du jeu, la même qu'au repos.
        fiche: saves ? ficheDuJeu(game, e) : undefined,
      };
    }),
  );
}
