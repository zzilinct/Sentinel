'use strict';
/**
 * appcore   The web app's core on the real server, signed in, used as a person does: every page's load time, heading
 *           and console; the link, delicate, QR and file scans; history and its delete; site rules; what the Free
 *           plan's weekly limits do when reached and after an upgrade; the security page; AI assistants; Browser
 *           checkup; the recovery guide; the Ctrl K palette by keyboard; and, at phone width, that every page and
 *           Sign out can still be reached.
 */
const fs = require('fs');
const path = require('path');
const { QR, OUT, sleep, result, launch, evalIn, openPage, goto, shot, typeText, pressEnter, startServer, watchErrors, clickSel, pressKey, until } = require('./_shared');

const PAGES = ['/app', '/app/week', '/app/scan', '/app/threats', '/app/email', '/app/text', '/app/call', '/app/history', '/app/sites', '/app/checkup',
  '/app/protection', '/app/plan', '/app/security', '/app/assistants', '/app/recover'];

async function checkAppCore() {
  // Delicate scans research the site from the server, which is this CI runner: never a person's computer.
  const server = await startServer('appcore', { RESEARCH_ENABLED: '1' });
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    const view = "document.querySelector('#view .page-title h1, #view h1')";
    const open = async (url, ready = view) => {
      const t = Date.now();
      await goto(browser, s, base + url, ready);
      const ms = Date.now() - t;
      await sleep(500);
      return ms;
    };
    const fill = async (selector, value) => {
      await evalIn(browser, s, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); e.focus(); e.select && e.select(); })()`);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, s);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, s);
      if (value) await typeText(browser, s, value);
    };
    const toasts = () => evalIn(browser, s, "[...document.querySelectorAll('.toast')].map((t) => t.textContent.trim()).join(' | ')");
    const setFile = async (selector, file) => {
      const { root } = await browser.send('DOM.getDocument', { depth: 0 }, s);
      const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector }, s);
      await browser.send('DOM.setFileInputFiles', { nodeId, files: [file] }, s);
    };
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: ${body ? "'POST'" : "'GET'"}, credentials: 'same-origin', ${body ? `headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`);

    await goto(browser, s, `${base}/login`);
    const email = `core-${Date.now()}@example.com`;
    const password = 'Core-Check-Lamp-2026';
    const a = await api('/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
    const b = await api('/auth/login', { email, password });
    if (a.status !== 201 || b.status !== 200) throw new Error(`the test account could not sign in: ${a.status} ${b.status}`);

    /* ------------------------------------------------------ every page */

    const pages = [];
    for (const p of PAGES) {
      const before = errors.length;
      const ms = await open(p);
      const info = await evalIn(browser, s, `(() => {
        const name = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || e.getAttribute('placeholder') || '').trim();
        const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
        const unnamed = [...document.querySelectorAll('#view button, #view input:not([type=hidden]), #view select, #view textarea, #view a[href]')]
          .filter((e) => visible(e) || e.type === 'file').filter((e) => !name(e) && !(e.id && document.querySelector('label[for=\"' + e.id + '\"]'))).map((e) => e.outerHTML.slice(0, 90));
        return { h1: [...document.querySelectorAll('#view h1')].map((h) => h.textContent.trim()), title: document.title, unnamed };
      })()`);
      pages.push({ page: p, ms, ...info, errors: errors.slice(before) });
    }
    result('appcore: every app page draws its heading in under 3 s, with one h1 and the page\'s own title',
      pages.every((p) => p.ms < 3000 && p.h1.length === 1 && / · Sentinel$/.test(p.title)), pages.map((p) => `${p.page} ${p.ms} ms, h1 ${JSON.stringify(p.h1)}, "${p.title}"`));
    const unnamed = pages.filter((p) => p.unnamed.length);
    result('appcore: every button, field and link on every app page has a name a screen reader can read', !unnamed.length, unnamed.map((p) => `${p.page}: ${p.unnamed.join(' ; ')}`));
    const noisy = pages.filter((p) => p.errors.length);
    result('appcore: no app page logs a console error', !noisy.length, noisy.map((p) => `${p.page}: ${p.errors.join(' ; ')}`));

    const lost = await fetch(`${base}/app/no-such-page`);
    result('appcore: a mistyped app address answers 404 with the site not-found page, not a quiet Overview', lost.status === 404 && /Nothing behind this mask/.test(await lost.text()), lost.status);

    /* ------------------------------------------------------- link scan */

    await open('/app/scan', "document.querySelector('.scanbox input')");
    await fill('.scanbox input', 'https://github.com');
    let t = Date.now();
    await pressEnter(browser, s);
    const github = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && { title: r.querySelector('h2').textContent.trim(), tone: r.className }; })()", 30000);
    const fastMs = Date.now() - t;
    const heard = await evalIn(browser, s, `(() => { const out = document.querySelector('[data-out]'); const a = document.activeElement;
      return { live: Boolean(out.closest('[aria-live]') || out.getAttribute('aria-live')), focusInResult: out.contains(a), focused: a && (a.tagName + ' ' + (a.textContent || '').trim().slice(0, 40)) }; })()`);
    await shot(browser, s, 'appcore-scan-github');
    result('appcore: a fast link scan of github.com answers in under 5 s, without a warning', Boolean(github) && fastMs < 5000 && !/red|orange/.test(github.tone), { ...github, ms: fastMs });
    result('appcore: a screen reader is told the scan\'s answer (a live region, or the answer gets focus)', heard.live || heard.focusInResult, heard);

    // Two quick presses on an example: one scan, one answer, never "Scan failed".
    await evalIn(browser, s, "document.querySelector('[data-example^=\"paypa1\"]').scrollIntoView({ block: 'center' })");
    await clickSel(browser, s, '[data-example^="paypa1"]');
    await sleep(60);
    await clickSel(browser, s, '[data-example^="paypa1"]');
    const failedFlash = await until(browser, s, "/Scan failed/.test(document.querySelector('[data-out]').innerText) && document.querySelector('[data-out]').innerText.slice(0, 200)", 2500);
    const scam = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && { title: r.querySelector('h2').textContent.trim(), tone: r.className }; })()", 30000);
    await sleep(1500);
    const after = await evalIn(browser, s, "document.querySelector('[data-out]').innerText.slice(0, 200)");
    await shot(browser, s, 'appcore-scan-scam');
    result('appcore: a double press on an example scans once and never flashes "Scan failed"', !failedFlash && !/Scan failed/.test(after), { failedFlash, after });
    result('appcore: the listed scam example gets a red warning', Boolean(scam) && /red/.test(scam.tone), scam);

    /* ---------------------------------------------------------------- QR */

    const qrPicture = path.join(QR, 'plain.png');
    if (fs.existsSync(qrPicture)) {
      await setFile('[data-qr-file]', qrPicture);
      const qr = await until(browser, s, "(() => { const c = document.querySelector('[data-qr-out] .qr-card'); return c && { title: c.querySelector('h2').textContent.trim(), focused: document.activeElement === c.querySelector('h2') }; })()", 20000);
      await shot(browser, s, 'appcore-qr');
      result('appcore: a QR picture chosen with Choose a picture is read on the page, explained, and its heading gets focus', Boolean(qr) && qr.focused, qr);
    } else result('appcore: a QR picture (skipped: no qr-samples here)', true);

    /* -------------------------------------------------------- file scan */

    const harmless = path.join(OUT, 'appcore-shopping list.txt');
    fs.writeFileSync(harmless, 'Milk\nBread\nApples\n');
    await open('/app/threats', "document.querySelector('[data-file]')");
    const fileFocus = await evalIn(browser, s, `(() => { const i = document.querySelector('[data-file]'); i.focus(); const d = i.closest('.drop');
      const cs = getComputedStyle(d); return { focused: document.activeElement === i, ring: cs.boxShadow + ' ' + cs.outlineStyle }; })()`);
    const unfocused = await evalIn(browser, s, "(() => { document.activeElement.blur(); const cs = getComputedStyle(document.querySelector('.drop')); return cs.boxShadow + ' ' + cs.outlineStyle; })()");
    result('appcore: the file drop box shows a focus ring when the keyboard reaches it', fileFocus.focused && fileFocus.ring !== unfocused, { focused: fileFocus.ring, unfocused });
    t = Date.now();
    await setFile('[data-file]', harmless);
    const file = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return r && { title: r.querySelector('h2').textContent.trim(), tone: r.className }; })()", 30000);
    await shot(browser, s, 'appcore-file');
    result('appcore: a harmless text file is scanned in under 5 s and found clean', Boolean(file) && Date.now() - t < 5000 && !/red|orange/.test(file.tone), { ...file, ms: Date.now() - t });

    /* ---------------------------------------------------------- history */

    const hMs = await open('/app/history', "document.querySelector('[data-rows] .list, [data-rows] .empty')");
    const hist = await evalIn(browser, s, "({ rows: [...document.querySelectorAll('[data-rows] li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80)), head: document.querySelector('[data-list] h2').textContent })");
    result('appcore: History lists every scan just made (link, scam, file)', hist.rows.length >= 3 && hist.rows.some((r) => /github/.test(r)) && hist.rows.some((r) => /paypa1/.test(r)) && hist.rows.some((r) => /shopping list/.test(r)), { ms: hMs, ...hist });
    await clickSel(browser, s, '[data-filter=flagged]');
    const flagged = await evalIn(browser, s, "[...document.querySelectorAll('[data-rows] li')].map((li) => li.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60))");
    await clickSel(browser, s, '[data-filter=all]');
    await fill('[data-q]', 'github');
    const searched = await evalIn(browser, s, "[...document.querySelectorAll('[data-rows] li')].length");
    result('appcore: History\'s Flagged filter shows only the scam, and search finds github', flagged.length >= 1 && flagged.every((r) => /paypa1/.test(r)) && searched >= 1, { flagged, searched });
    await fill('[data-q]', '');
    await shot(browser, s, 'appcore-history');
    // Deleting: one entry, then everything, each asked first.
    const del = await evalIn(browser, s, "({ one: Boolean(document.querySelector('[data-rows] li [data-forget]')), all: Boolean(document.querySelector('[data-history-clear]')) })");
    if (del.one) {
      const before = await evalIn(browser, s, "document.querySelectorAll('[data-rows] li').length");
      await clickSel(browser, s, '[data-rows] li [data-forget]');
      await until(browser, s, `document.querySelectorAll('[data-rows] li').length === ${before - 1}`, 8000);
      const fromServer = (await api('/account/history')).body.items.length;
      const focusAfter = await evalIn(browser, s, "(document.activeElement.getAttribute('aria-label') || document.activeElement.tagName)");
      result('appcore: one History entry can be deleted with its own button, is gone from the server too, and the focus stays in the list',
        fromServer === before - 1 && /Delete .* from history|Search/i.test(focusAfter), { before, fromServer, focusAfter, toast: await toasts() });
    } else result('appcore: one History entry can be deleted', false, 'History has no way to delete an entry');
    if (del.all) {
      await clickSel(browser, s, '[data-history-clear]');
      await sleep(300);
      await clickSel(browser, s, '[data-history-clear]');
      await until(browser, s, "document.querySelector('[data-rows] .empty')", 8000);
      const left = (await api('/account/history')).body.items.length;
      await shot(browser, s, 'appcore-history-cleared');
      result('appcore: Clear history (asked first) empties History, on the server too', left === 0, { left, toast: await toasts() });
    } else result('appcore: History can be cleared', false, 'History has no way to clear it');

    /* ------------------------------------------------------- site rules */

    await open('/app/sites', "document.querySelector('[data-allow] .panel__head')");
    await fill('#site-host', 'https://www.example.org/some/page');
    await pressEnter(browser, s);
    const trusted = await until(browser, s, "[...document.querySelectorAll('[data-allow] li b')].map((b) => b.textContent).join(',')", 8000);
    await fill('#site-host', 'not a site!!');
    await pressEnter(browser, s);
    await sleep(800);
    const badHost = await toasts();
    await fill('#site-host', 'bad-example.test');
    await clickSel(browser, s, '[data-rule=block]');
    await pressEnter(browser, s);
    const blocked = await until(browser, s, "[...document.querySelectorAll('[data-block] li b')].map((b) => b.textContent).join(',')", 8000);
    await shot(browser, s, 'appcore-sites');
    result('appcore: Site rules trusts a pasted address by its site name and blocks another', /example\.org/.test(trusted || '') && /bad-example\.test/.test(blocked || ''), { trusted, blocked });
    result('appcore: Site rules refuses something that is not a site, in words', /valid|not a|site|address/i.test(badHost) && !/HTTP|Error:/.test(badHost), badHost);
    await clickSel(browser, s, '[data-allow] [data-remove]');
    const removed = await until(browser, s, "document.querySelector('[data-allow] .empty') && 'gone'", 8000);
    result('appcore: Remove takes a site rule away', removed === 'gone', await toasts());

    /* -------------------------------------------- the Free plan's limits */

    const usage = async () => (await api('/account/usage')).body;
    let u = await usage();
    for (let i = u.usage.linkScans.used; i < u.usage.linkScans.limit; i++) await api('/scan/link', { url: `https://example.com/page-${i}`, mode: 'fast' });
    await open('/app/scan', "document.querySelector('.scanbox input')");
    const leftText = await evalIn(browser, s, "({ meta: document.querySelector('[data-left]').textContent, side: document.querySelector('[data-usage-mini]').innerText.replace(/\\s+/g, ' ') })");
    await fill('.scanbox input', 'https://wikipedia.org');
    await pressEnter(browser, s);
    const limit = await until(browser, s, "(() => { const b = document.querySelector('[data-out] .banner'); return b && { text: b.innerText.trim(), link: (b.querySelector('a') || {}).getAttribute && b.querySelector('a').getAttribute('href') }; })()", 10000);
    await shot(browser, s, 'appcore-limit');
    result('appcore: with the week\'s 10 fast scans used, the scan page and the sidebar say 0 left', /^0 of 10/.test(leftText.meta) && /Fast scans 0 left/.test(leftText.side), leftText);
    result('appcore: an 11th scan says the week\'s scans are used, when they come back, and links to plans', Boolean(limit) && /used this week.s scans/.test(limit.text) && /resets/.test(limit.text) && limit.link === '/app/plan', limit);
    u = await usage();
    const hdr = { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'note.txt' };
    for (let i = u.usage.fileScans.used; i < u.usage.fileScans.limit; i++) {
      await evalIn(browser, s, `fetch('/api/v1/scan/file', { method: 'POST', credentials: 'same-origin', headers: ${JSON.stringify(hdr)}, body: 'hello ${i}' }).then((r) => r.status)`);
    }
    await open('/app/threats', "document.querySelector('[data-file]')");
    await setFile('[data-file]', harmless);
    const fileLimit = await until(browser, s, "(() => { const b = document.querySelector('[data-out] .banner'); return b && b.innerText.trim(); })()", 10000);
    result('appcore: a 6th file scan on Free says the week\'s scans are used, in words', /used this week.s scans/.test(fileLimit || ''), fileLimit);
    const planMs = await open('/app/plan', "document.querySelector('.plans')");
    const planInfo = await evalIn(browser, s, "({ cards: [...document.querySelectorAll('.usage-list .usage-row, .usage-list > *')].map((c) => c.innerText.replace(/\\s+/g, ' ').trim().slice(0, 80)), current: document.querySelector('.plan.is-current .plan__name').textContent })");
    result('appcore: Plan & usage shows what is left of each allowance, here none', planInfo.current === 'Free' && planInfo.cards.some((c) => /\b0\b/.test(c)), { ms: planMs, ...planInfo });
    await clickSel(browser, s, '[data-plan=pro]');
    const upgraded = await until(browser, s, "(document.querySelector('.plan.is-current .plan__name') || {}).textContent === 'Pro' && document.querySelector('.side [data-plan]').textContent", 10000);
    await open('/app/scan', "document.querySelector('.scanbox input')");
    await clickSel(browser, s, '[data-scan-mode=delicate]');
    await fill('.scanbox input', 'https://github.com');
    t = Date.now();
    await pressEnter(browser, s);
    const deep = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); const b = document.querySelector('[data-out] .banner'); return (r && { title: r.querySelector('h2').textContent.trim(), tone: r.className, facts: r.innerText.includes('Domain age') || r.innerText.includes('Redirects') }) || (b && { banner: b.innerText }); })()", 60000);
    await shot(browser, s, 'appcore-delicate');
    result('appcore: after upgrading to Pro the limit lifts and a delicate scan researches github.com, in under 30 s', /Pro/.test(upgraded || '') && Boolean(deep) && deep.facts === true && Date.now() - t < 30000, { upgraded, ...deep, ms: Date.now() - t });

    /* ---------------------------------------------------------- security */

    await open('/app/security', "document.querySelector('[data-sessions] .list')");
    const sessions = await evalIn(browser, s, "document.querySelector('[data-sessions]').innerText.replace(/\\s+/g, ' ')");
    await fill('#p-first', 'Samira');
    await clickSel(browser, s, '[data-name-form] button[type=submit]');
    await sleep(1000);
    const named = await evalIn(browser, s, "document.querySelector('[data-name]').textContent");
    await fill('#pw-cur', 'Not-My-Password-1');
    await fill('#pw-new', 'Fresh-Garden-5512');
    await clickSel(browser, s, '[data-pw-form] button[type=submit]');
    await sleep(1500);
    const wrongCur = await toasts();
    result('appcore: Security lists this device, saves a new first name to the sidebar, and refuses a wrong current password in words',
      /This device/.test(sessions) && /Samira/.test(named) && /incorrect|wrong/i.test(wrongCur), { sessions: sessions.slice(0, 160), named, wrongCur });
    await shot(browser, s, 'appcore-security');

    /* -------------------------------------------------------- assistants */

    await open('/app/assistants', "document.querySelector('[data-connect]')");
    const tabs = await evalIn(browser, s, `(() => { const t = [...document.querySelectorAll('[role=tab]')];
      return { names: t.map((x) => x.textContent.trim()), controls: t.every((x) => x.getAttribute('aria-controls') && document.getElementById(x.getAttribute('aria-controls'))), panel: Boolean(document.querySelector('[role=tabpanel]')) }; })()`);
    await fill('[data-connect] input', 'sk-this-is-not-a-real-key-000000000000');
    t = Date.now();
    await pressEnter(browser, s);
    const aiErr = await until(browser, s, "(() => { const t = document.querySelector('.toast'); return t && t.textContent.trim(); })()", 30000);
    await shot(browser, s, 'appcore-assistants');
    result('appcore: AI assistants shows the four assistants and refuses a made-up key in plain words', tabs.names.length === 4 && Boolean(aiErr) && !/HTTP \d|Error:|undefined|\{/.test(aiErr), { tabs: tabs.names, aiErr, ms: Date.now() - t });
    result('appcore: the assistants\' tabs are tied to their panel for a screen reader (aria-controls, tabpanel)', tabs.controls && tabs.panel, tabs);

    /* --------------------------------------------- checkup and recovery */

    await open('/app/checkup');
    const checkup = await evalIn(browser, s, "({ text: document.querySelector('#view').innerText.replace(/\\s+/g, ' ').slice(0, 200), download: Boolean(document.querySelector('#view a[href=\"/download\"]')) })");
    result('appcore: Browser checkup in a browser says it runs in the Windows app, with a Download link', checkup.download && /Sentinel app/.test(checkup.text), checkup);
    await open('/app/recover', "document.querySelector('[data-recover-picks] input')");
    await clickSel(browser, s, '[data-recover-picks] input');
    const plan = await until(browser, s, "document.querySelectorAll('[data-recover-plan] li').length", 5000);
    result('appcore: the recovery guide puts steps in order as soon as something is ticked', plan > 0, `${plan} steps`);

    /* ------------------------------------------------------ Ctrl K palette */

    await open('/app');
    await pressKey(browser, s, 'k', { ctrl: true });
    const pal = await until(browser, s, `(() => { const p = document.querySelector('.palette'); if (!p) return null; const i = p.querySelector('input');
      return { focused: document.activeElement === i, role: i.getAttribute('role'), active: i.getAttribute('aria-activedescendant'), controls: i.getAttribute('aria-controls') }; })()`, 3000);
    await typeText(browser, s, 'hist');
    await sleep(200);
    const first = await evalIn(browser, s, "(document.querySelector('.palette li[aria-selected=true] .palette__label') || {}).textContent");
    const activeOk = await evalIn(browser, s, "(() => { const i = document.querySelector('.palette input'); const id = i.getAttribute('aria-activedescendant'); return Boolean(id && document.getElementById(id) && document.getElementById(id).getAttribute('aria-selected') === 'true'); })()");
    await pressKey(browser, s, 'Enter');
    const went = await until(browser, s, "location.pathname === '/app/history' && !document.querySelector('.palette') && 'history'", 5000);
    await pressKey(browser, s, 'k', { ctrl: true });
    await until(browser, s, "document.querySelector('.palette')", 3000);
    for (let i = 0; i < 4; i++) await pressKey(browser, s, 'Tab');
    const trapped = await evalIn(browser, s, "Boolean(document.querySelector('.palette') && document.querySelector('.palette').contains(document.activeElement))");
    await pressKey(browser, s, 'Escape');
    const closed = await evalIn(browser, s, "!document.querySelector('.palette')");
    result('appcore: Ctrl K opens search with the cursor in it, "hist" picks History and Enter goes there, Escape closes it', Boolean(pal && pal.focused) && first === 'History' && went === 'history' && closed, { pal, first, went, closed });
    result('appcore: a screen reader can follow the palette\'s choice (a combobox with aria-activedescendant) and Tab stays inside it', Boolean(pal && pal.role === 'combobox') && activeOk && trapped, { pal, activeOk, trapped });

    /* ------------------------------------------------------- phone width */

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await open('/app');
    await sleep(800);
    await shot(browser, s, 'appcore-phone-nav');
    const phone = await evalIn(browser, s, `(() => {
      const W = innerWidth, H = innerHeight;
      const on = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 4 && r.height > 4 && r.left >= -1 && r.right <= W + 1 && r.top >= 0 && r.bottom <= H + 1 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      const reach = [...document.querySelectorAll('a[href^="/app"], button')].filter(on);
      return { links: [...new Set(reach.filter((e) => e.tagName === 'A').map((e) => e.getAttribute('href')))], more: reach.filter((e) => e.matches('[data-palette]')).map((e) => (e.getAttribute('aria-label') || e.textContent).trim()),
        signout: reach.some((e) => /sign out/i.test(e.getAttribute('aria-label') || e.textContent)),
        cut: [...document.querySelectorAll('.side__nav a, .side__nav button')].filter((e) => getComputedStyle(e).display !== 'none' && !on(e)).map((e) => e.textContent.trim()),
        tiny: [...document.querySelectorAll('.side__nav a, .side__nav button')].filter(on).filter((e) => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map((e) => e.textContent.trim()) };
    })()`);
    result('appcore: at phone width nothing in the bottom bar is cut off the screen, and each of its buttons is at least 44 px', !phone.cut.length && !phone.tiny.length, phone);
    // Every page must be one tap away (in the bar), or two (through the search button, which lists every page).
    result('appcore: at phone width every app page can still be reached', phone.more.length > 0 || PAGES.every((p) => phone.links.includes(p)), phone);
    await open('/app/security');
    await sleep(500);
    const phoneOut = await evalIn(browser, s, `(() => { const W = innerWidth; return [...document.querySelectorAll('button, a')].some((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
      return /sign out/i.test((e.getAttribute('aria-label') || '') + ' ' + e.textContent) && !/devices|other/i.test(e.textContent) && r.width > 0 && r.height > 0 && r.right <= W + 1 && cs.display !== 'none' && cs.visibility !== 'hidden'; }); })()`);
    await shot(browser, s, 'appcore-phone-security');
    result('appcore: at phone width you can sign out (from the account page the avatar opens)', phoneOut);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);

    const real = errors.filter((e) => !/status of 401/.test(e));
    result('appcore: no console errors through it all', !real.length, real);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkAppCore;
