'use strict';
/**
 * font-fit  Each stand-in face in web/assets/fonts/fonts.css and home.css, measured against the real face it stands in
 *           for, in Chrome, on the site's own words: the width of the home page's text (Geist), of its headings
 *           (Newsreader) and of the wordmark (capitals), and where the baseline stands in a tall line, which is what an
 *           ascent and a descent decide once a line-height is set. A stand-in drawn too wide or too narrow moves the page
 *           when the real font arrives. The Windows and Mac stand-ins (Georgia, Arial) are on every runner; the Android
 *           ones (Noto Serif, Roboto) are installed on this runner by verify-web.yml, from Google Fonts' own files, so
 *           they are measured too, not scaled from the others. The hero wordmark (capitals) has its own stand-ins: one
 *           for 72px and up, where the optical size is at its largest, and one for a phone's 56 to 69px, where it is not.
 *           What is asserted: Geist (every weight on Windows, regular on Android) within a percent in width and the
 *           wordmark within half a percent (on a phone, a percent: its optical size moves inside 56 to 69px), all within a pixel in baseline. What is only said, with the size-adjust, ascent and descent that
 *           would make it exact: the heading face (it changes its optical size with its size, so one stand-in cannot
 *           match every size) and Android's medium and bold (a variable Roboto cannot be reached by those names here).
 *           A face the machine does not have fails the check, never skipped silently.
 */
const { result, launch, evalIn, goto, startServer, openPage } = require('./_shared');

/* Runs in the page. Every stand-in, at each weight and size, against the real face on the given text. */
async function measure(spec) {
  const clean = (t) => t.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
  const texts = { body: clean(document.body.innerText).slice(0, 3000), heads: clean([...document.querySelectorAll('h1, h2, h3')].map((e) => e.innerText).join(' ')), word: 'SENTINEL' };
  const name = (f) => f.family.replace(/["']/g, '');
  await Promise.all([...document.fonts].map((f) => f.load().catch(() => {})));
  // The size-adjust a stand-in is declared with, for the weight asked: read from the page's own style sheets.
  const declared = (stand, weight) => {
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      for (const r of rules) {
        if (!(r instanceof CSSFontFaceRule) || r.style.getPropertyValue('font-family').replace(/["']/g, '').trim() !== stand) continue;
        const w = r.style.getPropertyValue('font-weight').trim().split(/\s+/).map(Number);
        if (!w[0] || (weight >= w[0] && weight <= (w[1] || w[0]))) return parseFloat(r.style.getPropertyValue('size-adjust'));
      }
    }
    return NaN;
  };
  const box = (family, weight, size, text, spacing) => {
    const e = document.createElement('div');
    // Three lines' worth of leading, so where the baseline stands in the box shows the ascent and the descent apart from their sum.
    e.style.cssText = `position:absolute;left:0;top:0;white-space:nowrap;font:${weight} ${size}px/3 '${family}', monospace;letter-spacing:${spacing};font-optical-sizing:auto;font-synthesis:none`;
    const s = document.createElement('span'); s.textContent = text; e.appendChild(s);
    const strut = document.createElement('i'); strut.style.cssText = 'display:inline-block;width:0;height:0'; e.appendChild(strut);
    document.body.appendChild(e);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${weight} 1000px '${family}', monospace`;
    const m = ctx.measureText('x');
    const out = { w: s.getBoundingClientRect().width, base: strut.getBoundingClientRect().top - e.getBoundingClientRect().top - size, A: m.fontBoundingBoxAscent / 1000, D: m.fontBoundingBoxDescent / 1000 };
    e.remove();
    return out;
  };
  const r2 = (v) => Math.round(v * 100) / 100;
  const out = [];
  for (const [what, real, stands, weights, sizes, key, spacing] of spec) {
    for (const stand of stands) {
      const face = [...document.fonts].find((f) => name(f) === stand);
      const loaded = Boolean(face) && face.status === 'loaded';
      for (const weight of weights) {
        const rows = sizes.map((size) => ({ size, r: box(real, weight, size, texts[key], spacing), t: loaded ? box(stand, weight, size, texts[key], spacing) : null }));
        const errs = rows.map((x) => (x.t ? (x.t.w / x.r.w - 1) * 100 : null));
        const cur = declared(stand, weight), mean = errs.reduce((a, v) => a + (v == null ? 0 : v), 0) / errs.length;
        const need = loaded ? cur / (1 + mean / 100) : null;   // the size-adjust that makes the mean error nothing
        out.push({ what, stand, weight, loaded, sizes, errs: errs.map((v) => (v == null ? null : r2(v))), base: rows.map((x) => (x.t ? r2(x.t.base - x.r.base) : null)),
          declared: cur, needAdjust: need && r2(need), needAscent: need && r2((rows[0].r.A / need) * 100 * 100) / 100, needDescent: need && r2((rows[0].r.D / need) * 100 * 100) / 100 });
      }
    }
  }
  return out;
}

const SPEC = [
  // [what, the real face, the stand-ins, weights, sizes, which text, letter-spacing]
  ['Newsreader headings', 'Newsreader', ['Newsreader Stand-in', 'Newsreader Stand-in Android'], [400], [21, 26, 36, 48, 72, 96], 'heads', '0'],
  ['hero wordmark', 'Newsreader', ['Wordmark Stand-in', 'Wordmark Stand-in Android'], [400], [72, 150, 250], 'word', '.035em'],
  ['hero wordmark on a phone', 'Newsreader', ['Wordmark Phone Stand-in', 'Wordmark Phone Stand-in Android'], [400], [56, 62, 69], 'word', '.035em'],
  ['Geist', 'Geist', ['Geist Stand-in', 'Geist Stand-in Android'], [400, 500, 600], [12, 14, 16, 18], 'body', '0']
];

async function checkFit() {
  const server = await startServer('fontfit');
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    await goto(browser, s, `${server.base}/`, "document.querySelector('.hero__word')");
    const rows = await evalIn(browser, s, `(${measure})(${JSON.stringify(SPEC)})`, { awaitPromise: true });
    for (const r of rows) {
      const worst = Math.max(...r.errs.map((v) => (v == null ? 99 : Math.abs(v))));
      const base = Math.max(...r.base.map((v) => (v == null ? 99 : Math.abs(v))));
      const asserted = r.what.startsWith('hero wordmark') || (r.what === 'Geist' && (r.weight === 400 || !/Android/.test(r.stand)));
      // The wordmark is one fixed word: exact. Text varies by what letters it has (two fair samples of the site's words differ by half a percent), so a percent.
      const ok = r.loaded && worst <= (r.what === 'hero wordmark' ? 0.5 : 1) && base <= 1;
      result(`font-fit: ${r.what}: ${r.stand} at ${r.weight}: ${r.loaded ? `width ${worst}% off at worst, baseline ${base} px off` : 'not loaded on this machine'}${asserted ? '' : ' (said, not asserted)'}`, asserted ? ok : r.loaded, r);
    }
  } finally { await close(); await server.stop(); }
}

module.exports = checkFit;
