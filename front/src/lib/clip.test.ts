import { describe, expect, it } from "vitest";

import { aSecondLater, askForClip, clipLabel, nameFrom, type ClipState } from "./clip";

/** Une réponse du worker, sans worker. */
const answers = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): typeof fetch =>
  (async () =>
    // Les octets bruts et pas un `Blob`: l'environnement de test le rendrait en
    // « [object Blob] », soit treize octets au lieu de soixante-quatre.
    new Response(status === 200 ? new Uint8Array(64) : JSON.stringify(body), {
      status,
      headers,
    })) as unknown as typeof fetch;

describe("demander un clip", () => {
  it("rend le fichier quand la salle l'a emballé", async () => {
    const state = await askForClip(
      answers(200, null, { "Content-Disposition": 'attachment; filename="nel3ab-31s.mp4"' }),
      () => "blob:faux",
    );

    expect(state).toEqual({ phase: "fait", url: "blob:faux", name: "nel3ab-31s.mp4", bytes: 64 });
  });

  it("rend l'attente du SERVEUR quand c'est trop tôt", async () => {
    // Le nombre vient de la salle et pas d'un décompte à nous. C'est la leçon
    // du bouton « ça saccade », qui se réarmait à trois secondes pendant que le
    // salon en refusait vingt.
    const state = await askForClip(
      answers(429, { attendre: 18, pourquoi: "trop tôt" }, { "Retry-After": "18" }),
      () => "blob:faux",
    );

    expect(state).toEqual({ phase: "attendre", seconds: 18 });
  });

  it("lit l'attente dans le corps quand l'en-tête manque", async () => {
    // Le jumeau: une lecture qui ne regarderait que l'en-tête rendrait « raté »
    // sur un refus parfaitement normal, et le bouton dirait qu'il est cassé.
    const state = await askForClip(answers(429, { attendre: 7 }), () => "blob:faux");

    expect(state).toEqual({ phase: "attendre", seconds: 7 });
  });

  it("dit pourquoi quand la salle n'a rien à couper", async () => {
    const state = await askForClip(
      answers(409, { attendre: 0, pourquoi: "pas encore trente secondes" }),
      () => "blob:faux",
    );

    expect(state).toEqual({ phase: "raté", why: "pas encore trente secondes" });
  });

  it("ne prend pas une panne pour une attente", async () => {
    // Un 503 qui porte `Retry-After` est ce qu'un proxy en panne répond, et
    // c'est exactement ce qui ne doit PAS devenir un compte à rebours poli. Seul
    // 429 veut dire « la cadence te refuse »; le reste veut dire que quelque
    // chose ne va pas, et le bouton doit le dire au lieu de faire patienter.
    const state = await askForClip(
      answers(503, { attendre: 5, pourquoi: "la salle ne répond plus" }, { "Retry-After": "5" }),
      () => "blob:faux",
    );

    expect(state.phase).toBe("raté");
  });

  it("et ne prend pas non plus un refus d'emballage pour une attente", async () => {
    const state = await askForClip(
      answers(500, { pourquoi: "ffmpeg a refusé" }),
      () => "blob:faux",
    );

    expect(state).toEqual({ phase: "raté", why: "ffmpeg a refusé" });
  });

  it("survit à une salle qui ne répond pas du tout", async () => {
    const state = await askForClip((async () => {
      throw new Error("liaison coupée");
    }) as unknown as typeof fetch);

    expect(state.phase).toBe("raté");
  });
});

describe("le compte à rebours", () => {
  it("descend d'une seconde par seconde", () => {
    expect(aSecondLater({ phase: "attendre", seconds: 18 })).toEqual({
      phase: "attendre",
      seconds: 17,
    });
  });

  it("rearme le bouton au lieu d'afficher zéro", () => {
    // Un bouton qui affiche « 0 s » sans être cliquable est un bouton cassé.
    expect(aSecondLater({ phase: "attendre", seconds: 1 })).toEqual({ phase: "prêt" });
  });

  it("ne touche à rien dans les autres états", () => {
    // Le jumeau: un décompte qui ramènerait tout à « prêt » effacerait le lien
    // du clip qu'on vient d'obtenir.
    const done: ClipState = { phase: "fait", url: "blob:x", name: "a.mp4", bytes: 1 };
    expect(aSecondLater(done)).toBe(done);
  });
});

describe("ce que le bouton dit", () => {
  it("nomme chaque état, et jamais deux pareil", () => {
    const said = [
      clipLabel({ phase: "prêt" }),
      clipLabel({ phase: "en cours" }),
      clipLabel({ phase: "attendre", seconds: 12 }),
      clipLabel({ phase: "fait", url: "", name: "", bytes: 0 }),
      clipLabel({ phase: "raté", why: "" }),
    ];

    expect(new Set(said).size).toBe(said.length);
    expect(said[2]).toContain("12");
  });
});

describe("le nom du fichier", () => {
  it("est celui que la salle propose", () => {
    expect(nameFrom('attachment; filename="nel3ab-31s.mp4"')).toBe("nel3ab-31s.mp4");
  });

  it("en a un même quand la salle n'en donne pas", () => {
    // Un lien sans nom fait un fichier appelé « clip » sans extension, que rien
    // n'ouvre.
    expect(nameFrom(null)).toMatch(/\.mp4$/);
    expect(nameFrom("attachment")).toMatch(/\.mp4$/);
  });
});
