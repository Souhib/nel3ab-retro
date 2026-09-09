import { useState } from "react";
import type { Game } from "../client";
import type { InputState, InputStream } from "../media/input";
import type { Pad } from "../lib/saves";
import {
  deleteSetup,
  saveSetup,
  setups,
  snapshotSetup,
  preferSetup,
  preferredSetup,
  setupGameKey,
} from "../lib/setups";

/** La préférence propose une configuration personnelle sans valider la préparation. */
export function SetupProfiles({
  game,
  input,
  state,
  selected,
  allowed,
  onSelect,
  disabled = false,
}: {
  game?: Game;
  input: Pick<InputStream, "applySetup">;
  state: InputState;
  selected: Pad;
  allowed: readonly number[];
  onSelect: (kind: Pad) => void;
  disabled?: boolean;
}) {
  const gameKey = game ? setupGameKey(game) : null;
  const preferred = gameKey ? preferredSetup(gameKey) : null;
  const [profile, setProfile] = useState(preferred ?? "");
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const saved = setups();
  const preference = (wanted: string | null) => {
    if (!gameKey) return;
    try {
      preferSetup(gameKey, wanted);
      setNotice(
        wanted
          ? `« ${wanted} » sera proposé au prochain lancement de ce jeu.`
          : "Choix personnel retiré pour ce jeu.",
      );
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  const store = (replace: boolean) => {
    try {
      const label = replace ? profile : name;
      saveSetup(label, snapshotSetup(selected, state), replace);
      setProfile(label.trim());
      setName("");
      setNotice("Profil enregistré dans tes réglages personnels.");
    } catch (error) {
      setNotice((error as Error).message);
    }
  };
  return (
    <details className="n3-preparation-saved" open={Boolean(preferred)}>
      <summary>Mes profils enregistrés · {Object.keys(saved).length}</summary>
      <fieldset disabled={disabled} className="n3-preparation-profiles">
        <legend>Mes profils de manette</legend>
        {preferred ? (
          <p>
            Profil proposé pour {game?.name} : <strong>{preferred}</strong>. Charge-le puis teste
            tes commandes.
          </p>
        ) : null}
        <div>
          <select
            aria-label="Profil personnel de manette"
            value={profile}
            onChange={(e) => {
              setProfile(e.target.value);
              setDeleting(false);
            }}
          >
            <option value="">Choisir un profil…</option>
            {Object.keys(saved).map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
          <button
            type="button"
            className="n3-action"
            disabled={!profile}
            onClick={() => {
              try {
                const found = saved[profile];
                if (!found || !allowed.includes(found.kind))
                  throw new Error(
                    "Ce profil utilise un type de manette incompatible avec la configuration actuelle. Le type se choisit pendant la préparation du jeu.",
                  );
                input.applySetup(profile, found);
                onSelect(found.kind);
                setNotice(`Profil « ${profile} » chargé. Teste-le avant de confirmer.`);
              } catch (error) {
                setNotice((error as Error).message);
              }
            }}
          >
            Charger
          </button>
          <button
            type="button"
            className="n3-action"
            disabled={!profile}
            onClick={() => store(true)}
          >
            Mettre à jour
          </button>
          <button
            type="button"
            className="n3-action"
            disabled={!profile}
            onClick={() => {
              if (!deleting) return setDeleting(true);
              try {
                deleteSetup(profile);
                setProfile("");
                setDeleting(false);
                setNotice("Profil supprimé.");
              } catch {
                setNotice("Le navigateur n'a pas pu supprimer ce profil.");
              }
            }}
          >
            {deleting ? "Confirmer la suppression" : "Supprimer"}
          </button>
        </div>
        {gameKey ? (
          <div>
            <button
              type="button"
              className="n3-action"
              disabled={!profile || preferred === profile}
              onClick={() => preference(profile)}
            >
              Proposer ce profil pour ce jeu
            </button>
            {preferred ? (
              <button type="button" className="n3-action" onClick={() => preference(null)}>
                Retirer le choix pour ce jeu
              </button>
            ) : null}
          </div>
        ) : null}
        <div>
          <input
            aria-label="Nom du nouveau profil de manette"
            maxLength={40}
            placeholder="Ex. Mario Kart · ma DualSense"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="n3-action"
            disabled={!name.trim()}
            onClick={() => store(false)}
          >
            Enregistrer un nouveau profil
          </button>
        </div>
      </fieldset>
      {notice ? <p role="status">{notice}</p> : null}
    </details>
  );
}
