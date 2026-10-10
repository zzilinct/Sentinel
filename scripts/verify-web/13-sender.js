'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { ROOT, OUT, sleep, result, launch, evalIn, openPage, goto, shot } = require('./_shared');

/* --------------------------------------- 12. who really sent it (email scan, sender-xray) */

// Written by hand for this check, in the shape Gmail writes them. No real mail.
const XRAY_SPOOF = [
  'Delivered-To: alex@example.com',
  'Received: by 2002:a05:6000:1a8b with SMTP id x11csp123; Fri, 9 Oct 2026 08:01:02 -0700',
  'X-Originating-IP: [198.51.100.7]',
  'Authentication-Results: mx.google.com;',
  '       spf=pass (google.com: domain of bounce@mailer-xyz.ru designates 198.51.100.7 as permitted sender) smtp.mailfrom=bounce@mailer-xyz.ru;',
  '       dmarc=fail (p=REJECT sp=REJECT dis=QUARANTINE) header.from=paypal.com',
  'Return-Path: <bounce@mailer-xyz.ru>',
  'From: PayPal <service@paypal.com>',
  'To: alex@example.com',
  'Subject: Your account is limited',
  '',
  'Hello Alex,',
  'We could not confirm a recent payment. Please review your account to restore full access.'
].join('\n');
// The same brand, really sent by it, as an .eml file: a web page part only, base64, with a link whose words are its address.
const XRAY_HTML = '<html><body><p>Hello Alex,</p><p>Your receipt is ready. See it at <a href="https://www.paypal.com/myaccount/activity">www.paypal.com</a>.</p></body></html>';
const XRAY_REAL = [
  'Received: from mx0.paypal.com (mx0.paypal.com [192.0.2.10]) by mx.google.com; Fri, 9 Oct 2026 08:01:02 -0700',
  'Authentication-Results: mx.google.com;',
  '       dkim=pass header.i=@paypal.com header.s=pp-dkim1 header.b=AbCdEf12;',
  '       spf=pass (google.com: domain of service@paypal.com designates 192.0.2.10 as permitted sender) smtp.mailfrom=service@paypal.com;',
  '       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=paypal.com',
  'DKIM-Signature: v=1; a=rsa-sha256; d=paypal.com; s=pp-dkim1; h=from:subject; b=AbCdEf12',
  'Return-Path: <service@paypal.com>',
  'From: =?UTF-8?B?UGF5UGFs?= <service@paypal.com>',
  'To: alex@example.com',
  'Subject: =?UTF-8?Q?Your_receipt?=',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="xray-b1"',
  '',
  '--xray-b1',
  'Content-Type: text/html; charset="UTF-8"',
  'Content-Transfer-Encoding: base64',
  '',
  ...Buffer.from(XRAY_HTML).toString('base64').match(/.{1,76}/g),
  '--xray-b1--',
  ''
].join('\r\n');

async function checkSender() {
  const net = require('net');
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-xray-db-'));
  const serverLog = fs.openSync(path.join(OUT, 'sender-server.log'), 'w');
  const sentinel = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT,
    stdio: ['ignore', serverLog, serverLog],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(data, 'sentinel.db'), FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', BILLING_MODE: 'demo' }
  });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/v1/auth/config`)).ok; } catch { /* still starting */ } }
  const eml = path.join(data, 'receipt.eml');
  fs.writeFileSync(eml, XRAY_REAL);
  const { browser, close } = await launch();
  try {
    if (!up) throw new Error(`the Sentinel server did not start on ${base} (see sender-server.log)`);
    const { sessionId: s } = await openPage(browser);
    const errors = [];
    const requests = [];
    browser.on('Runtime.exceptionThrown', (p) => errors.push(`exception: ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text}`));
    browser.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error' || p.type === 'assert') errors.push(`console.${p.type}: ${p.args.map((a) => a.value || a.description || '').join(' ')}`); });
    browser.on('Network.requestWillBeSent', (p) => requests.push({ url: p.request.url, method: p.request.method, post: p.request.postData || '' }));
    await browser.send('Runtime.enable', {}, s);
    await browser.send('Network.enable', {}, s);
    // A throwaway account on the Max plan (demo billing), made and signed in from the page itself.
    await goto(browser, s, `${base}/login`);
    const signed = await evalIn(browser, s, `(async () => {
      const post = (p, body) => fetch(p, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const email = 'xray-' + Date.now() + '@example.com', password = 'Sender-Xray-2026!';
      const a = await post('/api/v1/auth/signup', { email, password, firstName: 'Alex', ageConfirmed: true, termsAccepted: true });
      const b = await post('/api/v1/auth/login', { email, password });
      const c = await post('/api/v1/billing/plan', { plan: 'max' });
      return a.ok && b.ok && c.ok;
    })()`);
    if (!signed) throw new Error('the test account could not sign in on Max');
    const openTab = async () => {
      await goto(browser, s, `${base}/app/email`, "document.querySelector('#view [data-emode=\"paste\"]')");
      await sleep(800);   // the page's entrance (app-lux.js) settles
      await evalIn(browser, s, "document.querySelector('[data-emode=\"paste\"]').click(), true");
    };
    const scan = async (name) => {
      const before = requests.length;
      await evalIn(browser, s, "document.querySelector('form[data-form]').requestSubmit(), true");
      let got = null;
      for (let i = 0; i < 120 && !got; i++) {
        await sleep(250);
        got = await evalIn(browser, s, `(() => { const p = document.querySelector('[data-sender-proof]'); const r = document.querySelector('#view .result');
          return r && { proof: p ? p.dataset.proof : null, text: p ? p.querySelector('b').textContent : '', marked: [...document.querySelectorAll('[data-email-marks] .emark__tag')].map((t) => t.textContent),
            body: document.querySelector('form[data-form]').body.value, from: document.querySelector('form[data-form]').from.value, subject: document.querySelector('form[data-form]').subject.value }; })()`);
      }
      // The picture shows the verdict and the proof line under it, without the toast over them.
      await evalIn(browser, s, "document.querySelectorAll('.toast').forEach((t) => t.remove()), (document.querySelector('#view .result') || document.body).scrollIntoView({ block: 'start' }), true");
      await sleep(600);
      await shot(browser, s, `sender-${name}`);
      const sent = requests.slice(before).filter((r) => r.method === 'POST' && r.url.endsWith('/api/v1/scan/email'));
      const elsewhere = requests.slice(before).filter((r) => !r.url.startsWith(base) && !r.url.startsWith('data:'));
      return { got, payload: sent.length ? JSON.parse(sent[0].post) : null, elsewhere };
    };

    /* Pasted from Gmail's Show original: a forged PayPal email. */
    await openTab();
    const help = await evalIn(browser, s, "document.querySelector('[data-header-help]').innerText");
    result('sender: the paste box says in one line each how to copy the headers in Gmail and Outlook',
      /Gmail:.*Show original/.test(help) && /Outlook:.*View message source/.test(help) && !/—/.test(help), help);
    await evalIn(browser, s, `(() => { const t = document.querySelector('[data-paste] textarea'); t.value = ${JSON.stringify(XRAY_SPOOF)}; document.querySelector('[data-parse]').click(); return true; })()`);
    const spoof = await scan('spoofed');
    result('sender: a pasted email that only claims paypal.com says "Not sent by paypal.com: it came from mailer-xyz.ru", in red, and marks the From address',
      spoof.got && spoof.got.proof === 'not' && spoof.got.text === 'Not sent by paypal.com: it came from mailer-xyz.ru' && spoof.got.marked.some((m) => /Not really from here/.test(m)), spoof.got);
    const hdr = spoof.payload ? spoof.payload.headers : '';
    result('sender: only the sender-check headers go with the scan, not the route, the IP or who it was delivered to',
      /^Authentication-Results:/m.test(hdr) && /^Return-Path:/m.test(hdr) && !/Received: by|X-Originating-IP|Delivered-To|alex@example\.com/.test(hdr), hdr);
    result('sender: nothing is looked up anywhere but Sentinel', !spoof.elsewhere.length, spoof.elsewhere.map((r) => r.url));

    /* An .eml file, chosen with the button: the real PayPal, its words encoded and its text a web page in base64. */
    await openTab();
    const { root } = await browser.send('DOM.getDocument', { depth: -1 }, s);
    const { nodeId } = await browser.send('DOM.querySelector', { nodeId: root.nodeId, selector: '[data-eml]' }, s);
    await browser.send('DOM.setFileInputFiles', { nodeId, files: [eml] }, s);
    let filled = '';
    for (let i = 0; i < 40 && !filled; i++) { await sleep(150); filled = await evalIn(browser, s, "document.querySelector('form[data-form]').from.value"); }
    const real = await scan('real-eml');
    result('sender: an .eml file of the real paypal.com says "Really sent by paypal.com", in green',
      real.got && real.got.proof === 'really' && real.got.text === 'Really sent by paypal.com', real.got);
    result('sender: the .eml file is decoded: its encoded From and Subject, and its web page text with the link written as words and address',
      real.got && real.got.from === 'PayPal <service@paypal.com>' && real.got.subject === 'Your receipt' && /Your receipt is ready/.test(real.got.body) && real.got.body.includes('www.paypal.com <https://www.paypal.com/myaccount/activity>') && !/<p>|PGh0bWw/.test(real.got.body),
      real.got && { from: real.got.from, subject: real.got.subject, body: real.got.body.slice(0, 300) });

    /* Typed by hand afterwards: the headers of the pasted email do not go with a different sender. */
    await evalIn(browser, s, "(() => { const f = document.querySelector('form[data-form]'); f.from.value = 'Shop <hello@tinyshop.example>'; return true; })()");
    const typed = await scan('typed');
    result('sender: once the From is changed by hand, the earlier headers are not sent and no proof line is shown',
      typed.got && typed.got.proof === null && typed.payload && typed.payload.headers === '', typed.got && { proof: typed.got.proof, headers: typed.payload && typed.payload.headers });

    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, s);
    await evalIn(browser, s, `(() => { const f = document.querySelector('form[data-form]'); f.from.value = ''; document.querySelector('[data-emode="paste"]').click(); const t = document.querySelector('[data-paste] textarea'); t.value = ${JSON.stringify(XRAY_SPOOF)}; document.querySelector('[data-parse]').click(); return true; })()`);
    await scan('phone');
    const fits = await evalIn(browser, s, 'document.documentElement.scrollWidth <= innerWidth + 1');
    result('sender: at phone width the proof line fits with no sideways scroll', fits);
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }, s);
    result('sender: no console errors', !errors.length, errors);
  } finally {
    await close();
    sentinel.kill();
    await sleep(500);
    try { fs.rmSync(data, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkSender;
