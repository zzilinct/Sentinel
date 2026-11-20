'use strict';
// U24's word-alike note ("telegraph" is spelled near "telegram") is settled by evidence: popularity and registration
// age lift it, a new name asking for a password raises it, and a page that calls itself the brand while asking for a
// password or code turns P01 and P02. Rules are run directly on a built context, so each signal is tested alone.
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { analyze, brandInfo, isWellKnown } = require('../server/lib/scan/url');
const { ALL_CHECKS } = require('../server/lib/scan/checklist');
const content = require('../server/lib/scan/content');

const DAY = 86400000;
const popular = new Set(fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'scan', 'wellknown.txt'), 'utf8').split(/\r?\n/));
const rule = (id) => ALL_CHECKS.find((c) => c.id === id);

function ctx(host, { ageDays = null, html = null } = {}) {
  const p = analyze(`https://${host}/`);
  const registration = ageDays === null ? { available: false } : { available: true, registered: true, createdAt: Date.now() - ageDays * DAY };
  const page = html === null ? null : content.parse(html, `https://${host}/`);
  return {
    p,
    brand: brandInfo(p),
    hint: null,
    knowledge: { wellKnown: isWellKnown(p, popular) },
    research: ageDays === null && html === null ? null : { registration, http: page ? { ok: true, page } : { ok: false } }
  };
}
const run = (id, c) => rule(id).run(c);

const SIGN_IN = (h1) => `<html><head><title>Welcome</title></head><body><h1>${h1}</h1><form><input name="u"><input type="password" name="p"></form></body></html>`;
const NO_FORM = (h1) => `<html><head><title>Welcome</title></head><body><h1>${h1}</h1><p>News and stories.</p></body></html>`;

test('the fixtures are word-alike names, not look-alikes', () => {
  for (const h of ['telegraph.co.uk', 'telegraph-news.net', 'paypals-shop.com']) {
    const b = brandInfo(analyze(`https://${h}/`));
    assert.equal(b.lookalike, null, h);
    assert.ok(b.wordLike, h);
  }
});

test('U24: a site on the popular list passes', () => {
  assert.equal(run('U24', ctx('telegraph.co.uk')).status, 'pass');
});

test('U24: a name registered years ago passes; unknown or recent age keeps the 12-point note', () => {
  assert.equal(run('U24', ctx('telegraph-news.net', { ageDays: 9 * 365 })).status, 'pass');
  for (const c of [ctx('telegraph-news.net'), ctx('telegraph-news.net', { ageDays: 400 }), ctx('telegraph-news.net', { ageDays: 30 })]) {
    const r = run('U24', c);
    assert.equal(r.status, 'warn');
    assert.equal(r.points, 12);
  }
});

test('U24: a new name alone, or a login form alone, changes nothing; together they are read as a look-alike', () => {
  assert.equal(run('U24', ctx('telegraph-news.net', { ageDays: 30, html: NO_FORM('Daily news') })).points, 12, 'new, no form');
  assert.equal(run('U24', ctx('telegraph-news.net', { html: SIGN_IN('Members') })).points, 12, 'form, unknown age');
  assert.equal(run('U24', ctx('telegraph-news.net', { ageDays: 400, html: SIGN_IN('Members') })).points, 12, 'form, older than new');
  const both = run('U24', ctx('telegraph-news.net', { ageDays: 30, html: SIGN_IN('Members') }));
  assert.equal(both.status, 'fail');
  assert.equal(both.points, 36);
  // A page that was not fetched never lifts or raises it.
  assert.equal(run('U24', ctx('telegraph-news.net', { ageDays: 30 })).points, 12);
});

test('P01 and P02: a heading that claims the brand, with a password field, fails', () => {
  const c = ctx('telegraph-news.net', { html: SIGN_IN('Telegram Web') });
  assert.equal(run('P01', c).status, 'fail');
  assert.equal(run('P01', c).points, 40);
  assert.equal(run('P02', c).status, 'fail');
});

test('P01: a logo or site name claiming the brand counts, and so does a sign-in code box', () => {
  const code = '<html><head><title>Welcome</title><meta property="og:site_name" content="Telegram"></head><body><input name="otp_code"></body></html>';
  assert.equal(run('P01', ctx('telegraph-news.net', { html: code })).status, 'fail');
  const logo = '<html><body><img src="/a.png" alt="Telegram logo"><form><input type="password"></form></body></html>';
  assert.equal(run('P01', ctx('telegraph-news.net', { html: logo })).status, 'fail');
});

test('the same claim without a form keeps only the note', () => {
  const c = ctx('telegraph-news.net', { html: NO_FORM('Telegram Web') });
  assert.equal(run('P01', c).status, 'pass');
  assert.equal(run('P02', c).status, 'pass');
  assert.equal(run('U24', c).points, 12);
});

test('a shop with a "Pay with PayPal" button and a sign-in form stays clean', () => {
  const shop = '<html><head><title>Party Supplies</title></head><body><h1>Pay with PayPal</h1><img alt="Pay with PayPal logo" src="/pp.png"><form><input name="email"><input type="password"></form></body></html>';
  const c = ctx('paypals-shop.com', { html: shop });
  assert.deepEqual(c.research.http.page.claims.filter((s) => s.includes('paypal')), []);
  assert.equal(run('P01', c).status, 'pass');
  assert.equal(run('P02', c).status, 'pass');
});

test('claims are capped at 120 characters each, four at most', () => {
  const long = 'x'.repeat(5000);
  const pg = content.parse(`<html><head><title>${long}</title><meta property="og:site_name" content="${long}"></head><body><h1>${long}</h1><img alt="logo ${long}"></body></html>`, 'https://a.com/');
  assert.equal(pg.claims.length, 4);
  for (const c of pg.claims) assert.ok(c.length <= 120);
});
