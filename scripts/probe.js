'use strict';
/**
 * Probe: does the scanner generalise? Made-up phishing-style addresses that
 * are in no feed or fixture, and real sites that use the same words for real.
 * Nothing is fetched (research is off), so nothing here reaches the network.
 *
 *   node scripts/probe.js            misses and false alarms only
 *   node scripts/probe.js --verbose  every address with its non-passing rules
 */
process.chdir(require('path').join(__dirname, '..'));
process.env.FEED_REFRESH_HOURS = '0';
const engine = require('../server/lib/scan/engine');
const verbose = process.argv.includes('--verbose');

const bad = [
  'https://walletconnect-dapp-sync.app/',
  'https://mysecurebank-online.com/auth',
  'https://storage.googleapis.com/appstatic/index.html',
  'https://webmail-update-required.com/',
  'https://portal-hr-payroll.net/adp/login',
  'https://mybucket.s3.us-east-1.amazonaws.com/secure/index.html',
  'https://x7k29q.cloudfront.net/login.html',
  'https://account-verify-center.com/',
  'https://secure-login-portal.net/session/',
  'https://mail-quota-notice.info/owa/',
  'https://docs-shared-file.com/onedrive/',
  'https://gardencentre-leeds.co.uk/wp-content/uploads/verify.php',
  'https://oldrecipes.org/wp-includes/css/login.php',
  'https://sunnyrentals.com/.well-known/secure/index.php?email=',
  'https://a8f3k2.pages.dev/signin',
  'https://myaccount-update.web.app/',
  'https://secure-docusign-review.com/docusign/',
  'https://hr-benefits-enrollment.net/payroll/',
  'https://metamask-wallet-restore.io/',
  'https://ledger-live-sync.net/',
  'https://www.chase.com@evil-host.net/',
  'https://www.paypal.com.login.verify-user.info/',
  'https://appleid-apple-com.verify-session.net/',
  'https://mobile-banking-reactivate.com/',
  'https://sso-adfs-authenticate.com/adfs/ls/',
  'https://sites.google.com/view/office365-login-verify',
  'https://wetransfer-shared-document.com/wetransfer/',
  'https://m365-security-alert.com/'
];

const clean = [
  'https://www.google.com/', 'https://www.wikipedia.org/wiki/Main_Page', 'https://github.com/nodejs/node',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript', 'https://www.bbc.co.uk/news', 'https://www.nytimes.com/',
  'https://stackoverflow.com/questions', 'https://www.amazon.com/dp/B08N5WRWNW', 'https://www.paypal.com/signin',
  'https://accounts.google.com/signin', 'https://login.microsoftonline.com/', 'https://www.chase.com/personal/online-banking',
  'https://www.bankofamerica.com/', 'https://outlook.live.com/owa/', 'https://www.adp.com/logins.aspx',
  'https://workday.com/', 'https://www.dropbox.com/login', 'https://onedrive.live.com/', 'https://www.docusign.com/',
  'https://www.wetransfer.com/', 'https://metamask.io/', 'https://www.ledger.com/', 'https://walletconnect.com/',
  'https://www.coinbase.com/signin', 'https://www.usps.com/', 'https://www.fedex.com/en-us/tracking.html',
  'https://www.irs.gov/', 'https://www.gov.uk/', 'https://www.nhs.uk/', 'https://www.apple.com/', 'https://appleid.apple.com/',
  'https://www.netflix.com/login', 'https://www.spotify.com/', 'https://www.reddit.com/r/programming', 'https://news.ycombinator.com/',
  'https://en.wikipedia.org/wiki/Phishing', 'https://www.cloudflare.com/', 'https://aws.amazon.com/s3/', 'https://cloud.google.com/storage',
  'https://docs.python.org/3/', 'https://nodejs.org/en/download', 'https://www.rust-lang.org/', 'https://www.gnu.org/software/bash/',
  'https://www.mozilla.org/en-US/firefox/', 'https://support.microsoft.com/en-us/windows', 'https://www.ikea.com/', 'https://www.etsy.com/',
  'https://www.ebay.com/', 'https://www.walmart.com/', 'https://www.target.com/', 'https://www.bestbuy.com/',
  'https://www.hulu.com/', 'https://www.zoom.us/', 'https://slack.com/', 'https://www.notion.so/'
];

(async () => {
  let missed = 0; let fp = 0;
  const fmt = (v) => ['scam', 'virus', 'malware'].map((k) => `${k[0].toUpperCase()} ${(v.threats[k].badge || '-').padEnd(6)}${String(v.threats[k].score).padStart(3)}`).join(' | ');
  const why = (v) => (v.checklist.items || v.checklist.checks || []).filter((c) => c.status !== 'pass').map((c) => `${c.id}${c.status === 'warn' ? '?' : ''}`).join(' ');
  console.log('== should flag ==');
  for (const url of bad) {
    const v = await engine.scanUrl(url, { threats: ['scam', 'virus', 'malware'], research: false });
    const hit = ['scam', 'virus', 'malware'].some((k) => v.threats[k].badge);
    if (!hit) missed++;
    if (!hit || verbose) console.log(`${hit ? '  ' : 'MISS'} ${fmt(v)} | ${url}  [${why(v)}]`);
  }
  console.log('== should stay clean ==');
  for (const url of clean) {
    const v = await engine.scanUrl(url, { threats: ['scam', 'virus', 'malware'], research: false });
    const hit = ['scam', 'virus', 'malware'].some((k) => v.threats[k].badge);
    if (hit) fp++;
    if (hit || verbose) console.log(`${hit ? 'FP  ' : '  '} ${fmt(v)} | ${url}  [${why(v)}]`);
  }
  console.log(`missed ${missed} of ${bad.length}; false alarms ${fp} of ${clean.length}`);
  process.exit(0);
})();
