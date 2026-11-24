import type { Game } from "../client";
import { controlsFor } from "../media/pad";
import { deviceLabel, faceOf } from "../lib/faces";
import type { Pad } from "../lib/saves";
import { appareilsDe } from "../lib/consoles";

/** Une fiche inconnue reste inconnue, même si un jeu voisin a un manuel.
 *
 * Elle ne dit que ce qu'on sait (B5, 24 novembre 2026) : le nombre de
 * joueurs seulement si le guide le dit, les appareils de la console nommés
 * par elle, « Commandes et compatibilité » seulement s'il y a un guide. Trois
 * lignes « non vérifié » disaient surtout ce que la fiche ignorait. */
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
  const allowed = guide?.allowed ?? appareilsDe(game.console);
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
        {guide?.players ? (
          <strong>{`1 à ${Math.min(4, guide.players)} joueurs dans la salle`}</strong>
        ) : null}
        {allowed.length ? <span>{allowed.map(named).join(" · ")}</span> : null}
      </div>
      {guide ? (
        <details open={!compact}>
          <summary>Commandes et compatibilité du jeu</summary>
          {guide.multiplayer ? <p>{guide.multiplayer}</p> : null}
          {guide.devices?.length ? (
            <p>
              Appareils du jeu original : {guide.devices.join(", ")}. Les choix ci-dessus sont ceux
              disponibles ici.
            </p>
          ) : null}
          {guide.note ? <p>{guide.note}</p> : null}
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
          {guide.source ? (
            <a href={guide.source} target="_blank" rel="noreferrer">
              Source Nintendo{guide.checked ? ` · vérifiée le ${guide.checked}` : ""}
            </a>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}
