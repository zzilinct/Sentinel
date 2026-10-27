'use strict';
/**
 * share-odd  The odd shares Android really sends to /app/share (40-share.js proves the plain ones), at phone width as
 *            an Android phone, through the web app's own service worker: a link inside words, only an emoji, two
 *            links, a huge conversation whose scam link is at its very end, a PNG with a QR code in a chat screenshot
 *            (scripts/verify-web-qr.py), a JPEG, a HEIC photo (said plainly, and kept on screen), two shares a moment
 *            apart (the second one wins, nothing mixed), and a share made while signed out that waits through another
 *            tab of the web app opening, then through signing in, in either tab.
 */
const fs = require('fs');
const path = require('path');
const { QR, OUT, sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors, until } = require('./_shared');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const SCAM = 'https://paypa1-secure-login.com/account';   // a listed scam (server/lib/scan/lists.js)
const SMS = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay now at https://usps-redeliver.top/pay';

async function checkShareOdd() {
  const server = await startServer('share-odd');
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const tab = await openPage(browser);
    const s = tab.sessionId;
    const errors = await watchErrors(browser, s);
    const phone = async (sid) => {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
      await browser.send('Emulation.setUserAgentOverride', { userAgent: ANDROID, platform: 'Linux armv81' }, sid);
    };
    await phone(s);
    const api = (sid, p, body) => evalIn(browser, sid, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body || {}))} }).then((r) => r.status)`);
    const box = () => evalIn(browser, s, "caches.open('sentinel-share').then(async (c) => ({ data: Boolean(await c.match('/share/data')), image: Boolean(await c.match('/share/image')) }))");
    /** Multipart form POSTs to /app/share, sent as navigations, as Android's share sheet sends them (one or several at once). */
    const post = async (shares, sid = s) => {
      await evalIn(browser, sid, `(() => { ${JSON.stringify(shares)}.forEach((fields, n) => { const f = document.createElement('form'); f.method = 'post'; f.enctype = 'multipart/form-data'; f.action = '/app/share'; f.id = 'android-share-' + n;
        for (const [k, v] of Object.entries(fields)) { if (k === 'file') continue; const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
        const pic = document.createElement('input'); pic.type = 'file'; pic.name = 'image'; f.appendChild(pic); document.body.appendChild(f); }); return true; })()`);
      for (const [n, fields] of shares.entries()) {
        if (!fields.file) continue;
        const { root } = await browser.send('DOM.getDocument', { depth: 0 }, sid);
        const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#android-share-${n} input[type=file]` }, sid);
        await browser.send('DOM.setFileInputFiles', { nodeId, files: [fields.file] }, sid);
      }
      // Each form is sent straight after the one before, as a second share from the phone arrives while the first loads.
      await evalIn(browser, sid, `(() => { ${JSON.stringify(shares.map((_, n) => n))}.forEach((n) => document.getElementById('android-share-' + n).submit()); return true; })()`);
      await sleep(400);
    };
    const text = (sid = s) => until(browser, sid, "(() => { const r = document.querySelector('[data-out] [data-text-result]'); return location.pathname === '/app/text' && r && { tone: r.dataset.textResult, title: r.querySelector('h2').textContent.trim(), why: r.innerText, box: document.querySelector('#t-text').value, out: document.querySelector('[data-out]').innerText }; })()", 30000);
    const freshApp = () => goto(browser, s, `${base}/app`, "document.querySelector('#view h1')");

    const email = `share-odd-${Date.now()}@example.com`;
    const password = 'Share-Odd-Lamp-2026';
    await goto(browser, s, `${base}/login`);
    await until(browser, s, 'navigator.serviceWorker.ready.then(() => Boolean(navigator.serviceWorker.controller))', 20000);
    const a = await api(s, '/auth/signup', { email, password, firstName: 'Ana', ageConfirmed: true, termsAccepted: true });
    const b = await api(s, '/auth/login', { email, password });
    if (a !== 201 || b !== 200) throw new Error(`the test account could not sign in: ${a} ${b}`);

    /* ------------------------------------------------ words of every odd kind */

    await freshApp();
    await post([{ title: '', text: `lol is this real?? ${SCAM} my bank never texts me`, url: '' }]);
    const inText = await text();
    await shot(browser, s, 'share-odd-link-in-text');
    result('share-odd: a link inside a message opens Text scan with the whole message, and the listed scam link makes it red',
      Boolean(inText) && /^lol is this real/.test(inText.box) && inText.tone === 'red' && /paypa1-secure-login\.com/.test(inText.why), inText && { tone: inText.tone, title: inText.title });

    await freshApp();
    await post([{ title: '', text: '\u{1F602}\u{1F64F}', url: '' }]);
    const emoji = await text();
    result('share-odd: a share of only an emoji opens Text scan, is checked, and is calmly found to be nothing',
      Boolean(emoji) && emoji.box === '\u{1F602}\u{1F64F}' && emoji.tone === 'clear', emoji && { tone: emoji.tone, title: emoji.title });

    await freshApp();
    await post([{ title: '', text: `Two links: https://www.wikipedia.org/ and ${SCAM}`, url: '' }]);
    const two = await text();
    result('share-odd: two links in one share: both are checked and named, the scam one makes it red',
      Boolean(two) && two.tone === 'red' && /wikipedia\.org/.test(two.why) && /paypa1-secure-login\.com/.test(two.why), two && { tone: two.tone, why: two.why.slice(-400) });

    // A whole conversation, far longer than the text scan reads, with the scam at its newest end, where it usually is.
    const huge = `${'Hi, how was your day? Mine was fine, the weather is lovely here. '.repeat(1800)}\n${SMS}`;
    await freshApp();
    await post([{ title: '', text: huge, url: '' }]);
    const big = await text();
    await shot(browser, s, 'share-odd-huge');
    result(`share-odd: a huge share (${huge.length.toLocaleString('en')} letters) arrives whole, and its newest part is read: the scam link at its end is found and the page says it was long`,
      Boolean(big) && big.box.length >= huge.length - 2 && /usps-redeliver\.top/.test(big.why) && /very long/.test(big.out), big && { box: big.box.length, tone: big.tone, found: /usps-redeliver\.top/.test(big.why), note: /very long/.test(big.out) });

    /* ------------------------------------------------ pictures */

    const shotState = () => evalIn(browser, s, "(() => { const p = document.querySelector('[data-shot-preview]'); const img = p && p.querySelector('img'); const q = document.querySelector('[data-text-qr]'); const card = q && q.querySelector('.qr-card');"
      + " return { at: location.pathname, tab: (document.querySelector('[data-tmode=shot]') || {}).ariaSelected, shown: Boolean(p && !p.hidden && img && img.complete && img.naturalWidth), status: (document.querySelector('[data-shot-status]') || {}).textContent || '',"
      + " card: card ? { tone: [...card.classList].find((c) => /^result--/.test(c)), title: card.querySelector('h2').textContent.trim() } : null, panel: (document.querySelector('[data-shot]') || {}).innerText || '' }; })()");
    const manifest = JSON.parse(fs.readFileSync(path.join(QR, 'manifest.json'), 'utf8'));
    const inChat = manifest.find((m) => m.file === 'discord-in-chat.png');
    await freshApp();
    await post([{ title: '', text: '', url: '', file: path.join(QR, inChat.file) }]);
    const qrCard = async () => { for (let i = 0; i < 80; i++) { const st = await shotState(); if (st.card) return st; await sleep(250); } return shotState(); };
    const qrPng = await qrCard();
    await shot(browser, s, 'share-odd-qr-png');
    result('share-odd: a shared PNG of a chat with a QR code in it shows the picture, reads the code on the phone, and checks where it leads (a Discord sign-in code, not clear)',
      qrPng.at === '/app/text' && qrPng.shown && Boolean(qrPng.card) && qrPng.card.tone !== 'result--clear' && /QR code in this picture was read/.test(qrPng.status), qrPng && { ...qrPng, panel: undefined });

    // A JPEG, as a phone's camera or gallery shares one: made here from the plain QR picture by the browser itself.
    const plain = fs.readFileSync(path.join(QR, 'plain.png')).toString('base64');
    const jpegB64 = await evalIn(browser, s, `new Promise((resolve) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(i, 0, 0); resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]); }; i.src = 'data:image/png;base64,${plain}'; })`);
    const jpeg = path.join(OUT, 'share-odd-photo.jpg');
    fs.writeFileSync(jpeg, Buffer.from(jpegB64, 'base64'));
    await freshApp();
    await post([{ title: '', text: '', url: '', file: jpeg }]);
    const qrJpeg = await qrCard();
    await shot(browser, s, 'share-odd-jpeg');
    result('share-odd: a shared JPEG is shown and its QR code read and checked, as a PNG is', qrJpeg.at === '/app/text' && qrJpeg.shown && Boolean(qrJpeg.card), { ...qrJpeg, panel: undefined });

    // A HEIC photo (an iPhone's, or a Samsung's with high-efficiency photos on): the start of a real HEIC file's header.
    const heic = path.join(OUT, 'share-odd-photo.heic');
    fs.writeFileSync(heic, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic'), Buffer.alloc(2048, 7)]));
    await freshApp();
    await post([{ title: '', text: '', url: '', file: heic }]);
    await until(browser, s, "location.pathname === '/app/text' && document.querySelector('[data-shot]')", 15000);
    await sleep(7000);   // longer than a toast stays: what is said must still be there to read
    const heicState = await shotState();
    await shot(browser, s, 'share-odd-heic');
    result('share-odd: a shared HEIC photo opens the screenshot reader and says plainly, and keeps saying, that it is not a PNG or JPEG and what to do',
      heicState.at === '/app/text' && heicState.tab === 'true' && /not a PNG or JPEG/.test(heicState.panel), { at: heicState.at, tab: heicState.tab, panel: heicState.panel.slice(0, 400) });
    const heicBox = await box();
    result('share-odd: the HEIC photo is not left on the device', !heicBox.data && !heicBox.image, heicBox);

    /* ------------------------------------------------ twice, quickly */

    await freshApp();
    // The second share arrives while the first one's check is still opening.
    await post([{ title: '', text: 'First share: see you at 5', url: '' }]);
    await post([{ title: '', text: `Second share: ${SMS}`, url: '' }]);
    const twice = await text();
    await sleep(1500);
    const twiceAfter = await evalIn(browser, s, "({ at: location.pathname, box: (document.querySelector('#t-text') || {}).value || '', results: document.querySelectorAll('[data-out] [data-text-result]').length })");
    const twiceBox = await box();
    result('share-odd: two shares a moment apart: the second one is checked, alone and whole, and nothing is left waiting',
      Boolean(twice) && /^Second share: USPS/.test(twiceAfter.box) && !/First share/.test(twiceAfter.box) && twiceAfter.results === 1 && !twiceBox.data, { ...twiceAfter, box: twiceAfter.box.slice(0, 60), left: twiceBox });

    /* ------------------------------------------------ signed out, with another tab of the web app */

    await freshApp();
    if (await api(s, '/auth/logout') !== 200) throw new Error('the test account could not sign out');
    await post([{ title: '', text: `Signed out share: ${SMS}`, url: '' }]);
    const atLogin = await until(browser, s, "location.pathname === '/login' && location.href", 15000);
    // Another tab of the web app opens meanwhile (an old tab reloaded, or the app from the home screen): signed out too.
    const other = await openPage(browser);
    await phone(other.sessionId);
    await goto(browser, other.sessionId, `${base}/app`);
    await until(browser, other.sessionId, "location.pathname === '/login'", 15000);
    await sleep(800);
    const kept = await box();
    result('share-odd: signed out, a share waits on the device even when another tab of the web app opens meanwhile', kept.data, kept);
    // Signing in on the first tab: the share is checked there.
    if (await api(s, '/auth/login', { email, password }) !== 200) throw new Error('the test account could not sign in again');
    await browser.send('Page.navigate', { url: atLogin }, s);
    const back = await text();
    await shot(browser, s, 'share-odd-signed-out');
    result('share-odd: then, signed in, the share opens in Text scan, checked', Boolean(back) && /^Signed out share: USPS/.test(back.box) && /usps-redeliver\.top/.test(back.why), back && { box: back.box.slice(0, 50), tone: back.tone });

    // The other way round: shared signed out, then signed in from the other tab, which opens the web app there.
    if (await api(s, '/auth/logout') !== 200) throw new Error('the test account could not sign out');
    await goto(browser, s, `${base}/login`);   // signed out, the web app is the sign-in page
    await post([{ title: '', text: `Second tab share: ${SMS}`, url: '' }]);
    await until(browser, s, "location.pathname === '/login'", 15000);
    if (await api(other.sessionId, '/auth/login', { email, password }) !== 200) throw new Error('the test account could not sign in in the other tab');
    await goto(browser, other.sessionId, `${base}/app`);
    const there = await text(other.sessionId);
    await shot(browser, other.sessionId, 'share-odd-other-tab');
    result('share-odd: shared signed out, then signed in from another tab of the web app: that tab opens the check, not the overview',
      Boolean(there) && /^Second tab share: USPS/.test(there.box), there ? { box: there.box.slice(0, 50), tone: there.tone } : await evalIn(browser, other.sessionId, 'location.pathname'));
    const otherBox = await box();
    result('share-odd: once checked, nothing shared is left on the device', !otherBox.data && !otherBox.image, otherBox);

    const noisy = errors.filter((e) => !/status of 40[13]/.test(e));
    result('share-odd: no page logs a console error along the way', !noisy.length, noisy);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkShareOdd;
