'use strict';
process.env.NODE_ENV = 'test';
process.env.FEED_REFRESH_HOURS = '0';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('../server/seed').run({ quiet: true });
const engine = require('../server/lib/scan/engine');
const { scanAddress, _test: { checksOf } } = require('../server/lib/scan/offline');
const { engineBundle } = require('../scripts/build-static');

const ROOT = path.join(__dirname, '..');
const THREATS = ['scam', 'virus', 'malware'];

// The addresses npm run probe uses: made-up scam-style addresses and real sites that use the same words.
const probe = fs.readFileSync(path.join(ROOT, 'scripts', 'probe.js'), 'utf8');
const listOf = (name) => vm.runInNewContext(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`).exec(probe)[1]);
const bad = listOf('bad');
const clean = listOf('clean');
const NOT_RUN = new Set(['Known threats', 'Compared to known scams']);

test('offline: every check it runs scores exactly as the engine scores it', async () => {
  assert.ok(bad.length > 20 && clean.length > 10, 'the probe lists were read');
  for (const url of [...bad, ...clean]) {
    const server = await engine.scanUrl(url, { threats: THREATS, research: false });
    const here = scanAddress(url);
    assert.equal(here.ok, true, url);
    const own = (checks) => checks.filter((c) => !NOT_RUN.has(c.group)).map((c) => `${c.id}:${c.status}:${c.points}`);
    assert.deepEqual(own(checksOf(url)), own(server.checklist.items), url);
  }
});

test('offline: the same verdict as the fast scan wherever the app\'s database adds nothing, and the real sites left alone', async () => {
  let compared = 0;
  for (const url of [...bad, ...clean]) {
    const server = await engine.scanUrl(url, { threats: THREATS, research: false });
    // Points from the lists or the comparison with known scams live in the app's database, which this cannot see.
    if (server.checklist.items.some((c) => NOT_RUN.has(c.group) && (c.status === 'fail' || c.status === 'warn'))) continue;
    const here = scanAddress(url);
    for (const t of THREATS) assert.deepEqual([here.threats[t].level, here.threats[t].score], [server.threats[t].level, server.threats[t].score], `${url} ${t}`);
    compared++;
  }
  assert.ok(compared > (bad.length + clean.length) / 2, `only ${compared} addresses could be compared`);
  // The one address the probe misses with the lists empty too: the storage-bucket case under Known limits in README.
  for (const url of bad) assert.ok(THREATS.some((t) => scanAddress(url).threats[t].badge) || url.includes('storage.googleapis.com'), `${url} missed`);
  for (const url of clean) {
    const here = scanAddress(url);
    assert.ok(THREATS.every((t) => !here.threats[t].badge), `${url} flagged: ${JSON.stringify(here.reasons)}`);
  }
});

test('offline: shipped threats are confirmed, verified sites trusted, and a list it did not check is not claimed as passed', () => {
  const red = scanAddress('https://paypa1-secure-login.com/account');
  assert.equal(red.threats.scam.badge, 'red');
  assert.equal(red.known, true);
  const wiki = scanAddress('https://www.wikipedia.org');
  assert.equal(wiki.overall.badge, null);
  const plain = scanAddress('https://example-bakery.com/');
  assert.equal(plain.discounted, false);
  assert.ok(!checksOf('https://example-bakery.com/').some((c) => NOT_RUN.has(c.group) && c.status === 'pass'), 'no list or comparison check reads as passed');
  assert.deepEqual(scanAddress('not a link at all'), { ok: false, message: 'That does not look like a web address.' });
  assert.equal(scanAddress('').ok, false);
});

test('engine.js: the bundle the website loads gives the same answers, with the word list fetched and unpacked', async () => {
  const gz = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'words.txt.gz'));
  const fetched = [];
  const run = (body) => {
    const win = {};
    const ctx = {
      window: win,
      document: { currentScript: { src: 'https://example.github.io/sentinel/assets/js/engine.js' } },
      fetch: async (url) => { fetched.push(url); return { ok: true, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) }; },
      URL, Response, Blob, DecompressionStream, TextDecoder, console
    };
    vm.runInNewContext(engineBundle(), ctx);
    return win.SentinelEngine;
  };
  const bundled = run(gz);
  // overdrive.com reads as two words only with the word list: it must not be taken for OneDrive.
  for (const url of ['https://overdrive.com/', 'https://0nedrive-login.com/', 'paypal-account-verify.com/login', 'https://files-share.site/Invoice.pdf.exe', 'https://www.wikipedia.org']) {
    const a = await bundled.scan(url);
    const b = scanAddress(url);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), url);
  }
  assert.deepEqual(fetched, ['https://example.github.io/sentinel/assets/data/words.txt.gz'], 'the word list is fetched once, beside the page');
  // A host that already unpacked it (Content-Encoding: gzip) sends plain text.
  const plain = run(require('zlib').gunzipSync(gz));
  assert.equal((await plain.scan('https://overdrive.com/')).overall.badge, scanAddress('https://overdrive.com/').overall.badge);
  // Nothing in the bundle may reach a server or the page's storage.
  assert.doesNotMatch(engineBundle(), /XMLHttpRequest|sendBeacon|localStorage|indexedDB/);
});
