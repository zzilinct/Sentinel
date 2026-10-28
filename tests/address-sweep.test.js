'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { scanAddress, _test: { checksOf } } = require('../server/lib/scan/offline');

// The fast check on the address alone, as the app runs it on any address its lists know nothing about. Every
// address below is made up for this test in the shape of a group of misses from the "Evaluate detection" run
// (OpenPhish held out); none is a real scam host.
const fired = (url) => checksOf(url).filter((c) => c.status === 'fail' || c.status === 'warn').map((c) => c.id);
const flagged = (url) => Boolean(scanAddress(url).overall.badge);

const CAUGHT = [
  // A brand the lists did not know, planted in front of an unrelated domain.
  ['https://absa.qwzrtx.co.za/index_dtel.html', 'U23'],
  ['http://www.absa.qwzrtx.co.za/', 'U23'],
  ['https://mydpd.qwzrt.top/track-ch/', 'U23'],
  // Initials-only brands next to a lure: bait words, a bulk ending, or parcel-fee wording in front.
  ['https://dpd-redelivery-fee.top/', 'U22'],
  ['https://absa-online-verify.xyz/', 'U22'],
  ['https://dpd.parcel-fee.com/', 'U23'],
  ['https://poshmark.id12345678.shop/1234567', 'U23'],
  ['https://verify-networksolutions.example-host.info/appsuite', 'U23'],
  ['https://verify-networksolutions.info/appsuite', 'U22'],
  // A serial number with a letter or two in front.
  ['https://gunshop.id12345678.shop/264727527', 'U45'],
  // A campaign's numbered domains: two codes and a throwaway label in front.
  ['https://y5qm.qh23-ph.net/', 'U45'],
  ['https://rxuq.dz68-vn.net/', 'U45'],
  ['https://um05bx.ph-tq77.net/', 'U45'],
  // Free hosting: free game money, security in another language with a serial, the community-policy lure.
  ['https://usernamerobux77.blogspot.com/', 'U46'],
  ['https://freerobuxzz.blogspot.com/', 'U46'],
  ['https://seguridad-2026b6x782.netlify.app/', 'U46'],
  ['https://community-policy-info.vercel.app/required.html', 'U46'],
  ['https://page-violation-center.pages.dev/', 'U46'],
  // A brand spelled one letter wrong as a user's page name.
  ['https://someone-qq.github.io/l_inshtagram/', 'U40'],
  // A storage bucket page under generated names.
  ['https://9qk3x8ypz2m7w4bv1tde.s3.amazonaws.com/qwer_ty7vziox4nslwio9fezt_mn_c4mot3l33xce28c5x.html', 'U20'],
  // A brand's own server copied into a path, and a host that begins with a brand's own address.
  ['https://shopfoo.example/grp01.id.rakuten.co.jp/jp/0a1b2c3d/?cmd=', 'U50'],
  ['https://hacked.example/login.microsoftonline.com/common/oauth2/', 'U50'],
  ['https://s.team-qz.com/p/abc-def/ghijkl', 'U47'],
  // A rented server's factory name.
  ['https://vmi1234567.contaboserver.net/Entrega/Entrega/entrega/msg.php', 'U56'],
  ['http://ec2-3-1-2-4.us-east-2.compute.amazonaws.com/login', 'U56'],
  // Sign-in wording on a dynamic-DNS name.
  ['http://v1234.ig-verifica.freemyip.com/', 'U21'],
  ['https://v1234.ig-verifica.freemyip.com/legal/cookies/', 'U21'],
  // Not one vowel, on an ending sold in bulk.
  ['https://lqlsqjjg.casa/', 'U48'],
  // A numbered content-network server's name, on an ending sold in bulk.
  ['https://tokqnlmz-cdn0-ffd.lat/', 'U48'],
  ['https://tokqnlz-cdn51-hk51.lol/', 'U48'],
  // Six consonants in a row on a bulk ending; the campaign's numbered domains with a bare number.
  ['https://uwzqsqqpui.casa/', 'U48'],
  ['https://gyeqx4.6686-vn.net/', 'U45'],
  // A made-up name for a site its owner never named, and a hosting company's temporary address.
  ['https://orange-aside-123456.framer.app/', 'U56'],
  ['https://1234567.eu9.myftpupload.com/abcCss/abc/k.html', 'U56'],
  // "gov" glued to the words of Brazil's tax-number debt messages.
  ['https://www.govpendenciaqainel.org/', 'U33'],
  ['https://govregularizaqainel.org/', 'U33']
];

// Honest neighbours of each rule: the same platforms, words and shapes used the ordinary way.
const HONEST = [
  'https://www.absa.co.za/personal/', 'https://www.dpd.co.uk/', 'https://track.dpd.com/parcel/123', 'https://www.dpd.ch/',
  'https://poshmark.com/closet/someone', 'https://www.networksolutions.com/my-account/login', 'https://s.team/p/abcd-efgh',
  'https://store.steampowered.com/', 'https://dpdsolutions.com/', 'https://dpdbuilders.com/',
  'https://www.k12-nj.org/', 'https://lms.k12-nj.org/', 'https://ab12-cd.net/', 'https://www.ab12-cd.net/', 'https://www.3m.com/',
  'https://seguridad-vial-madrid.netlify.app/', 'https://securite-routiere-quiz.netlify.app/',
  'https://soccer-stats-2024.vercel.app/', 'https://jane.github.io/telegraph/', 'https://jane.github.io/amazonian/',
  'https://my-company-assets.s3.amazonaws.com/index.html', 'https://s3.amazonaws.com/acme-reports/annual-report-2024.html',
  'https://www.similarweb.com/website/login.microsoftonline.com/', 'https://www.virustotal.com/gui/domain/login.microsoftonline.com/relations',
  'https://urlscan.io/domain/secure.paypal.com', 'https://i0.wp.com/cdn.shopify.com/s/files/1/photo.jpg',
  'https://downforeveryoneorjustme.com/rakuten.co.jp', 'https://developer.paypal.com/docs/api/',
  'https://myplex.duckdns.org/', 'https://nas.dynv6.net/', 'https://homecam.freemyip.com/',
  'https://www.govdelivery.com/', 'https://govtrack.us/', 'https://www.governmentjobs.com/', 'https://www.gov.br/receitafederal/',
  'https://newsletter-signup.netlify.app/', 'https://my-portfolio.framer.app/', 'https://app.123-go.com/', 'https://www.schmidt.shop/',
  'https://abc.servecounterstrike.com/', 'https://my-api2.xyz/', 'https://my-cdn2.xyz/', 'https://cdn1.example.top/', 'https://rhythm.top/', 'https://www.lynx.shop/', 'https://crwth.store/', 'https://www.xkcd.com/',
  'https://aws.amazon.com/ec2/', 'https://contabo.com/en/vps/', 'https://www.hetzner.com/cloud',
  // QA 1.18.2: a department's initials under .gov, a year after "security", a project named Telegraf, a word in front
  // of two codes, German "sch", and a home camera on dynamic DNS.
  'https://dpd.wa.gov/', 'https://seguridad-vial-2026.netlify.app/', 'https://sicherheit-2025.netlify.app/',
  'https://influxdata.github.io/telegraf/', 'https://app.web3-io.com/', 'https://shop.mp3-de.com/',
  'https://www.kunstschule.shop/', 'https://mysecurecam.duckdns.org/',
  // 1.18.4: DPD's and Absa's letters as other bodies' initials or as letters in another name, with nothing leaning on the brand.
  'https://absa.org/', 'https://www.absa.org/', 'https://absa-conference.com/', 'https://dpd.org/', 'https://dpd-ltd.co.uk/',
  'https://dpd.denvergov.org/', 'https://dpd.detroitmi.org/', 'https://dpd.cityofdallas.org/', 'https://absa.uni-bonn.de/',
  'https://dpd.example.edu/', 'https://absa.mystate.us/', 'https://absa.sports.org/'
];

test('address shapes the evaluation missed are caught, by the rule written for each', () => {
  for (const [url, id] of CAUGHT) {
    assert.ok(flagged(url), `${url} should be flagged (${fired(url).join(', ')})`);
    assert.ok(fired(url).includes(id), `${url} should fire ${id} (fired ${fired(url).join(', ')})`);
  }
});

test('the honest neighbours of those rules are left alone', () => {
  for (const url of HONEST) assert.equal(scanAddress(url).overall.badge, null, `${url} (${fired(url).join(', ')})`);
});

test('the honest sites the evaluation measures are still left alone', () => {
  const urls = [
    ...require('../scripts/evaluate-sites.json').map((h) => `https://${h}/`),
    ...require('../scripts/evaluate-pages.json'),
    ...require('../scripts/evaluate-lookalikes.json').map((x) => x.url)
  ];
  for (const url of urls) assert.equal(scanAddress(url).overall.badge, null, `${url} (${fired(url).join(', ')})`);
});
