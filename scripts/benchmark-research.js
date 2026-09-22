'use strict';
// Offline simulation of a 60-link batch on one host. Every external service is
// replaced with inert data and a fixed delay; no URLs are actually contacted.
process.env.NODE_ENV = 'test';
const { performance } = require('node:perf_hooks');
const dns = require('node:dns').promises;
const config = require('../server/config');
const netguard = require('../server/lib/scan/netguard');
const { analyze } = require('../server/lib/scan/url');
const counts = { dns: 0, registry: 0, pages: 0 };
const delay = () => new Promise(resolve => setTimeout(resolve, 20));
config.isTest = false; // use the lookup path; dbPath was already fixed to ':memory:'
for (const method of ['resolve4', 'resolve6', 'resolveMx', 'resolveNs']) {
  dns[method] = async () => {
    counts.dns++;
    await delay();
    return method === 'resolve4' ? ['93.184.215.14'] : [];
  };
}
globalThis.fetch = async url => {
  if (url === 'https://data.iana.org/rdap/dns.json') {
    return { json: async () => ({ services: [[['com'], ['https://registry.invalid/']]] }) };
  }
  counts.registry++;
  await delay();
  return { ok: true, status: 200, json: async () => ({ events: [] }) };
};
netguard.safeFetch = async url => {
  counts.pages++;
  return { status: 200, finalUrl: url, chain: [{ url, status: 200 }], headers: { 'content-type': 'text/html' },
    body: Buffer.from('<html><p>Inert benchmark page</p></html>'), truncated: false, tls: null };
};
const { research } = require('../server/lib/scan/research');

async function main() {
  const started = performance.now();
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < 60) await research(analyze(`https://research-benchmark.com/page-${next++}`));
  }));
  console.log(JSON.stringify({ scenario: '60 distinct URLs on one host, six concurrent scans, simulated 20ms lookups',
    elapsedMs: Number((performance.now() - started).toFixed(2)), ...counts }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
