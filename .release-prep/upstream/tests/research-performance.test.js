'use strict';
process.env.NODE_ENV = 'test';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;
const config = require('../server/config');
const netguard = require('../server/lib/scan/netguard');
const { analyze } = require('../server/lib/scan/url');

// Exercise the real lookup/coalescing path using only inert in-memory responses.
// The database remains the test database, and no request leaves this process.
config.isTest = false;
const calls = new Map();
const failures = new Set();
const count = (key) => calls.set(key, (calls.get(key) || 0) + 1);
const delay = () => new Promise(resolve => setTimeout(resolve, 15));
for (const method of ['resolve4', 'resolve6', 'resolveMx', 'resolveNs']) {
  mock.method(dns, method, async host => {
    const key = `${method}:${host}`;
    count(key);
    await delay();
    if (failures.delete(key)) throw new Error('temporary resolver outage');
    if (method === 'resolve4') return ['93.184.215.14'];
    if (method === 'resolve6') return [];
    if (method === 'resolveMx') return [{ exchange: `mail.${host}`, priority: 10 }];
    return [`ns.${host}`];
  });
}
mock.method(globalThis, 'fetch', async url => {
  if (url === 'https://data.iana.org/rdap/dns.json') {
    return { json: async () => ({ services: [[['com'], ['https://registry.example/']]] }) };
  }
  const host = decodeURIComponent(new URL(url).pathname.split('/').pop());
  const key = `rdap:${host}`;
  count(key);
  await delay();
  if (failures.delete(key)) return { ok: false, status: 503 };
  return { ok: true, status: 200, json: async () => ({ events: [{ eventAction: 'registration', eventDate: '2010-01-01T00:00:00Z' }] }) };
});
mock.method(netguard, 'safeFetch', async url => {
  count(`page:${url}`);
  return { status: 200, finalUrl: url, chain: [{ url, status: 200 }], headers: { 'content-type': 'text/html' },
    body: Buffer.from(`<html><title>${new URL(url).pathname}</title><p>Inert test page</p></html>`), truncated: false, tls: null };
});
const { research } = require('../server/lib/scan/research');
test.after(() => { config.isTest = true; mock.restoreAll(); });

test('different URLs share domain lookups while retaining separate page checks', async t => {
  const urls = Array.from({ length: 6 }, (_, i) => `https://research-sharing.com/page-${i}`);
  const results = await Promise.all(urls.map(url => research(analyze(url))));
  assert.equal(calls.get('rdap:research-sharing.com'), 1);
  for (const method of ['resolve4', 'resolve6', 'resolveMx', 'resolveNs']) {
    assert.equal(calls.get(`${method}:research-sharing.com`), 1, method);
  }
  for (let i = 0; i < urls.length; i++) {
    assert.equal(calls.get(`page:${urls[i]}`), 1);
    assert.equal(results[i].http.page.title, `/page-${i}`);
  }
  await research(analyze('https://research-sharing.com/another-page'));
  assert.equal(calls.get('resolve4:research-sharing.com'), 1, 'nearby scans reuse recent DNS facts');
  await research(analyze('https://sub.research-sharing.com/page'));
  assert.equal(calls.get('resolve4:sub.research-sharing.com'), 1, 'address records stay host-specific');
  assert.equal(calls.get('resolveMx:research-sharing.com'), 1, 'mail records are shared by registrable domain');
  const later = Date.now() + 31_000;
  t.mock.method(Date, 'now', () => later);
  await research(analyze('https://research-sharing.com/after-dns-expiry'));
  assert.equal(calls.get('resolve4:research-sharing.com'), 2, 'short-lived DNS facts are refreshed');
  assert.equal(calls.get('resolveMx:research-sharing.com'), 2, 'mail facts also expire');
});

test('temporary DNS errors are retried on the next uncached URL', async () => {
  failures.add('resolve4:dns-retry.com');
  const first = await research(analyze('https://dns-retry.com/first'));
  const second = await research(analyze('https://dns-retry.com/second'));
  assert.equal(first.dns.resolves, false);
  assert.equal(second.dns.resolves, true);
  assert.equal(calls.get('resolve4:dns-retry.com'), 2);
});

test('temporary registry errors do not become day-long cached answers', async () => {
  failures.add('rdap:registry-retry.com');
  const first = await research(analyze('https://registry-retry.com/first'));
  const second = await research(analyze('https://registry-retry.com/second'));
  assert.equal(first.registration.available, false);
  assert.equal(second.registration.available, true);
  assert.equal(calls.get('rdap:registry-retry.com'), 2);
});
