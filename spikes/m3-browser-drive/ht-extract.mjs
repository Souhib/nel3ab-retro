import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 900 });
page.on("pageerror", e => console.log("PE:", e.message.slice(0,140)));
await page.goto("https://hardwaretester.com/gamepad", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 4500));
const out = await page.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg")];
  const found = svgs.find(s => (s.getAttribute("viewBox")||"").match(/[3-6]00|5[0-2]0|6[0-2]0/)) || svgs.find(s => s.getBBox().width > 100);
  if (!found) return { svgs: svgs.map(s => s.getAttribute("viewBox")) };
  const dump = [];
  const walk = (el, depth) => {
    if (depth > 4) return;
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase();
      const info = { tag };
      for (const a of ["viewBox","x","y","width","height","cx","cy","r","d","rx","ry","fill","stroke","transform"]) {
        const v = c.getAttribute(a);
        if (v) info[a] = v.length > 60 ? v.slice(0,60)+"…" : v;
      }
      const cs = getComputedStyle(c);
      const fill = cs.fill && !cs.fill.startsWith("none") ? cs.fill : c.getAttribute("fill");
      if (fill) info.cssFill = fill;
      if (cs.stroke && cs.stroke !== "none") info.cssStroke = cs.stroke;
      if (cs.strokeWidth) info.strokeWidth = cs.strokeWidth;
      if (fill || cs.stroke !== "none" || tag === "g" || tag === "svg") dump.push("  ".repeat(depth) + JSON.stringify(info));
      walk(c, depth + 1);
    }
  };
  walk(found, 1);
  return { viewBox: found.getAttribute("viewBox"), bbox: (() => { const b = found.getBBox(); return {x:b.x,y:b.y,w:b.width,h:b.height}; })(), dump };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
