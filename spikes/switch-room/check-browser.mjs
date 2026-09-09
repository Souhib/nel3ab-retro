// Uses the real browser media modules and Rust transport, against our own NRO.
// Never point this driver at the live room: its pixel assertions are a fixture.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const root = process.env.SWITCH_LAB ?? "/tmp/nel3ab-switch-lab";
const {url} = JSON.parse(await readFile(`${root}/pads/bridge.json`,"utf8"));
assert.equal(new URL(url).hostname,"127.0.0.1");
assert.notEqual(new URL(url).port,"8100");
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const {default:puppeteer} = await import(require.resolve("puppeteer"));
const browser = await puppeteer.launch({headless:true,args:["--no-sandbox",
  "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]});
const pages=[];
const result={players:[], claims:[], rumble:[], video:{}, clip:null};
try {
  for (let i=0;i<4;i++) {
    const context=await browser.createBrowserContext();
    const page=await context.newPage();
    await page.evaluateOnNewDocument(()=>{
      window.rumbles=[];
      window.pad={id:"Xbox Wireless Controller",mapping:"standard",index:0,connected:true,
        buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0})),axes:[0,0,0,0],
        vibrationActuator:{type:"dual-rumble",playEffect:async(type,options)=>{
          window.rumbles.push(options);return "complete";
        },reset:async()=>"complete"}};
      navigator.getGamepads=()=>[window.pad];
    });
    page.on("pageerror",error=>{throw error});
    await page.goto(url);
    assert.equal(await page.title(),"Prototype Switch nel3ab");
    await page.click("#play");
  await page.click("#setup-confirm");
    await page.waitForFunction(()=>window.prototypeSession?.getSnapshot().video.painted>20);
    const port=await page.evaluate(()=>window.prototypeSession.getSnapshot().input.port);
    assert.equal(port,i+1);
    result.players.push(port);
    pages.push(page);
  }
  // One source moves only its own emulated controller; the other three are the
  // negative twin. The assertion reads pixels produced by the Switch guest.
  for (let i=0;i<4;i++) {
    const page=pages[i];
    await page.bringToFront();
    await page.evaluate(()=>{window.pad.buttons[0]={pressed:true,touched:true,value:1};});
    await page.waitForFunction((i)=>{
      const canvas=document.querySelector("canvas");
      const c=canvas.getContext("2d");
      return c.getImageData((i%2)*640+50,Math.floor(i/2)*320+74,1,1).data[0]>230;
    },{timeout:5000},i);
    const held=await page.evaluate(()=>{
      const c=document.querySelector("canvas").getContext("2d");
      return [0,1,2,3].map(i=>c.getImageData((i%2)*640+50,Math.floor(i/2)*320+74,1,1).data[0]>230);
    });
    assert.deepEqual(held,[0,1,2,3].map(j=>j===i));
    await page.waitForFunction(()=>window.rumbles.some(x=>x.strongMagnitude>0||x.weakMagnitude>0),{timeout:5000});
    result.rumble.push(await page.evaluate(()=>window.rumbles.length));
    await page.evaluate(()=>{window.pad.buttons[0]={pressed:false,touched:false,value:0};});
    await page.waitForFunction((i)=>document.querySelector("canvas").getContext("2d")
      .getImageData((i%2)*640+50,Math.floor(i/2)*320+74,1,1).data[0]<100,{},i);
  }
  const page=pages[0];
  await page.bringToFront();
  result.video.full=await page.evaluate(()=>window.prototypeSession.getSnapshot().video);
  await page.click("#half");
  await page.waitForFunction(()=>window.prototypeSession.getSnapshot().video.picture?.width===640);
  result.video.half=await page.evaluate(()=>window.prototypeSession.getSnapshot().video);
  await page.click("#watch");
  await page.waitForFunction(()=>window.prototypeSession.getSnapshot().input.watching);
  const newPage=await browser.newPage();
  await newPage.goto(url);
  await newPage.click("#play");
  await newPage.click("#setup-confirm");
  await newPage.waitForFunction(()=>window.prototypeSession.getSnapshot().input.port===1);
  result.claims.push("P1 released by spectator and reclaimed");
  await newPage.close();
  // Observe enough received audio for a complete clip, including when the
  // driver is run immediately after capture starts. A fixed sleep proves less.
  await pages[1].waitForFunction(()=>window.prototypeSession.getSnapshot().sound.playedSeconds>31,{timeout:45000});
  const response=await fetch(`${url}/clip`,{method:"POST",headers:{Origin:url}});
  assert.equal(response.status,200);
  assert.match(response.headers.get("content-type"),/^video\/mp4/);
  const clip=Buffer.from(await response.arrayBuffer());
  assert.equal(clip.toString("ascii",4,8),"ftyp");
  await writeFile(`${root}/browser-clip.mp4`,clip);
  result.clip={bytes:clip.length};
  await page.screenshot({path:`${root}/browser-verified.png`});
  await writeFile(`${root}/browser-result.json`,JSON.stringify(result,null,2));
  console.log(JSON.stringify({players:result.players,rumble:result.rumble,claims:result.claims,
    full:result.video.full.picture,half:result.video.half.picture,clip:result.clip}));
} finally {
  await browser.close();
}
