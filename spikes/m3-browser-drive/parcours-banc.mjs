// Le banc des parcours de la salle: la page COMMITTÉE, un salon et une salle
// SIMULÉS sur un seul port de 5400 à 5499. Aucune salle ni aucun salon vivant
// n'est touché, aucun émulateur ne tourne.
//
// Écrit après la relecture du chantier « parcours et mots » (22 novembre
// 2026): cinq mutants d'`App.tsx` (l'entrée lue dans l'adresse, l'adresse
// réécrite, le lien d'invitation, la sortie, la fermeture de la salle)
// laissaient les 1 105 essais verts. Les quatorze parcours de l'auteur vivaient
// dans son dossier de captures, pas dans le dépôt. Ce banc les y met.
//
// Il reprend `etats-banc.mjs` (même flux H.264, même salon engine.io minimal)
// et y ajoute ce que les parcours demandent: des places qu'une socket d'entrée
// PREND et REND comme le worker (la première libre), un chef réglable, une
// préparation, les annonces de démarrage, `DELETE /api/salles/1`, et une
// racine qui tient lieu d'accueil des salles.
//
// Ce qu'il ne simule pas: le worker qui tranche qui peut changer de jeu (le
// banc le dit par l'octet `deciding`, réglé à la main), un vrai salon qui
// relie les préparations aux places, un vrai téléphone.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import { unitesDe } from "./etats-banc.mjs";

/** L'attribution que le banc donne à chaque socket d'entrée: celle de la page. */
export const MOI = "0123456789abcdef0123456789abcdef-1";
/** Celle de Bo, l'autre joueur que le banc fait asseoir quand on le lui demande. */
export const BO = "fedcba9876543210fedcba9876543210-2";

export const BIBLIOTHEQUE = [
  { index: 0, key: "mp4.iso", name: "Mario Party 4", console: "gc", art: false },
  { index: 1, key: "sonic.iso", name: "Sonic Generations", console: "x360", art: false },
  { index: 2, key: "mkw.rvz", name: "Mario Kart Wii", console: "wii", art: false },
];

const DEPART = {
  /** Le jeu en cours, par son index dans la bibliothèque, ou `null`. */
  jeu: 0,
  /** Qui est chef: « moi », « bo », ou `null` pour une salle sans chef. */
  chef: "moi",
  /** Bo est-il assis à la place 2 ? */
  bo: false,
  /** L'octet `deciding` que le worker enverrait: cette place peut-elle
   * changer de jeu ? Vrai pour le chef, et pour tous quand le chef ne joue plus. */
  decide: true,
  /** La préparation que le salon annonce, ou `null`. */
  preparation: null,
  /** D'autres personnes de la salle, telles que le salon les dit
   * (`{ name, id, moi: false, seat, seat_pending }`). */
  autres: [],
  /** Ce que Bo répond à une reprise de sa place : « garde », « donne », ou
   * `null` pour ne pas répondre. */
  boRepond: null,
  /** L'image s'arrête : la salle n'envoie plus d'image, la socket reste. */
  fige: false,
};

export async function demarrerParcours({ port, page, flux }) {
  if (!(port >= 5400 && port <= 5499)) throw new Error(`port ${port} hors de la plage du banc`);
  const PAGE = readFileSync(page);
  const empreinte = createHash("sha256").update(PAGE).digest("hex");
  const AUS = unitesDe(readFileSync(flux));
  const state = { ...DEPART };
  /** Les places, comme le worker les tient: 1 à 4, la socket qui la tient. */
  const places = new Map();
  const inputs = new Set();
  const lobbies = new Set();
  const videos = new Set();
  /** `droite` compte les trames de manette (13 octets, `encodePad`) dont le
   * stick x pousse à droite : une flèche arrivée au jeu. */
  const journal = { entrees: 0, suppressions: [], evenements: [], droite: 0 };

  const base = `http://127.0.0.1:${port}`;
  const tenues = () => {
    const prises = new Set([...places.keys()]);
    if (state.bo) prises.add(2);
    return prises;
  };
  const room = () => {
    const prises = tenues();
    const moi = [...places.keys()][0] ?? null;
    const siege = (n) => {
      if (state.bo && n === 2) return { port: 2, player: "Bo", held: true, claim: BO };
      if (places.has(n)) return { port: n, player: "Ami", held: true, claim: MOI };
      return { port: n, player: null, held: prises.has(n), claim: null };
    };
    const owner =
      state.chef === "moi"
        ? { name: "Ami", id: "a", moi: true, seat: moi }
        : state.chef === "bo"
          ? { name: "Bo", id: "b", moi: false, seat: state.bo ? 2 : null }
          : null;
    return {
      name: "salle 1",
      game: state.jeu === null ? null : BIBLIOTHEQUE[state.jeu],
      library: BIBLIOTHEQUE,
      seats: [1, 2, 3, 4].map(siege),
      owner,
      // `seat_pending` faux : le salon a fini de placer ces personnes. Le
      // banc l'omettait, et le schéma du salon lit un champ absent comme
      // « place à confirmer » (24 novembre 2026).
      people: [
        { name: "Ami", id: "a", moi: true, seat: moi, seat_pending: false },
        ...(state.bo ? [{ name: "Bo", id: "b", moi: false, seat: 2, seat_pending: false }] : []),
        ...state.autres,
      ],
      ask_lasts: 10,
      media_url: "",
      preparation: state.preparation,
    };
  };

  const json = (res, body, status = 200) => {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": data.length,
      "cache-control": "no-store",
    });
    res.end(data);
  };
  const html = (res, corps) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
    res.end(corps);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, base);
    const path = url.pathname;
    if (path === "/api/salles/1" && req.method === "DELETE") {
      journal.suppressions.push(Date.now());
      res.writeHead(204);
      return res.end();
    }
    if (path === "/api/salles")
      return json(res, [
        { numero: 1, ouverte: true, redemarre: false, chemin: "/r/1/", jeu: room().game?.name ?? null },
      ]);
    if (path === "/api/me") return json(res, { name: "Ami", login: "ami@exemple.invalid", publishes: false });
    if (path === "/api/room") return json(res, room());
    if (path === "/api/room/bindings") return json(res, { pads: {}, keys: {} });
    if (path === "/api/me/bindings") return json(res, { pads: {}, keys: {}, setups: {} });
    if (path === "/api/me/connection") return json(res, { kind: "direct" });
    if (path.startsWith("/api/")) return json(res, { detail: "inconnu" }, 404);
    if (path === "/r/1/formats") return json(res, { half: true });
    if (path === "/r/1/saves") return json(res, [true, true, true, true]);
    if (path === "/r/1") {
      res.writeHead(301, { location: "/r/1/" });
      return res.end();
    }
    if (path === "/r/1/") return html(res, PAGE);
    // L'accueil des salles, réduit à ce qu'un pilote lit: on y est arrivé.
    if (path === "/") return html(res, '<!doctype html><meta charset="utf-8"><title>accueil du banc</title><p id="accueil-du-banc">les salles</p>');
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("absent");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, base);
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => {});
      if (url.pathname === "/r/1/video") return video(ws);
      if (url.pathname === "/r/1/sound") return ws.close();
      if (url.pathname === "/r/1/input") return input(ws);
      if (url.pathname === "/socket.io/") return lobby(ws);
      ws.close();
    });
  });

  function video(ws) {
    videos.add(ws);
    let at = 0;
    const t0 = Date.now();
    let dernierTic = -1;
    const timer = setInterval(() => {
      if (ws.readyState !== 1 || state.fige) return;
      const tic = Math.floor((Date.now() - t0) / (1000 / 60));
      if (tic === dernierTic) return;
      dernierTic = tic;
      const header = Buffer.alloc(8);
      header.writeBigUInt64LE(BigInt(Math.round(tic * 16666.667) + 1_000_000));
      ws.send(Buffer.concat([header, AUS[at]]));
      at = (at + 1) % AUS.length;
    }, 4);
    ws.on("close", () => {
      clearInterval(timer);
      videos.delete(ws);
    });
  }

  /** Une socket d'entrée prend la première place libre, comme le worker, et la
   * rend en se fermant. Le message de salle dit la place et les places tenues. */
  function input(ws) {
    journal.entrees += 1;
    inputs.add(ws);
    const prises = tenues();
    const libre = [1, 2, 3, 4].find((n) => !prises.has(n)) ?? 0;
    if (libre) places.set(libre, ws);
    const jeu = state.jeu === null ? null : BIBLIOTHEQUE[state.jeu];
    if (jeu && ["switch", "switch2", "x360"].includes(jeu.console)) ws.send("format switch");
    const occupe = tenues();
    ws.send(
      Buffer.from([4, libre, libre && state.decide ? 1 : 0, 0, ...[1, 2, 3, 4].map((n) => (occupe.has(n) ? 1 : 0)), 0]),
    );
    ws.send(`seat ${MOI}`);
    ws.on("message", (m) => {
      const b = Buffer.from(m);
      if (b.length === 9 && b[0] === 0xe0) ws.send(b);
      if (b.length === 13 && b.readInt16LE(3) > 0) journal.droite += 1;
    });
    ws.on("close", () => {
      inputs.delete(ws);
      for (const [n, tenue] of places) if (tenue === ws) places.delete(n);
      pousser();
    });
    pousser();
  }

  function lobby(ws) {
    lobbies.add(ws);
    ws.send(
      "0" + JSON.stringify({ sid: `s${Math.random()}`, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1e6 }),
    );
    const ping = setInterval(() => ws.readyState === 1 && ws.send("2"), 25000);
    ws.on("message", (m) => {
      const text = String(m);
      if (text.startsWith("40")) {
        ws.send(`40{"sid":"n${Math.random()}"}`);
        ws.send(`42["room",${JSON.stringify(room())}]`);
      }
      const ack = /^42(\d+)(\[[\s\S]*\])$/.exec(text);
      if (ack) {
        let quoi = null;
        try {
          quoi = JSON.parse(ack[2]);
          journal.evenements.push({ a: Date.now(), quoi });
        } catch {
          // Une trame illisible n'est pas un geste de la page.
        }
        ws.send(`43${ack[1]}[{"ok":true,"port":null,"claim":null}]`);
        if (Array.isArray(quoi) && quoi[0] === "recover") reprise(ws, quoi[1]);
      }
    });
    ws.on("close", () => {
      clearInterval(ping);
      lobbies.delete(ws);
    });
  }

  /** La reprise d'une place, comme `api/ws/recovery.py` la dit à qui
   * demande : la place, les deux noms, 20 s pour répondre (`ANSWER_WITHIN`),
   * puis « Demande annulée. » à l'annulation. Bo répond quand `boRepond` le
   * dit, 300 ms après : « garde » envoie la raison du refus, « donne » un
   * reste à 0 sans raison avec `accepted`, comme le salon depuis le
   * 24 novembre 2026. */
  function reprise(ws, demande) {
    if (demande === null || typeof demande !== "object") return;
    const avis = (champs) =>
      ws.send(
        `42["recovery",${JSON.stringify({ id: "banc-reprise", from: "Ami", to: "Bo", asking: true, accepted: false, ...champs })}]`,
      );
    if (demande.action === "begin" && demande.port === 2 && state.bo) {
      avis({ port: 2, remaining: 20, reason: null });
      if (state.boRepond === "garde")
        setTimeout(() => avis({ port: 2, remaining: 0, reason: "Bo garde sa place 2." }), 300);
      else if (state.boRepond === "donne")
        setTimeout(() => avis({ port: 2, remaining: 0, reason: null, accepted: true }), 300);
    } else if (demande.action === "cancel" && demande.id === "banc-reprise")
      avis({ port: 2, remaining: 0, reason: "Demande annulée." });
  }

  function pousser() {
    for (const ws of lobbies) if (ws.readyState === 1) ws.send(`42["room",${JSON.stringify(room())}]`);
  }

  await new Promise((pret) => server.listen(port, "127.0.0.1", pret));
  return {
    base,
    url: `${base}/r/1/`,
    empreinte,
    journal,
    /** Change la salle simulée, puis l'annonce aux pages ouvertes. */
    regler(changes) {
      Object.assign(state, changes);
      pousser();
    },
    reinitialiser() {
      Object.assign(state, DEPART);
      for (const ws of [...inputs, ...lobbies, ...videos]) ws.terminate();
      places.clear();
      journal.entrees = 0;
      journal.droite = 0;
      journal.suppressions.length = 0;
      journal.evenements.length = 0;
    },
    /** Un avis de reprise tel que le salon l'envoie à la page, pour la voir
     * du côté de qui tient la place (`asking` faux). */
    avisDeReprise(avis) {
      for (const ws of lobbies) ws.send(`42["recovery",${JSON.stringify(avis)}]`);
    },
    /** Un démarrage annoncé par le salon, comme après un lancement. */
    annoncer(booting) {
      for (const ws of lobbies) ws.send(`42["booting",${JSON.stringify(booting)}]`);
    },
    fermer: () =>
      new Promise((fini) => {
        for (const ws of [...inputs, ...lobbies, ...videos]) ws.terminate();
        server.close(() => fini());
      }),
  };
}
