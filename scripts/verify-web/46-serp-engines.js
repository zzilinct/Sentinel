'use strict';
/**
 * serp-engines  The companion's marks on search engines other than Bing, which the real pages in companion-core never
 *               reach from a CI runner (each shows it a bot check or a consent page): Google (google.com, and a
 *               country's own Google such as google.co.za), DuckDuckGo (its main page and its HTML page), Brave Search
 *               and Yahoo (search.yahoo.com and a country's own, uk.search.yahoo.com). Each is a stand-in at its real
 *               address, its results written the way that engine writes them, links wrapped the way it wraps them
 *               (Google's /url?q=, DuckDuckGo's /l/?uddg=, Yahoo's r.search.yahoo.com/.../RU=), with the real Sentinel
 *               server behind the companion. Every result gets a mark, the listed scam a red one, and no result is
 *               ever opened.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer } = require('./_shared');
const { tlsServer, loadCompanion, pairedOptions } = require('./_companion');

const SCAM = 'https://paypa1-secure-login.com/account';   // a listed scam (server/lib/scan/lists.js)
const HONEST = ['https://www.wikipedia.org/', 'https://github.com/'];
const LINK_HOSTS = ['paypa1-secure-login.com', 'www.wikipedia.org', 'github.com', 'r.search.yahoo.com'];

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font:14px/1.5 Arial,sans-serif;margin:0;padding:24px 40px;background:#fff;color:#202124}h2,h3{font-size:18px;margin:4px 0}</style></head><body>${body}</body></html>`;
const enc = encodeURIComponent;
const results = (wrap, one) => [[HONEST[0], 'Wikipedia'], [SCAM, 'PayPal: Log in to your account'], [HONEST[1], 'GitHub']].map(([url, title], i) => one(wrap(url), title, i)).join('');

// Each engine's results as it writes them, as far as the companion reads them (content/serp.js ENGINES and unwrap).
const google = (wrapScam) => page('paypal login - Google Search', `<div id="search"><div id="rso">${results((u) => (wrapScam && u === SCAM ? `/url?q=${enc(u)}&sa=U&ved=2ah` : u),
  (href, title) => `<div class="g" data-hveid="CA${title.length}"><div><a href="${href}" data-ved="2ah"><br><h3 class="LC20lb">${title}</h3><div><cite>${title}</cite></div></a></div></div>`)}</div></div>`);
const PAGES = {
  'www.google.com/search': google(true),
  'www.google.co.za/search': google(false),
  'duckduckgo.com/': page('paypal login at DuckDuckGo', `<ol class="react-results--main">${results((u) => u,
    (href, title) => `<li data-layout="organic"><article data-testid="result"><h2><a data-testid="result-title-a" href="${href}" rel="noopener"><span>${title}</span></a></h2></article></li>`)}</ol>`),
  'html.duckduckgo.com/html/': page('paypal login at DuckDuckGo', `<div id="links" class="results">${results((u) => `//duckduckgo.com/l/?uddg=${enc(u)}&rut=4f2a`,
    (href, title) => `<div class="result results_links"><h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2></div>`)}</div>`),
  'search.brave.com/search': page('paypal login - Brave Search', `<main><div id="results">${results((u) => u,
    (href, title) => `<div class="snippet" data-type="web"><a href="${href}" class="h"><div class="title search-snippet-title">${title}</div></a></div>`)}</div></main>`),
  'search.yahoo.com/search': null,
  'uk.search.yahoo.com/search': null
};
PAGES['search.yahoo.com/search'] = PAGES['uk.search.yahoo.com/search'] = page('paypal login - Yahoo Search Results', `<div id="web"><ol>${results(
  (u) => `https://r.search.yahoo.com/_ylt=AwrFq1/RV=2/RE=1790000000/RO=10/RU=${enc(u).toLowerCase()}/RK=2/RS=Xy7-`,
  (href, title) => `<li><div class="algo"><div class="compTitle"><h3 class="title"><a class="ac-algo" href="${href}">${title}</a></h3></div></div></li>`)}</ol></div>`);
const ENGINES = [
  ['Google', 'www.google.com/search?q=paypal+login'],
  ['Google in South Africa (google.co.za)', 'www.google.co.za/search?q=paypal+login'],
  ['DuckDuckGo', 'duckduckgo.com/?q=paypal+login'],
  ['DuckDuckGo HTML', 'html.duckduckgo.com/html/?q=paypal+login'],
  ['Brave Search', 'search.brave.com/search?q=paypal+login'],
  ['Yahoo', 'search.yahoo.com/search?p=paypal+login'],
  ['Yahoo UK (uk.search.yahoo.com)', 'uk.search.yahoo.com/search?p=paypal+login']
];

async function checkSerpEngines() {
  const seen = [];
  const hosts = [...new Set(ENGINES.map(([, u]) => u.split('/')[0]))];
  const sites = await tlsServer([...hosts, ...LINK_HOSTS], (req, res, host) => {
    seen.push(`${host}${req.url}`);
    const html = PAGES[`${host}${req.url.split('?')[0]}`];
    res.writeHead(html ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html || 'not found');
  });
  const sentinel = await startServer('serp-engines', { SENTINEL_DEVICE_ACCOUNTS: '1' });
  const { browser, close } = await launch([`--host-resolver-rules=${sites.rules}`, '--ignore-certificate-errors']);
  try {
    const t = await fetch(`${sentinel.base}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: sentinel.base }, body: '{}' });
    const token = t.ok ? (await t.json()).token : null;
    if (!token) throw new Error('the test server gave no device account');
    const id = await loadCompanion(browser);
    await pairedOptions(browser, id, sentinel.base, token);
    const { sessionId: s } = await openPage(browser);

    for (const [name, where] of ENGINES) {
      await goto(browser, s, `https://${where}`);
      let got = null;
      for (let i = 0; i < 60; i++) {
        got = await evalIn(browser, s, `(() => {
          const groups = [...document.querySelectorAll('.sentinel-masks')];
          const red = groups.filter((g) => g.querySelector('.sentinel-mask--red')).map((g) => (g.closest('h2, h3, a') || g).textContent.trim().slice(0, 40));
          return { results: 3, marked: groups.length, red, clear: groups.filter((g) => g.classList.contains('sentinel-masks--clear')).length };
        })()`);
        if (got.marked >= 3) break;
        await sleep(250);
      }
      await sleep(300);
      await shot(browser, s, `serp-engines-${name.toLowerCase().replace(/\W+/g, '-').replace(/-+$/, '')}`);
      result(`serp-engines: ${name}: every result is marked, the listed scam red and only that one`,
        got.marked === 3 && got.red.length === 1 && /PayPal/.test(got.red[0]), got);
    }

    const opened = seen.filter((u) => LINK_HOSTS.some((h) => u.startsWith(`${h}/`)));
    result('serp-engines: no result was opened or fetched by the browser', !opened.length, { opened, pages: seen.length });
  } finally {
    await close();
    sites.close();
    await sentinel.stop();
  }
}

module.exports = checkSerpEngines;
