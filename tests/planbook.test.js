'use strict';
// The pricing comparison (web/assets/js/planbook.js): every figure comes from the server's plans, each is said once,
// and nothing is offered that cannot be had.
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const planbook = require('../web/assets/js/planbook');
const plans = require('../server/lib/plans');

const ROOT = path.join(__dirname, '..');
const text = (html) => html.replace(/<small>.*?<\/small>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The cells of the row with this label, as { planId: words }. */
function row(html, label) {
  const m = new RegExp(`<tr role="row"[^>]*><th role="rowheader" scope="row">${label}(?:<small>.*?</small>)?</th>(.*?)</tr>`, 's').exec(html);
  assert.ok(m, `no row ${label}`);
  return Object.fromEntries([...m[1].matchAll(/data-col="(\w+)"[^>]*>(.*?)<\/td>/gs)].map(([, id, inner]) => [id, text(inner)]));
}

const count = (n) => (n === null ? 'Unlimited' : n === 0 ? 'No' : n.toLocaleString('en-US'));
const span = (m) => (m === null ? 'Unlimited' : m === 0 ? 'No' : m < 60 ? `${m} minutes` : `${m / 60} hours`);
const expected = {
  'Fast link scans': (p) => count(p.limits.linkScans),
  'Delicate link scans': (p) => count(p.limits.deepScans),
  'Virus and malware scans': (p) => count(p.limits.fileScans),
  'Fast live scanning': (p) => span(p.limits.fastMinutes),
  'Delicate live scanning': (p) => span(p.limits.liveMinutes),
  'Whole emails pasted in': (p) => (p.features.emailManual ? 'Yes' : 'No'),
  'Marks in Gmail and Outlook': (p) => (p.features.emailLive ? 'Yes' : 'No'),
  'Download protection': (p) => (p.features.liveScanning ? 'Yes' : 'No')
};

function assertMatches(list, html) {
  for (const [label, want] of Object.entries(expected)) {
    const cells = row(html, label);
    for (const p of list) assert.equal(cells[p.id], want(p), `${label}, ${p.name}`);
  }
}

test('every allowance on the page is the server\'s, for every plan', () => {
  assertMatches(plans.publicPlans(), planbook.ledger(plans.publicPlans(), { billingMode: 'disabled' }));
});

test('the page follows a change of limit, because none is typed', () => {
  const changed = structuredClone(plans.publicPlans());
  changed[1].limits.fastMinutes = 30 * 60;
  changed[0].limits.linkScans = 12;
  changed[2].features.emailManual = false;
  const html = planbook.ledger(changed, { billingMode: 'disabled' });
  assertMatches(changed, html);
  assert.equal(row(html, 'Fast live scanning').pro, '30 hours');
  assert.match(planbook.lead(changed), /12 link scans/);
  assert.equal(planbook.finderPlans(changed, 'disabled')[1].fast, 1800);
});

test('one set of numbers: Pro\'s newest-model limits are one plain share, not a second list', () => {
  const list = plans.publicPlans();
  const html = planbook.ledger(list, { billingMode: 'disabled' });
  const pro = list.find((p) => p.id === 'pro');
  const lowest = Math.min(...Object.keys(pro.limits).map((k) => pro.newestModelLimits[k] / pro.limits[k]));
  const cells = row(html, 'Newest models');
  assert.equal(cells.pro, `${Math.round(lowest * 100)}% on the newest 3`);
  assert.equal(cells.free, 'Older than the newest 5');
  assert.equal(cells.max, 'All, in full');
  assert.doesNotMatch(text(html), /18 hours|\b150\b/);
});

test('while billing is off nothing is sold: one way in, the free one', () => {
  const html = planbook.ledger(plans.publicPlans(), { billingMode: 'disabled' });
  const take = row(html, 'Can I have it today\\?');
  assert.deepEqual(take, { free: 'Start free', pro: 'Not on sale yet', max: 'Not on sale yet', ultimate: 'Not on sale yet' });
  assert.deepEqual([...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]).sort(), ['/download', '/refunds', '/signup']);
  assert.doesNotMatch(html, /\b(Get|Buy|Upgrade|Try) (Pro|Max|Ultimate)|plan=/);
  assert.match(text(html), /not on sale yet, and nobody is charged/);
});

test('the finder says a plan is not on sale, and comes back to Free', () => {
  const [free, pro] = planbook.finderPlans(plans.publicPlans(), 'disabled');
  assert.equal(free.sale, false);
  assert.equal(pro.sale, false);
  assert.ok(pro.says.includes('24 hours'));
  assert.ok(free.says.includes('15 minutes'));
});

test('signed in: your plan is marked, and only the Windows app\'s demo billing offers a switch', () => {
  const list = plans.publicPlans();
  const off = planbook.ledger(list, { billingMode: 'disabled', current: list[1] });
  assert.deepEqual(row(off, 'Can I have it today\\?'), { free: 'Always free', pro: 'Your plan', max: 'Not on sale yet', ultimate: 'Not on sale yet' });
  assert.doesNotMatch(off, /<button/);
  assert.doesNotMatch(off, /data-finder/);
  const demo = planbook.ledger(list, { billingMode: 'demo', current: list[1] });
  assert.deepEqual(row(demo, 'Can I have it today\\?'), { free: 'Switch', pro: 'Your plan', max: 'Upgrade', ultimate: 'Upgrade' });
  assert.match(demo, /data-pick="pro" style="--pick:1"/);
});

test('the words the page leaves to other files still agree with the plans', () => {
  // Sentences in the app, the companion and the home page that cannot be built from the data: a new limit fails here.
  const free = plans.publicPlans()[0].limits.fastMinutes;
  for (const f of ['web/index.html', 'web/guest.html', 'web/download.html', 'web/assets/js/app.js', 'extension/src/popup.js']) {
    assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), new RegExp(`${free} minutes`), f);
  }
});

test('the pages that show plans carry no typed allowance of their own', () => {
  const page = fs.readFileSync(path.join(ROOT, 'web/pricing.html'), 'utf8');
  assert.match(page, /@include pricing-lead/);
  assert.match(page, /@include pricing -->/);
  assert.doesNotMatch(page, /<table|\b\d+ (minutes|hours)\b/);
  assert.ok(!fs.existsSync(path.join(ROOT, 'web/partials/pricing.html')), 'the old cards are gone');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'web/assets/js/site.js'), 'utf8'), /\b24 hours|Best for you/);
});
