// Observe actual H.264 IDR packets, not the bridge's acknowledgement of a wish.
// The listener and capture must use the isolated prototype on port 8311.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
const require = createRequire(new URL("../m3-browser-drive/package.json", import.meta.url));
const WebSocket = require("ws");
const origin = "http://127.0.0.1:8311";
function isKey(bytes) {
  for (let i = 8; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1 && (bytes[i + 3] & 31) === 5)
      return true;
  }
  return false;
}
function watch(half) {
  const keys = [];
  const socket = new WebSocket(origin.replace("http", "ws") + (half ? "/video?half=1" : "/video"), {
    origin,
  });
  socket.on("message", (bytes) => {
    if (isKey(bytes)) keys.push(performance.now());
  });
  return { socket, keys };
}
async function until(predicate, ms = 4000) {
  const end = performance.now() + ms;
  while (!predicate() && performance.now() < end) await delay(5);
  assert(predicate(), "expected an actual IDR frame before deadline");
}
const full = watch(false),
  half = watch(true);
try {
  await until(() => full.keys.length >= 3 && half.keys.length >= 3);
  const report = [];
  for (const [target, other, name] of [
    [full, half, "full"],
    [half, full, "half"],
  ]) {
    // The one-second periodic GOP is our negative twin. Send just after its
    // key, when an unchanged recorder cannot satisfy a 350 ms deadline.
    const count = target.keys.length;
    await until(() => target.keys.length > count);
    await delay(80);
    const before = target.keys.length,
      start = performance.now();
    target.socket.send(Buffer.from([1]));
    await until(() => target.keys.length > before, 350);
    const responseMs = target.keys[before] - start;
    assert(responseMs < 350);
    // The other stream must retain its normal GOP throughout this request.
    const unrelated = other.keys.slice(-2);
    assert(
      unrelated[1] - unrelated[0] > 600,
      "a half request must not force the full stream (or vice versa)",
    );
    // One request is consumed once: the next frame is not another key.
    const nextCount = target.keys.length;
    await delay(250);
    assert.equal(target.keys.length, nextCount, "request stuck: every frame becomes a key");
    report.push({ stream: name, responseMs, otherGopMs: unrelated[1] - unrelated[0] });
  }
  console.log(JSON.stringify(report));
} finally {
  full.socket.close();
  half.socket.close();
}
