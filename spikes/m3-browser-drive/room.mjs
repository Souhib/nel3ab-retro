// Opens several browsers on one room and asks each which port it was given.
// The seat protocol is only interesting when there is somebody else in the room.
import puppeteer from "puppeteer";

const url = process.argv[2] ?? "http://localhost:8100/";
const players = Number(process.argv[3] ?? 2);

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const pages = [];
for (let i = 0; i < players; i++) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`[page ${i}] ${e.message}`));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  pages.push(page);
  // One at a time, so the order they are given ports is the order they arrived.
  await new Promise((r) => setTimeout(r, 1200));
}
await new Promise((r) => setTimeout(r, 3000));

const seats = [];
for (const [i, page] of pages.entries()) {
  const said = await page.evaluate(() => document.getElementById("seat").textContent);
  const sent = await page.evaluate(() =>
    (document.getElementById("stats").innerText.match(/pad frames\s+(\d+)/) ?? [])[1],
  );
  console.log(`browser ${i}: "${said}" — ${sent} pad frames sent`);
  seats.push(said);
}
const ports = seats.map((s) => (s.match(/joueur (\d)/) ?? [])[1]).filter(Boolean);
// Assert the precondition rather than call it a failure: this checks that N
// browsers get N ports IN ARRIVAL ORDER, which needs an empty room. Somebody
// playing at the time is not a defect, and reporting one would teach whoever
// reads this to ignore it.
if (ports[0] !== "1") {
  console.log(`RIEN TESTÉ — la salle n'était pas vide, la première page a eu le port ${ports[0] ?? "aucun"}`);
  await browser.close();
  process.exit(2);
}
const distinct = new Set(ports);
console.log(
  ports.length === players && distinct.size === players
    ? `PASS — ${players} browsers, ${players} distinct ports (${ports.join(", ")})`
    : `FAIL — ports: ${JSON.stringify(ports)}`,
);
await browser.close();
process.exit(distinct.size === players && ports.length === players ? 0 : 1);
