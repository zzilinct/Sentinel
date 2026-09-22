'use strict';
// Offline synthetic benchmark. NODE_ENV=test guarantees an isolated in-memory
// database; this never reads user scan history or contacts any website.
process.env.NODE_ENV = 'test';
const { performance } = require('node:perf_hooks');
const crypto = require('node:crypto');
const { db } = require('../server/lib/db');
const compare = require('../server/lib/scan/compare');

const insert = db.prepare('INSERT INTO scam_fingerprints (simhash, host, threat, label, added_at) VALUES (?, ?, ?, ?, ?)');
db.exec('BEGIN');
for (let i = 0; i < 5000; i++) {
  insert.run(crypto.createHash('sha256').update(`benchmark ${i}`).digest('hex').slice(0, 16), `page-${i}.invalid`, 'scam', 'Synthetic fingerprint', i);
}
db.exec('COMMIT');

const text = 'This page has ordinary text about boats lakes beaches coastal walks and good lunch recipes. '.repeat(50);
const run = () => compare.compareContent(text, text, 'benchmark.invalid');
for (let i = 0; i < 10; i++) run();
const times = [];
for (let i = 0; i < 100; i++) {
  const start = performance.now();
  run();
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({
  scenario: 'Compare page text against 5,000 synthetic fingerprints',
  samples: times.length,
  medianMs: Number(times[Math.floor(times.length / 2)].toFixed(2)),
  p95Ms: Number(times[Math.ceil(times.length * 0.95) - 1].toFixed(2)),
  meanMs: Number((times.reduce((a, b) => a + b, 0) / times.length).toFixed(2))
}, null, 2));
