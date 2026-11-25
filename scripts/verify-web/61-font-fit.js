'use strict';
/**
 * font-fit  Each stand-in face in web/assets/fonts/fonts.css, measured against the real face it stands in for, in
 *           Chrome: the width of a line of English and the height of its line box, at the sizes the product uses.
 *           A stand-in drawn too wide or too narrow moves the page when the real font arrives. The Windows and Mac
 *           stand-ins (Georgia, Arial) are on every runner; the Android ones (Noto Serif, Roboto) are installed on this
 *           runner by verify-web.yml, from Google Fonts' own files, so they are measured too, not scaled from the others.
 *           The hero wordmark (capitals at 72px and up, the largest optical size) has its own stand-in.
 *           A face the machine does not have is said, never skipped silently: the check fails on a runner without it.
 */
const { result, launch, evalIn, goto, startServer, openPage } = require('./_shared');

const TEXT = 'Check a link before you click it. Sentinel looks at the address, the page and the sender, and tells you plainly what it finds.';
// [what, the real face, the stand-ins, weights, sizes, text, letter-spacing, allowed width error in percent]
const PAIRS = [
  ['Newsreader text', 'Newsreader', ['Newsreader Stand-in', 'Newsreader Stand-in Android'], [400], [21, 26, 36, 48, 72, 96], TEXT, '0', 99],
  ['hero wordmark', 'Newsreader', ['Wordmark Stand-in', 'Wordmark Stand-in Android'], [400], [72, 150, 250], 'SENTINEL', '.035em', 0.4],
  ['Geist', 'Geist', ['Geist Stand-in', 'Geist Stand-in Android'], [400, 500, 600], [12, 14, 16, 18], TEXT, '0', 99]
];

/* Runs in the page: both widths and heights, or what is missing. */
async function measure(pair) {
  const [, real, stands, weights, sizes, text, spacing] = pair;
  await Promise.all([...document.fonts].filter((f) => f.family.replace(/["']/g, '') === real || stands.includes(f.family.replace(/["']/g, ''))).map((f) => f.load().catch(() => {})));
  const box = (family, weight, size) => {
    const e = document.createElement('div');
    // Two lines' worth of leading, so where the baseline stands in the box shows the ascent and the descent apart from their sum.
    e.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:${weight} ${size}px/3 '${family}', monospace;letter-spacing:${spacing};font-optical-sizing:auto;font-synthesis:none`;
    const s = document.createElement('span'); s.textContent = text; e.appendChild(s);
    const strut = document.createElement('i'); strut.style.cssText = 'display:inline-block;width:0;height:0'; e.appendChild(strut);
    document.body.appendChild(e);
    const n = document.createElement('div');
    n.style.cssText = `position:absolute;left:0;top:0;font:${weight} ${size}px/normal '${family}', monospace;font-optical-sizing:auto;font-synthesis:none`;
    n.textContent = 'Hx'; document.body.appendChild(n);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} 1000px '${family}', monospace`;
    const m = ctx.measureText('x');
    const out = { w: s.getBoundingClientRect().width, base: strut.getBoundingClientRect().top - e.getBoundingClientRect().top - size, h: n.getBoundingClientRect().height, A: m.fontBoundingBoxAscent / 1000, D: m.fontBoundingBoxDescent / 1000 };
    e.remove(); n.remove();
    return out;
  };
  const out = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const stand of stands) {
    const face = [...document.fonts].find((f) => f.family.replace(/["']/g, '') === stand);
    const loaded = Boolean(face) && face.status === 'loaded';
    for (const weight of weights) {
      for (const size of sizes) {
        const r = box(real, weight, size), t = loaded ? box(stand, weight, size) : null;
        out.push({ stand, weight, size, loaded, errPct: t ? r2((t.w / r.w - 1) * 100) : null, baseOff: t ? r2(t.base - r.base) : null, normalH: t ? r2(t.h - r.h) : null, real: { w: r2(r.w), A: r2(r.A * 1000) / 1000, D: r2(r.D * 1000) / 1000 }, stand: t && { A: r2(t.A * 1000) / 1000, D: r2(t.D * 1000) / 1000 } });
      }
    }
  }
  return out;
}

async function checkFit() {
  const server = await startServer('fontfit');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    await goto(browser, s, `${server.base}/`, "document.fonts.status === 'loaded'");
    for (const pair of PAIRS) {
      const rows = await evalIn(browser, s, `(${measure})(${JSON.stringify(pair)})`, { awaitPromise: true });
      const [what, , , , , , , allowed] = pair;
      // Which stand-in the machine really has: Windows has Georgia and Arial, never Noto Serif or Roboto unless installed here.
      for (const stand of [...new Set(rows.map((r) => r.stand))]) {
        const mine = rows.filter((r) => r.stand === stand);
        const worst = mine.reduce((a, r) => (r.errPct != null && Math.abs(r.errPct) > Math.abs(a) ? r.errPct : a), 0);
        const tall = mine.reduce((a, r) => (r.baseOff != null ? Math.max(a, Math.abs(r.baseOff), Math.abs(r.normalH)) : a), 0);
        const ok = mine.every((r) => r.loaded) && Math.abs(worst) <= allowed && tall <= 1;
        result(`font-fit: ${what}: ${stand} is within ${allowed === 99 ? 'what it measures' : allowed + '%'} of the real face in width and a pixel in where the baseline stands and the line's height (worst width ${worst}%, worst height ${tall} px off)`, allowed === 99 ? mine.every((r) => r.loaded) : ok, mine);
      }
    }
  } finally { await close(); await server.stop(); }
}

module.exports = checkFit;
