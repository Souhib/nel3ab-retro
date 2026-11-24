/**
 * La rubrique Réglages du menu (chantier menus, M7a).
 *
 * Elle vivait dans `App.tsx` jusqu'à la relecture du 24 novembre 2026 : la
 * partition ne donne à chaque chantier qu'un commit de câblage dans ce
 * fichier, et sa logique dans des fichiers à lui. Le texte est celui qui
 * tournait, déplacé tel quel ; ce qu'il lisait de la salle arrive par
 * `EntreeReglages`.
 *
 * Deux groupes, « Image et son » puis « Cet appareil », et les réglages
 * pointus repliés derrière « réglages avancés » (`lib/settings`).
 */
import type { Appareil } from "../../lib/appareil";
import { COLUMN, widest } from "../../lib/column";
import { changerNiveau, changerSons, estNiveau, instantane, NIVEAUX } from "../../lib/effets";
import { FITS, place, qualities, type Fit } from "../../lib/fit";
import type { Ligne } from "../../lib/menu";
import { EFFETS_RETRO, IMAGE } from "../../lib/mots";
import { entreeConnexion } from "../../lib/rayons";
import { arrange, avecAvances, selonAppareil } from "../../lib/settings";
import { THEMES, type Theme } from "../../lib/theme";
import type { Liaison } from "../../media/liaison";
import type { Session, Snapshot } from "../../media/session";

type Taille = { width: number; height: number };

/** Ce que la rubrique lit et change de la salle. */
export type EntreeReglages = {
  shot: Snapshot | null;
  session: Session | null;
  half: boolean;
  setHalf: (oui: boolean) => void;
  /** Les deux qualités, dites d'après l'image reçue (`qualities`). */
  sizes: ReturnType<typeof qualities>;
  /** Le prix de l'image légère, là où il a été mesuré. */
  prixImage: string;
  fit: Fit;
  setFit: (fit: Fit) => void;
  picture: Taille;
  space: Taille;
  volume: number;
  setVolume: (volume: number) => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  effets: ReturnType<typeof instantane>;
  deviceRate: boolean;
  setDeviceRate: (oui: boolean) => void;
  lipsync: boolean;
  setLipsync: (oui: boolean) => void;
  bare: boolean;
  setBare: (oui: boolean) => void;
  column: number;
  setColumn: (largeur: number) => void;
  rememberColumn: (largeur: number) => void;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  avances: boolean;
  setAvances: (oui: boolean) => void;
  liaison: Liaison;
  port: number | null;
  appareil: Appareil;
  /** La salle est tenue en main : la colonne est une feuille. */
  tenu: boolean;
  voirDetail: () => void;
  /** Le plein écran passe par l'API du navigateur (`lib/plein-ecran`). */
  pleinEcranApi: boolean;
};

/** Les lignes de la rubrique Réglages. */
export function lignesReglages(e: EntreeReglages): Ligne[] {
  const {
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
  } = e;
  return avecAvances(
    arrange<Ligne>(
      selonAppareil<Ligne>(
        [
          {
            id: "sound",
            label: "son",
            value: shot?.sound.state === "running" ? "activé" : "éteint",
            hint: "un navigateur ne fait pas de bruit avant qu'on le lui demande",
            onEnter: () => void session?.sound.start(),
          },
          {
            id: "half",
            // Ce qu'on choisit est la qualité qu'on REÇOIT.
            label: IMAGE.reglage,
            value: shot?.video.half ? "légère" : "complète",
            // Un seul prix, et seulement là où il a été mesuré
            // (`prixImageLegere`, audit T11).
            hint: half
              ? `${sizes.half || IMAGE.legere}, ${prixImage}.`
              : `${sizes.full || IMAGE.complete}. Légère si l'image saccade.`,
            picks: [
              { id: "full", label: IMAGE.complete, hint: sizes.full || "toute l'image" },
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
            // La taille que le choix en cours donne : deux choix qui
            // rendent la même image se voient comme tels. L'image reste
            // visible à côté du menu, et se règle sous les yeux.
            hint: (() => {
              const would = place(fit, picture, space);
              return would.width > 0
                ? `${Math.round(would.width)}×${Math.round(would.height)} · ne change pas ce que tu reçois`
                : "Ne change pas ce que tu reçois.";
            })(),
            picks: FITS.map((choice) => ({
              id: choice.id,
              label: choice.label,
              hint: choice.note,
            })),
            picked: fit,
            onPick: (id) => {
              const found = FITS.find((choice) => choice.id === id);
              if (found) setFit(found.id);
            },
          },
          {
            id: "volume",
            label: "volume",
            // À zéro, le son n'est plus envoyé du tout
            // (`SoundStream.setMuted`) : le dire.
            hint: volume <= 0 ? "le son n'est plus envoyé" : "le son de cet appareil",
            slide: {
              value: Math.round(volume * 100),
              min: 0,
              max: 100,
              step: 5,
              say: (at) => (at <= 0 ? "sourdine" : `${at} %`),
              onSet: (at) => setVolume(at / 100),
            },
          },
          {
            id: "theme",
            label: "couleurs",
            hint: "les couleurs de la salle, sur cet appareil",
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
            // Le réglage des effets rétro du socle (ADR D37), monté ici
            // sous « Cet appareil » : ses mots sont ceux du salon.
            id: "effets",
            label: EFFETS_RETRO.reglage,
            hint: EFFETS_RETRO.niveaux[effets.niveau].note,
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
            // (`retro/sons.ts`) : ce réglage ne fait que les permettre.
            id: "sonsMenu",
            label: EFFETS_RETRO.sons,
            value: effets.sons ? "oui" : "non",
            hint: EFFETS_RETRO.sonsNote,
            bascule: effets.sons,
            onEnter: () => changerSons(!effets.sons),
          },
          {
            id: "deviceRate",
            label: "son sans conversion",
            value: deviceRate ? "oui" : "non",
            hint: "Peut réduire un grésillement. Peut ajouter un peu de retard.",
            bascule: deviceRate,
            onEnter: () => setDeviceRate(!deviceRate),
          },
          {
            id: "lipsync",
            label: "image calée sur le son",
            value: lipsync ? `+${Math.round(shot?.soundSyncMs ?? 0)} ms` : "non",
            hint: lipsync
              ? "ajoute aussi du retard aux commandes"
              : "retarde l'image pour suivre le son, sur cet écran",
            bascule: lipsync,
            onEnter: () => setLipsync(!lipsync),
          },
          {
            id: "bare",
            label: "colonne de droite",
            value: bare ? "repliée" : "visible",
            hint: "rend toute la largeur à l'image (Ctrl)",
            onEnter: () => setBare(!bare),
          },
          {
            id: "columnWidth",
            label: "largeur de la colonne",
            hint: `ou tirer son bord gauche · double-clic : ${COLUMN.normal} px`,
            // La glissière, parce que la poignée n'a pas de clavier : voir
            // `ColumnHandle`. Relue à chaque rendu : une fenêtre étroite
            // ne permet pas la même largeur qu'un grand écran.
            slide: {
              value: column,
              min: COLUMN.min,
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
            hint: "toute la fenêtre pour la salle",
            bascule: fullscreen,
            onEnter: toggleFullscreen,
          },
          {
            id: "advanced",
            label: "réglages avancés",
            value: avances ? "affichés" : "3 de plus",
            hint: "son sans conversion, image calée sur le son, mesures techniques",
            deplie: avances,
            onEnter: () => setAvances(!avances),
          },
          entreeConnexion({
            liaison,
            images: shot?.video.painted ?? 0,
            hz: shot?.video.refreshHz ?? 0,
            port,
            appareil,
            compact: tenu,
            fiche: tenu,
            voirDetail,
          }),
        ],
        { tiroir: tenu, pleinEcran: e.pleinEcranApi },
      ),
    ),
    avances,
  );
}
