'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

// Tiny .env loader (no dependency). Real environment variables always win.
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath) && process.env.NODE_ENV !== 'test') {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const brand = JSON.parse(fs.readFileSync(path.join(root, 'brand.json'), 'utf8'));
const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';
const port = Number(process.env.PORT || 8787);

let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (isProd) throw new Error('SESSION_SECRET must be set in production (see .env.example)');
  if (isTest) {
    secret = 'test-secret-not-for-production-000000000000';
  } else {
    // Dev convenience: persist a generated secret so sessions survive restarts.
    const devFile = path.join(root, 'data', '.dev-secret');
    fs.mkdirSync(path.dirname(devFile), { recursive: true });
    if (!fs.existsSync(devFile)) fs.writeFileSync(devFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = fs.readFileSync(devFile, 'utf8').trim();
  }
}
if (isProd && secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

const publicOrigin = (process.env.PUBLIC_ORIGIN || (isProd ? brand.origin : `http://localhost:${port}`)).replace(/\/$/, '');

function resolveDbPath() {
  if (isTest) return ':memory:';
  const p = process.env.DB_PATH || 'data/sentinel.db';
  return path.isAbsolute(p) ? p : path.join(root, p);
}

module.exports = {
  root,
  env,
  isProd,
  isTest,
  brand,
  port,
  host: process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  publicOrigin,
  secureCookies: publicOrigin.startsWith('https://'),
  secret,
  dbPath: resolveDbPath(),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    get enabled() { return Boolean(this.clientId && this.clientSecret); }
  },
  safeBrowsingKey: process.env.SAFE_BROWSING_API_KEY || '',
  // Threat feeds are refreshed on this interval (0 disables automatic refresh).
  feedRefreshHours: Number(process.env.FEED_REFRESH_HOURS ?? (isTest ? 0 : 6)),
  // "demo" lets signed-in users switch plans without payment (development only).
  billingMode: process.env.BILLING_MODE || (isProd ? 'disabled' : 'demo'),
  // Research opens suspicious pages, which must only ever happen from Sentinel's
  // own servers. The desktop app's embedded server sets this to 0 so a person's
  // computer never fetches a suspicious page on their behalf.
  researchEnabled: process.env.RESEARCH_ENABLED !== '0',
  // The desktop app never opens a suspicious page from the person's computer (RESEARCH_ENABLED=0), but it may still
  // ask the public registry how old a domain is and whether it resolves: nothing is requested from the site itself.
  researchLite: process.env.RESEARCH_LITE === '1',
  // The desktop app's own server may create the account for the computer it runs
  // on, so protection starts with no sign-up. Never on a hosted server.
  deviceAccounts: process.env.SENTINEL_DEVICE_ACCOUNTS === '1',
  // Research may reach private addresses only in the test suite's fixture server.
  researchAllowPrivate: isTest && process.env.RESEARCH_ALLOW_PRIVATE === '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  // Whether this server can actually deliver email. Development prints messages
  // to the console; production needs a provider key. The self-contained desktop
  // app has neither, and says so instead of pretending a message was sent.
  mailConfigured: Boolean(process.env.RESEND_API_KEY) || !isProd,
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  webDir: path.join(root, 'web')
};
