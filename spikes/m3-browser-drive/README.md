# Driving the browser half without a human

The worker's page can only be judged in a browser, and lgf has none. This runs a
real one **on the server**, headless, against `localhost` — which also sidesteps
the secure-context problem: WebCodecs needs one, and `http://` on a LAN IP is not
one, while `http://localhost` is.

```sh
npm install puppeteer          # Chrome for Testing; ~180 MB, downloaded once
node drive.mjs http://localhost:8100/ 20
NO_INPUT=1 SHOT=control.png node drive.mjs http://localhost:8100/ 20
```

It reports what the page says about itself, samples the canvas for distinct
colours, and leaves a screenshot to **look at** — which is the check every hollow
claim in this project turned out to be missing.

## The control matters more than the run

The first comparison here was wrong in a way worth remembering. Two runs against
the **same** worker: one pressing keys, one not. Both showed the game past its
opening dialog, which looked like proof that input worked — and proved nothing,
because the second run inherited the emulator state the first had changed.

Redone with a fresh Dolphin per arm, same duration:

| | frames | what was on screen |
|---|---|---|
| no keys | 1141 | the memory-card dialog, unmoved |
| keys | 1119 | dialog dismissed, the intro playing |

M1 measured that this dialog never changes on its own — 7037 byte-identical
frames — so a screen that has moved past it *is* the evidence, provided the run
started from the same place.

## What it does not measure

`localhost` is not a network. The arrival-to-glass figures the page prints
(p50 0.6 ms, p95 2.4 ms on this loop) are transit-free by construction. A number
from here is a floor for the browser half, and says nothing about Wi-Fi.

`node_modules/` is not committed; nothing in the worker depends on this.
