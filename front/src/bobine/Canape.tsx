/**
 * Le canapé des spectateurs: une tête ronde par personne qui regarde.
 *
 * Quelqu'un qui arrive en cours de route s'y laisse tomber, et le coussin
 * s'enfonce un instant. Ceux qui étaient déjà là quand la page s'ouvre sont
 * simplement assis: ouvrir la page n'est pas voir tout le monde arriver.
 *
 * Au-delà de cinq, le canapé est plein et un chiffre dit combien restent
 * debout. La liste nommée, juste en dessous, reste la référence.
 */
import { useEffect, useRef } from "react";

const PLACES = 5;

export function Canape({ noms }: { noms: readonly string[] }) {
  const deja = useRef<Set<string> | null>(null);
  if (deja.current === null) deja.current = new Set(noms);
  const assis = noms.slice(0, PLACES);
  const debout = noms.length - assis.length;
  // Retenus APRÈS l'affichage: le rendu reste pur, et un double rendu de
  // développement ne fait pas perdre son saut au nouveau venu.
  useEffect(() => {
    for (const nom of noms) deja.current?.add(nom);
  }, [noms]);
  return (
    <svg viewBox="0 0 132 46" className="n3-canape" aria-hidden="true">
      <rect x="4" y="16" width="124" height="18" rx="6" className="n3-canape-dossier" />
      {assis.map((nom, i) => {
        const nouveau = !deja.current?.has(nom);
        const x = 18 + i * 24;
        return (
          <g key={nom} className={nouveau ? "n3-tete n3-tete-arrive" : "n3-tete"}>
            <circle cx={x} cy="20" r="8.5" />
            <text x={x} y="23.5" textAnchor="middle">
              {nom.slice(0, 1).toUpperCase()}
            </text>
          </g>
        );
      })}
      <rect x="2" y="28" width="128" height="12" rx="5" className="n3-canape-assise" />
      <rect x="0" y="22" width="10" height="20" rx="4" className="n3-canape-accoudoir" />
      <rect x="122" y="22" width="10" height="20" rx="4" className="n3-canape-accoudoir" />
      <path d="M10 40 v4 M122 40 v4" className="n3-canape-pied" />
      {debout > 0 ? (
        <text x="126" y="12" textAnchor="end" className="n3-canape-debout">
          +{debout}
        </text>
      ) : null}
    </svg>
  );
}
