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
const CSS_URL = 'https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Geist+Mono:wght@400..600&family=Instrument+Serif:ital@0;1&display=swap';
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
  const fontCss = faces.map((f) => `@font-face {\n  font-family: '${f.family}';\n  font-style: ${f.style};\n  font-weight: ${f.weight};\n  font-display: swap;\n  src: url('/assets/fonts/${f.file}') format('woff2');\n}`).join('\n\n');
  fs.writeFileSync(path.join(OUT, 'fonts.css'), `/* Self-hosted, SIL Open Font License */\n${fontCss}\n`);
  for (const f of faces) console.log(`  ${f.file.padEnd(40)} ${(f.bytes / 1024).toFixed(1)} KB`);
})().catch((err) => { console.error(err); process.exit(1); });
