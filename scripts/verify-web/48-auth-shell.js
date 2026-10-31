'use strict';
/**
 * auth-shell  The sign-in pages as a person meets them, on a server with Google sign-in and one without: an option the
 *             server lacks is never sent, the mask and the name are on screen at every size, Sign in is above the fold
 *             on a phone, an empty field can be seen (its edge measured against the page, 3:1), nothing runs at rest,
 *             and a press before the page's script arrived waits and goes through, or says plainly that it cannot.
 *             Photographs every page at desktop and phone size, dark and light.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer, clickSel, typeText, pressEnter, watchErrors } = require('./_shared');

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const LAPTOP = { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const NARROW = { width: 320, height: 640, deviceScaleFactor: 2, mobile: true };
const PAGES = [['login', '/login'], ['signup', '/signup'], ['forgot', '/forgot'], ['reset', '/reset?token=shot'], ['verify', '/verify']];
const SETTLED = "document.readyState === 'complete' && document.fonts.status === 'loaded'";

const FACTS = `(() => {
  const luminance = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parts = (s) => (s.match(/[\\d.]+/g) || []).map(Number);
  const over = (top, under) => { const a = top.length > 3 ? top[3] : 1; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)); };
  const word = document.querySelector('.auth__word');
  const mask = document.querySelector('.auth__mask');
  const m = mask && mask.getBoundingClientRect();
  const w = word && word.getBoundingClientRect();
  const hit = m && m.width && document.elementFromPoint(m.left + m.width / 2, Math.min(m.top + m.height / 2, innerHeight - 1));
  const input = document.querySelector('form:not([hidden]) .input');
  const button = document.querySelector('form:not([hidden]) button[type=submit]');
  const edgeOf = (el) => {
    if (!el) return 99;
    const s = getComputedStyle(el);
    const ring = s.boxShadow.match(/(rgba?\\([^)]*\\)) 0px 0px 0px 1px inset/);
    const back = luminance(parts(getComputedStyle(document.body).backgroundColor).slice(0, 3));
    if (!ring) return 0;
    const seen = luminance(over(parts(ring[1]), parts(s.backgroundColor).slice(0, 3)));
    return (Math.max(seen, back) + 0.05) / (Math.min(seen, back) + 0.05);
  };
  return {
    wordOnScreen: Boolean(w && w.width && w.top >= 0 && w.bottom <= innerHeight),
    wordPx: word ? parseFloat(getComputedStyle(word).fontSize) : 0,
    wordClearOfMask: Boolean(w && m && (m.left >= w.right - 1 || m.top >= w.bottom - 1 || m.bottom <= w.top + 1)),
    maskShown: Boolean(mask && mask.complete && mask.naturalWidth > 0 && m.width >= 100 && hit === mask && getComputedStyle(mask).opacity === '1'),
    edge: Math.round(edgeOf(input) * 100) / 100,
    boxEdge: Math.round(edgeOf(document.querySelector('.auth .consent__row input')) * 100) / 100,
    submitBottom: button ? Math.round(button.getBoundingClientRect().bottom) : 0,
    tall: innerHeight,
    sideways: document.documentElement.scrollWidth - innerWidth,
    forever: document.getAnimations().filter((a) => a.playState === 'running' && a.effect.getTiming().iterations === Infinity).map((a) => [a.effect.target.tagName, a.effect.target.className, a.effect.pseudoElement, a.animationName].join(' ')),
    styled: document.querySelectorAll('.auth [style]').length
  };
})()`;

async function checkAuthShell() {
  const plain = await startServer('auth-plain');
  const google = await startServer('auth-google', { GOOGLE_CLIENT_ID: 'ci-only', GOOGLE_CLIENT_SECRET: 'ci-only' });
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const ev = (expr) => evalIn(browser, s, expr);
    const view = async (metrics, scheme, reduce = false) => {
      await browser.send('Emulation.setDeviceMetricsOverride', metrics, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] }, s);
    };

    /* The whole set, in every look, with what can be measured measured on each. */
    let everyLook = [];
    for (const [server, tag] of [[plain, ''], [google, '-google']]) {
      for (const [name, url] of PAGES) {
        if (tag && !['login', 'signup'].includes(name)) continue;
        for (const [size, metrics] of [['desktop', DESKTOP], ['phone', PHONE]]) {
          for (const scheme of ['dark', 'light']) {
            await view(metrics, scheme);
            await goto(browser, s, server.base + url, SETTLED);
            await sleep(250);
            const f = await ev(FACTS);
            const where = `${name}${tag} ${size} ${scheme}`;
            everyLook.push({ where, ...f });
            await shot(browser, s, `auth-${name}-${size}-${scheme}${tag}`);
          }
        }
      }
    }
    const bad = (test) => everyLook.filter(test).map((f) => f.where);
    const none = (name, test) => { const b = bad(test); result(`auth-shell: ${name}`, b.length === 0, b.slice(0, 8).join('; ') || `${everyLook.length} looks`); };
    none('the name Sentinel is on screen at a readable size on every page, desktop and phone', (f) => !f.wordOnScreen || f.wordPx < 32);
    none('the mask is drawn, on top, and the name is clear of it', (f) => !f.maskShown || !f.wordClearOfMask);
    none('an empty field\'s and a tick box\'s edge are 3:1 against the page', (f) => f.submitBottom && (f.edge < 3 || f.boxEdge < 3));
    const loops = [...new Set(everyLook.flatMap((f) => f.forever))];
    result('auth-shell: nothing loops at rest', loops.length === 0, loops);
    none('no page sideways scroll', (f) => f.sideways > 0);
    none('the pages use the shared styles, not style attributes', (f) => f.styled > 0);
    none('Sign in, Send reset link and Save are above the fold on a phone (signup may scroll)', (f) => / phone /.test(f.where) && !/signup/.test(f.where) && f.submitBottom > f.tall);

    // The longest ordinary form, whole, on a phone.
    await view(PHONE, 'dark');
    await goto(browser, s, `${google.base}/signup`, SETTLED);
    await browser.send('Emulation.setDeviceMetricsOverride', { ...PHONE, height: await ev('document.documentElement.scrollHeight') }, s);
    await sleep(200);
    await shot(browser, s, 'auth-signup-phone-whole-google');

    // Small and narrow: the smallest laptop and the smallest phone.
    await view(LAPTOP, 'dark');
    await goto(browser, s, `${google.base}/login`, SETTLED);
    const laptop = await ev(FACTS);
    await shot(browser, s, 'auth-login-laptop-dark-google');
    await view(NARROW, 'light');
    await goto(browser, s, `${google.base}/login?error=${'a'.repeat(120)}`, SETTLED);
    const narrow = await ev(FACTS);
    await shot(browser, s, 'auth-login-narrow-light-long-error');
    result('auth-shell: fits a 1366 by 768 laptop with Sign in showing, and a 320 px phone with a long unbroken error', laptop.submitBottom <= laptop.tall && laptop.maskShown && narrow.sideways <= 0 && narrow.wordOnScreen && narrow.wordClearOfMask, { laptop, narrow });

    /* What the server sends decides, before anything is painted. */
    const sent = async (server) => (await (await fetch(`${server.base}/login`)).text());
    const without = await sent(plain);
    const withIt = await sent(google);
    result('auth-shell: a server without Google sign-in sends no Google button and no "or"', !/data-google|class="divider"/.test(without), without.length);
    result('auth-shell: a server with Google sign-in sends the button in the page itself', /data-google/.test(withIt) && /class="divider"/.test(withIt), withIt.length);

    await view(DESKTOP, 'dark');
    await goto(browser, s, `${plain.base}/login`, SETTLED);
    const asked = await ev("performance.getEntriesByType('resource').filter((r) => /auth\\/config/.test(r.name)).length");
    result('auth-shell: no page asks the server about Google after loading', asked === 0, { asked });
    result('auth-shell: no words about a sign-in that is not set up', !/not set up|not configured/i.test(await ev('document.body.innerText')));

    /* Light comes up on the stage while a field has focus, and only then; with reduced motion it steps. */
    const glow = "getComputedStyle(document.querySelector('.auth__stage'), '::before')";
    const low = await ev(`${glow}.opacity`);
    await ev("document.querySelector('#email').focus(), 1");
    await sleep(1300);
    const high = await ev(`${glow}.opacity`);
    await shot(browser, s, 'auth-login-desktop-dark-focus');
    await ev('document.activeElement.blur(), 1');
    await view(DESKTOP, 'dark', true);
    await goto(browser, s, `${plain.base}/login`, SETTLED);
    const stepped = await ev(`${glow}.transitionDuration`);
    result('auth-shell: the light on the mask comes up with focus; reduced motion takes the fade away', Number(high) > Number(low) && parseFloat(stepped) < 0.001, { low, high, stepped });
    await view(DESKTOP, 'dark');

    /* Tab goes field to field. */
    await goto(browser, s, `${plain.base}/login`, SETTLED);
    await ev("document.querySelector('#email').focus(), 1");
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, s);
    result('auth-shell: Tab from Email lands on Password, not on a link between them', (await ev('document.activeElement.id')) === 'password', await ev('document.activeElement.outerHTML.slice(0, 80)'));

    /* States a person lands in. */
    await goto(browser, s, `${plain.base}/login`, SETTLED);
    await clickSel(browser, s, '#email');
    await typeText(browser, s, 'nobody@example.com');
    await clickSel(browser, s, '#password');
    await typeText(browser, s, 'not-the-password-1');
    await pressEnter(browser, s);
    await sleep(900);
    await shot(browser, s, 'auth-login-desktop-dark-wrong-password');
    await view(PHONE, 'light');
    await goto(browser, s, `${plain.base}/login?mfa=shot`, SETTLED);
    await shot(browser, s, 'auth-login-phone-light-code');
    await goto(browser, s, `${plain.base}/forgot`, SETTLED);
    await clickSel(browser, s, '#email');
    await typeText(browser, s, 'nobody@example.com');
    await pressEnter(browser, s);
    await sleep(900);
    await shot(browser, s, 'auth-forgot-phone-light-sent');
    await view(DESKTOP, 'dark');

    /* The button works from the start. Pressed before its script has come, the press waits; if it never comes, the page says so. */
    // The service worker and the cache would hand the script over without asking the network.
    await browser.send('Network.enable', {}, s);
    await browser.send('Network.setBypassServiceWorker', { bypass: true }, s);
    await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, s);
    await browser.send('Page.reload', {}, s);
    await sleep(800);
    const held = [];
    browser.on('Fetch.requestPaused', (p, sid) => { if (!sid || sid === s) held.push(p); });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: '*/assets/js/auth.js*' }, { urlPattern: '*/auth/google/start*' }] }, s);
    await goto(browser, s, `${plain.base}/login`, "!!document.querySelector('form[data-form] button[type=submit]')");
    for (let i = 0; i < 40 && !held.length; i++) await sleep(100);
    const button = "document.querySelector('form[data-form] button[type=submit]')";
    const before = await ev(`({ disabled: ${button}.disabled, painted: getComputedStyle(${button}).opacity })`);
    await clickSel(browser, s, 'form[data-form] button[type=submit]');
    await sleep(300);
    const waiting = await ev(`({ words: ${button}.innerText.trim(), busy: ${button}.getAttribute('aria-busy'), at: location.pathname })`);
    await shot(browser, s, 'auth-login-desktop-dark-early-press');
    result('auth-shell: on a slow connection Sign in can be pressed, says One moment, and stays on the page', !before.disabled && before.painted === '1' && waiting.words === 'One moment' && waiting.busy === 'true' && waiting.at === '/login', { before, waiting });
    await browser.send('Fetch.continueRequest', { requestId: held.shift().requestId }, s);
    let answered = '';
    for (let i = 0; i < 40 && !answered; i++) { await sleep(150); answered = await ev("[...document.querySelectorAll('[data-error], [data-note]')].map((e) => e.innerText).join(' ').trim()"); }
    result('auth-shell: when the script arrives that press goes through and is answered', Boolean(answered) && (await ev(`${button}.innerText.trim()`)) === 'Sign in', answered);

    await goto(browser, s, `${plain.base}/login`, "!!document.querySelector('form[data-form] button[type=submit]')");
    for (let i = 0; i < 40 && !held.length; i++) await sleep(100);
    await browser.send('Fetch.failRequest', { requestId: held.shift().requestId, errorReason: 'Failed' }, s);
    await sleep(600);
    await clickSel(browser, s, 'form[data-form] button[type=submit]');
    await sleep(300);
    const stuck = await ev(`({ note: document.querySelector('[data-note]').innerText, at: location.pathname, words: ${button}.innerText.trim() })`);
    await shot(browser, s, 'auth-login-desktop-dark-script-failed');
    result('auth-shell: if the script never comes the page says to reload, and the button is not left spinning', /did not finish loading/.test(stuck.note) && stuck.at === '/login' && stuck.words === 'Sign in', stuck);

    errors.length = 0;
    await goto(browser, s, `${google.base}/login`, "!!document.querySelector('form[data-form] button[type=submit]')");
    for (let i = 0; i < 40 && !held.length; i++) await sleep(100);
    await browser.send('Fetch.continueRequest', { requestId: held.shift().requestId }, s);
    await sleep(800);
    await ev("document.querySelector('[data-stay]').checked = true, 1");
    await clickSel(browser, s, '[data-google]');
    for (let i = 0; i < 40 && !held.length; i++) await sleep(100);
    const started = held.length ? held.shift() : null;
    if (started) await browser.send('Fetch.failRequest', { requestId: started.requestId, errorReason: 'Aborted' }, s);
    result('auth-shell: the Google button starts Google sign-in and carries Stay signed in', Boolean(started) && /\/auth\/google\/start\?next=%2Fapp&stay=1$/.test(started.request.url), started && started.request.url);
    await browser.send('Fetch.disable', {}, s);
  } finally {
    await close();
    await plain.stop();
    await google.stop();
  }
}

module.exports = checkAuthShell;
