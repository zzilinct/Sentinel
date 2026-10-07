'use strict';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const QR = require('../web/assets/js/qr');
const { classify } = require('../server/lib/scan/qr');
const { analyzeEmail } = require('../server/lib/scan/email');

const I = QR._internal;

/* ------------------------------------------------- making codes to read */

// Byte-mode codes, built the way the standard says, so the reader is tested on pictures it has never seen. The
// level is an index into the tables (0 L, 1 M, 2 Q, 3 H).
function codewords(bytes, version, level) {
  const total = Math.floor(I.rawDataModules(version) / 8);
  const numBlocks = I.NUM_BLOCKS[level][version];
  const eccLen = I.ECC_PER_BLOCK[level][version];
  const capacity = total - numBlocks * eccLen;
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  assert.ok(bits.length <= capacity * 8, 'text too long for this version');
  put(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);
  return interleave(data, version, level);
}

function interleave(data, version, level) {
  const total = Math.floor(I.rawDataModules(version) / 8);
  const numBlocks = I.NUM_BLOCKS[level][version];
  const eccLen = I.ECC_PER_BLOCK[level][version];
  const numShort = numBlocks - (total % numBlocks);
  const shortLen = Math.floor(total / numBlocks);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const block = dat.concat(I.rsEncode(dat, eccLen));
    if (i < numShort) block.splice(shortLen - eccLen, 0, null);
    blocks.push(block);
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) for (let j = 0; j < blocks.length; j++) if (blocks[j][i] !== null) out.push(blocks[j][i]);
  return out;
}

function grid(cw, version, level, mask) {
  const size = version * 4 + 17;
  const g = new Uint8Array(size * size);
  const set = (x, y, v) => { g[y * size + x] = v ? 1 : 0; };
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx; const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = I.alignmentPositions(version);
  for (let i = 0; i < al.length; i++) for (let j = 0; j < al.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const levelBits = I.LEVEL_OF_BITS.indexOf(level);
  const word = I.formatWord(levelBits, mask);
  const [a, b] = I.formatPositions(size);
  for (let i = 0; i < 15; i++) { set(a[i][0], a[i][1], (word >>> i) & 1); set(b[i][0], b[i][1], (word >>> i) & 1); }
  set(8, size - 8, 1);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) { const bit = (bits >>> i) & 1; set(size - 11 + (i % 3), Math.floor(i / 3), bit); set(Math.floor(i / 3), size - 11 + (i % 3), bit); }
  }
  const isFn = I.functionModules(version);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j;
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
      if (isFn[y * size + x]) continue;
      const bit = i < cw.length * 8 ? (cw[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
      i++;
      set(x, y, bit ^ (I.maskBit(mask, x, y) ? 1 : 0));
    }
  }
  return { g, size };
}

/** RGBA pixels of a grid: a quiet zone of 4, `scale` pixels a module, turned by `angle` degrees. */
function picture({ g, size }, { scale = 4, angle = 0, invert = false, mirror = false, noise = 0, ink = 30, paper = 230 } = {}) {
  const side = Math.ceil((size + 8) * scale * (angle ? 1.5 : 1));
  const data = new Uint8ClampedArray(side * side * 4);
  const c = side / 2;
  const rad = (angle * Math.PI) / 180;
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const dx = x + 0.5 - c; const dy = y + 0.5 - c;
    let u = (Math.cos(rad) * dx + Math.sin(rad) * dy) / scale + size / 2;
    const v = (-Math.sin(rad) * dx + Math.cos(rad) * dy) / scale + size / 2;
    if (mirror) u = size - u;
    const mx = Math.floor(u); const my = Math.floor(v);
    let dark = mx >= 0 && my >= 0 && mx < size && my < size && g[my * size + mx] === 1;
    if (invert) dark = !dark;
    let lum = dark ? ink : paper;
    if (noise) lum = Math.max(0, Math.min(255, lum + (rand() - 0.5) * noise));
    const o = (y * side + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = lum;
    data[o + 3] = 255;
  }
  return { data, width: side, height: side };
}

/** A homography from four points to four points (eight unknowns, solved directly). */
function homography(src, dst) {
  const A = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i];
    const [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x], [0, 0, 0, u, v, 1, -u * y, -v * y, y]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((r, i) => r[8] / r[i]);
  return (u, v) => { const d = h[6] * u + h[7] * v + 1; return [(h[0] * u + h[1] * v + h[2]) / d, (h[3] * u + h[4] * v + h[5]) / d]; };
}

/** A photo of a code held at an angle: its quiet zone's corners land on `quad`, with light falling unevenly. */
function photo({ g, size }, quad, { width = 800, height = 650, blur = false } = {}) {
  const toModule = homography(quad, [[-4, -4], [size + 4, -4], [-4, size + 4], [size + 4, size + 4]]);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [u, v] = toModule(x + 0.5, y + 0.5);
    const mx = Math.floor(u); const my = Math.floor(v);
    const dark = mx >= 0 && my >= 0 && mx < size && my < size && g[my * size + mx] === 1;
    const o = (y * width + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = dark ? 35 + Math.floor((30 * y) / height) : 200 - Math.floor((60 * x) / width);
    data[o + 3] = 255;
  }
  if (blur) {
    const c = new Uint8ClampedArray(data);
    for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += c[((y + dy) * width + x + dx) * 4];
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = s / 9;
    }
  }
  return { data, width, height };
}

const enc = (s) => [...Buffer.from(s, 'utf8')];

/* ------------------------------------------------------------ the parts */

test('format words match the standard table', () => {
  // ISO/IEC 18004 Table C.1 (mask 0 of each level), as printed in every QR reference.
  assert.equal(I.formatWord(1, 0), 0b111011111000100); // L
  assert.equal(I.formatWord(0, 0), 0b101010000010010); // M
  assert.equal(I.formatWord(3, 0), 0b011010101011111); // Q
  assert.equal(I.formatWord(2, 0), 0b001011010001001); // H
});

test('Reed-Solomon makes the standard example and corrects errors up to its limit', () => {
  // "HELLO WORLD" as version 1-M: the worked example in the QR code tutorials.
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const ecc = I.rsEncode(data, 10);
  assert.deepEqual(ecc, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  const block = data.concat(ecc);
  const broken = block.slice();
  for (const [at, v] of [[0, 1], [5, 200], [9, 9], [17, 0], [25, 77]]) broken[at] ^= v;
  assert.equal(I.rsCorrect(broken, 10), true);
  assert.deepEqual(broken, block);
  const clean = block.slice();
  assert.equal(I.rsCorrect(clean, 10), true);
  assert.deepEqual(clean, block);
});

test('reads the alphanumeric worked example from its codewords', () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  for (let mask = 0; mask < 8; mask++) {
    const { g, size } = grid(interleave(data, 1, 1), 1, 1, mask);
    assert.equal(I.decodeGrid(g, size), 'HELLO WORLD');
  }
});

/* ---------------------------------------------------- reading pictures */

test('reads codes of many sizes, levels and masks', () => {
  const cases = [
    [1, 0, 0, 'https://x.co'], [1, 3, 5, 'hi'], [2, 0, 2, 'https://discord.com/ra/abc123'], [3, 2, 6, 'WIFI:S:Cafe;T:WPA;P:secret;;'],
    [5, 2, 3, 'https://example.com/a/fairly/long/path?with=query&and=more'], [7, 1, 4, 'otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example'],
    [10, 0, 7, 'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.05 '.repeat(2)], [14, 3, 1, 'é and ü and 漢字 travel as UTF-8']
  ];
  for (const [version, level, mask, text] of cases) {
    const cw = codewords(enc(text), version, level);
    assert.equal(QR.decode(picture(grid(cw, version, level, mask), { scale: version > 9 ? 3 : 4 })), text, `version ${version}`);
  }
});

test('reads a code turned, mirrored, light on dark, noisy or damaged', () => {
  const text = 'https://paypa1-secure-login.com/verify';
  const code = grid(codewords(enc(text), 4, 1), 4, 1, 2);
  assert.equal(QR.decode(picture(code, { angle: 90 })), text);
  assert.equal(QR.decode(picture(code, { angle: 180 })), text);
  assert.equal(QR.decode(picture(code, { angle: 17, scale: 5 })), text);
  assert.equal(QR.decode(picture(code, { mirror: true })), text);
  assert.equal(QR.decode(picture(code, { invert: true })), text);
  assert.equal(QR.decode(picture(code, { noise: 120 })), text);
  // Grey on grey, as a branded or faded code is: found with CI's real pictures (scripts/verify-web.js).
  assert.equal(QR.decode(picture(code, { ink: 105, paper: 176 })), text);
  assert.equal(QR.decode(picture(code, { ink: 105, paper: 176, scale: 10 })), text);
  // A few data modules scratched off: error correction puts them back.
  const scratched = { size: code.size, g: code.g.slice() };
  for (const [x, y] of [[20, 20], [21, 22], [12, 25], [26, 14]]) scratched.g[y * code.size + x] ^= 1;
  assert.equal(QR.decode(picture(scratched)), text);
});

test('reads a code photographed at an angle, in uneven light', () => {
  const text = 'https://example.com/login?x=1';
  const quads = [
    [[200, 100], [500, 130], [180, 420], [520, 400]],
    [[300, 150], [600, 200], [250, 480], [560, 560]],
    [[400, 100], [650, 300], [200, 320], [450, 520]]
  ];
  for (const version of [3, 6, 10]) {
    const code = grid(codewords(enc(text), version, 1), version, 1, version % 8);
    for (const quad of quads) for (const blur of [false, true]) {
      assert.equal(QR.decode(photo(code, quad, { blur })), text, `version ${version}, ${JSON.stringify(quad)}${blur ? ', blurred' : ''}`);
    }
  }
});

test('finds nothing where there is no code', () => {
  const blank = { data: new Uint8ClampedArray(200 * 200 * 4).fill(255), width: 200, height: 200 };
  assert.equal(QR.decode(blank), null);
  assert.equal(QR.decode(null), null);
});

/* --------------------------------------------------- what codes do */

test('sign-in codes are called what they are', () => {
  for (const [text, app] of [
    ['https://discord.com/ra/Xk3jdk29dkdmmQ', 'Discord'], ['https://discordapp.com/ra/abcdefgh', 'Discord'],
    ['https://s.team/q/1/1234567890123456789', 'Steam'], ['tg://login?token=AQABC123', 'Telegram'],
    ['sgnl://linkdevice?uuid=abc&pub_key=xyz', 'Signal'], ['2@Qk3n2kd9AbCdEfGh,Zm9vYmFyYmF6cXV4,cXV1eHF1dXhxdXV4', 'WhatsApp']
  ]) {
    const c = classify(text);
    assert.equal(c.kind, 'signin', text);
    assert.equal(c.app, app);
    assert.equal(c.tone, 'red');
    assert.ok(c.steps.length >= 2);
  }
  // Discord's ordinary pages are links, not sign-in codes.
  assert.equal(classify('https://discord.com/invite/abc').kind, 'url');
});

test('wallet, payment, two-step, Wi-Fi and contact codes are explained', () => {
  assert.equal(classify('wc:8a5e5bdc-a0e4-4702-ba63-8f1a5655744f@2?relay-protocol=irn&symKey=abc').kind, 'wallet');
  const pay = classify('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.05');
  assert.equal(pay.kind, 'payment');
  assert.match(pay.detail, /0\.05 bitcoin to bc1q/);
  const otp = classify('otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example');
  assert.equal(otp.kind, 'otp');
  assert.match(otp.detail, /Example \(alice@example\.com\)/);
  const wifi = classify('WIFI:S:Cafe\\;Guest;T:WPA;P:hunter2;;');
  assert.equal(wifi.kind, 'wifi');
  assert.match(wifi.detail, /"Cafe;Guest"/);
  assert.doesNotMatch(wifi.detail, /hunter2/, 'the Wi-Fi password is never repeated');
  assert.equal(classify('tel:+18005551234').kind, 'phone');
  assert.equal(classify('SMSTO:+18005551234:hello').kind, 'sms');
  assert.equal(classify('mailto:help@example.com').kind, 'email');
  assert.equal(classify('just some words').kind, 'text');
});

test('the secret in a code is taken out before it is sent, and the code is still called what it is', () => {
  for (const [text, secret] of [
    ['otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example', 'JBSWY3DPEHPK3PXP'],
    ['otpauth://totp/Example:alice?issuer=Example&secret=JBSWY3DPEHPK3PXP', 'JBSWY3DPEHPK3PXP'],
    ['WIFI:S:Cafe\\;Guest;T:WPA;P:hunter2;;', 'hunter2'],
    ['WIFI:T:WPA;P:p\\;ss;S:Home;;', 'p\\;ss'],
    ['tg://login?token=AQABC123secret', 'AQABC123secret'],
    ['sgnl://linkdevice?uuid=abc123&pub_key=xyz789', 'xyz789'],
    ['2@Qk3n2kd9AbCdEfGh,Zm9vYmFyYmF6cXV4,cXV1eHF1dXhxdXV4', 'Qk3n2kd9AbCdEfGh'],
    ['https://discord.com/ra/Xk3jdk29dkdmmQ', 'Xk3jdk29dkdmmQ'],
    ['https://s.team/q/1/1234567890123456789', '1234567890123456789'],
    ['wc:8a5e5bdc-a0e4-4702-ba63-8f1a5655744f@2?relay-protocol=irn&symKey=abcdef0123', 'abcdef0123']
  ]) {
    const sent = QR.redact(text);
    assert.ok(!sent.includes(secret), `${text} -> ${sent}`);
    const before = classify(text);
    const after = classify(sent);
    assert.deepEqual([after.kind, after.app, after.tone], [before.kind, before.app, before.tone], text);
  }
  assert.match(classify(QR.redact('WIFI:S:Cafe\\;Guest;T:WPA;P:hunter2;;')).detail, /"Cafe;Guest"/);
  assert.match(classify(QR.redact('otpauth://totp/Example:alice@example.com?secret=X&issuer=Example')).detail, /Example \(alice@example\.com\)/);
  // Everything else goes as it is.
  for (const text of ['https://example.com/a?b=c', 'bitcoin:bc1qabc?amount=1', 'tel:+18005551234', 'just some words']) assert.equal(QR.redact(text), text);
});

test('links are handed to the link scan', () => {
  for (const [text, host] of [['https://example.com/x', 'example.com'], ['HTTP://EXAMPLE.ORG', 'example.org'], ['www.example.net/a', 'www.example.net'], ['example.co.uk/menu', 'example.co.uk']]) {
    const c = classify(text);
    assert.equal(c.kind, 'url', text);
    assert.equal(c.host, host);
    assert.ok(c.url.startsWith('http'));
  }
});

test('user-facing wording has no em dashes', () => {
  for (const text of ['https://discord.com/ra/x1234567', 'wc:8a5e5bdc-a0e4@2', 'bitcoin:abc?amount=1', 'otpauth://totp/A:b?issuer=A', 'WIFI:S:x;;', 'tel:1', 'mailto:a@b.c', 'x', 'https://a.com']) {
    const c = classify(text);
    assert.doesNotMatch([c.title, c.detail, ...c.steps].join(' '), /—/);
  }
});

test('a QR code in an email: its link joins the links, a sign-in code is the scam', () => {
  const base = { from: 'Docs <share@example.com>', subject: 'Document waiting', body: 'Scan the QR code below to view it.' };
  const link = analyzeEmail({ ...base, qr: ['https://evil-docs.example/view'] });
  assert.ok(link.links.includes('https://evil-docs.example/view'));
  assert.equal(link.checks.find((c) => c.id === 'E30').status, 'pass');
  const signIn = analyzeEmail({ ...base, qr: ['https://discord.com/ra/abcdef123'] });
  const e30 = signIn.checks.find((c) => c.id === 'E30');
  assert.equal(e30.status, 'fail');
  assert.match(e30.detail, /Discord sign-in code/);
  assert.equal(analyzeEmail({ ...base, qr: ['bitcoin:bc1qabc?amount=1'] }).checks.find((c) => c.id === 'E30').status, 'fail');
  // No code read: no QR check at all.
  assert.equal(analyzeEmail(base).checks.find((c) => c.id === 'E30'), undefined);
});

/* ------------------------------------------------------------- the API */

test('the API says what a code does, uses no scans, and takes a QR-only email', async (t) => {
  const { client, startApp } = require('./fixtures');
  const app = await startApp();
  t.after(() => app.server.close());
  const c = client(app.base);
  const email = `qr_${Date.now()}@example.com`;
  assert.equal((await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Q', ageConfirmed: true, termsAccepted: true })).status, 201);
  assert.equal((await c.post('/api/v1/auth/login', { email, password: 'Correct-Horse-42' })).status, 200);

  const before = (await c.get('/api/v1/auth/me')).data;
  const r = await c.post('/api/v1/scan/qr', { text: 'https://discord.com/ra/abcdefgh123' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.qr.kind, 'signin');
  assert.equal(r.data.qr.app, 'Discord');
  const link = await c.post('/api/v1/scan/qr', { text: 'https://example.com/menu' });
  assert.equal(link.data.qr.url, 'https://example.com/menu');
  assert.equal((await c.post('/api/v1/scan/qr', { text: '  ' })).status, 400);
  const after = (await c.get('/api/v1/auth/me')).data;
  assert.deepEqual(after.usage, before.usage, 'explaining a code is not a scan');

  // Signed out: refused.
  assert.equal((await client(app.base).post('/api/v1/scan/qr', { text: 'x' })).status, 401);

  // An email scan with nothing but a QR code read from its screenshot (a Max feature).
  assert.equal((await c.post('/api/v1/billing/plan', { plan: 'max' })).status, 200);
  const mail = await c.post('/api/v1/scan/email', { qr: ['https://discord.com/ra/abcdefgh123'] });
  assert.equal(mail.status, 200, JSON.stringify(mail.data));
  assert.equal(mail.data.verdict.checklist.items.find((x) => x.id === 'E30').status, 'fail');
  assert.equal(mail.data.verdict.overall.badge !== null, true, 'a sign-in code in an email gets a mask');
});
