'use strict';
/**
 * serp-engines  The companion's marks on search engines whose real pages companion-core often never reaches from a CI
 *               runner (each shows it a bot check or a consent page): Google (google.com, and a country's own Google
 *               such as google.co.za), Bing, DuckDuckGo (its main page and its HTML page), Brave Search, Yahoo
 *               (search.yahoo.com and a country's own, uk.search.yahoo.com) and Yahoo Japan (search.yahoo.co.jp). Each
 *               is a stand-in at its real address with the real Sentinel server behind the companion. Every result
 *               gets a mark, the listed scam a red one, and no result is ever opened.
 *
 *               Where each stand-in's markup comes from (fetched with curl, no browser, 2026-10-28):
 *               - Bing, DuckDuckGo HTML, Brave Search, Yahoo Japan: copied from the real results page, trimmed to each
 *                 result's elements and classes (images, tracking pings and scripts left out), links wrapped as there
 *                 (Bing's /ck/a?u=a1<base64>, DuckDuckGo's //duckduckgo.com/l/?uddg=; Brave and Yahoo Japan link straight).
 *               - Google, DuckDuckGo's main page, Yahoo and Yahoo UK: still written by hand. Google and DuckDuckGo's main
 *                 page build their results with scripts, so a fetched page holds none, and Yahoo answered curl with an
 *                 error. These follow the classes the companion reads (content/serp.js ENGINES), not a copy of the page.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer } = require('./_shared');
const { tlsServer, loadCompanion, pairedOptions } = require('./_companion');

const SCAM = 'https://paypa1-secure-login.com/account';   // a listed scam (server/lib/scan/lists.js)
const HONEST = ['https://www.wikipedia.org/', 'https://github.com/'];
const LINK_HOSTS = ['paypa1-secure-login.com', 'www.wikipedia.org', 'github.com', 'r.search.yahoo.com'];

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font:14px/1.5 Arial,sans-serif;margin:0;padding:24px 40px;background:#fff;color:#202124}h2,h3{font-size:18px;margin:4px 0}</style></head><body>${body}</body></html>`;
const enc = encodeURIComponent;
// [address, title, the site's own name]
const SITES = [[HONEST[0], 'Wikipedia', 'Wikipedia'], [SCAM, 'PayPal: Log in to your account', 'PayPal'], [HONEST[1], 'GitHub', 'GitHub']];
const results = (wrap, one) => SITES.map(([url, title, site], i) => one(wrap(url), title, i, new URL(url), site)).join('');

// Written by hand (see above): the classes the companion reads.
const google = (wrapScam) => page('paypal login - Google Search', `<div id="search"><div id="rso">${results((u) => (wrapScam && u === SCAM ? `/url?q=${enc(u)}&sa=U&ved=2ah` : u),
  (href, title) => `<div class="g" data-hveid="CA${title.length}"><div><a href="${href}" data-ved="2ah"><br><h3 class="LC20lb">${title}</h3><div><cite>${title}</cite></div></a></div></div>`)}</div></div>`);
const PAGES = {
  'www.google.com/search': google(true),
  'www.google.co.za/search': google(false),
  'duckduckgo.com/': page('paypal login at DuckDuckGo', `<ol class="react-results--main">${results((u) => u,
    (href, title) => `<li data-layout="organic"><article data-testid="result"><h2><a data-testid="result-title-a" href="${href}" rel="noopener"><span>${title}</span></a></h2></article></li>`)}</ol>`),
  // Copied from www.bing.com/search: ol#b_results > li.b_algo, its site line and its h2 title both through /ck/a.
  'www.bing.com/search': page('paypal login - Search', `<ol id="b_results" class="">${results((u) => `https://www.bing.com/ck/a?!&amp;&amp;p=436ed1a9a09f655b&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;u=a1${Buffer.from(u).toString('base64url')}&amp;ntb=1`,
    (href, title, i, url, site) => `<li class="b_algo" data-id iid=SERP.${5340 + i}><div class="b_tpcn"><a class="tilk" aria-label="${url.hostname}" tabindex="-1" target="_blank" href="${href}" h="ID=SERP,5141.1"><div class="tpic"></div><div class="tptxt"><div class="tptt">${site}</div><div class="tpmeta"><div class="b_attribution" tabindex="-1"><cite>${url.origin}</cite></div></div></div></a></div><h2><a target="_blank" href="${href}" h="ID=SERP,5141.2">${title}</a></h2><div class="b_caption"><p class="b_lineclamp2">${title}.</p></div></li>`)}</ol>`),
  // Copied from html.duckduckgo.com/html/: div#links > div.result.web-result, its title, site line and snippet all through /l/?uddg=.
  'html.duckduckgo.com/html/': page('paypal login at DuckDuckGo', `<div class="serp__results"><div id="links" class="results">${results((u) => `//duckduckgo.com/l/?uddg=${enc(u)}&amp;rut=753d4979b8845acb`,
    (href, title, i, url) => `<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body"><h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2><div class="result__extras"><div class="result__extras__url"><span class="result__icon"><a rel="nofollow" href="${href}"></a></span><a class="result__url" href="${href}">${url.hostname}</a></div></div><a class="result__snippet" href="${href}">${title}.</a><div class="clear"></div></div></div>`)}</div></div>`),
  // Copied from search.brave.com/search: section#mixed-main > div.snippet[data-type=web], its link holding the site name and div.title.
  'search.brave.com/search': page('paypal login - Brave Search', `<main class="main-column"><section id="mixed-main">${results((u) => u,
    (href, title, i, url, site) => `<div class="snippet svelte-jmfu5f" data-pos="${i + 1}" data-type="web" data-keynav="true"><div class="result-body svelte-1rq4ngz"><div class="result-wrapper svelte-1rq4ngz"><div class="result-content svelte-1rq4ngz"><a href="${href}" target="_self" class="svelte-14r20fy l1"><div class="site-name-wrapper svelte-on1hvy"><div class="site-name-content svelte-on1hvy"><div class="desktop-small-semibold t-secondary text-ellipsis">${site}</div> <div class="url-wrapper svelte-on1hvy"><cite class="snippet-url desktop-small-regular t-tertiary svelte-on1hvy">${url.hostname} <span class="text-ellipsis"></span></cite> </div></div> </div> <div class="title search-snippet-title line-clamp-1 svelte-14r20fy" title="${title}">${title}</div></a> <div class="generic-snippet svelte-1cwdgg3"><div class="content desktop-default-regular t-primary line-clamp-dynamic svelte-1cwdgg3">${title}.</div></div></div></div></div></div>`)}</section></main>`),
  // Copied from search.yahoo.co.jp/search: div.sw-CardBase > div.sw-Card.Algo, its title link holding the h3 and the cite.
  'search.yahoo.co.jp/search': page('paypal login - Yahoo! JAPAN', `<div id="contents"><div id="contents__wrap">${results((u) => u,
    (href, title, i, url, site) => `<div class="sw-CardBase"><div class="sw-Card Algo Algo-anotherSuggest"><section><div class="sw-Card__section sw-Card__section--header"><div class="sw-Card__headerSpace"><div class="sw-Card__title"><a href="${href}" class="sw-Card__titleInner" data-cl-params="_cl_vmodule:sr;_cl_link:title;_cl_position:${i}" data-a11y-main-content="1"><br/><h3 class="sw-Card__titleMain sw-Card__titleMain--clamp sw-Card__titleMain--siteName util-Clamps--2"><span>${title}</span></h3><div class="sw-Card__titleCiteWrapper"><div class="sw-Cite Algo__cite"><div class="sw-Cite__text"><span class="sw-Cite__textSiteName util-Clamps--1">${site}</span><div class="sw-Cite__textUrl"><cite>${url.origin}</cite></div></div></div></div></a></div></div></div><div class="sw-Card__section"><div class="sw-Card__space"><div class="sw-Card__floatContainer"><p class="sw-Card__summary">${title}.</p></div></div></div></section></div></div>`)}</div></div>`),
  'search.yahoo.com/search': null,
  'uk.search.yahoo.com/search': null
};
PAGES['search.yahoo.com/search'] = PAGES['uk.search.yahoo.com/search'] = page('paypal login - Yahoo Search Results', `<div id="web"><ol>${results(
  (u) => `https://r.search.yahoo.com/_ylt=AwrFq1/RV=2/RE=1790000000/RO=10/RU=${enc(u).toLowerCase()}/RK=2/RS=Xy7-`,
  (href, title) => `<li><div class="algo"><div class="compTitle"><h3 class="title"><a class="ac-algo" href="${href}">${title}</a></h3></div></div></li>`)}</ol></div>`);
const ENGINES = [
  ['Google', 'www.google.com/search?q=paypal+login'],
  ['Google in South Africa (google.co.za)', 'www.google.co.za/search?q=paypal+login'],
  ['Bing', 'www.bing.com/search?q=paypal+login'],
  ['DuckDuckGo', 'duckduckgo.com/?q=paypal+login'],
  ['DuckDuckGo HTML', 'html.duckduckgo.com/html/?q=paypal+login'],
  ['Brave Search', 'search.brave.com/search?q=paypal+login'],
  ['Yahoo', 'search.yahoo.com/search?p=paypal+login'],
  ['Yahoo UK (uk.search.yahoo.com)', 'uk.search.yahoo.com/search?p=paypal+login'],
  ['Yahoo Japan (search.yahoo.co.jp)', 'search.yahoo.co.jp/search?p=paypal+login']
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

    const opened = seen.filter((u) => LINK_HOSTS.some((h) => u.startsWith(`${h}/`)) || u.startsWith('www.bing.com/ck/') || u.startsWith('duckduckgo.com/l/'));
    result('serp-engines: no result was opened or fetched by the browser', !opened.length, { opened, pages: seen.length });
  } finally {
    await close();
    sites.close();
    await sentinel.stop();
  }
}

module.exports = checkSerpEngines;
