'use strict';
/**
 * honest-result  The scan result as a person reads it, from the real server's answers: safe, warning, scam, partly
 *                checked and a scam partly checked, at phone and desktop width, in dark and light. The verdict comes
 *                first with the reason that matters most; the rest opens on demand, by keyboard too; what did not run
 *                is one line; and nothing is green, or says "Clear", when part of the scan could not run.
 *                A picture of each (honest-<state>-<size>-<theme>.png), and of the opened details.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, startServer, watchErrors, pressKey } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const THEMES = ['dark', 'light'];
const SCAM = 'https://paypa1-secure-login.com/account/verify';
const LISTED = 'https://metamask-wallet-restore.cfd/';
// Words on an address, no list involved: the first one that gets a warning short of red is the warning state.
const WARNINGS = ['https://secure-account-update.top/', 'https://amaz0n-delivery-update.shop/track', 'https://login-verify-account.xyz/signin'];
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
    markLists(dbPath, true);
    const partly = await scan('https://example-bakery.com/');
    const scamPartly = await scan(LISTED);

    result('honest-result: the server says how much of each scan ran', safe.coverage.complete && scam.coverage.complete && !partly.coverage.complete && !scamPartly.coverage.complete,
      [lists, safe, warning, scam, partly, scamPartly].map((v) => (v && v.coverage ? JSON.stringify(v.coverage) : String(v))));
    if (!warning) throw new Error('none of the warning addresses got a warning');

    await goto(browser, s, `${base}/app/scan`, "document.querySelector('.scanbox input')");
    const STATES = { safe, warning, scam, partly, 'scam-partly': scamPartly };
    const show = (v) => evalIn(browser, s, `(() => { const out = document.querySelector('[data-out]'); const v = ${JSON.stringify(v)}; out.innerHTML = UI.verdict(v); UI.wireVerdict(out, v); window.scrollTo(0, 0); return true; })()`);
    const read = () => evalIn(browser, s, `(() => { const r = document.querySelector('[data-out] [data-result]'); const seen = (e) => e && e.getClientRects().length > 0;
      return { title: r.querySelector('h2').textContent.trim(), tone: [...r.classList].find((c) => /^result--/.test(c)), lead: r.querySelector('.result__lead').textContent, partly: (r.querySelector('[data-partly]') || {}).textContent || '',
        notRun: [...r.querySelectorAll('[data-not-run]')].map((e) => e.textContent), glyph: getComputedStyle(r.querySelector('.result__glyph')).color, text: r.innerText, all: r.textContent,
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
    const states = Object.entries(seen);
    result('honest-result: what did not run is one line, with no grey rows', states.every(([, r]) => r.notRun.length === 1 && /did not run\./.test(r.notRun[0]) && !r.grey), states.map(([k, r]) => `${k}: ${r.notRun[0]}`));
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
      const clip = await evalIn(browser, s, `(() => {
        for (const el of document.querySelectorAll('main, .main, .app__main, [data-view], .view')) { el.style.overflow = 'visible'; el.style.height = 'auto'; el.style.maxHeight = 'none'; }
        document.documentElement.style.height = 'auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible';
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
          if (name === 'scam' || name === 'partly') {
            await evalIn(browser, s, "(document.querySelector('[data-more]').open = true, 1)");
            await sleep(250);
            await picture(`${name}-${size}-${theme}-open`);
          }
        }
      }
    }
    result('honest-result: no result scrolls sideways at either size, in either theme', !wide.length, wide);
    result('honest-result: the page logs no error', !errors.length, errors);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkHonestResult;
