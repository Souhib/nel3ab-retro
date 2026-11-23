/**
 * « Ils regardent » : les personnes de la salle sans place, en étiquettes
 * tapées, comme sur les places START. Remplace la liste de noms de la colonne
 * (`Colonne.IlsRegardent`, monté par App jusqu'au câblage du chantier
 * personnes).
 *
 * Une personne dont la place n'est pas encore confirmée par le salon
 * (`seat_pending`) n'est pas un spectateur : elle arrive. La page le dit, avec
 * la seule action utile quand c'est soi-même sur un autre appareil. Avant le
 * 23 novembre 2026, la ligne disait « place à confirmer » puis une consigne
 * à part, adressée à personne (audit T14).
 */
import type { Person } from "../client";
import { COLONNE, REGARDENT } from "../lib/mots";
import { TitreColonne } from "./Colonne";
import { Crown } from "./Crown";
import { Etiquette } from "./Etiquette";
import "./places.css";

export function IlsRegardent({ people, owner }: { people: Person[]; owner?: Person | null }) {
  const regardent = people.filter((p) => p.seat == null && p.seat_pending === false);
  const arrivent = people.filter((p) => p.seat == null && p.seat_pending !== false);
  const couronne = (p: Person) => (owner?.id && owner.id === p.id ? <Crown /> : null);
  return (
    <section aria-labelledby="ilsRegardent" className="flex flex-col gap-1.5">
      <TitreColonne id="ilsRegardent">
        {COLONNE.regardent} · {regardent.length}
      </TitreColonne>
      {regardent.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {regardent.map((p) => (
            <li key={p.id ?? p.name} className="flex min-w-0 items-center gap-1">
              <Etiquette nom={p.name} />
              {couronne(p)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-corps text-faint">{COLONNE.personne}</p>
      )}
      {arrivent.map((p) => (
        <p key={p.id ?? p.name} className="flex flex-col items-start gap-1 text-corps text-muted">
          <span className="flex items-center gap-1">
            <Etiquette nom={p.name} />
            {couronne(p)}
          </span>
          {REGARDENT.arrive(p.name)}
        </p>
      ))}
    </section>
  );
}
