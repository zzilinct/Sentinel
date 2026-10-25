'use strict';
/**
 * share     Sharing to Sentinel from a phone's Share menu (manifest.webmanifest share_target, sw.js, share.js), at phone
 *           width as an Android phone: the manifest is read by Chrome without errors and offers the share target; the
 *           service worker takes the share. Driven exactly as Android sends a share, without installing anything: a
 *           GET of /app/share with title, text and url, and a multipart form POST to it (words, and a picture).
 *           Signed out, the share waits on the device, off the address bar, through sign-in, then opens the check.
 *           A link opens the link scan, words the text scan with their links checked, a picture the screenshot reader.
 *           The share box is empty afterwards, nothing shared reaches the server as a POST, a share that missed the
 *           service worker is asked for again, and on an iPhone the page says plainly what to do instead.
 */
const path = require('path');
const { ROOT, sleep, result, launch, evalIn, openPage, goto, shot, startServer, watchErrors, until } = require('./_shared');

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SMS = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay now at https://usps-redeliver.top/pay';
const SCAM = 'https://paypa1-secure-login.com/account';
const PICTURE = path.join(ROOT, 'web', 'assets', 'img', 'icon-192.png');

async function checkShare() {
  // SENTINEL_LOG: every request the server answers is in share-server.log, so a share reaching it is seen.
  const server = await startServer('share', { SENTINEL_LOG: '1' });
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
    await browser.send('Emulation.setUserAgentOverride', { userAgent: ANDROID, platform: 'Linux armv81' }, s);
    const here = () => evalIn(browser, s, 'location.pathname + location.search');
    const box = () => evalIn(browser, s, "caches.open('sentinel-share').then(async (c) => { const d = await c.match('/share/data'); return { data: d ? await d.json() : null, image: Boolean(await c.match('/share/image')) }; })");
    const fits = () => evalIn(browser, s, 'document.documentElement.scrollWidth <= innerWidth + 1');
    const api = (p, body) => evalIn(browser, s, `fetch('/api/v1${p}', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: ${JSON.stringify(JSON.stringify(body))} }).then((r) => r.status)`);
    /** A multipart form POST to /app/share, sent by the page as a navigation, as Android's share sheet sends one. */
    const post = async (fields, file) => {
      await evalIn(browser, s, `(() => { const f = document.createElement('form'); f.method = 'post'; f.enctype = 'multipart/form-data'; f.action = '/app/share'; f.id = 'android-share';
        for (const [k, v] of Object.entries(${JSON.stringify(fields)})) { const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
        const pic = document.createElement('input'); pic.type = 'file'; pic.name = 'image'; f.appendChild(pic); document.body.appendChild(f); return true; })()`);
      if (file) {
        const { root } = await browser.send('DOM.getDocument', { depth: 0 }, s);
        const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#android-share input[type=file]' }, s);
        await browser.send('DOM.setFileInputFiles', { nodeId, files: [file] }, s);
      }
      await evalIn(browser, s, "document.getElementById('android-share').submit(); true");
      await sleep(400);
    };

    /* ------------------------------------------------ installable, with a share target */

    await goto(browser, s, `${base}/login`);
    const controlled = await until(browser, s, 'navigator.serviceWorker.ready.then(() => Boolean(navigator.serviceWorker.controller))', 20000);
    const manifest = await browser.send('Page.getAppManifest', {}, s).catch((err) => ({ errors: [{ message: err.message }] }));
    const parsed = JSON.parse(manifest.data || '{}');
    const st = parsed.share_target || {};
    let installable = null;
    try { installable = (await browser.send('Page.getInstallabilityErrors', {}, s)).installabilityErrors.map((e) => e.errorId); } catch { /* older Chrome */ }
    result('share: Chrome reads the manifest without errors, and it offers a share target for links, words and PNG or JPEG pictures',
      !(manifest.errors || []).length && st.action === '/app/share' && st.method === 'POST' && st.enctype === 'multipart/form-data' && st.params.files[0].name === 'image',
      { errors: manifest.errors, share_target: st });
    result('share: the web app is installable (Chrome lists no installability error) and its service worker controls the page', Boolean(controlled) && (!installable || !installable.length), { controlled, installable });

    /* ------------------------------------------------ signed out: a GET share waits through sign-in */

    await browser.send('Page.navigate', { url: `${base}/app/share?title=&text=${encodeURIComponent(SMS)}&url=` }, s);
    const atLogin = await until(browser, s, "location.pathname === '/login' && document.querySelector('[data-note]').textContent.trim()", 15000);
    const loginUrl = await evalIn(browser, s, 'location.href');
    const waiting = await box();
    await shot(browser, s, 'share-signed-out');
    result('share: signed out, a shared message asks to sign in, says it waits, and keeps it on the device, not in the address',
      /checks what you shared/.test(atLogin || '') && /next=%2Fapp%2Fshare$/.test(loginUrl) && !/USPS|usps/.test(loginUrl) && waiting.data && waiting.data.text === SMS,
      { note: atLogin, url: loginUrl.replace(base, ''), waiting: waiting.data && waiting.data.text.slice(0, 40) });

    const email = `share-${Date.now()}@example.com`;
    const password = 'Share-Check-Lamp-2026';
    const a = await api('/auth/signup', { email, password, firstName: 'Ana', ageConfirmed: true, termsAccepted: true });
    const b = await api('/auth/login', { email, password });
    if (a !== 201 || b !== 200) throw new Error(`the test account could not sign in: ${a} ${b}`);
    // The sign-in page, signed in, carries on to where it was going.
    await browser.send('Page.navigate', { url: loginUrl }, s);
    const textOut = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-text-result]'); return location.pathname === '/app/text' && r && { tone: r.dataset.textResult, title: r.querySelector('h2').textContent.trim(), why: r.innerText.includes('usps-redeliver.top'), box: document.querySelector('#t-text').value }; })()", 30000);
    await shot(browser, s, 'share-text');
    result('share: after signing in, the shared message opens in Text scan, filled in, checked with its link, without a press', Boolean(textOut) && textOut.box === SMS && textOut.why, textOut);
    const after = await box();
    result('share: once the check opens, nothing shared is left on the device', !after.data && !after.image, after);

    /* ------------------------------------------------ signed in: a link, a POST of words, a picture */

    await goto(browser, s, `${base}/app/share?title=${encodeURIComponent('PayPal: Log in')}&text=&url=${encodeURIComponent(SCAM)}`);
    const linkOut = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-result]'); return location.pathname === '/app/scan' && r && { tone: r.className, title: r.querySelector('h2').textContent.trim(), box: document.querySelector('.scanbox input').value }; })()", 30000);
    await shot(browser, s, 'share-link');
    result('share: a shared link (a GET with title and url, as Chrome on Android sends a page) opens Link scan and is scanned: the listed scam is red',
      Boolean(linkOut) && linkOut.box === SCAM && /red/.test(linkOut.tone), { ...linkOut, at: await here() });

    await goto(browser, s, `${base}/app`);
    await post({ title: '', text: SMS.replace('USPS', 'Royal Mail'), url: '' });
    const postOut = await until(browser, s, "(() => { const r = document.querySelector('[data-out] [data-text-result]'); return location.pathname === '/app/text' && r && { box: document.querySelector('#t-text').value, why: r.innerText.includes('usps-redeliver.top') }; })()", 30000);
    result('share: a message shared as a multipart form POST (as Android sends every share) opens Text scan and is checked', Boolean(postOut) && /^Royal Mail/.test(postOut.box) && postOut.why, postOut);

    await goto(browser, s, `${base}/app`);
    await post({ title: '', text: '', url: '' }, PICTURE);
    const picOut = await until(browser, s, "(() => { const p = document.querySelector('[data-shot-preview]'); const img = p && p.querySelector('img'); return location.pathname === '/app/text' && p && !p.hidden && img.complete && img.naturalWidth > 0 && (() => { const r = p.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight - 40; })() && { tab: document.querySelector('[data-tmode=shot]').getAttribute('aria-selected'), status: document.querySelector('[data-shot-status]').textContent.trim(), width: img.naturalWidth }; })()", 20000);
    // The status settles once the picture has been looked at for a QR code (it says "Looking for a QR code" meanwhile).
    if (picOut) picOut.status = (await until(browser, s, "(() => { const t = (document.querySelector('[data-shot-status]') || {}).textContent || ''; return /Windows/.test(t) && t; })()")) || picOut.status;
    const picFits = await fits();
    await shot(browser, s, 'share-picture');
    result('share: a shared picture (a multipart POST with a PNG) opens the text scan\'s screenshot reader with the picture in it, on screen, and says plainly a phone cannot read its words here',
      Boolean(picOut) && picOut.tab === 'true' && picOut.width === 192 && /Windows/.test(picOut.status) && picFits, { ...picOut, fits: picFits });
    const afterPic = await box();
    result('share: the shared picture is not left on the device', !afterPic.data && !afterPic.image, afterPic);

    const posted = server.log().split('\n').filter((l) => /^POST \/app\/share/.test(l));
    result('share: no share reached the server as a POST: the phone\'s service worker took each one', !posted.length, posted.length ? posted : 'none');

    /* ------------------------------------------------ a share that missed the service worker */

    const form = new FormData();
    form.set('title', '');
    form.set('text', SMS);
    form.set('url', '');
    const missed = await fetch(`${base}/app/share`, { method: 'POST', body: form, redirect: 'manual' });
    await goto(browser, s, base + missed.headers.get('location'));
    const missedText = await until(browser, s, "(() => { const e = document.querySelector('[data-share-empty]'); return e && e.innerText; })()", 10000);
    const label = await evalIn(browser, s, "(() => { const l = document.querySelector('#view .lux-label'); return l ? l.textContent : ''; })()");
    await shot(browser, s, 'share-missed');
    result('share: a share the server receives (no service worker yet) is not read, and the page asks for it once more',
      missed.status === 303 && /did not reach Sentinel/.test(missedText || '') && label !== 'Overview' && await fits(), { label, status: missed.status, location: missed.headers.get('location'), text: missedText });

    /* ------------------------------------------------ iPhone */

    await browser.send('Emulation.setUserAgentOverride', { userAgent: IPHONE, platform: 'iPhone' }, s);
    await goto(browser, s, `${base}/app/text`, "document.querySelector('#view h1')");
    await sleep(400);
    const ios = await evalIn(browser, s, "(() => { const n = document.querySelector('[data-iphone-note]'); return n && n.getClientRects().length ? n.textContent.trim() : null; })()");
    const iosFits = await fits();
    await shot(browser, s, 'share-iphone');
    result('share: on an iPhone, Text scan says honestly that web apps cannot be in the Share menu, and what to do instead', /cannot be in the Share menu/.test(ios || '') && /Copy/.test(ios || '') && iosFits, { note: ios, fits: iosFits });

    const noisy = errors.filter((e) => !/status of 401/.test(e));
    result('share: no page logs a console error along the way', !noisy.length, noisy);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkShare;
