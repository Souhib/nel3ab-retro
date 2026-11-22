// Le banc des états de la salle: la page COMMITTÉE, un salon et une salle
// SIMULÉS, sur un seul port de 5400 à 5499. Aucune salle ni aucun salon vivant
// n'est touché, aucun émulateur ne tourne.
//
// Écrit pour le chantier « états » du 22 novembre 2026 (l'image figée du
// 21 novembre), et repris de l'audit des états. Le flux vidéo est un vrai flux
// H.264 que la recette fabrique avec ffmpeg (`just etats-navigateur`), découpé
// ici en unités d'accès comme la salle les envoie: huit octets d'instant de
// capture, puis l'unité en Annex B. Le gel se simule comme le worker le
// produit: des messages VIDES toutes les 500 ms (`KEEP_ALIVE`), aucune image.
//
// Ce que le banc ne simule pas, et qu'il faut garder en tête en lisant ses
// verdicts: un vrai Wi-Fi qui perd des paquets, un relais Tailscale, les pauses
// réelles d'un émulateur. Les durées sont celles d'une machine locale.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
import { WebSocketServer } from "ws";

/** Les unités d'accès d'un flux Annex B dont chaque image commence par un
 * délimiteur (NAL 9), comme `-x264-params aud=1` les écrit. */
export function unitesDe(flux) {
  const debuts = [];
  for (let i = 0; i + 4 < flux.length; i++)
    if (flux[i] === 0 && flux[i + 1] === 0 && flux[i + 2] === 0 && flux[i + 3] === 1 && (flux[i + 4] & 31) === 9)
      debuts.push(i);
  if (debuts.length < 2) throw new Error("flux sans délimiteurs d'image: ffmpeg doit écrire aud=1");
  return debuts.map((debut, k) => flux.subarray(debut, debuts[k + 1] ?? flux.length));
}

/** L'état de départ: une salle qui joue, un salon qui répond. */
const DEPART = {
  // live | freeze (messages vides) | silent (rien, socket ouverte) | slow
  // (un tic sur `skip` sauté) | drop (connexion refusée)
  video: "live",
  skip: 4,
  // live | off. En `silent`, le son et l'écho se taisent aussi: une liaison
  // qui cale ne porte plus rien.
  sound: "live",
  // up | hang (ne répond jamais) | 502 (le relais, salon arrêté)
  salles: "up",
  ouverte: true,
  redemarre: false,
  game: true,
  // La console du jeu en cours: x360 (la manette Pro) ou gc (Dolphin). Ajouté
  // pour le banc du focus, qui doit lire START dans les deux trames.
  console: "x360",
  // La trame que la salle demande: « dolphin » (13 octets) par défaut, ou
  // « switch » (15 octets), que le worker annonce par « format switch ».
  format: "dolphin",
  // L'appareil que la place présente à un jeu Wii (« pad N », comme le
  // worker): 0 GameCube, 1 Wiimote et Nunchuk, 2 guitare, 3 Wiimote seule.
  // Nul: rien d'annoncé. Ajouté pour la carte des touches d'une salle Wii.
  appareil: null,
};

export async function demarrerBanc({ port, page, flux }) {
  if (!(port >= 5400 && port <= 5499)) throw new Error(`port ${port} hors de la plage du banc`);
  const PAGE = readFileSync(page);
  const BR = brotliCompressSync(PAGE);
  const empreinte = createHash("sha256").update(PAGE).digest("hex");
  const AUS = unitesDe(readFileSync(flux));
  const state = { ...DEPART };
  const log = [];
  /** Les changements de boutons reçus sur `/input` (voir `input`). */
  const trames = [];
  const videos = new Set();
  const sounds = new Set();
  const inputs = new Set();
  const lobbies = new Set();
  const note = (texte) => log.push({ a: Date.now(), texte });

  const LIBRARY = [
    { index: 0, name: "Jeu du banc", console: "x360", art: false },
    { index: 1, name: "Autre jeu du banc", console: "gc", art: false },
    { index: 2, name: "Jeu Wii du banc", console: "wii", art: false },
  ];
  const room = () => ({
    name: "Salle 1",
    game: state.game ? (LIBRARY.find((one) => one.console === state.console) ?? LIBRARY[0]) : null,
    library: LIBRARY,
    seats: [
      { port: 1, player: "banc", held: true },
      { port: 2, player: null, held: false },
      { port: 3, player: null, held: false },
      { port: 4, player: null, held: false },
    ],
    owner: { name: "banc", id: "a", moi: true, seat: 1 },
    people: [{ name: "banc", id: "a", moi: true, seat: 1 }],
    ask_lasts: 10,
    media_url: "",
  });

  const json = (res, body, status = 200) => {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      "content-type": "application/json",
      "content-length": data.length,
      "cache-control": "no-store",
    });
    res.end(data);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = url.pathname;
    if (path.startsWith("/api/")) {
      if (path === "/api/salles") {
        note(`salles ${state.salles}`);
        if (state.salles === "hang") return; // ne répond jamais
        if (state.salles === "502") {
          res.writeHead(502, { "content-type": "text/plain" });
          return res.end("502 Bad Gateway");
        }
        return json(res, [
          {
            numero: 1,
            ouverte: state.ouverte,
            redemarre: state.redemarre,
            chemin: "/r/1/",
            jeu: state.game ? room().game.name : null,
          },
        ]);
      }
      if (path === "/api/me") return json(res, { name: "banc", login: "banc@exemple.invalid", publishes: false });
      if (path === "/api/room") return json(res, room());
      if (path === "/api/room/bindings") return json(res, { pads: {}, keys: {} });
      if (path === "/api/me/bindings") return json(res, { pads: {}, keys: {}, setups: {} });
      if (path === "/api/me/connection") return json(res, { kind: "direct" });
      return json(res, { detail: "inconnu" }, 404);
    }
    if (path === "/r/1/formats") return json(res, { half: true });
    if (path === "/r/1/saves") return json(res, [true, true, true, true]);
    if (path === "/r/1") {
      res.writeHead(301, { location: "/r/1/" });
      return res.end();
    }
    if (path === "/r/1/" || path === "/") {
      const br = String(req.headers["accept-encoding"] || "").includes("br");
      const headers = {
        "content-type": "text/html; charset=utf-8",
        "content-length": (br ? BR : PAGE).length,
        "cache-control": "no-cache",
      };
      if (br) headers["content-encoding"] = "br";
      res.writeHead(200, headers);
      return res.end(br ? BR : PAGE);
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("absent");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const media = ["/r/1/video", "/r/1/sound", "/r/1/input"].includes(url.pathname);
    if (media && state.video === "drop") {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => {});
      if (url.pathname === "/r/1/video") return video(ws);
      if (url.pathname === "/r/1/sound") return sound(ws);
      if (url.pathname === "/r/1/input") return input(ws);
      if (url.pathname === "/socket.io/") return lobby(ws);
    });
  });

  function video(ws) {
    videos.add(ws);
    let at = 0;
    let sentAt = Date.now();
    const t0 = Date.now();
    let dernierTic = -1;
    ws.on("message", (m) => {
      // Une image-clé demandée: on saute à la prochaine du flux.
      if (m.length === 1 && m[0] === 1) at = (Math.ceil(at / 60) * 60) % AUS.length;
    });
    const envoyer = (tic) => {
      const header = Buffer.alloc(8);
      // Des instants de capture alignés sur les tics de 16,667 ms d'un
      // compositeur, comme sous Sway: c'est ce qui rend la cadence médiane
      // lue par la page fausse pour un jeu sous 60 images par seconde. Le tic
      // vient de l'HORLOGE, pas d'un compteur: `setInterval` tire toutes les
      // 17 ms environ, et des instants comptés au tir dérivaient de 2 % sur
      // le temps réel. L'horaire de la page cessait alors de peindre deux
      // secondes au bout de six, sur l'ancienne page comme sur la nouvelle
      // (mesuré le 22 novembre 2026): un défaut du banc, pas de la page.
      header.writeBigUInt64LE(BigInt(Math.round(tic * 16666.667) + 1_000_000));
      ws.send(Buffer.concat([header, AUS[at]]));
      at = (at + 1) % AUS.length;
      sentAt = Date.now();
    };
    const timer = setInterval(() => {
      if (ws.readyState !== 1) return;
      const tic = Math.floor((Date.now() - t0) / (1000 / 60));
      if (tic === dernierTic) return;
      dernierTic = tic;
      if (state.video === "live") return envoyer(tic);
      if (state.video === "slow") {
        if (tic % state.skip !== 0) envoyer(tic);
        return;
      }
      // Comme le worker pendant le gel du 21 novembre: un message vide toutes
      // les 500 ms, aucune image. « silent » n'envoie rien du tout.
      if (state.video === "freeze" && Date.now() - sentAt >= 500) {
        ws.send(Buffer.alloc(0));
        sentAt = Date.now();
      }
    }, 4);
    ws.on("close", () => {
      clearInterval(timer);
      videos.delete(ws);
    });
  }

  // Vingt millisecondes de silence stéréo à 48 kHz, derrière l'en-tête de huit
  // octets que la salle met devant chaque morceau.
  function sound(ws) {
    sounds.add(ws);
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (ws.readyState !== 1 || state.sound !== "live" || state.video === "silent") return;
      const header = Buffer.alloc(8);
      header.writeBigUInt64LE(BigInt((Date.now() - t0) * 1000 + 1_000_000));
      ws.send(Buffer.concat([header, Buffer.alloc(960 * 2 * 2)]));
    }, 20);
    ws.on("close", () => {
      clearInterval(timer);
      sounds.delete(ws);
    });
  }

  // La manette: un message de salle (quatre places, la 1 est à nous) puis
  // l'écho de chaque aller-retour, comme le worker.
  function input(ws) {
    inputs.add(ws);
    if (state.format === "switch") ws.send("format switch");
    if (state.appareil !== null) ws.send(`pad ${state.appareil}`);
    ws.send(Buffer.from([4, 1, 1, 0, 1, 0, 0, 0, 0]));
    let avant = null;
    ws.on("message", (m) => {
      const bytes = Buffer.from(m);
      if (bytes.length === 9 && bytes[0] === 0xe0 && state.video !== "silent") ws.send(bytes);
      // Les boutons de chaque trame de manette, notés quand ils CHANGENT: la
      // boucle envoie toutes les 4 ms, et un relevé complet ne dirait rien de
      // plus. 13 octets pour Dolphin (seize bits en tête), 15 pour la trame
      // Switch (« S », version, place, puis trente-deux bits).
      // Le stick gauche horizontal avec, pour qu'une flèche se voie aussi.
      const lu =
        bytes.length === 13
          ? { trame: "dolphin", boutons: bytes.readUInt16LE(0), x: bytes.readInt16LE(3) }
          : bytes.length === 15 && bytes[0] === 0x53
            ? { trame: "switch", boutons: bytes.readUInt32LE(3), x: bytes.readInt16LE(7) }
            : null;
      const signe = lu ? `${lu.trame}:${lu.boutons}:${lu.x}` : null;
      if (lu && signe !== avant) {
        avant = signe;
        trames.push({ a: Date.now(), ...lu });
      }
    });
    ws.on("close", () => inputs.delete(ws));
  }

  // Le salon, en engine.io 4 minimal: la poignée de main, la salle, les accusés.
  function lobby(ws) {
    lobbies.add(ws);
    ws.send(
      "0" +
        JSON.stringify({ sid: `s${Math.random()}`, upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1e6 }),
    );
    const ping = setInterval(() => ws.readyState === 1 && ws.send("2"), 25000);
    ws.on("message", (m) => {
      const text = String(m);
      if (text.startsWith("42") && !text.includes('"seat"')) note(`salon ${text.slice(0, 300)}`);
      if (text.startsWith("40")) {
        ws.send(`40{"sid":"n${Math.random()}"}`);
        ws.send(`42["room",${JSON.stringify(room())}]`);
      }
      const ack = /^42(\d+)\[/.exec(text);
      if (ack) ws.send(`43${ack[1]}[{"ok":true,"port":null,"claim":null}]`);
    });
    ws.on("close", () => {
      clearInterval(ping);
      lobbies.delete(ws);
    });
  }

  await new Promise((pret) => server.listen(port, "127.0.0.1", pret));
  return {
    url: `http://127.0.0.1:${port}/r/1/`,
    empreinte,
    /** Change l'état simulé. `drop` coupe aussi les sockets en cours. */
    regler(changes) {
      Object.assign(state, changes);
      if (changes.video === "drop") for (const ws of [...videos, ...sounds, ...inputs]) ws.terminate();
      note(`réglage ${JSON.stringify(changes)}`);
    },
    reinitialiser() {
      Object.assign(state, DEPART);
      for (const ws of [...videos, ...sounds, ...inputs, ...lobbies]) ws.terminate();
    },
    /** Un démarrage annoncé par le salon, comme quand quelqu'un change de jeu. */
    annoncerDemarrage() {
      for (const ws of lobbies)
        ws.send(`42["booting",${JSON.stringify({ game: "Autre jeu du banc", save: "nouvelle partie" })}]`);
    },
    journal: (depuis = 0) => log.filter((ligne) => ligne.a >= depuis),
    /** Les boutons reçus depuis `depuis`, dans l'ordre d'arrivée. */
    trames: (depuis = 0) => trames.filter((une) => une.a >= depuis),
    fermer: () =>
      new Promise((fini) => {
        for (const ws of [...videos, ...sounds, ...inputs, ...lobbies]) ws.terminate();
        server.close(() => fini());
      }),
  };
}
