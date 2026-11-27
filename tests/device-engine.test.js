'use strict';
/**
 * The companion's on-device engine (extension/src/lib/engine.js, made by scripts/engine-bundle.js from the scanner's own
 * url.js, lists.js and brands.js): a listed host and a copy of a brand's address are answered on the device, and the
 * answer is the scanner's. The engine is built from the files, so it cannot be left behind: this fails when it is.
 */
process.env.NODE_ENV = 'test';
process.env.FEED_REFRESH_HOURS = '0';
process.env.RESEARCH_ENABLED = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const bundle = require('../scripts/engine-bundle');
const { parse, sampleId } = require('../scripts/phish-sample');

async function load() {
  const text = fs.readFileSync(bundle.OUT, 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
}

test('the engine is what the scanner\'s files make: a change to url.js, lists.js or brands.js without a rebuilt engine fails', () => {
  assert.ok(bundle.upToDate(), 'node scripts/engine-bundle.js --write');
  for (const name of ['url', 'lists', 'brands']) {
    const src = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', `${name}.js`), 'utf8').replace(/\r\n/g, '\n');
    assert.notEqual(bundle.build({ [name]: `${src}\n// changed\n` }), fs.readFileSync(bundle.OUT, 'utf8'), `${name}.js changed, engine not rebuilt`);
  }
});

test('the threat list: a listed host and everything under it, nothing else, and a damaged file is refused', async () => {
  const engine = await load();
  assert.equal(engine.listed('bad.example'), null, 'nothing is listed until a list is loaded');
  const file = bundle.listFile([{ host: 'www.bad-one.example', threat: 'scam' }, { host: 'worm.example', threat: 'malware' }, { host: 'worm.example', threat: 'scam' }, { host: 'not a host', threat: 'scam' }], 1700000000);
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.length);
  assert.deepEqual(engine.loadList(buf), { count: 2, madeAt: 1700000000 });
  assert.equal(engine.listed('bad-one.example'), 'scam');
  assert.equal(engine.listed('http-login.a.b.bad-one.example'), 'scam', 'the way the browser\'s own door matches a site');
  assert.equal(engine.listed('WWW.WORM.EXAMPLE'), 'malware', 'the worse threat wins');
  assert.equal(engine.listed('example'), null);
  assert.equal(engine.listed('notbad-one.example'), null);
  assert.equal(engine.listed('bad-one.example.org'), null);
  assert.throws(() => engine.loadList(buf.slice(0, buf.byteLength - 4)), /not a threat list/);
  assert.throws(() => engine.loadList(new ArrayBuffer(16)), /not a threat list/);
  assert.equal(engine.listed('bad-one.example'), 'scam', 'a refused file leaves the loaded list as it was');
});

test('same answers as the scanner: every address, listed or a look-alike of a brand, and nothing the scanner would leave alone', async () => {
  require('../server/seed').run({ quiet: true });
  const scanner = require('../server/lib/scan/engine');
  const { db } = require('../server/lib/db');
  const { analyze, brandInfo } = require('../server/lib/scan/url');
  const engine = await load();
  const j = (...p) => p.join('');
  const disguises = [j('paypa', '1.com'), j('rn', 'icrosoft.com'), j('roblo', 'xx.com'), j('onedr', 'lve.com'), j('trezo', 'orr.com'), j('g', '00', 'gle.com'), j('micr', '0', 'soft.com')];
  const phish = parse(fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate-phish.frozen.txt'), 'utf8'));
  const honest = [...JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate-lookalikes.json'), 'utf8')).map((e) => e.url),
    ...JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'evaluate-sites.json'), 'utf8')).map((h) => `https://${h}/`),
    ...[...require('../server/lib/scan/url').popularSites()].slice(0, 400).map((h) => `https://${h}/`)];
  const squats = disguises.map((d) => `https://${d}/login`);

  // The list, from the same rows the scanner reads, loaded as the browser would.
  const { rowsFrom } = require('../scripts/build-threat-list');
  // Hosts from a public feed as well as the seeded ones.
  await require('../server/lib/scan/feeds').importLines({ id: 'test_hosts', name: 'Test hosts', kind: 'hosts', threat: 'scam', category: 'phishing' }, Array.from({ length: 60 }, (_, i) => `feed-host-${i}.example.test`));
  const rows = rowsFrom(db);
  assert.ok(rows.length > 20, 'the seeded list is not empty');
  const file = bundle.listFile(rows);
  engine.loadList(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));

  const ask = (u) => scanner.scanUrl(u, { threats: ['scam', 'virus', 'malware'], mode: 'live', detail: 'compact', research: false });
  const mismatches = [];
  let listedHits = 0;
  for (const { host } of rows.slice(0, 300)) {
    for (const u of [`https://${host}/`, `http://login.${host}/a/b?c=d`]) {
      const s = await ask(u);
      const device = engine.listed(analyze(u).host);
      if (device) listedHits++;
      if (Boolean(device) !== (s.overall.badge === 'red') || (u.endsWith(`${host}/`) && !device)) mismatches.push(`list ${u}: device ${device}, scanner ${s.overall.badge}`);
    }
  }
  assert.deepEqual(mismatches, [], 'a listed address is red on the scanner exactly when it is listed on the device (the host or its registrable domain, as knowledge.js asks)');

  const stats = { phishCopy: 0, squatCopy: 0 };
  for (const [name, urls] of [['phish', phish], ['honest', honest], ['squats', squats]]) {
    for (const u of urls) {
      const p = analyze(u);
      if (!p) continue;
      const device = engine.lookalike(u);
      assert.equal(Boolean(device), Boolean(brandInfo(p).lookalike), `${name} ${u}: the engine and url.js read the address alike`);
      if (!device) continue;
      const s = await ask(u);
      assert.ok(s.overall.badge, `${name} ${u}: the device says a copy of ${device.brand}; the scanner must not leave it alone`);
      if (name === 'honest') assert.fail(`false alarm on an honest address: ${u} (${device.brand})`);
      if (name === 'phish') stats.phishCopy++; else stats.squatCopy++;
    }
  }
  assert.equal(stats.squatCopy, squats.length, 'every disguise is a look-alike');
  console.log(`device engine parity: ${listedHits} listed addresses, ${stats.phishCopy} of ${phish.length} frozen phishing addresses (sample ${sampleId(phish)}) read as brand look-alikes on the device, ${honest.length} honest addresses, no false alarm; list made from ${rows.length} hosts`);
});

test('what it costs: start, memory with a large list, and a check (printed; the ceiling is generous)', async () => {
  const t0 = process.hrtime.bigint();
  const engine = await load();
  const imported = Number(process.hrtime.bigint() - t0) / 1e6;
  const rows = Array.from({ length: 500000 }, (_, i) => ({ host: `host-${i.toString(36)}.example${i % 7}.test`, threat: 'scam' }));
  const file = bundle.listFile(rows);
  global.gc && global.gc();
  const before = process.memoryUsage();
  engine.loadList(file.buffer.slice(file.byteOffset, file.byteOffset + file.length));
  const after = process.memoryUsage();
  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) engine.listed(`sub.host-${i}.example${i % 7}.test`);
  const lookup = Number(process.hrtime.bigint() - t1) / 1e6 / 1000;
  const first = process.hrtime.bigint();
  engine.lookalike(`https://some-ordinary-name.example/`);
  const firstCheck = Number(process.hrtime.bigint() - first) / 1e6;
  console.log(`device engine cost: import ${imported.toFixed(0)} ms (the file is ${(fs.statSync(bundle.OUT).size / 1024).toFixed(0)} KB), 500,000-host list is ${(file.length / 1048576).toFixed(1)} MB and adds ${((after.arrayBuffers - before.arrayBuffers + after.heapUsed - before.heapUsed) / 1048576).toFixed(1)} MB of memory, a list lookup ${(lookup * 1000).toFixed(1)} us, the first address check ${firstCheck.toFixed(0)} ms`);
  assert.ok(imported < 2000 && lookup < 0.5 && file.length === 16 + 500000 * 8);
});
