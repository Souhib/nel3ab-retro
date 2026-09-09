/** A bounded TCP bottleneck for one test browser. Shared allowance across its
 * HTTP, video and audio sockets; upstream reads pause while a chunk waits.
 * The older throttle.mjs has an unbounded JS queue, which cannot measure the
 * worker's reaction to backpressure. No live interface or qdisc is modified.
 */
import net from "node:net";
export async function limitedLink({ port, toPort }) {
  const connections = new Set();
  let bytes = 0, maximumQueued = 0, rate = 125_000_000, tokens = 0, previous = performance.now();
  const server = net.createServer(client => {
    const upstream = net.connect(toPort, "127.0.0.1");
    client.setNoDelay(true); upstream.setNoDelay(true);
    const state = { client, upstream, chunk: null, blocked: false, ended: false };
    connections.add(state);
    const close = () => { client.destroy(); upstream.destroy(); connections.delete(state); };
    upstream.on("data", chunk => { upstream.pause(); state.chunk = chunk; });
    upstream.on("end", () => { state.ended = true; });
    client.on("data", chunk => { if (!upstream.write(chunk)) client.pause(); });
    upstream.on("drain", () => client.resume());
    client.on("drain", () => { state.blocked = false; });
    client.on("close", close); client.on("error", close); upstream.on("error", close);
  });
  // 5 ms gives sub-frame granularity. The 100 ms burst allowance represents a
  // brief packet burst; both are test conditions, not claims about home Wi-Fi.
  const tick = setInterval(() => {
    const now = performance.now();
    tokens = Math.min(rate * 0.1, tokens + rate * (now - previous) / 1000); previous = now;
    maximumQueued = Math.max(maximumQueued, [...connections].reduce((sum, c) => sum + (c.chunk?.length ?? 0), 0));
    for (const c of connections) {
      if (c.chunk && !c.blocked && tokens >= 1) {
        const take = Math.min(c.chunk.length, Math.floor(tokens));
        c.blocked = !c.client.write(c.chunk.subarray(0, take));
        bytes += take; tokens -= take;
        c.chunk = take === c.chunk.length ? null : c.chunk.subarray(take);
        if (!c.chunk) c.upstream.resume();
      }
      if (c.ended && !c.chunk) c.client.end();
    }
  }, 5);
  try { await new Promise((yes, no) => server.once("error", no).listen(port, "127.0.0.1", yes)); }
  catch (error) { clearInterval(tick); throw error; }
  return {
    squeeze: megabits => { rate = megabits * 1_000_000 / 8; tokens = 0; },
    stats: () => ({ bytes, maximumQueued }),
    close: () => { clearInterval(tick); for (const c of connections) { c.client.destroy(); c.upstream.destroy(); } server.close(); },
  };
}
