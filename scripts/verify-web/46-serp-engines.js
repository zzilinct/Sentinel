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

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
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
// A Bing title one letter short of its line, in monospace so it is the same on every runner (live Bing, run
// 44430566186: one title wrapped once its mark was in). The mark must not push it onto a second line.
const LONG = 'Wikipedia, the free encyclopedia that anyone can edit';
PAGES['www.bing.com/search/long'] = page('long title - Search', `<style>#b_results { font: 18px/24px monospace; width: ${LONG.length + 1}ch; padding: 0; list-style: none; } #b_results h2 { font: inherit; }</style><ol id="b_results">
  <li class="b_algo"><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=436ed1a9a09f655b&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;u=a1${Buffer.from(HONEST[0]).toString('base64url')}&amp;ntb=1">${LONG}</a></h2></li></ol>`);
// The same for a title of two lines whose second is one letter short of full: the marks must not make a third.
const TWO = 'Wikipedia, the free encyclopedia that anyone';
PAGES['www.bing.com/search/two'] = page('two lines - Search', `<style>#b_results { font: 18px/24px monospace; width: 25ch; padding: 0; list-style: none; } #b_results h2 { font: inherit; }</style><ol id="b_results">
  <li class="b_algo"><h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=436ed1a9a09f655b&amp;ptn=3&amp;ver=2&amp;hsh=4&amp;u=a1${Buffer.from(HONEST[0]).toString('base64url')}&amp;ntb=1">${TWO}</a></h2></li></ol>`);
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

// Hover reasons: a mark explains itself in the companion's tip (hover.js) after the pointer rests, and at once for the
// keyboard's focus, in the same words its name gives a screen reader. Photographed in dark, light and at phone width.
async function checkTips(browser, s) {
  // The tip's own lines (heading, reason, site), read through its closed shadow root.
  const tipLines = async () => {
    const { root } = await browser.send('DOM.getDocument', { depth: -1, pierce: true }, s);
    const out = [];
    const walk = (n, inTip) => {
      const tip = inTip || (n.attributes || []).includes('data-sentinel-hover');
      if (tip && n.nodeType === 3 && n.nodeValue.trim()) out.push(n.nodeValue.trim());
      if (n.nodeName === 'STYLE') return;
      for (const c of [...(n.shadowRoots || []), ...(n.children || [])]) walk(c, tip);
    };
    walk(root, false);
    return out;
  };
  const tipText = async () => (await tipLines()).join(' | ');
  const centre = (sel) => evalIn(browser, s, `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
  const mouse = async ([x, y]) => browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s);
  const away = async () => { await mouse([5, 5]); await sleep(400); };
  const hover = async (sel) => { await away(); await mouse(await centre(sel)); await sleep(120); const early = await tipText(); await sleep(700); return { early, tip: await tipText() }; };
  const scheme = (value) => browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] }, s);

  await scheme('dark');
  const red = await hover('.sentinel-mask--red');
  const name = await evalIn(browser, s, "({ label: document.querySelector('.sentinel-mask--red').getAttribute('aria-label'), titles: document.querySelectorAll('.sentinel-mask[title]').length })");
  await shot(browser, s, 'hover-reason-red-dark');
  const [head, reason = '', site] = red.tip.split(' | ');
  result('hover reasons: resting on a red mark shows, after a short rest, "Danger:", the label, one plain reason and the site; its name says the same',
    !red.early && /^Danger: /.test(head) && reason.length > 8 && reason.length <= 110 && !/—/.test(red.tip) && site === 'paypa1-secure-login.com'
      && name.label.includes(reason) && name.titles === 0, { ...red, name });
  await scheme('light');
  await hover('.sentinel-mask--red');
  await shot(browser, s, 'hover-reason-red-light');
  const clear = await hover('.sentinel-mask--clear');
  await shot(browser, s, 'hover-reason-clear-light');
  result('hover reasons: a clear mark says only that nothing was found, with no reason and no "safe"',
    /^(No warning signs found|A verified site)/.test(clear.tip) && !/safe|danger|scam/i.test(clear.tip), clear);
  await away();

  // Caution in the tip, drawn by the tip's own paint() in the companion's world (no listed site is only a caution):
  // on a light page its words are caution's ink and its mask yellow edged in that ink, as the app draws them; on dark,
  // the yellow itself. Read through the closed shadow root with chrome.dom, from the same world.
  const worlds = [];
  const onCtx = (p, sid) => { if (sid === s && p.context.auxData && p.context.auxData.type === 'isolated') worlds.push(p.context.id); };
  browser.on('Runtime.executionContextCreated', onCtx);
  await browser.send('Runtime.disable', {}, s);
  await browser.send('Runtime.enable', {}, s);
  let world = null;
  for (const id of worlds) if (await evalIn(browser, s, 'typeof window.__sentinelTip === "object"', { contextId: id }).catch(() => false)) world = id;
  const caution = {};
  for (const sc of ['light', 'dark']) {
    await scheme(sc);
    caution[sc] = world == null ? { world: 'not found' } : await evalIn(browser, s, `(async () => {
      const t = window.__sentinelTip;
      t.paint(document.querySelector('.sentinel-mask--red'), t.lineFor({ host: 'deals-today.example', reasons: [{ threat: 'malware', plain: 'The site is three days old.' }],
        threats: { malware: { badge: 'yellow', label: 'Possible malware' } } }, 'malware'), true);
      await new Promise((r) => setTimeout(r, 450));
      const root = chrome.dom.openOrClosedShadowRoot(document.querySelector('[data-sentinel-hover]'));
      const tip = root.querySelector('.tip'), b = getComputedStyle(root.querySelector('.tip b')), p = getComputedStyle(root.querySelector('.tip svg path'));
      return { status: tip.dataset.status, head: b.color, fill: p.fill, edge: p.stroke };
    })()`, { contextId: world });
    await shot(browser, s, `hover-reason-caution-${sc}`);
    if (world != null) await evalIn(browser, s, 'window.__sentinelTip.hide(), true', { contextId: world });
  }
  const rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ')})`;
  const { CAUTION_INK, STATUS } = require('../../web/assets/js/look.js');
  result('hover reasons: a caution tip on a light page says its words in caution\'s ink and edges its yellow mask in it, as the app does; on dark, yellow',
    caution.light.status === 'yellow' && caution.light.head === rgb(CAUTION_INK) && caution.light.fill === rgb(STATUS.light.yellow) && caution.light.edge === rgb(CAUTION_INK)
      && caution.dark.head === rgb(STATUS.dark.yellow) && caution.dark.edge === 'none', caution);
  await away();
  await scheme('dark');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, s);
  await evalIn(browser, s, "document.querySelector('.sentinel-mask--red').focus(), true");
  await sleep(300);
  const focused = await tipText();
  const fits = await evalIn(browser, s, "innerWidth");
  await shot(browser, s, 'hover-reason-red-phone-focus');
  await evalIn(browser, s, "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), true");
  await sleep(400);
  const closed = await tipText();
  await browser.send('Emulation.clearDeviceMetricsOverride', {}, s);
  result('hover reasons: the keyboard\'s focus shows the same tip at once, at phone width too, and Escape closes it',
    focused === red.tip && !closed && fits === 390, { focused, closed, width: fits });
}

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
      if (name === 'Google') await checkTips(browser, s);
    }

    await goto(browser, s, 'https://www.bing.com/search/long?q=wikipedia');
    let long = null;
    for (let i = 0; i < 60 && !(long && long.marked); i++) {
      await sleep(250);
      long = await evalIn(browser, s, `(() => {
        const h = document.querySelector('#b_results h2'), g = h.querySelector('.sentinel-masks');
        if (!g) return { marked: 0 };
        const box = h.getBoundingClientRect(), m = g.getBoundingClientRect();
        return { marked: 1, height: Math.round(box.height), line: parseFloat(getComputedStyle(h).lineHeight), inside: m.right <= box.right + 0.5 && m.width > 0 && m.top >= box.top - 0.5 && m.bottom <= box.bottom + 0.5,
          cut: h.scrollWidth > h.clientWidth || getComputedStyle(h).textOverflow === 'ellipsis' };
      })()`);
    }
    await sleep(500);
    await shot(browser, s, 'serp-engines-bing-long-title');
    result('serp-engines: a Bing title one letter short of its line keeps to one line once its mark is in (it ends in an ellipsis), and the mark stays on that line',
      Boolean(long && long.marked && long.height <= long.line * 1.2 && long.inside), long);

    await goto(browser, s, 'https://www.bing.com/search/two?q=wikipedia');
    let two = null;
    for (let i = 0; i < 60 && !(two && two.marked); i++) {
      await sleep(250);
      two = await evalIn(browser, s, `(() => {
        const h = document.querySelector('#b_results h2'), g = h.querySelector('.sentinel-masks');
        if (!g) return { marked: 0 };
        const box = h.getBoundingClientRect(), m = g.getBoundingClientRect(), line = parseFloat(getComputedStyle(h).lineHeight);
        // The title's own lines, from a copy without the marks (the page may have marked it before this read).
        const c = h.cloneNode(true); c.querySelectorAll('.sentinel-masks').forEach((x) => x.remove()); c.removeAttribute('class'); c.removeAttribute('style'); h.parentNode.appendChild(c);
        const own = Math.round(c.getBoundingClientRect().height / line); c.remove();
        return { marked: 1, own, lines: Math.round(box.height / line), inside: m.right <= box.right + 0.5 && m.width > 0 && m.top >= box.top - 0.5 && m.bottom <= box.bottom + 0.5 };
      })()`);
    }
    await sleep(500);
    await shot(browser, s, 'serp-engines-bing-two-line-title');
    result('serp-engines: a Bing title of two lines keeps to two once its mark is in (it ends in an ellipsis), and the mark stays inside it',
      Boolean(two && two.marked && two.own === 2 && two.lines === 2 && two.inside), two);

    const opened = seen.filter((u) => LINK_HOSTS.some((h) => u.startsWith(`${h}/`)) || u.startsWith('www.bing.com/ck/') || u.startsWith('duckduckgo.com/l/'));
    result('serp-engines: no result was opened or fetched by the browser', !opened.length, { opened, pages: seen.length });
  } finally {
    await close();
    sites.close();
    await sentinel.stop();
  }
}

module.exports = checkSerpEngines;
