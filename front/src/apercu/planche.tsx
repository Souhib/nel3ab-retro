/**
 * La planche: toutes les poses de Bobine et ses scènes, rejouables à la main.
 *
 * Sert à regarder et à capturer, jamais livrée dans la page de la salle. Les
 * noms sont inventés.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Bobine, type Pose } from "../bobine/Bobine";
import { Chargement } from "../bobine/Chargement";
import type { Support } from "../bobine/support";
import { Places } from "../components/Places";

const POSES: { pose: Pose; tenue?: Parameters<typeof Bobine>[0]["tenue"]; legende: string }[] = [
  { pose: "repos", legende: "repos" },
  { pose: "marche", legende: "marche" },
  { pose: "porte", tenue: "fiche", legende: "apporte la fiche" },
  { pose: "pousse", legende: "enfonce" },
  { pose: "salue", legende: "salue" },
  { pose: "souffle", tenue: "cartouche", legende: "souffle dans la cartouche" },
  { pose: "essuie", tenue: "disque", legende: "essuie le disque" },
  { pose: "porte", tenue: "carte", legende: "apporte la carte" },
  { pose: "loupe", tenue: "loupe", legende: "regarde un fichier" },
  { pose: "salue", tenue: "tampon", legende: "tamponne" },
  { pose: "dort", legende: "s'endort" },
  { pose: "tire", legende: "débranche" },
];

const NOMS = ["Ami", "Bo", "Cléo", "Dami"];

function Rangee() {
  const [tenues, setTenues] = useState([false, false, false, false]);
  const [noms, setNoms] = useState(new Map<number, string>());
  const [mine, setMine] = useState<number | null>(null);
  const bascule = (port: number, nom: string) => {
    const suite = [...tenues];
    const n = new Map(noms);
    if (suite[port - 1]) {
      suite[port - 1] = false;
      n.delete(port);
    } else {
      suite[port - 1] = true;
      n.set(port, nom);
    }
    setTenues(suite);
    setNoms(n);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {NOMS.map((nom, i) => (
          <button
            key={nom}
            type="button"
            id={`bascule${i + 1}`}
            className="border border-rule px-2 py-1 text-note"
            onClick={() => bascule(i + 1, nom)}
          >
            {tenues[i] ? `${nom} part (P${i + 1})` : `${nom} se branche (P${i + 1})`}
          </button>
        ))}
        <button
          type="button"
          id="oublier"
          className="border border-rule px-2 py-1 text-note"
          onClick={() => {
            try {
              for (const k of Object.keys(localStorage))
                if (k.startsWith("n3-bobine-vus")) localStorage.removeItem(k);
            } catch {
              // rien à oublier
            }
            location.reload();
          }}
        >
          oublier qui on a vu
        </button>
        <button
          type="button"
          className="border border-rule px-2 py-1 text-note"
          onClick={() => setMine(mine === null ? 3 : null)}
        >
          {mine === null ? "je prends P3" : "je lâche P3"}
        </button>
      </div>
      <div id="colonne" className="w-[280px] border border-rule bg-panel p-4 pt-14">
        <p className="mb-2 text-note tracking-[0.2em] text-indigo">MANETTES</p>
        <Places
          forme="deux-rangees"
          entree={{
            places: 4,
            tenues: tenues,
            noms,
            micros: [false, false, false, false],
            chef: null,
            mienne: mine,
          }}
          onPrendre={(port) => bascule(port, NOMS[port - 1] ?? "?")}
          onCarte={() => {}}
        />
      </div>
    </div>
  );
}

function Planche() {
  return (
    <main className="min-h-screen bg-ink p-6 text-text">
      <h1 className="mb-1 text-lg">Bobine</h1>
      <p className="mb-6 text-note text-muted">
        Le machiniste de la salle. Chaque pose est une animation CSS, déclenchée par un attribut.
      </p>
      <section id="poses" className="mb-10 grid grid-cols-6 gap-6">
        {POSES.map(({ pose, tenue, legende }) => (
          <figure key={legende} className="flex flex-col items-center gap-2">
            <div className="flex h-24 items-end">
              <Bobine
                pose={pose}
                tenue={tenue}
                taille={84}
                cable={tenue === "fiche" ? "#4a86d9" : undefined}
              />
            </div>
            <figcaption className="text-note text-muted">{legende}</figcaption>
          </figure>
        ))}
      </section>
      <section id="chargements" className="mb-10">
        <h2 className="mb-3 text-base">Le chargement</h2>
        <div className="grid grid-cols-4 gap-6">
          {(["disque", "cartouche", "carte"] as Support[]).flatMap((support) =>
            (
              [
                ["asked", false, "prépare"],
                ["waiting", false, "insère"],
                ["painting", false, "ça tourne"],
                ["asked", true, "rien ne vient"],
              ] as const
            ).map(([etape, perdu, legende]) => (
              <figure key={`${support}${legende}`} className="flex flex-col items-start gap-1">
                <Chargement support={support} etape={etape} perdu={perdu} />
                <figcaption className="text-note text-muted">
                  {support} · {legende}
                </figcaption>
              </figure>
            )),
          )}
        </div>
      </section>
      <section id="branchement">
        <h2 className="mb-3 text-base">Le branchement</h2>
        <Rangee />
      </section>
    </main>
  );
}

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <Planche />
    </StrictMode>,
  );
