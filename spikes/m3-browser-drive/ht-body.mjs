import puppeteer from "puppeteer";
const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("https://hardwaretester.com/gamepad", { waitUntil: "domcontentloaded", timeout: 30000 });
await new Promise(r => setTimeout(r, 3500));
const out = await page.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg")];
  const found = svgs.find(s => { const vb = s.getAttribute("viewBox")||""; return vb.startsWith("0 0 441"); }) || svgs[svgs.length - 1];
  if (!found) return "aucun";
  const elements = [];
  const collect = (el) => {
    for (const c of el.children) {
      const t = c.tagName.toLowerCase();
      if (["path","circle","rect","line","ellipse"].includes(t)) {
        const cpy = { tag: t };
        for (const a of ["d","cx","cy","r","x","y","width","height","rx","ry","fill","stroke","stroke-width","strokeWidth"]) {
          const v = c.getAttribute(a);
          if (v) cpy[a] = v;
        }
        const size = JSON.stringify(cpy).length;
        if (size > 60 && !cpy.d) cpy.d = "(long d)";
        elements.push(cpy);
      }
      collect(c);
    }
  };
  collect(found);
  return { viewBox: found.getAttribute("viewBox"), elements: elements.filter(e => JSON.stringify(e).length < 90 || e.tag === "path") };
});
console.log(JSON.stringify(out, null, 0));
await browser.close();
