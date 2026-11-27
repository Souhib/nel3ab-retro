/**
 * La sonde du site, après la relecture adverse du 22 novembre 2026.
 *
 * Trois défauts: un 502 du relais passait pour « le reste du site répond »;
 * une salle en redémarrage (deux secondes à chaque changement de jeu) passait
 * pour fermée; et la fenêtre lue par la proposition ne disait pas si le son et
 * l'écho avaient continué pendant un gel.
 */
import { describe, expect, it, vi } from "vitest";
import { FERMEE_CONFIRMEE_MS, SONDE_EVERY_MS, VeilleLiaison, type Flux } from "./veille";
import { dire } from "../lib/liaison-mots";

function flux(video: Partial<Flux["video"]> = {}, rest: Partial<Omit<Flux, "video">> = {}): Flux {
  return {
    video: {
      connected: true,
      sinceOpenedMs: 300_000,
      downForMs: null,
      sinceHeardMs: 16,
      sinceUnitMs: 16,
      sincePaintedMs: 16,
      painted: 1000,
      units: 1000,
      sinceStartedMs: 300_000,
      awaitingRestart: false,
      ...video,
    },
    sound: { sinceChunkMs: 20 },
    input: { sinceHeardMs: 300 },
    ...rest,
  };
}
const tombee = (coupee = 3000) =>
  flux({ connected: false, sinceOpenedMs: null, downForMs: coupee, sinceHeardMs: coupee });

function veille(fetch: (url: string) => Promise<Response>) {
  const horloge = { t: 1_000_000 };
  const v = new VeilleLiaison({
    now: () => horloge.t,
    horloge: () => horloge.t,
    enLigne: () => true,
    visible: () => true,
    salle: () => 1,
    fetch,
  });
  v.dire({ jeu: true, demarrageA: null, proposer: false });
  return { v, horloge };
}
const liste = (salle: Record<string, unknown>) =>
  new Response(JSON.stringify([{ numero: 1, chemin: "/r/1/", jeu: null, ...salle }]), {
    status: 200,
  });
const attendre = () => new Promise((wake) => setTimeout(wake, 0));

describe("un relais qui répond 502 n'est pas le site", () => {
  it("le salon arrêté: Caddy rend 502, la page ne dit pas « le reste du site répond »", async () => {
    const { v } = veille(
      vi.fn().mockResolvedValue(new Response("502 Bad Gateway", { status: 502 })),
    );
    v.lire(tombee());
    await attendre();
    const vu = v.lire(tombee());
    expect(vu).toMatchObject({ etat: "injoignable", site: "relais" });
    const dit = dire(vu, 1);
    expect(`${dit.titre} ${dit.detail}`).not.toContain("Le reste du site répond");
    // Signaler passe par le salon: le proposer quand il ne répond pas ment.
    expect(dit.actions).not.toContain("signaler");
  });

  it("jumeau: une liste en 200, c'est le site qui répond", async () => {
    const { v } = veille(vi.fn(() => Promise.resolve(liste({ ouverte: true }))));
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee())).toMatchObject({ etat: "injoignable", site: "repond" });
  });

  it("un 200 qui n'est pas une liste n'est pas le site non plus", async () => {
    const { v } = veille(
      vi.fn().mockResolvedValue(new Response("<html>portail</html>", { status: 200 })),
    );
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee())).toMatchObject({ etat: "injoignable", site: "relais" });
  });
});

describe("une salle qui redémarre n'est pas une salle fermée", () => {
  it("le salon dit « redémarre »: la page le dit, sans « fermée »", async () => {
    const { v } = veille(vi.fn(() => Promise.resolve(liste({ ouverte: false, redemarre: true }))));
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee()).etat).toBe("redemarre");
  });

  it("une seule réponse « fermée » ne suffit pas: le worker se relance en deux secondes", async () => {
    // Un salon d'avant le champ `redemarre`, ou l'instant où systemd arrête
    // encore l'ancien processus: la salle se dit fermée, puis revient.
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(liste({ ouverte: false }))
      .mockResolvedValue(liste({ ouverte: true }));
    const { v, horloge } = veille(fetch);
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee()).etat).not.toBe("fermee");
    horloge.t += SONDE_EVERY_MS;
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee()).etat).toBe("injoignable");
  });

  it("jumeau: deux réponses « fermée » espacées de plus de deux secondes, c'est fermé", async () => {
    const { v, horloge } = veille(vi.fn(() => Promise.resolve(liste({ ouverte: false }))));
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee()).etat).not.toBe("fermee");
    horloge.t += Math.max(SONDE_EVERY_MS, FERMEE_CONFIRMEE_MS);
    v.lire(tombee());
    await attendre();
    expect(v.lire(tombee()).etat).toBe("fermee");
  });
});

describe("la fenêtre que lit la proposition de format réduit", () => {
  const gel = (son: number | null, manette: number | null) =>
    flux(
      { sinceHeardMs: 100, sinceUnitMs: 9000, sincePaintedMs: 9000 },
      { sound: { sinceChunkMs: son }, input: { sinceHeardMs: manette } },
    );

  it("un gel où le son et l'écho ont continué est un gel de la salle", () => {
    const { v } = veille(vi.fn());
    v.lire(flux());
    v.lire(gel(20, 300));
    v.lire(gel(20, 300));
    expect(v.prendreFenetre()).toMatchObject({ gelSalle: true });
  });

  it("jumeau: un seul relevé sans le son suffit à ne plus le savoir", () => {
    const { v } = veille(vi.fn());
    v.lire(gel(20, 300));
    v.lire(gel(4000, 300));
    expect(v.prendreFenetre()).toMatchObject({ gelSalle: false });
  });

  it("jumeau: sans écho de la manette non plus", () => {
    const { v } = veille(vi.fn());
    v.lire(gel(20, null));
    expect(v.prendreFenetre()).toMatchObject({ gelSalle: false });
  });

  it("repart de zéro à chaque lecture", () => {
    const { v } = veille(vi.fn());
    v.lire(gel(20, 300));
    expect([...v.prendreFenetre().vus]).toEqual(["figee"]);
    expect(v.prendreFenetre()).toEqual({ vus: new Set(), gelSalle: false });
  });
});
