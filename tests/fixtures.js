'use strict';
/**
 * Test fixtures: a local web server that plays scam, malware and safe websites
 * (keyed by Host header), plus an API client with a cookie jar.
 *
 * Samples here are deliberately inert: they carry the wording and structure the
 * detectors look for, but no working payloads, real test-virus strings or
 * runnable commands - so antivirus software has nothing to object to.
 */
const http = require('http');
const crypto = require('crypto');

const DAY = 86400000;

/** A harmless file that the tests register as a "known malicious" hash. */
function knownBadSample() {
  return Buffer.from('Sentinel test sample - registered in the known-hash list by the test suite only.\n');
}

/** A tiny, non-functional "program": an MZ header followed by credential-store references. */
function fakeStealerExe() {
  const header = Buffer.alloc(64);
  header.write('MZ', 0, 'latin1');
  const refs = ['\\Chrome\\User Data\\Default\\Login Data', 'wallet.dat', '\\Telegram Desktop\\tdata'].join(' | ');
  return Buffer.concat([header, Buffer.from(`inert test sample: ${refs}`, 'latin1')]);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

const PAGES = {
  'paypal-account-verify.com': {
    '/login': `<!doctype html><html><head><title>PayPal: Log in to your account</title>
      <meta name="robots" content="noindex"></head>
      <body><img src="https://www.paypal.com/logo.svg"><h1>Your account has been suspended</h1>
      <p>We noticed unusual activity. Verify your identity within 24 hours to restore access.</p>
      <form action="https://collector-backend.example.net/p.php" method="post">
        <input type="email" name="login_email"><input type="password" name="login_password">
        <input name="cardnumber" autocomplete="cc-number"><input name="cvv">
      </form>
      <p data-endpoint="api.telegram.org/bot000:TEST/sendMessage"></p></body></html>`
  },
  'wallet-connect-restore.xyz': {
    '/': `<!doctype html><html><head><title>MetaMask - Restore Wallet</title></head><body>
      <h2>Import wallet</h2><p>Enter your 12-word secret recovery phrase to connect wallet and claim your airdrop.</p>
      ${Array.from({ length: 12 }, (_, i) => `<input type="text" name="word${i + 1}" placeholder="Word ${i + 1}">`).join('')}
      </body></html>`
  },
  'browser-update-center.top': {
    '/': `<!doctype html><html><head><title>Critical Chrome Update</title></head><body>
      <h1>Your browser is out of date</h1><p>Critical update required. Verify you are human to download update.</p>
      <p>Step 1: press Windows + R. Step 2: press Ctrl + V. Step 3: press Enter to finish verification.</p>
      <script>navigator.clipboard.writeText("echo test-sample");</script></body></html>`
  },
  'free-recipes-blog.site': {
    '/': `<!doctype html><html><head><title>Easy Recipes</title><script src="https://coinhive.com/lib/sample.js"></script></head>
      <body><h1>Recipes</h1><p>${'Tasty food ideas for every day of the week. '.repeat(30)}</p></body></html>`
  },
  'parcel-redelivery-fee.com': {
    '/': `<!doctype html><html><head><title>USPS Tracking</title></head><body>
      <h1>Your package could not be delivered</h1><p>Due to an incomplete address your parcel is held. Pay the $1.99 redelivery fee and update your address.</p>
      <form><input name="fullname"><input name="cc-number" autocomplete="cc-number"></form></body></html>`
  },
  'good-bakery.com': {
    '/': `<!doctype html><html><head><title>Good Bakery - Fresh bread since 2009</title></head><body>
      <h1>Good Bakery</h1><p>${'Sourdough, croissants and seasonal pastries baked every morning in our family kitchen. '.repeat(20)}</p>
      <button>Add to cart</button><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/refunds">Refunds</a>
      <p>Up to 20% off this weekend.</p></body></html>`
  },
  'ordinary-news.org': {
    '/': `<!doctype html><html><head><title>Ordinary News - Local stories</title></head><body>
      <article><h1>Council approves new library hours</h1><p>${'The town council voted on Tuesday to extend opening hours at the central library. '.repeat(25)}</p></article>
      <form action="/search"><input name="q"></form></body></html>`
  },
  'link-bouncer.info': {
    '/go': { redirect: 'http://paypa1-secure-login.com/' }
  },
  'paypa1-secure-login.com': {
    '/': '<!doctype html><html><head><title>Sign in</title></head><body><form><input type="password"></form></body></html>'
  },
  'tools-download-hub.net': {
    '/setup.exe': { body: fakeStealerExe(), type: 'application/x-msdownload', disposition: 'attachment; filename="setup.exe"' }
  },
  'known-sample-host.net': {
    '/sample.bin': { body: knownBadSample(), type: 'application/octet-stream', disposition: 'attachment; filename="sample.bin"' },
    '/download': { body: knownBadSample(), type: 'application/octet-stream', disposition: 'attachment; filename="sample.bin"' }
  },
  'query-sensitive.example': {
    '/view?version=clean': '<html><title>Clean page</title><p>Ordinary content</p></html>',
    '/view?version=other': '<html><title>Different page</title><p>Different content</p></html>'
  },
  'docs.google.com': {
    '/redirect-fixture/start': { redirect: '/redirect-fixture/listed' },
    '/redirect-fixture/listed': { redirect: '/redirect-fixture/clean' },
    '/redirect-fixture/clean': '<html><title>Nothing here</title><p>Ordinary content</p></html>'
  }
};

/** Registration facts per fixture domain, fed to the research stage. */
const reg = (ageDays, termDays = 365) => ({ registration: { available: true, registered: true, createdAt: Date.now() - ageDays * DAY, expiresAt: Date.now() - ageDays * DAY + termDays * DAY, status: [] } });
const FACTS = {
  'paypal-account-verify.com': reg(3),
  'wallet-connect-restore.xyz': reg(9),
  'browser-update-center.top': reg(20),
  'free-recipes-blog.site': reg(400, 730),
  'parcel-redelivery-fee.com': reg(2),
  'good-bakery.com': { ...reg(8 * 365, 10 * 365), dns: { resolves: true, addresses: ['93.184.216.34'], privateAddress: false, mx: true, nameservers: [] } },
  'ordinary-news.org': reg(12 * 365, 13 * 365),
  'link-bouncer.info': reg(900, 1460),
  'tools-download-hub.net': reg(45),
  'known-sample-host.net': reg(700, 1095)
};

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    if (host === 'partial-download.example') {
      const body = knownBadSample();
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': body.length + 100 });
      res.write(body);
      setTimeout(() => res.destroy(), 20);
      return;
    }
    const page = PAGES[host] && (PAGES[host][req.url] || PAGES[host][req.url.split('?')[0]]);
    if (!page) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>Not found</h1>'); return; }
    if (typeof page === 'string') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page); return; }
    if (page.redirect) { res.writeHead(302, { Location: page.redirect }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': page.type, 'Content-Disposition': page.disposition });
    res.end(page.body);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function applyFacts() {
  const research = require('../server/lib/scan/research');
  for (const [host, facts] of Object.entries(FACTS)) research.setTestFacts(host, facts);
  const { db } = require('../server/lib/db');
  db.prepare("INSERT OR REPLACE INTO file_hashes (sha256, threat, name, source, added_at) VALUES (?, 'virus', 'Test.KnownSample', 'test', ?)")
    .run(sha256(knownBadSample()), Date.now());
}

/* ------------------------------------------------------------- api client */

function client(base) {
  let cookie = '';
  async function call(method, path, { body, headers = {}, raw, origin = base } = {}) {
    const h = { ...headers };
    if (origin) h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = h['Content-Type'] || 'application/json'; }
    const res = await fetch(base + path, { method, headers: h, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (p, o) => call('GET', p, o),
    post: (p, body, o = {}) => call('POST', p, { ...o, body }),
    raw: call,
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; }
  };
}

async function startApp() {
  const { createServer } = require('../server/index');
  require('../server/seed').run({ quiet: true });
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { startFixtureServer, applyFacts, client, startApp, knownBadSample, fakeStealerExe, sha256, DAY };
