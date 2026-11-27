import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Session } from "./session";
import { SoundStream } from "./sound";

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

function sessionAt(videoOffset: number) {
  const session = new Session(document.createElement("canvas"), vi.fn(), 0.5, false);
  Object.assign(session.video, { offset: videoOffset, connected: true, priming: false });
  const lag = (session.video as unknown as { lags: { push: (n: number) => void } }).lags;
  lag.push(1000);
  return session;
}

it("soustrait le tampon déjà appliqué à la vidéo et ne double pas la compensation", () => {
  const session = sessionAt(1080);
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : 1120 - picture,
  );
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1120);
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1120);
  session.refresh();
  expect(session.getSnapshot().soundGapMs).toBe(0);
  session.setLipsync(false);
  expect(session.video.anchorMs()).toBe(1080);
  session.refresh();
  expect(session.getSnapshot().soundGapMs).toBe(40);
});

it("suit l'horaire du son lorsqu'il redescend, sans avancer artificiellement la vidéo", () => {
  const session = sessionAt(1080);
  let audio = 1480;
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : audio - picture,
  );
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1480);
  // Des descentes plus grandes qu'un rafraîchissement : en dessous, la
  // bande morte de SON-8 garde l'horaire.
  audio = 1110;
  session.refresh();
  expect(session.video.anchorMs()).toBe(1110);
  expect(session.getSnapshot().soundGapMs).toBe(0);
  audio = 1060;
  session.refresh();
  expect(session.video.anchorMs()).toBe(1080);
  expect(session.getSnapshot().soundGapMs).toBe(-20);
});

it("ne prétend pas mesurer un décalage avant l'image ou sans son", () => {
  const session = sessionAt(1080);
  vi.spyOn(session.sound, "gapAgainst").mockReturnValue(null);
  session.setLipsync(true);
  session.refresh();
  expect(session.video.anchorMs()).toBe(1080);
  expect(session.getSnapshot().soundGapMs).toBeNull();
  Object.assign(session.video, { offset: null });
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : 1120 - picture,
  );
  session.refresh();
  expect(session.getSnapshot().soundGapMs).toBeNull();
});

it("compare le morceau réellement programmé, même si l'avance cible dit autre chose", () => {
  const sound = new SoundStream((path) => path, 0.5, false);
  Object.assign(sound, {
    context: { state: "running", outputLatency: 0.02 },
    scheduledOffset: 1100,
    lead: 0.4,
  });
  (sound as unknown as { lags: { push: (n: number) => void } }).lags.push(1000);
  expect(sound.gapAgainst(1080)).toBeCloseTo(40);
  expect(sound.gapAgainst(1150)).toBeCloseTo(-30);
  expect(sound.gapAgainst(null)).toBeNull();
  Object.assign(sound, { context: { state: "suspended" } });
  expect(sound.gapAgainst(1080)).toBeNull();
});

it("garde assez d'images pour le retard audio choisi, puis rend les places en le retirant", () => {
  const session = sessionAt(1080);
  const before = session.video.stats().room;
  session.video.setLipsync(400);
  expect(session.video.stats().room).toBeGreaterThanOrEqual(before + 20);
  session.video.setLipsync(0);
  expect(session.video.stats().room).toBe(before);
});

it("mesure l'instant demandé à Web Audio et oublie cet horaire quand la salle ferme", () => {
  const sound = new SoundStream((path) => path, 0.5, false);
  const start = vi.fn();
  vi.spyOn(performance, "now").mockReturnValue(2000);
  Object.assign(sound, {
    context: {
      state: "running",
      currentTime: 10,
      outputLatency: 0.02,
      createBuffer: () => ({ getChannelData: () => new Float32Array(480) }),
      createBufferSource: () => ({ connect: vi.fn(), start }),
    },
    gain: {},
    playAt: 10.1,
    lead: 0.4,
  });
  const data = new ArrayBuffer(8 + 480 * 2 * 2);
  new DataView(data).setBigUint64(0, 1_000_000n, true);
  (sound as unknown as { onChunk: (event: MessageEvent) => void }).onChunk(
    new MessageEvent("message", { data }),
  );
  expect(start).toHaveBeenCalledWith(10.1);
  expect(sound.gapAgainst(1080)).toBeCloseTo(40);
  sound.setIdle(true);
  expect(sound.gapAgainst(1080)).toBeNull();
});

// SON-8 : l'option relance le calage toutes les 500 ms avec l'écart du
// dernier morceau. Cet écart tremble de quelques millisecondes (l'instant de
// capture du son varie de 0 à 5 ms) : appliqué d'un coup à chaque fois, il
// faisait bouger l'horaire de l'image deux fois par seconde, et une image
// pouvait être tenue une fois de trop ou jetée.
it("ne fait pas trembler l'horaire de l'image avec l'écart du son", () => {
  const session = sessionAt(1080);
  const gigue = [3, -4, 1, 4, -2, -4, 2, 0, -3, 4];
  let lecture = 0;
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : 1120 + gigue[lecture++ % gigue.length] - picture,
  );
  session.setLipsync(true);
  const ancres = new Set([session.video.anchorMs()]);
  for (let fois = 0; fois < 40; fois++) {
    session.refresh();
    ancres.add(session.video.anchorMs());
  }
  expect(ancres.size, `l'horaire de l'image a bougé ${ancres.size - 1} fois`).toBe(1);
});

// Le jumeau : un vrai changement du son s'applique au relevé suivant.
it("applique un vrai saut de l'écart dès la lecture suivante", () => {
  const session = sessionAt(1080);
  let audio = 1120;
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : audio - picture,
  );
  session.setLipsync(true);
  expect(session.video.anchorMs()).toBe(1120);
  audio = 1160;
  session.refresh();
  expect(session.video.anchorMs()).toBe(1160);
});

// Le premier calage d'une option allumée s'applique, même plus petit qu'un
// rafraîchissement : la personne qui l'allume doit le voir. Et l'éteindre
// puis la rallumer repart d'un premier calage.
it("applique le premier calage, même petit, à chaque fois qu'on allume l'option", () => {
  const session = sessionAt(1080);
  let audio = 1090;
  vi.spyOn(session.sound, "gapAgainst").mockImplementation((picture) =>
    picture === null ? null : audio - picture,
  );
  session.setLipsync(true);
  expect(session.video.anchorMs(), "le premier calage de 10 ms n'est pas posé").toBe(1090);
  session.setLipsync(false);
  expect(session.video.anchorMs()).toBe(1080);
  audio = 1085;
  session.setLipsync(true);
  expect(session.video.anchorMs(), "rallumée, l'option ne pose pas son calage").toBe(1085);
});
