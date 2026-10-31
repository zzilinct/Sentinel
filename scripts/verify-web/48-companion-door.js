'use strict';
/**
 * companion-door  A confirmed bad site stops before it loads, without slowing anything else, in a real headless Chrome
 *                 with the real server behind a proxy that can make the scanner slow (5 s).
 *   1. A listed site: the local server that stands in for it never gets one request, with the worker awake and stopped.
 *      Back, Continue anyway (twice pressed, in one tab only), a link in a new tab, the switch off.
 *   2. A page the scanner flags after it opened: it opens without waiting; when the slow verdict comes the page and its
 *      password box are gone, and Back does not return to it. A tab that moved on meanwhile is left alone.
 *   3. A red answer from the scanner closes the door on that address, not on the rest of its site.
 *   4. Nobody can fake the block page: an honest address after its # goes straight to the site, and in a frame it is blank.
 *   5. An honest page is not touched and not held.
 *   6. Pictures: the block page, the popup and the settings, desktop and phone, light and dark, for a person to look at.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, TYPED_PW, passBlock, until } = require('./_shared');
const { stopWorker, workerTarget } = require('./_companion');

const LISTED = TYPED_PW;
const LONG_LISTED = 'netflix-billing-update.top';
const SLOW_CANDIDATES = ['paypal-account-verify-login.top', 'secure-paypal-login-alert.top', 'apple-id-locked-alert.top', 'amazon-account-locked-verify.top', 'wallet-restore-connect.top'];
const SHOWN = "document.getElementById('pass') && document.getElementById('pass').onclick";
const freePort = () => new Promise((resolve) => { const sv = net.createServer().listen(0, '127.0.0.1', () => { const p = sv.address().port; sv.close(() => resolve(p)); }); });

async function checkCompanionDoor() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-door-db-'));
  const log = fs.openSync(path.join(OUT, 'companion-door-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], { cwd: ROOT, stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0' } });
  const api = `http://127.0.0.1:${port}`;
  let token = null;
  for (let i = 0; i < 120 && !token; i++) {
    await sleep(500);
    try { const r = await fetch(`${api}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: api }, body: '{}' }); if (r.ok) token = (await r.json()).token; } catch { /* still starting */ }
  }

  // The scanner, slowed for page checks while `slow` is set.
  let slow = 0;
  const proxy = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      if (slow && req.url.startsWith('/api/v1/live/visit')) await sleep(slow);
      const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); });
      up.end(Buffer.concat(chunks));
    });
  });
  const proxyPort = await freePort();
  await new Promise((resolve) => proxy.listen(proxyPort, '127.0.0.1', resolve));

  // The stand-in sites, which count every request by host.
  const hits = {};
  const SIGNIN = '<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body style="font:16px sans-serif;margin:40px;background:#fff;color:#111"><h1>Sign in to your account</h1><form onsubmit="return false"><label>Password <input id="pw" type="password"></label></form><script>window.ran = true;</script></body></html>';
  const stand = http.createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    hits[host] = (hits[host] || 0) + 1;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(SIGNIN);
  });
  const standPort = await freePort();
  await new Promise((resolve) => stand.listen(standPort, '127.0.0.1', resolve));
  const files = await serveFiles({}, {
    '/start.html': `<!doctype html><html><head><meta charset="utf-8"><title>Start</title></head><body><h1>A page before</h1><a id="out" target="_blank" href="http://${LISTED}/new-tab">Open it in a new tab</a>
      <iframe id="f" title="frame" style="width:600px;height:300px"></iframe></body></html>`
  });
  const filesPort = new URL(files.base).port;
  const hosts = [LISTED, LONG_LISTED, ...SLOW_CANDIDATES, 'plain.test', 'moved.test'];
  const { browser, close } = await launch([`--host-resolver-rules=${hosts.map((h) => `MAP ${h} 127.0.0.1:${standPort}`).join(',')},MAP start.test 127.0.0.1:${filesPort}`]);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api}`);
    const via = `http://127.0.0.1:${proxyPort}`;
    const visit = async (url) => (await (await fetch(`${api}/api/v1/live/visit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ url }) })).json()).verdict || {};
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const ext = `chrome-extension://${loaded.id}`;
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    // Signed out first, for its picture.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 620, deviceScaleFactor: 2, mobile: false }, opt.sessionId);
    const pictures = async (s, name) => {
      for (const [scheme, label] of [['dark', 'dark'], ['light', 'light']]) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, s);
        await sleep(300);
        await shot(browser, s, `companion-door-${name}-${label}`);
      }
      await browser.send('Emulation.setEmulatedMedia', { features: [] }, s);
    };
    const size = (s, width, height) => browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: width < 500 ? 2 : 1, mobile: false }, s);
    const web = await openPage(browser);
    await goto(browser, web.sessionId, `http://start.test/start.html`);
    // The popup, as a tab behind the page it is about.
    async function popup(name) {
      await browser.send('Target.activateTarget', { targetId: web.targetId });
      const { targetId } = await browser.send('Target.createTarget', { url: `${ext}/src/popup.html`, background: true });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      await browser.send('Page.enable', {}, sessionId);
      await size(sessionId, 360, 480);
      await until(browser, sessionId, "document.readyState === 'complete' && !document.querySelector('#view .spin')", 20000);
      await sleep(500);
      const text = await evalIn(browser, sessionId, "document.getElementById('view').innerText.replace(/\\s+/g, ' ').trim()");
      await pictures(sessionId, `popup-${name}`);
      await browser.send('Target.closeTarget', { targetId }).catch(() => {});
      return text;
    }
    await sleep(1500);
    const signedOut = await popup('signed-out');
    const bare = await pageTextOf(`http://${LISTED}/signed-out`);
    async function pageTextOf(url) { const t = await openPage(browser); await goto(browser, t.sessionId, url); await sleep(600); const x = await pageText(browser, t.sessionId); await browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {}); return x; }
    result('companion-door: signed out, the popup asks to sign in, and it claims no protection, and the door is not closed on anybody', /Sign in to Sentinel/.test(signedOut) && !/No warning signs/.test(signedOut) && /Sign in to your account/.test(bare), { signedOut, bare: bare.slice(0, 80) });
    delete hits[LISTED];

    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(via)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');
    const rules = () => evalIn(browser, opt.sessionId, 'chrome.declarativeNetRequest.getDynamicRules().then((r) => r.length ? r[0].condition.requestDomains.length : 0)');
    let doorHosts = 0;
    for (let i = 0; i < 40 && !doorHosts; i++) { await sleep(250); doorHosts = await rules(); }
    result('companion-door: the confirmed list is one rule in the browser', doorHosts > 0, { doorHosts });

    /* 1. A listed site. */
    const tab = await openPage(browser);
    await goto(browser, tab.sessionId, 'http://start.test/start.html');
    const t0 = Date.now();
    await goto(browser, tab.sessionId, `http://${LISTED}/signin.html`, SHOWN);
    const shownIn = Date.now() - t0;
    const stopped = { hits: hits[LISTED] || 0, href: await evalIn(browser, tab.sessionId, 'location.href'), text: await pageText(browser, tab.sessionId) };
    result(`companion-door: ${LISTED} never loads: its server got no request, and the block page says so (${shownIn} ms)`,
      stopped.hits === 0 && stopped.href.startsWith(`${ext}/src/block.html#http://${LISTED}/signin.html`) && /confirmed scam site/.test(stopped.text) && /stopped it before it opened/.test(stopped.text) && /Take me back to safety|Go to the real/.test(stopped.text) && !/Continue anyway/.test(await evalIn(browser, tab.sessionId, 'document.body.innerText')), { ...stopped, shownIn });

    await stopWorker(browser, loaded.id);
    const workerGone = !(await workerTarget(browser, loaded.id));
    const asleep = await openPage(browser);
    await goto(browser, asleep.sessionId, `http://${LISTED}/asleep`, SHOWN);
    await sleep(400);
    result('companion-door: with the worker stopped too: no request, and the block page still has its words', workerGone && (hits[LISTED] || 0) === 0 && /confirmed scam site/.test(await pageText(browser, asleep.sessionId)), { workerGone, hits: hits[LISTED] || 0 });
    await browser.send('Target.closeTarget', { targetId: asleep.targetId }).catch(() => {});

    await evalIn(browser, tab.sessionId, "document.getElementById('back') ? document.getElementById('back').click() : document.getElementById('go').click()");
    const backed = await until(browser, tab.sessionId, "location.hostname === 'start.test' && document.readyState === 'complete'", 8000);
    result('companion-door: Take me back goes to the page before', Boolean(backed), { href: await evalIn(browser, tab.sessionId, 'location.href') });

    await goto(browser, tab.sessionId, `http://${LISTED}/signin.html`, SHOWN);
    await evalIn(browser, tab.sessionId, "(() => { document.getElementById('more').open = true; const b = document.getElementById('pass'); b.click(); b.click(); })()");
    const opened = await until(browser, tab.sessionId, "location.hostname !== '' && /^http/.test(location.href) && window.ran === true", 8000);
    await sleep(2000);
    await browser.send('Page.reload', {}, tab.sessionId);
    await sleep(1800);
    const stays = await evalIn(browser, tab.sessionId, "/^http/.test(location.href) && window.ran === true").catch(() => false);
    const other = await openPage(browser);
    await goto(browser, other.sessionId, `http://${LISTED}/signin.html`, SHOWN);
    const otherStopped = /block\.html/.test(await evalIn(browser, other.sessionId, 'location.href'));
    await browser.send('Target.closeTarget', { targetId: other.targetId }).catch(() => {});
    result('companion-door: Continue anyway, pressed twice, opens the site in that tab, a reload stays open, and another tab is still stopped', Boolean(opened) && stays && otherStopped, { opened, stays, otherStopped });
    await browser.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {});

    // A link opened in a new tab has nothing to go back to: the tab closes.
    const count = async () => (await browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').length;
    await goto(browser, web.sessionId, 'http://start.test/start.html');
    const before = await count();
    await evalIn(browser, web.sessionId, "document.getElementById('out').click()", { userGesture: true });
    let fresh = null;
    for (let i = 0; i < 40 && !fresh; i++) { await sleep(250); fresh = (await browser.send('Target.getTargets')).targetInfos.find((t) => t.type === 'page' && /block\.html#.*new-tab/.test(t.url)) || null; }
    let closedTab = false;
    if (fresh) {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: fresh.targetId, flatten: true });
      await until(browser, sessionId, SHOWN, 8000);
      await evalIn(browser, sessionId, "document.getElementById('back') ? document.getElementById('back').click() : document.getElementById('go').click()").catch(() => {});
      for (let i = 0; i < 20 && !closedTab; i++) { await sleep(250); closedTab = (await count()) === before; }
    }
    result('companion-door: a link opened in a new tab is stopped too, and Take me back closes that tab', Boolean(fresh) && closedTab, { fresh: Boolean(fresh), closedTab });

    /* 2. A page the scanner flags after it opened, slowly. */
    let FLAG = null;
    const badges = {};
    for (const h of SLOW_CANDIDATES) { const v = await visit(`http://${h}/signin.html`); badges[h] = v.overall && v.overall.badge; if (!FLAG && badges[h] === 'red') FLAG = h; }
    FLAG = FLAG || SLOW_CANDIDATES.find((h) => badges[h] === 'orange');
    result('companion-door: the scanner flags a look-alike that is not on the list', Boolean(FLAG), badges);
    await evalIn(browser, opt.sessionId, "chrome.runtime.sendMessage({ type: 'refresh' }).then(() => 1)");
    slow = 5000;
    const late = await openPage(browser);
    await goto(browser, late.sessionId, 'http://start.test/start.html');
    const t1 = Date.now();
    await goto(browser, late.sessionId, `http://${FLAG}/signin.html`, "document.getElementById('pw')");
    const openedIn = Date.now() - t1;
    await evalIn(browser, late.sessionId, "document.getElementById('pw').focus()");
    const closed = await until(browser, late.sessionId, "/block\\.html\\?seen=1/.test(location.href)", 15000);
    await until(browser, late.sessionId, SHOWN, 8000);
    const box = await evalIn(browser, late.sessionId, "Boolean(document.getElementById('pw'))");
    const closedText = await pageText(browser, late.sessionId);
    await browser.send('Page.bringToFront', {}, late.sessionId);
    result(`companion-door: a page the scanner has not answered for opens at once (${openedIn} ms, the scanner takes 5 s); when the answer comes it is gone, box and all, and the page says so honestly`,
      openedIn < 4000 && Boolean(closed) && !box && /closed it when the check finished/.test(closedText) && /recovery guide/.test(closedText), { openedIn, closed, box, closedText: closedText.slice(0, 300) });
    await size(late.sessionId, 1366, 860); await sleep(900);
    await pictures(late.sessionId, 'closed-desktop');
    await size(late.sessionId, 360, 740); await sleep(500);
    await pictures(late.sessionId, 'closed-phone');
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, late.sessionId);
    await evalIn(browser, late.sessionId, "history.back()").catch(() => {});
    const noReturn = await until(browser, late.sessionId, "location.hostname === 'start.test'", 6000);
    result('companion-door: Back from there goes to the page before, not to the flagged page', Boolean(noReturn), { href: await evalIn(browser, late.sessionId, 'location.href') });

    // Moved on before the answer: the tab it was about is on another site now and is left alone.
    await evalIn(browser, opt.sessionId, "chrome.runtime.sendMessage({ type: 'refresh' }).then(() => 1)");
    const moved = await openPage(browser);
    await goto(browser, moved.sessionId, `http://${FLAG}/moved-on`);
    await goto(browser, moved.sessionId, 'http://moved.test/here');
    await sleep(6500);
    const movedHref = await evalIn(browser, moved.sessionId, 'location.href');
    await browser.send('Target.closeTarget', { targetId: moved.targetId }).catch(() => {});
    slow = 0;
    result('companion-door: a tab that moved on before the slow answer came is left where it is', movedHref === 'http://moved.test/here', { movedHref });

    /* 3. A red answer closes the door on that address only. */
    if (badges[FLAG] === 'red') {
      const addr = `http://${FLAG}/result-page`;
      await evalIn(browser, opt.sessionId, `chrome.runtime.sendMessage({ type: 'live-batch', urls: [${JSON.stringify(addr)}], phase: 'quick' }).then(() => 1)`);
      await sleep(600);
      const was = hits[FLAG] || 0;
      const r = await openPage(browser);
      await goto(browser, r.sessionId, addr, SHOWN);
      const atDoor = (hits[FLAG] || 0) === was;
      await goto(browser, r.sessionId, 'http://plain.test/unrelated');
      await browser.send('Target.closeTarget', { targetId: r.targetId }).catch(() => {});
      result('companion-door: a search result the scanner called red never loads when clicked', atDoor, { was, now: hits[FLAG] });
    } else console.log(`SKIP  companion-door: the scanner gave ${FLAG} ${badges[FLAG]}, not red: a door on an address needs red`);

    /* 4. Nobody can fake it. */
    const forged = await openPage(browser);
    await goto(browser, forged.sessionId, `${ext}/src/block.html#http://plain.test/honest`, "location.hostname === 'plain.test'");
    const forgedText = await pageText(browser, forged.sessionId);
    await goto(browser, forged.sessionId, `http://start.test/start.html`);
    await evalIn(browser, forged.sessionId, `document.getElementById('f').src = ${JSON.stringify(`${ext}/src/block.html#http://${LISTED}/framed`)}`);
    await sleep(1500);
    const frames = (await browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'iframe' && t.url.includes('block.html'));
    let framedHidden = true;
    for (const f of frames) {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: f.targetId, flatten: true });
      framedHidden = framedHidden && await evalIn(browser, sessionId, 'document.documentElement.hidden');
    }
    await browser.send('Target.closeTarget', { targetId: forged.targetId }).catch(() => {});
    result('companion-door: the block page with an honest address after its # goes to the site with no warning, and inside a frame shows nothing', /Sign in to your account/.test(forgedText) && !/scam/.test(forgedText) && framedHidden, { forged: forgedText.slice(0, 80), frames: frames.length, framedHidden });

    /* 5. An honest page: not held, not touched. */
    const honest = await openPage(browser);
    const t2 = Date.now();
    await goto(browser, honest.sessionId, 'http://plain.test/signin.html', "document.getElementById('pw')");
    const honestIn = Date.now() - t2;
    await sleep(4000);
    const stayed = await evalIn(browser, honest.sessionId, "location.hostname === 'plain.test' && Boolean(document.getElementById('pw'))");
    await browser.send('Target.closeTarget', { targetId: honest.targetId }).catch(() => {});
    result(`companion-door: an honest page opens at once (${honestIn} ms) and stays`, honestIn < 4000 && stayed, { honestIn, stayed });

    /* 6. Pictures. */
    const look = await openPage(browser);
    await goto(browser, look.sessionId, `http://${LISTED}/account/verify?session=4f2a9c1e8b7d6a5f4e3d2c1b0a998877665544332211`, SHOWN);
    await until(browser, look.sessionId, "/Go to the real/.test(document.getElementById('go').textContent)", 8000);
    await size(look.sessionId, 1366, 860); await sleep(900);
    await pictures(look.sessionId, 'block-desktop');
    await evalIn(browser, look.sessionId, "document.getElementById('more').open = true");
    await sleep(200);
    await pictures(look.sessionId, 'block-desktop-why');
    await evalIn(browser, look.sessionId, "document.getElementById('more').open = false");
    await size(look.sessionId, 360, 740); await sleep(500);
    await pictures(look.sessionId, 'block-phone');
    const fit = await evalIn(browser, look.sessionId, 'document.documentElement.scrollWidth <= innerWidth');
    await evalIn(browser, look.sessionId, "document.getElementById('more').open = true; scrollTo(0, 9999)");
    await sleep(200);
    await pictures(look.sessionId, 'block-phone-why');
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, look.sessionId);
    result('companion-door: the block page fits a phone with a long address and no sideways scroll', fit, { fit });

    await goto(browser, web.sessionId, `http://${LISTED}/popup`, SHOWN);
    const popStopped = await popup('stopped');
    await passBlock(browser, web.sessionId);
    await sleep(800);
    const popFlagged = await popup('flagged');
    await goto(browser, web.sessionId, 'http://plain.test/signin.html', "document.getElementById('pw')");
    await sleep(2500);
    const popClean = await popup('clean');
    result('companion-door: the popup answers first: stopped, flagged, and for an honest page what was really found, never a green it did not earn',
      /stopped it before it opened/.test(popStopped) && /flagged this page/.test(popFlagged) && /^(No warning signs|Not checked yet)/.test(popClean) && !/left this week/.test(popClean), { popStopped, popFlagged, popClean });

    await browser.send('Emulation.clearDeviceMetricsOverride', {}, opt.sessionId);
    await size(opt.sessionId, 1366, 900);
    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "document.getElementById('headline').textContent !== 'Sentinel'");
    await sleep(500);
    const groups = await evalIn(browser, opt.sessionId, "[...document.querySelectorAll('h2')].map((h) => h.textContent)");
    const emoji = await evalIn(browser, opt.sessionId, "/\\p{Extended_Pictographic}/u.test(document.body.innerText) || Boolean(document.getElementById('badgeStyle'))");
    await pictures(opt.sessionId, 'settings-desktop');
    await size(opt.sessionId, 360, 740); await sleep(300);
    const optFit = await evalIn(browser, opt.sessionId, 'document.documentElement.scrollWidth <= innerWidth');
    await pictures(opt.sessionId, 'settings-phone');
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, opt.sessionId);
    result('companion-door: settings are Browsing, Email and chat, Password alarm and Advanced, with no emoji option, and fit a phone', String(groups) === 'Browsing,Email and chat,Password alarm,Advanced' && !emoji && optFit, { groups, emoji, optFit });

    // The switch: off, the door opens, as it says.
    await evalIn(browser, opt.sessionId, "chrome.storage.sync.set({ warnOnNavigate: false })");
    await sleep(800);
    const offHosts = await rules();
    await evalIn(browser, opt.sessionId, "chrome.storage.sync.set({ warnOnNavigate: true })");
    result('companion-door: Stop dangerous pages off takes the rule away', offHosts === 0, { offHosts });
  } finally {
    await close();
    files.server.close();
    proxy.close();
    stand.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCompanionDoor;
