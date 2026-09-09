// The setup footer must remain reachable on a phone regardless of title wrapping.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../m3-browser-drive/package.json',import.meta.url));
const {default:puppeteer}=await import(require.resolve('puppeteer'));
const html=await readFile(new URL('./bridge/page.html',import.meta.url));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage();
 for(const [width,height] of [[390,844],[1280,980]]) {
  await page.setViewport({width,height});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.click('#play');await page.$eval('#setup-seat',e=>e.textContent='Joueur 2 · commandes retenues pendant la configuration');
  const rect=await page.$eval('#setup-confirm',e=>{const r=e.getBoundingClientRect();const d=e.closest('dialog').getBoundingClientRect();return {top:r.top,bottom:r.bottom,dialogBottom:d.bottom};});
  assert(rect.top>=0&&rect.bottom<=height&&rect.bottom<rect.dialogBottom,`footer clipped at ${width}: ${JSON.stringify(rect)}`);
 }
 console.log('setup footer visible at 390x844 and 1280x980');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
