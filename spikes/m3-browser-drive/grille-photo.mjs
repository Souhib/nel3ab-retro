// Pose une grille chiffrée sur une photo, et optionnellement un tracé SVG
// (en pixels de la photo). usage: grille-photo.mjs IMAGE SORTIE [PATH_D] [x0 y0 x1 y1]
import puppeteer from "puppeteer";
import { readFileSync } from "node:fs";
const [img, out, d = "", ...crop] = process.argv.slice(2);
const data = readFileSync(img).toString("base64");
const ext = img.endsWith(".png") ? "png" : "jpeg";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const html = `<body style="margin:0;background:#000"><div style="position:relative;display:inline-block">
<img id=i src="data:image/${ext};base64,${data}" style="display:block">
<svg id=s style="position:absolute;left:0;top:0;overflow:visible"></svg></div>
<script>
const i=document.getElementById('i'), s=document.getElementById('s');
i.onload=()=>{const w=i.naturalWidth,h=i.naturalHeight;s.setAttribute('width',w);s.setAttribute('height',h);
let g='';for(let x=0;x<w;x+=20){const m=x%100===0;g+='<line x1='+x+' y1=0 x2='+x+' y2='+h+' stroke="'+(m?'#f0f':'#0ff')+'" stroke-opacity="'+(m?0.7:0.25)+'" stroke-width="1"/>';if(m)g+='<text x='+(x+2)+' y=12 fill="#ff0" font-size=11>'+x+'</text>';}
for(let y=0;y<h;y+=20){const m=y%100===0;g+='<line x1=0 y1='+y+' x2='+w+' y2='+y+' stroke="'+(m?'#f0f':'#0ff')+'" stroke-opacity="'+(m?0.7:0.25)+'" stroke-width="1"/>';if(m)g+='<text x=2 y='+(y-2)+' fill="#ff0" font-size=11>'+y+'</text>';}
g+='<path d="${d}" fill="#f00" fill-opacity="0.18" stroke="#f00" stroke-width="1.5"/>';
s.innerHTML=g;document.title='ok'}</script></body>`;
await page.setContent(html);
await page.waitForFunction(() => document.title === "ok");
const [x0, y0, x1, y1] = crop.map(Number);
const clip = crop.length ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
await page.setViewport({ width: 1400, height: 1100, deviceScaleFactor: crop.length ? 2 : 1 });
await page.screenshot({ path: out, clip, fullPage: !crop.length });
await browser.close();
