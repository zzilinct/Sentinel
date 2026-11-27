'use strict';
/**
 * page-shape   The companion reads a suspect page's shape and sends four facts, nothing else (extension/src/content/pagefacts.js,
 *              checklist X03). A free-host address with a password box and a protected brand in its title is marked yellow;
 *              the same page on the brand's own host, and an honest page, are not; a private window sends nothing. Every
 *              request the companion makes goes through a recorder, so what left the browser is read, not assumed.
 *              The pages are local stand-ins on made-up hosts; the brand's name is joined from fragments at run time.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, shot } = require('./_shared');

const BRAND_TITLE = ['Sign in to Pay', 'Pal'].join('');
// Free hosts and a brand domain whose endings Chrome does not force to https (.dev, .app and paypal.com are preloaded), so the local pages load.
const SUSPECT = 'my-notes.glitch.me';     // a free-host name: the address alone scores 10, "suspect"
const OWN = 'www.' + ['pay', 'pal'].join('') + '.me';
const HONEST = 'acme-app.onrender.com';
const PRIVATE = 'private-notes.glitch.me';

async function checkPageShape() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-shape-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'page-shape-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0' }
  });
  const api = `http://127.0.0.1:${port}`;
  let token = null;
  for (let i = 0; i < 120 && !token; i++) {
    await sleep(500);
    try {
      const r = await fetch(`${api}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: api }, body: '{}' });
      if (r.ok) token = (await r.json()).token;
    } catch { /* still starting */ }
  }
  // Everything the companion asks of its scanner passes through here and is written down: method, path, body.
  const sent = [];
  const proxy = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const entry = { method: req.method, path: req.url, body: body.toString('utf8'), status: 0 };
    sent.push(entry);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); res.end(); return; }
    const headers = {};
    for (const h of ['content-type', 'authorization', 'origin', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
    let r;
    try { r = await fetch(api + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }); } catch (err) { entry.status = `error ${err.message}`; res.writeHead(502); res.end(); return; }
    entry.status = r.status;
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'access-control-allow-origin': '*' });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const scanner = `http://127.0.0.1:${proxy.address().port}`;

  const page = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:60px"><h1>Welcome back</h1><form action="/post" onsubmit="return false"><p><label>Password <input type="password"></label></p></form></body></html>`;
  const files = await serveFiles({}, { '/signin.html': page(BRAND_TITLE), '/home.html': page('Acme dashboard') });
  const filesPort = new URL(files.base).port;
  const hosts = [SUSPECT, OWN, HONEST, PRIVATE];
  const { browser, close } = await launch([`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',')}`, '--disable-features=HttpsFirstModeIncognito,HttpsUpgrades,HttpsFirstBalancedModeAutoEnable']);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see page-shape-server.log)`);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension'), enableInIncognito: true });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(scanner)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');

    const loadedTitle = (sess) => evalIn(browser, sess, 'document.title');
    const batchFor = (host) => sent.filter((r) => r.path.includes('/live/batch') && r.body.includes(host));
    const waitFor = async (test, tries = 80) => { for (let i = 0; i < tries && !test(); i++) await sleep(250); return test(); };
    // The mark on the tab, as the toolbar shows it.
    const markOf = (host) => evalIn(browser, opt.sessionId, `(async () => {
      const tab = (await chrome.tabs.query({})).find((t) => (t.url || '').includes(${JSON.stringify(host)}));
      return tab ? { text: await chrome.action.getBadgeText({ tabId: tab.id }), title: await chrome.action.getTitle({ tabId: tab.id }) } : null;
    })()`);

    /* 1. A free-host page with a password box and a protected brand in its title. */
    const a = await openPage(browser);
    await goto(browser, a.sessionId, `http://${SUSPECT}/signin.html`);
    const titles = [await loadedTitle(a.sessionId)];
    const read = await waitFor(() => batchFor(SUSPECT).length > 0);
    let mark = null;
    for (let i = 0; i < 40 && !(mark && mark.text === '?'); i++) { await sleep(250); mark = await markOf(SUSPECT); }
    await shot(browser, a.sessionId, 'page-shape-suspect');
    const body = read ? JSON.parse(batchFor(SUSPECT)[0].body) : null;
    const hint = body && body.hints && Object.values(body.hints)[0];
    result('page-shape: a free-host page with a password box and a protected brand in its title is read and marked yellow', Boolean(read) && Boolean(mark) && mark.text === '?', { mark, hint, seen: sent.map((r) => `${r.method} ${r.path} ${r.status}`) });
    result('page-shape: what was sent is four facts and nothing else (no title, no text, no form address)',
      Boolean(hint) && JSON.stringify(hint) === JSON.stringify({ facts: { password: true, crossForm: false, frame: false, brand: 'paypal' } }) && body.private === false, { body });

    /* 2. The brand's own host, same page: nothing to read, nothing sent, no mark. */
    const b = await openPage(browser);
    await goto(browser, b.sessionId, `http://${OWN}/signin.html`);
    titles.push(await loadedTitle(b.sessionId));
    await sleep(6000);
    const ownMark = await markOf(OWN);
    result("page-shape: the same page on the brand's own host sends nothing and gets no mark", batchFor(OWN).length === 0 && Boolean(ownMark) && ownMark.text === '', { ownMark, batches: batchFor(OWN).length });

    /* 3. An honest page with its own sign-in: read (the address is on a free host), nothing in it names a brand, no mark. */
    const c = await openPage(browser);
    await goto(browser, c.sessionId, `http://${HONEST}/home.html`);
    titles.push(await loadedTitle(c.sessionId));
    result('page-shape: the three stand-in pages really loaded (none is a browser error page)', titles[0] === BRAND_TITLE && titles[1] === BRAND_TITLE && titles[2] === 'Acme dashboard', { titles });
    const honestRead = await waitFor(() => batchFor(HONEST).length > 0, 40);
    await sleep(2000);
    const honestMark = await markOf(HONEST);
    const honestHint = honestRead ? Object.values(JSON.parse(batchFor(HONEST)[0].body).hints)[0] : null;
    result('page-shape: an honest page on a free host is not marked, and no brand leaves', Boolean(honestMark) && honestMark.text === '' && (!honestHint || honestHint.facts.brand === null), { honestMark, honestHint });

    /* 4. A private window: the page is never read, nothing is sent about it. */
    const allowed = await evalIn(browser, opt.sessionId, 'chrome.extension.isAllowedIncognitoAccess()');
    await evalIn(browser, opt.sessionId, `chrome.windows.create({ incognito: true, url: 'http://${PRIVATE}/signin.html' }).then(() => 1)`);
    const asked = await waitFor(() => sent.some((r) => r.path.includes('/live/visit') && r.body.includes(PRIVATE)), 80);
    await sleep(6000);
    result('page-shape: a private window is checked as private and its page is never read: no facts go', allowed === true && Boolean(asked) && batchFor(PRIVATE).length === 0,
      { allowed, visited: Boolean(asked), batches: batchFor(PRIVATE).length });

    /* 5. Everything the companion sent, read once more: no page text, title, or typed word in any request. */
    const everything = sent.map((r) => r.body).join('\n');
    result('page-shape: no request the companion made carries the page title or any text from a page', !everything.includes(BRAND_TITLE) && !/Welcome back|Acme dashboard/.test(everything), { requests: sent.length });
  } finally {
    await close();
    files.server.close();
    proxy.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkPageShape;
