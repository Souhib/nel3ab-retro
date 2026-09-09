import { expect, it } from "vitest";
import { diagnose } from "./diagnosis";
import { VideoStream } from "../media/video";
const sample = () => ({
  ...new VideoStream(document.createElement("canvas"), (p) => p).stats(),
  connected: true,
  paintedSince: 40,
});

it("distingue l'attente, le décodage et la réception sans réduire les autres joueurs", () => {
  const video = sample();
  expect(diagnose({ ...video, connected: false }).title).toContain("Reconnexion");
  expect(diagnose({ ...video, paintedSince: 0 }).reduce).toBe(false);
  expect(diagnose({ ...video, backlog: 10 }).title).toContain("Décodage");
  expect(diagnose({ ...video, backlog: 9 }).title).not.toContain("Décodage");
  expect(diagnose({ ...video, overloaded: true }).reduce).toBe(true);
  expect(diagnose({ ...video, overloaded: true, half: true }).reduce).toBe(false);
  expect(diagnose({ ...video, overloaded: true, halfDenied: true }).reduce).toBe(false);
  expect(diagnose(video).title).toBe("Aucune surcharge détectée");
});
