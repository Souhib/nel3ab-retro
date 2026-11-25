/**
 * La planche d'Aïn : ses dessins, et chaque scène jouable à la main.
 *
 * Sert à regarder, à capturer et à prouver, jamais livrée dans la page de la
 * salle (`planche.html`, servie par `just planche` sans aucun relais vers
 * une salle vivante). Trois décors, chacun avec TOUTES les ancres que les
 * scènes demandent, ce que le vrai cadre n'a pas encore (les START de
 * personnes, la prise d'etats, les marques du sol) :
 *
 * - la salle : une image vivante, le panneau de commande et ses quatre
 *   START, la pastille et sa prise, la colonne et le logo au pied ;
 * - le plateau : l'écran noir sans image, où Aïn joue en grand, et le logo
 *   qui garde sa place en pointillés ;
 * - le salon : la bibliothèque et ses deux étagères, le dépôt, la liste des
 *   salles, la règle du carnet ; hors de tout `[data-cadre]`, donc les
 *   variantes du salon.
 *
 * Les coordonnées reprennent le décor « S » de la proposition validée
 * (`da/ain/_src/5-scenes.js`, 640 × 400). Les noms sont inventés.
 *
 * `planche.test.tsx` garde la planche : chaque ancre et chaque sol qu'une
 * scène demande y existe. `planche-ain.mjs` (`just planche-garde`) y joue
 * chaque scène dans Chrome et vérifie qu'elle prend sa version complète.
 *
 * `?sans=start-2,prise` retire des ancres : le jumeau rouge des pilotes.
 */
import { StrictMode, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { changerNiveau, niveau, type Niveau } from "../lib/effets";
import { jouer, poserMascotte, RENDU, type Scene, type Version } from "../mascotte";
import {
  ACCESSOIRES,
  BULLES,
  dessinerAin,
  dessinerLogo,
  dessinerTete,
  grilleBulle,
  lirePalette,
  peindre,
  type Grille,
  type Joueur,
} from "../mascotte/dessin";
import type { Contexte } from "../mascotte/moteur";
import { SCENES_AIN, type DefScene, type IdAin } from "../mascotte/scenes-ain";
import { LIEUX, type Lieu } from "./lieux";

/** Les ancres que l'adresse retire (`?sans=a,b`). */
const SANS = new Set(
  (new URLSearchParams(globalThis.location?.search ?? "").get("sans") ?? "")
    .split(",")
    .filter(Boolean),
);

const px = (v: number) => `${v}px`;
const boite = (x: number, y: number, w: number, h: number): CSSProperties => ({
  position: "absolute",
  left: px(x),
  top: px(y),
  width: px(w),
  height: px(h),
});
const SCENE: CSSProperties = {
  position: "relative",
  width: px(640),
  height: px(400),
  background: "var(--fond)",
  border: "2px solid var(--filet)",
  overflow: "hidden",
};
const FACE: CSSProperties = { background: "var(--panneau, var(--creux))" };
const MOT: CSSProperties = { margin: 0, fontSize: 10, color: "var(--encre)", whiteSpace: "nowrap" };

/** Une ancre : absente si l'adresse la retire. */
function A({ nom, style, children }: { nom: string; style: CSSProperties; children?: ReactNode }) {
  if (SANS.has(nom)) return null;
  return (
    <i data-ancre={nom} style={{ ...style, display: "block" }}>
      {children}
    </i>
  );
}
/** Un sol : le bord haut d'un élément de deux pixels. */
const Sol = ({ nom, x, y, w }: { nom: string; x: number; y: number; w: number }) =>
  SANS.has(nom) ? null : <i data-sol={nom} style={{ ...boite(x, y, w, 2), display: "block" }} />;
/** Une marque posée sur un sol : où Aïn va. */
const Marque = ({ nom, x, y }: { nom: string; x: number; y: number }) => (
  <A nom={nom} style={boite(x - 1, y, 2, 1)} />
);

/** Le logo d'une scène, au pied de la colonne : la maison d'Aïn. */
function Maison({
  x,
  y,
  w,
  h,
  hote,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  hote: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) poserMascotte(ref.current);
  }, []);
  return <div ref={ref} data-hote={hote} style={boite(x, y, w, h)} />;
}

/** Une toile peinte une fois : une grille d'Aïn, à `k` pixels par pixel. */
function Toile({ g, k = 3, titre }: { g: Grille; k?: number; titre: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) peindre(ref.current, g, k * (globalThis.devicePixelRatio || 1), lirePalette());
  }, [g, k]);
  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas
        ref={ref}
        style={{ width: g[0].length * k, height: g.length * k, imageRendering: "pixelated" }}
      />
      <figcaption style={{ ...MOT, color: "var(--legende)" }}>{titre}</figcaption>
    </figure>
  );
}

const CTX: Contexte = { joueur: "2", mode: "tous" };

/** Les dessins : le logo, la tête, la pose clé de chaque scène, les
 * accessoires et les bulles. */
function Dessins() {
  const cles = (Object.entries(SCENES_AIN) as [IdAin, DefScene][]).flatMap(([id, def]) => {
    const c = def.cle?.(CTX);
    return c ? [{ id, g: dessinerAin(c.pose, "2") }] : [];
  });
  return (
    <section id="dessins" className="mb-8 flex flex-col gap-4">
      <h2 className="text-base">Aïn</h2>
      <div className="flex flex-wrap items-end gap-6">
        <Toile g={dessinerLogo(true)} k={2} titre="le logo, Aïn chez lui" />
        <Toile g={dessinerLogo(false)} k={2} titre="le logo, Aïn dehors" />
        <Toile g={dessinerTete({}, "1")} titre="la tête seule" />
        {(["1", "2", "3", "4"] as Joueur[]).map((j) => (
          <Toile key={j} g={dessinerAin({ oeil: "heureux" }, j)} titre={`${j}P`} />
        ))}
      </div>
      <h3 className="text-note">Les poses clés (mouvement réduit, niveau Sobre)</h3>
      <div className="flex flex-wrap items-end gap-4">
        {cles.map(({ id, g }) => (
          <Toile key={id} g={g} k={2} titre={id} />
        ))}
      </div>
      <h3 className="text-note">Les accessoires et les bulles</h3>
      <div className="flex flex-wrap items-end gap-4">
        {Object.entries(ACCESSOIRES).map(([nom, g]) => (
          <Toile key={nom} g={g} k={2} titre={nom} />
        ))}
        {(Object.keys(BULLES) as (keyof typeof BULLES)[]).map((t) => (
          <Toile key={t} g={grilleBulle({ t })} k={2} titre={`bulle ${t}`} />
        ))}
        <Toile g={grilleBulle({ t: "tag", j: "3" })} k={2} titre="bulle 3P" />
      </div>
    </section>
  );
}

/** Le décor de la salle : image vivante, panneau, colonne. */
function Salle() {
  const starts = [128, 174, 220, 266];
  return (
    <div id="planche-salle" data-cadre="" data-sans-image="non" data-etat="vit" style={SCENE}>
      <div style={{ ...boite(0, 0, 436, 40), background: "#000" }}>
        <span
          data-texte=""
          style={{ ...MOT, ...boite(14, 12, 220, 14), color: "var(--mire-jaune)" }}
        >
          Kart des Ruelles
        </span>
      </div>
      <div data-zone-jeu="" style={boite(16, 44, 404, 227)}>
        <canvas
          id="screen"
          width={404}
          height={227}
          style={{ width: "100%", height: "100%", background: "var(--marine-700)" }}
        />
      </div>
      <div style={{ ...FACE, ...boite(0, 278, 436, 122) }} />
      <Sol nom="panneau" x={0} y={372} w={440} />
      {starts.map((cx, i) => (
        <div key={cx}>
          {SANS.has(`start-${i + 1}`) ? null : (
            <button
              type="button"
              tabIndex={-1}
              data-ancre={`start-${i + 1}`}
              style={{
                ...boite(cx - 15, 346, 30, 26),
                fontSize: 9,
                background: `var(--joueur-${i + 1})`,
              }}
            >
              {i + 1}P
            </button>
          )}
          <span
            data-texte=""
            style={{ ...MOT, ...boite(cx - 23, 380, 46, 12), textAlign: "center" }}
          >
            {["Lina", "Sami", "libre", "libre"][i]}
          </span>
        </div>
      ))}
      <div style={{ ...boite(316, 378, 118, 22), border: "2px solid var(--filet)" }}>
        <span data-texte="" style={{ ...MOT, ...boite(4, 4, 80, 12) }}>
          L'image est là
        </span>
      </div>
      <A nom="prise" style={boite(420, 385, 9, 9)} />
      <div style={{ ...FACE, ...boite(440, 0, 200, 400) }} />
      <div
        style={{
          ...boite(440, 0, 200, 34),
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 8px",
        }}
      >
        <span data-texte="" style={MOT}>
          SALLE 1
        </span>
        <button type="button" tabIndex={-1} style={{ ...MOT, marginLeft: "auto" }}>
          Quitter
        </button>
      </div>
      <p data-interdit="ligne" style={{ ...MOT, ...boite(448, 250, 184, 16) }}>
        2 joueurs · 12 min de jeu
      </p>
      {/* Le logo à 1,5 px par pixel d'Aïn (200 px de large) : ses pieds
          sur la ligne 372, celle du panneau et des marques. */}
      <Maison hote="coin" x={440} y={285} w={200} h={96} />
      <Marque nom="toque" x={398} y={372} />
      <Marque nom="siege" x={372} y={372} />
      <Marque nom="fiche-sol" x={386} y={372} />
      <Marque nom="branche" x={440} y={372} />
      <Marque nom="rattrape" x={404} y={372} />
      <Marque nom="public" x={300} y={372} />
    </div>
  );
}

/** L'écran noir : pas d'image peinte, le plateau dessous, le logo à côté. */
function Plateau() {
  return (
    <div id="planche-plateau" data-cadre="" data-sans-image="oui" data-etat="repos" style={SCENE}>
      <div data-zone-jeu="" style={{ ...boite(16, 44, 404, 227), background: "#000" }}>
        <span data-texte="" style={{ ...MOT, ...boite(120, 40, 160, 14), color: "#fff" }}>
          La salle est au repos
        </span>
      </div>
      <Maison hote="plateau" x={16} y={120} w={404} h={150} />
      <div style={{ ...FACE, ...boite(440, 0, 200, 400) }} />
      <Maison hote="coin" x={440} y={285} w={200} h={96} />
    </div>
  );
}

/** Le salon : rail, bibliothèque, liste des salles, pupitre. Comme dans
 * la proposition, les mots à ne pas couvrir sont ceux du dépôt ; les
 * titres sont du décor. Hors de tout cadre, toute la page est son décor :
 * la marge du haut tient ses sauts loin des commandes de la section d'avant. */
function Salon() {
  return (
    <div id="planche-salon" style={{ ...SCENE, marginTop: 96 }}>
      <div style={{ ...FACE, ...boite(0, 0, 640, 48) }} />
      {/* Le logo à 1,5 px par pixel d'Aïn, sans place au-dessus : hors du
          coin, le logo est en haut de son hôte, et le rendu pose son sol à
          6 pixels d'Aïn du bas. */}
      <Maison hote="logo" x={14} y={1} w={171} h={46.5} />
      <div style={{ ...boite(14, 58, 200, 268), border: "2px solid var(--filet)" }}>
        <span style={{ ...MOT, ...boite(10, 6, 120, 12) }}>BIBLIOTHÈQUE</span>
        <Sol nom="etagere-haut" x={6} y={80} w={184} />
        <Sol nom="etagere-bas" x={6} y={152} w={184} />
        <A nom="place-libre" style={boite(108, 80, 2, 2)} />
        {SANS.has("depot") ? null : (
          <div
            data-ancre="depot"
            style={{ ...boite(8, 180, 180, 78), border: "2px dashed var(--filet)" }}
          >
            <span
              data-texte=""
              data-ancre={SANS.has("depot-mot") ? undefined : "depot-mot"}
              style={{ ...MOT, ...boite(30, 58, 120, 12), textAlign: "center" }}
            >
              Dépose un jeu ici
            </span>
          </div>
        )}
      </div>
      <A nom="salles" style={{ ...boite(228, 58, 398, 268), border: "2px solid var(--filet)" }}>
        <span style={{ ...MOT, ...boite(150, 120, 100, 14) }}>HORS ANTENNE</span>
      </A>
      <A nom="regle-carnet" style={boite(30, 88, 580, 2)} />
      <div style={{ ...FACE, ...boite(0, 340, 640, 60) }}>
        <button type="button" tabIndex={-1} style={{ ...MOT, ...boite(14, 14, 140, 30) }}>
          Ouvrir une salle
        </button>
        {/* Le lien du carnet descend du rail au pupitre : « range » bondit
            du logo au bout de la règle du carnet, par-dessus le rail. */}
        <button type="button" tabIndex={-1} style={{ ...MOT, ...boite(540, 14, 80, 30) }}>
          carnet
        </button>
      </div>
    </div>
  );
}

const hoteDe = (lieu: Lieu) =>
  document.querySelector<HTMLElement>(
    `#planche-${lieu} [data-hote="${lieu === "plateau" ? "plateau" : lieu === "salon" ? "logo" : "coin"}"]`,
  );

/** Joue une scène dans un décor ; rend la version jouée et les replis. */
function jouerIci(lieu: Lieu, scene: Scene, version: Version | "cle", contexte: Contexte = CTX) {
  const hote = hoteDe(lieu);
  if (!hote) return { version: "sans-hote", refus: "" };
  const el = poserMascotte(hote);
  if (!el) return { version: "refusee", refus: "" };
  if (version === "cle") {
    RENDU.poseCle(el, scene, contexte);
    return { version: "cle", refus: "" };
  }
  jouer(scene, { hote, version, contexte });
  // La version que le planificateur a vraiment prise, et ses replis.
  const maison = hote.querySelector<HTMLElement>(".rt-mascotte");
  return { version: maison?.dataset.version ?? "?", refus: maison?.dataset.refus ?? "" };
}

/** Pour `planche-ain.mjs` : jouer une scène et lire ce qui a été choisi. */
(globalThis as Record<string, unknown>).planche = { jouer: jouerIci, lieux: LIEUX };

function Commandes({ lieu }: { lieu: Lieu }) {
  const [dit, setDit] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {LIEUX[lieu].map((scene) => (
          <span key={scene} className="flex gap-px">
            {(["complete", "courte", "cle"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className="border border-rule px-1 text-note"
                onClick={() => {
                  const r = jouerIci(lieu, scene, v);
                  setDit(`${scene} : ${r.version}${r.refus ? ` (${r.refus})` : ""}`);
                }}
              >
                {v === "complete" ? scene : v === "courte" ? "c" : "clé"}
              </button>
            ))}
          </span>
        ))}
      </div>
      <p className="text-note text-muted" aria-live="polite">
        {dit || "Choisir une scène : son nom pour la complète, « c » pour la courte."}
      </p>
    </div>
  );
}

function Planche() {
  const [n, setN] = useState<Niveau>(niveau());
  return (
    <main className="min-h-screen bg-ink p-6 text-text">
      <h1 className="mb-1 text-lg">Aïn</h1>
      <p className="mb-4 text-note text-muted">
        Le 3 du logo, vivant. Chaque scène dans un décor qui porte toutes ses ancres.
      </p>
      <fieldset className="mb-6 flex gap-3 text-note">
        <legend>Niveau des effets</legend>
        {(["sobre", "conseille", "tout"] as Niveau[]).map((v) => (
          <label key={v} className="flex gap-1">
            <input
              type="radio"
              name="niveau"
              checked={n === v}
              onChange={() => {
                changerNiveau(v);
                setN(v);
              }}
            />
            {v}
          </label>
        ))}
      </fieldset>
      <Dessins />
      {(
        [
          ["salle", "La salle, image vivante", <Salle key="s" />],
          ["plateau", "Le plateau, écran noir", <Plateau key="p" />],
          ["salon", "Le salon", <Salon key="n" />],
        ] as const
      ).map(([lieu, titre, decor]) => (
        <section key={lieu} id={`section-${lieu}`} className="mb-8 flex flex-col gap-3">
          <h2 className="text-base">{titre}</h2>
          {decor}
          <Commandes lieu={lieu} />
        </section>
      ))}
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Planche />
    </StrictMode>,
  );
