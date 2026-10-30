'use strict';
/**
 * calm-dig  The wait for a scan on the real server, measured on real frames: flashes per second over every 341 by 256
 *           window of the page (WCAG 2.3.1, flash.js) during a delicate scan and its verdict, against a flashing
 *           control the counter must catch; that the result lands as soon as the answer does, and a quick scan shows
 *           next to nothing; that the words follow the stages the server reports; the 3D mask, which rises and then
 *           holds still; the still picture without WebGL; and reduced motion, which is a progress line and nothing else.
 *           Every wait is the server's real answer, its lines held apart in the page so a scan takes a known time.
 *           Photographs each kind of scan's wait and result, at computer and phone size, dark and light.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { OUT, sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors, until, readPng, clickSel } = require('./_shared');
const { measure } = require('./flash');

const LIMIT = 3;   // WCAG 2.3.1: no more than three flashes in any one second
const LANDS_MS = 200;   // from the answer arriving to the result in the page: only drawing it, on a shared CI runner
const SCAN = 'paypa1-secure-login.com';

// Runs before every page: holds the lines of a scan's answer apart, and notes when the answer came, when the result
// was in the page, and what the wait showed on each frame.
const WATCH = `(() => {
  const s = window.__scan = { pace: 0, start: 0, arrived: 0, shown: 0, panel: 0, veil: 0, said: [], fills: [] };
  window.__scanReset = (pace) => Object.assign(s, { pace, start: performance.now(), arrived: 0, shown: 0, panel: 0, veil: 0, said: [], fills: [] });
  const real = window.fetch;
  window.fetch = async (url, init) => {
    const res = await real(url, init);
    if (!/\\/api\\/v1\\/scan\\//.test(String(url))) return res;
    const reader = res.body.getReader();
    const text = new TextDecoder();
    const bytes = new TextEncoder();
    const body = new ReadableStream({
      async pull(c) {
        const { value, done } = await reader.read();
        if (done) { s.arrived = s.arrived || performance.now(); c.close(); return; }
        for (const line of text.decode(value, { stream: true }).split(/(?<=\\n)/)) {
          if (s.pace) await new Promise((r) => setTimeout(r, s.pace));
          if (line.includes('{"result"')) s.arrived = performance.now();
          c.enqueue(bytes.encode(line));
        }
      }
    });
    return new Response(body, { status: res.status, headers: res.headers });
  };
  const look = () => {
    requestAnimationFrame(look);
    if (!s.start || s.shown) return;
    if (document.querySelector('[data-result]')) { s.shown = performance.now(); return; }
    const panel = document.querySelector('[data-scanning]');
    if (panel) s.panel = Math.max(s.panel, Number(getComputedStyle(panel).opacity));
    const veil = document.querySelector('.binary-veil');
    if (veil) s.veil = Math.max(s.veil, Number(getComputedStyle(veil).opacity));
    const now = document.querySelector('[data-scan-now]');
    if (now && s.said[s.said.length - 1] !== now.textContent) s.said.push(now.textContent);
    const fill = document.querySelector('[data-scan-fill]');
    if (fill && s.fills[s.fills.length - 1] !== fill.style.transform) s.fills.push(fill.style.transform);
  };
  requestAnimationFrame(look);
})();`;

async function checkCalmDig() {
  const server = await startServer('calmdig', { RESEARCH_ENABLED: '1' });
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: WATCH }, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(browser, s, `${base}/login`);
    const email = `calm-${Date.now()}@example.com`;
    const password = 'Calm-Check-Lamp-2026';
    await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password });
    await api('/billing/plan', { plan: 'max' });

    /* ------------------------------------------------- frames, as Chrome drew them */

    let frames = null;
    browser.on('Page.screencastFrame', (p, sid) => {
      if (sid && sid !== s) return;
      browser.send('Page.screencastFrameAck', { sessionId: p.sessionId }, s).catch(() => {});
      if (frames) frames.push({ t: p.metadata.timestamp * 1000, data: p.data });
    });
    const record = async (during) => {
      frames = [];
      await browser.send('Page.bringToFront', {}, s).catch(() => {});
      await browser.send('Page.startScreencast', { format: 'png', maxWidth: 683, maxHeight: 450, everyNthFrame: 1 }, s);
      await during();
      await browser.send('Page.stopScreencast', {}, s);
      const taken = frames;
      frames = null;
      return taken.map((f) => ({ t: f.t, frame: readPng(Buffer.from(f.data, 'base64')), data: f.data }));
    };
    const rated = (taken) => measure(taken, taken.length ? 1366 / taken[0].frame.w : 1);
    const keep = (taken, name, at) => { const f = taken.reduce((b, x) => (Math.abs(x.t - at) < Math.abs(b.t - at) ? x : b)); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(f.data, 'base64')); };
    const open = (url, ready) => goto(browser, s, base + url, ready);
    const state = () => evalIn(browser, s, 'JSON.parse(JSON.stringify(window.__scan))');
    const pick = (mode) => clickSel(browser, s, `[data-scan-mode=${mode}]`);
    const submit = (url) => evalIn(browser, s, `(() => { const f = document.querySelector('[data-form]'); f.url.value = ${JSON.stringify(url)}; f.requestSubmit(); })()`);
    const landed = () => until(browser, s, "document.querySelector('[data-result]') && window.__scan.shown", 90000);

    /* ---------------------------------------------- the counter catches a real flash */

    await open('/app/scan', "document.querySelector('[data-form]')");
    await sleep(800);
    const control = rated(await record(async () => {
      await evalIn(browser, s, `(() => { const d = document.createElement('div'); d.id = 'flash'; d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000'; document.body.appendChild(d);
        window.__flash = setInterval(() => { d.style.background = d.style.background === 'rgb(0, 0, 0)' ? '#fff' : '#000'; }, 100); })()`);
      await sleep(3000);
      await evalIn(browser, s, "clearInterval(window.__flash); document.getElementById('flash').remove();");
    }));
    result('calm-dig: the counter catches a black and white flash at 5 a second, so its frames are fast enough', control.flashes >= 4, control);

    /* ------------------------------------------------- a delicate scan, start to verdict */

    await pick('delicate');
    const taken = await record(async () => {
      await evalIn(browser, s, 'window.__scanReset(900)');
      await submit(`${SCAN}/?calm=${Date.now()}`);
      await landed();
      await sleep(2000);
    });
    const delicate = await state();
    const rate = rated(taken);
    result(`calm-dig: a delicate scan and its verdict stay at or under ${LIMIT} flashes a second`, rate.flashes <= LIMIT, rate);
    const wait = Math.round(delicate.shown - delicate.arrived);
    result(`calm-dig: a delicate scan's result lands as soon as its answer does (under ${LANDS_MS} ms)`, delicate.arrived > 0 && wait < LANDS_MS, { ms: wait, scan: Math.round(delicate.arrived - delicate.start) });
    result('calm-dig: the words and the line follow the stages the server reports', delicate.said.some((x) => /threat lists/.test(x)) && delicate.said.some((x) => /Researching the site/.test(x)) && delicate.said.some((x) => /checklist/.test(x)) && delicate.fills.length >= 4, { said: delicate.said, fills: delicate.fills });
    result('calm-dig: a slow delicate scan does show the quiet binary', delicate.veil > 0.9, { veil: delicate.veil });
    if (taken.length) {
      const startedAt = taken[0].t;
      const verdictAt = startedAt + (delicate.shown - delicate.start);
      for (const ms of [600, 1500, 3000, 4500]) keep(taken, `calm-delicate-wait-${String(ms).padStart(4, '0')}ms`, startedAt + ms);
      for (const ms of [0, 120, 260, 500, 1000, 1800]) keep(taken, `calm-delicate-verdict-${String(ms).padStart(4, '0')}ms`, verdictAt + ms);
    }
    await shot(browser, s, 'calm-delicate-result');

    /* ---------------------------------------------------- the 3D mask rises, then rests */

    const ready = await until(browser, s, "document.querySelector('.result__glyph--mask .mask3d--ready') !== null", 30000);
    const draws = () => evalIn(browser, s, "window.SentinelMask3D.state(document.querySelector('[data-verdict-mask]')).masks[0].draws");
    const first = ready ? await draws() : 0;
    await sleep(1500);
    const second = ready ? await draws() : 0;
    await sleep(1500);
    const third = ready ? await draws() : 0;
    result('calm-dig: the verdict\'s mask is drawn in real 3D, in its severity, and then holds still and draws nothing more', Boolean(ready) && first > 0 && third === second, { ready, first, second, third });
    await shot(browser, s, 'calm-delicate-mask-settled');
    const focus = await evalIn(browser, s, 'document.activeElement && document.activeElement.tagName');
    result('calm-dig: keyboard and screen reader users land on the verdict\'s heading', focus === 'H2', focus);

    /* -------------------------------------- a second verdict: the model is ready in time */

    await evalIn(browser, s, 'window.__scanReset(300)');
    await submit(`${SCAN}/?again=${Date.now()}`);
    const during = await record(async () => {
      await landed();
      await sleep(1400);
    });
    const again = await state();
    const riseRate = rated(during);
    result('calm-dig: the mask rising is calm too', riseRate.flashes <= LIMIT, riseRate);
    if (during.length) {
      const at = during[0].t + Math.max(0, again.shown - again.start - 300);
      for (const ms of [0, 200, 400, 800, 1300]) keep(during, `calm-rise-${String(ms).padStart(4, '0')}ms`, at + ms);
    }

    /* ------------------------------------------------------------- a quick scan */

    await open('/app/scan', "document.querySelector('[data-form]')");
    await sleep(500);
    await pick('fast');
    await evalIn(browser, s, 'window.__scanReset(0)');
    await submit(`${SCAN}/?quick=${Date.now()}`);
    await landed();
    const quick = await state();
    const took = Math.round(quick.shown - quick.start);
    const late = Math.round(quick.shown - quick.arrived);
    result(`calm-dig: a quick scan's result lands as soon as its answer does (under ${LANDS_MS} ms)`, late < LANDS_MS, { ms: late, scan: took });
    result('calm-dig: a scan under 400 ms shows next to nothing (over that, the wait may start to fade in)', took >= 400 || (quick.panel < 0.05 && quick.veil === 0), { took, panel: quick.panel, veil: quick.veil });

    /* ------------------------------------------- digging into links (the Windows overlay) */

    await open('/app/scan', "document.querySelector('[data-form]')");
    const links = rated(await record(async () => {
      await evalIn(browser, s, `window.__dig = window.SentinelBinary.dig(null, { grace: 0, links: () => [...document.querySelectorAll('a')].slice(0, 16).map((a, i) => { const r = a.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, color: [null, 'green', 'yellow', 'orange', 'red'][i % 5] }; }) }); true`);
      await sleep(1500);
      await shot(browser, s, 'calm-links');
      await sleep(1500);
      await evalIn(browser, s, 'window.__dig.finish()');
    }));
    result(`calm-dig: digging into links stays at or under ${LIMIT} flashes a second`, links.flashes <= LIMIT, links);

    /* ----------------------------------------------------- the personal scans, photographed */

    const held = 1100;
    const photo = async (name, go) => {
      await evalIn(browser, s, `window.__scanReset(${held})`);
      await go();
      await until(browser, s, "document.querySelector('[data-scanning]') && Number(getComputedStyle(document.querySelector('[data-scanning]')).opacity) > 0.95", 8000);
      await sleep(300);
      await shot(browser, s, `${name}-wait`);
      await landed();
      await sleep(900);
      await shot(browser, s, `${name}-result`);
      return state();
    };
    await open('/app/text', "document.querySelector('#view textarea')");
    const text = await photo('calm-text', () => evalIn(browser, s, `(() => { const f = document.querySelector('#view form:has([name=text])'); f.text.value = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://paypa1-secure-login.com/pay'; f.requestSubmit(); })()`));
    await open('/app/email', "document.querySelector('#view textarea')");
    const mail = await photo('calm-email', () => evalIn(browser, s, `(() => { const f = document.querySelector('#view form:has([name=body])'); f.from.value = 'PayPal <service@paypa1-secure-login.com>'; f.subject.value = 'Your account is limited'; f.body.value = 'Verify now at https://paypa1-secure-login.com/login and https://example.org/'; f.requestSubmit(); })()`));
    await open('/app/threats?mode=file', "document.querySelector('[data-file]')");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calm-')), 'invoice.txt');
    fs.writeFileSync(file, 'An ordinary note, for the file scan.\n');
    const fileScan = await photo('calm-file', async () => {
      const { root } = await browser.send('DOM.getDocument', { depth: 0 }, s);
      const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-file]' }, s);
      await browser.send('DOM.setFileInputFiles', { nodeId, files: [file] }, s);
    });
    result('calm-dig: Text, Email and File scans each say what they are really checking', text.said.some((x) => /Reading the message/.test(x)) && text.said.some((x) => /slow scam/.test(x)) && mail.said.some((x) => /links and sender/.test(x)) && fileScan.said.some((x) => /signatures/.test(x)), { text: text.said, mail: mail.said, file: fileScan.said });

    /* ------------------------------------------------------------ a phone, and light */

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
    await open('/app/scan', "document.querySelector('[data-form]')");
    await sleep(400);
    await pick('delicate');
    await evalIn(browser, s, `window.__scanReset(${held})`);
    await submit(`${SCAN}/?phone=${Date.now()}`);
    await sleep(2200);
    await shot(browser, s, 'calm-phone-wait');
    await landed();
    await sleep(1200);
    await shot(browser, s, 'calm-phone-result');
    const wide = await evalIn(browser, s, 'document.documentElement.scrollWidth > innerWidth');
    result('calm-dig: a phone never scrolls sideways at the verdict', !wide, { wide });
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, s);

    await open('/app/scan', "document.querySelector('[data-form]')");
    await evalIn(browser, s, "document.documentElement.setAttribute('data-theme', 'light')");
    await sleep(400);
    await pick('delicate');
    await evalIn(browser, s, `window.__scanReset(${held})`);
    await submit(`${SCAN}/?light=${Date.now()}`);
    await sleep(2200);
    await shot(browser, s, 'calm-light-wait');
    await landed();
    await sleep(1200);
    await shot(browser, s, 'calm-light-result');

    /* ------------------------------------------------------------- reduced motion */

    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    await open('/app/scan', "document.querySelector('[data-form]')");
    await sleep(400);
    await pick('delicate');
    await evalIn(browser, s, `window.__scanReset(${held})`);
    await submit(`${SCAN}/?still=${Date.now()}`);
    await until(browser, s, "document.querySelector('[data-scanning]') && Number(getComputedStyle(document.querySelector('[data-scanning]')).opacity) > 0.95", 8000);
    await sleep(200);
    const still = await evalIn(browser, s, `(() => { const p = document.querySelector('[data-scanning]'); return { veil: document.querySelectorAll('.binary-veil').length, stages: getComputedStyle(p.querySelector('.stages')).display, line: p.querySelector('.scanning__line').offsetHeight,
      running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect.target && a.effect.target.closest('#view')).length }; })()`);
    await shot(browser, s, 'calm-reduced-wait');
    await landed();
    await sleep(700);
    const mask = await evalIn(browser, s, "(() => { const m = document.querySelector('[data-verdict-mask]'); return m && { still: m.querySelector('img').complete, model: Boolean(m.dataset.mask3d) }; })()");
    await shot(browser, s, 'calm-reduced-result');
    result('calm-dig: with reduced motion the wait is a progress line, with nothing moving, and the mask is its still picture', still.veil === 0 && still.stages === 'none' && still.line > 0 && still.running === 0 && mask && mask.still && !mask.model, { ...still, mask });
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, s);

    result('calm-dig: nothing went wrong in the page', errors.length === 0, errors.slice(0, 5));
  } finally {
    await close();
    await server.stop();
  }

  /* ------------------------------------------------------------------ without WebGL */

  const flat = await startServer('calmdig-flat', {});
  const off = await launch(['--disable-webgl', '--disable-webgl2', '--disable-3d-apis']);
  try {
    const { sessionId: s } = await openPage(off.browser);
    await watchErrors(off.browser, s);
    const api = (p, body) => evalIn(off.browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    await goto(off.browser, s, `${flat.base}/login`);
    const email = `calm-flat-${Date.now()}@example.com`;
    await api('/auth/signup', { email, password: 'Calm-Check-Lamp-2026', firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    await api('/auth/login', { email, password: 'Calm-Check-Lamp-2026' });
    await goto(off.browser, s, `${flat.base}/app/scan`, "document.querySelector('[data-form]')");
    await evalIn(off.browser, s, `(() => { const f = document.querySelector('[data-form]'); f.url.value = ${JSON.stringify(SCAN)}; f.requestSubmit(); })()`);
    await until(off.browser, s, "document.querySelector('[data-result]')", 30000);
    await sleep(2500);
    const seen = await evalIn(off.browser, s, "(() => { const m = document.querySelector('[data-verdict-mask]'); const i = m && m.querySelector('img'); return i && { loaded: i.complete && i.naturalWidth > 0, shown: Number(getComputedStyle(i).opacity), ready: m.classList.contains('mask3d--ready') }; })()");
    await shot(off.browser, s, 'calm-no-webgl');
    result('calm-dig: without WebGL the verdict keeps its still picture of the mask', Boolean(seen) && seen.loaded && seen.shown === 1 && !seen.ready, seen);
  } finally {
    await off.close();
    await flat.stop();
  }
}

module.exports = checkCalmDig;
