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
  // The rest of that site is likely dangerous while it hosts a listed page, and the reason says
  // exactly what is known. It is not "confirmed": nobody has listed this address.
  const root = await scan('https://compromised-dentist-site.com/');
  assert.equal(lvl(root, 'scam'), 'likely');
  assert.equal(root.threats.scam.badge, 'orange');
  assert.ok(root.reasons.some((r) => /another page on this site is listed by OpenPhish; this address is not/i.test(r.text)), 'the reason says why');
  // "www." on either side of the list makes no difference.
  assert.equal(lvl(await scan('https://www.brand-new-phish-zone.com/'), 'scam'), 'confirmed');
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

/* ------------------------------------------------- generalising rules */

const flagged = (v) => ['scam', 'virus', 'malware'].some((t) => v.threats[t].badge);
const check = (v, id) => v.checklist.items.find((c) => c.id === id);

test('unlisted phishing-style addresses are flagged from the address alone', async () => {
  // None of these are in any feed or fixture; they only carry the patterns.
  const cases = [
    ['https://walletconnect-dapp-sync.app/', 'U27'],
    ['https://mysecurebank-online.com/auth', 'U25'],
    ['https://webmail-update-required.com/', 'U25'],
    ['https://portal-hr-payroll.net/adp/login', 'U40'],
    ['https://mybucket.s3.us-east-1.amazonaws.com/secure/index.html', 'U20'],
    ['https://x7k29q.cloudfront.net/login.html', 'U42'],
    ['https://gardencentre-leeds.co.uk/wp-content/uploads/verify.php', 'U41'],
    ['https://sunnyrentals.com/.well-known/secure/index.php?email=', 'U41'],
    ['https://a8f3k2.pages.dev/signin', 'U42'],
    ['https://www.chase.com@evil-host.net/', 'U03'],
    ['https://sites.google.com/view/office365-login-verify', 'U20']
  ];
  for (const [url, id] of cases) {
    const v = await scan(url, { research: false });
    assert.ok(flagged(v), `${url} should be flagged (scam ${v.threats.scam.score})`);
    assert.equal(check(v, id).status, 'fail', `${url} should fail ${id}`);
  }
});

test('the real sites behind those patterns stay clean', async () => {
  for (const url of [
    'https://walletconnect.com/', 'https://metamask.io/', 'https://www.adp.com/logins.aspx', 'https://workday.com/',
    'https://www.chase.com/personal/online-banking', 'https://outlook.live.com/owa/', 'https://www.dropbox.com/login',
    'https://accounts.google.com/signin', 'https://login.microsoftonline.com/', 'https://aws.amazon.com/s3/', 'https://cloud.google.com/storage'
  ]) {
    const v = await scan(url, { research: false });
    assert.ok(!flagged(v), `${url} should be clean (scam ${v.threats.scam.score})`);
  }
});

test('a brand platform is official for its own pages but not for pages users upload there', async () => {
  const { analyze, brandInfo, isUserContent } = require('../server/lib/scan/url');
  const own = brandInfo(analyze('https://accounts.google.com/signin'));
  assert.equal(own.official && own.official.token, 'google');
  assert.equal(own.owner && own.owner.token, 'google');

  for (const url of ['https://sites.google.com/view/anything', 'https://storage.googleapis.com/bucket/index.html', 'https://mybucket.s3.us-east-1.amazonaws.com/x.html']) {
    const p = analyze(url);
    assert.ok(isUserContent(p.host), `${p.host} is user content`);
    const b = brandInfo(p);
    assert.equal(b.official, null, `${url} is not the brand's own page`);
    // On a hosting suffix (amazonaws.com) the registrable name is the customer's, so no owner either.
    if (!p.hosting) assert.ok(b.owner, `${url} still belongs to a brand, so it is not borrowing the name`);
    assert.equal(b.inDomain, null, `${url} is not borrowing a brand name`);
  }
  // Not trusted by knowledge either: the bucket page still gets the checklist.
  const v = await scan('https://storage.googleapis.com/bucket/login.html', { research: false });
  assert.equal(v.knowledge.trusted, false);
  assert.equal(check(v, 'U36').status, 'skip', 'no official-site credit on a bucket');
  assert.equal(check(v, 'U20').status, 'fail');
  assert.equal(check(v, 'U22').status, 'pass', 'the platform is not impersonating itself');
});

test('the "@" decoy names what was hidden', async () => {
  const v = await scan('https://www.chase.com@evil-host.net/', { research: false });
  const u03 = check(v, 'U03');
  assert.equal(u03.status, 'fail');
  assert.equal(u03.points, 40, 'a decoy that names a protected brand');
  assert.match(u03.detail, /chase\.com.*evil-host\.net/);
  assert.equal(v.host, 'evil-host.net');
});

test('kit-style pages in site folders and random hosting labels score by what is stacked', async () => {
  const folder = check(await scan('https://oldrecipes.org/wp-includes/css/login.php', { research: false }), 'U41');
  assert.equal(folder.status, 'fail');
  assert.equal(folder.points, 26, 'kit file name inside a site folder');
  const victim = check(await scan('https://sunnyrentals.com/.well-known/secure/index.php?email=', { research: false }), 'U41');
  assert.equal(victim.points, 36, 'folder page addressed to one person');
  const wpLogin = check(await scan('https://oldrecipes.org/wp-login.php', { research: false }), 'U41');
  assert.equal(wpLogin.status, 'pass', 'wp-login.php is a real WordPress page');

  const random = check(await scan('https://a8f3k2.pages.dev/signin', { research: false }), 'U42');
  assert.equal(random.status, 'fail');
  const readable = check(await scan('https://myshop2024.pages.dev/', { research: false }), 'U42');
  assert.notEqual(readable.status, 'fail', 'a readable label with a year is not random');
});

test('a server with research switched off never fetches, and says why', async () => {
  const config = require('../server/config');
  const url = 'https://free-recipes-blog.site/';
  const on = await scan(url, { research: true });
  assert.equal(on.researched, true, 'the fixture page is researched when research is on');
  config.researchEnabled = false;
  try {
    const off = await scan(`${url}?again=1`, { research: true });
    assert.equal(off.researched, false);
    assert.equal(off.research, null);
    assert.match(off.researchSkipReason, /on your computer/);
  } finally {
    config.researchEnabled = true;
  }
});

test('feeds in every list format are read, and the file host is never trusted for them', () => {
  const byId = (id) => feeds.FEEDS.find((f) => f.id === id);
  assert.deepEqual(feeds.extract(byId('scamblocklist'), '# comment\n0.0.0.0 bad-shop.example\n0.0.0.0 www.bad-shop.example\nnot a hosts line\n'), ['bad-shop.example', 'www.bad-shop.example']);
  assert.deepEqual(feeds.extract(byId('threatfox'), '#####\n127.0.0.1\tc2.example\n'), ['c2.example']);
  assert.deepEqual(feeds.extract(byId('metamask'), JSON.stringify({ blacklist: ['drainer.example', 7], whitelist: ['fine.example'] })), ['drainer.example']);
  assert.deepEqual(feeds.extract(byId('scamsniffer'), '["a.example","b.example"]'), ['a.example', 'b.example']);
  assert.deepEqual(feeds.extract(byId('polkadot_phishing'), JSON.stringify({ allow: ['ok.example'], deny: ['no.example'] })), ['no.example']);
  assert.deepEqual(feeds.extract(byId('phishtank'), 'phish_id,url,detail\n1,"https://x.example/a,b",https://phishtank.example/1\n2,https://y.example/,z\n'), ['https://x.example/a,b', 'https://y.example/']);
  assert.deepEqual(feeds.extract(byId('certpl'), 'one.example\ntwo.example # note\n\n'), ['one.example', 'two.example']);
  assert.deepEqual(feeds.extract(byId('urlhaus'), '# header\nhttp://1.2.3.4/bin.sh\n'), ['http://1.2.3.4/bin.sh']);
  assert.ok(feeds.FEEDS.length >= 12, 'a dozen or more public lists');
  for (const f of feeds.FEEDS) assert.ok(f.name && f.hours && /^https?:\/\//.test(f.url), `${f.id} is complete`);
});

test('a listed host is definite in every list that names it, and a name is always compared with 10+ known scams', async () => {
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'scamsniffer'), ['wallet-drainer-airdrop.example', 'www.metamask-claim-portal.example']);
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'threatfox'), ['c2-panel.example', '203.0.113.77']);
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'urlhaus'), ['https://one-listed-download.example/files/setup.exe']);
  await feeds.rebuildTokens();

  for (const [url, threat] of [
    ['https://wallet-drainer-airdrop.example/claim', 'scam'],
    ['https://metamask-claim-portal.example/', 'scam'],
    ['https://c2-panel.example/gate.php', 'malware'],
    ['http://203.0.113.77/', 'malware'],
    ['https://one-listed-download.example/files/setup.exe', 'virus']
  ]) {
    const v = await scan(url, { research: false });
    assert.equal(lvl(v, threat), 'confirmed', `${url} ${threat}`);
    assert.equal(v.threats[threat].badge, 'red');
    assert.equal(v.knowledge.known, true);
  }

  for (const url of ['https://paypal-secure-login-verify.com/', 'https://qzx-trading.biz/', 'https://john-smith-photography.com/']) {
    const v = await scan(url, { research: false });
    assert.ok(v.comparison.compared >= 10, `${url} compared with ${v.comparison.compared}`);
    assert.ok(v.comparison.closest.length >= 1 && v.comparison.closest.length <= 10);
    assert.ok(v.comparison.closest.every((c) => typeof c.host === 'string' && Number.isInteger(c.distance)));
  }
  assert.ok(typeof (await scan('https://example.org/', { research: false })).knowledge.feeds.total === 'number');
});

test('another page on a listed host is an inference: red only when the address fails checks of its own', async () => {
  const phishtank = feeds.FEEDS.find((f) => f.id === 'phishtank') || feeds.FEEDS.find((f) => f.id === 'openphish');
  await feeds.importLines(phishtank, [
    'https://crm.big-unknown-service.example/forms/share/9f3a/login.html',
    'https://allegrolokalnie.pl-65445.lol/oferta/84731',
    'https://front-page-listed.example/'
  ]);

  // The exact listed address is definite.
  const exact = await scan('https://crm.big-unknown-service.example/forms/share/9f3a/login.html', { research: false });
  assert.equal(exact.threats.scam.badge, 'red');

  // A different, ordinary-looking page on that host is not listed. It is flagged, truthfully, but never red.
  const other = await scan('https://crm.big-unknown-service.example/login', { research: false });
  assert.equal(other.threats.scam.badge, 'orange', JSON.stringify(other.threats.scam));
  assert.equal(other.threats.scam.evidence, null);
  assert.equal(other.knowledge.known, false);

  // The same inference on an address that is wrong by itself (it imitates "allegrolokalnie.pl") is definite.
  const disposable = await scan('https://allegrolokalnie.pl-65445.lol/kup-teraz', { research: false });
  assert.equal(disposable.threats.scam.badge, 'red');
  assert.match(disposable.threats.scam.evidence, /fails checks of its own/);

  // When the site's own front page is listed, the site is listed: every page on it is definite.
  const inside = await scan('https://front-page-listed.example/account/settings', { research: false });
  assert.equal(inside.threats.scam.badge, 'red');

  // A service known to carry other people's pages is judged page by page.
  await feeds.importLines(phishtank, ['https://app.hubspot.com/documents/1234/view/5678']);
  const platform = await scan('https://app.hubspot.com/login', { research: false });
  assert.equal(platform.threats.scam.badge, null, JSON.stringify(platform.threats.scam));
});

test('a name that imitates a country ending, or is only a long number, is caught from the address', async () => {
  const fake = await scan('https://allegro.pl-99120.click/', { research: false });
  assert.ok(fake.threats.scam.score >= 30, String(fake.threats.scam.score));
  const serial = await scan('https://08491749145.lat/', { research: false });
  assert.ok(serial.threats.scam.badge, 'a bare serial number on a throwaway ending is flagged');
  for (const url of ['https://www.12306.cn/', 'https://www.163.com/', 'https://pl-tech.com/']) {
    assert.equal((await scan(url, { research: false })).threats.scam.badge, null, url);
  }
});

test('free-hosted help desks, buried endings and letter-string names are caught; their honest neighbours are not', async () => {
  const badge = async (url) => (await scan(url, { research: false })).threats.scam.badge;
  for (const url of [
    'https://customer-helpcenter4471.netlify.app/',
    'https://verifiedbadge-review.vercel.app/meta-verified-for-business',
    'http://shop.item.co.uk.login.secures-k2.example-hotel-site.com/',
    'https://508113.xyz/',
    'https://qxwkls.cfd/ACS_page'
  ]) assert.ok(await badge(url), `${url} should be flagged`);

  for (const url of [
    'https://someproject.github.io/login', // one word in a folder name is documentation
    'https://anna-photography.github.io/',
    'https://www.co.washington.or.us/', // a lone "co" is how American county sites are named
    'https://uk.news.yahoo.com/',
    'https://www.nightclub.com/', // four consonants in a row, on an ordinary ending
    'https://abc.xyz/'
  ]) assert.equal(await badge(url), null, `${url} should stay clean`);

  const buried = await scan('http://shop.item.co.uk.login.secures-k2.example-hotel-site.com/', { research: false });
  assert.ok(buried.reasons.some((r) => /read as "shop\.item\.co\.uk"; the real site is example-hotel-site\.com/.test(r.text)), 'the reason names the real site');
});

test('a tenant filed under its service\'s name before the service was recognised does not condemn innocent look-alikes', async () => {
  const { db } = require('../server/lib/db');
  // As an older version would have stored it: the tenant under the platform's own name.
  db.prepare("INSERT OR REPLACE INTO feed_hosts (host, source, threat, category, skeleton, added_at) VALUES ('havtech.myportfolio.com', 'openphish', 'scam', 'phishing', 'myportfolio', ?)").run(Date.now());
  const v = await scan('https://my-portfolio.vercel.app/', { research: false });
  assert.equal(v.threats.scam.badge, null, JSON.stringify(v.threats.scam));
});

test('glued brand names, dressed-up paths and kit file names are caught; archives and honest names are not', async () => {
  const v = (url) => scan(url, { research: false });
  const flagged = ['https://applesoporte.services/isignesp.php', 'https://appleidmapa.com/', 'https://wwapplecloud.help/',
    'https://short.example/roblox-com-users-9694397261-profile', 'https://tokenim.date/download'];
  for (const url of flagged) assert.ok((await v(url)).threats.scam.badge, `${url} should be flagged`);

  const glued = await v('https://applesoporte.services/');
  assert.ok(glued.reasons.some((r) => /"apple" glued to "soporte"/.test(r.text)), 'the reason says which name was borrowed');
  const kit = await v('https://some-small-site.example/wp/isignesp.php');
  assert.ok(kit.reasons.some((r) => /file name phishing kits reuse|phishing kit.s file/.test(r.text)));

  for (const url of ['https://www.applebees.com/', 'https://www.pineapple.com/', 'https://www.amazonpay.com/',
    'https://web.archive.org/', 'https://web.archive.org/web/2020/https://www.paypal.com/', 'https://example.org/captcha.php']) {
    assert.equal((await v(url)).threats.scam.badge, null, `${url} should stay clean`);
  }
});

test('a listed host on the same domain is not a "look-alike" of it', async () => {
  await feeds.importLines(feeds.FEEDS.find((f) => f.id === 'phishing_database'), ['ia601403.us.bigarchive-example.org']);
  const v = await scan('https://web.bigarchive-example.org/', { research: false });
  assert.ok(!v.reasons.some((r) => /Nearly the same name/.test(r.text)), JSON.stringify(v.reasons.map((r) => r.text)));
});
