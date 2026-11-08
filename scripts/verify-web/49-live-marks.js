'use strict';
/**
 * live-marks  The live-scanning marks at the size people meet them: the Windows overlay's (overlay.html's own
 *             stylesheet) and the companion's beside a result title (sentinel.css), every kind and severity, drawn by
 *             masks.js mark() on a white results page and a dark one, at 100%, 200%, on a phone, in greyscale and
 *             with Windows High Contrast. Proven on the photographs, not the markup: in every picture each severity's
 *             silhouette (what is left of a mark when colour is gone) must differ from the others by a set share of
 *             its pixels, and the gold mask must still be inside it.
 *
 *             The results page is a stand-in: the companion's stylesheet and drawing, placed in result titles by
 *             hand. serp-engines puts the real companion on real search pages.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, OUT, sleep, result, serveFiles, launch, evalIn, openPage, goto, readPng } = require('./_shared');

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const BADGES = ['red', 'orange', 'yellow'];
const KINDS = ['scam', 'virus', 'malware'];
// Two severities' silhouettes must differ in at least this share of the larger one's pixels.
const APART = 0.12;

function sheet() {
  const overlay = read('desktop/src/pages/overlay.html');
  const overlayCss = overlay.slice(overlay.indexOf('<style>') + 7, overlay.indexOf('</style>'));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Live marks</title><style>${overlayCss}</style><style>${read('extension/src/content/sentinel.css')}</style><style>
    html, body { overflow: visible; height: auto; margin: 0; background: #fff; }
    body { display: flex; flex-wrap: wrap; font: 14px/1.58 Arial, sans-serif; }
    .page { flex: 1 1 360px; padding: 18px 22px; background: #fff; color: #4d5156; }
    .page.dark { background: #202124; color: #bdc1c6; }
    .res { margin: 0 0 16px; } .res cite { display: block; font-style: normal; font-size: 12px; }
    .res h3 { margin: 2px 0; font: 400 20px/1.3 Arial, sans-serif; } .res h3 a { color: #1a0dab; text-decoration: none; } .dark .res h3 a { color: #99c3ff; }
    .res p { margin: 0; }
    .grid { display: grid; grid-template-columns: 64px repeat(3, 32px); gap: 6px 10px; align-items: center; margin-top: 8px; font-size: 12px; }
    .cell { position: relative; width: 32px; height: 32px; } .cell .mark { transform: translate(2px, 2px); }
  </style></head><body><script>${read('web/assets/js/masks.js')}</script><script>
    const M = SentinelMasks;
    const RESULTS = [
      ['paypa1-secure-login.com', 'PayPal: Log in to your account', [['scam', 'red']], 'Confirm your account within 24 hours to avoid suspension.'],
      ['pdf-free-convert.net', 'Free PDF converter, no sign up', [['virus', 'orange']], 'Download the converter and open any file.'],
      ['royalmail-redelivery.info', 'Royal Mail: your parcel is waiting', [['scam', 'yellow']], 'Pay the 1.99 redelivery fee to release it.'],
      ['www.paypal.com', 'PayPal Help Center', [], 'Answers about payments, accounts and refunds.'],
      ['chrome-update-now.com', 'Your browser is out of date', [['malware', 'red'], ['scam', 'orange']], 'Install the update to keep browsing safely.']
    ];
    const panel = (dark) => {
      const p = document.createElement('section'); p.className = 'page' + (dark ? ' dark' : ''); p.dataset.bg = dark ? 'dark' : 'light';
      for (const [site, title, marks, snippet] of RESULTS) {
        const r = document.createElement('div'); r.className = 'res';
        r.innerHTML = '<cite></cite><h3><a href="#"></a></h3><p></p>';
        r.querySelector('cite').textContent = site; r.querySelector('a').textContent = title; r.querySelector('p').textContent = snippet;
        const g = document.createElement('span'); g.className = 'sentinel-masks' + (marks.length ? '' : ' sentinel-masks--clear');
        for (const [kind, badge] of marks) {
          const m = document.createElement('span'); m.className = 'sentinel-mask sentinel-mask--' + badge;
          m.dataset.kind = kind; m.dataset.badge = badge; m.dataset.who = 'companion';
          m.setAttribute('aria-label', 'Sentinel: ' + M.SEVERITY[badge] + ', ' + kind);
          m.innerHTML = M.mark(kind, badge); g.appendChild(m);
        }
        if (!marks.length) { const m = document.createElement('span'); m.className = 'sentinel-mask sentinel-mask--clear'; m.innerHTML = M.tick(); g.appendChild(m); }
        r.querySelector('h3').appendChild(g); p.appendChild(r);
      }
      const grid = document.createElement('div'); grid.className = 'grid';
      for (const badge of ['red', 'orange', 'yellow', null]) {
        const label = document.createElement('span'); label.textContent = badge ? M.SEVERITY[badge] : 'Nothing found'; grid.appendChild(label);
        for (const kind of ['scam', 'virus', 'malware']) {
          const cell = document.createElement('div'); cell.className = 'cell';
          if (badge || kind === 'scam') {
            const n = document.createElement('div'); n.className = 'mark is-on ' + (badge ? 'is-' + badge : 'is-clear');
            n.style.setProperty('--c', M.COLORS[badge || 'clear']);
            n.innerHTML = badge ? M.mark(kind, badge) : M.tick();
            if (badge) { n.dataset.kind = kind; n.dataset.badge = badge; n.dataset.who = 'overlay'; }
            cell.appendChild(n);
          }
          grid.appendChild(cell);
        }
      }
      p.appendChild(grid);
      return p;
    };
    document.body.append(panel(false), panel(true));
  </script></body></html>`;
}

/* ------------------------------------------------------------ the pixels */

const lum = (img, x, y) => {
  const i = (y * img.w + x) * img.bpp;
  return 0.299 * img.px[i] + 0.587 * img.px[i + 1] + 0.114 * img.px[i + 2];
};

/**
 * What a mark looks like with colour gone: inside its box, every pixel that stands apart from the page, and everything
 * those enclose (the dark tile on a dark page is filled in by its ring). A binary picture plus its centre of mass.
 */
function silhouette(img, box) {
  const { x0, y0, w, h } = box;
  const L = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) L[y * w + x] = lum(img, Math.min(img.w - 1, x0 + x), Math.min(img.h - 1, y0 + y));
  // The page's own shade: the commonest along the box's edge (the forced palette changes it in High Contrast).
  const edge = [];
  for (let x = 0; x < w; x++) edge.push(L[x], L[(h - 1) * w + x]);
  for (let y = 0; y < h; y++) edge.push(L[y * w], L[y * w + w - 1]);
  edge.sort((a, b) => a - b);
  const bg = edge[edge.length >> 1];
  const ink = (i) => Math.abs(L[i] - bg) > 28;
  const out = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (out[i] || ink(i)) continue;
    out[i] = 1;
    const x = i % w; const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  const on = new Uint8Array(w * h);
  let n = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < w * h; i++) if (!out[i]) { on[i] = 1; n++; cx += i % w; cy += (i / w) | 0; }
  return { w, h, on, n, cx: n ? cx / n : 0, cy: n ? cy / n : 0, L, bg };
}

/** The share of pixels two silhouettes do not have in common, laid over each other by their centres of mass. */
function apart(a, b) {
  const dx = Math.round(b.cx - a.cx);
  const dy = Math.round(b.cy - a.cy);
  let diff = 0;
  for (let y = -4; y < a.h + 4; y++) {
    for (let x = -4; x < a.w + 4; x++) {
      const inA = x >= 0 && y >= 0 && x < a.w && y < a.h ? a.on[y * a.w + x] : 0;
      const bx = x + dx; const by = y + dy;
      const inB = bx >= 0 && by >= 0 && bx < b.w && by < b.h ? b.on[by * b.w + bx] : 0;
      if (inA !== inB) diff++;
    }
  }
  return diff / Math.max(a.n, b.n, 1);
}

/** How tall the gold is inside the silhouette, in CSS pixels: bright pixels away from the page around it. */
function goldHeight(s, dpr) {
  let top = -1; let bottom = -1;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = y * s.w + x;
      if (!s.on[i] || s.L[i] < 120) continue;
      // Not the ring: the ring touches the outside within a couple of pixels, the mask does not.
      const r = Math.ceil(2.5 * dpr);
      let inner = true;
      for (let k = -r; k <= r && inner; k += r) for (let j = -r; j <= r && inner; j += r) {
        const xx = x + k; const yy = y + j;
        if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h || !s.on[yy * s.w + xx]) inner = false;
      }
      if (!inner) continue;
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return top < 0 ? 0 : Number(((bottom - top + 1) / dpr).toFixed(1));
}

/* ------------------------------------------------------------- the check */

const VIEWS = [
  // [name, width, height, scale, forced colours, greyscale, mobile]
  ['1x', 1180, 700, 1, false, false, false],
  ['2x', 1180, 700, 2, false, false, false],
  ['grey', 1180, 700, 1, false, true, false],
  ['high-contrast', 1180, 700, 1, true, false, false],
  ['phone', 390, 1400, 3, false, false, true]
];

async function checkLiveMarks() {
  const files = await serveFiles({}, { '/marks.html': sheet() });
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const ev = (expr) => evalIn(browser, s, expr);
    for (const [name, width, height, dpr, forced, grey, mobile] of VIEWS) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile }, s);
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forced ? 'active' : 'none' }, { name: 'prefers-reduced-motion', value: 'reduce' }] }, s);
      await goto(browser, s, `${files.base}/marks.html`, "document.querySelectorAll('[data-badge]').length > 0");
      if (grey) await ev("document.documentElement.style.filter = 'grayscale(1)'; true");
      await sleep(700);
      const size = await ev('({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })');
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 } }, s);
      const png = Buffer.from(data, 'base64');
      fs.writeFileSync(path.join(OUT, `live-marks-${name}.png`), png);
      const img = readPng(png);
      const marks = await ev(`[...document.querySelectorAll('[data-badge]')].map((n) => {
        const r = n.querySelector('svg').getBoundingClientRect();
        return { who: n.dataset.who, kind: n.dataset.kind, badge: n.dataset.badge, bg: n.closest('[data-bg]').dataset.bg, title: n.closest('h3') ? n.closest('h3').querySelector('a').textContent : '',
          x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      })`);
      const shapes = marks.map((m) => {
        const pad = 2;
        const box = { x0: Math.max(0, Math.floor((m.x - pad) * dpr)), y0: Math.max(0, Math.floor((m.y - pad) * dpr)), w: Math.ceil((m.w + 2 * pad) * dpr), h: Math.ceil((m.h + 2 * pad) * dpr) };
        const sh = silhouette(img, box);
        return { ...m, sh, gold: goldHeight(sh, dpr), fill: Number((sh.n / (box.w * box.h)).toFixed(2)) };
      });

      // Every severity against every other, for the same mask, drawer and page: the overlay's grid, and the companion's
      // two first-row kinds where the results page has them.
      const pairs = [];
      for (const who of ['overlay', 'companion']) {
        for (const bg of ['light', 'dark']) {
          for (const kind of KINDS) {
            const of = (b) => shapes.find((m) => m.who === who && m.bg === bg && m.kind === kind && m.badge === b);
            for (let i = 0; i < BADGES.length; i++) {
              for (let j = i + 1; j < BADGES.length; j++) {
                const a = of(BADGES[i]); const b = of(BADGES[j]);
                if (a && b) pairs.push({ who, bg, kind, pair: `${BADGES[i]}/${BADGES[j]}`, apart: Number(apart(a.sh, b.sh).toFixed(3)) });
              }
            }
          }
        }
      }
      // The companion's results: scam red/yellow and scam yellow/orange are on the page, virus and malware once each.
      const alike = pairs.filter((p) => p.apart < APART);
      result(`live-marks: ${name}: each severity is its own silhouette without colour, on a white page and a dark one (${pairs.length} pairs, at least ${APART * 100}% apart)`,
        pairs.length >= 18 && !alike.length,
        [`closest: ${JSON.stringify(pairs.slice().sort((a, b) => a.apart - b.apart).slice(0, 4))}`, ...alike.map((p) => `too alike: ${JSON.stringify(p)}`)]);

      const faint = shapes.filter((m) => m.fill < 0.3 || m.gold < (m.kind === 'scam' ? 9 : 6));
      result(`live-marks: ${name}: every mark stands out from the page and its gold mask is inside it, at a readable height`,
        shapes.length >= 24 && !faint.length,
        [`marks: ${shapes.length}, gold height in CSS px (overlay / companion): ${KINDS.map((k) => `${k} ${BADGES.map((b) => shapes.filter((m) => m.kind === k && m.badge === b && m.bg === 'light').map((m) => m.gold).join('/')).join(' ')}`).join('; ')}`,
          ...faint.map((m) => `faint: ${JSON.stringify({ who: m.who, kind: m.kind, badge: m.badge, bg: m.bg, fill: m.fill, gold: m.gold })}`)]);
    }
  } finally { await close(); files.server.close(); }
}

module.exports = checkLiveMarks;
