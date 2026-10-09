'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db } = require('../server/lib/db');
const plans = require('../server/lib/plans');
const week = require('../server/lib/week');
const { client, startApp } = require('./fixtures');

const WEEK = 7 * 24 * 60 * 60 * 1000;
let n = 0;
function newUser() {
  const id = `usr_week${String(++n).padStart(20, '0')}`;
  db.prepare('INSERT INTO users (id, email, first_name, created_at) VALUES (?, ?, ?, ?)').run(id, `week${n}@example.com`, 'Test', Date.now());
  return id;
}
const last = (s) => s.weeks[s.weeks.length - 1];

test('counts land in the week they happened, four weeks are shown, oldest first', () => {
  const id = newUser();
  const t = Date.now();
  week.bump(id, 'live_links', 40, t);
  week.bump(id, 'live_links', 2, t);
  week.bump(id, 'live_flagged', 1, t - WEEK);
  week.bump(id, 'files_checked', 7, t - 3 * WEEK);
  week.bump(id, 'files_checked', 99, t - 4 * WEEK);   // five weeks ago: not shown
  const s = week.summary(id, t);
  assert.equal(s.weeks.length, 4);
  assert.deepEqual(s.weeks.map((w) => w.startsAt), [3, 2, 1, 0].map((k) => plans.weekStart(t) - k * WEEK));
  assert.equal(last(s).counts.live_links, 42);
  assert.equal(last(s).checked, 42);
  assert.equal(last(s).caught, 0);
  assert.equal(s.weeks[2].counts.live_flagged, 1);
  assert.equal(s.weeks[2].caught, 1);
  assert.equal(s.weeks[0].counts.files_checked, 7);
  assert.equal(s.weeks.reduce((a, w) => a + w.counts.files_checked, 0), 7, 'nothing older than four weeks');
});

test('only known counters, and only whole positive numbers, are kept', () => {
  const id = newUser();
  for (const [m, k] of [['passwords', 5], ['live_links', 0], ['live_links', -3], ['live_links', NaN], ['__proto__', 1]]) week.bump(id, m, k);
  const s = week.summary(id);
  assert.equal(last(s).checked, 0);
  assert.equal(last(s).caught, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage_counters WHERE user_id = ?').get(id).n, 0);
  assert.equal(last(s).headline, 'Nothing to report yet this week');
  assert.equal(last(s).biggest, null);
  assert.equal(s.weeks[2].headline, 'Nothing to report last week');
});

test('manual scans come from the weekly allowances, flagged results from the history, exposures from their alerts', () => {
  const id = newUser();
  const t = Date.now();
  const ws = plans.weekStart(t);
  const allow = db.prepare('INSERT INTO usage_counters (user_id, week, metric, used) VALUES (?, ?, ?, ?)');
  allow.run(id, ws, 'link_scans', 5);
  allow.run(id, ws, 'deep_scans', 2);
  allow.run(id, ws, 'file_scans', 1);
  const hist = db.prepare('INSERT INTO scan_history (user_id, kind, target, mode, scam, virus, malware, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  hist.run(id, 'url', 'https://a.example/', 'manual', 'confirmed', null, null, ws + 1000);
  hist.run(id, 'file', 'x.exe', 'manual', null, 'safe', 'likely', ws + 2000);
  hist.run(id, 'url', 'https://b.example/', 'manual', 'safe', null, null, ws + 3000);          // clean: not caught
  hist.run(id, 'url', 'https://c.example/', 'live', 'confirmed', null, null, ws + 4000);      // live: counted by live_flagged
  hist.run(id, 'url', 'https://d.example/', 'manual', 'confirmed', null, null, ws - 1000);    // the week before
  db.prepare('INSERT INTO exposures (user_id, host, threat, visited_day, listed_at) VALUES (?, ?, ?, ?, ?)').run(id, 'e.example', 'scam', ws, ws + 5000);
  const w = last(week.summary(id, t));
  assert.equal(w.counts.manual_scans, 8);
  assert.equal(w.counts.manual_flagged, 2);
  assert.equal(w.counts.exposures, 1);
  assert.equal(w.caught, 3);
  assert.equal(w.checked, 8);
  assert.equal(w.headline, 'Sentinel caught 3 things this week');
});

test('what the Windows app saw adds up; a look-alike is not counted twice', () => {
  const id = newUser();
  week.bump(id, 'files_checked', 120);
  week.bump(id, 'files_quarantined', 1);
  week.bump(id, 'commands_stopped', 2);
  week.bump(id, 'chat_checked', 300);
  week.bump(id, 'chat_flagged', 1);
  week.bump(id, 'live_links', 80);
  week.bump(id, 'live_flagged', 2);
  week.bump(id, 'lookalikes', 1);   // one of the two flagged pages
  const w = last(week.summary(id));
  assert.equal(w.checked, 120 + 300 + 80);
  assert.equal(w.caught, 1 + 2 + 1 + 2);
  assert.equal(w.headline, 'Sentinel caught 6 things this week');
});

test('the biggest catch is the most serious one, in plain words', () => {
  const zero = { wallet_swaps: 0, files_quarantined: 0, commands_stopped: 0, lookalikes: 0, exposures: 0, live_flagged: 0, manual_flagged: 0, chat_flagged: 0 };
  const b = (c) => week.biggest({ ...zero, ...c });
  assert.equal(b({}), null);
  assert.match(b({ chat_flagged: 3, wallet_swaps: 1 }), /^Something on this PC swapped a wallet address you copied/);
  assert.match(b({ files_quarantined: 2, commands_stopped: 1 }), /^Sentinel moved 2 dangerous files into quarantine\.$/);
  assert.match(b({ commands_stopped: 1, live_flagged: 5 }), /stopped a risky command you copied before it/);
  assert.match(b({ lookalikes: 1, live_flagged: 1 }), /a fake copy of a site you use/);
  assert.match(b({ exposures: 2, live_flagged: 1 }), /^2 sites you visited were put on a threat list/);
  assert.match(b({ live_flagged: 1 }), /about a dangerous page while you browsed/);
  assert.match(b({ manual_flagged: 1 }), /^One thing you asked Sentinel to check/);
  assert.match(b({ chat_flagged: 4 }), /4 chat messages that did not look safe/);
  for (const c of [{ wallet_swaps: 2 }, { live_flagged: 9 }, { manual_flagged: 3 }]) assert.doesNotMatch(b(c), /—/, 'no em dashes');
});

test('a quiet week says so, and only what is true', () => {
  const id = newUser();
  week.bump(id, 'live_links', 214);
  const w = last(week.summary(id));
  assert.equal(w.headline, 'Nothing dangerous this week');
  assert.equal(w.biggest, null);
});

/* ------------------------------------------------------------- over HTTP */

let app;
test.before(async () => { app = await startApp(); });
test.after(() => app.server.close());

async function signedIn() {
  const c = client(app.base);
  const email = `weekhttp${++n}_${Date.now()}@example.com`;
  assert.equal((await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Test', ageConfirmed: true, termsAccepted: true })).status, 201);
  assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);
  return c;
}

test('live scanning, a manual scan and the Windows app all reach the week, private windows never', async () => {
  const c = await signedIn();
  const bad = 'https://paypa1-secure-login.com/';
  const batch = await c.post('/api/v1/live/batch', { urls: [bad, 'https://github.com/'], mode: 'fast' });
  assert.equal(batch.status, 200, JSON.stringify(batch.data));
  assert.equal((await c.post('/api/v1/live/batch', { urls: [bad], mode: 'fast', quick: true })).status, 200);
  assert.equal((await c.post('/api/v1/live/batch', { urls: [bad, 'https://example.org/'], mode: 'fast', private: true })).status, 200);
  assert.equal((await c.post('/api/v1/live/visit', { url: bad, mode: 'fast' })).status, 200);
  assert.equal((await c.post('/api/v1/live/visit', { url: bad, mode: 'fast', private: true })).status, 200);
  assert.equal((await c.post('/api/v1/scan/link', { url: bad, mode: 'fast' })).status, 200);

  const added = await c.post('/api/v1/week/count', { counts: { files_checked: 12, wallet_swaps: 1, commands_stopped: 2.5, live_links: 1000, passwords: 4, chat_flagged: -1 } });
  assert.equal(added.status, 200, JSON.stringify(added.data));
  assert.equal(added.data.added, 2, 'only whole counts of what the app sees are taken');

  const r = await c.get('/api/v1/week');
  assert.equal(r.status, 200);
  const w = last(r.data);
  assert.equal(w.counts.live_links, 3, 'two results and one page; the quick pass and private windows are not counted');
  assert.equal(w.counts.live_flagged, 2);
  assert.equal(w.counts.manual_scans, 1);
  assert.equal(w.counts.manual_flagged, 1);
  assert.equal(w.counts.files_checked, 12);
  assert.equal(w.counts.wallet_swaps, 1);
  assert.equal(w.counts.commands_stopped, 0);
  assert.equal(w.caught, 2 + 1 + 1);
  assert.equal(w.headline, 'Sentinel caught 4 things this week');
  assert.match(w.biggest, /wallet address/);
  assert.ok(!JSON.stringify(r.data).includes('paypa1'), 'the week holds numbers, never an address');
});

test('the week is private to its account', async () => {
  const anon = client(app.base);
  assert.equal((await anon.get('/api/v1/week')).status, 401);
  assert.equal((await anon.post('/api/v1/week/count', { counts: { files_checked: 1 } })).status, 401);
});
