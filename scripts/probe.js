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
  'https://m365-security-alert.com/',
  // round two: other scam families, not only fake logins
  'https://microsoft-support-alert-0800.com/', 'https://your-pc-is-infected-call-now.net/', 'https://win-iphone16-claim-now.top/',
  'https://amazon-loyalty-reward-survey.click/', 'https://dhl-parcel-fee-payment.xyz/', 'https://royalmail-redelivery-fee.co/',
  'https://irs-tax-refund-claim.org/', 'https://hmrc-refund-portal.info/', 'https://nike-clearance-90off.shop/',
  'https://ray-ban-outlet-sale.store/', 'https://tesla-btc-giveaway.live/', 'https://binance-airdrop-claim.app/',
  'https://ledger-firmware-update.net/', 'https://trezor-suite-recovery.com/', 'https://steam-community-trade-offer.ru/',
  'https://discord-nitro-free-gift.xyz/', 'https://netflix-billing-update-required.com/', 'https://spotify-premium-free-year.click/',
  'https://facebook-security-check-appeal.com/', 'https://instagram-copyright-violation-form.net/', 'https://whatsapp-verify-your-number.info/',
  'https://usps-tracking-update-fee.com/', 'https://fedex-package-hold-fee.net/', 'https://bankofamerica-alerts-verify.com/',
  'https://wellsfargo-account-locked.net/', 'https://chase-secure-message-center.com/', 'https://coinbase-wallet-unlock.help/',
  'http://192.0.2.44/login/', 'https://paypal.com-verify.me/', 'https://login-microsoftonline.com.verify-session.xyz/',
  // round three: shapes taken from what the rules used to miss on live lists (the names themselves are made up)
  'https://customer-helpcenter4471.netlify.app/', 'https://verifiedbadge-review.vercel.app/meta-verified-for-business',
  'https://mail-loggin-portal.gitbook.io/us', 'https://wallet-recover-desk.pages.dev/',
  'https://508113.xyz/', 'https://77120945.top/', 'https://marketplace.pl-48213.click/oferta',
  'http://shop.item.co.uk.login.secures-k2.example-hotel-site.com/', 'https://bank.com.br.acesso.cliente-seguro.net/',
  'https://qxwkls.cfd/ACS_page', 'https://bdfkrt.sbs/cy',
  // round four: borrowed names glued to lure words, paths dressed as another site, kit file names
  'https://applesoporte.services/', 'https://paypalsecure-centre.com/', 'https://wwnetflixbilling.help/', 'https://short.example/roblox-com-users-1234567-profile',
  'https://lnk.example/wwwpaypalcom-signin', 'https://small-site.example/store/isignesp.php', 'https://another-site.example/a/areautenti_lang.php'
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
  'https://www.hulu.com/', 'https://www.zoom.us/', 'https://slack.com/', 'https://www.notion.so/',
  // round two: ordinary sites that use the same words honestly
  'https://www.securebank.com/', 'https://www.firstbank.com/', 'https://www.banking.co.uk/', 'https://www.loginradius.com/',
  'https://www.verify.gov/', 'https://www.support.com/', 'https://www.giveaway.com/', 'https://www.prizes.org/',
  'https://www.refund.com/', 'https://www.rewards.com/', 'https://www.claims.co.uk/', 'https://www.alerts.com/',
  'https://www.parcel.com/', 'https://www.delivery.com/', 'https://www.outlet.com/', 'https://www.clearance.com/',
  'https://www.wallet.com/', 'https://www.airdrop.com/', 'https://www.update.com/', 'https://www.secure.com/',
  'https://www.freegiftcards.com/', 'https://www.techsupport.com/', 'https://www.invoice.com/', 'https://www.password.com/',
  'https://accounts.shopify.com/', 'https://login.salesforce.com/', 'https://secure.xero.com/', 'https://app.hubspot.com/login',
  'https://id.atlassian.com/login', 'https://auth0.com/', 'https://www.okta.com/login', 'https://myaccount.google.com/security',
  // round three: honest sites that sit next to the newest rules
  'https://my-portfolio.vercel.app/', 'https://anna-photography.github.io/', 'https://johns-bakery.netlify.app/',
  'https://someproject.github.io/login', 'https://vuejs.github.io/', 'https://abc.xyz/', 'https://www.12306.cn/',
  'https://www.163.com/', 'https://www.co.washington.or.us/', 'https://uk.news.yahoo.com/', 'https://www.nightclub.com/',
  'https://pl-tech.com/', 'https://new.express.adobe.com/', 'https://form.jotform.com/', 'https://www.squarespace.com/',
  // round four: honest neighbours of the newest rules
  'https://www.applebees.com/', 'https://www.pineapple.com/', 'https://www.amazonpay.com/', 'https://web.archive.org/',
  'https://web.archive.org/web/2020/https://www.paypal.com/', 'https://example.org/captcha.php', 'https://www.snapple.com/', 'https://purchase.example.com/'
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
