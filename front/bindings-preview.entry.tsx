/** Le vrai configurateur, sur une manette simulée et sans accès à la salle. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Preparation } from "./src/components/Preparation";
import type { Preparation as Pending, Game } from "./src/client";
import type { Pad } from "./src/lib/saves";
import { Bindings } from "./src/components/Bindings";
import { Channels } from "./src/components/Channels";
import { Home } from "./src/components/Home";
import { InputStream } from "./src/media/input";
import { client } from "./src/client/client.gen";
import "./src/index.css";

// Les écritures de profils restent sous une URL que Vite ne relaie jamais.
client.setConfig({ baseUrl: `${location.origin}/preview-no-network` });
const kind = new URLSearchParams(location.search).get("pad");
const pad = {
  id: kind === "unknown" ? "GameCube USB adapter" : "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)",
  index: 0, mapping: kind === "unknown" ? "" : "standard", connected: true,
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })),
  axes: [0, 0, 0, 0], timestamp: 0,
};
Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
Object.assign(window, { previewPad: pad });

function Preview() {
  const [stream] = useState(() => new InputStream((path) => path, () => {}, () => refresh(), true));
  const [state, setState] = useState(() => stream.state());
  const preparing = new URLSearchParams(location.search).has("preparation");
  const wii = preparing || new URLSearchParams(location.search).get("console") === "wii";
  const [selected, setSelected] = useState<Pad>(1);
  const [pending, setPending] = useState<Pending>({ id: "preview", game: 0, save: 0, starter: "preview-one", allowed: [1, 0], players: [
    { port: 1, claim: "preview-one", name: "Souhib", ready: false, pad: null },
    { port: 2, claim: "preview-two", name: "Yassine", ready: false, pad: null },
  ] });
  const game: Game = { index: 0, name: "Mario Kart Wii", console: "wii", guide: { allowed: [1, 0], source: "https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/Wii_Mario_Kart", note: "Commandes de course. Chacun peut choisir un appareil différent.", actions: { "0": { A: "Accélérer", L: "Utiliser un objet" }, "1": { A: "Accélérer", R: "Utiliser un objet (Z du Nunchuk)" } } } };
  const [open, setOpen] = useState(true);
  const refresh = () => setState(stream.state());
  const act = (fn: () => void) => { fn(); refresh(); };
  useEffect(() => {
    stream.start();
    if (preparing) { Object.assign(stream, { receipt: "preview-one" }); stream.blockGameplay(true); }
    Object.assign(window, { previewReady: () => setPending(p => ({ ...p, players: p.players.map(one => one.port === 2 ? { ...one, ready: true, pad: 0 } : one) })) });
    const interval = setInterval(refresh, 100);
    return () => { clearInterval(interval); stream.stop(); };
  }, [stream]);
  return <><button type="button" onClick={() => setOpen(true)}>Ouvrir les touches et manettes</button>
    {open ? <Bindings console={wii ? "wii" : "gc"} held={wii ? selected : 0} state={state}
      readOnly={preparing && Boolean(pending.players[0].ready)}
      actions={preparing ? game.guide?.actions[String(selected)] : undefined}
      preparation={preparing ? <Preparation pending={pending} game={game} input={stream} state={state} selected={selected} onSelect={(kind) => { setSelected(kind); refresh(); }} send={async action => {
        if (action.action === "choose") setPending(p => ({ ...p, players: p.players.map(one => one.port === 1 ? { ...one, ready: Boolean(action.ready), pad: Number(action.pad) } : one) }));
        if (action.action === "launch") Object.assign(window, { previewLaunched: true });
        if (action.action === "cancel") setOpen(false);
      }} /> : undefined}
      onCapture={(key, source, sign) => act(() => stream.beginCapture(key, source, sign))}
      onUse={(at) => act(() => stream.useP(at))} onCancel={() => act(() => stream.cancelCapture())}
      onLearn={() => act(() => stream.beginLesson(preparing ? "wii" : "gc", preparing ? selected : 0))} onSkip={() => act(() => stream.skipLessonStep())}
      onResetPad={() => act(() => stream.resetPad())} onResetKeys={() => act(() => stream.resetKeys())}
      onPickKeys={(name) => act(() => stream.pickKeys(name))} onNewKeys={(name) => act(() => stream.newKeys(name))}
      onForgetKeys={(name) => act(() => stream.forgetKeys(name))}
      onClose={() => { stream.cancelCapture(); setOpen(false); }} /> : null}</>;
}
// Quatorze réglages suffisent à faire déborder la grille Wii. Aucun n'agit sur
// une session : cet aperçu ne construit même pas la boucle d'entrée.
const categories = [{ id: "settings", label: "Réglages", icon: null,
  items: Array.from({ length: 14 }, (_, at) => ({ id: String(at), label: `Réglage ${at + 1}`, icon: null })),
}];
const shell = new URLSearchParams(location.search).get("shell");
createRoot(document.getElementById("root")!).render(shell === "wii"
  ? <Channels categories={categories} onClose={() => {}} />
  : shell === "switch" ? <Home categories={categories} onClose={() => {}} who="Aperçu" />
    : <Preview />);
