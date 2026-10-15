'use strict';
/**
 * companion-core  The companion's everyday features, used as a person uses them, in a real headless Chrome with the
 * real Sentinel server behind it on 127.0.0.1:47821 (the address the Windows app's own server uses):
 *   1. The toolbar popup signed out, then pairing through the connect page as with the Windows app, then the popup
 *      paired, with live scanning on and off, on a flagged page and on a safe page, and its Scan this page button.
 *   2. The options page: every switch named and kept, a wrong server address refused, the keyboard's focus seen,
 *      headings for a screen reader, no console errors.
 *   3. Search-result marks on the real Google, Bing and DuckDuckGo for ordinary searches: do they appear, are they
 *      right, do they shift the page (layout shift with and without the companion), how long they take. And a results
 *      page opened in a tab the person looks at only later.
 *   4. Webmail marks on stand-ins at mail.google.com and outlook.live.com (no public test inbox is reachable), in the
 *      class names and roles the real ones use, also when the inbox tab was opened in the background.
 *   5. The password alarm for a bank added in the options page: learned on a two-step sign-in with no form, sounded on
 *      a look-alike whose password box is in a frame from another address.
 *   6. The pasted-command guard on a fake "verify you are human" page that copies with a real click.
 *   7. All of it again right after the browser stops the companion's worker.
 *   8. The Firefox build, where Firefox is on the runner (scripts/verify-companion-firefox.js).
 * Runners may visit real public sites; the scam pages are local and harmless.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT, sleep, result, serveFiles, launch, evalIn, openPage, goto, pageText, shot, typeText, TYPED_PW, watchErrors, pressKey, until } = require('./_shared');
const { tlsServer, startSentinel, loadCompanion, stopWorker, workerTarget, pairedOptions, page, gmailPage, outlookPage } = require('./_companion');

const PORT = 47821;
const PASSWORD = 'Harbour-Lantern-5530';
const BANK = 'mybank-example.com';
const LOOKALIKE = 'mybank-example-secure.top';
const FRAMEHOST = 'auth-frame.top';
const VERIFY = 'verify-human-check.top';
const BAD = `powershell -w hidden -enc ${Buffer.from('Write-Output hi', 'utf16le').toString('base64')} # I am not a robot - reCAPTCHA Verification ID: 4471`;   // harmless, shaped like ClickFix
const TLS_HOSTS = ['mail.google.com', 'outlook.live.com', BANK, `www.${BANK}`, LOOKALIKE, FRAMEHOST, VERIFY];

// [engine, url, result title selector (content/serp.js), words of a bot check]
const ENGINES = [
  ['bing', 'https://www.bing.com/search?q=banana+bread+recipe&setlang=en', '#b_results li.b_algo h2', /verify you are a human|unusual traffic|captcha/i],
  ['duckduckgo-html', 'https://html.duckduckgo.com/html/?q=how+to+reset+a+wifi+router', 'a.result__a', /anomaly|captcha|bots use duckduckgo/i],
  ['duckduckgo', 'https://duckduckgo.com/?q=paypal+login+help&ia=web', '[data-testid="result-title-a"]', /anomaly|captcha|bots use duckduckgo/i],
  ['google', 'https://www.google.com/search?q=weather+london&hl=en&gl=us', '#search h3, #rso h3', /unusual traffic|not a robot|recaptcha|before you continue/i]
];

const CLS = `window.__cls = 0; window.__shifts = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push(Math.round(performance.now())); } })
    .observe({ type: 'layout-shift', buffered: true }); } catch {}`;

async function checkCompanionCore() {
  const sentinel = await startSentinel('companion-core', PORT);
  const base = sentinel.base;
  const posts = [];
  const tls = await tlsServer(TLS_HOSTS, (req, res, host) => {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => { posts.push({ host, body }); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page('Done', '<p>Signed in</p>')); });
      return;
    }
    const send = (html) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
    if (host === 'mail.google.com') return send(gmailPage());
    if (host === 'outlook.live.com') return send(outlookPage());
    if (host === BANK || host === `www.${BANK}`) {
      // A bank's two-step sign-in with no form: the password box appears after Next, and Sign in is a script's button.
      return send(page('Sign in - My Bank', `<main style="margin:40px"><h1>Sign in to My Bank</h1>
        <div id="step1"><label>Username <input id="user" autocomplete="username"></label> <button id="next" type="button">Next</button></div>
        <div id="step2" hidden><label>Password <input id="pw" type="password" autocomplete="current-password"></label> <div role="button" tabindex="0" id="go" style="display:inline-block;padding:6px 12px;background:#0a5;color:#fff">Sign in</div></div>
        <p id="msg"></p></main><script>
        document.getElementById('next').onclick = () => { document.getElementById('step2').hidden = false; document.getElementById('pw').focus(); };
        document.getElementById('go').onclick = () => fetch('/signin', { method: 'POST', body: 'pw=' + encodeURIComponent(document.getElementById('pw').value) }).then(() => { document.getElementById('msg').textContent = 'Welcome back'; });
      </script>`));
    }
    if (host === LOOKALIKE) return send(page('My Bank - Secure sign in', `<main style="margin:40px"><h1>My Bank secure sign in</h1><iframe src="https://${FRAMEHOST}/login" title="Sign in" style="width:420px;height:200px;border:1px solid #ccc"></iframe></main>`));
    if (host === FRAMEHOST) return send(page('Sign in', `<form method="post" action="/signin" style="margin:12px"><label>Password <input type="password" name="pw"></label> <button>Sign in</button></form>`));
    if (host === VERIFY) {
      return send(page('Just a moment...', `<main style="margin:60px auto;max-width:460px;text-align:center"><h1>Verify you are human</h1>
        <p>Complete the action below to continue.</p><button id="robot" type="button" style="font-size:18px;padding:12px 20px">I'm not a robot</button>
        <ol id="steps" hidden style="text-align:left"><li>Press Windows + R</li><li>Press Ctrl + V</li><li>Press Enter</li></ol></main><script>
        document.getElementById('robot').onclick = () => { const t = document.createElement('textarea'); t.value = ${JSON.stringify(BAD)};
          document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } finally { t.remove(); } document.getElementById('steps').hidden = false; };
      </script>`));
    }
    res.writeHead(404); res.end();
  });
  const files = await serveFiles({}, {
    '/account.html': page('Account', '<main style="margin:40px"><h1>Your account</h1><p>Confirm your details.</p></main>'),
    '/plain.html': page('Recipes', '<main style="margin:40px"><h1>Banana bread</h1><p>Three ripe bananas, flour, sugar, an egg and butter.</p></main>')
  });
  const filesPort = new URL(files.base).port;
  const rules = `--host-resolver-rules=${tls.rules},MAP ${TYPED_PW} 127.0.0.1:${filesPort},MAP plain.test 127.0.0.1:${filesPort}`;
  const withIt = await launch([rules, '--ignore-certificate-errors']);
  const without = await launch([rules, '--ignore-certificate-errors']);
  const { browser } = withIt;
  try {
    const id = await loadCompanion(browser);
    const ext = `chrome-extension://${id}`;

    /* ---------------------------------------------------------------- 1. popup */

    // A web tab the person is on; the popup opens over it (in the background here, so that tab stays the active one).
    const web = await openPage(browser);
    async function popup(name, { width = 360 } = {}) {
      await browser.send('Target.activateTarget', { targetId: web.targetId });
      const t0 = Date.now();
      const { targetId } = await browser.send('Target.createTarget', { url: `${ext}/src/popup.html`, background: true });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId).catch(() => {});
      const errors = await watchErrors(browser, sessionId);
      const ready = await until(browser, sessionId, "document.readyState === 'complete' && !document.querySelector('#view .loading') && !document.querySelector('#view .spin')", 30000);
      const ms = Date.now() - t0;
      await sleep(600);
      const info = await evalIn(browser, sessionId, `(() => {
        const q = (s) => document.querySelector(s);
        const live = [...document.querySelectorAll('.card')].find((c) => /Live protection/.test(c.textContent));
        const state = live && live.querySelector('.row .small');
        return { text: q('#view').innerText.replace(/\\s+/g, ' ').trim(), plan: q('#plan').hidden ? null : q('#plan').textContent,
          host: (q('.host') || {}).textContent || null, live: state ? state.textContent : null, liveColor: state ? getComputedStyle(state).color : null,
          links: [...document.querySelectorAll('#view a')].map((a) => a.textContent.trim() + ' -> ' + a.href), pw: q('#pwLine').innerText,
          page: (q('[data-page-state]') || {}).innerText || null, scroll: document.documentElement.scrollWidth > innerWidth };
      })()`).catch((err) => ({ error: err.message }));
      await shot(browser, sessionId, `companion-core-popup-${name}`);
      return { ready: Boolean(ready), ms, errors, info, sessionId, targetId, close: () => browser.send('Target.closeTarget', { targetId }).catch(() => {}) };
    }

    await goto(browser, web.sessionId, 'http://plain.test/plain.html');
    const out = await popup('signed-out');
    await out.close();
    result(`companion-core: popup signed out says to sign in, with Sign in and Create account (shown in ${out.ms} ms)`,
      out.ready && /Sign in to Sentinel/.test(out.info.text) && out.info.links.some((l) => /^Sign in -> .*\/connect$/.test(l)) && out.info.links.some((l) => /^Create account -> /.test(l)) && !out.errors.length && out.ms < 8000,
      { ...out.info, errors: out.errors });

    // Pairing, as with the Windows app: an account on 127.0.0.1:47821, signed in in this browser, then its connect page.
    await goto(browser, web.sessionId, `${base}/login`);
    const email = `pat-${Date.now()}@example.com`;
    const signed = await evalIn(browser, web.sessionId, `(async () => {
      const post = (p, body) => fetch('/api/v1' + p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);
      const up = await post('/auth/signup', { firstName: 'Pat', email: ${JSON.stringify(email)}, password: 'Quiet-Harbour-90210-x', ageConfirmed: true, termsAccepted: true });
      const inn = await post('/auth/login', { email: ${JSON.stringify(email)}, password: 'Quiet-Harbour-90210-x' });
      return up + ' ' + inn;
    })()`);
    await goto(browser, web.sessionId, `${base}/connect`);
    const connected = await until(browser, web.sessionId, "/protected|Couldn|not found/i.test((document.querySelector('[data-title]') || {}).textContent || '') && document.querySelector('[data-title]').textContent", 20000);
    const connectBody = await evalIn(browser, web.sessionId, "(document.querySelector('[data-body]') || {}).textContent || ''");
    await shot(browser, web.sessionId, 'companion-core-connect');
    const opt = await pairedOptions(browser, id, base, null);
    const store = () => evalIn(browser, opt.sessionId, 'Promise.all([chrome.storage.sync.get(null), chrome.storage.local.get(["authToken", "account"])]).then(([s, l]) => ({ apiBase: s.apiBase, enabled: s.enabled, token: Boolean(l.authToken), signedIn: Boolean(l.account && l.account.signedIn) }))');
    const afterPair = await store();
    result('companion-core: pairing through the connect page on 127.0.0.1:47821 says "You\'re protected" and the companion follows that server',
      /protected/.test(connected || '') && afterPair.apiBase === base && afterPair.token, { signup: signed, title: connected, body: connectBody, store: afterPair });

    const paired = await popup('paired');
    await paired.close();
    result('companion-core: popup paired shows the plan, this page, the Scan button, Live protection On, and the password alarm line',
      paired.ready && paired.info.plan === 'Free' && paired.info.host === 'plain.test' && /Scan this page/.test(paired.info.text) && paired.info.live === 'On' && /Password alarm is off/.test(paired.info.pw) && !paired.info.scroll && !paired.errors.length,
      { ...paired.info, errors: paired.errors });

    // Live scanning switched off in the options page with a real click, then the popup.
    const click = async (sessionId, selector) => {
      const at = await evalIn(browser, sessionId, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: at[0], y: at[1], button: 'left', clickCount: 1 }, sessionId);
      await sleep(400);
    };
    await click(opt.sessionId, '#enabled');
    const offStore = await store();
    const off = await popup('live-off');
    await off.close();
    await click(opt.sessionId, '#enabled');
    const onStore = await store();
    // Off is not good news: it must not be drawn in the green that means protected.
    const green = (c) => { const m = /rgb\((\d+), (\d+), (\d+)/.exec(c || ''); return Boolean(m && +m[2] > 120 && +m[2] > +m[1] * 1.3 && +m[2] > +m[3] * 1.2); };
    result('companion-core: switching Live scanning off in the options page shows Off in the popup, not in the green that means protected, and on again',
      offStore.enabled === false && onStore.enabled === true && off.info.live === 'Off' && !green(off.info.liveColor), { offStore, onStore, live: off.info.live, color: off.info.liveColor, onColor: paired.info.liveColor });

    // A flagged page: the icon says "!" and the popup should say why.
    await goto(browser, web.sessionId, `http://${TYPED_PW}/account.html`);
    await sleep(3000);
    const badge = await evalIn(browser, opt.sessionId, `chrome.tabs.query({}).then((tabs) => { const t = tabs.find((x) => (x.url || '').includes(${JSON.stringify(TYPED_PW)})); return t ? chrome.action.getBadgeText({ tabId: t.id }) : null; })`);
    const flagged = await popup('flagged-page');
    await flagged.close();
    result('companion-core: on a flagged page (the icon shows "!") the popup says Sentinel flagged it, and why',
      badge === '!' && /flagged/i.test(flagged.info.page || '') && flagged.info.host === TYPED_PW, { badge, page: flagged.info.page, text: flagged.info.text });

    // A safe page: what live scanning found, then a person's own Scan this page.
    await goto(browser, web.sessionId, 'https://en.wikipedia.org/wiki/Banana').catch(() => {});
    await sleep(3000);
    const safe = await popup('safe-page');
    const scanned = await (async () => {
      await click(safe.sessionId, '#scan');
      const done = await until(browser, safe.sessionId, "!/Scanning/.test(document.getElementById('scan').textContent) && document.getElementById('scan').textContent", 60000);
      const r = await evalIn(browser, safe.sessionId, "({ result: document.getElementById('result').innerText.replace(/\\s+/g, ' ').trim(), button: document.getElementById('scan').textContent.trim() })");
      await shot(browser, safe.sessionId, 'companion-core-popup-safe-page-scanned');
      return { done: Boolean(done), ...r };
    })();
    await safe.close();
    result('companion-core: on a safe page the popup says live scanning found no warning signs, and Scan this page shows the three masks\' answers',
      /no warning signs/i.test(safe.info.page || '') && safe.info.host === 'en.wikipedia.org' && /Scam/.test(scanned.result) && /left this week/.test(scanned.button), { page: safe.info.page, scanned });

    /* -------------------------------------------------------------- 2. options */

    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "document.getElementById('account').textContent !== 'Checking your account\u2026'");
    const optErrors = await watchErrors(browser, opt.sessionId);
    await sleep(800);
    const optInfo = await evalIn(browser, opt.sessionId, `(() => {
      const controls = [...document.querySelectorAll('input, select, button')].filter((e) => e.offsetParent);
      const unnamed = controls.filter((e) => !((e.labels && e.labels[0] && e.labels[0].innerText.trim()) || e.getAttribute('aria-label') || e.textContent.trim())).map((e) => e.outerHTML.slice(0, 80));
      return { account: document.getElementById('account').textContent, headings: [...document.querySelectorAll('h1, h2, h3')].map((h) => h.tagName + ' ' + h.textContent.trim()),
        unnamed, scroll: document.documentElement.scrollWidth > innerWidth };
    })()`);
    await click(opt.sessionId, '#markSafe');
    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "document.getElementById('markSafe') && document.readyState === 'complete'");
    await sleep(500);
    const kept = await evalIn(browser, opt.sessionId, "document.getElementById('markSafe').checked");
    await click(opt.sessionId, '#markSafe');
    // A server address that is not https is refused, and the field goes back.
    const refused = await evalIn(browser, opt.sessionId, `(async () => { const e = document.getElementById('apiBase'); const was = e.value; e.value = 'http://sentinel.example.com'; e.dispatchEvent(new Event('change'));
      await new Promise((r) => setTimeout(r, 300)); return { said: document.getElementById('saved').textContent, value: e.value, was }; })()`);
    // The keyboard: Tab to the Add button and the Sign out button, and the focus must be visible.
    const focusRing = async (selector, from) => {
      await evalIn(browser, opt.sessionId, `(() => { const f = document.querySelector(${JSON.stringify(from)}); f.scrollIntoView({ block: 'center' }); f.focus(); })()`);
      await pressKey(browser, opt.sessionId, 'Tab');
      return evalIn(browser, opt.sessionId, `(() => { const a = document.activeElement; const s = getComputedStyle(a); return { on: a === document.querySelector(${JSON.stringify(selector)}), outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow }; })()`);
    };
    const ringAdd = await focusRing('#pwBankForm button', '#pwBank');
    const ringOut = await focusRing('#signout', '#apiBase');
    const visible = (r) => r.on && (!/^none/.test(r.outline) || /rgb/.test(r.shadow) && r.shadow !== 'none');
    await shot(browser, opt.sessionId, 'companion-core-options-dark');
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, opt.sessionId);
    await shot(browser, opt.sessionId, 'companion-core-options-light');
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, opt.sessionId);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 800, deviceScaleFactor: 1, mobile: false }, opt.sessionId);
    const narrow = await evalIn(browser, opt.sessionId, 'document.documentElement.scrollWidth > innerWidth');
    await shot(browser, opt.sessionId, 'companion-core-options-narrow');
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, opt.sessionId);
    result('companion-core: options page: every switch is named, a change is kept after reload, a non-https server is refused and put back, it fits a narrow window, no console errors',
      !optInfo.unnamed.length && kept === false && /https/.test(refused.said) && refused.value === refused.was && !optInfo.scroll && !narrow && !optErrors.length,
      { ...optInfo, kept, refused, narrow, errors: optErrors });
    result('companion-core: options page: the keyboard\'s focus is visible on its buttons, and its sections are headings a screen reader can jump between',
      visible(ringAdd) && visible(ringOut) && optInfo.headings.filter((h) => /^H2/.test(h)).length >= 4, { add: ringAdd, signOut: ringOut, headings: optInfo.headings });

    // From here on the account is on Pro (email protection and delicate scanning), as the Windows app's own account is.
    await goto(browser, web.sessionId, `${base}/login`);
    const pro = await evalIn(browser, web.sessionId, "fetch('/api/v1/billing/plan', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: 'pro' }) }).then((r) => r.status)");
    const refreshed = await evalIn(browser, opt.sessionId, "chrome.runtime.sendMessage({ type: 'refresh' }).then((r) => r.account && r.account.plan && r.account.plan.id)");
    result('companion-core: the account moved to Pro, and the companion picks it up', pro === 200 && refreshed === 'pro', { pro, refreshed });

    /* ---------------------------------------------------- 3. real search pages */

    async function serp(b, [engine, url, sel, botRe], { companion, name, focus = true } = {}) {
      const t = await openPage(b);
      if (!focus) await b.send('Emulation.setFocusEmulationEnabled', { enabled: false }, t.sessionId);
      await b.send('Page.addScriptToEvaluateOnNewDocument', { source: CLS }, t.sessionId);
      const t0 = Date.now();
      await b.send('Page.navigate', { url }, t.sessionId).catch(() => {});
      await until(b, t.sessionId, "document.readyState === 'complete'", 30000);
      const loadedAt = Date.now() - t0;
      const snap = () => evalIn(b, t.sessionId, `(() => {
        const heads = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((h) => { const r = h.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight + 600; });
        const marked = heads.filter((h) => (h.closest('h1, h2, h3') || h).querySelector('.sentinel-masks') || (h.closest('a') && h.closest('a').parentElement.querySelector('.sentinel-masks')));
        const kinds = { clear: 0, yellow: 0, orange: 0, red: 0 };
        const flagged = [];
        for (const g of document.querySelectorAll('.sentinel-masks')) {
          for (const m of g.querySelectorAll('.sentinel-mask')) for (const k of Object.keys(kinds)) if (m.classList.contains('sentinel-mask--' + k)) kinds[k]++;
          if (!g.classList.contains('sentinel-masks--clear')) { const a = g.closest('a') || (g.parentElement && g.parentElement.querySelector('a')); flagged.push(((a && a.href) || '').slice(0, 90) + ' ' + g.querySelector('.sentinel-mask').className.replace(/sentinel-mask ?/g, '')); }
        }
        const wrapped = [...document.querySelectorAll('.sentinel-masks')].filter((g) => { const h = g.parentElement; const lh = parseFloat(getComputedStyle(h).lineHeight) || 24; return h.getBoundingClientRect().height > lh * 1.6; }).length;
        return { title: document.title.slice(0, 80), results: heads.length, marked: marked.length, kinds, flagged, wrapped, cls: Math.round(window.__cls * 10000) / 10000,
          bot: ${botRe}.test(document.body ? document.body.innerText.slice(0, 3000) : ''), focused: document.hasFocus() };
      })()`).catch((err) => ({ error: err.message }));
      let s = await snap();
      let markedAt = null;
      for (let i = 0; i < 80 && companion && focus && !(s.results && s.marked >= s.results); i++) { await sleep(250); s = await snap(); }
      if (companion && s.results && s.marked >= s.results) markedAt = Date.now() - t0;
      if (!companion) await sleep(3000);
      await sleep(1500);
      s = await snap();
      if (name) await shot(b, t.sessionId, name);
      return { engine, url, loadedAt, markedAt, ...s, target: t };
    }

    const engines = [];
    for (const e of ENGINES) {
      const plain = await serp(without.browser, e, { companion: false });
      await without.browser.send('Target.closeTarget', { targetId: plain.target.targetId }).catch(() => {});
      const comp = await serp(browser, e, { companion: true, name: `companion-core-serp-${e[0]}` });
      await browser.send('Target.closeTarget', { targetId: comp.target.targetId }).catch(() => {});
      const { target: _a, ...c } = comp;
      const { target: _b, ...p } = plain;
      engines.push({ engine: e[0], companion: c, plain: { results: p.results, cls: p.cls, loadedAt: p.loadedAt, bot: p.bot } });
    }
    const reached = engines.filter((x) => !x.companion.bot && x.companion.results);
    result(`companion-core: real search pages: every result on screen is marked, none red, on ${reached.map((x) => x.engine).join(', ') || 'none'} (${engines.filter((x) => x.companion.bot).map((x) => x.engine).join(', ') || 'no engine'} showed a bot check to the runner)`,
      reached.length >= 2 && reached.every((x) => x.companion.marked >= x.companion.results && !x.companion.kinds.red),
      engines.map((x) => ({ engine: x.engine, results: x.companion.results, marked: x.companion.marked, kinds: x.companion.kinds, flagged: x.companion.flagged, markedInMs: x.companion.markedAt, bot: x.companion.bot, title: x.companion.title })));
    result('companion-core: real search pages: the marks do not shift the page (layout shift with the companion within 0.02 of without) and do not wrap titles',
      reached.every((x) => x.companion.cls - x.plain.cls <= 0.02 && !x.companion.wrapped),
      engines.map((x) => ({ engine: x.engine, clsWith: x.companion.cls, clsWithout: x.plain.cls, wrappedTitles: x.companion.wrapped, loadWith: x.companion.loadedAt, loadWithout: x.plain.loadedAt })));

    // A results page opened in a tab the person looks at only later (a middle click, or the window behind another).
    const bgEngine = ENGINES.find((e) => reached.some((x) => x.engine === e[0])) || ENGINES[0];
    const bg = await serp(browser, bgEngine, { companion: true, focus: false });
    await sleep(3000);
    const before = await evalIn(browser, bg.target.sessionId, "({ marks: document.querySelectorAll('.sentinel-masks').length, focused: document.hasFocus() })");
    await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, bg.target.sessionId);
    await browser.send('Target.activateTarget', { targetId: bg.target.targetId });
    const later = await until(browser, bg.target.sessionId, `document.querySelectorAll('.sentinel-masks').length >= Math.max(1, [...document.querySelectorAll(${JSON.stringify(bgEngine[2])})].filter((h) => h.getBoundingClientRect().top < innerHeight + 600).length) && document.querySelectorAll('.sentinel-masks').length`, 15000);
    await shot(browser, bg.target.sessionId, 'companion-core-serp-background-tab');
    await browser.send('Target.closeTarget', { targetId: bg.target.targetId }).catch(() => {});
    result(`companion-core: a ${bgEngine[0]} results page opened in the background gets its marks once the person looks at it (none are spent while it is not looked at)`,
      before.marks === 0 && Boolean(later), { whileHidden: before, afterLooking: later, results: bg.results });

    /* ------------------------------------------------------------- 4. webmail */

    async function inbox(url, { focus = true, name } = {}) {
      const t = await openPage(browser);
      if (!focus) await browser.send('Emulation.setFocusEmulationEnabled', { enabled: false }, t.sessionId);
      await goto(browser, t.sessionId, url);
      const read = () => evalIn(browser, t.sessionId, `(() => {
        const rows = [...document.querySelectorAll('tr.zA, [role=option]')].map((r) => ({ who: (r.querySelector('[email]') || r.querySelector('[title]') || {}).getAttribute ? (r.querySelector('[email]') ? r.querySelector('[email]').getAttribute('email') : r.querySelector('[title]').getAttribute('title')) : '', masks: [...r.querySelectorAll('.sentinel-mask')].map((m) => m.className.replace(/sentinel-mask ?/g, '')) }));
        const open = document.querySelector('.adn .sentinel-masks');
        const named = [...document.querySelectorAll('.sentinel-masks--mail')].map((g) => g.getAttribute('aria-label') || [...g.querySelectorAll('[aria-label],[role=img]')].map((m) => m.getAttribute('aria-label')).join(' ') || '');
        return { rows, open: Boolean(open), named, focused: document.hasFocus() };
      })()`);
      let r = await read();
      if (focus) for (let i = 0; i < 60 && !r.rows.some((x) => x.masks.length); i++) { await sleep(250); r = await read(); }
      if (name) await shot(browser, t.sessionId, name);
      return { ...r, t };
    }
    const flaggedRow = (r, who) => r.rows.some((x) => x.who.includes(who) && x.masks.length);
    const quietRow = (r) => r.rows.filter((x) => /paypal\.com$|gmail\.com|github\.com/.test(x.who)).every((x) => !x.masks.length);
    const gmail = await inbox('https://mail.google.com/mail/u/0/#inbox', { name: 'companion-core-gmail' });
    const outlook = await inbox('https://outlook.live.com/mail/0/', { name: 'companion-core-outlook' });
    for (const x of [gmail, outlook]) await browser.send('Target.closeTarget', { targetId: x.t.targetId }).catch(() => {});
    result('companion-core: webmail stand-ins at mail.google.com and outlook.live.com: the two scam emails are marked, the open scam message too, honest ones are not',
      flaggedRow(gmail, 'paypa1-secure-login.com') && flaggedRow(gmail, 'netflix-billing-update.top') && gmail.open && quietRow(gmail)
      && flaggedRow(outlook, 'paypa1-secure-login.com') && flaggedRow(outlook, 'netflix-billing-update.top') && quietRow(outlook),
      { gmail: gmail.rows, gmailOpen: gmail.open, outlook: outlook.rows });
    result('companion-core: webmail marks are named for a screen reader (what was found), not only a tooltip',
      gmail.named.length > 0 && gmail.named.every((n) => /Sentinel/.test(n)), { named: gmail.named });

    const later2 = await inbox('https://mail.google.com/mail/u/0/#inbox', { focus: false });
    await sleep(3000);
    const hidden = await evalIn(browser, later2.t.sessionId, "document.querySelectorAll('.sentinel-masks').length");
    await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, later2.t.sessionId);
    await browser.send('Target.activateTarget', { targetId: later2.t.targetId });
    const shown = await until(browser, later2.t.sessionId, "document.querySelectorAll('.sentinel-masks').length", 15000);
    await shot(browser, later2.t.sessionId, 'companion-core-gmail-background-tab');
    await browser.send('Target.closeTarget', { targetId: later2.t.targetId }).catch(() => {});
    result('companion-core: an inbox opened in a background tab (a pinned Gmail tab) gets its marks once the person looks at it',
      hidden === 0 && Boolean(shown), { whileHidden: hidden, afterLooking: shown });

    /* ------------------------------------------------------ 5. password alarm */

    await goto(browser, opt.sessionId, `${ext}/src/options.html`, "document.getElementById('pwBank') && document.readyState === 'complete'");
    await sleep(500);
    await evalIn(browser, opt.sessionId, "document.getElementById('pwBank').focus()");
    await typeText(browser, opt.sessionId, `https://www.${BANK}/login`);
    await pressKey(browser, opt.sessionId, 'Enter');
    const bankRow = await until(browser, opt.sessionId, `(() => { const t = document.getElementById('pwBanks').innerText; return /${BANK.replace(/\./g, '\\.')}/.test(t) && t; })()`, 8000);
    const tab = await openPage(browser);
    const s = tab.sessionId;
    await goto(browser, s, `https://www.${BANK}/`);
    await sleep(1200);
    await click(s, '#user');
    await typeText(browser, s, 'pat');
    await click(s, '#next');
    await typeText(browser, s, PASSWORD);
    await click(s, '#go');
    let learned = false;
    for (let i = 0; i < 40 && !learned; i++) {
      await sleep(250);
      const list = await evalIn(browser, opt.sessionId, "chrome.runtime.sendMessage({ type: 'pw-list' })");
      learned = Boolean(list && list.accounts && list.accounts.some((a) => a.id === `bank:${BANK}` && a.learned));
    }
    const signedIn = posts.some((p) => p.host === `www.${BANK}` && p.body.includes(encodeURIComponent(PASSWORD)));
    result(`companion-core: a bank added in the options page by its full address is learned on its two-step sign-in with no form (and the sign-in goes through)`,
      /Waiting for you to sign in once/.test(bankRow || '') && learned && signedIn, { bankRow, learned, signedIn });

    async function lookalike(label) {
      const before = posts.length;
      await goto(browser, s, `https://${LOOKALIKE}/`);
      await sleep(1500);
      const frame = await evalIn(browser, s, "(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left, r.top]; })()");
      // Into the frame's password box with a real click, then type.
      for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x: frame[0] + 180, y: frame[1] + 28, button: 'left', clickCount: 1 }, s);
      await sleep(300);
      await typeText(browser, s, PASSWORD);
      let text = '';
      for (let i = 0; i < 40 && !/This is your/.test(text); i++) { await sleep(250); text = await pageText(browser, s); }
      await sleep(2000);
      await shot(browser, s, `companion-core-pw-alarm-${label}`);
      const sent = posts.slice(before).filter((p) => p.host === FRAMEHOST);
      // The frame is another site, so it is its own target: read its box there.
      const box = await (async () => {
        const { targetInfos } = await browser.send('Target.getTargets');
        const f = targetInfos.find((x) => x.type === 'iframe' && x.url.includes(FRAMEHOST));
        if (!f) return evalIn(browser, s, "(document.querySelector('iframe').contentDocument.querySelector('input[type=password]') || {}).value");
        const { sessionId: fs } = await browser.send('Target.attachToTarget', { targetId: f.targetId, flatten: true });
        const v = await evalIn(browser, fs, "document.querySelector('input[type=password]').value");
        await browser.send('Target.detachFromTarget', { sessionId: fs }).catch(() => {});
        return v;
      })().catch((err) => `error: ${err.message}`);
      return { alarm: new RegExp(`This is your ${BANK.replace(/\./g, '\\.')} password`).test(text), box, sent: sent.length, onScreen: text.slice(0, 240) };
    }
    const alarm1 = await lookalike('frame');
    result(`companion-core: that password typed into a frame from another address on a look-alike sounds the alarm, empties the box, and is not sent`,
      alarm1.alarm && alarm1.box === '' && !alarm1.sent, alarm1);

    /* ------------------------------------------------- 6. pasted-command guard */

    await browser.send('Browser.grantPermissions', { origin: `https://${VERIFY}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    async function robot(label) {
      const t = await openPage(browser);
      await goto(browser, t.sessionId, `https://${VERIFY}/`);
      await evalIn(browser, t.sessionId, "navigator.clipboard.writeText('shopping list')", { userGesture: true });
      await click(t.sessionId, '#robot');
      let text = '';
      for (let i = 0; i < 20 && !/stopped this page from copying/.test(text); i++) { await sleep(200); text = await pageText(browser, t.sessionId); }
      await shot(browser, t.sessionId, `companion-core-clickfix-${label}`);
      const clip = await evalIn(browser, t.sessionId, 'navigator.clipboard.readText()', { userGesture: true }).catch((err) => `error: ${err.message}`);
      await browser.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
      return { warned: /Sentinel stopped this page from copying a command/.test(text), clipboard: clip, onScreen: text.slice(0, 260) };
    }
    const robot1 = await robot('awake');
    result('companion-core: a fake "verify you are human" page that copies a Win+R command on a real click is stopped: nothing copied, the warning shows',
      robot1.warned && robot1.clipboard === 'shopping list', robot1);

    /* ------------------------------------------------- 7. after the worker stops */

    const stopped = await stopWorker(browser, id);
    const again = await popup('after-worker-stop');
    await again.close();
    const stopped2 = await stopWorker(browser, id);
    const reachedEngine = ENGINES.find((e) => reached.some((x) => x.engine === e[0]));
    const serpAgain = reachedEngine ? await serp(browser, [reachedEngine[0], reachedEngine[1].replace(/q=[^&]+/, 'q=library+opening+hours'), reachedEngine[2], reachedEngine[3]], { companion: true, name: 'companion-core-serp-after-worker-stop' }) : null;
    if (serpAgain) await browser.send('Target.closeTarget', { targetId: serpAgain.target.targetId }).catch(() => {});
    const stopped3 = await stopWorker(browser, id);
    const alarm2 = await lookalike('after-worker-stop');
    await stopWorker(browser, id);
    const robot2 = await robot('after-worker-stop');
    result('companion-core: after the browser stops the worker: the popup still shows the paired account, search marks appear, the password alarm and the pasted-command guard still work',
      stopped.gone && stopped2.gone && stopped3.gone && again.info.plan === 'Pro' && (!serpAgain || serpAgain.marked >= serpAgain.results) && alarm2.alarm && alarm2.box === '' && robot2.warned && robot2.clipboard === 'shopping list',
      { stopped: [stopped, stopped2, stopped3], popup: again.info.plan, serp: serpAgain && { engine: serpAgain.engine, results: serpAgain.results, marked: serpAgain.marked }, alarm: alarm2.alarm, robot: robot2 });
    await workerTarget(browser, id);

    /* ------------------------------------------------------------ 8. Firefox */

    const sync = spawnSync(process.execPath, [path.join(ROOT, 'desktop', 'scripts', 'sync-shared.js')], { cwd: ROOT, encoding: 'utf8' });
    const ff = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-companion-firefox.js'), '--server', base], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
    const ffOut = `${ff.stdout || ''}${ff.stderr || ''}`.trim().split(/\r?\n/);
    result(`companion-core: the Firefox build marks every result on a search page (${/SKIP/.test(ffOut[0] || '') ? 'Firefox is not on this runner' : (ffOut[0] || '').replace(/^(PASS|FAIL)\s+/, '')})`,
      ff.status === 0 || ff.status === 2, { sync: sync.status, exit: ff.status, out: ffOut });
  } finally {
    await withIt.close();
    await without.close();
    tls.close();
    files.server.close();
    await sentinel.stop();
  }
}

module.exports = checkCompanionCore;
