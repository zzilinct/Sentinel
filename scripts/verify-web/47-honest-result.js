'use strict';
/**
 * honest-result  The scan result as a person reads it, from the real server's answers: safe, warning, scam, partly
 *                checked and a scam partly checked, at phone and desktop width, in dark and light. The verdict comes
 *                first with the reason that matters most; the rest opens on demand, by keyboard too; what did not run
 *                is one line; and nothing is green, or says "Clear", when part of the scan could not run.
 *                A text message and a QR code land on the same page, with the same rules: a text whose link could not
 *                be checked is partly checked, a Wi-Fi code was read and not checked, so neither is ever green; a link
 *                in a QR code is one answer, the link's own. At phone width a QR picture's answer is in view and its
 *                heading has the focus.
 *                A picture of each (honest-<state>-<size>-<theme>.png), of the opened details, and of the QR flow
 *                on a phone (honest-flow-<code>-phone-<theme>.png).
 */
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, QR, sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, pressKey } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const THEMES = ['dark', 'light'];
const SCAM = 'https://paypa1-secure-login.com/account/verify';
const LISTED = 'https://metamask-wallet-restore.cfd/';
// Words on an address, no list involved: the first one that gets a warning short of red is the warning state.
const WARNINGS = ['https://secure-account-update.top/', 'https://amaz0n-delivery-update.shop/track', 'https://login-verify-account.xyz/signin'];
const PARCEL = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://usps-redeliver.top/pay';
const RULE_ID = /\b(?:[UKCRPXEFTY]\d{2}|D-limit|EL-\w+)\b/;

// The feed list as the server has it, read from its source: this script must not load the server's database code.
const feedIds = () => [...fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'feeds.js'), 'utf8').matchAll(/^\s*\{ id: '(\w+)', name:/gm)].map((m) => m[1]);

/** The throwaway server's lists marked as loaded, one left out when `missing` is set. Nothing is downloaded. */
function markLists(dbPath, missing) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath.replace(/\.db$/i, '-feeds.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const ids = feedIds();
  const put = db.prepare('INSERT INTO feed_status (source, fetched_at, entries, ok, error) VALUES (?, ?, 1, 1, NULL) ON CONFLICT(source) DO UPDATE SET ok = 1, entries = 1, error = NULL');
  for (const id of ids) put.run(id, Date.now());
  if (missing) db.prepare('DELETE FROM feed_status WHERE source = ?').run(ids[0]);
  db.close();
  return ids.length;
}

async function checkHonestResult() {
  const server = await startServer('honest');
  const { base, dbPath } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
    await goto(browser, s, `${base}/login`);
    const email = `honest-${Date.now()}@example.com`;
    const password = 'Honest-Check-Lamp-2026';
    const a = await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    const b = await api('/auth/login', { email, password });
    if (a.status !== 201 || b.status !== 200) throw new Error(`the test account could not sign in: ${a.status} ${b.status}`);

    /* ------------------------------------------------- the server's own answers */

    const scan = async (url) => { const r = await api('/scan/link', { url, mode: 'fast' }); if (r.status !== 200) throw new Error(`${url}: ${r.status} ${JSON.stringify(r.body)}`); return r.body.verdict; };
    const lists = markLists(dbPath, false);
    const safe = await scan('https://github.com');
    let warning = null;
    for (const url of WARNINGS) { const v = await scan(url); if (['yellow', 'orange'].includes(v.overall.badge)) { warning = v; break; } }
    const scam = await scan(SCAM);
    const text = async (body) => { const r = await api('/scan/text', body); if (r.status !== 200) throw new Error(`text: ${r.status} ${JSON.stringify(r.body)}`); return r.body.text; };
    const qr = async (code) => (await api('/scan/qr', { text: code })).body.qr;
    const textClear = await text({ from: 'Mom', text: 'Lunch is at 1, the menu is on https://github.com/' });
    const textScam = await text({ from: '+1 (415) 555-0199', text: PARCEL });
    const qrLink = await scan('https://www.example.com/menu?table=12');
    markLists(dbPath, true);
    const partly = await scan('https://example-bakery.com/');
    const scamPartly = await scan(LISTED);
    const textPartly = await text({ from: '', text: 'Your order is ready, details at https://example-bakery.com/order' });
    const qrWifi = await qr('WIFI:T:WPA;S:Cafe Guest;');
    const qrSignIn = await qr('https://discord.com/ra/abc123');

    result('honest-result: the server says how much of each scan ran', safe.coverage.complete && scam.coverage.complete && !partly.coverage.complete && !scamPartly.coverage.complete,
      [lists, safe, warning, scam, partly, scamPartly].map((v) => (v && v.coverage ? JSON.stringify(v.coverage) : String(v))));
    if (!warning) throw new Error('none of the warning addresses got a warning');

    await goto(browser, s, `${base}/app/check`, "document.querySelector('[data-check-text]')");
    const VERDICTS = { safe, warning, scam, partly, 'scam-partly': scamPartly };
    // Each kind of answer, drawn the way the Check page draws it: through its shape, by the one result page.
    const STATES = { ...VERDICTS, 'text-clear': ['text', textClear, 'Mom'], 'text-scam': ['text', textScam, '+1 (415) 555-0199'], 'text-partly': ['text', textPartly, ''],
      'qr-link': ['link', qrLink], 'qr-wifi': ['qr', qrWifi], 'qr-signin': ['qr', qrSignIn] };
    const show = (v) => evalIn(browser, s, `(() => { const out = document.querySelector('[data-out]'); const given = ${JSON.stringify(v)}; const [kind, d, from] = Array.isArray(given) ? given : ['verdict', given];
      out.innerHTML = kind === 'text' ? UI.result(UI.fromText(d, from)) : kind === 'qr' ? UI.result(UI.fromQr(d)) : UI.verdict(d, { via: kind === 'link' ? 'From a QR code' : null });
      UI.wireVerdict(out, kind === 'verdict' || kind === 'link' ? d : null); window.scrollTo(0, 0); return true; })()`);
    const read = () => evalIn(browser, s, `(() => { const r = document.querySelector('[data-out] [data-result]'); const seen = (e) => e && e.checkVisibility();
      return { title: r.querySelector('h2').textContent.trim(), tone: [...r.classList].find((c) => /^result--/.test(c)), lead: r.querySelector('.result__lead').textContent, partly: (r.querySelector('[data-partly]') || {}).textContent || '',
        notRun: [...r.querySelectorAll('[data-not-run]')].map((e) => e.textContent), glyph: getComputedStyle(r.querySelector('.result__glyph')).color, text: r.innerText, all: r.textContent,
        via: (r.querySelector('.result__via') || {}).textContent || '', results: document.querySelectorAll('[data-out] [data-result]').length,
        tiles: seen(r.querySelector('.threat-list')), checklist: seen(r.querySelector('.result__checklist')), green: getComputedStyle(document.documentElement).getPropertyValue('--green').trim(),
        wide: document.documentElement.scrollWidth - innerWidth, grey: r.querySelectorAll('.check--skip, [data-status=skip]').length }; })()`);

    /* ----------------------------------------------------------- what each says */

    const seen = {};
    for (const [name, v] of Object.entries(STATES)) { await show(v); seen[name] = await read(); }
    const summary = Object.fromEntries(Object.entries(seen).map(([k, r]) => [k, { title: r.title, tone: r.tone, lead: r.lead, partly: r.partly, notRun: r.notRun }]));
    result('honest-result: safe is green only because the scan ran in full', seen.safe.tone === 'result--clear' && seen.safe.title === 'No threats found' && !seen.safe.partly, summary.safe);
    result('honest-result: a warning leads with one plain reason', /result--(yellow|orange)/.test(seen.warning.tone) && !RULE_ID.test(seen.warning.lead) && seen.warning.lead.length > 20, summary.warning);
    result('honest-result: a scam leads with one plain reason and stays red', seen.scam.tone === 'result--red' && !RULE_ID.test(seen.scam.lead) && seen.scam.lead.length > 20, summary.scam);
    result('honest-result: partly checked is never green and never says clear',
      seen.partly.tone === 'result--partial' && seen.partly.title === 'Partly checked' && /Not checked: 1 of \d+ threat lists/.test(seen.partly.partly) && /not a sign of danger/.test(seen.partly.partly)
        && !/No threats found/.test(seen.partly.all) && !/\bClear\b/.test(seen.partly.all), summary.partly);
    result('honest-result: a scam that was partly checked is still a scam, and says it was partly checked', seen['scam-partly'].tone === 'result--red' && /^Partly checked\. Not checked/.test(seen['scam-partly'].partly) && !/not a sign of danger/.test(seen['scam-partly'].all), summary['scam-partly']);
    result('honest-result: a text whose links were all checked, with nothing found, is green', seen['text-clear'].tone === 'result--clear' && seen['text-clear'].title === 'No signs of a scam', summary['text-clear']);
    result('honest-result: a scam text leads with one plain reason and is not green', /result--(red|orange)/.test(seen['text-scam'].tone) && !RULE_ID.test(seen['text-scam'].lead) && seen['text-scam'].lead.length > 20, summary['text-scam']);
    result('honest-result: a text whose link was partly checked is partly checked, never green, never "No signs of a scam"',
      seen['text-partly'].tone === 'result--partial' && seen['text-partly'].title === 'Partly checked' && /Not checked: 1 of \d+ threat lists/.test(seen['text-partly'].partly)
        && !/No signs of a scam|\bClear\b/.test(seen['text-partly'].all), summary['text-partly']);
    result('honest-result: a Wi-Fi code was read, not checked: grey, and it says what was not checked', seen['qr-wifi'].tone === 'result--partial' && /Not checked: the network itself/.test(seen['qr-wifi'].partly), summary['qr-wifi']);
    result('honest-result: a sign-in QR code is red on what it does', seen['qr-signin'].tone === 'result--red', summary['qr-signin']);
    result('honest-result: a link in a QR code is one answer, the link\'s, saying where it came from', seen['qr-link'].results === 1 && seen['qr-link'].via === 'From a QR code', { ...summary['qr-link'], via: seen['qr-link'].via });
    const states = Object.entries(seen);
    const verdicts = states.filter(([k]) => k in VERDICTS);
    result('honest-result: what did not run is one line, with no grey rows', verdicts.every(([, r]) => r.notRun.length === 1 && /did not run\./.test(r.notRun[0])) && states.every(([, r]) => !r.grey), states.map(([k, r]) => `${k}: ${r.notRun[0]}`));
    result('honest-result: the details stay closed until asked for', states.every(([, r]) => !r.tiles && !r.checklist));
    result('honest-result: no rule id anywhere on the page, the opened details included', states.every(([, r]) => !RULE_ID.test(r.all)), states.filter(([, r]) => RULE_ID.test(r.all)).map(([k, r]) => `${k}: ${RULE_ID.exec(r.all)[0]}`));

    /* ------------------------------------------------------------- the keyboard */

    await show(scam);
    await evalIn(browser, s, "(() => { const h = document.querySelector('[data-out] h2'); h.tabIndex = -1; h.focus(); return true; })()");
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) { await pressKey(browser, s, 'Tab'); reached = await evalIn(browser, s, "document.activeElement.matches('[data-more] > summary')"); }
    const ring = reached && await evalIn(browser, s, "(() => { const c = getComputedStyle(document.activeElement); return `${c.outlineStyle} ${c.outlineWidth}`; })()");
    await pressKey(browser, s, 'Enter');
    await sleep(200);
    const opened = await evalIn(browser, s, "document.querySelector('[data-more]').open");
    await pressKey(browser, s, 'Enter');
    await sleep(200);
    const closed = await evalIn(browser, s, "!document.querySelector('[data-more]').open");
    result('honest-result: Tab reaches the details with a visible ring, and Enter opens and closes them', reached && /^solid/.test(ring) && opened && closed, { reached, ring, opened, closed });

    /* ---------------------------------------------------------------- pictures */

    // The whole result, however tall: the app's own scrolling boxes laid out at full height for the picture.
    const picture = async (name) => {
      const clip = await evalIn(browser, s, `(async () => {
        for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
        document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
        // Measured once it has stopped moving: a result measured mid-entrance was pictured off its own edges.
        const moving = document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations !== Infinity);
        await Promise.race([Promise.all(moving.map((a) => a.finished.catch(() => null))), new Promise((done) => setTimeout(done, 2000))]);
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const r = document.querySelector('[data-out] [data-result]').getBoundingClientRect();
        return { x: Math.max(0, r.left + scrollX - 8), y: Math.max(0, r.top + scrollY - 8), width: Math.min(r.width + 16, innerWidth), height: Math.min(r.height + 16, 3800) };
      })()`);
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...clip, scale: 1 } }, s);
      fs.writeFileSync(path.join(OUT, `honest-${name}.png`), Buffer.from(data, 'base64'));
    };
    const wide = [];
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of THEMES) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        for (const [name, v] of Object.entries(STATES)) {
          await show(v);
          await sleep(350);
          const r = await read();
          if (r.wide > 0) wide.push(`${name} ${size} ${theme}: ${r.wide} px`);
          await picture(`${name}-${size}-${theme}`);
          if (name === 'scam' || name === 'partly' || name === 'text-partly') {
            await evalIn(browser, s, "(document.querySelector('[data-more]').open = true, 1)");
            await sleep(250);
            await picture(`${name}-${size}-${theme}-open`);
          }
        }
      }
    }
    result('honest-result: no result scrolls sideways at either size, in either theme', !wide.length, wide);

    /* ------------------------------------- a QR picture on a phone, the real way */

    // A picture chosen with Add a file or picture, at phone width: the answer is where the person is looking, and a
    // screen reader is taken to it. The photo of the code stays above it, so the answer starts below the fold.
    const landed = [];
    // The states above used up the Free plan's fast scans: the link in the code needs one.
    if ((await api('/billing/plan', { plan: 'max' })).status !== 200) throw new Error('the test account could not move to Max');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    for (const theme of THEMES) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, s);
      for (const [code, picture] of [['wifi', 'wifi.png'], ['link', 'plain.png']]) {
        const file = path.join(QR, picture);
        if (!fs.existsSync(file)) { landed.push({ code, missing: file }); continue; }
        await goto(browser, s, `${base}/app/check`, "document.querySelector('[data-file]')");
        const { root } = await browser.send('DOM.getDocument', { depth: 0 }, s);
        const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-file]' }, s);
        await browser.send('DOM.setFileInputFiles', { nodeId, files: [file] }, s);
        let at = null;
        for (let i = 0; i < 120 && !at; i++) { await sleep(250); at = await evalIn(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && r.querySelector('h2').textContent.trim(); })()"); }
        await sleep(1200);   // a smooth scroll settles
        const where = await evalIn(browser, s, `(() => { const h = document.querySelector('[data-out] [data-result] h2'); if (!h) return null; const b = h.getBoundingClientRect();
          const bar = document.querySelector('.side'); const floor = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight;
          return { title: h.textContent.trim(), focused: document.activeElement === h, top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(floor), results: document.querySelectorAll('#view [data-result]').length,
            tone: [...h.closest('[data-result]').classList].find((c) => /^result--/.test(c)), via: (document.querySelector('[data-out] .result__via') || {}).textContent || '' }; })()`);
        landed.push({ code, theme, ...where });
        const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, s);
        fs.writeFileSync(path.join(OUT, `honest-flow-${code}-phone-${theme}.png`), Buffer.from(data, 'base64'));
      }
    }
    result('honest-result: on a phone, a QR picture\'s answer is in view, its heading has the focus, and there is one answer',
      landed.length === 4 && landed.every((w) => w.focused && w.top >= 0 && w.bottom <= w.height && w.results === 1), landed);
    result('honest-result: on a phone, the Wi-Fi code is grey and the link in a code is answered as that link',
      landed.filter((w) => w.code === 'wifi').every((w) => w.tone === 'result--partial') && landed.filter((w) => w.code === 'link').every((w) => w.via === 'From a QR code'), landed);
    result('honest-result: the page logs no error', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkHonestResult;
