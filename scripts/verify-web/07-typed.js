'use strict';
/**
 * typed     After the companion flagged a sign-in page (a password box) or a payment page (a card box) and it was
 *           closed or left, one question asks whether a password or card number was typed there, once per site;
 *           Yes opens the recovery guide with that ticked, No closes it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, typeText, TYPED_PW, clickButton } = require('./_shared');

/* ------------------------------------------- 6. did you type anything? (companion) */

// Two listed scams (server/lib/scan/lists.js), each a harmless local page here: a sign-in page with a password box
// (TYPED_PW, in _shared.js since paypause flags it too), and a payment page with a card number box.
const TYPED_CARD = 'netflix-billing-update.top';

async function checkTyped() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-typed-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'typed-server.log'), 'w');
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
  const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font:16px/1.6 system-ui,sans-serif;margin:60px">${body}</body></html>`;
  const files = await serveFiles({}, {
    '/signin.html': page('Sign in', '<h1>Sign in to your account</h1><form onsubmit="return false"><p><label>Email <input name="email"></label></p><p><label>Password <input type="password" name="password"></label></p><button>Sign in</button></form>'),
    '/pay.html': page('Update billing', '<h1>Update your payment details</h1><form onsubmit="return false"><p><label>Name on card <input name="name" autocomplete="cc-name"></label></p><p><label>Card number <input name="cardnumber" autocomplete="cc-number" inputmode="numeric"></label></p><button>Save</button></form>'),
    '/recipes.html': page('Recipes', '<h1>Banana bread</h1><p>Three ripe bananas, flour, sugar, an egg and butter.</p>')
  });
  const filesPort = new URL(files.base).port;
  const rules = [TYPED_PW, TYPED_CARD].map((h) => `MAP ${h} 127.0.0.1:${filesPort}`).join(',');
  const { browser, close } = await launch([`--host-resolver-rules=${rules}`]);
  try {
    if (!token) throw new Error(`the Sentinel server did not start on ${api} (see typed-server.log)`);
    const loaded = await browser.send('Extensions.loadUnpacked', { path: path.join(ROOT, 'extension') });
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const paired = await evalIn(browser, opt.sessionId, `(async () => {
      await chrome.storage.local.set({ authToken: ${JSON.stringify(token)} });
      await chrome.storage.sync.set({ apiBase: ${JSON.stringify(api)} });
      const r = await chrome.runtime.sendMessage({ type: 'refresh' });
      return Boolean(r && r.account && r.account.signedIn);
    })()`);
    if (!paired) throw new Error('the companion could not sign in to the test server');
    // What the worker keeps (session storage, readable from the companion's own page): never what was typed.
    const kept = () => evalIn(browser, opt.sessionId, 'chrome.storage.session.get(null)');
    const flaggedWith = async (box) => {
      let got = {};
      for (let i = 0; i < 80; i++) {
        got = await kept();
        if (Object.entries(got).some(([k, v]) => k.startsWith('typed:') && v && v[box])) return { ok: true, got };
        await sleep(250);
      }
      return { ok: false, got };
    };
    const targets = async () => (await browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').map((t) => t.url);
    const question = async (s, re, tries = 30) => {
      let text = '';
      for (let i = 0; i < tries && !re.test(text); i++) { await sleep(250); text = await pageText(browser, s); }
      return text;
    };

    // An ordinary page in one tab; the flagged sign-in page in another.
    const home = await openPage(browser);
    await goto(browser, home.sessionId, `${files.base}/recipes.html`);
    const phish = await openPage(browser);
    await goto(browser, phish.sessionId, `http://${TYPED_PW}/signin.html`, "document.querySelector('input[type=password]')");
    const flagged = await flaggedWith('pw');
    await shot(browser, phish.sessionId, 'companion-typed-flagged');
    result(`typed: ${TYPED_PW} is flagged and its password box is noticed (by the box's type, not its contents)`, flagged.ok && !/Test-only|example/.test(JSON.stringify(flagged.got)), flagged.got);

    // The flagged tab closed: the question waits for the next page the person sees, and shows there once.
    await evalIn(browser, phish.sessionId, "document.querySelector('input[type=password]').focus()");
    await typeText(browser, phish.sessionId, 'Test-only-typed-1');   // what was typed must never reach the worker
    await browser.send('Target.closeTarget', { targetId: phish.targetId });
    await browser.send('Target.activateTarget', { targetId: home.targetId });
    let asked = await question(home.sessionId, /Did you type a password on that page\?/, 20);
    let reloaded = false;
    if (!/Did you type a password on that page\?/.test(asked)) {
      // The tab may already have been in front (no activation to hear): its next page load brings the question.
      reloaded = true;
      await goto(browser, home.sessionId, `${files.base}/recipes.html`);
      asked = await question(home.sessionId, /Did you type a password on that page\?/);
    }
    await shot(browser, home.sessionId, 'companion-typed-question');
    const afterClose = JSON.stringify(await kept());
    result('typed: closing the flagged sign-in page asks "Did you type a password on that page?" on the page in front', /Did you type a password on that page\?/.test(asked) && /Yes, I did/.test(asked) && new RegExp(TYPED_PW.replace(/\./g, '\\.')).test(asked) && !/Test-only/.test(afterClose),
      { reloaded, onScreen: asked.slice(asked.indexOf('Did you type'), asked.indexOf('Did you type') + 300) });
    const before = await targets();
    const pressed = await clickButton(browser, home.sessionId, 'Yes, I did');
    let guide = null;
    for (let i = 0; i < 40 && !guide; i++) { await sleep(250); guide = (await targets()).find((u) => !before.includes(u) && /\/recover\?happened=password$/.test(u)) || null; }
    const gone = !/Did you type a password/.test(await pageText(browser, home.sessionId));
    result('typed: "Yes, I did" opens the recovery guide with the password ticked, and the question goes', pressed && Boolean(guide) && gone, { pressed, guide, gone });

    // The same site again, closed again: not asked twice.
    const again = await openPage(browser);
    await goto(browser, again.sessionId, `http://${TYPED_PW}/signin.html`, "document.querySelector('input[type=password]')");
    const seenAgain = await flaggedWith('pw');
    await browser.send('Target.closeTarget', { targetId: again.targetId });
    await browser.send('Target.activateTarget', { targetId: home.targetId });
    await goto(browser, home.sessionId, `${files.base}/recipes.html`);
    await sleep(2500);
    const twice = /Did you type/.test(await pageText(browser, home.sessionId));
    result('typed: the same site is never asked about twice', seenAgain.ok && !twice, { seenAgain: seenAgain.ok, askedAgain: twice });

    // A card page left for another site in the same tab: asked on the next page, about a card number. No closes it.
    const pay = await openPage(browser);
    await goto(browser, pay.sessionId, `http://${TYPED_CARD}/pay.html`, "document.querySelector('input[autocomplete=cc-number]')");
    const card = await flaggedWith('card');
    await goto(browser, pay.sessionId, `${files.base}/recipes.html`);
    const cardAsk = await question(pay.sessionId, /Did you type a card number on that page\?/);
    await shot(browser, pay.sessionId, 'companion-typed-card');
    const beforeNo = await targets();
    const no = await clickButton(browser, pay.sessionId, 'No');
    await sleep(1500);
    const noGone = !/Did you type/.test(await pageText(browser, pay.sessionId));
    const opened = (await targets()).filter((u) => !beforeNo.includes(u));
    result('typed: leaving a flagged card page asks about a card number on the next page, and No just closes it',
      card.ok && /Did you type a card number on that page\?/.test(cardAsk) && no && noGone && !opened.length, { card: card.ok, no, noGone, opened });
  } finally {
    await close();
    files.server.close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkTyped;
