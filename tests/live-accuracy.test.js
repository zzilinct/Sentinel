'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.join(__dirname, '..');
const pageUrl = 'https://www.bing.com/search?q=wallet';
const url = 'https://ordinary-example.com/login';
const verdict = (badge = null, extra = {}) => ({ ok: true, overall: { badge, label: badge ? 'Likely scam' : 'No scam signs' }, threats: {}, reasons: [], ...extra });

function desktop(api, mode = 'fast') {
  let now = 1000000;
  const timers = new Map();
  const file = path.join(ROOT, 'desktop/src/watch.js');
  const ctx = vm.createContext({ require: createRequire(file), module: { exports: {} }, process, Buffer, URL,
    Date: class extends Date { static now() { return now; } },
    setTimeout(fn, ms) { const id = {}; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); } });
  vm.runInContext(fs.readFileSync(file, 'utf8') + `
    this.driver = { onLinks, check, markFor, resultKey, stop,
      setup(options) { opts = options; child = { kill() {} }; state.current = { at: 1 }; state.window = { private: false }; },
      navigate() { state.current = { at: 2 }; latestLinks = null; },
      cached() { return [...verdicts.values()]; }, pendingCount() { return pending.size; }
    };`, ctx);
  const marks = [];
  const threats = [];
  ctx.driver.setup({ api, mode: () => mode, onMarks: m => marks.push(m), onThreat: t => threats.push(t) });
  return { ...ctx.driver, marks, threats, timers, advance(ms) { now += ms; },
    links(title = 'Ordinary result') { return ctx.driver.onLinks({ for: pageUrl, links: [{ u: url, n: title, x: 10, y: 100, w: 300, h: 26 }] }); } };
}

test('live scan errors remain pending and are retried instead of marked clean', async () => {
  let calls = 0;
  const d = desktop(async () => ({ byUrl: { [url]: ++calls === 1 ? { ok: false, error: 'scan_failed' } : verdict() }, mode: 'fast' }));
  await d.links();
  assert.equal(d.cached().length, 0);
  assert.equal(d.marks.at(-1).marks[0].pending, true);
  assert.equal(d.timers.size, 1);
  d.advance(5000);
  await [...d.timers.values()][0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(d.marks.at(-1).marks[0].pending, undefined);
});

test('changing a search result title rescans the same URL', async () => {
  const titles = [];
  const d = desktop(async (_, body) => {
    titles.push(body.hints[url].title);
    return { byUrl: { [url]: verdict(titles.length === 1 ? null : 'orange') }, mode: 'fast' };
  });
  await d.links('Ordinary result');
  await d.links('Ordinary result');
  assert.equal(titles.length, 1, 'scrolling reuses a verdict');
  await d.links('Microsoft account sign in');
  assert.equal(titles.length, 2);
  assert.equal(d.marks.at(-1).marks[0].badge, 'orange');
});

test('failed delicate follow-up expires its provisional answer and retries', async () => {
  let calls = 0;
  const d = desktop(async (_, body) => {
    calls++;
    if (!body.quick && calls === 2) throw new Error('network outage');
    return { byUrl: { [url]: verdict(body.quick ? null : 'orange', { researchComplete: true }) }, mode: 'delicate' };
  }, 'delicate');
  await d.links();
  assert.equal(calls, 2);
  assert.equal(d.timers.size, 1);
  d.advance(5000);
  await [...d.timers.values()][0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 4);
  assert.equal(d.marks.at(-1).marks[0].badge, 'orange');
});

test('incomplete research is retried instead of retained for the verdict TTL', async () => {
  const d = desktop(async () => ({ byUrl: { [url]: verdict(null, { researchComplete: false }) }, mode: 'delicate' }), 'delicate');
  await d.links();
  assert.ok([...d.timers.values()].some(t => t.ms > 1500));
  d.advance(5000);
  assert.equal(d.markFor(d.resultKey({ u: url, title: 'Ordinary result' }, pageUrl, false)), null);
});

test('late result answers after navigation or stop cannot repopulate marks', async () => {
  for (const action of ['navigate', 'stop']) {
    let resolve;
    const d = desktop(() => new Promise(r => { resolve = r; }));
    const checking = d.links();
    d[action]();
    resolve({ byUrl: { [url]: verdict('orange') }, mode: 'fast' });
    await checking;
    assert.equal(d.cached().length, 0, action);
    assert.equal(d.pendingCount(), 0);
  }
});

test('a late visited-page answer cannot warn about a page that was left', async () => {
  let resolve;
  const d = desktop(() => new Promise(r => { resolve = r; }));
  const checking = d.check({ url, at: 1, private: false });
  d.navigate();
  resolve({ verdict: verdict('orange'), mode: 'fast' });
  await checking;
  assert.equal(d.threats.length, 0);
});

test('a visited-page scan that failed is retried while that page remains in front', async () => {
  let calls = 0;
  const d = desktop(async () => {
    if (++calls === 1) throw new Error('temporary outage');
    return { verdict: verdict('orange'), mode: 'fast' };
  });
  await d.check({ url, at: 1, private: false });
  assert.equal(d.threats.length, 0);
  assert.equal(d.timers.size, 1);
  await [...d.timers.values()][0].fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(d.threats.length, 1);
});

function companionUrls() {
  const src = fs.readFileSync(path.join(ROOT, 'extension/src/content/serp.js'), 'utf8');
  const ctx = vm.createContext({ URL, TextDecoder, atob: s => Buffer.from(s, 'base64').toString('latin1'),
    location: { href: pageUrl, hostname: 'www.bing.com' },
    SEARCH_HOSTS: /(^|\.)(google|bing|duckduckgo|yahoo)\.[a-z.]+$/,
    USER_PAGES_ON_ENGINES: /^(sites|docs|drive|forms)\.google\.com$/ });
  vm.runInContext(src.slice(src.indexOf('function fromBase64'), src.indexOf('/* ----------------------------------------------------------- badges')) + '; this.urls = { realUrl, isResult };', ctx);
  return ctx.urls;
}

test('Bing ad decoding preserves encoded path and query characters in both clients', () => {
  const target = 'https://shop.example/a%2Fb?token=a%26b%3Dc';
  const ad = raw => `https://www.bing.com/aclk?u=${Buffer.from(raw).toString('base64url')}`;
  const c = companionUrls();
  const watch = require('../desktop/src/watch.js')._test;
  for (const raw of [target, encodeURIComponent(target)]) {
    assert.equal(c.realUrl(ad(raw)), target);
    assert.equal(watch.unwrapResult(new URL(ad(raw))).href, target);
  }
});

test('companion checks user-published Google results and cannot be tricked into scanning a decoy parameter', () => {
  const c = companionUrls();
  const anchor = { closest: () => null };
  assert.equal(c.isResult(anchor, 'https://sites.google.com/view/wallet-login'), true);
  assert.equal(c.isResult(anchor, 'https://docs.google.com/forms/d/example/viewform'), true);
  const decoy = 'https://attacker.example/url?url=https://www.paypal.com/';
  assert.equal(c.realUrl(decoy), decoy);
  const nested = `https://www.bing.com/ck/a?u=a1${Buffer.from('https://www.google.com/url?q=https%3A%2F%2Fdestination.example%2Flogin').toString('base64url')}`;
  assert.equal(c.realUrl(nested), 'https://destination.example/login');
  const watch = require('../desktop/src/watch.js')._test;
  assert.equal(watch.resultLinks([{ u: nested, x: 10, y: 100, w: 300, h: 26 }], pageUrl)[0].u, 'https://destination.example/login');
});

test('companion cache keeps title context separate and refuses incomplete research', () => {
  const src = fs.readFileSync(path.join(ROOT, 'extension/src/background.js'), 'utf8');
  const ctx = vm.createContext({ Date });
  vm.runInContext(`const TTL = { quick: 60000, research: 60000 }; const cache = new Map();
    ${src.slice(src.indexOf('function cacheKey'), src.indexOf('const features'))}
    this.cacheApi = { cacheGet, cacheSet };`, ctx);
  const c = ctx.cacheApi;
  c.cacheSet('quick', url, verdict(), { title: 'ordinary', query: 'wallet' });
  assert.ok(c.cacheGet('quick', url, { title: 'ordinary', query: 'wallet' }));
  assert.equal(c.cacheGet('quick', url, { title: 'account sign in', query: 'wallet' }), null);
  c.cacheSet('research', url, verdict(null, { researchComplete: false }));
  assert.equal(c.cacheGet('research', url), null);
});
