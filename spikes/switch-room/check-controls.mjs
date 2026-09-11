// Four real browser input sockets, four isolated uinput devices, no emulator,
// ROM, keys, live bridge or production control port. Always rebuild first.
import {createRequire} from 'node:module';
import {mkdtemp,readFile,writeFile,chmod,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../m3-browser-drive/package.json',import.meta.url));
const {default:puppeteer}=await import(require.resolve('puppeteer'));
const here=dirname(fileURLToPath(import.meta.url));
const root=await mkdtemp(resolve(tmpdir(),'nel3ab-switch-controls-'));
const image='nel3ab/switch-prototype:2026-09-08-recovery';
const helper=`nel3ab-switch-controls-${process.pid}`,observer=`${helper}-observer`;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const until=async(predicate,message,timeout=10000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await predicate())return;await new Promise(r=>setTimeout(r,25));}throw Error(message);};
let bridge;const browsers=[];const created=[];const errors=[];let log='';
const readState=async()=>JSON.parse(await readFile(resolve(root,'observed.json'),'utf8'));
const neutral=s=>s.keys.length===0&&Object.values(s.axes).every(x=>x===0);
const hash=x=>createHash('sha256').update(x).digest('hex');
try {
 await chmod(root,0o770);
 // Import the production launch arguments: extra privileges in a test used to
 // hide the live rumble EACCES failure (2026-09-09).
 const command=JSON.parse(execFileSync('python3',['-c',
  'import importlib.util,json,pathlib,sys; spec=importlib.util.spec_from_file_location("switch_room",sys.argv[1]); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); print(json.dumps(module.pad_command(sys.argv[2],pathlib.Path(sys.argv[3]),sys.argv[4],"nel3ab Switch controls test")))',
  resolve(here,'../../docker/switch-room.py'),image,root,helper],{encoding:'utf8'}));
 assert.equal(command[0],'docker');docker(...command.slice(1));created.push(helper);
 await until(async()=>{try{await readFile(resolve(root,'devices.json'));return true;}catch{return false;}},'test pads did not start');
 const paths=JSON.parse(await readFile(resolve(root,'devices.json'),'utf8'));assert.equal(paths.length,4);
 docker('run','-d','--name',observer,'--user',String(process.getuid()),'--network','none','--cap-drop','ALL','--security-opt','no-new-privileges',...paths.flatMap(path=>['--device',path]),'-v',`${root}:/run-data`,'-v',`${here}:/probe:ro`,image,'python3','/probe/observe-pads.py');created.push(observer);
 bridge=spawn(resolve(here,'bridge/target/debug/nel3ab-switch-prototype'),[root,'0'],{stdio:['ignore','pipe','pipe']});bridge.stderr.on('data',b=>log+=b);bridge.stdout.on('data',b=>log+=b);
 await until(async()=>{try{await readFile(resolve(root,'bridge.json'));return true;}catch{return false;}},'isolated bridge did not bind');
 const {url}=JSON.parse(await readFile(resolve(root,'bridge.json'),'utf8'));assert.match(url,/^http:\/\/127\.0\.0\.1:\d+$/);
 await until(async()=>{try{return (await readState()).every(neutral);}catch{return false;}},'observer did not see neutral pads');
 const pages=[];
 for(let i=0;i<4;i++) {
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-background-timer-throttling','--disable-renderer-backgrounding']});browsers.push(browser);
  const page=await browser.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1280,height:980});
  await page.evaluateOnNewDocument(()=>{
   window.testPad={id:'Xbox Wireless Controller',mapping:'standard',index:0,connected:true,axes:[0,0,0,0],buttons:Array.from({length:18},()=>({value:0,pressed:false,touched:false}))};
   window.rumbles=[];
   window.testPad.vibrationActuator={playEffect:async(type,effect)=>{window.rumbles.push(effect);return 'complete';},reset:async()=> 'complete'};
   navigator.getGamepads=()=>window.testPad.connected?[window.testPad]:[];
  });
  const response=await page.goto(url);assert.equal(hash(await response.buffer()),hash(await readFile(resolve(here,'bridge/page.html'))));
  await page.click('#play');await page.waitForSelector('#setup[open]');
  assert.equal(await page.$eval('#setup-correspondences',e=>e.open),true);
  assert.equal(await page.$eval('#setup-diagnostic',e=>e.open),false);
  assert.equal(await page.evaluate(()=>window.prototypeSession),undefined,'configuration must not claim a seat');
  await page.click('#setup-confirm');await page.waitForFunction(i=>window.prototypeSession?.getSnapshot().input.port===i+1,{},i);
 }
 // A real EV_FF event must reach exactly the matching browser. Then remove
 // the receiver's group-write permission to reproduce production's old failure:
 // feedback is lost, but the helper and all four controllers must survive.
 const vibrate=player=>docker('exec',observer,'python3','/probe/rumble-test-pad.py',String(player));
 assert.equal((await stat(resolve(root,'rumble.sock'))).mode&0o777,0o660,'production ingress must set the helper group permissions');
 for(let i=0;i<4;i++) {
  const before=await Promise.all(pages.map(p=>p.evaluate(()=>window.rumbles.length)));
  vibrate(i+1);
  await until(async()=>await pages[i].evaluate(()=>window.rumbles.length)>before[i],`P${i+1} rumble did not reach its browser`);
  const after=await Promise.all(pages.map(p=>p.evaluate(()=>window.rumbles.length)));
  for(let j=0;j<4;j++)assert.equal(after[j]-before[j],i===j?1:0,'rumble reached the wrong player');
 }
 await chmod(resolve(root,'rumble.sock'),0o600);
 const rumbleBefore=await pages[1].evaluate(()=>window.rumbles.length);
 vibrate(2);
 await until(async()=>docker('logs',helper).includes('"rumble_available": false'),'permission refusal was not exercised');
 assert.equal(docker('inspect','--format','{{.State.Running}}',helper),'true','rumble failure killed the virtual controllers');
 assert.equal(await pages[1].evaluate(()=>window.rumbles.length),rumbleBefore,'unwritable socket unexpectedly accepted rumble');
 const page=pages[1];await page.bringToFront();
 const change=async(page,button,value=1)=>page.evaluate((button,value)=>Object.assign(window.testPad.buttons[button],{value,pressed:value>.5}),button,value);
 // Every standard gameplay button, after all real translations. Kernel codes
 // are Linux input-event-codes.h, independent of our JSON translation table.
 // X is 308 and Y 307: SDL reads these pads as Xbox 360 controllers, whose
 // left button X sends 307 and top button Y sends 308, and Ryubing maps the
 // Switch X to the top button. With X on 307, the page's X reached the game as
 // Y: Mario Party Superstars opened its X panel on Y (2026-09-11).
 const keys=[304,305,308,307,310,311,null,null,314,315,317,318,null,null,null,null];
 for(let bit=0;bit<16;bit++) {
  await change(page,bit);await until(async()=>{const all=await readState();const s=all[1];const expected=keys[bit];return all.every((p,i)=>i===1||neutral(p)) && (expected!==null?s.keys.length===1&&s.keys[0]===expected:s.keys.length===0&&s.axes[bit===6?'zl':bit===7?'zr':bit<14?'dy':'dx']===(bit<8?255:bit===12||bit===14?-1:1));},`button ${bit} did not reach only P2`);
  await change(page,bit,0);await until(async()=>(await readState()).every(neutral),`button ${bit} remained held`);
 }
 // All buttons above were exercised while feedback was refused. Restore the
 // receiver and prove the next vibration is delivered without recreating pads.
 await chmod(resolve(root,'rumble.sock'),0o660);
 vibrate(2);
 await until(async()=>await pages[1].evaluate(()=>window.rumbles.length)>rumbleBefore,'rumble did not recover');
 await page.evaluate(()=>window.testPad.axes=[.25,-.5,-.75,.2]);
 await until(async()=>{const axes=(await readState())[1].axes;return axes.lx===8192&&axes.ly===-16384&&axes.rx===-24575&&axes.ry===6553;},'fractional axes saturated or inverted');
 await page.evaluate(()=>window.testPad.axes=[0,0,0,0]);await until(async()=>(await readState()).every(neutral),'axes did not release');
 await page.click('#configure');await page.waitForSelector('#setup[open]');
 await change(page,5);await page.waitForFunction(()=>document.querySelector('[data-target="R"]').dataset.lit==='true');
 assert((await readState()).every(neutral),'configuration presses reached the kernel');await change(page,5,0);
 await page.click('[data-target="R"] [data-bind="key"]');await page.keyboard.press('v');await page.waitForFunction(()=>document.querySelector('[data-target="R"] [data-bind="key"]').textContent==='V');
 await page.type('#setup-name','Tennis joueur 2');await page.click('#setup-save');await page.waitForFunction(()=>[...document.querySelector('#setup-profiles').options].some(o=>o.value==='Tennis joueur 2'));
 await page.click('#setup-reset');await page.select('#setup-profiles','Tennis joueur 2');await page.click('#setup-load');await page.waitForFunction(()=>document.querySelector('[data-target="R"] [data-bind="key"]').textContent==='V');
 await page.screenshot({path:resolve(root,'setup-desktop.png')});
 await page.setViewport({width:390,height:844});await page.$eval('.setup-body',e=>e.scrollTop=0);await page.screenshot({path:resolve(root,'setup-mobile.png')});
 assert(await page.$eval('#setup',e=>e.scrollWidth<=e.clientWidth),'dialog overflows mobile viewport');
 await page.setViewport({width:1280,height:980});await page.click('#setup-confirm');await page.keyboard.down('v');try {await until(async()=>(await readState())[1].keys.includes(311),'loaded keyboard profile did not reach R');} catch(error) {console.log(await page.evaluate(()=>({active:document.activeElement?.outerHTML,focused:document.hasFocus(),port:window.prototypeSession.input.port,blocked:window.prototypeSession.input.configurationOpen,held:[...window.prototypeSession.input.held],reading:window.prototypeSession.input.source.reading,waiting:window.prototypeSession.input.source.waitingForRest,keys:window.prototypeSession.input.source.profile.keys})));throw error;}await page.keyboard.up('v');await until(async()=>(await readState()).every(neutral),'released keyboard remained held');
 // Spectator transition releases the real device; returning gets a free seat.
 await change(page,0);await until(async()=>(await readState())[1].keys.includes(304),'before leaving A must be held');await page.click('#watch');await until(async()=>(await readState()).every(neutral),'spectator kept a button down');
 await change(page,0,0);await page.reload();await page.click('#play');await page.waitForFunction(()=>document.querySelector('[data-target="R"] [data-bind="key"]').textContent==='V');await page.click('#setup-confirm');await page.waitForFunction(()=>window.prototypeSession?.getSnapshot().input.port===2);
 await page.keyboard.down('v');await until(async()=>(await readState())[1].keys.includes(311),'reloaded profile did not work');
 await page.close();await until(async()=>(await readState()).every(neutral),'closed browser kept a button down');
 assert.deepEqual(errors,[]);
 const result={fourPlayers:true,rumbleAllPlayers:true,rumbleFailureKeepsInput:true,rumbleRecovery:true,buttons:16,fractionalAxes:true,configurationNeutral:true,namedProfiles:true,reload:true,spectatorRelease:true,disconnectRelease:true,mobileOverflow:false,pageErrors:errors,html:hash(await readFile(resolve(here,'bridge/page.html'))),root};
 await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {
 for(const b of browsers)await b.close();bridge?.kill('SIGTERM');
 for(const container of created.reverse()){try{await writeFile(resolve(root,container+'.log'),docker('logs',container));docker('rm','-f',container);}catch{try{docker('rm','-f',container);}catch{}}}
 await writeFile(resolve(root,'bridge.log'),log);
}
