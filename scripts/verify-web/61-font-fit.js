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
  ['Newsreader text', 'Newsreader', ['Newsreader Stand-in', 'Newsreader Stand-in Android'], [400], [16, 21, 26, 36], TEXT, '0', 99],
  ['hero wordmark', 'Newsreader', ['Wordmark Stand-in', 'Wordmark Stand-in Android'], [400], [72, 150, 250], 'SENTINEL', '.035em', 0.4],
  ['Geist', 'Geist', ['Geist Stand-in', 'Geist Stand-in Android'], [400, 500, 600], [12, 14, 16, 18], TEXT, '0', 99]
];

/* Runs in the page: both widths and heights, or what is missing. */
async function measure(pair) {
  const [, real, stands, weights, sizes, text, spacing] = pair;
  await Promise.all([...document.fonts].filter((f) => f.family.replace(/["']/g, '') === real || stands.includes(f.family.replace(/["']/g, ''))).map((f) => f.load().catch(() => {})));
  const box = (family, weight, size) => {
    const e = document.createElement('div');
    e.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:${weight} ${size}px/normal '${family}', monospace;letter-spacing:${spacing};font-optical-sizing:auto;font-synthesis:none`;
    const s = document.createElement('span'); s.textContent = text; e.appendChild(s); document.body.appendChild(e);
    const m = { w: s.getBoundingClientRect().width, h: e.getBoundingClientRect().height };
    e.remove();
    return m;
  };
  const out = [];
  for (const stand of stands) {
    const face = [...document.fonts].find((f) => f.family.replace(/["']/g, '') === stand);
    const loaded = Boolean(face) && face.status === 'loaded';
    for (const weight of weights) {
      for (const size of sizes) {
        const r = box(real, weight, size), s = loaded ? box(stand, weight, size) : null;
        out.push({ stand, weight, size, loaded, real: Math.round(r.w * 100) / 100, standW: s && Math.round(s.w * 100) / 100, errPct: s ? Math.round((s.w / r.w - 1) * 10000) / 100 : null, realH: Math.round(r.h * 100) / 100, standH: s && Math.round(s.h * 100) / 100 });
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
        const tall = mine.reduce((a, r) => (r.standH != null ? Math.max(a, Math.abs(r.standH - r.realH)) : a), 0);
        const ok = mine.every((r) => r.loaded) && Math.abs(worst) <= allowed && tall <= 1;
        result(`font-fit: ${what}: ${stand} is within ${allowed === 99 ? 'what it measures' : allowed + '%'} of the real face in width and a pixel in height (worst width ${worst}%, line box ${tall} px off)`, allowed === 99 ? mine.every((r) => r.loaded) : ok, mine);
      }
    }
  } finally { await close(); await server.stop(); }
}

module.exports = checkFit;
