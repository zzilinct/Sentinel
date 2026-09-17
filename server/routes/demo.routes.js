'use strict';
/**
 * Public, account-free endpoints behind the interactive landing page.
 *
 * Every example is a real verdict from the scan engine (knowledge + checklist +
 * compare, no research), computed on demand and cached - nothing is mocked.
 * The anonymous "try a link" scan never researches, so it can't be used to make
 * Sentinel fetch arbitrary addresses, and it is rate-limited per visitor.
 */
const { sendJson, HttpError, readJson } = require('../lib/http');
const security = require('../lib/security');
const engine = require('../lib/scan/engine');
const { analyze, typedUrl } = require('../lib/scan/url');
const config = require('../config');

const ALL = ['scam', 'virus', 'malware'];

const MASK_EXAMPLES = {
  scam: {
    yellow: { url: 'https://amazon-order-review.shop/', context: 'A “review your order” link in a text message' },
    orange: { url: 'https://netflix-account-update.online/', context: 'An email saying your Netflix payment didn’t go through' },
    red: { url: 'https://paypa1-secure-login.com/account', context: 'A PayPal sign-in page with a “1” in place of the “l”' }
  },
  virus: {
    yellow: { url: 'https://share-files.site/document.pdf.zip', context: 'A “document” shared from a file-hosting site' },
    orange: { url: 'https://cdn-share.site/Invoice_March.pdf.exe', context: 'An “invoice” that is really a program' },
    red: { url: 'https://free-crack-downloads.icu/', context: 'A site handing out cracked software' }
  },
  malware: {
    yellow: { url: 'http://198.51.100.4/bins/mozi.m', context: 'A file served straight from a bare IP address' },
    orange: { url: 'http://update-check.ddns.net:8443/i.sh', context: 'An “update check” script on a throwaway hostname' },
    red: { url: 'https://chrome-update-required.top/', context: 'A page claiming your browser needs an urgent update' }
  }
};

const SERP_SETS = {
  paypal: {
    query: 'paypal account locked help',
    results: [
      { title: 'Resolve a limited account — PayPal Help Center', url: 'https://www.paypal.com/us/cshelp/limited-account', desc: 'Find out why your account may be limited and what you can do to restore access.' },
      { title: 'PayPal Account Recovery Support (24/7 help)', url: 'https://paypal-recovery-help.online/unlock', desc: 'Unlock your PayPal account instantly with our recovery specialists.' },
      { title: 'Restore PayPal Access — Secure Verification Portal', url: 'https://paypal.com.secure-verify-login.xyz/signin', desc: 'Your account has been limited. Verify your identity within 24 hours.' },
      { title: 'PayPal Account Unlock Tool 2026 (Free Download)', url: 'https://unlock-tools-hub.icu/PayPalUnlock_Setup.pdf.exe', desc: 'Download the official unlock utility. Works on Windows 10 and 11.' },
      { title: 'PayPaI — Log in to your account', url: 'https://paypa1-secure-login.com/account', desc: 'Log in to your PayPal account to review recent activity.' }
    ]
  },
  crypto: {
    query: 'coinbase wallet support number',
    results: [
      { title: 'Coinbase Help Center — Contact us', url: 'https://help.coinbase.com/en/contact-us', desc: 'Get help with your Coinbase account, wallet and transactions.' },
      { title: 'Coinbase Support Desk — Call 24/7 Wallet Recovery', url: 'https://coinbase-support-desk.live/', desc: 'Locked out of your wallet? Our agents restore access in minutes.' },
      { title: 'MetaMask — Restore Your Wallet', url: 'https://metamask-wallet-restore.cfd/', desc: 'Enter your recovery phrase to restore your wallet and claim rewards.' },
      { title: 'Crypto Price Tracker Pro — Free Desktop App', url: 'https://tracker-apps.top/CryptoTracker_Setup.exe', desc: 'Real-time prices on your desktop. Fast, free download.' },
      { title: 'Elon Crypto Giveaway — Double Your BTC', url: 'https://crypto-doubler-elon.live/', desc: 'Send any amount and receive double back. Limited time only.' }
    ]
  },
  parcel: {
    query: 'usps package delivery fee text',
    results: [
      { title: 'USPS Tracking® — Track packages', url: 'https://tools.usps.com/go/TrackConfirmAction', desc: 'Track the status of a package with its tracking number.' },
      { title: 'Package Held: Pay Redelivery Fee ($1.99)', url: 'https://usps-redelivery-fee.sbs/pay', desc: 'Your package could not be delivered due to an incomplete address.' },
      { title: 'Customs Fee Required — Parcel Awaiting Release', url: 'https://parcel-customs-release.top/track', desc: 'Pay the outstanding customs fee to release your parcel.' },
      { title: 'Recognize USPS scam texts — USPIS', url: 'https://www.uspis.gov/news/scam-article/smishing', desc: 'How to spot and report fake delivery text messages.' },
      { title: 'Delivery Notice — Download Shipping Label', url: 'https://shipping-label-print.site/Label_USPS.pdf.exe', desc: 'Print your shipping label to schedule redelivery.' }
    ]
  }
};

const GAME = [
  { url: 'https://tools.usps.com/go/TrackConfirmAction', context: 'You search for how to track a USPS package.' },
  { url: 'https://usps-redelivery-fee.sbs/pay', context: 'A text says your parcel is held until you pay $1.99.' },
  { url: 'https://amazon-order-review.shop/', context: 'A message asks you to confirm a recent Amazon order.' },
  { url: 'https://github.com/nodejs/node', context: 'A colleague sends you a link to a code project.' },
  { url: 'https://cdn-share.site/Invoice_March.pdf.exe', context: 'An email from “accounts” attaches a link to an invoice.' },
  { url: 'https://coinbase-support-desk.live/', context: 'You search for Coinbase phone support.' },
  { url: 'https://chrome-update-required.top/', context: 'A pop-up says your browser is out of date.' },
  { url: 'https://www.bbc.co.uk/news', context: 'A friend shares a news article.' },
  { url: 'https://steamcommunlty-trade.com/', context: 'A gamer offers you a trade on Steam.' },
  { url: 'https://share-files.site/document.pdf.zip', context: 'Someone shares “the document we discussed”.' },
  { url: 'https://www.paypal.com/signin', context: 'You type PayPal’s address into your browser yourself.' },
  { url: 'https://paypal.com.secure-verify-login.xyz/signin', context: 'An email warns that your PayPal account is limited.' }
];

/** The parts of a verdict the public page needs. */
function summarize(v, extra = {}) {
  return {
    ...extra,
    url: v.url,
    host: v.host,
    threats: Object.fromEntries(ALL.map((t) => [t, v.threats[t] && { badge: v.threats[t].badge, level: v.threats[t].level, label: v.threats[t].label, score: v.threats[t].score }])),
    overall: v.overall,
    reasons: (v.reasons || []).slice(0, 5).map((r) => ({ threat: r.threat, text: r.text })),
    known: Boolean(v.knowledge && v.knowledge.known),
    discounted: Boolean(v.knowledge && v.knowledge.discountApplied),
    checks: { total: v.checklist.total, failed: v.checklist.failed, warned: v.checklist.warned, passed: v.checklist.passed }
  };
}

const scan = (url) => engine.scanUrl(url, { threats: ALL, research: false, mode: 'demo' });

let cache = { at: 0, data: null, pending: null };

async function buildExamples() {
  const masks = {};
  for (const [threat, levels] of Object.entries(MASK_EXAMPLES)) {
    masks[threat] = {};
    for (const [level, ex] of Object.entries(levels)) masks[threat][level] = summarize(await scan(ex.url), { context: ex.context });
  }
  const serp = {};
  for (const [key, set] of Object.entries(SERP_SETS)) {
    serp[key] = { query: set.query, results: [] };
    for (const r of set.results) serp[key].results.push(summarize(await scan(r.url), { title: r.title, desc: r.desc }));
  }
  const game = [];
  for (const g of GAME) game.push(summarize(await scan(g.url), { context: g.context }));
  return { masks, serp, game, generatedAt: Date.now() };
}

async function examples() {
  if (cache.data && Date.now() - cache.at < 15 * 60 * 1000) return cache.data;
  if (!cache.pending) {
    cache.pending = buildExamples()
      .then((data) => { cache = { at: Date.now(), data, pending: null }; return data; })
      .catch((err) => { cache.pending = null; throw err; });
  }
  return cache.pending;
}

function register(router) {
  router.get('/api/v1/demo/examples', async (req, res) => {
    security.rateLimit(`demo-examples:${security.clientIp(req)}`, 120, 60 * 60 * 1000);
    sendJson(res, 200, await examples(), { 'Cache-Control': 'public, max-age=300' });
  });

  router.post('/api/v1/demo/scan', async (req, res) => {
    const ip = security.clientIp(req);
    const body = await readJson(req, 8 * 1024);
    const url = typeof body.url === 'string' && body.url.trim() ? typedUrl(body.url) : null;
    if (!url || !analyze(url)) throw new HttpError(400, 'bad_url', 'That doesn’t look like a web address.');
    security.rateLimit(`demo-scan:${ip}`, config.isTest ? 1000 : 5, 24 * 60 * 60 * 1000, 'You’ve used today’s free demo scans. Create a free account for 10 scans a week.');
    security.rateLimit('demo-scan:global', config.isTest ? 100000 : 5000, 24 * 60 * 60 * 1000, 'The demo is busy right now. Create a free account to keep scanning.');
    sendJson(res, 200, { verdict: summarize(await scan(url)) });
  });

  /**
   * Guest mode: the same full result a signed-in Free scan gets (knowledge,
   * checklist and comparison, never research), without an account. Limited
   * per visitor and never recorded anywhere.
   */
  router.post('/api/v1/guest/scan', async (req, res) => {
    const ip = security.clientIp(req);
    const body = await readJson(req, 8 * 1024);
    const url = typeof body.url === 'string' && body.url.trim() ? typedUrl(body.url) : null;
    if (!url || !analyze(url)) throw new HttpError(400, 'bad_url', 'That doesn’t look like a web address.');
    security.rateLimit(`guest-scan:${ip}`, config.isTest ? 1000 : 10, 24 * 60 * 60 * 1000, 'Guest scans are limited to 10 a day. Create a free account for more.');
    security.rateLimit('guest-scan:global', config.isTest ? 100000 : 5000, 24 * 60 * 60 * 1000, 'Guest scanning is busy right now. Create a free account to keep scanning.');
    const verdict = await engine.scanUrl(url, { threats: ['scam'], research: false, mode: 'guest' });
    sendJson(res, 200, { verdict, guest: { limitPerDay: 10 } });
  });
}

module.exports = { register, buildExamples };
