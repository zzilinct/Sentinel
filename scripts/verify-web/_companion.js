'use strict';
/**
 * What the companion checks (25-companion-core, 26-companion-soak) share: the real Sentinel server on a chosen port with
 * the computer's own account, an HTTPS server for stand-in sites at real addresses (Gmail, Outlook, a bank), the
 * companion loaded and paired, and the stand-in pages themselves. Not a check: the runner only runs NN-name.js files.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const { ROOT, OUT, sleep, evalIn, openPage, goto } = require('./_shared');

function openssl() {
  for (const exe of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    if (spawnSync(exe, ['version']).status === 0) return exe;
  }
  throw new Error('openssl was not found (Git for Windows ships one)');
}

/** An HTTPS server answering for `hosts` with a throwaway certificate; handler(req, res, host). */
async function tlsServer(hosts, handler) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-tls-'));
  const r = spawnSync(openssl(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=sentinel-verify', '-addext', `subjectAltName=${hosts.map((h) => `DNS:${h}`).join(',')}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl could not make a certificate: ${r.stderr}`);
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) },
    (req, res) => handler(req, res, String(req.headers.host || '').split(':')[0]));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    port,
    rules: hosts.map((h) => `MAP ${h} 127.0.0.1:${port}`).join(','),
    close: () => { server.close(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } }
  };
}

/**
 * The real Sentinel server, as the Windows app runs it (device accounts on, the demo plans), on `port`: 47821 is the
 * address the companion trusts for pairing with the app. Returns { base, deviceToken(), stop }.
 */
async function startSentinel(name, port) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), `sentinel-${name}-db-`));
  const log = fs.openSync(path.join(OUT, `${name}-server.log`), 'w');
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', log, log],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), SENTINEL_DEVICE_ACCOUNTS: '1', FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo', PUBLIC_ORIGIN: base }
  });
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const stop = async () => { child.kill(); await sleep(500); try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ } };
  if (!up) { await stop(); throw new Error(`the Sentinel server did not start on ${base} (see ${name}-server.log; is the port taken?)`); }
  const deviceToken = async () => {
    const r = await fetch(`${base}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' });
    return (await r.json()).token;
  };
  return { base, deviceToken, stop };
}

/** Load the companion into this Chrome and wait for its worker. Returns its id. */
async function loadCompanion(browser) {
  const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
  for (let i = 0; i < 40; i++) {
    if (await workerTarget(browser, loaded.id)) return loaded.id;
    await sleep(250);
  }
  throw new Error('the companion loaded but its service worker never started');
}

async function workerTarget(browser, id) {
  const { targetInfos } = await browser.send('Target.getTargets');
  return targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${id}/`)) || null;
}

/** Stop the companion's worker, as Chrome does after about 30 seconds idle. */
async function stopWorker(browser, id) {
  const sw = await workerTarget(browser, id);
  if (sw) await browser.send('Target.closeTarget', { targetId: sw.targetId }).catch(() => {});
  let gone = false;
  for (let i = 0; i < 20 && !gone; i++) { await sleep(250); gone = !(await workerTarget(browser, id)); }
  return { was: Boolean(sw), gone };
}

/** A tab on the companion's options page, signed in with `token` against `base` (what pairing leaves behind). */
async function pairedOptions(browser, id, base, token) {
  const opt = await openPage(browser);
  await goto(browser, opt.sessionId, `chrome-extension://${id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
  if (token) {
    const ok = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(base)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!ok) throw new Error('the companion could not sign in to the test server');
  }
  return opt;
}

/* ------------------------------------------------------------ stand-in pages */

const page = (title, body, head = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${head}</head><body style="font:14px/1.5 Arial,sans-serif;margin:0;background:#fff;color:#202124">${body}</body></html>`;

// [name, address, subject, snippet]. The last two are listed scams (server/lib/scan/lists.js).
const MAIL = [
  ['PayPal', 'service@paypal.com', 'Your receipt from Etsy', 'You sent a payment of 24.00 USD to Etsy.'],
  ['Grandma', 'grandma.rose@gmail.com', 'Sunday lunch', 'Bring the kids, I am making the roast.'],
  ['GitHub', 'noreply@github.com', 'Your pull request was merged', 'Merged into main.'],
  ['PayPal Security', 'security@paypa1-secure-login.com', 'Your account is limited', 'Verify your account within 24 hours at paypa1-secure-login.com or it will be closed.'],
  ['Netflix Billing', 'billing@netflix-billing-update.top', 'Payment declined', 'Update your card now at netflix-billing-update.top to keep watching.']
];

/** Gmail's inbox list and an open message, in the class names Gmail uses (content/mail.js reads these). */
function gmailPage(extraRows = 0) {
  const row = ([name, address, subject, snippet], i) => `<tr class="zA" id="r${i}"><td class="yX"><div class="yW"><span email="${address}" name="${name}">${name}</span></div></td>`
    + `<td><span class="bog">${subject}</span><span class="y2"> - ${snippet}</span></td><td>9:4${i % 10} AM</td></tr>`;
  const rows = [...MAIL, ...Array.from({ length: extraRows }, (_, i) => [`Shop ${i}`, `news${i}@shop${i}.example`, `Weekly deals ${i}`, 'New arrivals this week.'])];
  return page('Inbox - Gmail', `<div role="main" style="display:flex"><table style="border-collapse:collapse;width:640px"><tbody id="list">${rows.map(row).join('')}</tbody></table>
    <div style="padding:16px;width:520px"><h2 class="hP">Your account is limited</h2><div class="adn ads"><div><span class="gD" email="security@paypa1-secure-login.com" name="PayPal Security">PayPal Security</span></div>
    <div class="a3s"><p>We noticed unusual activity. Verify your account within 24 hours or it will be closed.</p><p><a href="http://paypa1-secure-login.com/verify">Verify now</a></p></div></div></div></div>
    <script>window.addMail = (n) => { const list = document.getElementById('list'); for (let i = 0; i < n; i++) { const k = list.children.length;
      list.insertAdjacentHTML('afterbegin', '<tr class="zA"><td class="yX"><div class="yW"><span email="news' + k + '@shop' + k + '.example" name="Shop ' + k + '">Shop ' + k + '</span></div></td><td><span class="bog">Deals ' + k + '</span><span class="y2"> - New arrivals.</span></td><td>now</td></tr>'); } };</script>`);
}

/** Outlook on the web's message list, in the roles and attributes Outlook uses. */
function outlookPage() {
  const row = ([name, address, subject, snippet], i) => `<div role="option" aria-label="${name} ${subject} ${snippet}" data-convid="c${i}" style="padding:8px;border-bottom:1px solid #eee">`
    + `<span title="${address}">${name}</span><div>${subject}</div><div style="color:#666">${snippet}</div></div>`;
  return page('Mail - Outlook', `<div role="listbox" aria-label="Message list" style="width:520px">${MAIL.map(row).join('')}</div>`);
}

module.exports = { tlsServer, startSentinel, loadCompanion, workerTarget, stopWorker, pairedOptions, page, gmailPage, outlookPage, MAIL };
