'use strict';
process.env.NODE_ENV = 'test';
process.env.RESEARCH_ALLOW_PRIVATE = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { startFixtureServer, applyFacts, knownBadSample, fakeStealerExe, sha256 } = require('./fixtures');

require('../server/seed').run({ quiet: true });
const engine = require('../server/lib/scan/engine');
const feeds = require('../server/lib/scan/feeds');

let fixture;
test.before(async () => {
  fixture = await startFixtureServer();
  process.env.RESEARCH_TEST_PORT = String(fixture.address().port);
  applyFacts();
});
test.after(() => fixture.close());

const scan = (url, opts = {}) => engine.scanUrl(url, { threats: ['scam', 'virus', 'malware'], ...opts });
const lvl = (v, t) => v.threats[t].level;

/* ----------------------------------------------------------- known scams */

test('known scam domains are confirmed (red) from knowledge alone', async () => {
  for (const url of ['https://paypa1-secure-login.com/account', 'https://metamask-wallet-restore.cfd/', 'http://usps-redelivery-fee.sbs/pay']) {
    const v = await scan(url);
    assert.equal(lvl(v, 'scam'), 'confirmed', url);
    assert.equal(v.threats.scam.badge, 'red');
    assert.equal(v.knowledge.known, true);
    assert.equal(v.knowledge.discountApplied, false, 'no discount when the site is known');
  }
});

test('known malware and virus hosts light the right mask', async () => {
  assert.equal(lvl(await scan('https://chrome-update-required.top/'), 'malware'), 'confirmed');
  assert.equal(lvl(await scan('https://free-crack-downloads.icu/'), 'virus'), 'confirmed');
});

test('imported public feeds are used as knowledge', async () => {
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'openphish'), [
    'https://compromised-dentist-site.com/wp-content/uploads/secure/login.php',
    'https://brand-new-phish-zone.com/'
  ]);
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'urlhaus'), [
    'http://198.51.100.7/bins/mozi.m',
    'https://cdn-files-storage.net/payload/invoice_2026.exe'
  ]);
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'phishing_database'), ['netflix-account-hold.com', 'google.com']);
  await feeds.rebuildTokens();

  assert.equal(lvl(await scan('https://compromised-dentist-site.com/wp-content/uploads/secure/login.php'), 'scam'), 'confirmed');
  // Same host, different (clean) page: the exact-URL feed must not condemn the whole site.
  assert.notEqual(lvl(await scan('https://compromised-dentist-site.com/'), 'scam'), 'confirmed');
  assert.equal(lvl(await scan('https://brand-new-phish-zone.com/anything'), 'scam'), 'confirmed');
  assert.equal(lvl(await scan('https://cdn-files-storage.net/payload/invoice_2026.exe'), 'virus'), 'confirmed');
  assert.equal(lvl(await scan('https://netflix-account-hold.com/'), 'scam'), 'confirmed');
  // Allowlisted domains are never imported from a feed.
  assert.equal(lvl(await scan('https://google.com/'), 'scam'), 'safe');
});

/* ------------------------------------------------------------ safe sites */

test('well-known and ordinary sites stay clean', async () => {
  for (const url of ['https://www.google.com/search?q=weather', 'https://github.com/nodejs/node', 'https://en.wikipedia.org/wiki/Phishing',
    'https://www.paypal.com/signin', 'https://freelance.com/', 'https://accountants.co.uk/', 'https://nationwide-freephone.co.uk/',
    'https://www.bbc.co.uk/news', 'https://john-smith-photography.com/']) {
    const v = await scan(url);
    for (const t of ['scam', 'virus', 'malware']) assert.equal(v.threats[t].badge, null, `${url} ${t} ${v.threats[t].score}`);
  }
});

test('no knowledge-base record lowers the risk score', async () => {
  const v = await scan('https://secure-account-update.online/');
  assert.equal(v.knowledge.known, false);
  assert.equal(v.knowledge.discountApplied, true);
  const raw = v.checklist.items.filter((c) => c.threat === 'scam' && c.status !== 'skip').reduce((s, c) => s + c.points + ((c.extra && c.extra.scam) || 0), 0);
  assert.ok(v.threats.scam.score < raw, `discounted ${v.threats.scam.score} < raw ${raw}`);
});

/* ------------------------------------------------------ suspicious sites */

test('suspicious addresses get yellow or orange, never red without evidence', async () => {
  const cases = {
    'http://paypal.com.secure-verify-login.xyz/signin': 'likely',
    'https://amaz0n-refund.top/claim-reward': 'likely',
    'https://free-giftcard-claim-now.tk/': 'likely',
    'https://steamcommunlty-trade.com/': 'likely'
  };
  for (const [url, expected] of Object.entries(cases)) {
    const v = await scan(url);
    assert.equal(lvl(v, 'scam'), expected, `${url} scored ${v.threats.scam.score}`);
    assert.notEqual(v.threats.scam.badge, 'red');
  }
  const ip = await scan('http://192.0.2.44/admin');
  assert.ok(['suspicious', 'caution'].includes(lvl(ip, 'scam')), `bare IP ${ip.threats.scam.score}`);
});

test('a new domain built like a known scam is flagged by comparison', async () => {
  const v = await scan('https://paypal-secure-login.net/');
  const c01 = v.checklist.items.find((c) => c.id === 'C01');
  assert.equal(c01.status, 'fail', c01.detail);
});

test('disguised program downloads raise the virus mask', async () => {
  const v = await scan('https://files-share.example.com/Invoice_March.pdf.exe');
  assert.ok(['likely', 'confirmed'].includes(lvl(v, 'virus')), `virus ${v.threats.virus.score}`);
});

test('the checklist is extensive and every item explains itself', async () => {
  const v = await scan('https://example-unknown-shop.store/', { research: true });
  assert.ok(v.checklist.total >= 80, `only ${v.checklist.total} checks`);
  for (const item of v.checklist.items) {
    assert.ok(item.id && item.title && item.threat && item.status, JSON.stringify(item));
    assert.ok(['scam', 'virus', 'malware'].includes(item.threat));
  }
});

/* ------------------------------------------------ research (Pro / Max) */

test('research: credential phishing page is confirmed', async () => {
  const v = await scan('https://paypal-account-verify.com/login', { research: true });
  assert.equal(v.researched, true);
  assert.equal(lvl(v, 'scam'), 'confirmed', JSON.stringify(v.reasons));
  const ids = new Set(v.checklist.items.filter((c) => c.status === 'fail').map((c) => c.id));
  for (const id of ['R01', 'P01', 'P02', 'P03', 'P04']) assert.ok(ids.has(id), `expected ${id} to fail`);
});

test('research: the same phishing page without research is only orange', async () => {
  const v = await scan('https://paypal-account-verify.com/login', { research: false });
  assert.equal(v.researched, false);
  assert.equal(lvl(v, 'scam'), 'likely');
  assert.ok(v.checklist.items.filter((c) => c.research).every((c) => c.status === 'skip'));
});

test('research: wallet seed-phrase drainer is confirmed', async () => {
  const v = await scan('https://wallet-connect-restore.xyz/', { research: true });
  assert.equal(lvl(v, 'scam'), 'confirmed', JSON.stringify(v.reasons));
});

test('research: ClickFix fake update is confirmed malware', async () => {
  const v = await scan('https://browser-update-center.top/', { research: true });
  assert.equal(lvl(v, 'malware'), 'confirmed', JSON.stringify(v.reasons));
});

test('research: hidden cryptominer is confirmed malware', async () => {
  const v = await scan('https://free-recipes-blog.site/', { research: true });
  assert.equal(lvl(v, 'malware'), 'confirmed');
  assert.equal(v.threats.scam.badge, null, 'a mining blog is not a scam');
});

test('research: parcel redelivery-fee scam is at least likely', async () => {
  const v = await scan('https://parcel-redelivery-fee.com/', { research: true });
  assert.ok(['likely', 'confirmed'].includes(lvl(v, 'scam')), `scam ${v.threats.scam.score} ${JSON.stringify(v.reasons)}`);
});

test('research: established small businesses stay clean', async () => {
  for (const url of ['https://good-bakery.com/', 'https://ordinary-news.org/']) {
    const v = await scan(url, { research: true });
    for (const t of ['scam', 'virus', 'malware']) assert.equal(v.threats[t].badge, null, `${url} ${t}=${v.threats[t].score} ${JSON.stringify(v.reasons)}`);
  }
});

test('research: redirect into a known scam is confirmed', async () => {
  const v = await scan('https://link-bouncer.info/go', { research: true });
  assert.equal(lvl(v, 'scam'), 'confirmed', JSON.stringify(v.reasons));
});

test('research: downloaded programs are file-scanned', async () => {
  const stealer = await scan('https://tools-download-hub.net/setup.exe', { research: true });
  assert.ok(['likely', 'confirmed'].includes(lvl(stealer, 'virus')), `virus ${stealer.threats.virus.score}`);
  assert.ok(['likely', 'confirmed'].includes(lvl(stealer, 'malware')), `malware ${stealer.threats.malware.score}`);

  const sample = await scan('https://known-sample-host.net/sample.bin', { research: true });
  assert.equal(lvl(sample, 'virus'), 'confirmed');
});

/* --------------------------------------------------------------- files */

test('files: known malicious hashes are confirmed', () => {
  const buf = knownBadSample();
  const v = engine.scanUpload(buf, 'sample.bin');
  assert.equal(v.file.sha256, sha256(buf));
  assert.equal(v.threats.virus.level, 'confirmed');
  assert.equal(v.threats.virus.badge, 'red');
});

test('files: disguised executables and stealers are caught', () => {
  const v = engine.scanUpload(fakeStealerExe(), 'Invoice_2026.pdf');
  assert.ok(['likely', 'confirmed'].includes(v.threats.virus.level), `virus ${v.threats.virus.score}`);
  assert.ok(['likely', 'confirmed'].includes(v.threats.malware.level), `malware ${v.threats.malware.score}`);
});

test('files: script droppers and macro documents are caught', () => {
  // Inert text that names the download-and-run techniques the rule looks for.
  const dropper = engine.scanUpload(Buffer.from('inert sample: uses WScript.Shell, then DownloadString, then Invoke-Expression'), 'update.vbs');
  assert.ok(['likely', 'confirmed'].includes(dropper.threats.malware.level), `dropper ${dropper.threats.malware.score}`);

  const docm = zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<doc/>', 'word/vbaProject.bin': 'Attribute VB_Name = "ThisDocument"\nSub AutoOpen()\nEnd Sub' });
  const macro = engine.scanUpload(docm, 'Quarterly_Report.docm');
  assert.ok(['suspicious', 'likely', 'confirmed'].includes(macro.threats.malware.level), `macro ${macro.threats.malware.score}`);
});

test('files: archives containing programs raise the virus mask; clean files stay clean', () => {
  const zip = zipOf({ 'readme.txt': 'hello', 'photos/IMG_2231.jpg.exe': 'MZ....' });
  const v = engine.scanUpload(zip, 'photos.zip');
  assert.ok(['suspicious', 'likely', 'confirmed'].includes(v.threats.virus.level), `archive ${v.threats.virus.score}`);

  const clean = engine.scanUpload(Buffer.from('Shopping list: eggs, milk, flour, butter.\n'.repeat(20)), 'list.txt');
  assert.equal(clean.threats.virus.badge, null);
  assert.equal(clean.threats.malware.badge, null);
});

test('files: zip bombs and corrupt archives do not crash the scanner', () => {
  const bomb = zipOf({ 'AndroidManifest.xml': Buffer.alloc(20 * 1024 * 1024, 0) });
  assert.doesNotThrow(() => engine.scanUpload(bomb, 'app.apk'));
  assert.doesNotThrow(() => engine.scanUpload(Buffer.from('PK truncated garbage'), 'broken.zip'));
});

/* --------------------------------------------------------------- email */

test('email: brand spoof with a mismatched link and program attachment', async () => {
  const v = await engine.scanEmail({
    from: 'PayPal Security <alerts.paypal.security@gmail.com>',
    replyTo: 'recovery@paypal-account-verify.com',
    subject: 'URGENT: Your account has been suspended',
    body: 'Dear customer, we detected unusual activity. Verify your account within 24 hours or it will be permanently disabled.',
    links: [{ href: 'https://paypal-account-verify.com/login', text: 'https://www.paypal.com/security' }],
    attachments: ['Account_Statement.pdf.exe']
  }, { research: false, threats: ['scam', 'virus', 'malware'] });
  assert.ok(['likely', 'confirmed'].includes(v.threats.scam.level), `scam ${v.threats.scam.score}`);
  assert.ok(['likely', 'confirmed'].includes(v.threats.virus.level), `virus ${v.threats.virus.score}`);
});

test('email: an ordinary newsletter is clean', async () => {
  const v = await engine.scanEmail({
    from: 'GitHub <noreply@github.com>',
    subject: 'Your weekly digest',
    body: 'Hi Ada, here are the repositories trending in your network this week.',
    links: [{ href: 'https://github.com/trending', text: 'See what is trending' }],
    attachments: []
  }, { research: false, threats: ['scam', 'virus', 'malware'] });
  for (const t of ['scam', 'virus', 'malware']) assert.equal(v.threats[t].badge, null, `${t} ${v.threats[t].score}`);
});

/* ----------------------------------------------------------------- utils */

function zipOf(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(comp.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('malicious uploads on a verified platform flag only that exact URL', async () => {
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'urlhaus'), [
    'https://github.com/evil-user/tools/releases/download/v1/stealer.exe',
    'https://github.com/evil-user/tools/raw/main/loader.ps1',
    'https://github.com/another-bad/x/raw/main/payload.bin',
    'https://github.com/yet-another/y/raw/main/drop.zip'
  ]);
  assert.equal(lvl(await scan('https://github.com/evil-user/tools/releases/download/v1/stealer.exe'), 'virus'), 'confirmed');
  const clean = await scan('https://github.com/paypal');
  for (const t of ['scam', 'virus', 'malware']) assert.equal(clean.threats[t].badge, null, `github.com/paypal ${t}`);
});

test('no checklist rule crashes on unusual addresses, with or without research', async () => {
  const odd = [
    'http://192.0.2.1:8080/', 'https://[2001:db8::1]/login', 'https://xn--pypal-4ve.com/', 'https://a.b.c.d.e.f.example.co.uk/x',
    'https://user:pass@evil.example.com/', 'https://parcel-customs-release.top/track', 'https://my-shop.myshopify.com/checkout',
    'https://sites.google.com/view/paypal-login', 'https://example.com/%E0%A4%A', 'https://example.com/?url=https%3A%2F%2Fevil.xyz',
    'https://docs.example.com/a.pdf.exe', 'https://x.duckdns.org:8443/bins/mips', 'https://tools.usps.com/go/TrackConfirmAction',
    'https://paypal-account-verify.com/login', 'https://browser-update-center.top/', 'https://tools-download-hub.net/setup.exe'
  ];
  for (const url of odd) {
    for (const research of [false, true]) {
      const v = await scan(url, { research });
      assert.ok(v.ok, url);
      assert.ok(!v.checklist.items.some((c) => c.detail === 'Check could not run'), `${url} research=${research}`);
    }
  }
});

test('threat kinds: results name the specific trick from the evidence, never without it', async () => {
  const kinds = require('../server/lib/scan/kinds');
  const cases = [
    ['https://paypa1-secure-login.com/account', 'scam', 'phishing'],
    ['https://usps-redelivery-fee.sbs/pay', 'scam', 'delivery'],
    ['https://crypto-doubler-elon.live/', 'scam', 'crypto'],
    ['https://cdn-share.site/Invoice_March.pdf.exe', 'virus', 'disguised'],
    ['https://chrome-update-required.top/', 'malware', 'known'],
    ['http://update-check.ddns.net:8443/i.sh', 'malware', 'drop']
  ];
  for (const [url, threat, kind] of cases) {
    const v = await engine.scanUrl(url, { threats: ['scam', 'virus', 'malware'], research: false });
    assert.equal(v.threats[threat].kind, kind, `${url} ${threat}`);
    assert.equal(v.threats[threat].kindLabel, kinds.KINDS[kind].label);
  }
  // Every kind an engine can produce has an icon, and every icon has a kind.
  const masks = require('../web/assets/js/masks.js');
  const icons = Object.keys(globalThis.SentinelMasks.KIND_GLYPHS);
  for (const id of Object.keys(kinds.KINDS)) assert.ok(icons.includes(id), `no icon for kind ${id}`);
  for (const id of icons) assert.ok(kinds.KINDS[id], `icon ${id} has no kind`);
  void masks;
  // A clean site carries no kind at all.
  const clean = await engine.scanUrl('https://www.wikipedia.org/', { threats: ['scam', 'virus', 'malware'], research: false });
  assert.equal(clean.threats.scam.kind, null);
  assert.equal(clean.threats.scam.kindLabel, null);
});
