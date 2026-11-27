'use strict';
// 1.22.0: the accuracy gate. Rules alone (no list loaded) on the frozen phishing sample and on every honest set, held to
// scripts/evaluate-baseline.json. List hits never gate. Text only: nothing is opened.
const os = require('os');
const path = require('path');
process.env.DB_PATH = path.join(os.tmpdir(), `sentinel-gate-test-${process.pid}.db`);
Object.assign(process.env, { FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', RESEARCH_LITE: '1', NODE_ENV: 'test' });
const test = require('node:test');
const assert = require('node:assert/strict');
require('../server/seed').run({ quiet: true });
const engine = require('../server/lib/scan/engine');
const gate = require('../scripts/evaluate-gate');

test('rules alone hold the baseline: no fewer catches in any class, no new false alarm on an honest set', async () => {
  const now = gate.summarize(await gate.scoreAll(engine));
  assert.deepEqual(gate.compare(now, gate.baseline()), [], gate.print(now));
});

test('the gate goes red on a drop in catches, on a new false alarm, and on a stale known one', () => {
  const base = gate.baseline();
  const same = JSON.parse(JSON.stringify(base));
  assert.deepEqual(gate.compare(same, base), []);
  const fewer = JSON.parse(JSON.stringify(base));
  fewer.flagged -= 1; fewer.byClass['free host'].flagged -= 1;
  assert.equal(gate.compare(fewer, base).length, 2);
  const fresh = JSON.parse(JSON.stringify(base));
  fresh.honestFalseAlarms.sites.push('https://honest.example/');
  assert.match(gate.compare(fresh, base)[0], /new false alarm/);
  const fixed = JSON.parse(JSON.stringify(base));
  fixed.honestFalseAlarms.freehost.pop();
  assert.match(gate.compare(fixed, base)[0], /fixed, remove from the baseline/);
});

// Honest developer sites on free hosts: a project name, a platform preview. Made-up names in the platforms' own shapes.
const flagged = async (u) => Boolean((await engine.scanUrl(u, { threats: ['scam'], research: false })).overall.badge);

test('a developer project name and a platform preview deployment are not marked', async () => {
  for (const u of ['https://next-auth-example.vercel.app/', 'https://nextjs-postgres-auth.vercel.app/', 'https://docs-starter.pages.dev/',
    'https://dashboard-7f3k2x9qd-acme-team.vercel.app/', 'https://blog-git-feature-dark-mode-janedoe.vercel.app/', 'https://deploy-preview-482--docs-site.netlify.app/']) {
    assert.equal(await flagged(u), false, u);
  }
});

test('the same relief does not reach a lure: a login word or a long random block still marks', async () => {
  for (const u of ['https://secure-login-auth.vercel.app/', 'https://docs-google-login.pages.dev/', 'https://xkqzjwpvtnbmrs-docs.vercel.app/']) {
    assert.equal(await flagged(u), true, u);
  }
});
