import { SwitchInput } from "../../../front/src/media/switch";
import { setup } from "./setup";
import { Session } from "../../../front/src/media/session";
import { askForClip } from "../../../front/src/lib/clip";
declare global {
  interface Window {
    prototypeSession?: Session;
  }
}

let session: Session | null = null;
const input = new SwitchInput();
let noticeTimer: number | undefined;
let unsubscribe: (() => void) | undefined;
const element = (id: string) => document.getElementById(id)!;
const button = (id: string) => element(id) as HTMLButtonElement;
const volume = element("volume") as HTMLInputElement;
function notice(text: string) {
  clearTimeout(noticeTimer);
  element("notice").textContent = text;
  noticeTimer = window.setTimeout(() => {
    element("notice").textContent = "";
  }, 7000);
}
function leave() {
  unsubscribe?.();
  session?.stop();
  session = null;
  delete window.prototypeSession;
  element("seat").textContent = "Pas connecté";
  element("connection").textContent = "En attente";
  element("controller").textContent = "";
  element("placeholder").hidden = false;
  element("placeholder").textContent =
    "Clique sur Jouer pour prendre une place, ou Regarder pour voir la partie.";
  for (const id of ["leave", "sound", "clip"]) button(id).disabled = true;
}
function join(watching: boolean) {
  leave();
  if (!("VideoDecoder" in window)) {
    notice("Ce navigateur ne propose pas le décodeur vidéo requis. Essaie Chrome ou Edge à jour.");
    return;
  }
  element("seat").textContent = watching ? "Spectateur" : "Recherche d’une place…";
  session = new Session(
    element("picture") as HTMLCanvasElement,
    (port) => {
      element("seat").textContent =
        port === null ? (watching ? "Spectateur" : "En attente d’une place") : `Joueur ${port}`;
    },
    Number(volume.value),
    false,
    watching,
    false,
    input,
  );
  session.start();
  void session.sound.start();
  let lastPad = "";
  let lastPainted = 0;
  let lastPictureAt = performance.now();
  unsubscribe = session.subscribe(() => {
    const shot = session!.getSnapshot();
    element("stats").textContent = JSON.stringify(shot, null, 2);
    if (shot.video.painted !== lastPainted) {
      lastPainted = shot.video.painted;
      lastPictureAt = performance.now();
    }
    // Same three-second warning as the capture watchdog. A live WebSocket
    // receives keepalives even when the recorder has stopped producing images.
    const quiet = performance.now() - lastPictureAt >= 3000;
    element("placeholder").hidden = shot.video.painted > 0 && !quiet;
    element("placeholder").textContent = quiet
      ? "L’image est interrompue. En attente du retour du flux…"
      : "Connexion au jeu en cours…";
    element("connection").textContent = quiet
      ? "Image interrompue · en attente du flux"
      : shot.video.connected
        ? `${shot.video.picture?.width ?? "…"} × ${shot.video.picture?.height ?? "…"} · ${shot.sound.state === "running" ? "son actif" : "son à activer"}`
        : "Connexion au jeu en cours…";
    const pad = input.pad?.id ?? "";
    element("controller").textContent =
      pad || "Clavier · appuie sur un bouton de ta manette pour la détecter";
    if (pad !== lastPad) {
      if (pad) notice(`Manette détectée : ${pad}`);
      lastPad = pad;
    }
    button("sound").textContent = shot.sound.state === "running" ? "Son actif" : "Activer le son";
    element("half").setAttribute("aria-pressed", String(shot.video.half));
    element("full").setAttribute("aria-pressed", String(!shot.video.half));
  });
  window.prototypeSession = session;
  for (const id of ["leave", "sound", "clip"]) button(id).disabled = false;
  // Space/Enter on a focused toolbar button must not reconnect during play.
  (document.activeElement as HTMLElement | null)?.blur();
}
const editor = setup(input, () => session, notice);
element("play").onclick = () => editor.open(() => join(false));
element("watch").onclick = () => join(true);
element("leave").onclick = leave;
element("half").onclick = () => session?.video.setHalf(true);
element("full").onclick = () => session?.video.setHalf(false);
element("sound").onclick = () => {
  void session?.sound.start();
};
volume.oninput = () => session?.sound.setVolume(Number(volume.value));
element("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await element("screen").requestFullscreen();
  } catch {
    notice("Le navigateur n’a pas autorisé le plein écran.");
  }
};
element("clip").onclick = async () => {
  button("clip").disabled = true;
  notice("Préparation des 30 dernières secondes, avec le son…");
  try {
    const result = await askForClip();
    if (result.phase !== "fait") {
      notice("Le clip n’est pas encore disponible. Attends trente secondes de jeu puis réessaie.");
      return;
    }
    const link = document.createElement("a");
    link.href = result.url;
    link.download = result.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(result.url), 1000);
    notice("Clip téléchargé.");
  } catch {
    notice("Le téléchargement a échoué. Tu peux réessayer.");
  } finally {
    button("clip").disabled = session === null;
  }
};
window.addEventListener("beforeunload", leave);
