'use strict';
/**
 * call      Is this call a scam? (/call): opens with no account, real clicks change an answer that is always on screen
 *           and never green, at desktop and phone width, in both themes; the panel springs both ways (frames saved);
 *           ticks survive the recovery guide and Back; nothing ticked is sent.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, shot } = require('./_shared');

// /call on the real server, in a browser that has never signed in. At the end the same page is opened signed in, as a
// throwaway account with an unconfirmed email, to see that the app's banner does not follow it there.
async function checkCall() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-call-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'call-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo' }
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const { browser, close } = await launch();
  try {
    if (!up) throw new Error(`the Sentinel server did not start on ${base} (see call-server.log)`);
    const { sessionId: s } = await openPage(browser);
    const errors = [];
    const requests = [];
    browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
    browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method, post: p.request.postData || '' }));
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    const size = async (width, height, mobile) => { await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s); await sleep(350); };
    const theme = (t) => evalIn(browser, s, `document.documentElement.dataset.theme = '${t}'`);
    const READY = "document.querySelector('[data-call-answer] .call__verdict').textContent";
    await size(390, 844, true);
    await goto(browser, s, `${base}/app/call`, READY).catch(async (err) => {
      const where = await evalIn(browser, s, "location.href + ' | ' + (document.body ? document.body.innerText.slice(0, 300) : '')").catch(() => '');
      throw new Error(`${err.message}: ${where} | ${errors.join(' | ')}`);
    });
    await sleep(500);
    const landed = await evalIn(browser, s, "({ path: location.pathname, cookie: document.cookie, wall: Boolean(document.querySelector('input[type=password]')), banner: Boolean(document.querySelector('.banner, .verify-bar')) })");
    result('call: a browser that never signed in, sent to the old /app/call, lands on /call with no sign-in in the way', landed.path === '/call' && !landed.wall && !landed.banner, landed);

    const answer = () => evalIn(browser, s, `(() => { const a = document.querySelector('[data-call-answer]');
      const t = (sel) => (a.querySelector(sel) || {}).textContent || '';
      const more = a.querySelector('.call__more:not([hidden]) a');
      const r = a.getBoundingClientRect(), big = a.querySelector('.call__verdict'), plate = a.querySelector('.call__plate');
      const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number).slice(0, 3);
      const red = getComputedStyle(plate, '::after').backgroundImage;
      return { verdict: a.dataset.verdict, big: t('.call__verdict'), reason: t('.call__reason'), next: t('.call__next'), recover: more ? more.getAttribute('href') : '', size: parseFloat(getComputedStyle(big).fontSize),
        top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), screen: innerHeight, scrolled: Math.round(scrollY), seal: a.querySelector('svg').innerHTML.includes('M32 2.5 61.5 32'),
        colours: [rgb(getComputedStyle(big).color), rgb(getComputedStyle(plate).backgroundColor), rgb(red.slice(red.indexOf('rgb')))] }; })()`);
    // No colour on the answer leans green, whatever is ticked.
    const noGreen = (a) => a.colours.every(([r, g, b]) => !(g > r + 12 && g > b + 12));
    const inView = (a) => a.top >= 0 && a.bottom <= a.screen;
    const click = async (name, value) => {
      const [x, y] = await evalIn(browser, s, `(() => { const l = document.querySelector('input[name="${name}"][value="${value}"]').closest('label'); const v = l.getBoundingClientRect(); const under = document.querySelector('[data-call-answer]').getBoundingClientRect(); if ((innerWidth < 1000 && v.top < under.bottom + 8) || v.bottom > innerHeight - 8) l.scrollIntoView({ block: 'end', behavior: 'instant' }); const r = l.getBoundingClientRect(); return [Math.round(r.left + 24), Math.round(r.top + r.height / 2)]; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, s);
      await sleep(250);
    };
    const start = () => evalIn(browser, s, "document.querySelector('[data-call] button[type=reset]').click(), scrollTo({ top: 0, behavior: 'instant' })").then(() => sleep(300));

    const empty = await answer();
    await shot(browser, s, 'call-phone-dark-open');
    result('call: the page opens on a true answer in view, with nothing ticked and no green', empty.verdict === 'hold' && empty.big === 'Give them nothing yet.' && inView(empty) && noGreen(empty), empty);
    const lines = await evalIn(browser, s, `[...document.querySelectorAll('.call__pick span')].map((e) => ({ t: e.textContent, n: Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) })).filter((x) => x.n > 2)`);
    result('call: at 390 px no choice runs past two lines', !lines.length, lines);
    const before = requests.length;
    // Gran's case: only "the police" is ticked. Nothing is asked for yet, and the old page said "probably fine" in green.
    await click('who', 'police');
    const police = await answer();
    await shot(browser, s, 'call-phone-dark-police');
    await theme('light'); await sleep(450);
    const policeLight = await answer();
    await shot(browser, s, 'call-phone-light-police');
    await theme('dark');
    result('call: "the police" and nothing else says hang up and call back, on screen, never green, in both themes',
      police.verdict === 'callback' && police.big === 'Hang up and call back.' && /did not expect/.test(police.reason) && /wait a few minutes or use another phone/.test(police.next) && /non-emergency number/.test(police.next) && inView(police) && noGreen(police) && noGreen(policeLight), [police, policeLight]);

    await start();
    await click('rang', 'self');
    await click('who', 'bank');
    const self = await answer();
    await shot(browser, s, 'call-phone-dark-self');
    result('call: a number the person chose is the safer way round, says Sentinel cannot see who is there, and is not green', self.verdict === 'hold' && /cannot see who is on the line/.test(self.reason) && noGreen(self), self);

    // The last box on the page, far under the answer, ticked with the page scrolled: the answer is still on screen and
    // the box does not jump out from under the finger when the answer grows.
    await start();
    await click('who', 'bank');
    await evalIn(browser, s, "document.querySelector('input[value=hurry]').closest('label').scrollIntoView({ block: 'end', behavior: 'instant' })");
    await sleep(200);
    const boxAt = "Math.round(document.querySelector('input[value=hurry]').closest('label').getBoundingClientRect().top)";
    const was = await evalIn(browser, s, boxAt);
    await click('ask', 'hurry');
    await sleep(700);
    const low = await answer();
    const settled = await evalIn(browser, s, boxAt);
    await shot(browser, s, 'call-phone-dark-scrolled');
    result('call: ticking the last box, scrolled down, the answer is on screen without scrolling back up and the box stays put',
      low.verdict === 'hangup' && low.scrolled > 100 && inView(low) && Math.abs(was - settled) <= 2, { low, was, settled });

    // The recovery guide and Back, then a reload: the person's place on the call is still there.
    await start();
    await click('who', 'bank');
    await click('ask', 'code');
    await sleep(600);
    const phoneHang = await answer();
    await shot(browser, s, 'call-phone-dark-hangup');
    await theme('light'); await sleep(450);
    await shot(browser, s, 'call-phone-light-hangup');
    await theme('dark');
    result('call: on a phone "Hang up now." is on screen with its reason, and red has a shape as well as a colour', phoneHang.verdict === 'hangup' && inView(phoneHang) && phoneHang.seal && noGreen(phoneHang), phoneHang);
    const fits = await evalIn(browser, s, 'document.documentElement.scrollWidth <= innerWidth + 1');
    result('call: at phone width the page fits with no sideways scroll', fits);
    await evalIn(browser, s, "document.querySelector('.call__more a').click()");
    await sleep(1500);
    const guide = await evalIn(browser, s, 'location.pathname + location.search');
    await evalIn(browser, s, 'history.back()');
    await sleep(1500);
    await evalIn(browser, s, '0').catch(() => {});
    const back = await answer();
    const ticks = await evalIn(browser, s, "[...document.querySelectorAll('[data-call] input:checked')].map((i) => i.value).sort().join()");
    await browser.send('Page.reload', {}, s);
    await sleep(1500);
    const reloaded = await evalIn(browser, s, "[...document.querySelectorAll('[data-call] input:checked')].map((i) => i.value).sort().join()");
    result('call: to the recovery guide and Back, and after a reload, every tick and the answer are still there', guide === '/recover?happened=code' && ticks === 'bank,code' && back.verdict === 'hangup' && reloaded === 'bank,code', { guide, ticks, back: back.verdict, reloaded });

    // The spring, both ways: each animation is held and stepped by hand, so every frame is the frame a person sees.
    await size(390, 844, true);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, s);   // a CI machine asks for reduced motion
    await start();
    const film = async (name, press) => {
      const shape = await evalIn(browser, s, `(async () => { const out = document.querySelector('[data-call-answer]'), plate = out.querySelector('.call__plate');
        const from = plate.offsetHeight; ${press}
        await new Promise((r) => setTimeout(r));
        out.getAnimations({ subtree: true }).forEach((a) => a.pause());
        window.__spring = out.getAnimations({ subtree: true });
        return { from, to: out.offsetHeight, moving: plate.getAnimations().length }; })()`);
      const heights = [];
      for (const t of [0, 60, 120, 200, 300, 460]) {
        heights.push(await evalIn(browser, s, `(() => { window.__spring.forEach((a) => { a.currentTime = ${t}; }); return Math.round(document.querySelector('.call__plate').getBoundingClientRect().height); })()`));
        await sleep(60);
        await shot(browser, s, `call-spring-${name}-${String(t).padStart(3, '0')}`);
      }
      await evalIn(browser, s, 'window.__spring.forEach((a) => a.finish())');
      return { ...shape, heights };
    };
    const sprang = ({ from, to, moving, heights }) => moving > 0 && Math.abs(heights[0] - from) <= 1 && Math.abs(heights[5] - to) <= 1
      && Math.min(from, to) < heights[1] + 40 && heights[1] !== from && heights[1] !== to && new Set(heights).size >= 4;
    const grew = await film('grow', "document.querySelector('input[value=bank]').click(); document.querySelector('input[value=code]').click();");
    await sleep(300);
    const shrank = await film('shrink', "document.querySelector('[data-call] button[type=reset]').click();");
    await sleep(300);
    result('call: the panel springs open and springs shut, through heights in between, not a snap either way', sprang(grew) && grew.to > grew.from && sprang(shrank) && shrank.to < shrank.from, { grew, shrank });

    // Real time: frames while the panel opens and shuts, to catch a stall a held frame cannot show.
    const frames = await evalIn(browser, s, `new Promise((done) => { const gaps = []; let last = performance.now(); const stop = last + 1300;
      const tick = (now) => { gaps.push(Math.round(now - last)); last = now; if (now < stop) requestAnimationFrame(tick); else done({ n: gaps.length, worst: Math.max(...gaps.slice(1)) }); };
      requestAnimationFrame(tick);
      const box = document.querySelector('input[value=giftcards]'); box.click(); setTimeout(() => box.click(), 650); })`);
    result('call: no frame stalls while the panel opens and shuts (worst gap under 100 ms)', frames.worst < 100, frames);
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
    const still = await evalIn(browser, s, "(() => { const box = document.querySelector('input[value=giftcards]'); box.click(); const n = document.querySelector('.call__plate').getAnimations().filter((a) => a.effect.getKeyframes().some((k) => k.height)).length; box.click(); return n; })()");
    result('call: asked for reduced motion, the panel does not spring', still === 0, still);

    await size(1366, 900, false);
    await start();
    const wide = await answer();
    await shot(browser, s, 'call-desktop-dark-open');
    await click('who', 'tax');
    await theme('light'); await sleep(450);
    await shot(browser, s, 'call-desktop-light-tax');
    await theme('dark');
    // Only the first "Hang up" reaches the Windows app, not every tick after it.
    await evalIn(browser, s, 'window.__hangups = 0; window.sentinelDesktop = { callHangUp: () => { window.__hangups++; return Promise.resolve(); } }');
    await start();
    await click('who', 'bank');
    await click('ask', 'code');
    await sleep(600);
    const hang = await answer();
    await shot(browser, s, 'call-desktop-dark-hangup');
    await theme('light'); await sleep(450);
    await shot(browser, s, 'call-desktop-light-hangup');
    await theme('dark');
    result('call: the bank asking for the code sent to your phone says hang up at once, in big words, with the one reason and the number on the card',
      wide.verdict === 'hold' && hang.verdict === 'hangup' && hang.big === 'Hang up now.' && hang.size >= 36 && /Your bank never asks for a code/.test(hang.reason) && /back of your card/.test(hang.next) && hang.recover === '/recover?happened=code', hang);
    await click('ask', 'giftcards');
    const more = await answer();
    result('call: a second sign keeps the deciding reason and adds its part of the recovery guide', more.verdict === 'hangup' && /Your bank never asks for a code/.test(more.reason) && more.recover === '/recover?happened=code,giftcard', more);
    const once = await evalIn(browser, s, 'window.__hangups');
    await start();
    await click('ask', 'pin');
    const twice = await evalIn(browser, s, 'window.__hangups');
    result('call: the Windows app hears "Hang up" once for each time the answer becomes it, not on every tick', once === 1 && twice === 2, { once, twice });
    await evalIn(browser, s, 'delete window.sentinelDesktop');

    // Every answer on a small phone: it never fills the screen, so there is always room to tick the next thing.
    await size(360, 640, true);
    const tall = await evalIn(browser, s, `(() => {
      const a = document.querySelector('[data-call-answer]');
      const ins = (n) => [...document.querySelectorAll('input[name="' + n + '"]')];
      let worst = 0;
      for (const w of [null, ...ins('who')]) for (const k of [null, ...ins('ask')]) {
        for (const c of [...ins('who'), ...ins('ask')]) c.checked = false;
        if (w) w.checked = true;
        if (k) k.checked = true;
        document.querySelector('[data-call]').dispatchEvent(new Event('change'));
        worst = Math.max(worst, a.offsetHeight);
      }
      return { worst, screen: innerHeight };
    })()`);
    result('call: on a 360 by 640 phone every answer fits in under half the screen', tall.worst <= tall.screen * 0.5, tall);
    await start();
    await size(844, 390, true);
    await click('who', 'bank');
    await click('ask', 'code');
    await sleep(600);
    const side = await answer();
    await shot(browser, s, 'call-phone-sideways');
    result('call: a phone on its side keeps the big words and what to do on screen', inView(side) && side.verdict === 'hangup', side);
    await size(1366, 900, false);

    await start();
    const reset = await answer();
    result('call: Start over clears every tick and goes back to the first answer', reset.big === 'Give them nothing yet.' && await evalIn(browser, s, "!document.querySelector('[data-call] input:checked')"), reset);

    const sent = requests.slice(before);
    const carried = sent.filter((r) => r.method !== 'GET' || /\/api\/.*(scan|guest)/i.test(r.url) || (/code|giftcard/i.test(r.url) && !r.url.includes('/recover?happened=')));
    result('call: nothing ticked is sent anywhere, and no scan is spent', !carried.length, [`requests while ticking: ${sent.map((r) => `${r.method} ${r.url.replace(base, '')}`).join(', ') || 'none'}`, ...carried.map((r) => `sent: ${r.method} ${r.url}`)]);

    // Signed in with an unconfirmed email: the banner belongs to the app and does not push the answer down here.
    await size(390, 844, true);
    const signed = await evalIn(browser, s, `(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'call-' + Date.now() + '@example.com', password = 'Call-Check-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      return a.ok && b.ok;
    })()`);
    await goto(browser, s, `${base}/call`, READY);
    await sleep(500);
    await click('who', 'bank');
    await evalIn(browser, s, "document.querySelector('input[value=hurry]').closest('label').scrollIntoView({ block: 'end', behavior: 'instant' })");
    await sleep(200);
    await click('ask', 'hurry');
    await sleep(700);
    const in2 = await answer();
    const banner = await evalIn(browser, s, "Boolean(document.querySelector('.banner, .verify-bar'))");
    await shot(browser, s, 'call-phone-signed-in-scrolled');
    result('call: signed in with an unconfirmed email, there is no banner, and the answer holds its place scrolled down', signed && !banner && inView(in2) && in2.top <= 12 && in2.scrolled > 100, { signed, banner, in2 });
    result('call: no console errors', !errors.length, errors);
  } finally {
    await close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCall;
