'use strict';
/**
 * check     The Check page as a person uses it, signed in on Free on the real server: the sidebar in four groups with one
 *           Check entry; the old scan pages' addresses opening it; what was pasted named in words, with the scan and the
 *           allowance it will use, before anything is spent; one press changing the guess; a parcel text spending a
 *           fast scan and an .exe link a virus scan, as the page said; a double press checking once; a phone number
 *           sent nowhere. Pictures at phone and desktop size, dark and light: check-<state>-<size>-<theme>.png.
 */
const fs = require('fs');
const path = require('path');
const { QR, sleep, result, launch, evalIn, openPage, goto, shot, typeText, startServer, watchErrors, clickSel, until } = require('./_shared');

const SIZES = { phone: [390, 844, true], desktop: [1366, 900, false] };
const PARCEL = 'USPS: Your parcel is on hold at our depot due to an unpaid $1.99 redelivery fee. Pay within 24 hours or it will be returned: https://usps-redeliver.top/track';
const EXE = 'https://downloads.example-cdn.net/setup/ChromeUpdate.exe';
const EMAIL = 'From: PayPal Security <alerts@paypa1-secure.com>\nSubject: Your account is limited\nDate: Mon, 3 Nov 2026 09:12:00 +0000\n\nDear customer, confirm your details at https://paypa1-secure-login.com/verify';

async function checkCheck() {
  const server = await startServer('check');
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: ${body ? "'POST'" : "'GET'"}, credentials: 'same-origin', ${body ? `headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);
    await goto(browser, s, `${base}/login`);
    const email = `check-${Date.now()}@example.com`;
    const password = 'Check-Page-Lamp-2026';
    const a = await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    const b = await api('/auth/login', { email, password });
    if (a.status !== 201 || b.status !== 200) throw new Error(`the test account could not sign in: ${a.status} ${b.status}`);
    const used = async () => { const u = (await api('/account/usage')).body.usage; return { link: u.linkScans.used, deep: u.deepScans.used, file: u.fileScans.used }; };
    const ready = "document.querySelector('[data-check-text]')";
    const put = async (text) => {
      await evalIn(browser, s, `(() => { const t = document.querySelector('[data-check-text]'); t.focus(); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await typeText(browser, s, text);
      await sleep(150);
      return evalIn(browser, s, "({ kind: document.querySelector('.ask').dataset.kind, says: document.querySelector('[data-says]').textContent, pressed: (document.querySelector('[data-kind][aria-pressed=true]') || {}).textContent || null, from: !document.querySelector('[data-from]').hidden })");
    };

    /* ------------------------------------------------------------ the sidebar */

    await goto(browser, s, `${base}/app/check`, ready);
    const side = await evalIn(browser, s, `(() => { const nav = document.querySelector('.side__nav');
      return { labels: [...nav.querySelectorAll('.side__label')].map((l) => l.textContent.trim()), checks: nav.querySelectorAll('a[href="/app/check"]').length,
        old: [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href')).filter((h) => /\\/app\\/(scan|threats|email|text)$/.test(h)),
        current: (nav.querySelector('[aria-current=page]') || {}).textContent.trim(), links: nav.querySelectorAll('a.side__link').length, h1: document.querySelector('#view h1').textContent, title: document.title }; })()`);
    result('check: the sidebar is four groups (Check, Protect, Review, Account) with one Check entry and none of the old scan pages',
      side.labels.join() === 'Check,Protect,Review,Account' && side.checks === 1 && !side.old.length && side.current === 'Check something' && side.h1 === 'Check something' && side.title === 'Check · Sentinel', side);
    // Every word in the sidebar at one size: the Check entry's label once came out smaller than its neighbours.
    const words = await evalIn(browser, s, `(() => { const sizes = []; const walk = document.createTreeWalker(document.querySelector('.side__nav'), NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (!n.textContent.trim()) continue; const e = n.parentElement; if (e.closest('.side__label') || !e.closest('.side__link')) continue;
        const r = document.createRange(); r.selectNodeContents(n); const hgt = Math.round(r.getBoundingClientRect().height); if (hgt) sizes.push([n.textContent.trim(), hgt]); }
      return sizes; })()`);
    result('check: the Check entry is set at the same size as every other sidebar entry', new Set(words.map(([, hgt]) => hgt)).size === 1, words);

    /* ------------------------------------------------------ the empty page */

    await evalIn(browser, s, '(sessionStorage.clear(), true)');
    await goto(browser, s, `${base}/app/check`, ready);
    const before = await used();
    const empty = await evalIn(browser, s, "({ said: document.querySelector('[data-says]').textContent, tryShown: !document.querySelector('[data-try]').hidden, examples: [...document.querySelectorAll('[data-example]')].map((b) => b.dataset.example), lead: document.querySelector('#view .page-title p').textContent })");
    const tried = {};
    for (const k of empty.examples) {
      await clickSel(browser, s, `[data-example=${k}]`);
      await sleep(250);
      tried[k] = await evalIn(browser, s, "({ kind: document.querySelector('.ask').dataset.kind, says: document.querySelector('[data-says]').textContent.slice(0, 40) })");
      await evalIn(browser, s, "(() => { const u = document.querySelector('[data-unfile]'); if (u) u.click(); const t = document.querySelector('[data-check-text]'); t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
    }
    const after = await used();
    result('check: the empty page says once what the box does and offers an example of each kind, which shows how it is read and spends nothing',
      !empty.said && empty.tryShown && !/works out which it is and says/.test(empty.said) && empty.examples.join() === 'link,message,email,file'
        && tried.link.kind === 'link' && tried.message.kind === 'message' && tried.email.kind === 'email' && tried.file.kind === 'file' && JSON.stringify(before) === JSON.stringify(after),
      { empty, tried, before, after });

    const moved = [];
    for (const [from, to] of [['/app/text', '/app/check'], ['/app/threats', '/app/check'], ['/app/email', '/app/check'], ['/app/scan?url=https%3A%2F%2Fgithub.com', '/app/check?url=https%3A%2F%2Fgithub.com']]) {
      await goto(browser, s, base + from, ready);
      moved.push({ from, at: await evalIn(browser, s, 'location.pathname + location.search'), want: to });
    }
    result('check: the old scan pages\' addresses (Windows app, history, bookmarks) open Check', moved.every((m) => m.at === m.want), moved);
    await until(browser, s, "document.querySelector('[data-out] [data-result]')", 30000);

    /* -------------------------------------------------- what it says before Check */

    await goto(browser, s, `${base}/app/check`, ready);
    const said = { parcel: await put(PARCEL), exe: await put(EXE), number: await put('+1 415 555 0199'), email: await put(EMAIL), link: await put('paypa1-secure-login.com/account') };
    result('check: a parcel text is named a message, with the fast scan it uses and a box for who sent it', said.parcel.kind === 'message' && /^A message\./.test(said.parcel.says) && /Uses 1 fast scan: \d+ of 10 left this week/.test(said.parcel.says) && said.parcel.from, said.parcel);
    result('check: an .exe link on Free is named a download and uses a virus scan', said.exe.kind === 'download' && /viruses and malware/.test(said.exe.says) && /virus scan: \d+ of 5 left/.test(said.exe.says), said.exe);
    result('check: a phone number is sent nowhere and points to the call check', said.number.kind === 'number' && /cannot look a number up/.test(said.number.says), said.number);
    result('check: an email on Free is checked as a message and says who sent it is Max, never a locked wall', said.email.kind === 'email' && /as a message/.test(said.email.says) && /part of Max/.test(said.email.says) && said.email.pressed === 'Email', said.email);
    result('check: a bare link is a link', said.link.kind === 'link' && said.link.pressed === 'Link', said.link);

    await put(PARCEL);
    await clickSel(browser, s, '[data-kind=link]');
    const changed = await evalIn(browser, s, "({ kind: document.querySelector('.ask').dataset.kind, pressed: document.querySelector('[data-kind][aria-pressed=true]').textContent, focus: document.activeElement.dataset.kind || document.activeElement.tagName })");
    result('check: one press changes the guess (a message checked as its link), and the focus stays on the press', changed.kind === 'link' && changed.pressed === 'Link' && changed.focus === 'link', changed);

    /* ------------------------------------------------- the allowance it said it would use */

    await put(PARCEL);
    let u0 = await used();
    await clickSel(browser, s, '.ask__go');
    await sleep(40);
    await clickSel(browser, s, '.ask__go').catch(() => {});
    const text = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-text-result]'); return r && { tone: r.dataset.textResult, title: r.querySelector('h2').textContent.trim() }; })()", 30000);
    await sleep(600);
    let u1 = await used();
    result('check: the parcel text is checked once, as a message, and spends one fast scan, nothing else, even pressed twice',
      Boolean(text) && text.tone !== 'clear' && u1.link === u0.link + 1 && u1.file === u0.file && u1.deep === u0.deep, { text, before: u0, after: u1 });

    await put(EXE);
    u0 = await used();
    await clickSel(browser, s, '.ask__go');
    const exe = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && r.querySelector('h2').textContent.trim(); })()", 30000);
    u1 = await used();
    result('check: the .exe link is checked for viruses and malware and spends one virus scan, not a link scan', Boolean(exe) && u1.file === u0.file + 1 && u1.link === u0.link, { exe, before: u0, after: u1 });

    await put('+1 415 555 0199');
    u0 = await used();
    await clickSel(browser, s, '.ask__go');
    await sleep(500);
    const num = await evalIn(browser, s, "({ focus: document.activeElement.getAttribute('href'), out: document.querySelector('[data-out]').textContent.trim().length })");
    u1 = await used();
    result('check: Check on a phone number spends nothing and takes the keyboard to the call check', num.focus === '/call' && u1.link === u0.link && u1.file === u0.file, { ...num, before: u0, after: u1 });

    /* ------------------------------------------------------------- pictures */

    const wide = [];
    for (const [size, [width, height, mobile]] of Object.entries(SIZES)) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, s);
      for (const theme of ['dark', 'light']) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
        // Empty for its picture: what was typed before is kept for the Back button (drafts), so it is cleared first.
        await evalIn(browser, s, '(sessionStorage.clear(), true)');
        await goto(browser, s, `${base}/app/check`, ready);
        await sleep(500);
        await shot(browser, s, `check-empty-${size}-${theme}`);
        await put(PARCEL);
        await evalIn(browser, s, '(document.activeElement.blur(), scrollTo(0, 0), true)');
        await sleep(300);
        await shot(browser, s, `check-said-${size}-${theme}`);
        const over = await evalIn(browser, s, 'document.documentElement.scrollWidth - innerWidth');
        if (over > 0) wide.push(`${size} ${theme}: ${over} px`);
        if (size === 'phone') {
          const bar = await evalIn(browser, s, "(() => { const a = document.querySelector('.side__nav a[href=\"/app/check\"]'); const r = a.getBoundingClientRect(); return { seen: r.width > 0 && r.bottom <= innerHeight + 1, current: a.getAttribute('aria-current') }; })()");
          if (!bar.seen || bar.current !== 'page') wide.push(`${theme}: Check is not in the phone's bottom bar ${JSON.stringify(bar)}`);
          // With the confirm-email notice showing, the Check button is still on screen, above the phone's bar.
          const go = await evalIn(browser, s, "(() => { const g = document.querySelector('.ask__go').getBoundingClientRect(); const navTop = document.querySelector('.side__nav').getBoundingClientRect().top; const v = document.querySelector('.verify-bar'); return { bottom: Math.round(g.bottom), navTop: Math.round(navTop), notice: v ? Math.round(v.getBoundingClientRect().height) : 0 }; })()");
          if (!go.notice || go.bottom > go.navTop) wide.push(`${theme}: the Check button is off screen with the notice showing ${JSON.stringify(go)}`);
        }
      }
    }
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, s);
    result('check: no sideways scroll at phone or desktop size, and Check sits in the phone\'s bottom bar, current', !wide.length, wide);
    result('check: no console errors', !errors.length, errors.slice(0, 5));

    /* ------------------------------ a screenshot of an email with a QR code in it: one answer */

    const qrPicture = path.join(QR, 'plain.png');
    if (fs.existsSync(qrPicture)) {
      if ((await api('/billing/plan', { plan: 'max' })).status !== 200) throw new Error('the test account could not move to Max');
      const { sessionId: q } = await openPage(browser);
      const sent = [];
      await browser.send('Network.enable', {}, q);
      browser.on('Network.requestWillBeSent', (p) => { if (p.request.method === 'POST' && /\/api\/v1\/scan\//.test(p.request.url)) sent.push({ url: p.request.url, post: p.request.postData || '' }); });
      // The Windows app's screen reader, stood in for: it "reads" the picture as this email.
      const words = ['From: Parcel Service <notice@parcel-delivery-help.top>', 'Subject: Your parcel is waiting', '', 'Scan the code below with your phone to pay the redelivery fee.'].join('\n');
      await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.sentinelDesktop = { info: () => Promise.reject(new Error('stand-in')), readScreenshot: (slices) => Promise.resolve(slices.map((s, i) => (i ? '' : ${JSON.stringify(words)}))) };` }, q);
      await goto(browser, q, `${base}/app/check`, "document.querySelector('[data-file]')");
      const { root } = await browser.send('DOM.getDocument', { depth: 0 }, q);
      const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-file]' }, q);
      await browser.send('DOM.setFileInputFiles', { nodeId, files: [qrPicture] }, q);
      const kind = await until(browser, q, "document.querySelector('.ask').dataset.kind === 'email' && document.querySelector('[data-check-text]').value.length > 0 && 'email'", 20000);
      const cardsBefore = await evalIn(browser, q, "document.querySelectorAll('[data-qr-result]').length");
      await evalIn(browser, q, "document.querySelector('[data-form]').requestSubmit(), true");
      const one = await until(browser, q, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && { results: document.querySelectorAll('#view [data-result]').length, cards: document.querySelectorAll('#view [data-qr-result]').length }; })()", 30000);
      const mail = sent.filter((r) => r.url.endsWith('/scan/email')).map((r) => JSON.parse(r.post));
      await shot(browser, q, 'check-email-qr');
      result('check: a screenshot of an email with a QR code is checked as one email, its code sent with it, with no separate QR card',
        kind === 'email' && !cardsBefore && Boolean(one) && one.results === 1 && one.cards === 0 && mail.length === 1 && mail[0].qr.length === 1 && !sent.some((r) => r.url.endsWith('/scan/qr')),
        { kind, cardsBefore, one, qr: mail.map((m) => m.qr), routes: sent.map((r) => r.url.replace(/.*\/api\/v1/, '')) });
    } else result('check: a screenshot of an email with a QR code (skipped: no qr-samples here)', true);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkCheck;
