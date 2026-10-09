'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../server/lib/db');
const mySites = require('../server/lib/scan/mysites');
const engine = require('../server/lib/scan/engine');

const DAY = 24 * 60 * 60 * 1000;
let n = 0;
function newUser() {
  const id = `usr_${String(++n).padStart(24, '0')}`;
  db.prepare('INSERT INTO users (id, email, first_name, created_at) VALUES (?, ?, ?, ?)').run(id, `mysites${n}@example.com`, 'Test', Date.now());
  return id;
}
const how = (url, sites) => { const m = mySites.nearCopy(url, sites); return m ? m.how : null; };

test('near-copies of a small site are caught, each for what was done to the name', () => {
  const cu = ['harbourcu.org'];
  assert.equal(how('https://harbourcu.com/login', cu), 'ending');
  assert.equal(how('https://harbourcu.weebly.com/', cu), 'ending');
  assert.equal(how('https://harbourcu-secure-login.com/', cu), 'extra');
  assert.equal(how('https://secure-harbourcu.net/', cu), 'extra');
  assert.equal(how('https://harbourcuonline.com/', cu), 'extra');
  assert.equal(how('https://harb0urcu.org/', cu), 'digit');
  assert.equal(how('https://harbour-cu.org/', cu), 'dash');
  assert.equal(how('https://harbourrcu.org/', cu), 'double');
  assert.equal(how('https://hrabourcu.org/', cu), 'swap');
  assert.equal(how('https://harbourcv.org/', cu), 'letter');
  assert.equal(how('https://firstrnidwest.com/', ['firstmidwest.com']), 'digit', 'rn for m');
  // A four-letter name: a copy that adds words or changes the ending, but not one letter off (too many real names).
  assert.equal(how('https://mycu-secure-login.com/', ['mycu.org']), 'extra');
  assert.equal(how('https://mycu.com/', ['mycu.org']), 'ending');
  assert.equal(how('https://mycv.org/', ['mycu.org']), null);
});

test('the site itself, its pages and its other sites are never copies', () => {
  assert.equal(how('https://harbourcu.org/', ['harbourcu.org']), null);
  assert.equal(how('https://online.harbourcu.org/signin', ['harbourcu.org']), null);
  assert.equal(how('https://www.harbourcu.org/', ['harbourcu.org']), null);
  assert.equal(how('https://harbourcu.com/', ['harbourcu.org', 'harbourcu.com']), null, 'both are yours');
  assert.equal(how('https://harbourcu.org/', []), null);
});

test('real-world names that only happen to be close are left alone', () => {
  // Two real words close in spelling: another name, not a misspelling (the url.js lesson).
  assert.equal(how('https://www.onedrive.com/', ['overdrive.com']), null);
  assert.equal(how('https://www.overdrive.com/', ['onedrive.example']), null);
  // A name made of the site's name and an ordinary word, written as one.
  assert.equal(how('https://www.trainline.com/', ['train.com']), null);
  assert.equal(how('https://honeynest.com/', ['nest.com']), null);
  assert.equal(how('https://www.chaser.com/', ['chase.example']), null);
  assert.equal(how('https://www.modern.com/', ['modem.com']), null, 'rn for m, but a real word');
  // Close, but not one step apart.
  assert.equal(how('https://www.shopify.com/', ['spotify.example']), null);
  assert.equal(how('https://gitlab.com/', ['github.example']), null);
  assert.equal(how('https://hula.com/', ['hulu.example']), null, 'four letters: one letter off is not enough');
  // A site a brand owns is the brand's, whatever the person uses.
  assert.equal(how('https://www.paypal.com/', ['paypai.org']), null);
  assert.equal(how('https://www.amazon.co.uk/', ['amazon.org']), null);
  // Short names are not compared at all.
  assert.equal(how('https://bbc.com/', ['bbc.co.uk']), null);
  // Ordinary hyphenated names that only share a word with a site.
  assert.equal(how('https://bluewater-cafe.com/', ['bluewater.com']), null);
  assert.equal(how('https://bluewater-login.com/', ['bluewater.com']), 'extra', 'unless the added word is bait');
});

test('sweep: no real site is called a copy of another, with every one of them on the list in turn', () => {
  const L = require('../server/lib/scan/lists');
  const { analyze } = require('../server/lib/scan/url');
  const host = (u) => { const p = analyze(u); return p ? p.host : null; };
  // The evaluation's legitimate sites, real pages, real names close to brands, every brand domain and the allowlist.
  const hosts = [...new Set([
    ...require('../scripts/evaluate-sites.json'),
    ...require('../scripts/evaluate-lookalikes.json').map((x) => host(x.url)),
    ...require('../scripts/evaluate-pages.json').map(host),
    ...L.PROTECTED_BRANDS.flatMap((b) => b.domains),
    ...L.DEFAULT_ALLOWLIST
  ].filter(Boolean))];
  const sites = [...new Set(hosts.map(mySites.siteOf).filter(Boolean))];
  assert.ok(sites.length > 500, `${sites.length} sites`);
  const alarms = [];
  for (const site of sites) for (const h of hosts) { const m = mySites.nearCopy(`https://${h}/`, [site]); if (m) alarms.push(`${h} as ${site} (${m.how})`); }
  assert.deepEqual(alarms, []);
});

test('a site is learned from clean visits on three different days, kept as a plain host; one day is not enough', () => {
  const user = newUser();
  const t = Date.UTC(2026, 9, 1, 12);
  assert.equal(mySites.seen(user, 'https://online.harbourcu.org/accounts', t, 0), null);
  assert.equal(mySites.seen(user, 'https://online.harbourcu.org/transfer', t + 3600e3, 0), null, 'the same day twice counts once');
  assert.equal(mySites.seen(user, 'https://harbourcu.org/', t + DAY, 0), null);
  assert.deepEqual(mySites.list(user), []);
  const stored = JSON.stringify(db.prepare('SELECT * FROM site_days WHERE user_id = ?').all(user));
  assert.doesNotMatch(stored, /harbour/, 'a site not yet learned is not readable');
  assert.equal(mySites.seen(user, 'https://harbourcu.org/', t + 2 * DAY, 0), 'harbourcu.org');
  assert.deepEqual(mySites.list(user).map((s) => [s.host, s.source]), [['harbourcu.org', 'learned']]);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM site_days WHERE user_id = ?').get(user).c, 0);
  // Brand sites and pages on shared hosts are not learned.
  for (const d of [0, 1, 2]) {
    mySites.seen(user, 'https://www.paypal.com/', t + d * DAY, 0);
    mySites.seen(user, 'https://someone.github.io/', t + d * DAY, 0);
  }
  assert.deepEqual(mySites.list(user).map((s) => s.host), ['harbourcu.org']);
});

test('sites added by hand are kept as their site, can be removed, and Forget all erases everything', () => {
  const user = newUser();
  assert.equal(mySites.add(user, 'https://login.myschool.edu/portal'), 'myschool.edu');
  assert.equal(mySites.add(user, 'WWW.Payroll-Works.com'), 'payroll-works.com');
  assert.equal(mySites.add(user, 'not a site'), null);
  assert.equal(mySites.add(user, '10.0.0.1'), null);
  assert.deepEqual(mySites.list(user).map((s) => s.host).sort(), ['myschool.edu', 'payroll-works.com']);
  assert.ok(mySites.remove(user, 'https://payroll-works.com/'));
  assert.deepEqual(mySites.list(user).map((s) => s.host), ['myschool.edu']);
  mySites.seen(user, 'https://somewhere-else.org/', Date.now(), 0);
  assert.equal(mySites.forget(user), 1);
  assert.deepEqual(mySites.list(user), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM site_days WHERE user_id = ?').get(user).c, 0);
});

test('link, live and email scans warn about a copy of the person\'s site in plain words; other people are not affected', async () => {
  const user = newUser();
  const other = newUser();
  mySites.add(user, 'harbourcu.org');
  const v = await engine.scanUrl('https://harbourcu-secure-login.com/', { userId: user, mode: 'live', detail: 'compact' });
  assert.equal(v.overall.badge, 'orange');
  assert.equal(v.threats.scam.label, 'Look-alike of your site');
  assert.equal(v.reasons[0].text, 'This is not harbourcu.org. You usually go to harbourcu.org; this address looks like it, but it adds words to the name.');
  assert.doesNotMatch(v.reasons[0].text, /—/);

  const same = await engine.scanUrl('https://online.harbourcu.org/', { userId: user });
  assert.equal(same.overall.badge, null, 'the real site is clean');
  const theirs = await engine.scanUrl('https://harb0urcu.org/', { userId: other });
  assert.ok(!theirs.checklist.items.some((c) => c.id === 'Y01'), 'someone without the site gets no such warning');

  const mail = await engine.scanEmail({ from: 'Harbour CU <alerts@harbourcu.org>', subject: 'Statement ready', body: 'See it at https://harb0urcu.org/statements' }, { userId: user });
  assert.ok(mail.overall.badge, JSON.stringify(mail.overall));
  assert.ok(mail.checklist.items.some((c) => /harb0urcu\.org: Look-alike of your site/.test(c.detail)));
});
