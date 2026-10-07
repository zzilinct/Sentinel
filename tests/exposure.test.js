'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { db } = require('../server/lib/db');
const feeds = require('../server/lib/scan/feeds');
const exposure = require('../server/lib/scan/exposure');

const DAY = 24 * 60 * 60 * 1000;
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const feed = (id, as) => ({ ...feeds.FEEDS.find((f) => f.id === id), id: as });

let n = 0;
function newUser() {
  const id = `usr_${String(++n).padStart(24, '0')}`;
  db.prepare('INSERT INTO users (id, email, first_name, created_at) VALUES (?, ?, ?, ?)').run(id, `exposure${n}@example.com`, 'Test', Date.now());
  return id;
}
const hosts = (user) => exposure.list(user).map((e) => e.host).sort();

test('nothing is hashed or matched while nobody has a visit to check', async () => {
  assert.equal(exposure.watching(), false);
  const r = await feeds.importLines(feed('phishing_database', 'exp_idle'), ['idle-listing.example']);
  assert.equal(r.exposed, 0);
});

test('a site visited while it was clean, listed afterwards, is an exposure with steps for what it was', async () => {
  const user = newUser();
  assert.ok(exposure.remember(user, 'https://paypal-account-review.example/signin?case=123'));
  assert.ok(exposure.remember(user, 'https://www.harmless-recipes.example/soup'));
  const stored = JSON.stringify(db.prepare('SELECT * FROM visit_marks WHERE user_id = ?').all(user));
  assert.doesNotMatch(stored, /paypal|recipes|signin|case=123/, 'neither the address nor the host is stored in readable form');

  const r = await feeds.importLines(feed('phishing_database', 'exp_hosts'), ['paypal-account-review.example', 'someone-elses-scam.example']);
  assert.equal(r.exposed, 1);
  const [e] = exposure.list(user);
  assert.equal(e.host, 'paypal-account-review.example');
  assert.equal(e.kind, 'phishing');
  assert.equal(e.realSite, 'paypal.com', 'the real site of the brand it copied, safe to open');
  assert.equal(e.visitedAt % DAY, 0, 'the day of the visit, never the time');
  assert.equal(e.notified, false);

  // Listed again by another list: still one exposure.
  await feeds.importLines(feed('certpl', 'exp_hosts_2'), ['paypal-account-review.example']);
  assert.deepEqual(hosts(user), ['paypal-account-review.example']);
});

test('a whole listed domain matches a visit to any of its subdomains; a listed subdomain matches only itself', async () => {
  const user = newUser();
  exposure.remember(user, 'https://login.whole-domain-scam.example/');
  exposure.remember(user, 'https://www.only-one-sub.example/');
  await feeds.importLines(feed('phishing_database', 'exp_sub'), ['whole-domain-scam.example', 'other.only-one-sub.example']);
  assert.deepEqual(hosts(user), ['whole-domain-scam.example']);
});

test('an exact address on a URL list counts only when it is the site itself, and malware gets its own steps', async () => {
  const user = newUser();
  exposure.remember(user, 'http://payload-drop.example/');
  exposure.remember(user, 'https://big-honest-forum.example/thread/9');
  await feeds.importLines(feed('urlhaus', 'exp_urls'), ['http://payload-drop.example/', 'https://big-honest-forum.example/uploads/bad.zip']);
  const list = exposure.list(user);
  assert.deepEqual(list.map((e) => e.host), ['payload-drop.example'], 'one bad file on a big site does not condemn the site');
  assert.equal(list[0].kind, 'malware');
  assert.equal(list[0].realSite, null);
});

test('pages on shared platforms are never remembered, so never matched', async () => {
  const user = newUser();
  assert.equal(exposure.remember(user, 'https://sites.google.com/view/team-picnic'), false);
  assert.equal(exposure.remember(user, 'https://bake-sale.netlify.app/'), false);
  await feeds.importLines(feed('phishing_database', 'exp_shared'), ['bake-sale.netlify.app']);
  assert.deepEqual(hosts(user), []);
});

test('only visits from the last 14 days count, and only that account is told', async () => {
  const user = newUser();
  const other = newUser();
  exposure.remember(user, 'https://long-ago-visit.example/', Date.now() - 20 * DAY);
  exposure.remember(user, 'https://recent-visit.example/', Date.now() - 3 * DAY);
  await feeds.importLines(feed('phishing_database', 'exp_window'), ['long-ago-visit.example', 'recent-visit.example']);
  assert.deepEqual(hosts(user), ['recent-visit.example']);
  assert.deepEqual(hosts(other), []);
});

test('told once, dismissed for good, and switching off erases every remembered visit', async () => {
  const user = newUser();
  exposure.remember(user, 'https://told-once.example/');
  exposure.remember(user, 'https://never-listed.example/');
  await feeds.importLines(feed('scamblocklist', 'exp_tell'), ['told-once.example']);
  assert.equal(exposure.list(user)[0].kind, 'scam');
  assert.equal(exposure.markNotified(user, ['told-once.example']), 1);
  assert.equal(exposure.list(user)[0].notified, true);
  assert.equal(exposure.dismiss(user, 'told-once.example'), true);
  assert.deepEqual(hosts(user), []);
  assert.equal(exposure.forget(user), 2);
  await feeds.importLines(feed('phishing_database', 'exp_after'), ['never-listed.example']);
  assert.deepEqual(hosts(user), [], 'nothing left to match');
});

test('switching off erases the alerts already found too, since they name the sites in plain words', async () => {
  const user = newUser();
  exposure.remember(user, 'https://found-then-forgotten.example/');
  await feeds.importLines(feed('phishing_database', 'exp_forget_found'), ['found-then-forgotten.example']);
  assert.deepEqual(hosts(user), ['found-then-forgotten.example']);
  exposure.forget(user);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM exposures WHERE user_id = ?').get(user).c, 0);
});

test('the day kept is the visit\'s own calendar day where the person was', async () => {
  const user = newUser();
  // Tuesday 6 October 2026, 9 pm in New York (UTC-4) is already Wednesday in UTC.
  const at = Date.UTC(2026, 9, 7, 1, 0);
  exposure.remember(user, 'https://evening-visit.example/', at, 240);
  exposure.remember(user, 'https://morning-in-sydney.example/', Date.UTC(2026, 9, 6, 20, 0), -600);
  const days = db.prepare('SELECT day FROM visit_marks WHERE user_id = ? ORDER BY day').all(user).map((r) => new Date(r.day).toISOString().slice(0, 10));
  assert.deepEqual(days, ['2026-10-06', '2026-10-07']);
  // A visit marked with a day ahead of UTC still matches a listing made the same moment.
  const kiribati = newUser();
  exposure.remember(kiribati, 'https://ahead-of-utc.example/', Date.now(), -14 * 60);
  await feeds.importLines(feed('phishing_database', 'exp_ahead'), ['ahead-of-utc.example']);
  assert.deepEqual(hosts(kiribati), ['ahead-of-utc.example']);
});

test('turning exposure alerts off waits for the erasing, and retries it at start until it goes through', () => {
  const m = read('desktop/src/main.js');
  assert.match(m, /store\.set\('exposureForgetPending', true\);\s*return forgetExposures\(\)/);
  assert.match(m, /else forgetExposures\(\)/, 'tried again at start');
  assert.match(read('desktop/src/watch.js'), /remember: true, tz: new Date\(\)\.getTimezoneOffset\(\)/);
});

test('the hourly sweep keeps visits 14 days and exposures 30', () => {
  const user = newUser();
  db.prepare('INSERT INTO visit_marks (user_id, host_hash, reg_hash, day) VALUES (?, ?, ?, ?)').run(user, 'old', 'old', Date.now() - 15 * DAY);
  db.prepare('INSERT INTO exposures (user_id, host, threat, visited_day, listed_at) VALUES (?, ?, ?, ?, ?)').run(user, 'old.example', 'scam', Date.now() - 40 * DAY, Date.now() - 31 * DAY);
  require('../server/lib/db').sweep();
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM visit_marks WHERE user_id = ?').get(user).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM exposures WHERE user_id = ?').get(user).c, 0);
});

test('private windows are never remembered, and only when the person switched exposure alerts on', () => {
  const w = read('desktop/src/watch.js');
  assert.match(w, /const remember = !page\.private && Boolean\(opts\.remember && opts\.remember\(\)\);/);
  const r = read('server/routes/scan.routes.js');
  assert.match(r, /body\.remember === true && body\.private !== true && badge !== 'red' && badge !== 'orange'/);
  const m = read('desktop/src/main.js');
  assert.match(m, /remember: \(\) => store\.get\('exposureAlerts', false\)/, 'off until turned on');
  assert.match(m, /apiCall\('\/api\/v1\/live\/exposures\/forget', \{\}\)/, 'turning it off erases the marks');
  assert.match(read('web/privacy.html'), /Exposure alerts in the Windows app/);
});
