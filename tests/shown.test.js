'use strict';
/**
 * A link that shows one site and opens another (url.js shownVersusReal, checklist X02, email E10). Every host here is
 * made up or a big site's own; the look-alike ones are joined from pieces at test time.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shownVersusReal, unwrapLink } = require('../server/lib/scan/url');
const { analyzeEmail } = require('../server/lib/scan/email');

const ELSEWHERE = 'https://quiet-harbor.example/login';
const ONE_OFF = ['https://', 'paypa', '1', '.com/signin'].join('');
const enc = encodeURIComponent;

test('positives: printed paypal.com opening an unrelated host, brand words over a one-letter-off host, through a wrapper too', () => {
  assert.deepEqual(shownVersusReal('paypal.com', ELSEWHERE), { shown: 'paypal.com', real: 'quiet-harbor.example', brand: null });
  assert.equal(shownVersusReal('https://www.paypal.com/myaccount', ELSEWHERE).shown, 'paypal.com');
  assert.equal(shownVersusReal('www.PayPal.com', ELSEWHERE).shown, 'paypal.com', 'with www, any case is an address');
  const brand = shownVersusReal('Log in to PayPal', ONE_OFF);
  assert.equal(brand.shown, 'paypal.com');
  assert.equal(brand.brand.token, 'paypal');
  assert.equal(shownVersusReal('PayPal.com', ONE_OFF).brand.token, 'paypal', 'a capitalised address still names the brand');
  assert.equal(shownVersusReal('Bank of America', ['https://', 'bankofamerica', '-secure-help.example/'].join('')).brand.token, 'bankofamerica');
  // Wrapped by Google's /url and Outlook's safe links: judged by where they lead.
  assert.equal(shownVersusReal('paypal.com', `https://www.google.com/url?q=${enc(ELSEWHERE)}`).real, 'quiet-harbor.example');
  assert.equal(shownVersusReal('paypal.com', `https://eur01.safelinks.protection.outlook.com/?url=${enc(ELSEWHERE)}&data=1`).real, 'quiet-harbor.example');
});

test('negatives: one owner, an opaque wrapper, a name that is not an address, plain prose', () => {
  const silent = [
    ['docs.google.com', 'https://google.com/'],
    ['google.com', 'https://docs.google.com/document/d/1'],
    ['microsoft.com', 'https://login.live.com/'],
    ['gmail.com', 'https://mail.google.com/'],
    ['nytimes.com', 'https://t.co/AbC123'],
    ['nytimes.com', 'https://example.us1.list-manage.com/track/click?u=1&id=2&e=3'],
    ['nytimes.com', 'https://web.archive.org/web/2020/https://www.nytimes.com/'],
    ['overdrive.com', 'https://www.overdrive.com/'],
    ['OverDrive', 'https://www.overdrive.com/'],
    ['Read more about this story', ELSEWHERE],
    ['Node.js', 'https://nodejs.org/'],
    ['ASP.NET', 'https://dotnet.microsoft.com/apps/aspnet'],
    ['readme.md', 'https://github.com/someone/project/blob/main/README.md'],
    ['index.js', ELSEWHERE],
    ['paypal.com', `https://nam02.safelinks.protection.outlook.com/?url=${enc('https://www.paypal.com/')}`],
    ['paypal.com', 'https://www.paypal.com/signin'],
    ['PayPal', 'https://www.paypal.com/'],
    ['Pay with PayPal', 'https://shop.example/checkout'],
    // Found by the real-anchor replay (verify-web anchor-replay): headlines and citations that mention a brand, over
    // the company's own sites the brand list does not name.
    ['About PayPal – PayPal', 'https://www.paypal-media.com/about'],
    ['"PayPal to Acquire Curv"', 'https://newsroom.paypal-corp.com/2021-03-08-PayPal-to-Acquire-Curv'],
    ['Shopify.dev Dev docs, CLI, and more', 'https://shopify.dev/'],
    ['"Ebay.in help file on Paisapay"', 'http://pages.ebay.in/ebayexplained/paisapay.html'],
    ['', ELSEWHERE]
  ];
  for (const [text, href] of silent) assert.equal(shownVersusReal(text, href), null, `${text} over ${href}`);
  // A well-known site's page about the shown one (Hacker News' "from?site=", Reddit's /domain/): silent there only.
  assert.equal(shownVersusReal('github.com', 'https://news.ycombinator.com/from?site=github.com', true), null);
  assert.equal(shownVersusReal('github.com', 'https://quiet-harbor.example/from?site=github.com', false).shown, 'github.com');
  // A well-known site under its own name on another ending: one owner.
  assert.equal(shownVersusReal('www.statista.de', 'https://de.statista.com/', true), null);
  assert.equal(shownVersusReal('www.statista.de', 'https://statista.quiet-harbor.example/', false).shown, 'statista.de');
  // A brand's name over a look-alike of it, on a well-known site: not a disguise.
  assert.equal(shownVersusReal('PayPal', ONE_OFF, true), null);
  assert.equal(unwrapLink(`https://www.facebook.com/l.php?u=${enc(ELSEWHERE)}`), ELSEWHERE);
});

test('a brand\'s own address inside a sentence, in any case, over an unrelated host; never over a well-known site or a mail service', () => {
  for (const text of ['Log in to paypal.com', 'Visit PayPal.com to confirm your details', 'Go to https://www.paypal.com/signin now', 'PayPal.com']) {
    assert.deepEqual(shownVersusReal(text, ELSEWHERE), { shown: 'paypal.com', real: 'quiet-harbor.example', brand: null }, text);
  }
  // A news site's headline about the brand, the brand's own site, a name that is not a brand's address.
  assert.equal(shownVersusReal('PayPal.com was down for an hour', 'https://www.bbc.co.uk/news/1', true), null);
  assert.equal(shownVersusReal('Log in to paypal.com', 'https://www.paypal.com/signin'), null);
  assert.equal(shownVersusReal('Built with Node.js and ASP.NET', ELSEWHERE), null);
  // Mail services' click counters hold the real address out of sight: Iterable, Postmark, Customer.io, Pardot, Brevo,
  // Campaign Monitor.
  for (const href of ['https://links.iterable.com/u/click?_t=1', 'https://click.pstmrk.it/3s/x', 'https://e.customeriomail.com/e/c/1',
    'https://go.pardot.com/e/1/2', 'https://r.sendibt3.com/tr/cl/1', 'https://shop.cmail7.com/t/y-l-1']) {
    assert.equal(shownVersusReal('www.shop.com', href), null, href);
  }
});

test('E10 uses the same comparison: a tracker-wrapped link to the same site no longer fails 30, a real mismatch still does', () => {
  const e10 = (body) => analyzeEmail({ from: 'News <news@example.org>', subject: 'hi', body }).checks.find((c) => c.id === 'E10');
  assert.equal(e10(`Read it at www.nytimes.com <https://example.us1.list-manage.com/track/click?u=1&id=2>`).status, 'pass');
  assert.equal(e10(`Your account: www.paypal.com <https://www.google.com/url?q=${enc('https://www.paypal.com/')}>`).status, 'pass');
  const bad = e10(`Sign in at www.paypal.com <${ELSEWHERE}>`);
  assert.equal(bad.status, 'fail');
  assert.equal(bad.points, 30);
  assert.equal(bad.detail, 'Link text shows paypal.com but opens quiet-harbor.example');
  // The address inside a sentence, as the old E10 caught it.
  const sentence = analyzeEmail({ from: 'News <news@example.org>', subject: 'hi', body: 'Hello', links: [{ text: 'Please log in to PayPal.com to confirm', href: ELSEWHERE }] });
  assert.equal(sentence.checks.find((c) => c.id === 'E10').status, 'fail');
});

test('X02: link words only add a warning, never clear one, and are never sent from a private window', async () => {
  require('../server/seed').run({ quiet: true });
  const engine = require('../server/lib/scan/engine');
  const run = (url, hint) => engine.scanUrls([url], { threats: ['scam', 'virus', 'malware'], mode: 'live', detail: 'full', hints: hint ? { [url]: hint } : {} }).then((r) => r[0]);
  const x02 = (v) => v.checklist.items.find((c) => c.id === 'X02');
  const alone = await run(ELSEWHERE, { text: 'paypal.com' });
  assert.equal(x02(alone).status, 'fail');
  assert.equal(x02(alone).detail, 'This link shows paypal.com but opens quiet-harbor.example');
  assert.equal(alone.overall.badge, 'yellow', 'caution on its own');
  assert.equal(x02(await run(ELSEWHERE, null)).status, 'skip');
  // A look-alike keeps its full weight whatever the words say: "OverDrive" over a misspelt OneDrive is not a pass.
  const lookalike = ['https://', 'onedr', 'lve', '.com/login'].join('');
  const plain = await run(lookalike, null);
  const worded = await run(lookalike, { text: 'Microsoft OneDrive' });
  assert.ok(worded.threats.scam.score >= plain.threats.scam.score, `${worded.threats.scam.score} >= ${plain.threats.scam.score}`);
  const u24 = (v) => v.checklist.items.find((c) => c.id === 'U24');
  // "steamy" is a word spelled near Steam: its note stays, even under words that say its own name.
  assert.equal(u24(await run('https://steamy.example/', { text: 'Steamy' })).status, 'warn', 'words never feed the word-alike pass');
  // The route drops every hint for a private window, the words with them.
  const routes = require('fs').readFileSync(require('path').join(__dirname, '..', 'server', 'routes', 'scan.routes.js'), 'utf8');
  assert.match(routes, /if \(!isPrivate && body\.hints && typeof body\.hints === 'object'\)[\s\S]{0,400}text: String\(h\.text \|\| ''\)\.slice\(0, 120\)/);
});
