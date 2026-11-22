import { describe, expect, it, vi } from "vitest";
import { basculerPleinEcran, lireAppareil, pleinEcranPossible } from "./plein-ecran";

describe("ce que l'appareil permet", () => {
  it("propose le plein écran quand l'API existe", () => {
    expect(pleinEcranPossible({ api: true, installe: false, apple: false })).toBe("api");
    // Un iPad la porte, préfixée: elle compte.
    expect(pleinEcranPossible({ api: true, installe: false, apple: true })).toBe("api");
  });

  it("propose l'écran d'accueil sur un iPhone, qui n'a pas l'API", () => {
    expect(pleinEcranPossible({ api: false, installe: false, apple: true })).toBe("ecran-accueil");
  });

  it("ne propose rien à un iPhone déjà ouvert depuis l'écran d'accueil", () => {
    expect(pleinEcranPossible({ api: false, installe: true, apple: true })).toBe("deja");
  });

  it("garde le plein écran d'un Android ouvert depuis l'écran d'accueil", () => {
    // `mobile-web-app-capable` ouvre la salle en mode autonome, où les barres
    // du système restent et où l'API marche: « deja » retirait l'entrée du
    // menu et de la feuille (relecture du 22 novembre 2026). Le jumeau est
    // l'essai du dessus: sans l'API, une page installée n'a rien à proposer.
    expect(pleinEcranPossible({ api: true, installe: true, apple: false })).toBe("api");
    expect(pleinEcranPossible({ api: true, installe: true, apple: true })).toBe("api");
  });

  it("ne promet rien à un navigateur sans API qui n'est pas un iPhone", () => {
    // Le jumeau de l'écran d'accueil: le conseil de Safari n'a pas de sens
    // ailleurs.
    expect(pleinEcranPossible({ api: false, installe: false, apple: false })).toBe("aucun");
  });
});

describe("lire l'appareil", () => {
  const doc = (over: Record<string, unknown>, el: Record<string, unknown> = {}) =>
    ({ documentElement: el, ...over }) as unknown as Document;
  const nav = (ua: string, extra: Record<string, unknown> = {}) =>
    ({ userAgent: ua, platform: "", maxTouchPoints: 0, ...extra }) as unknown as Navigator;
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/131 Mobile";
  const seul = (installe: boolean) => () => ({ matches: installe }) as MediaQueryList;

  it("voit l'API standard, et seulement quand elle est permise", () => {
    const request = () => Promise.resolve();
    expect(
      lireAppareil(
        doc({ fullscreenEnabled: true }, { requestFullscreen: request }),
        nav(ANDROID),
        seul(false),
      ).api,
    ).toBe(true);
    // Le jumeau: une fonction présente mais refusée (un cadre, une politique).
    expect(
      lireAppareil(
        doc({ fullscreenEnabled: false }, { requestFullscreen: request }),
        nav(ANDROID),
        seul(false),
      ).api,
    ).toBe(false);
  });

  it("voit l'API préfixée d'un iPad", () => {
    const vu = lireAppareil(
      doc({ webkitFullscreenEnabled: true }, { webkitRequestFullscreen: () => undefined }),
      nav("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", {
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
      seul(false),
    );
    expect(vu).toEqual({ api: true, installe: false, apple: true });
  });

  it("reconnaît un iPhone sans API", () => {
    expect(lireAppareil(doc({}), nav(IPHONE), seul(false))).toEqual({
      api: false,
      installe: false,
      apple: true,
    });
    // Le jumeau: un Android sans API n'est pas un appareil Apple, et un Mac à
    // la souris non plus.
    expect(lireAppareil(doc({}), nav(ANDROID), seul(false)).apple).toBe(false);
    expect(
      lireAppareil(doc({}), nav("Mozilla/5.0 (Macintosh)", { platform: "MacIntel" }), seul(false))
        .apple,
    ).toBe(false);
  });

  it("reconnaît une page ouverte depuis l'écran d'accueil", () => {
    expect(lireAppareil(doc({}), nav(IPHONE), seul(true)).installe).toBe(true);
    expect(lireAppareil(doc({}), nav(IPHONE, { standalone: true }), seul(false)).installe).toBe(
      true,
    );
  });
});

describe("basculer", () => {
  it("ne lève rien quand l'API n'existe pas, comme sur un iPhone", async () => {
    // La faute de l'audit M8: « requestFullscreen is not a function » levée
    // AVANT la promesse, que `.catch` ne rattrape pas.
    const document = { documentElement: {}, fullscreenElement: null } as unknown as Document;
    await expect(basculerPleinEcran(document)).resolves.toBe("impossible");
  });

  it("entre, et dit qu'il est entré", async () => {
    const requestFullscreen = vi.fn(() => Promise.resolve());
    const document = {
      documentElement: { requestFullscreen },
      fullscreenElement: null,
    } as unknown as Document;
    await expect(basculerPleinEcran(document)).resolves.toBe("entre");
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("dit un refus du navigateur au lieu de le laisser filer", async () => {
    const requestFullscreen = vi.fn(() => Promise.reject(new Error("pas de geste")));
    const document = {
      documentElement: { requestFullscreen },
      fullscreenElement: null,
    } as unknown as Document;
    await expect(basculerPleinEcran(document)).resolves.toBe("refuse");
  });

  it("rattrape aussi une erreur levée avant toute promesse", async () => {
    const requestFullscreen = vi.fn(() => {
      throw new TypeError("refusé tout de suite");
    });
    const document = {
      documentElement: { requestFullscreen },
      fullscreenElement: null,
    } as unknown as Document;
    await expect(basculerPleinEcran(document)).resolves.toBe("refuse");
  });

  it("passe par la forme préfixée d'un iPad", async () => {
    const webkitRequestFullscreen = vi.fn(() => undefined);
    const document = {
      documentElement: { webkitRequestFullscreen },
      fullscreenElement: null,
    } as unknown as Document;
    await expect(basculerPleinEcran(document)).resolves.toBe("entre");
    expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
  });

  it("sort quand on y est", async () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    const document = {
      documentElement: {},
      fullscreenElement: {},
      exitFullscreen,
    } as unknown as Document;
    await expect(basculerPleinEcran(document)).resolves.toBe("sorti");
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });
});
