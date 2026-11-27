'use strict';
// 1.22.0: the page's own shape, read in the browser for an address already suspect (server/lib/scan/pagefacts.js, checklist X03).
// Only yes-or-no facts and a protected brand's name may reach the scanner. Every page here is a made-up stub.
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.DB_PATH = path.join(os.tmpdir(), `sentinel-pagefacts-${process.pid}.db`);
Object.assign(process.env, { FEED_REFRESH_HOURS: '0', RESEARCH_ENABLED: '0', NODE_ENV: 'test' });
const test = require('node:test');
const assert = require('node:assert/strict');
require('../server/seed').run({ quiet: true });
const engine = require('../server/lib/scan/engine');
const { ALL_CHECKS } = require('../server/lib/scan/checklist');
const { analyze } = require('../server/lib/scan/url');
const facts = require('../server/lib/scan/pagefacts');

const TOKENS = ['paypal', 'onedrive'];
const el = (o = {}) => ({ querySelector: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }), ...o });
const page = ({ title = '', pw = false, forms = [], frames = [], host = 'site.pages.dev' } = {}) => ({
  title, location: { hostname: host, href: `https://${host}/` },
  querySelector: (s) => (pw && /password/.test(s) ? {} : null),
  querySelectorAll: (s) => (s === 'form' ? forms : s === 'iframe' ? frames : [])
});
const form = (action, hasPw = true) => el({ action, querySelector: () => (hasPw ? {} : null) });
const VIEW = { w: 1000, h: 800 };

test('the read gives four facts and nothing else: no title, no text, no field value', () => {
  const r = facts.read(page({ title: 'Sign in to PayPal secure', pw: true, forms: [form('https://elsewhere.example/post')] }), VIEW, TOKENS);
  assert.deepEqual(r, { password: true, crossForm: true, frame: false, brand: 'paypal' });
  assert.deepEqual(Object.keys(r).sort(), ['brand', 'crossForm', 'frame', 'password']);
});

test('an honest page reads as nothing: own form, a title with no protected brand, a small frame', () => {
  const small = el({ getBoundingClientRect: () => ({ width: 300, height: 200 }) });
  const r = facts.read(page({ title: 'Acme dashboard', pw: true, forms: [form('/login'), form('https://sub.site.pages.dev/x'), form('https://other.example/search', false)], frames: [small] }), VIEW, TOKENS);
  assert.deepEqual(r, { password: true, crossForm: false, frame: false, brand: null });
  assert.equal(facts.brandIn('One Drive for school', TOKENS), 'onedrive', 'neighbouring words join');
  assert.equal(facts.brandIn('Paypalish things', TOKENS), null);
});

test('a password form sent to the app\'s own auth host, a related name, or a known sign-in service is not "another site"; a stranger is', () => {
  const sends = (action, host = 'app.acme.co.uk') => facts.read(page({ pw: true, host, forms: [form(action)] }), VIEW, TOKENS).crossForm;
  assert.equal(sends('https://auth.acme.co.uk/session'), false, 'same registrable domain under a country ending');
  assert.equal(sends('https://login.acme.com/x', 'app.acme.com'), false);
  assert.equal(sends('https://accounts.google.com/signin', 'my.pages.dev'), false, 'an identity provider');
  assert.equal(sends('https://tenant.auth0.com/u/login', 'my.pages.dev'), false);
  assert.equal(sends('https://collect.example.net/post', 'app.acme.com'), true);
  assert.equal(sends('https://acme.co.uk.evil.example/p'), true, 'a lookalike tail is another site');
});

test('one window-sized frame is read; two frames, or a small one, are not', () => {
  const big = el({ getBoundingClientRect: () => ({ width: 980, height: 790 }) });
  assert.equal(facts.read(page({ frames: [big] }), VIEW, TOKENS).frame, true);
  assert.equal(facts.read(page({ frames: [big, big] }), VIEW, TOKENS).frame, false);
});

const score = async (url, f) => engine.scanUrl(url, { threats: ['scam'], research: false, hint: f ? { facts: f } : null });
const OFF = { password: false, crossForm: false, frame: false, brand: null };

test('the same free-host address is marked with the page facts and not without them', async () => {
  const url = 'https://my-notes.pages.dev/';
  assert.equal((await score(url)).overall.badge, null);
  assert.equal((await score(url, OFF)).overall.badge, null, 'facts that say nothing change nothing');
  assert.ok((await score(url, { ...OFF, password: true, crossForm: true })).overall.badge, 'a password sent to another site');
  assert.ok((await score(url, { ...OFF, password: true, brand: 'paypal' })).overall.badge, 'a password box under a protected brand title');
  const brandOnly = await score(url, { ...OFF, brand: 'paypal' });
  assert.ok(['yellow', null].includes(brandOnly.overall.badge) && brandOnly.overall.badge !== 'orange', 'a title alone is never orange');
});

test('an honest sign-in on a free host passes: its own form, its own name, no protected brand', async () => {
  assert.equal((await score('https://acme-app.vercel.app/', { ...OFF, password: true })).overall.badge, null);
});

test('the brand\'s own site is not marked for saying its own name', () => {
  const x03 = ALL_CHECKS.find((c) => c.id === 'X03');
  const hint = { facts: { ...OFF, password: true, brand: 'paypal' } };
  assert.equal(x03.run({ p: analyze('https://www.paypal.com/signin'), hint }).status, 'pass');
  assert.equal(x03.run({ p: analyze('https://paypal.example.pages.dev/'), hint }).status, 'fail');
  assert.equal(x03.run({ p: analyze('https://x.pages.dev/'), hint: null }).status, 'skip', 'no page read: skipped');
});

test('the scanner takes only booleans and a protected brand: anything else sent is dropped', async () => {
  const dirty = { password: 'yes', crossForm: 1, frame: true, brand: 'not-a-brand', title: 'Sign in', text: 'secret', value: 'hunter2' };
  // Through the same cleaning the route and engine use: an unknown brand is null, a non-true flag is false.
  const v = await engine.scanUrl('https://my-notes.pages.dev/', { threats: ['scam'], research: false, hint: { facts: dirty } });
  const x03 = v.checklist.items.find((c) => c.id === 'X03');
  assert.match(x03.detail, /window-sized frame/, 'only the frame, a real true, counted: "yes" and 1 are not passwords');
  assert.doesNotMatch(JSON.stringify(v), /hunter2|secret|not-a-brand/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'scan.routes.js'), 'utf8'), /facts: h\.facts/);
});

test('the companion\'s copy is the server\'s file, and its brand names are the protected ones of five letters or more', () => {
  const ext = path.join(__dirname, '..', 'extension', 'src', 'content');
  assert.equal(fs.readFileSync(path.join(ext, 'pagefacts.js'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'scan', 'pagefacts.js'), 'utf8'));
  const tokens = require('vm').runInNewContext(`${fs.readFileSync(path.join(ext, 'brandtokens.js'), 'utf8')};SentinelBrandTokens`, {});
  assert.deepEqual([...tokens], require('../server/lib/scan/brands').BRANDS.map((b) => b.token).filter((t) => t.length >= 5));
});
