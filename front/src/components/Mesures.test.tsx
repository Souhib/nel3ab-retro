/** Les mesures de la liaison : la phrase, trois chiffres avec leur sens, le
 * trajet, et rien qui se dise mesuré avant de l'être. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IMAGE, MESURES } from "../lib/mots";
import type { Liaison } from "../media/liaison";
import { VideoStream, type VideoStats } from "../media/video";
import { Mesures, type LireTrajet, type Trajet } from "./Mesures";

const sample = (extra: Partial<VideoStats> = {}): VideoStats => ({
  ...new VideoStream(document.createElement("canvas"), (p) => p).stats(),
  connected: true,
  paintedSince: 400,
  sourceHz: 60,
  ...extra,
});
const ok: Liaison = { etat: "ok" };
const trajet =
  (t: Trajet): LireTrajet =>
  () =>
    Promise.resolve(t);

function monter(video: VideoStats, extra: Partial<Parameters<typeof Mesures>[0]> = {}) {
  let t = 10_000;
  const horloge = () => t;
  const props = {
    video,
    allerRetourMs: 31.6,
    liaison: ok,
    salle: 1,
    moteur: "dolphin",
    onReduce: vi.fn(),
    technique: <p>pli</p>,
    lireTrajet: trajet("direct"),
    horloge,
    ...extra,
  };
  const rendu = render(<Mesures {...props} />);
  return {
    ...props,
    avancer: (ms: number, v: VideoStats) => {
      t += ms;
      rendu.rerender(<Mesures {...props} video={v} />);
    },
  };
}

describe("les chiffres", () => {
  it("compte 60 images peintes par seconde sur deux relevés datés", async () => {
    const { avancer } = monter(sample({ painted: 400 }));
    expect(screen.getByText(`${MESURES.peintesSans} : ${MESURES.pasEncore}`)).toBeVisible();
    await act(async () => avancer(2000, sample({ painted: 520 })));
    expect(screen.getByText(MESURES.peintes(60))).toBeVisible();
    expect(screen.getByText(MESURES.jeu(60))).toBeVisible();
    expect(screen.getByText(MESURES.allerRetour(32))).toBeVisible();
  });

  it("jumeau : un jeu pas encore mesuré se dit, jamais une cadence de repli ni un zéro", async () => {
    monter(sample({ sourceHz: 0, refreshHz: 250 }), { allerRetourMs: null });
    expect(screen.getByText(`${MESURES.jeuSans} : ${MESURES.pasEncore}`)).toBeVisible();
    expect(screen.getByText(`${MESURES.allerRetourSans} : ${MESURES.pasEncore}`)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/250/);
    expect(screen.queryByText(MESURES.jeu(0))).toBeNull();
  });

  /* Le compteur d'une image figée ne bouge plus : la cadence ne se
     recalculait qu'à son changement, et le panneau gardait « 60 images
     peintes par seconde » à côté d'une phrase qui disait l'image figée
     (relecture du 24 novembre 2026). Chaque instantané est daté, qu'il
     apporte des images ou non. */
  it("jumeau : une image figée compte zéro image peinte, pas la dernière cadence", async () => {
    const { avancer } = monter(sample({ painted: 400 }));
    await act(async () => avancer(1000, sample({ painted: 460 })));
    expect(screen.getByText(MESURES.peintes(60))).toBeVisible();
    // Dix secondes d'instantanés, un par demi-seconde, l'un après l'autre.
    const figer = async (n: number): Promise<void> => {
      if (n === 0) return;
      await act(async () => avancer(500, sample({ painted: 460 })));
      return figer(n - 1);
    };
    await figer(20);
    expect(screen.queryByText(MESURES.peintes(60))).toBeNull();
    const dit = screen.getByText(MESURES.peintes(0)).closest("dd");
    expect(dit).toHaveTextContent(MESURES.sousLeJeu);
    // Le jumeau du jumeau : les images reviennent, la cadence aussi.
    await act(async () => avancer(1000, sample({ painted: 520 })));
    expect(screen.getByText(MESURES.peintes(60))).toBeVisible();
  });

  it("dit « moins que le jeu » par un mot, pas par la couleur seule", async () => {
    const { avancer } = monter(sample({ painted: 0 }));
    await act(async () => avancer(2000, sample({ painted: 60 })));
    const dit = screen.getByText(MESURES.peintes(30)).closest("dd");
    expect(dit).toHaveAttribute("data-mauvais");
    expect(dit).toHaveTextContent(MESURES.sousLeJeu);
  });
});

describe("le trajet et l'image", () => {
  it("dit le trajet par un relais sans en faire la cause", async () => {
    monter(sample(), { lireTrajet: trajet("relay") });
    expect(await screen.findByText(MESURES.relais)).toBeVisible();
  });

  it("jumeau : une lecture ratée dit « Trajet inconnu », jamais une panne", async () => {
    monter(sample(), { lireTrajet: () => Promise.resolve("unknown") });
    expect(await screen.findByText(MESURES.inconnu)).toBeVisible();
  });

  it("propose l'image légère avec son prix quand le diagnostic le propose", () => {
    const { onReduce } = monter(sample({ overloaded: true }));
    fireEvent.click(screen.getByRole("button", { name: IMAGE.passer }));
    expect(onReduce).toHaveBeenCalled();
    expect(screen.getByText(/2,6/)).toBeVisible();
  });

  it("jumeau : une salle Switch n'annonce pas le 2,6 mesuré sur Dolphin", () => {
    monter(sample({ overloaded: true }), { moteur: "eden" });
    expect(document.body.textContent).not.toMatch(/2,6/);
  });

  it("garde les mesures techniques repliées", () => {
    monter(sample());
    const pli = screen.getByText(MESURES.technique).closest("details");
    expect(pli).not.toHaveAttribute("open");
    expect(pli).toHaveTextContent("pli");
  });
});
