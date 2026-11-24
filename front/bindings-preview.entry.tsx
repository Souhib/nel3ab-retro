/** Le vrai panneau « Touches et manettes » et le bloc de la préparation, sur
 * une manette simulée et sans accès à la salle.
 *
 * Cet aperçu montait aussi les anciens dialogues des touches (`Bindings`,
 * `SwitchBindings`) : ils sont retirés le 24 novembre 2026, et l'adresse sans
 * paramètre montre maintenant le panneau en trame Dolphin. */
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Preparation } from "./src/components/Preparation";
import type { Preparation as Pending, Game } from "./src/client";
import type { Pad } from "./src/lib/saves";
import { InputStream } from "./src/media/input";
import { Reglage } from "./src/manettes/reglage/Reglage";
import type { Onglet } from "./src/manettes/entree";
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

/** Le panneau « Touches et manettes » de la colonne, seul sur la page :
 * `?reglage`, en trame Pro avec `&pro=switch` ou `&pro=x360`, et l'onglet
 * avec `&onglet=clavier`. Sans paramètre aussi (`salle-telephone.mjs`). */
function PreviewReglage({ pro }: { pro: "switch" | "x360" | null }) {
  const [stream] = useState(() => new InputStream((path) => path, () => {}, () => refresh(), true));
  const [state, setState] = useState(() => stream.state());
  const premier = new URLSearchParams(location.search).get("onglet");
  const [onglet, setOnglet] = useState<Onglet>(premier === "clavier" || premier === "profils" ? premier : "manette");
  const [open, setOpen] = useState(true);
  const refresh = () => setState(stream.state());
  useEffect(() => {
    stream.start();
    const interval = setInterval(refresh, 100);
    return () => { clearInterval(interval); stream.stop(); };
  }, [stream]);
  if (!open) return <button type="button" onClick={() => setOpen(true)}>Ouvrir les touches et manettes</button>;
  return (
    // La colonne de la salle garde les zones sûres d'un téléphone ; l'aperçu
    // les garde à sa place (`--zone-*` dans `index.css`).
    <main style={{ padding: "max(1rem, var(--zone-haut)) max(1rem, var(--zone-droite)) max(1rem, var(--zone-bas)) max(1rem, var(--zone-gauche))" }}>
      <Reglage onglet={onglet} onOnglet={setOnglet} onFermer={() => setOpen(false)} autres={false} vit
        trame={pro
          ? { genre: "pro", console: pro === "x360" ? "Xbox 360" : "Switch", xbox: pro === "x360",
              manette: pro === "x360" ? "manette Xbox 360" : "manette Pro", source: stream.switch, input: stream, place: 1 }
          : { genre: "dolphin", console: "gc", tenue: 0, state: { ...state, port: 1 }, input: stream, refresh }} />
    </main>
  );
}
/** La préparation à plusieurs, en bloc de colonne (chantier menus, P1) :
 * `?preparation` pour un jeu Wii, `&pro=x360` pour la manette Pro. La
 * colonne prend toute la page, comme dans la feuille agrandie d'une salle
 * tenue en main, et défile en elle-même (`salle-telephone.mjs`). */
function PreviewPreparation({ pro }: { pro: "switch" | "x360" | null }) {
  // L'attribution posée avant le premier rendu : le bloc la lit en rendant.
  const [stream] = useState(() =>
    Object.assign(new InputStream((path) => path, () => {}, () => {}, true), {
      receipt: new URLSearchParams(location.search).get("moi") ?? "preview-one",
    }),
  );
  const allowed = pro ? [4] : [1, 0];
  const [selected, setSelected] = useState<Pad>((pro ? 4 : 1) as Pad);
  const [pending, setPending] = useState<Pending>({ id: "preview", game: 0, save: 0, starter: "preview-one", allowed, players: [
    { port: 1, claim: "preview-one", name: "Souhib", ready: false, pad: null },
    { port: 2, claim: "preview-two", name: "Yassine", ready: false, pad: null },
  ] });
  useEffect(() => {
    stream.start();
    Object.assign(window, { previewReady: () => setPending(p => ({ ...p, players: p.players.map(one => one.port === 2 ? { ...one, ready: true, pad: allowed[0] } : one) })) });
    return () => stream.stop();
  }, [stream]);
  const game: Game = pro
    ? { index: 0, name: pro === "x360" ? "Sonic Generations" : "Mario Kart 8 Deluxe", console: pro }
    : { index: 0, name: "Mario Kart Wii", console: "wii" };
  return (
    <main style={{ height: "100dvh", display: "flex", padding: "var(--zone-haut) var(--zone-droite) var(--zone-bas) var(--zone-gauche)" }}>
      <aside id="side" className="n3-colonne flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-panel px-3 pt-3">
        <Preparation pending={pending} game={game} input={stream} state={{ capturing: null, lesson: null, port: 1 }}
          selected={selected} onSelect={setSelected} enCours="Mario Party 4"
          onEssayer={() => Object.assign(window, { previewEssai: true })}
          send={async (action) => {
            if (action.action === "choose") setPending(p => ({ ...p, players: p.players.map(one => one.port === 1 ? { ...one, ready: Boolean(action.ready), pad: Number(action.pad) } : one) }));
            if (action.action === "launch") Object.assign(window, { previewLaunched: true, previewLaunch: action });
          }} />
      </aside>
    </main>
  );
}
const pro = new URLSearchParams(location.search).get("pro");
const reglage = new URLSearchParams(location.search).has("reglage");
const preparation = new URLSearchParams(location.search).has("preparation");
createRoot(document.getElementById("root")!).render(preparation && !reglage
  ? <PreviewPreparation pro={pro === "switch" || pro === "x360" ? pro : null} />
  : <PreviewReglage pro={pro === "switch" || pro === "x360" ? pro : null} />);
