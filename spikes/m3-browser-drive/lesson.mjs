// One press must answer ONE question.
//
// The bug this pins was found by the player in three seconds: pressing A took
// the counter from 1 to 3. The lesson re-read its resting sample after each
// answer, and it took that sample while the button was still down — so letting
// go moved just as far as pressing, and answered the next question too.
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto(process.argv[2] ?? "http://localhost:8100/", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2500));

// A pad shaped like a GameCube adapter: triggers on axes resting at -1.
const pad = (pressed = [], axes = [0, 0, 0, 0, -1, -1]) => ({
  id: "adapter",
  mapping: "",
  axes,
  buttons: Array.from({ length: 13 }, (_, i) => ({
    pressed: pressed.includes(i),
    value: pressed.includes(i) ? 1 : 0,
  })),
});

const feed = (p, frames = 3) =>
  page.evaluate(
    async (p, frames) => {
      for (let i = 0; i < frames; i++) globalThis.nel3abTest.feedPad(p);
      return globalThis.nel3abTest.lessonAt();
    },
    p,
    frames,
  );

await page.evaluate((p) => globalThis.nel3abTest.beginLesson(p), pad());

// A, then B: press, hold a few frames, let go, hold a few more.
const order = [1, 2, 5, 6, 7];
let bad = 0;
for (const [i, index] of order.entries()) {
  const holding = await feed(pad([index]));
  const released = await feed(pad());
  const expected = i + 1;
  const ok = released.step === expected;
  if (!ok) bad += 1;
  console.log(
    `  bouton ${index} : étape ${holding.step} pendant l'appui → ${released.step} après ` +
      `(attendu ${expected}) ${ok ? "ok" : "FAUX — un appui a répondu à deux questions"}`,
  );
}

// And a question is not answered while the hand is still down.
const stuck = await feed(pad([order[0]]), 10);
console.log(`  bouton maintenu 10 images : étape ${stuck.step}, en attente de relâche : ${stuck.waiting}`);

console.log(bad === 0 ? "PASS — un appui, une question" : `FAIL — ${bad} étape(s) sautée(s)`);
await browser.close();
process.exit(bad === 0 ? 0 : 1);
