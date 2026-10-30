'use strict';
/**
 * Downloads the site's typefaces (SIL Open Font License) for self-hosting, so
 * pages load no third-party resources.
 *
 *   node scripts/fetch-fonts.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'web', 'assets', 'fonts');
// Geist for text and Geist Mono for addresses and code. Newsreader, for headlines, is cut by make-display-font.py. All SIL
// Open Font License; each licence is saved next to the fonts. fonts.css is written by hand: it also holds the type scale.
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&display=swap';
const LICENCES = { newsreader: 'ofl/newsreader/OFL.txt', geist: 'ofl/geist/OFL.txt', 'geist-mono': 'ofl/geistmono/OFL.txt' };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const css = await (await fetch(CSS_URL, { headers: { 'User-Agent': UA } })).text();
  const faces = [];
  for (const block of css.split('/* ').slice(1)) {
    if (!block.startsWith('latin */')) continue;
    const family = /font-family: '([^']+)'/.exec(block)[1];
    const style = /font-style: (\w+)/.exec(block)[1];
    const weight = /font-weight: ([\d ]+);/.exec(block)[1];
    const url = /url\((https:[^)]+)\)/.exec(block)[1];
    const file = `${family}-${style}-${weight.replace(' ', '-')}.woff2`.toLowerCase().replace(/\s+/g, '-');
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    fs.writeFileSync(path.join(OUT, file), buf);
    faces.push({ family, style, weight, file, bytes: buf.length });
  }
  for (const f of faces) console.log(`  ${f.file.padEnd(40)} ${(f.bytes / 1024).toFixed(1)} KB`);
  for (const [name, p] of Object.entries(LICENCES)) {
    const text = await (await fetch(`https://raw.githubusercontent.com/google/fonts/main/${p}`)).text();
    if (!/SIL OPEN FONT LICENSE/i.test(text)) throw new Error(`no licence found for ${name}`);
    fs.writeFileSync(path.join(OUT, `${name}-OFL.txt`), text);
    console.log(`  ${`${name}-OFL.txt`.padEnd(40)} licence`);
  }
})().catch((err) => { console.error(err); process.exit(1); });
