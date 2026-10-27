'use strict';
/**
 * companion-a11y  The companion's own pages after 1.18's changes, which the website's axe-core audit (30-perf-a11y)
 *                 does not reach: the toolbar popup, over a web chat with a scam link marked, and the settings page,
 *                 each in dark and in light. Every piece of text is readable against what is behind it (WCAG AA:
 *                 4.5 to 1, 3 to 1 for large text), every control has a name, and the keyboard's focus can be seen on
 *                 each stop as Tab walks the page. The 1.18 settings (Hints in web chats) are on and named.
 */
const { sleep, result, launch, evalIn, openPage, goto, shot, startServer, until, pressKey } = require('./_shared');
const { tlsServer, loadCompanion, pairedOptions } = require('./_companion');

const SCAM = 'https://paypa1-secure-login.com/account';

// In the page: text that fails contrast, controls without a name. Background images and gradients are left out
// (their colour under the text cannot be read from styles), as axe leaves them for a person to judge.
const AUDIT = `(() => {
  const rgb = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
  const behind = (el) => { const layers = []; for (let n = el; n; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage !== 'none') return null; const c = rgb(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = { r: 255, g: 255, b: 255, a: 1 }; for (const l of layers.reverse()) base = over(l, base); return base; };
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility === 'visible' && Number(cs.opacity) > 0.1; };
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!shown(el) || ['SCRIPT', 'STYLE', 'SVG', 'svg'].includes(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.nodeValue.trim()).map((n) => n.nodeValue.trim()).join(' ');
    if (!own) continue;
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color); const bg = behind(el);
    if (!fg || !bg) continue;
    const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const r = ratio(over(fg, bg), bg);
    if (r < need) bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' "' + own.slice(0, 40) + '" ' + r.toFixed(2) + ' < ' + need);
  }
  const nameless = [...document.querySelectorAll('a[href], button, input, select, textarea')].filter(shown).filter((c) => {
    const lab = c.labels && [...c.labels].map((l) => l.textContent.trim()).join('');
    return !((c.getAttribute('aria-label') || '').trim() || lab || (c.type !== 'checkbox' && (c.textContent || '').trim()) || (c.title || '').trim() || c.getAttribute('aria-labelledby'));
  }).map((c) => c.outerHTML.slice(0, 80));
  return { bad, nameless };
})()`;

// What the keyboard's focus looks like on the element that has it now: an outline or a ring of some kind.
const FOCUS = `(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e);
  const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
  return { what: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' ' + ((e.labels && e.labels[0] ? e.labels[0].textContent : e.textContent) || '').trim().slice(0, 30), ring: Boolean(ring) }; })()`;

async function walkFocus(browser, s, stops = 30) {
  const seen = [];
  for (let i = 0; i < stops; i++) {
    await pressKey(browser, s, 'Tab');
    await sleep(60);
    const f = await evalIn(browser, s, FOCUS);
    if (!f) continue;
    if (seen.length && seen[0].what === f.what) break;   // back round to the start
    seen.push(f);
  }
  return seen;
}

async function checkCompanionA11y() {
  const chats = await tlsServer(['discord.com', 'paypa1-secure-login.com'], (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Discord</title></head><body><main><ol data-list-id="chat-messages">
      <li id="chat-messages-1-1"><div><h3><span id="message-username-1">Jordan</span></h3><div id="message-content-1">Is this you? <a id="scam" href="${SCAM}">${SCAM}</a></div></div></li>
      <li id="chat-messages-1-2"><div><div id="message-content-2">Hi, I sent you a 6 digit code by mistake, can you send it to me?</div></div></li></ol></main></body></html>`);
  });
  const sentinel = await startServer('companion-a11y', { SENTINEL_DEVICE_ACCOUNTS: '1' });
  const { browser, close } = await launch([`--host-resolver-rules=${chats.rules}`, '--ignore-certificate-errors']);
  try {
    const t = await fetch(`${sentinel.base}/api/v1/auth/device`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: sentinel.base }, body: '{}' });
    const token = t.ok ? (await t.json()).token : null;
    if (!token) throw new Error('the test server gave no device account');
    const id = await loadCompanion(browser);
    const opt = await pairedOptions(browser, id, sentinel.base, token);
    const web = await openPage(browser);
    await goto(browser, web.sessionId, 'https://discord.com/channels/1/1');
    await until(browser, web.sessionId, "(() => { const n = document.getElementById('scam').nextElementSibling; return n && n.classList.contains('sentinel-masks'); })()", 20000);

    for (const scheme of ['dark', 'light']) {
      // The popup, opened over the chat (in the background, so the chat stays the active tab).
      await browser.send('Target.activateTarget', { targetId: web.targetId });
      const { targetId } = await browser.send('Target.createTarget', { url: `chrome-extension://${id}/src/popup.html`, background: true });
      const { sessionId: p } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, p);
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 600, deviceScaleFactor: 1, mobile: false }, p).catch(() => {});
      await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, p);
      await until(browser, p, "document.readyState === 'complete' && document.querySelector('.host') && !document.querySelector('#view .spin')", 30000);
      await sleep(800);
      const pop = await evalIn(browser, p, AUDIT);
      const popHost = await evalIn(browser, p, "(document.querySelector('.host') || {}).textContent || null");
      const popFocus = await walkFocus(browser, p, 12);
      await shot(browser, p, `companion-a11y-popup-${scheme}`);
      await browser.send('Target.closeTarget', { targetId }).catch(() => {});
      result(`companion-a11y: popup over a web chat, ${scheme}: all text readable, every control named`, popHost === 'discord.com' && !pop.bad.length && !pop.nameless.length, { host: popHost, ...pop });
      result(`companion-a11y: popup, ${scheme}: the keyboard's focus can be seen on every stop`, popFocus.length >= 2 && popFocus.every((f) => f.ring), popFocus);

      // The settings page.
      const o = opt.sessionId;
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }, o);
      await goto(browser, o, `chrome-extension://${id}/src/options.html`, "document.getElementById('chatHints') && document.readyState === 'complete'");
      await sleep(800);
      const set = await evalIn(browser, o, AUDIT);
      const hints = await evalIn(browser, o, "(() => { const c = document.getElementById('chatHints'); return { checked: c.checked, name: c.labels[0].querySelector('b').textContent }; })()");
      const setFocus = await walkFocus(browser, o, 60);
      await shot(browser, o, `companion-a11y-options-${scheme}`);
      result(`companion-a11y: settings, ${scheme}: all text readable, every control named, Hints in web chats on and named`,
        !set.bad.length && !set.nameless.length && hints.checked && hints.name === 'Hints in web chats', { hints, ...set });
      result(`companion-a11y: settings, ${scheme}: the keyboard's focus can be seen on every stop (${setFocus.length} stops)`, setFocus.length >= 8 && setFocus.every((f) => f.ring), setFocus.filter((f) => !f.ring));
    }
  } finally {
    await close();
    chats.close();
    await sentinel.stop();
  }
}

module.exports = checkCompanionA11y;
