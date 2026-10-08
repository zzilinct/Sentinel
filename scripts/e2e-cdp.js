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
  const call = (id, method, params) => new Promise((resolve) => {
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id === id) resolve(d); };
    ws.send(JSON.stringify({ id, method, params }));
  });
  // E2E_MOTION_HOLD_MS: the runner's Windows asks for reduced motion, so for photographs of the motion this session
  // asks for full motion, evaluates, and stays connected this long (the request ends with the session) while the
  // script takes its screenshot.
  const hold = Number(process.env.E2E_MOTION_HOLD_MS) || 0;
  if (hold) await call(0, 'Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const reply = await call(1, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  // E2E_SHOT: also save what the window itself shows, transparent around it, for a window left out of screen copies
  // (the chat overlay: setContentProtection), so the script can lay it over its screenshot.
  if (process.env.E2E_SHOT) {
    await call(2, 'Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const s = await call(3, 'Page.captureScreenshot', { format: 'png' });
    if (s.result && s.result.data) require('fs').writeFileSync(process.env.E2E_SHOT, Buffer.from(s.result.data, 'base64'));
  }
  if (hold) { const r = reply.result || {}; console.log(JSON.stringify(r.exceptionDetails ? { error: 'threw' } : { value: r.result ? r.result.value : null })); await new Promise((r) => setTimeout(r, hold)); }
  ws.close();
  const r = reply.result || {};
  if (r.exceptionDetails) return { error: (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text || '').split('\n')[0] };
  return { value: r.result ? r.result.value : null };
}

main().then((r) => console.log(JSON.stringify(r)), (err) => console.log(JSON.stringify({ error: String(err && err.message || err) })));
