'use strict';
/**
 * qa-web    The web app's newest tools used as a person would, with awkward input: Is this call a scam? at phone width
 *           and by keyboard, the email scan with what Gmail's Show original and Outlook's View message source really
 *           give (and an .eml dropped on the box), the text scan with WhatsApp and iMessage exports, a long and a
 *           5 MB paste, right-to-left words and emoji, back and forward, signed out, the free plan's limit, Warn a
 *           friend's Save picture (a real PNG download) for a text and a QR code, and what a screen reader is told.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, QR, sleep, result, launch, evalIn, openPage, goto, shot, pressEnter } = require('./_shared');

/* ---------------------------------------------------------------- inputs */

// Written by hand for this check, in the shapes the mail services write them. No real mail.
// Gmail's Show original page, selected whole and copied: the summary table first, then the message.
const GMAIL_PAGE = [
  'Original Message',
  'Message ID\t<CAF1x9@mailer-xyz.ru>',
  'Created at:\tFri, Oct 9, 2026 at 8:01 AM (Delivered after 2 seconds)',
  'From:\tPayPal <service@paypal.com>',
  'To:\talex@example.com',
  'Subject:\tYour account is limited',
  'SPF:\tPASS with IP 198.51.100.7 Learn more',
  'DKIM:\t\'FAIL\' Learn more',
  'DMARC:\t\'FAIL\' Learn more',
  '',
  'Download original\tCopy to clipboard',
  '',
  'Delivered-To: alex@example.com',
  'Received: by 2002:a05:6000:1a8b:b0:2d0:1234:5678 with SMTP id x11csp123; Fri, 9 Oct 2026 08:01:02 -0700 (PDT)',
  'X-Google-Smtp-Source: AGHT+IFq1+fake/abc',
  'ARC-Seal: i=1; a=rsa-sha256; t=1791000000; cv=none; d=google.com; s=arc-20240605;',
  '        b=AAAAfakeARCseal==',
  'ARC-Authentication-Results: i=1; mx.google.com;',
  '       spf=pass (google.com: domain of bounce@mailer-xyz.ru designates 198.51.100.7 as permitted sender) smtp.mailfrom=bounce@mailer-xyz.ru;',
  '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=paypal.com',
  'Return-Path: <bounce@mailer-xyz.ru>',
  'Received: from mail.mailer-xyz.ru (mail.mailer-xyz.ru. [198.51.100.7]) by mx.google.com with ESMTPS id a1si2; Fri, 09 Oct 2026 08:01:01 -0700 (PDT)',
  'Received-SPF: pass (google.com: domain of bounce@mailer-xyz.ru designates 198.51.100.7 as permitted sender) client-ip=198.51.100.7;',
  'Authentication-Results: mx.google.com;',
  '       spf=pass (google.com: domain of bounce@mailer-xyz.ru designates 198.51.100.7 as permitted sender) smtp.mailfrom=bounce@mailer-xyz.ru;',
  '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=paypal.com',
  'From: PayPal <service@paypal.com>',
  'To: alex@example.com',
  'Subject: Your account is limited',
  'Date: Fri, 9 Oct 2026 18:01:00 +0300',
  'Message-ID: <CAF1x9@mailer-xyz.ru>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset="UTF-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hello Alex,',
  'We could not confirm a recent payment. Please review your account within 24 h=',
  'ours to restore full access.'
].join('\n');

// Outlook on the web, View message source: CRLF, Microsoft's own Authentication-Results, a body in two parts.
const OUTLOOK_SOURCE = [
  'Received: from AM9PR01MB1234.eurprd01.prod.exchangelabs.com (2603:10a6:20b:1::1) by DB7PR01MB5678.eurprd01.prod.exchangelabs.com with HTTPS; Fri, 9 Oct 2026 15:01:03 +0000',
  'Received: from mx0.paypal.com (192.0.2.10) by AM4PEPF00025F95.mail.protection.outlook.com (10.167.16.4) with Microsoft SMTP Server; Fri, 9 Oct 2026 15:01:02 +0000',
  'Authentication-Results: spf=pass (sender IP is 192.0.2.10)',
  ' smtp.mailfrom=paypal.com; dkim=pass (signature was verified)',
  ' header.d=paypal.com;dmarc=pass action=none',
  ' header.from=paypal.com;compauth=pass reason=100',
  'Received-SPF: Pass (protection.outlook.com: domain of paypal.com designates 192.0.2.10 as permitted sender) receiver=protection.outlook.com; client-ip=192.0.2.10; helo=mx0.paypal.com; pr=C',
  'DKIM-Signature: v=1; a=rsa-sha256; c=relaxed/relaxed; d=paypal.com; s=pp-dkim1; h=from:subject:date; bh=abc=; b=AbCdEf12',
  'From: "PayPal" <service@paypal.com>',
  'To: <alex@example.com>',
  'Subject: =?utf-8?Q?Your_receipt_from_Caf=C3=A9_Lumi=C3=A8re?=',
  'Date: Fri, 9 Oct 2026 08:01:00 -0700',
  'Return-Path: service@paypal.com',
  'X-MS-Exchange-Organization-AuthAs: Anonymous',
  'X-MS-Has-Attach:',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="_000_ol_b1_"',
  '',
  '--_000_ol_b1_',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Hello Alex,',
  'You paid $4.50 to Caf=C3=A9 Lumi=C3=A8re. See it at https://www.paypal.com/myacc=',
  'ount/activity',
  '',
  '--_000_ol_b1_',
  'Content-Type: text/html; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  '<html><body><p>Hello Alex,</p><p>You paid $4.50.</p></body></html>',
  '--_000_ol_b1_--',
  ''
].join('\r\n');

// Outlook's message headers on their own (File, Properties, Internet headers): no blank line and no body, and a long
// route before the From line, the way every real one has.
const OUTLOOK_HEADERS = [
  ...Array.from({ length: 8 }, (_, i) => `Received: from SN${i}PR11MB4321.namprd11.prod.outlook.com (2603:10b6:806:${i}::1${i}) by SN${i + 1}PR11MB9876.namprd11.prod.outlook.com (2603:10b6:806:${i}::2${i}) with Microsoft SMTP Server (version=TLS1_2, cipher=TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384) id 15.20.8000.${i}; Fri, 9 Oct 2026 15:01:0${i} +0000`),
  'Authentication-Results: spf=pass (sender IP is 203.0.113.5)',
  ' smtp.mailfrom=secure-msg-center.top; dkim=none (message not signed)',
  ' header.d=none;dmarc=fail action=oreject',
  ' header.from=microsoft.com;compauth=fail reason=000',
  'Received-SPF: Pass (protection.outlook.com: domain of secure-msg-center.top designates 203.0.113.5 as permitted sender) receiver=protection.outlook.com; client-ip=203.0.113.5; helo=secure-msg-center.top;',
  'From: Microsoft Account Team <account-security-noreply@microsoft.com>',
  'To: alex@example.com',
  'Subject: Unusual sign-in activity',
  'Date: Fri, 9 Oct 2026 15:01:00 +0000',
  'Return-Path: bounce@secure-msg-center.top',
  'MIME-Version: 1.0',
  'Content-Type: text/html; charset="utf-8"'
].join('\r\n');

const EML = [
  'Return-Path: <service@paypal.com>',
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@paypal.com header.s=pp-dkim1;',
  '       spf=pass smtp.mailfrom=service@paypal.com;',
  '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=paypal.com',
  'From: PayPal <service@paypal.com>',
  'Subject: Your receipt',
  'Content-Type: text/plain; charset="UTF-8"',
  '',
  'Hello Alex, your receipt is ready.',
  ''
].join('\r\n');

// A slow scam, in each export format. Its five messages: wrong number, a move, an investment.
const SCAM = [
  ['+1 917 555 0101', 'Hi, is this Linda?'],
  ['Me', 'No, sorry, wrong number'],
  ['+1 917 555 0101', 'Oh I am so sorry! You seem kind though. I am Amy, I live in Singapore.'],
  ['+1 917 555 0101', 'I rarely use this app, add me on WhatsApp so we can keep talking'],
  ['+1 917 555 0101', 'My uncle is a financial analyst, he taught me crypto trading. I made $4,000 profit last week on a trading platform.']
];
const LRM = '‎';
const NNBSP = ' ';
const EXPORTS = {
  // WhatsApp on an iPhone: seconds, and a left-to-right mark before lines it writes itself (a picture, a call).
  'WhatsApp on an iPhone': SCAM.map(([who, t], i) => `[10/${6 + i}/26, 09:1${i}:3${i}] ${who}: ${t}`).join('\n').replace('\n', `\n${LRM}[10/6/26, 09:12:40] +1 917 555 0101: ${LRM}image omitted\n`),
  // WhatsApp on Android in the US: a 12-hour clock with a narrow space before AM.
  'WhatsApp on Android': SCAM.map(([who, t], i) => `10/${6 + i}/26, 9:1${i}${NNBSP}AM - ${who}: ${t}`).join('\n'),
  // iMessage, as imessage-exporter writes a conversation: a date line, the sender, the words, a blank line.
  iMessage: SCAM.map(([who, t], i) => `Oct 0${6 + i}, 2026  9:1${i}:33 AM\n${who === 'Me' ? 'Me' : '+19175550101'}\n${t}\n`).join('\n')
};

/* ----------------------------------------------------------------- check */

async function checkQaWeb() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-qa-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'qa-web-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo' }
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const eml = path.join(data, 'receipt.eml');
  fs.writeFileSync(eml, EML);
  const shotPng = path.join(data, 'chat.png');
  fs.writeFileSync(shotPng, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const downloads = path.join(data, 'downloads');
  fs.mkdirSync(downloads);
  const { browser, close } = await launch();
  const errors = [];
  const requests = [];
  const done = {};
  browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
  browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method, post: p.request.postData || '' }));
  browser.on('Browser.downloadWillBegin', (p) => { done[p.guid] = { name: p.suggestedFilename, state: 'started' }; });
  browser.on('Browser.downloadProgress', (p) => { if (done[p.guid]) done[p.guid].state = p.state; });
  // Each part on its own: one that cannot run says so and the rest still run.
  const part = async (name, fn) => { try { await fn(); } catch (err) { result(`qa-web: ${name} could not run`, false, err.stack || err.message); } };
  try {
    if (!up) throw new Error(`the Sentinel server did not start on ${base} (see qa-web-server.log)`);
    const { sessionId: s } = await openPage(browser);
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });
    const ev = (expr) => evalIn(browser, s, expr);
    const phone = () => browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    const desk = () => browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    const key = async (k, code, vk, text) => {
      for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === 'keyDown' && text ? { text } : {}) }, s);
    };
    const clickAt = async (selector, count = 1) => {
      const [x, y] = await ev(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
      for (let i = 1; i <= count; i++) for (const type of ['mousePressed', 'mouseReleased']) await browser.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: i }, s);
    };
    const waitFor = async (expr, tries = 120) => { let v = null; for (let i = 0; i < tries && !v; i++) { await sleep(250); v = await ev(expr).catch(() => null); } return v; };
    const account = async (plan) => ev(`(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'qa-' + Math.random().toString(36).slice(2) + '@example.com', password = 'Qa-Web-Check-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Sam', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      const c = ${plan ? `await post('/api/v1/billing/plan', { plan: '${plan}' })` : '{ ok: true }'};
      return a.ok && b.ok && c.ok;
    })()`);

    /* ------------------------------------------------------ signed out */
    await part('signed out', async () => {
      await goto(browser, s, `${base}/app/text`, "location.pathname === '/login'");
      const where = await ev('location.pathname + location.search');
      result('qa-web: signed out, /app/text goes to sign in and remembers where it was going', where === '/login?next=%2Fapp%2Ftext', where);
      if (!await account('max')) throw new Error('the Max test account could not sign in');
      await goto(browser, s, `${base}/login?next=%2Fapp%2Ftext`, "location.pathname === '/app/text' && document.querySelector('#view [data-form]')");
      result('qa-web: once signed in, the person lands back on the text scan', await ev("location.pathname === '/app/text'"));
    });

    /* ------------------------------------------- is this call a scam? */
    await part('call', async () => {
      await phone();
      await goto(browser, s, `${base}/app/call`, "document.querySelector('[data-call-answer] .call__empty')");
      await sleep(1200);
      await ev('scrollTo(0, 0), document.activeElement && document.activeElement.blur(), true');
      // Keyboard only: Tab until the "code" box has focus, then Space.
      let tabs = 0;
      for (; tabs < 80; tabs++) {
        if (await ev("(document.activeElement || {}).value === 'code'")) break;
        await key('Tab', 'Tab', 9);
      }
      const reached = await ev("(document.activeElement || {}).value === 'code'");
      await key(' ', 'Space', 32, ' ');
      await sleep(900);
      const seen = await ev(`(() => { const v = document.querySelector('.call__verdict'); if (!v) return null; const r = v.getBoundingClientRect();
        return { verdict: document.querySelector('[data-call-answer]').dataset.verdict, top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, focus: (document.activeElement || {}).value }; })()`);
      await shot(browser, s, 'qa-call-phone-tick');
      result('qa-web: call, keyboard only: Tab reaches "Read out a code" and Space ticks it', reached && seen && seen.verdict === 'hangup', { tabs, seen });
      result('qa-web: call, at phone width the "Hang up now." answer is on screen right after the tick, without scrolling to find it',
        Boolean(seen) && seen.top >= 0 && seen.bottom <= seen.height, seen);
      result('qa-web: call, the box just ticked keeps the keyboard focus', Boolean(seen) && seen.focus === 'code', seen && seen.focus);
      const ax = await browser.send('Accessibility.getFullAXTree', {}, s);
      const boxes = ax.nodes.filter((n) => n.role && n.role.value === 'checkbox' && !n.ignored);
      const unnamed = boxes.filter((n) => !(n.name && n.name.value));
      const live = ax.nodes.some((n) => (n.properties || []).some((p) => p.name === 'live' && p.value.value === 'polite') && !n.ignored);
      result('qa-web: call, a screen reader hears a name for every box and the answer is a live region', boxes.length === 14 && !unnamed.length && live, { boxes: boxes.length, unnamed: unnamed.length, live });
      // Light theme: the answer is still readable.
      await ev("localStorage.setItem('sentinel:theme', 'light'), true");
      await goto(browser, s, `${base}/app/call`, "document.querySelector('[data-call-answer] .call__empty')");
      await sleep(1000);
      await clickAt('input[value="giftcards"]');
      await sleep(900);
      const contrast = await ev(`(() => {
        const rgb = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
        const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bg = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) return c.slice(0, 3); } return [255, 255, 255]; };
        const ratio = (sel) => { const e = document.querySelector(sel); const a = lum(rgb(getComputedStyle(e).color)), b = lum(bg(e)); return Math.round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) * 10) / 10; };
        return { theme: document.documentElement.dataset.theme, verdict: ratio('.call__verdict'), reason: ratio('.call__reason') }; })()`);
      await shot(browser, s, 'qa-call-light');
      result('qa-web: call, in the light theme the answer is readable (contrast 3:1 for the big words, 4.5:1 for the reason)', contrast.theme === 'light' && contrast.verdict >= 3 && contrast.reason >= 4.5, contrast);
      await ev("localStorage.removeItem('sentinel:theme'), true");
      await desk();
    });

    /* ------------------------------------------------------ email scan */
    const openEmail = async () => {
      await goto(browser, s, `${base}/app/email`, "document.querySelector('#view [data-emode=\"paste\"]')");
      await sleep(800);
      await ev("sessionStorage.clear(), document.querySelector('[data-emode=\"paste\"]').click(), true");
    };
    const emailScan = async () => {
      const before = requests.length;
      await ev("document.querySelectorAll('#view [data-out] > *').forEach((e) => e.remove()), document.querySelector('form[data-form]').requestSubmit(), true");
      const got = await waitFor(`(() => { const r = document.querySelector('#view [data-out] .result, #view [data-out] .banner'); if (!r) return null; const p = document.querySelector('[data-sender-proof]');
        return { proof: p ? p.dataset.proof : null, proofText: p ? p.querySelector('b').textContent : '', banner: r.classList.contains('banner') ? r.innerText : '' }; })()`, 160);
      return { got, posts: requests.slice(before).filter((r) => r.method === 'POST' && r.url.endsWith('/api/v1/scan/email')) };
    };
    const pasteEmail = (raw) => ev(`(() => { const t = document.querySelector('[data-paste] textarea'); t.value = ${JSON.stringify(raw)}; t.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-parse]').click(); const f = document.querySelector('form[data-form]');
      return { from: f.from.value, subject: f.subject.value, body: f.body.value }; })()`);

    await part('email, Gmail Show original', async () => {
      await openEmail();
      const filled = await pasteEmail(GMAIL_PAGE);
      const r = await emailScan();
      result('qa-web: email, Gmail\'s Show original page copied whole: sender and subject found, body decoded, and "Not sent by paypal.com"',
        filled.from === 'PayPal <service@paypal.com>' && filled.subject === 'Your account is limited' && /within 24 hours to restore/.test(filled.body) && r.got && r.got.proof === 'not' && /mailer-xyz\.ru/.test(r.got.proofText),
        { filled, got: r.got });
    });

    await part('email, Outlook View message source', async () => {
      await openEmail();
      const filled = await pasteEmail(OUTLOOK_SOURCE);
      const r = await emailScan();
      await shot(browser, s, 'qa-email-outlook');
      result('qa-web: email, Outlook\'s View message source: "Really sent by paypal.com", the encoded subject and quoted-printable body decoded',
        r.got && r.got.proof === 'really' && filled.subject === 'Your receipt from Café Lumière' && filled.body.includes('Café Lumière') && filled.body.includes('myaccount/activity') && !/=C3|=\r?\n/.test(filled.body),
        { filled, got: r.got });
    });

    await part('email, Outlook headers only', async () => {
      await openEmail();
      const filled = await pasteEmail(OUTLOOK_HEADERS);
      const r = await emailScan();
      result('qa-web: email, Outlook\'s message headers on their own (no body): the From line is found and "Not sent by microsoft.com"',
        filled.from === 'Microsoft Account Team <account-security-noreply@microsoft.com>' && r.got && r.got.proof === 'not',
        { from: filled.from, subject: filled.subject, got: r.got });
    });

    await part('email, keyboard', async () => {
      await openEmail();
      await ev(`(() => { const t = document.querySelector('[data-paste] textarea'); t.value = ${JSON.stringify(GMAIL_PAGE)}; document.querySelector('[data-parse]').focus(); return true; })()`);
      await pressEnter(browser, s);
      await sleep(900);
      const focus = await ev(`(() => { const a = document.activeElement; const r = a.getBoundingClientRect();
        return { tag: a.tagName, name: a.name || '', inForm: Boolean(a.closest('form[data-form]')), visible: r.width > 0 && r.height > 0 }; })()`);
      result('qa-web: email, keyboard only: after Read this email, the focus goes to the filled-in form, not lost on a hidden button', focus.inForm && focus.visible, focus);
    });

    await part('email, an .eml dropped on the box', async () => {
      await openEmail();
      const [x, y] = await ev("(() => { const r = document.querySelector('[data-paste] textarea').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
      const drag = { items: [], files: [eml], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) await browser.send('Input.dispatchDragEvent', { type, x, y, data: drag }, s);
      const from = await waitFor("document.querySelector('form[data-form]').from.value", 40);
      result('qa-web: email, an .eml file dropped on the paste box is read and fills the form', from === 'PayPal <service@paypal.com>', from);
    });

    await part('email, empty, double and slow', async () => {
      await openEmail();
      await ev("document.querySelector('[data-emode=\"fields\"]').click(), true");
      const before = requests.length;
      await clickAt('form[data-form] button[type=submit]');
      await sleep(1500);
      const said = await ev("(() => { const t = [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | '); const o = document.querySelector('#view [data-out]').innerText; return { toast: t, out: o, focus: (document.activeElement || {}).name || '' }; })()");
      const sent = requests.slice(before).filter((r) => r.url.endsWith('/scan/email')).length;
      result('qa-web: email, Scan email with nothing filled in says what to do, calmly, without "Scan failed" and without spending a scan',
        !/Scan failed/.test(said.out) && /Paste/.test(said.toast + said.out) && !sent, { ...said, sent });
      // A slow connection, and two quick presses.
      await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: 50000, uploadThroughput: 50000 }, s);
      await ev("(() => { const f = document.querySelector('form[data-form]'); f.from.value = 'PayPal <service@paypa1-help.top>'; f.subject.value = 'Your account is limited'; f.body.value = 'Verify your account within 24 hours at https://paypa1-secure-login.com/verify'; return true; })()");
      const b2 = requests.length;
      await clickAt('form[data-form] button[type=submit]', 2);
      await sleep(400);
      const busy = await ev("document.querySelector('form[data-form] button[type=submit]').textContent.trim()");
      const got = await waitFor("(() => { const r = document.querySelector('#view [data-out] .result, #view [data-out] .banner'); return r ? r.innerText.slice(0, 120) : null; })()", 200);
      await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, s);
      const posts = requests.slice(b2).filter((r) => r.method === 'POST' && r.url.endsWith('/scan/email')).length;
      result('qa-web: email, on a slow connection a double press scans once, says it is scanning, then shows the verdict', posts === 1 && /Scanning/.test(busy) && Boolean(got) && !/Scan failed/.test(got), { posts, busy, got });
    });

    await part('email, 5 MB', async () => {
      await openEmail();
      const big = `From: Shop <hello@tinyshop.example>\nSubject: Newsletter\n\n${'Our autumn range is here, with new colours and sizes for everyone. '.repeat(80000)}`;
      const t0 = Date.now();
      await pasteEmail(big);
      const readMs = Date.now() - t0;
      const r = await emailScan();
      result('qa-web: email, a 5 MB paste is read in under 5 s and scanned (its first part), with no "check your connection" error',
        readMs < 5000 && r.got && !r.got.banner, { readMs, mb: Math.round(big.length / 1e5) / 10, got: r.got });
    });

    await part('email, right to left and emoji', async () => {
      await openEmail();
      await ev("document.querySelector('[data-emode=\"fields\"]').click(), true");
      await ev("(() => { const f = document.querySelector('form[data-form]'); f.from.value = 'بنك <alerts@bank-alrajhi-verify.top>'; f.subject.value = 'تحديث الحساب 🔒'; f.body.value = 'عزيزي العميل، تم تعليق حسابك 😟 يرجى تحديث بياناتك خلال 24 ساعة: https://bank-alrajhi-verify.top/login'; f.body.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
      const dir = await ev("getComputedStyle(document.querySelector('form[data-form] [name=body]')).direction");
      const r = await emailScan();
      const marks = await ev("(() => { const v = document.querySelector('[data-efield=\"body\"] .email-marks__v'); return v ? getComputedStyle(v).direction : null; })()");
      const fits = await ev('document.documentElement.scrollWidth <= innerWidth + 1');
      await shot(browser, s, 'qa-email-rtl');
      result('qa-web: email, Arabic words with emoji are written right to left in the box and in the marked email, and get a verdict',
        dir === 'rtl' && (marks === null || marks === 'rtl') && r.got && !r.got.banner && fits, { dir, marks, fits, got: r.got });
    });

    /* ------------------------------------------------------- text scan */
    const openText = async () => {
      await goto(browser, s, `${base}/app/text`, "document.querySelector('#view [data-form] textarea')");
      await sleep(800);
    };
    const textScan = async (text, { insert = false } = {}) => {
      await ev("(() => { document.querySelectorAll('#view [data-out] > *').forEach((r) => r.remove()); const f = document.querySelector('[data-form]'); f.from.value = ''; f.text.value = ''; f.text.focus(); return true; })()");
      if (insert) await browser.send('Input.insertText', { text }, s);
      else await ev(`(() => { const t = document.querySelector('[data-form] textarea'); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
      await ev("document.querySelector('[data-form]').requestSubmit(), true");
      return waitFor(`(() => { const res = document.querySelector('#view [data-out] [data-result], #view [data-out] .banner'); if (!res) return null; const slow = res.querySelector('[data-slow]');
        return { title: (res.querySelector('h2') || res).textContent.trim().slice(0, 120), tone: res.dataset.textResult || 'banner', at: slow ? slow.dataset.slow : null, sent: document.querySelector('[data-form] textarea').value.length }; })()`, 160);
    };

    await part('text, exports', async () => {
      await openText();
      for (const [name, text] of Object.entries(EXPORTS)) {
        const r = await textScan(text);
        result(`qa-web: text, a slow scam pasted as ${name} exports it is found, up to the investment step`, r && r.title === 'This conversation follows a slow scam' && r.at === 'invest', r);
      }
    });

    await part('text, long conversation', async () => {
      await openText();
      const chat = [
        '[10/1/26, 09:00:00] +1 917 555 0101: Hi, is this Linda?',
        '[10/1/26, 09:05:00] Me: No, sorry, wrong number',
        ...Array.from({ length: 220 }, (_, i) => `[10/${2 + (i % 20)}/26, 1${i % 10}:0${i % 6}:00] ${i % 2 ? 'Me' : '+1 917 555 0101'}: ${i % 2 ? 'Haha yes, the weather has been lovely here too, we went for a long walk by the river.' : 'Good morning my friend, did you sleep well? I had noodles for breakfast today.'}`),
        '[10/25/26, 20:15:00] +1 917 555 0101: My uncle is a financial analyst, he taught me crypto trading. I made $4,000 profit last week on a trading platform.'
      ].join('\n');
      const r = await textScan(chat, { insert: true });
      result(`qa-web: text, a long pasted conversation (${chat.length} characters) is read to its end: the investment at the end is found`,
        r && r.at === 'invest' && r.sent === chat.length, { ...r, pasted: chat.length });
      const t0 = Date.now();
      const huge = `${chat}\n`.repeat(Math.ceil(5e6 / chat.length));
      const h = await textScan(huge, { insert: true });
      result('qa-web: text, a 5 MB paste gets an answer, not an error, and says it read only part of it',
        h && h.tone !== 'banner' && Boolean(await ev("/part|first|last|long/i.test(document.querySelector('#view').innerText)")), { ...h, ms: Date.now() - t0 });
    });

    await part('text, empty, right to left, back and forward', async () => {
      await openText();
      const before = requests.length;
      await ev("(() => { const f = document.querySelector('[data-form]'); f.text.value = '   '; return true; })()");
      await clickAt('#view [data-form] button[type=submit]');
      await sleep(700);
      const toast = await ev("[...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | ')");
      result('qa-web: text, Check this text with nothing in it asks for the message and sends nothing', /Paste the message/.test(toast) && !requests.slice(before).some((r) => r.url.endsWith('/scan/text')), toast);

      const ar = 'مرحبا! هل هذا رقم أحمد؟ 😊🙏 أنا آسف، أرسلت إلى الرقم الخطأ';
      const r = await textScan(ar);
      const dir = await ev("getComputedStyle(document.querySelector('[data-form] textarea')).direction");
      const fits = await ev('document.documentElement.scrollWidth <= innerWidth + 1');
      await shot(browser, s, 'qa-text-rtl');
      result('qa-web: text, Arabic with emoji is written right to left and gets a calm answer', dir === 'rtl' && r && r.tone !== 'banner' && fits, { dir, r, fits });

      // Back and forward: what was pasted is still there.
      await ev("(() => { const t = document.querySelector('[data-form] textarea'); t.value = ''; t.focus(); return true; })()");
      await browser.send('Input.insertText', { text: EXPORTS['WhatsApp on Android'] }, s);
      await clickAt('a[href="/app/call"]');
      await waitFor("location.pathname === '/app/call' && document.querySelector('[data-call]')");
      await ev('history.back(), true');
      await waitFor("location.pathname === '/app/text' && document.querySelector('#view [data-form] textarea')");
      await sleep(400);
      const kept = await ev("document.querySelector('[data-form] textarea').value.length");
      result('qa-web: text, a conversation pasted, then the call page opened and Back pressed, is still in the box', kept === EXPORTS['WhatsApp on Android'].length, { kept, pasted: EXPORTS['WhatsApp on Android'].length });
    });

    await part('text, screenshot without the app', async () => {
      await openText();
      await ev("document.querySelector('[data-tmode=\"shot\"]').click(), true");
      const { root } = await browser.send('DOM.getDocument', { depth: -1 }, s);
      const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-shot-file]' }, s);
      await browser.send('DOM.setFileInputFiles', { nodeId, files: [shotPng] }, s);
      const status = await waitFor("document.querySelector('[data-shot-status]').textContent", 40);
      const sent = requests.filter((r) => r.method === 'POST' && /png|image/i.test(r.post.slice(0, 200)));
      result('qa-web: text, a screenshot in the browser (no Windows app) says reading needs the app, and the picture is not uploaded', /needs the Sentinel app/.test(status) && !sent.length, status);
    });

    /* -------------------------------------------------- warn a friend */
    const saveCheck = async (name) => {
      const card = await waitFor("document.querySelector('[data-warn-card] [data-warn-save]') && document.querySelectorAll('[data-warn-card]').length", 40);
      const before = Object.keys(done).length;
      await clickAt('[data-warn-card] [data-warn-save]');
      let got = null;
      for (let i = 0; i < 40 && !got; i++) { await sleep(250); got = Object.entries(done).slice(before).find(([, d]) => d.state === 'completed'); }
      let png = null;
      if (got) {
        const buf = fs.readFileSync(path.join(downloads, got[0]));
        png = { name: got[1].name, bytes: buf.length, signature: buf.slice(1, 4).toString(), width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
      await shot(browser, s, `qa-warn-${name}`);
      result(`qa-web: warn, the ${name} card's Save picture really downloads a PNG of the card`, Boolean(png) && png.name === 'sentinel-scam-warning.png' && png.signature === 'PNG' && png.width === 1080 && png.height >= 1080 && png.bytes > 20000, png || 'no download');
      return card;
    };

    await part('warn, text', async () => {
      await openText();
      await ev("(() => { const f = document.querySelector('[data-form]'); f.from.value = '+1 415 555 0199'; f.text.value = 'USPS: Your package is on hold due to an unpaid redelivery fee of $1.99. Pay at https://usps-redeliver.top/pay'; f.requestSubmit(); return true; })()");
      if (!await waitFor("document.querySelector('[data-warn]')")) throw new Error('no Warn a friend after a scam text');
      await clickAt('[data-warn]', 2);
      await sleep(1500);
      const cards = await ev("document.querySelectorAll('[data-warn-card]').length");
      result('qa-web: warn, a quick double press on Warn a friend leaves one card, not two', cards <= 1, cards);
      if (!cards) await clickAt('[data-warn]');
      await saveCheck('text');
    });

    await part('warn, QR code', async () => {
      const discord = path.join(QR, 'discord.png');
      if (!fs.existsSync(discord)) throw new Error(`no ${discord}`);
      await goto(browser, s, `${base}/app/scan`, "document.querySelector('#view [data-qr-file]')");
      await sleep(800);
      const { root } = await browser.send('DOM.getDocument', { depth: -1 }, s);
      const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-qr-file]' }, s);
      await browser.send('DOM.setFileInputFiles', { nodeId, files: [discord] }, s);
      if (!await waitFor("document.querySelector('[data-qr-out] [data-warn]')", 80)) throw new Error(`no Warn a friend after a sign-in QR code: ${await ev("document.querySelector('#view').innerText.slice(0, 300)")}`);
      await clickAt('[data-qr-out] [data-warn]');
      await saveCheck('qr');
    });

    /* -------------------------------------------- the free plan and signed out */
    await part('free plan', async () => {
      await goto(browser, s, `${base}/login`);
      if (!await account(null)) throw new Error('the free test account could not sign in');
      await goto(browser, s, `${base}/app/email`, "document.querySelector('#view h1, #view h2')");
      await sleep(600);
      const locked = await ev("document.querySelector('#view').innerText");
      result('qa-web: free plan, the email scan says plainly it is part of Max, with a way to upgrade', /part of Sentinel Max/.test(locked) && /Upgrade to Max/.test(locked), locked.slice(0, 300));
      await openText();
      const used = await ev(`(async () => { let n = 0; for (let i = 0; i < 10; i++) { const r = await fetch('/api/v1/scan/text', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'see you at 7 ' + i }) }); if (r.ok) n++; } return n; })()`);
      const r = await textScan('Hi mum, this is my new number, I lost my phone. Can you send me $300 for rent today?');
      const words = await ev("(document.querySelector('#view [data-out]') || {}).innerText || ''");
      const kept = await ev("document.querySelector('[data-form] textarea').value.length > 0");
      await shot(browser, s, 'qa-text-limit');
      result('qa-web: free plan, past the week\'s scans the text scan says so in plain words with when it resets, and keeps what was pasted',
        used === 10 && /used this week/.test(words) && /resets/.test(words) && kept, { used, r, words: words.slice(0, 200), kept });
      // Signed out in another tab: the next scan says to sign in again, with a link back here.
      await ev("fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.ok)");
      await textScan('Your parcel is waiting. Pay the fee at https://usps-redeliver.top/pay');
      const out = await ev("(() => { const o = document.querySelector('#view [data-out]'); const a = o.querySelector('a[href^=\"/login\"]'); return { words: o.innerText, link: a ? a.getAttribute('href') : '' }; })()");
      result('qa-web: signed out while using it, the scan says to sign in again with a link that comes back to the text scan',
        /sign in/i.test(out.words) && out.link === '/login?next=%2Fapp%2Ftext', out);
    });

    result('qa-web: no script errors', !errors.length, errors);
  } finally {
    await close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkQaWeb;
