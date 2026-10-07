'use strict';
/**
 * End-to-end runs only (scripts/desktop-e2e.ps1, on a GitHub test desktop): evaluate an expression in one of the
 * installed Sentinel's own windows, through the debugging port it was started with. Prints the result as JSON, or
 * {"error": "..."} when the window is not there or the expression threw. Never run on a real computer.
 *   node scripts/e2e-cdp.js <port> <part of the window's address, or main> <expression>
 */
const [port, part, expression] = process.argv.slice(2);

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  // 'main': the main process itself, through the inspector port (a node target, not a window).
  const t = targets.find((x) => (part === 'main' ? x.type === 'node' : x.type === 'page' && x.url.includes(part)));
  if (!t) return { error: `no window at ${part}`, windows: targets.map((x) => x.url.split('?')[0]) };
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('could not connect')); });
  const reply = await new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === 1) resolve(d); };
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  ws.close();
  const r = reply.result || {};
  if (r.exceptionDetails) return { error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').split('\n')[0] };
  return { value: r.result ? r.result.value : null };
}

main().then((r) => console.log(JSON.stringify(r)), (err) => console.log(JSON.stringify({ error: String(err && err.message || err) })));
