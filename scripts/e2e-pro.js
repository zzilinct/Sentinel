'use strict';
/**
 * End-to-end runs only (scripts/live-e2e.ps1, on a GitHub test desktop): give the accounts in a freshly installed
 * Sentinel's database the Pro plan, so inbox checks (a Pro feature) can be exercised. Never run on a real computer.
 *   node scripts/e2e-pro.js <path to sentinel.db>
 */
const { DatabaseSync } = require('node:sqlite');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/e2e-pro.js <sentinel.db>'); process.exit(2); }
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout = 10000');
const { changes } = db.prepare("UPDATE users SET plan = 'pro'").run();
console.log(`accounts set to Pro: ${changes}`);
db.close();
