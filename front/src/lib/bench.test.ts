/**
 * Le plan du banc d'essai, et l'axe qu'on ne veut pas perdre.
 */
import { describe, expect, it } from "vitest";

import { bench, paintBench } from "./bench";

describe("le plan du banc", () => {
  it("range les axes par deux, et nomme les deux premières paires", () => {
    expect(bench(4)).toEqual({
      scopes: [
        { name: "stick gauche", along: 0, down: 1 },
        { name: "stick droit", along: 2, down: 3 },
      ],
      lone: [],
    });
  });

  it("ne donne pas de nom de stick à ce qu'il ne reconnaît pas", () => {
    // Le jumeau du nommage: inventer « stick 3 » ferait croire à un stick.
    expect(bench(6).scopes[2]).toEqual({ name: "axes 4·5", along: 4, down: 5 });
  });

  // L'essai qui porte le fichier. Un compte impair est ce qu'annoncent les
  // adaptateurs, et arrondir en bas ferait disparaître un axe en silence — la
  // panne exacte que ce projet a déjà eue avec un adaptateur GameCube.
  it("montre seul l'axe qui n'a pas de partenaire, plutôt que de l'oublier", () => {
    const plan = bench(5);
    expect(plan.scopes).toHaveLength(2);
    expect(plan.lone).toEqual([{ name: "axe 4", axis: 4 }]);
  });

  it("montre un axe unique tout seul, sans cadran", () => {
    expect(bench(1)).toEqual({ scopes: [], lone: [{ name: "axe 0", axis: 0 }] });
  });

  it("ne montre rien d'une manette sans axe", () => {
    // Les jumeaux négatifs: rien de tout ça n'est un cadran vide.
    expect(bench(0)).toEqual({ scopes: [], lone: [] });
    expect(bench(-2)).toEqual({ scopes: [], lone: [] });
    expect(bench(Number.NaN)).toEqual({ scopes: [], lone: [] });
  });
});

describe("ce que le banc écrit", () => {
  /** Le balisage minimal que le composant pose. L'essai le REDIT plutôt que de
   * monter React: ce qui est vérifié est le contrat des marques, et le redire
   * ici fait échouer l'essai le jour où le composant change de marque. */
  const panel = (buttons: number, axes: number) => {
    const root = document.createElement("div");
    const gauge = (mark: string) =>
      `<div data-gauge="${mark}"><span class="n3-fill"></span><span class="n3-value"></span></div>`;
    root.innerHTML = [
      ...Array.from({ length: buttons }, (_, at) => gauge(`b${at}`)),
      ...Array.from({ length: axes }, (_, at) => gauge(`a${at}`)),
      ...Array.from(
        { length: Math.floor(axes / 2) },
        (_, pair) =>
          `<svg data-scope="a${pair * 2}"><line class="n3-needle"></line><circle class="n3-dot"></circle></svg>`,
      ),
      gauge("stamp"),
    ].join("");
    return root;
  };
  /** Les hauteurs de jauge en NOMBRES: le navigateur réécrit « 65.0% » en
   * « 65% », et comparer la chaîne mesurerait sa mise en forme. */
  const fills = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>(".n3-fill")].map((e) =>
      Number.parseFloat(e.style.height),
    );
  const live = (buttons: number[], axes: number[], timestamp = 1234.7) => ({
    buttons: buttons.map((value) => ({ value })),
    axes,
    timestamp,
  });

  it("écrit chaque bouton à deux décimales et remplit sa jauge d'autant", () => {
    const root = panel(2, 0);
    paintBench(root, live([1, 0.65], []));
    const values = [...root.querySelectorAll(".n3-value")].map((e) => e.textContent);
    expect(values.slice(0, 2)).toEqual(["1.00", "0.65"]);
    // Le NOMBRE, pas sa mise en forme: le navigateur normalise « 65.0% » en
    // « 65% », et un essai qui compare la chaîne mesure jsdom plutôt que nous.
    expect(fills(root).slice(0, 2)).toEqual([100, 65]);
  });

  // Le jumeau qui porte la jauge: un axe négatif est aussi loin du repos qu'un
  // axe positif. Sans la valeur absolue, la moitié des axes auraient une jauge
  // vide alors que le stick est à fond, et le signe se lit déjà sur le chiffre.
  it("remplit autant pour un axe négatif que pour son opposé", () => {
    const down = panel(0, 2);
    paintBench(down, live([], [-0.9, 0]));
    const up = panel(0, 2);
    paintBench(up, live([], [0.9, 0]));
    expect(fills(down)[0]).toBe(90);
    expect(fills(down)[0]).toBe(fills(up)[0]);
    // Et le signe, lui, ne se perd pas.
    expect(down.querySelector('[data-gauge="a0"] .n3-value')!.textContent).toBe("-0.90000");
  });

  it("pose l'aiguille du cadran sans retourner le vertical", () => {
    // Le côté droit lit les axes du navigateur, qui comptent déjà comme
    // l'écran. Le jour où quelqu'un y appliquera la conversion du côté gauche,
    // cet essai le dira.
    const root = panel(0, 2);
    paintBench(root, live([], [0.55, -0.35]));
    const dot = root.querySelector('[data-scope="a0"] .n3-dot')!;
    expect(dot.getAttribute("cx")).toBe("0.550");
    expect(dot.getAttribute("cy")).toBe("-0.350");
  });

  it("borne une manette qui annonce plus que un", () => {
    const root = panel(0, 2);
    paintBench(root, live([], [3, -3]));
    expect(root.querySelector('[data-scope="a0"] .n3-dot')!.getAttribute("cx")).toBe("1.000");
    expect(fills(root)[0]).toBe(100);
  });

  it("écrit l'horodatage, le seul chiffre qui dit si la manette parle encore", () => {
    const root = panel(0, 0);
    paintBench(root, live([], [], 98765.4));
    expect(root.querySelector('[data-gauge="stamp"] .n3-value')!.textContent).toBe("98765");
  });

  it("ne se plaint pas d'un panneau qui n'a pas les marques", () => {
    // Le composant montre moins de jauges que la manette n'a de boutons pendant
    // le rendu qui suit un branchement. Écrire dans le vide est le bon
    // comportement; lever une exception tuerait la boucle d'affichage.
    expect(() => paintBench(document.createElement("div"), live([1, 1], [0.5, 0.5]))).not.toThrow();
  });
});
