import type { Game } from "../client";
import { controlsFor } from "../media/pad";
import { deviceLabel, faceOf } from "../lib/faces";
import type { Pad } from "../lib/saves";

/** Une fiche inconnue reste inconnue, même si un jeu voisin a un manuel. */
export function GameCard({
  game,
  kind,
  compact = false,
}: {
  game: Game;
  kind?: Pad;
  compact?: boolean;
}) {
  const guide = game.guide;
  const allowed = guide?.allowed ?? (game.console === "gc" ? [0] : []);
  const face = faceOf(game.console);
  // `kind` vient d'un écran Dolphin (préparation, touches): il ne décide que
  // pour une console Dolphin. Une salle Pro n'a qu'un appareil, le sien.
  const reading = face?.frame === "pro" ? allowed[0] : (kind ?? allowed[0]);
  const named = (device: number) =>
    deviceLabel(device, game.console) ?? `appareil ${device} inconnu`;
  const essentials =
    reading === undefined ? [] : Object.entries(guide?.actions[String(reading)] ?? {}).slice(0, 4);
  /* Le nom d'une commande: celui du configurateur dans une salle Pro, celui de
     l'appareil Dolphin sinon. */
  const said = (key: string): string => {
    if (face?.frame === "pro") return face.names[key] ?? key;
    const controls = reading === undefined ? [] : controlsFor(game.console ?? "?", reading as Pad);
    return controls.find((control) => control.key === key)?.label ?? key;
  };
  return (
    <section className="n3-game-card" aria-label={`À savoir avant de jouer à ${game.name}`}>
      <div className="n3-game-facts">
        <strong>
          {guide?.players
            ? `1–${Math.min(4, guide.players)} joueurs dans la salle`
            : "Nombre de joueurs non vérifié"}
        </strong>
        <span>
          {allowed.length ? allowed.map(named).join(" · ") : "Manettes compatibles non vérifiées"}
        </span>
      </div>
      <details open={!compact}>
        <summary>Commandes et compatibilité du jeu</summary>
        {guide?.multiplayer ? <p>{guide.multiplayer}</p> : null}
        {guide?.devices?.length ? (
          <p>
            Appareils du jeu original : {guide.devices.join(", ")}. Les choix ci-dessus sont ceux
            disponibles ici.
          </p>
        ) : null}
        <p>
          {guide?.note ??
            "Fiche de commandes non vérifiée. Consulte les règles du jeu avant de commencer."}
        </p>
        {essentials.length && reading !== undefined ? (
          <div className="n3-game-essentials">
            <strong>Repères · {named(reading)}</strong>
            <dl>
              {essentials.map(([key, action]) => (
                <div key={key}>
                  <dt>{said(key)}</dt>
                  <dd>{action}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
        {guide?.source ? (
          <a href={guide.source} target="_blank" rel="noreferrer">
            Source Nintendo{guide.checked ? ` · vérifiée le ${guide.checked}` : ""}
          </a>
        ) : null}
      </details>
    </section>
  );
}
