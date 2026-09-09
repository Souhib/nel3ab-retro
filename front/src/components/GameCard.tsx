import type { Game } from "../client";
import { controlsFor } from "../media/pad";
import { padLabel, type Pad } from "../lib/saves";

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
  const reading = kind ?? (allowed[0] as Pad | undefined);
  const essentials =
    reading === undefined ? [] : Object.entries(guide?.actions[String(reading)] ?? {}).slice(0, 4);
  const controls = reading === undefined ? [] : controlsFor(game.console ?? "?", reading);
  return (
    <section className="n3-game-card" aria-label={`À savoir avant de jouer à ${game.name}`}>
      <div className="n3-game-facts">
        <strong>
          {guide?.players
            ? `1–${Math.min(4, guide.players)} joueurs dans la salle`
            : "Nombre de joueurs non vérifié"}
        </strong>
        <span>
          {allowed.length
            ? allowed.map((device) => padLabel(device as Pad)).join(" · ")
            : "Manettes compatibles non vérifiées"}
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
            <strong>Repères · {padLabel(reading)}</strong>
            <dl>
              {essentials.map(([key, action]) => (
                <div key={key}>
                  <dt>{controls.find((control) => control.key === key)?.label ?? key}</dt>
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
