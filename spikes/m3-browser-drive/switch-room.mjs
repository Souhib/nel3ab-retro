/** Une vraie salle temporaire : page, salon, worker, Dolphin, Switch et GPU.
 * `just switch-room-test '/chemin/Mario Tennis Aces.xci'` construit le binaire de
 * développement. Aucun service installé n'est arrêté. Le jeu, ses sauvegardes,
 * les identités et les ports de cet essai sont indépendants de la salle.
 * Les assertions portent sur le parcours de préparation et de reconnexion.
 * Reconnaître les manettes dans les menus du JEU reste une observation humaine.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp, access } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { promisify } from "node:util";
import puppeteer from "puppeteer";
import { limitedLink } from "./limited-link.mjs";
import { seedName, enterRoom, watchRoom } from "./open.mjs";

const execute = promisify(execFile);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// L'artefact précédant les reçus est conservé dans Git, pas recopié dans une
// fixture qu'un prochain build pourrait actualiser sans le vouloir.
const network = process.env.NEL3AB_TEST_NETWORK === "1";
let link;
const churn = process.env.NEL3AB_TEST_CHURN === "1";
const resilience = process.env.NEL3AB_TEST_RESILIENCE === "1";
const closing = true;
const recovery = process.env.NEL3AB_TEST_RECOVERY === "1";
const plannedStops = new Set();
const migration = process.env.NEL3AB_TEST_LEGACY_PAGE === "1";
const oldPage = migration ? (await execute("git", ["show",
  "16eebcb144e487c6f5cb00fa2de4569962980d8b:core/crates/worker/src/page/index.html"],
  { cwd: repo, maxBuffer: 2_000_000 })).stdout : null;
if (migration) assert.ok(oldPage && !oldPage.includes("identity=1"));
assert.ok(process.argv[2], "Indiquer le disque Mario Tennis Aces à tester.");
const rom = await realpath(process.argv[2]);
assert.match(basename(rom), /\.xci$/i);
const gcRom = closing && process.env.NEL3AB_TEST_GC_ROM ? await realpath(process.env.NEL3AB_TEST_GC_ROM) : null;
const root = await mkdtemp(join(tmpdir(), "nel3ab-preparation-"));
const container = basename(root);
const reservations = [];
for (let i = 0; i < 5; i++) {
  const server = createServer();
  await new Promise((yes, no) => server.once("error", no).listen(0, "127.0.0.1", yes));
  reservations.push(server);
}
const [door, media, control, lobby, narrow] = reservations.map((s) => s.address().port);
const url = `http://localhost:${door}/`;
const env = {
  ...process.env,
  NEL3AB_CONTAINER: container,
  NEL3AB_ROM: rom,
  NEL3AB_ROM_DIR: `${dirname(rom)}:${homedir()}/roms/gc:${homedir()}/roms/wii`,
  NEL3AB_SWITCH_CONFIG: join(root, "switch-config.json"),
  NEL3AB_DOLPHIN: join(repo, "docker/dolphin-in-docker.sh"),
  NEL3AB_SESSION_DIR: join(root, "session"),
  NEL3AB_ART_DIR: join(root, "art"),
  NEL3AB_BIND: `127.0.0.1:${media}`,
  NEL3AB_CONTROL_BIND: `127.0.0.1:${control}`,
  NEL3AB_WORKER_URL: `http://127.0.0.1:${media}`,
  NEL3AB_WORKER_CONTROL: `127.0.0.1:${control}`,
  NEL3AB_WORKER_PUBLIC_URL: "",
  NEL3AB_STATE_FILE: join(root, "people.json"),
  NEL3AB_BINDINGS_FILE: join(root, "bindings.json"),
  NEL3AB_ROOM_BINDINGS_FILE: join(root, "room-bindings.json"),
  NEL3AB_JOURNAL_DIR: join(root, "journal"),
  NEL3AB_ADMIN: "",
  NEL3AB_ROOM_NAME: "Essai isolé",
  NEL3AB_ORIGINS: JSON.stringify([new URL(url).origin, `http://localhost:${narrow}`]),
  NEL3AB_INTERNAL_RES: "2",
  NEL3AB_PLAYERS: "4",
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
};
const children = [];
const logs = [];
let generation = 0;
let stopping = false;
let workerFailure = null;
let activeWorker;
const exits = [];
let browser;
const interrupted = () => {
  workerFailure = new Error("Essai interrompu, arrêt de la salle temporaire.");
  void browser?.close();
};
process.once("SIGINT", interrupted);
process.once("SIGTERM", interrupted);
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (predicate, message, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (workerFailure) throw workerFailure;
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
};
const start = (command, args, name, cwd = repo) => {
  const log = createWriteStream(join(root, `${name}.log`), { flags: "a" });
  logs.push(log);
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (error) => { workerFailure = error; });
  children.push(child);
  return child;
};
const boot = () => {
  generation++;
  const worker = start(join(repo, "core/target/debug/nel3ab-worker"), [], "worker");
  activeWorker = worker;
  worker.on("exit", (code, signal) => {
    exits.push({ pid: worker.pid, code, signal, at: Date.now() });
    if (stopping) return;
    if ((code !== 0 && !plannedStops.delete(worker.pid)) || generation >= 20) {
      workerFailure = new Error(`Worker arrêté (${code}), voir ${root}/worker.log`);
      return;
    }
    setTimeout(() => { if (!stopping) boot(); }, 1000);
  });
};
const room = async () => (await fetch(new URL("/api/room", url))).json();
const button = (page, text) => page.evaluate((label) => {
  const node = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === label);
  if (!node || node.disabled) throw new Error(`Commande indisponible : ${label}`);
  node.click();
}, text);
const open = async (name, play, legacy = false, address = url, half = false) => {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => { workerFailure = error; console.error(name, error); });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setExtraHTTPHeaders({
    "Tailscale-User-Login": `${name.toLowerCase()}@example.test`,
    "Tailscale-User-Name": name,
  });
  await seedName(page, name);
  if (half) await page.evaluateOnNewDocument(() => localStorage.setItem("nel3ab:half", "1"));
  await page.evaluateOnNewDocument(() => {
    window.testPad = {
      id: "Xbox 360 Controller (STANDARD GAMEPAD)", index: 0, mapping: "standard",
      connected: true, timestamp: 1, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    navigator.getGamepads = () => { const pads = Array(window.testPad ? window.testPad.index + 1 : 0).fill(null); if (window.testPad) pads[window.testPad.index] = window.testPad; return pads; };
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(window.testOffline ? new URL("/__offline_test__", String(args[0])).href : args[0], ...args.slice(1));
        (window.testSockets ??= []).push(this);
        if (new URL(String(args[0])).pathname === "/input") {
          window.inputSocket = this;
          (window.inputUrls ??= []).push(String(args[0]));
          this.addEventListener("message", (event) => {
            if (typeof event.data === "string" && event.data.startsWith("pad "))
              window.actualDevice = Number(event.data.slice(4));
          });
        }
      }
    };
  });
  await page.goto(legacy ? new URL("legacy.html", url).href : address);
  await (play ? enterRoom(page) : watchRoom(page));
  try {
    if (closing && (await room()).game === null) {
      await page.waitForFunction(() => document.body.textContent.includes("aucun jeu · choisis un jeu"));
    } else await page.waitForFunction(() => nel3abTest.counters().painted > 10, { timeout: 60000 });
  } catch (error) {
    await page.screenshot({ path: join(root, `${name}-sans-image.png`) });
    console.error(await page.evaluate(() => ({
      text: document.body.innerText,
      inputs: window.inputUrls,
      counters: globalThis.nel3abTest?.counters(),
    })));
    throw workerFailure ?? error;
  }
  return page;
};

try {
  await mkdir(env.NEL3AB_SESSION_DIR);
  await writeFile(join(env.NEL3AB_SESSION_DIR,"game-closed"),"");
  const config = JSON.parse(await readFile(process.env.NEL3AB_TEST_SWITCH_CONFIG,"utf8"));
  config.state = join(root,"switch-saves");
  await writeFile(env.NEL3AB_SWITCH_CONFIG,JSON.stringify(config));
  if(process.env.NEL3AB_TEST_SWITCH_SAVE) {
    for(const action of ["prepare", "import"]) await execute("python3",[join(repo,"docker/switch-saves.py"),env.NEL3AB_SWITCH_CONFIG,"0100bde00862a000","debloquee",action,...(action === "import" ? [process.env.NEL3AB_TEST_SWITCH_SAVE] : [])]);
  }
  if (network && process.env.NEL3AB_TEST_SEED_SAVES) {
    await cp(await realpath(process.env.NEL3AB_TEST_SEED_SAVES), join(env.NEL3AB_SESSION_DIR, "saves"), { recursive: true });
  }
  if (oldPage !== null) await writeFile(join(root, "legacy.html"), oldPage);
  // Le cache est une copie. Le test ne remplit ni ne modifie celui du service.
  await cp(join(homedir(), ".cache/nel3ab/banners"), env.NEL3AB_ART_DIR, { recursive: true })
    .catch((error) => { if (error.code !== "ENOENT") throw error; });
  await writeFile(join(root, "Caddyfile"), `{
 admin off
 persist_config off
 auto_https off
 storage file_system { root ${root}/tls }
}
http://localhost:${door} {
 bind 127.0.0.1
 handle /api/* {
  reverse_proxy 127.0.0.1:${lobby}
 }
 handle /socket.io/* {
  reverse_proxy 127.0.0.1:${lobby}
 }
 handle /legacy.html {
  root * ${root}
  header Cache-Control no-cache
  file_server
 }
 handle {
  reverse_proxy 127.0.0.1:${media}
 }
}
`.replace(`storage file_system { root ${root}/tls }`, `storage file_system {\n root ${root}/tls\n }`));
  await Promise.all(reservations.map((s) => new Promise((done) => s.close(done))));
  console.log(`Salle temporaire : ${url}\nTraces et sauvegardes de test : ${root}`);
  start("caddy", ["run", "--config", join(root, "Caddyfile"), "--adapter", "caddyfile"], "proxy");
  const startLobby = () => start(join(repo, "control/.venv/bin/python"), ["-m", "uvicorn", "nel3ab_control.app:app",
    "--host", "127.0.0.1", "--port", String(lobby)], "lobby", join(repo, "control"));
  let salon = startLobby();
  boot();
  await until(async () => {
    try { const game = (await room()).game; return game === null; } catch { return false; }
  }, "La salle temporaire ne démarre pas", 60000);
  const digest = data => createHash("sha256").update(data).digest("hex");
  assert.equal(digest(Buffer.from(await (await fetch(url)).arrayBuffer())),
    digest(await readFile(join(repo, "core/crates/worker/src/page/index.html"))),
    "Le binaire sert une ancienne page : lancer la recette just pour le reconstruire.");
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
  await writeFile(join(root,"browser.json"),JSON.stringify({endpoint:browser.wsEndpoint(),url,root}));
  const players=[];
  for(const name of ["Alice","Benoit","Camille","Dana"]) players.push(await open(name,true));
  const [alice,benoit]=players;
  const names=async()=>(await room()).seats.map(s=>s.player);
  await until(async()=>JSON.stringify(await names())==='["Alice","Benoit","Camille","Dana"]',"Four names not assigned");
  const library=(await room()).library;
  const tennis=library.find(g=>g.console==="switch");
  assert.ok(tennis,"Registered Switch game absent");
  const prepare=async(game,slot=0)=>{
    if(!await alice.$("#menu"))await alice.$eval("#openMenu",e=>e.click());
    if(await alice.$(`#item-shelf-${game.console}`))await alice.$eval(`#item-shelf-${game.console}`,e=>e.click());
    await alice.waitForSelector(`#item-game${game.index}`);
    await alice.$eval(`#item-game${game.index}`,e=>e.click());
    await alice.waitForSelector("#pickerConfirm");
    // The default is the ongoing/fresh slot. Exact choices are asserted below.
    if(slot!==0) await alice.$eval(`#pick-${slot}`,e=>e.click());
    else await alice.$eval("#pickerConfirm",e=>e.click());
    if(game.console!=="gc") {
      const selector=game.console==="switch"?".n3-switch-setup[open]":"#bindingsPanel[open]";
      for(const p of players) await p.waitForSelector(selector);
      assert.equal(await alice.$eval("#launchPrepared",e=>e.disabled),true);
      if(game.console==="switch") {
        await alice.setViewport({width:390,height:844});
        const layout=await alice.evaluate(()=>{
          const dialog=document.querySelector('.n3-switch-setup[open]');
          const button=dialog.querySelector('#launchPrepared').getBoundingClientRect();
          return {overflow:dialog.scrollWidth>dialog.clientWidth,footer:button.top>=0&&button.bottom<=innerHeight,details:[...dialog.querySelectorAll('details')].map(d=>d.open)};
        });
        assert.equal(layout.overflow,false);assert.equal(layout.footer,true);assert.deepEqual(layout.details,[true,false]);
        await alice.screenshot({path:join(root,`switch-setup-mobile-${generation}.png`)});
        await alice.type('section[aria-label="Mes profils Switch"] input:not([type="file"])','Tennis personnel');
        await button(alice,"Enregistrer");
        await until(async()=>{
          const r=await fetch(new URL('/api/me/bindings',url),{headers:{'Tailscale-User-Login':'alice@example.test'}});
          return Boolean((await r.json()).switch?.named?.['Tennis personnel']);
        },"Switch profile was not saved to Alice's account");
        const other=await fetch(new URL('/api/me/bindings',url),{headers:{'Tailscale-User-Login':'benoit@example.test'}});
        assert.equal((await other.json()).switch?.named?.['Tennis personnel'],undefined);
        await alice.$eval('.n3-switch-body',e=>{e.scrollTop=600});
        await alice.screenshot({path:join(root,`switch-profiles-mobile-${generation}.png`)});
        await alice.setViewport({width:1440,height:1000});
      }
      for(const p of players) {
        if(game.console==="wii") {
          await p.select('[aria-label="Ma configuration pour ce jeu"]',"1");
          if(p===alice) {
            // La socket parle encore Switch pendant cette préparation Wii.
            // La capture doit néanmoins modifier le profil Dolphin choisi.
            await p.select('#command','A');
            await p.$eval('#pad-A',e=>e.click());
            await p.waitForSelector('.n3-inline-capture');
            await p.evaluate(()=>{window.testPad.buttons[3]={pressed:true,touched:true,value:1}});
            await p.waitForSelector('.n3-inline-capture',{hidden:true});
            await p.waitForFunction(()=>document.querySelector('[data-padmap="wiimote"] [data-part="A"]')?.dataset.lit==='oui');
            await p.evaluate(()=>{window.testPad.buttons[3]={pressed:false,touched:false,value:0}});
            console.log('PASS Wii controller remapping after Switch, through the configuration dialog');
          }
        }
        await button(p,"Je suis prêt");
      }
      await alice.waitForFunction(()=>!document.querySelector("#launchPrepared").disabled);
      await button(alice,"Lancer le jeu");
    }
    await until(async()=>(await room()).game?.index===game.index,"New game not active",90000);
    for(const p of players){
      const before=await p.evaluate(()=>nel3abTest.counters().painted);
      await p.waitForFunction(n=>nel3abTest.counters().painted>n+15,{timeout:90000},before);
      await p.waitForSelector("#booting",{hidden:true,timeout:90000});
    }
    await until(async()=>JSON.stringify(await names())==='["Alice","Benoit","Camille","Dana"]',"Names lost on game change");
  };
  await prepare(tennis,process.env.NEL3AB_TEST_SWITCH_SAVE ? 1 : 0);
  await alice.screenshot({path:join(root,"switch-started.png")});
  console.log("PASS Switch startup, collective preparation and four named seats",root);
  // Leave room accessible to the bounded game/save inspection, then continue.
  await writeFile(join(root,"ready"),"Switch playing");
  if(process.env.NEL3AB_TEST_SWITCH_INSPECT==="1") await until(async()=>access(join(root,"continue")).then(()=>true,()=>false),"Inspection timeout",1800000);
  await benoit.$eval("#watchOnly",e=>e.click());
  await until(async()=>(await names())[1]===null,"Spectator left a stale name");
  await benoit.waitForSelector("#takePad");await benoit.$eval("#takePad",e=>e.click());
  await until(async()=>(await names())[1]==="Benoit","Returning player lost P2");
  const third=players[2];await third.reload();await enterRoom(third);
  await until(async()=>(await names())[2]==="Camille","Reload lost the named seat");
  const closeGame=async()=>{
    if(!await alice.$("#menu"))await alice.$eval("#openMenu",e=>e.click());
    await alice.$eval("#ray-salle",e=>e.click());
    await alice.$eval("#item-close-game",e=>e.click());await alice.waitForSelector("#pickerConfirm");await alice.$eval("#pickerConfirm",e=>e.click());
    await until(async()=>(await room()).game===null,"Game did not close",90000);
    for(const p of players)await p.waitForSelector("#menu");
    await until(async()=>JSON.stringify(await names())==='["Alice","Benoit","Camille","Dana"]',"Seats have not reconnected after closing");
    for(const p of players) await p.waitForFunction(()=>window.inputSocket?.readyState===1 && globalThis.nel3abTest.seat()!==null);
    console.log("PASS closed game and reconnected four seats");
  };
  await closeGame();
  assert.equal((await execute("docker",["ps","-aq","--filter",`label=nel3ab.room-root=${env.NEL3AB_SESSION_DIR}`])).stdout.trim(), "", "Owned containers survived closing");
  const playedSlot=process.env.NEL3AB_TEST_SWITCH_SAVE ? "debloquee" : "neuve";
  const engineLog=await readFile(join(config.state,"0100bde00862a000",playedSlot,"emulator.log"),"utf8");
  assert.ok(engineLog.includes(`Application Loaded: Mario Tennis Aces v${process.env.NEL3AB_TEST_SWITCH_VERSION??"3.1.0"} `),"Emulator silently loaded another game version");
  assert.equal(JSON.parse(await readFile(join(config.state,"0100bde00862a000",playedSlot,"exit.json"),"utf8")).ExitCode,0);

  const wii=library.find(g=>g.console==="wii"&&g.name==="Mario Kart Wii");assert.ok(wii);
  await prepare(wii);await alice.screenshot({path:join(root,"wii-after-switch.png")});
  await closeGame();
  const gc=library.find(g=>g.console==="gc"&&g.name.includes("Melee"));assert.ok(gc);
  await prepare(gc);await alice.screenshot({path:join(root,"gc-after-wii.png")});
  await closeGame();await prepare(tennis);
  // One separate viewer takes the reduced stream across an actual TCP cap.
  link=await limitedLink({port:narrow,toPort:door});link.squeeze(5);
  const slow=await open("Spectateur",false,false,`http://localhost:${narrow}/`,true);
  await slow.waitForFunction(()=>nel3abTest.pacing().pictureW===640,{timeout:60000});
  for(const p of players) await p.waitForFunction(()=>nel3abTest.pacing().pictureW===1280,{timeout:60000});
  console.log("PASS reduced viewer at 5 Mbit/s alongside four full viewers");
  const started=Date.now();const snapshots=[];
  while(Date.now()-started<Number(process.env.NEL3AB_TEST_SWITCH_SECONDS??180)*1000){
    snapshots.push(await Promise.all(players.map(p=>p.evaluate(()=>nel3abTest.pacing()))));
    await delay(1000);
  }
  const clip=await fetch(new URL("/clip",url),{method:"POST",headers:{Origin:new URL(url).origin}});
  assert.equal(clip.status,200,await (clip.status===200 ? Promise.resolve("") : clip.text()));
  const clipPath=join(root,"switch-clip.mp4");await writeFile(clipPath,Buffer.from(await clip.arrayBuffer()));
  const probed=JSON.parse((await execute("ffprobe",["-v","error","-show_streams","-show_format","-of","json",clipPath])).stdout);
  const video=probed.streams.find(s=>s.codec_type==="video"),audio=probed.streams.find(s=>s.codec_type==="audio");
  assert.equal(video?.width,1280);assert.equal(audio?.codec_name,"aac");assert.equal(audio.channels,2);
  assert.ok(Number(probed.format.duration)>=29&&Number(probed.format.duration)<=45);
  const decoded=(await execute("ffmpeg",["-v","error","-i",clipPath,"-map","0:a:0","-f","s16le","pipe:1"],{encoding:"buffer",maxBuffer:16*1024*1024})).stdout;
  assert.ok(decoded.length>=29*48000*4);
  let peak=0;for(let i=0;i<decoded.length;i+=2)peak=Math.max(peak,Math.abs(decoded.readInt16LE(i)));
  assert.ok(peak>0,"Known Mario Tennis title music is absent from the clip");
  const slowStats=await slow.evaluate(()=>({video:nel3abTest.pacing(),sound:nel3abTest.audio()}));
  await writeFile(join(root,"result.json"),JSON.stringify({url,generation,names:await names(),snapshots,slow:slowStats,link:link.stats(),clip:{seconds:probed.format.duration,peak}},null,2));
  console.log("PASS 30-second clip with decoded stereo music");
  console.log("PASS · GC/Wii/Switch transitions, four players, departures/reload",root);
} catch(error) {
  await writeFile(join(root,"failure-room.json"), JSON.stringify(await room(),null,2));
  if(browser)for(const [i,page] of (await browser.pages()).entries()) {
    await page.screenshot({path:join(root,`failure-${i}.png`)}).catch(()=>{});
    await writeFile(join(root,`failure-${i}.txt`),await page.evaluate(()=>document.body.innerText)).catch(()=>{});
  }
  throw error;
} finally {
  stopping=true;
  link?.close();
  if(browser)await browser.close();
  // Worker owns graceful Switch shutdown. Give its 40-second emulator deadline
  // time to finish before closing the isolated lobby and proxy.
  if(activeWorker?.exitCode===null){activeWorker.kill("SIGTERM");await Promise.race([new Promise(done=>activeWorker.once("exit",done)),delay(60000)]);}
  for(const child of children)if(child.exitCode===null)child.kill("SIGTERM");
  await delay(1000);
  for(const log of logs)log.end();
  for(const server of reservations)if(server.listening)server.close();
}
