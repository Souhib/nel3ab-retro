/**
 * La planche des manettes : toutes les manettes, dessinées par le VRAI composant.
 *
 * Jusqu'au 21 novembre 2026, cet aperçu redessinait le SVG à la main, et il
 * avait fini par ne plus ressembler à ce que voit un joueur. Il monte
 * `PadMapView` tel quel : ce que `padmap-qc.mjs` mesure ici est ce que la
 * salle affiche.
 *
 * Depuis le 23 novembre 2026 (chantier manettes, écran « cartes-padmap ») :
 * deux groupes, ce que le jeu reçoit et ta manette ; chaque manette avec
 * l'endroit où elle sert, à trois tailles (grande, 170 px, 120 px) ; sous
 * chaque taille, combien d'inscriptions se lisent et combien sont masquées
 * par le plancher de 9 px ; sous la grande, l'appui le plus faible, calculé
 * dans le thème affiché. Les réglages sont des boutons de 44 px à
 * `aria-pressed`, et ils posent les mêmes attributs que la boucle
 * d'affichage (`paintWiring`) : `data-lit`, la translation d'un stick.
 *
 * Les mesures sont écrites dans la page (`data-lisibles`, `data-masquees`,
 * `data-contraste`, `data-verdict`) pour que le pilote les compare à ce qu'il
 * mesure lui-même. L'événement `planche:mesurer` les refait.
 */
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./src/index.css";
import { PadMapView } from "./src/components/PadMap";
import { EMULATED, type PadMap, PHYSICAL, SWITCH_PRO, XBOX_360 } from "./src/lib/padmap";
import { appliquerInscriptions } from "./src/manettes/reglage/inscriptions";

/** Où sert chaque manette. Les groupes viennent des listes du réglage
 * (`EMULATED`, `PHYSICAL`) : un plan qui en sort sort aussi de la planche, et
 * le pilote le voit au compte. */
const OU: Record<string, string> = {
  gamecube: "salles GameCube et Wii : la manette que Dolphin présente",
  wiimote: "salles Wii, jeux à Wiimote et Nunchuk",
  guitar: "salles Wii, jeux de guitare",
  "wiimote-only": "salles Wii, jeux à Wiimote seule",
  "switch-pro": "salle Switch : la manette Pro que la console reçoit",
  xbox360: "salle Xbox 360, dessinée comme la Xbox actuelle : la 360 n'est pas encore relevée",
  standard: "toute manette que le navigateur ne reconnaît pas",
  dualshock: "une manette PlayStation reconnue par le navigateur",
  xbox: "une manette Xbox reconnue par le navigateur",
  "switch-pro-pad": "une manette Nintendo reconnue par le navigateur",
};

const GROUPES: { id: string; titre: string; plans: readonly PadMap[] }[] = [
  { id: "jeu", titre: "Ce que le jeu reçoit", plans: [...EMULATED, SWITCH_PRO, XBOX_360] },
  { id: "tenue", titre: "Ta manette", plans: PHYSICAL },
];

const TAILLES = [
  { id: "grande", largeur: 480, nom: "grande" },
  { id: "170", largeur: 170, nom: "170 px" },
  { id: "120", largeur: 120, nom: "120 px" },
] as const;

/** La pose fixe des sticks : une fois, sans boucle. */
const PENTE: Record<string, [number, number]> = {
  x: [0.75, -0.55],
  cx: [-0.2, 0.4],
  a0: [0.65, -0.5],
  a2: [-0.3, 0.6],
};

/** La touche que « Encadrer une touche » choisit sur un plan. */
const encadree = (map: PadMap) =>
  (map.parts.find((one) => one.key === "A" || one.key === "b0") ?? map.parts[0])?.key ?? null;

type Place = 1 | 2 | 3 | 4 | null;
type Theme = "nuit" | "jour";

function rgb(valeur: string): [number, number, number] | null {
  const v = valeur.trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((at) => Number.parseInt(hex[1]!.slice(at, at + 2), 16)) as never;
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** Le contraste de deux couleurs, ou `NaN` si l'une ne se lit pas : un NaN
 * n'est jamais « tient ». */
function contraste(a: string, b: string): number {
  const [x, y] = [rgb(a), rgb(b)];
  if (!x || !y) return Number.NaN;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** L'appui le plus faible d'un dessin, sans place et sur ses quatre places,
 * calculé comme `lib/manettes-couleurs.test.ts` le fait sur la feuille : le
 * meilleur de l'aplat et de l'anneau contre la touche (teinte comprise), puis
 * contre ce qui l'entoure (son logement ou la coque ; la base de la croix
 * pour une pièce affleurante ; la page pour une gâchette derrière la coque).
 * Une pièce affleurante n'a pas d'anneau, sauf `data-appui` ; une gâchette
 * derrière la coque a l'anneau à l'encre du thème, sauf si elle en déclare un.
 * Ici les couleurs sont celles que Chrome calcule dans le thème affiché. */
function pireAppui(svg: SVGSVGElement): { valeur: number; ou: string } {
  const avant = svg.getAttribute("data-place");
  let pire = { valeur: Number.POSITIVE_INFINITY, ou: "" };
  const garder = (valeur: number, ou: string) => {
    if (Number.isNaN(valeur) || valeur < pire.valeur) pire = { valeur, ou };
  };
  const page = getComputedStyle(document.body).backgroundColor;
  try {
    for (const place of ["aucune", "1", "2", "3", "4"]) {
      if (place === "aucune") svg.removeAttribute("data-place");
      else svg.setAttribute("data-place", place);
      const dessin = getComputedStyle(svg);
      const lu = (nom: string) => dessin.getPropertyValue(nom);
      for (const piece of svg.querySelectorAll<SVGGElement>("[data-part]")) {
        const sa = getComputedStyle(piece);
        const d = piece.dataset;
        const aplat = sa.getPropertyValue("--pad-lit");
        const dessous = sa.getPropertyValue("--pad-lit-ring-dessous").trim();
        const anneau =
          d.flush && !d.appui
            ? null
            : d.under
              ? dessous || lu("--encre")
              : sa.getPropertyValue("--pad-lit-ring");
        const tranche = (fond: string) =>
          Math.max(contraste(aplat, fond), anneau ? contraste(anneau, fond) : 0);
        garder(tranche(sa.getPropertyValue("--part-tint")), `place ${place}, ${d.part} touche`);
        const autour = d.under
          ? tranche(page)
          : d.flush
            ? tranche(lu("--pad-cap"))
            : Math.max(d.hangs ? 0 : tranche(lu("--pad-well")), tranche(lu("--pad-shell")));
        garder(autour, `place ${place}, ${d.part} autour`);
      }
    }
  } finally {
    if (avant === null) svg.removeAttribute("data-place");
    else svg.setAttribute("data-place", avant);
  }
  return pire;
}

/** Refait les comptes d'inscriptions et les contrastes, et les écrit. */
function mesurer() {
  let echecs = 0;
  for (const bloc of document.querySelectorAll<HTMLElement>("[data-format]")) {
    const svg = bloc.querySelector<SVGSVGElement>("svg[data-padmap]");
    const sortie = bloc.querySelector<HTMLElement>("[data-compte]");
    if (!svg || !sortie) continue;
    const largeur = svg.viewBox.baseVal.width;
    appliquerInscriptions(svg, svg.getBoundingClientRect().width / largeur);
    const textes = [...svg.querySelectorAll("text[data-taille]")];
    const masquees = textes.filter((t) => t.getAttribute("visibility") === "hidden").length;
    const lisibles = textes.length - masquees;
    sortie.dataset.lisibles = String(lisibles);
    sortie.dataset.masquees = String(masquees);
    sortie.textContent = `${lisibles} lisibles, ${masquees} masquées`;
  }
  for (const fiche of document.querySelectorAll<HTMLElement>("[data-manette]")) {
    const svg = fiche.querySelector<SVGSVGElement>('[data-format="grande"] svg[data-padmap]');
    const sortie = fiche.querySelector<HTMLElement>("[data-contraste]");
    if (!svg || !sortie) continue;
    const { valeur, ou } = pireAppui(svg);
    const tient = valeur >= 3;
    if (!tient) echecs += 1;
    sortie.dataset.contraste = Number.isFinite(valeur) ? valeur.toFixed(2) : "illisible";
    sortie.dataset.verdict = tient ? "tient" : "échoue";
    sortie.dataset.ou = ou;
    const lu = Number.isFinite(valeur) ? `${valeur.toFixed(2).replace(".", ",")}:1` : "illisible";
    sortie.textContent = `appui le plus faible : ${lu} (${ou}), ${tient ? "tient" : "échoue"}`;
  }
  const bilan = document.getElementById("bilan");
  if (bilan) {
    bilan.dataset.echecs = String(echecs);
    bilan.textContent = echecs ? `${echecs} manettes échouent à 3:1` : "toutes tiennent 3:1";
  }
}

function paindre(allume: boolean, incline: boolean) {
  for (const piece of document.querySelectorAll<SVGGElement>("[data-part]")) {
    piece.setAttribute("data-lit", allume ? "oui" : "non");
    const corps = piece.querySelector<SVGGElement>(".n3-stick-body");
    if (!corps?.dataset.drive) continue;
    const pente = incline ? PENTE[piece.dataset.stick ?? ""] : undefined;
    const course = Number(corps.dataset.drive);
    if (pente)
      corps.setAttribute("transform", `translate(${pente[0] * course} ${pente[1] * course})`);
    else corps.removeAttribute("transform");
  }
}

function Bascule({
  id,
  mot,
  actif,
  basculer,
}: {
  id: string;
  mot: string;
  actif: boolean;
  basculer: () => void;
}) {
  return (
    <button id={id} type="button" aria-pressed={actif} onClick={basculer}>
      {mot}
    </button>
  );
}

const params = new URLSearchParams(location.search);
const placeDemandee = Number(params.get("place"));

function Planche() {
  const [allume, setAllume] = useState(params.has("lit"));
  const [incline, setIncline] = useState(params.has("sim"));
  const [brut, setBrut] = useState(params.has("brut"));
  const [cadre, setCadre] = useState(params.has("cadre"));
  const [place, setPlace] = useState<Place>(
    placeDemandee >= 1 && placeDemandee <= 4 ? (placeDemandee as Place) : null,
  );
  const [theme, setTheme] = useState<Theme>(params.get("theme") === "jour" ? "jour" : "nuit");

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    paindre(allume, incline);
    mesurer();
  });

  return (
    <>
      <h1>Les manettes</h1>
      <div className="reglages" role="group" aria-label="Réglages de la planche">
        <Bascule
          id="toutAllumer"
          mot="Tout allumer"
          actif={allume}
          basculer={() => setAllume(!allume)}
        />
        <Bascule
          id="incliner"
          mot="Incliner les sticks"
          actif={incline}
          basculer={() => setIncline(!incline)}
        />
        <Bascule
          id="indicesBruts"
          mot="Indices bruts"
          actif={brut}
          basculer={() => setBrut(!brut)}
        />
        <Bascule
          id="encadrer"
          mot="Encadrer une touche"
          actif={cadre}
          basculer={() => setCadre(!cadre)}
        />
      </div>
      <div className="reglages" role="group" aria-label="Place de l'appui">
        {([null, 1, 2, 3, 4] as const).map((une) => (
          <Bascule
            key={String(une)}
            id={`place-${une ?? "aucune"}`}
            mot={une === null ? "Aucune place" : `Place ${une}`}
            actif={place === une}
            basculer={() => setPlace(une)}
          />
        ))}
        {(["nuit", "jour"] as const).map((un) => (
          <Bascule
            key={un}
            id={`theme-${un}`}
            mot={un === "nuit" ? "Nuit" : "Jour"}
            actif={theme === un}
            basculer={() => setTheme(un)}
          />
        ))}
      </div>
      <p id="bilan" role="status" />
      {GROUPES.map((groupe) => (
        <section key={groupe.id} data-groupe={groupe.id}>
          <h2>{groupe.titre}</h2>
          <div className="manettes">
            {groupe.plans.map((map) => (
              <div key={map.id} className="manette" data-manette={map.id}>
                <p data-ou>{OU[map.id] ?? ""}</p>
                <div className="tailles">
                  {TAILLES.map((taille) => (
                    <div key={taille.id} data-format={taille.id} style={{ width: taille.largeur }}>
                      <PadMapView
                        map={map}
                        title={taille.id === "grande" ? map.name : taille.nom}
                        rawLabels={brut}
                        place={place}
                        selected={cadre ? encadree(map) : null}
                      />
                      <p className="taille" data-compte />
                    </div>
                  ))}
                </div>
                <p data-contraste />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

createRoot(document.getElementById("planche")!).render(<Planche />);
window.addEventListener("planche:mesurer", mesurer);
void document.fonts.ready.then(mesurer);
