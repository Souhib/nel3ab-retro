/**
 * La fiche d'une décision : ce que le geste fait, les choix qu'il demande, le
 * bouton qui agit et celui qui revient. Elle sert au menu (lancer un jeu,
 * fermer le jeu, fermer la salle) et au rayonnage de l'écran éteint (la
 * fiche d'un jeu). La barre du bouton reste collée au bas de la zone qui
 * défile (M15).
 *
 * `base` préfixe ses identifiants : le menu et le rayonnage peuvent tenir
 * chacun une fiche ouverte en même temps, au bureau, et deux `#fiche` dans
 * une page en feraient une seule pour un lecteur d'écran et pour un pilote.
 */
import type { FicheDeLigne } from "../../lib/menu";
import { FICHE } from "../../lib/mots";
import { sonMenu } from "../../retro";

export function Fiche({
  titre,
  fiche,
  coche,
  onCocher,
  onRevenir,
  base = "fiche",
}: {
  titre: string;
  fiche: FicheDeLigne;
  coche: string | null;
  onCocher: (id: string) => void;
  onRevenir: () => void;
  base?: string;
}) {
  return (
    <div id={base} role="group" aria-labelledby={`${base}Titre`} className="n3-menu-fiche">
      <h3 id={`${base}Titre`} className="n3-menu-titre">
        {titre}
      </h3>
      {fiche.contenu}
      {fiche.choix ? (
        <fieldset
          id={`${base}Choix`}
          className="n3-menu-fiche-choix"
          disabled={fiche.refus !== undefined}
        >
          <legend className="n3-menu-titre">{FICHE.sauvegarde}</legend>
          {fiche.choix.map((c) => (
            <label key={c.id} className="n3-menu-pastille n3-menu-fiche-pastille">
              <input
                type="radio"
                name={`${base}-choix`}
                id={`${base}-${c.id}`}
                value={c.id}
                checked={coche === c.id}
                onChange={() => onCocher(c.id)}
              />
              <span className="n3-menu-point" aria-hidden="true" />
              <span className="flex flex-col">
                <span>{c.label}</span>
                {c.hint ? <span className="n3-menu-ligne-aide">{c.hint}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="n3-menu-fiche-barre" data-lancer={fiche.refus === undefined ? "" : undefined}>
        <p className="n3-menu-fiche-consequence">
          <strong>{fiche.refus ?? fiche.consequence}</strong>
        </p>
        <div className="n3-menu-fiche-boutons">
          {/* Qui ne choisit pas lit la fiche, sans bouton qui agit (B8) : un
              bouton grisé se lit comme une panne. */}
          {fiche.refus === undefined ? (
            <button
              type="button"
              id={`${base}Agir`}
              className="rt-boite rt-bouton rt-bouton-plein n3-menu-fiche-agir"
              onClick={() => {
                sonMenu("valider");
                fiche.onAgir(fiche.choix ? coche : null);
              }}
            >
              <i className="rt-ombre" aria-hidden="true" />
              {fiche.agir}
            </button>
          ) : null}
          <button
            type="button"
            id={`${base}Revenir`}
            className="rt-boite rt-bouton n3-menu-fiche-revenir"
            onClick={onRevenir}
          >
            <i className="rt-ombre" aria-hidden="true" />
            {fiche.annuler}
          </button>
        </div>
        {fiche.suite && fiche.refus === undefined ? (
          <p className="n3-menu-ligne-aide">{fiche.suite}</p>
        ) : null}
      </div>
    </div>
  );
}
