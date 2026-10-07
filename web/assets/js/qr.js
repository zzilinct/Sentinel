/*
 * QR codes, read on this computer. A picture of a QR code (a screenshot, a photo, a camera frame) becomes the text
 * the code holds, so Sentinel can say where it really goes before anyone points a phone at it. Nothing is uploaded:
 * the picture is read here, and only the text it holds is ever checked.
 *
 *   SentinelQR.decode({ data, width, height })   RGBA pixels (an ImageData) -> the code's text, or null
 *
 * Written for Sentinel rather than borrowed: Chromium's BarcodeDetector is not offered on Windows, and the app adds
 * no dependencies. It follows the QR code standard (ISO/IEC 18004) the way the common open decoders do: find the
 * three finder squares, map the grid through them, read the format, undo the mask, correct errors (Reed-Solomon),
 * and read numeric, alphanumeric, byte and kanji segments. Mirrored and light-on-dark codes are read too; a code
 * bent round a curve, or much smaller than about 2 pixels a square, is not.
 *
 * Plain script for the page, and a CommonJS module for the tests.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ tables */

  // Error-correction codewords per block, and number of blocks, by level (L, M, Q, H) and version (1 to 40).
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  ];
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  ];
  // The two format bits that name the level: L is 01, M 00, Q 11, H 10. Index into the tables above.
  var LEVEL_OF_BITS = [1, 0, 3, 2];
  var ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

  function alignmentPositions(version) {
    if (version === 1) return [];
    var n = Math.floor(version / 7) + 2;
    var step = Math.floor((version * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    var out = [6];
    for (var pos = version * 4 + 17 - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  /** Modules that carry data (everything but finders, timing, alignment, format and version areas). */
  function rawDataModules(version) {
    var r = (16 * version + 128) * version + 64;
    if (version >= 2) {
      var n = Math.floor(version / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (version >= 7) r -= 36;
    }
    return r;
  }

  /** The 15-bit format word for a level's two bits and a mask: BCH(15,5), then XOR 0x5412. */
  function formatWord(levelBits, mask) {
    var data = (levelBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | (rem & 0x3ff)) ^ 0x5412;
  }
  var FORMAT_WORDS = [];
  for (var fw = 0; fw < 32; fw++) FORMAT_WORDS.push({ word: formatWord(fw >> 3, fw & 7), levelBits: fw >> 3, mask: fw & 7 });

  // Where format bit i sits, [x, y], in each copy (bit 0 is the least significant).
  function formatPositions(size) {
    var a = [];
    var b = [];
    for (var i = 0; i < 15; i++) {
      a.push(i <= 5 ? [8, i] : i === 6 ? [8, 7] : i === 7 ? [8, 8] : i === 8 ? [7, 8] : [14 - i, 8]);
      b.push(i < 8 ? [size - 1 - i, 8] : [8, size - 15 + i]);
    }
    return [a, b];
  }

  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return (x * y) % 2 + (x * y) % 3 === 0;
      case 6: return ((x * y) % 2 + (x * y) % 3) % 2 === 0;
      default: return ((x + y) % 2 + (x * y) % 3) % 2 === 0;
    }
  }

  /** Which modules are not data, as a size*size array of 1s. */
  function functionModules(version) {
    var size = version * 4 + 17;
    var f = new Uint8Array(size * size);
    var mark = function (x, y, w, h) {
      for (var yy = y; yy < y + h; yy++) for (var xx = x; xx < x + w; xx++) if (xx >= 0 && yy >= 0 && xx < size && yy < size) f[yy * size + xx] = 1;
    };
    // Finders with their separators and the format areas beside them.
    mark(0, 0, 9, 9);
    mark(size - 8, 0, 8, 9);
    mark(0, size - 8, 9, 8);
    // Timing.
    mark(6, 0, 1, size);
    mark(0, 6, size, 1);
    var al = alignmentPositions(version);
    for (var i = 0; i < al.length; i++) {
      for (var j = 0; j < al.length; j++) {
        // Not where a finder is.
        if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) continue;
        mark(al[i] - 2, al[j] - 2, 5, 5);
      }
    }
    if (version >= 7) {
      mark(size - 11, 0, 3, 6);
      mark(0, size - 11, 6, 3);
    }
    return f;
  }

  /* --------------------------------------------- Reed-Solomon, GF(256) */

  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var k = 255; k < 512; k++) EXP[k] = EXP[k - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function div(a, b) { return a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0; }

  /** The error-correction codewords for data (used by the tests to make codes, and nowhere else). */
  function rsEncode(data, eccLen) {
    var gen = [1];
    for (var i = 0; i < eccLen; i++) {
      var next = new Array(gen.length + 1).fill(0);
      for (var j = 0; j < gen.length; j++) {
        next[j] ^= gen[j];
        next[j + 1] ^= mul(gen[j], EXP[i]);
      }
      gen = next;
    }
    var rem = new Array(eccLen).fill(0);
    for (var d = 0; d < data.length; d++) {
      var factor = data[d] ^ rem[0];
      rem.shift();
      rem.push(0);
      for (var g = 0; g < eccLen; g++) rem[g] ^= mul(gen[g + 1], factor);
    }
    return rem;
  }

  /**
   * Corrects a block in place (codeword 0 is the highest power). Berlekamp-Massey finds the error locator, a Chien
   * search the positions and Forney's formula the values. False when there are more errors than it can fix.
   */
  function rsCorrect(block, eccLen) {
    var n = block.length;
    var synd = [];
    var clean = true;
    for (var i = 0; i < eccLen; i++) {
      var x = EXP[i];
      var s = 0;
      for (var k = 0; k < n; k++) s = mul(s, x) ^ block[k];
      synd.push(s);
      if (s) clean = false;
    }
    if (clean) return true;
    // Berlekamp-Massey, polynomials lowest power first.
    var lambda = [1];
    var prev = [1];
    var L = 0;
    var m = 1;
    var b = 1;
    for (var r = 0; r < eccLen; r++) {
      var d = synd[r];
      for (var q = 1; q <= L; q++) d ^= mul(lambda[q] || 0, synd[r - q]);
      if (d === 0) { m++; continue; }
      var coef = div(d, b);
      var updated = lambda.slice();
      for (var p = 0; p < prev.length; p++) {
        while (updated.length <= p + m) updated.push(0);
        updated[p + m] ^= mul(coef, prev[p]);
      }
      if (2 * L <= r) { prev = lambda; L = r + 1 - L; b = d; m = 1; } else { m++; }
      lambda = updated;
    }
    if (2 * L > eccLen) return false;
    var evalLow = function (poly, x) { var y = 0; for (var e = poly.length - 1; e >= 0; e--) y = mul(y, x) ^ poly[e]; return y; };
    // Omega = S(x) * Lambda(x) mod x^eccLen.
    var omega = new Array(eccLen).fill(0);
    for (var a = 0; a < eccLen; a++) for (var c = 0; c < lambda.length && a + c < eccLen; c++) omega[a + c] ^= mul(synd[a], lambda[c]);
    var deriv = [];
    for (var t = 1; t < lambda.length; t++) deriv.push(t % 2 ? lambda[t] : 0);
    var found = 0;
    for (var deg = 0; deg < n; deg++) {
      var inv = EXP[(255 - deg) % 255];
      if (evalLow(lambda, inv) !== 0) continue;
      var den = evalLow(deriv, inv);
      if (!den) return false;
      var val = mul(EXP[deg], div(evalLow(omega, inv), den));
      block[n - 1 - deg] ^= val;
      found++;
    }
    return found === L;
  }

  /* ------------------------------------------------------- pixels */

  /** Dark (1) or light (0) for every pixel, against the brightness around it (8-pixel blocks, 5 by 5 of them). */
  function binarize(img, invert) {
    var w = img.width;
    var h = img.height;
    var px = img.data;
    var lum = new Uint8Array(w * h);
    var floor = 255;   // the darkest ink in the picture
    for (var i = 0, j = 0; i < lum.length; i++, j += 4) {
      // Transparent counts as white: a code saved as a PNG on a clear background.
      var a = px[j + 3];
      var v = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
      lum[i] = a === 255 ? v : 255 - (((255 - v) * a) >> 8);
      if (lum[i] < floor) floor = lum[i];
    }
    var out = new Uint8Array(w * h);
    var B = 8;
    var bw = Math.ceil(w / B);
    var bh = Math.ceil(h / B);
    var avg = new Float32Array(bw * bh);
    for (var by = 0; by < bh; by++) {
      for (var bx = 0; bx < bw; bx++) {
        var sum = 0; var min = 255; var max = 0; var cnt = 0;
        for (var y = by * B; y < Math.min(h, by * B + B); y++) {
          for (var x = bx * B; x < Math.min(w, bx * B + B); x++) {
            var l = lum[y * w + x];
            sum += l; cnt++;
            if (l < min) min = l;
            if (l > max) max = l;
          }
        }
        var mean = sum / cnt;
        // A flat block (all paper, or all ink) takes its cue from its neighbours, as in ZXing's hybrid binarizer.
        if (max - min <= 24) {
          // Halfway down to the darkest ink, not to black: in a grey-on-grey code, half of the paper's brightness is
          // darker than the ink itself, and the ink around it would be read as paper.
          mean = floor + (min - floor) / 2;
          if (by > 0 && bx > 0) {
            var nb = (avg[(by - 1) * bw + bx] + 2 * avg[by * bw + bx - 1] + avg[(by - 1) * bw + bx - 1]) / 4;
            if (min < nb) mean = nb;
          }
        }
        avg[by * bw + bx] = mean;
      }
    }
    for (var cy = 0; cy < bh; cy++) {
      for (var cx = 0; cx < bw; cx++) {
        var s = 0; var n = 0;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) {
            var yy = Math.min(bh - 1, Math.max(0, cy + dy));
            var xx = Math.min(bw - 1, Math.max(0, cx + dx));
            s += avg[yy * bw + xx]; n++;
          }
        }
        var thr = s / n;
        for (var py = cy * B; py < Math.min(h, cy * B + B); py++) {
          for (var pxx = cx * B; pxx < Math.min(w, cx * B + B); pxx++) {
            var dark = lum[py * w + pxx] <= thr ? 1 : 0;
            out[py * w + pxx] = invert ? 1 - dark : dark;
          }
        }
      }
    }
    return { bits: out, width: w, height: h };
  }

  /* ------------------------------------------------ finder patterns */

  function crossesFinder(c) {
    var total = c[0] + c[1] + c[2] + c[3] + c[4];
    if (total < 7 || !c[0] || !c[1] || !c[2] || !c[3] || !c[4]) return false;
    var ms = total / 7;
    var v = ms / 2;
    return Math.abs(ms - c[0]) < v && Math.abs(ms - c[1]) < v && Math.abs(3 * ms - c[2]) < 3 * v && Math.abs(ms - c[3]) < v && Math.abs(ms - c[4]) < v;
  }
  function centerFromEnd(c, end) { return end - c[4] - c[3] - c[2] / 2; }

  // Through a candidate centre, along a column (vertical) or a row: the same 1:1:3:1:1 must be there.
  function crossCheck(m, along, fixed, start, maxCount, originalTotal) {
    var get = along === 'v' ? function (i) { return m.bits[i * m.width + fixed]; } : function (i) { return m.bits[fixed * m.width + i]; };
    var limit = along === 'v' ? m.height : m.width;
    var c = [0, 0, 0, 0, 0];
    var i = start;
    while (i >= 0 && get(i)) { c[2]++; i--; }
    if (i < 0) return NaN;
    while (i >= 0 && !get(i) && c[1] <= maxCount) { c[1]++; i--; }
    if (i < 0 || c[1] > maxCount) return NaN;
    while (i >= 0 && get(i) && c[0] <= maxCount) { c[0]++; i--; }
    if (c[0] > maxCount) return NaN;
    i = start + 1;
    while (i < limit && get(i)) { c[2]++; i++; }
    if (i === limit) return NaN;
    while (i < limit && !get(i) && c[3] < maxCount) { c[3]++; i++; }
    if (i === limit || c[3] >= maxCount) return NaN;
    while (i < limit && get(i) && c[4] < maxCount) { c[4]++; i++; }
    if (c[4] >= maxCount) return NaN;
    var total = c[0] + c[1] + c[2] + c[3] + c[4];
    if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return NaN;
    return crossesFinder(c) ? centerFromEnd(c, i) : NaN;
  }

  function findFinders(m) {
    var found = [];
    var add = function (c, row, end) {
      var total = c[0] + c[1] + c[2] + c[3] + c[4];
      var cx = centerFromEnd(c, end);
      var cy = crossCheck(m, 'v', Math.floor(cx), row, c[2], total);
      if (isNaN(cy)) return;
      cx = crossCheck(m, 'h', Math.floor(cy), Math.floor(cx), c[2], total);
      if (isNaN(cx)) return;
      var ms = total / 7;
      for (var k = 0; k < found.length; k++) {
        var f = found[k];
        if (Math.abs(cy - f.y) <= ms && Math.abs(cx - f.x) <= ms && (Math.abs(ms - f.ms) <= 1 || Math.abs(ms - f.ms) <= f.ms)) {
          var n = f.count + 1;
          f.x = (f.x * f.count + cx) / n; f.y = (f.y * f.count + cy) / n; f.ms = (f.ms * f.count + ms) / n; f.count = n;
          return;
        }
      }
      found.push({ x: cx, y: cy, ms: ms, count: 1 });
    };
    var step = m.height > 900 ? 2 : 1;
    for (var y = 0; y < m.height; y += step) {
      var c = [0, 0, 0, 0, 0];
      var state = 0;
      var rowOff = y * m.width;
      for (var x = 0; x < m.width; x++) {
        if (m.bits[rowOff + x]) {
          if (state & 1) state++;
          c[state]++;
        } else if (!(state & 1)) {
          if (state === 4) {
            if (crossesFinder(c)) add(c, y, x);
            c = [c[2], c[3], c[4], 1, 0];
            state = 3;
          } else {
            c[++state]++;
          }
        } else {
          c[state]++;
        }
      }
      if (state === 4 && crossesFinder(c)) add(c, y, m.width);
    }
    return found;
  }

  /** Every plausible top-left, top-right and bottom-left among the finder candidates, best first. */
  function finderTriples(found) {
    var pool = found.filter(function (f) { return f.count >= 2; });
    if (pool.length < 3) pool = found.slice();
    pool.sort(function (a, b) { return b.count - a.count; });
    pool = pool.slice(0, 12);
    var d2 = function (a, b) { return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y); };
    var out = [];
    for (var i = 0; i < pool.length; i++) {
      for (var j = i + 1; j < pool.length; j++) {
        for (var k = j + 1; k < pool.length; k++) {
          var p = [pool[i], pool[j], pool[k]];
          var msMin = Math.min(p[0].ms, p[1].ms, p[2].ms);
          var msMax = Math.max(p[0].ms, p[1].ms, p[2].ms);
          if (msMax > msMin * 1.6) continue;
          var sides = [[d2(p[1], p[2]), 0], [d2(p[0], p[2]), 1], [d2(p[0], p[1]), 2]].sort(function (a, b) { return a[0] - b[0]; });
          var a = sides[0][0]; var b = sides[1][0]; var c = sides[2][0];
          if (b > a * 2.5 || c < a) continue;
          // The corner opposite the longest side is the top-left; the others are told apart by turning direction.
          var tl = p[sides[2][1]];
          var o = p.filter(function (q) { return q !== tl; });
          var cross = (o[0].x - tl.x) * (o[1].y - tl.y) - (o[0].y - tl.y) * (o[1].x - tl.x);
          var tr = cross > 0 ? o[0] : o[1];
          var bl = cross > 0 ? o[1] : o[0];
          var score = Math.abs(c - a - b) / c + Math.abs(Math.sqrt(b) - Math.sqrt(a)) / Math.sqrt(b) + (msMax - msMin) / msMax;
          out.push({ tl: tl, tr: tr, bl: bl, score: score });
        }
      }
    }
    return out.sort(function (a, b) { return a.score - b.score; }).slice(0, 4);
  }

  /** Alignment patterns near where one should be (a dark module ringed by light, ringed by dark), nearest first. */
  // u and v are one module along the code's rows and down its columns, in pixels: a tilted photo makes them differ.
  function findAlignment(m, ex, ey, u, v, radius) {
    var hits = [];
    var lu = Math.sqrt(u[0] * u[0] + u[1] * u[1]);
    var lv = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    var ms = Math.max(lu, lv);
    var lo = Math.min(lu, lv) * 0.4;
    var near = function (n) { return n > lo && n < ms * 1.8; };
    var x0 = Math.max(0, Math.floor(ex - radius)); var x1 = Math.min(m.width - 1, Math.ceil(ex + radius));
    var y0 = Math.max(0, Math.floor(ey - radius)); var y1 = Math.min(m.height - 1, Math.ceil(ey + radius));
    var bit = function (x, y) { return x < 0 || y < 0 || x >= m.width || y >= m.height ? 0 : m.bits[y * m.width + x]; };
    var runs = function (x, y, dx, dy) {
      // From a dark centre: its own length outwards, then the light ring, then the dark ring.
      var n = 0; var a = 0; var b = 0;
      while (bit(x + dx * (n + 1), y + dy * (n + 1)) && n < ms * 2) n++;
      var p = n + 1;
      while (!bit(x + dx * p, y + dy * p) && a < ms * 2) { a++; p++; }
      while (bit(x + dx * p, y + dy * p) && b < ms * 2) { b++; p++; }
      return [n, a, b];
    };
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        if (!bit(x, y)) continue;
        var l = runs(x, y, -1, 0); var r = runs(x, y, 1, 0);
        if (!near(l[0] + r[0] + 1) || !near(l[1]) || !near(r[1]) || !l[2] || !r[2]) continue;
        var up = runs(x, y, 0, -1); var dn = runs(x, y, 0, 1);
        if (!near(up[0] + dn[0] + 1) || !near(up[1]) || !near(dn[1]) || !up[2] || !dn[2]) continue;
        var cx = x + (r[0] - l[0]) / 2; var cy = y + (dn[0] - up[0]) / 2;
        // All the way round, diagonals too: light one module out, dark two out. Data can look like the cross of it,
        // rarely like the whole ring.
        var ring = true;
        for (var k = 0; k < 8 && ring; k++) {
          var ax = [1, 1, 0, -1, -1, -1, 0, 1][k];
          var ay = [0, 1, 1, 1, 0, -1, -1, -1][k];
          var ox = ax * u[0] + ay * v[0];
          var oy = ax * u[1] + ay * v[1];
          if (bit(Math.floor(cx + ox), Math.floor(cy + oy)) || !bit(Math.floor(cx + 2 * ox), Math.floor(cy + 2 * oy))) ring = false;
        }
        if (!ring) continue;
        var dist = (cx - ex) * (cx - ex) + (cy - ey) * (cy - ey);
        if (!hits.some(function (h) { return Math.abs(h.x - cx) < ms && Math.abs(h.y - cy) < ms; })) hits.push({ x: cx, y: cy, dist: dist });
      }
    }
    return hits.sort(function (p, q) { return p.dist - q.dist; }).slice(0, 3);
  }

  /** The homography taking four grid points to four image points (solved directly, eight unknowns). */
  function homography(src, dst) {
    var A = [];
    for (var i = 0; i < 4; i++) {
      var u = src[i][0]; var v = src[i][1]; var x = dst[i][0]; var y = dst[i][1];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x, x]);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y, y]);
    }
    for (var c = 0; c < 8; c++) {
      var piv = c;
      for (var r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-12) return null;
      var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
      for (var r2 = 0; r2 < 8; r2++) {
        if (r2 === c) continue;
        var f = A[r2][c] / A[c][c];
        if (!f) continue;
        for (var k = c; k < 9; k++) A[r2][k] -= f * A[c][k];
      }
    }
    var hm = [];
    for (var q = 0; q < 8; q++) hm.push(A[q][8] / A[q][q]);
    return function (u2, v2) {
      var den = hm[6] * u2 + hm[7] * v2 + 1;
      return [(hm[0] * u2 + hm[1] * v2 + hm[2]) / den, (hm[3] * u2 + hm[4] * v2 + hm[5]) / den];
    };
  }

  function sampleGrid(m, t, size) {
    var g = new Uint8Array(size * size);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var p = t(x + 0.5, y + 0.5);
        var px = Math.floor(p[0]); var py = Math.floor(p[1]);
        if (px < 0 || py < 0 || px >= m.width || py >= m.height) return null;
        g[y * size + x] = m.bits[py * m.width + px];
      }
    }
    return g;
  }

  /* --------------------------------------------------- the grid */

  /** Text from a grid of modules (1 = dark), or null. */
  function decodeGrid(grid, size) {
    var version = (size - 17) / 4;
    if (version !== Math.floor(version) || version < 1 || version > 40) return null;
    var get = function (x, y) { return grid[y * size + x]; };
    var pos = formatPositions(size);
    var best = null;
    for (var copy = 0; copy < 2; copy++) {
      var word = 0;
      for (var i = 0; i < 15; i++) word |= get(pos[copy][i][0], pos[copy][i][1]) << i;
      for (var f = 0; f < FORMAT_WORDS.length; f++) {
        var x = word ^ FORMAT_WORDS[f].word;
        var dist = 0;
        while (x) { dist += x & 1; x >>>= 1; }
        if (!best || dist < best.dist) best = { dist: dist, fmt: FORMAT_WORDS[f] };
      }
    }
    if (!best || best.dist > 3) return null;
    var level = LEVEL_OF_BITS[best.fmt.levelBits];
    var mask = best.fmt.mask;

    // Codewords, read in the zigzag, two columns at a time from the right, skipping the timing column.
    var isFn = functionModules(version);
    var total = Math.floor(rawDataModules(version) / 8);
    var raw = new Uint8Array(total);
    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var cx = right - j;
          var upward = ((right + 1) & 2) === 0;
          var cy = upward ? size - 1 - vert : vert;
          if (isFn[cy * size + cx] || bitIndex >= total * 8) continue;
          var b = get(cx, cy) ^ (maskBit(mask, cx, cy) ? 1 : 0);
          if (b) raw[bitIndex >> 3] |= 0x80 >> (bitIndex & 7);
          bitIndex++;
        }
      }
    }

    // Blocks: the first are one data codeword shorter; codewords are interleaved across them.
    var numBlocks = NUM_BLOCKS[level][version];
    var eccLen = ECC_PER_BLOCK[level][version];
    var numShort = numBlocks - (total % numBlocks);
    var shortLen = Math.floor(total / numBlocks);
    var gap = shortLen - eccLen;
    var padded = [];
    for (var bi = 0; bi < numBlocks; bi++) padded.push(new Array(shortLen + 1));
    var k = 0;
    for (var col = 0; col <= shortLen; col++) {
      for (var bj = 0; bj < numBlocks; bj++) {
        // Short blocks have no codeword in the column where the long ones carry their extra data codeword.
        if (col === gap && bj < numShort) continue;
        padded[bj][col] = raw[k++];
      }
    }
    var blocks = padded.map(function (p, i) { return i < numShort ? p.slice(0, gap).concat(p.slice(gap + 1)) : p; });
    var data = [];
    for (var bk = 0; bk < numBlocks; bk++) {
      var blk = blocks[bk];
      if (!rsCorrect(blk, eccLen)) return null;
      for (var d = 0; d < blk.length - eccLen; d++) data.push(blk[d]);
    }
    return readSegments(data, version);
  }

  /** The bit stream as text: numeric, alphanumeric, byte (UTF-8 unless an ECI says otherwise) and kanji segments. */
  function readSegments(bytes, version) {
    var pos = 0;
    var left = function () { return bytes.length * 8 - pos; };
    var read = function (n) {
      var v = 0;
      for (var i = 0; i < n; i++) { v = (v << 1) | ((bytes[pos >> 3] >> (7 - (pos & 7))) & 1); pos++; }
      return v;
    };
    var size = version <= 9 ? 0 : version <= 26 ? 1 : 2;
    var out = '';
    var pending = [];
    var charset = 'utf-8';
    var flush = function () {
      if (!pending.length) return;
      out += decodeBytes(new Uint8Array(pending), charset);
      pending = [];
    };
    while (left() >= 4) {
      var mode = read(4);
      if (mode === 0) break;
      if (mode === 7) {
        // ECI: which character set the following bytes use.
        var first = read(8);
        var eci = (first & 0x80) === 0 ? first : (first & 0xc0) === 0x80 ? ((first & 0x3f) << 8) | read(8) : ((first & 0x1f) << 16) | read(16);
        flush();
        charset = eci === 26 ? 'utf-8' : eci === 20 ? 'shift_jis' : eci === 3 || eci === 1 ? 'iso-8859-1' : 'utf-8';
        continue;
      }
      if (mode === 3) { read(16); continue; }
      if (mode === 5) continue;
      if (mode === 9) { read(8); continue; }
      if (mode === 1) {
        flush();
        var n = read([10, 12, 14][size]);
        while (n >= 3) { if (left() < 10) return null; out += String(read(10) + 1000).slice(1); n -= 3; }
        if (n === 2) { if (left() < 7) return null; out += String(read(7) + 100).slice(1); }
        else if (n === 1) { if (left() < 4) return null; out += String(read(4)); }
      } else if (mode === 2) {
        flush();
        var na = read([9, 11, 13][size]);
        while (na >= 2) { if (left() < 11) return null; var v = read(11); out += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; na -= 2; }
        if (na === 1) { if (left() < 6) return null; out += ALNUM[read(6)]; }
      } else if (mode === 4) {
        var nb = read([8, 16, 16][size]);
        if (left() < nb * 8) return null;
        for (var b = 0; b < nb; b++) pending.push(read(8));
      } else if (mode === 8) {
        flush();
        var nk = read([8, 10, 12][size]);
        var sj = [];
        for (var q = 0; q < nk; q++) {
          if (left() < 13) return null;
          var kv = read(13);
          var assembled = Math.floor(kv / 0xc0) * 0x100 + (kv % 0xc0);
          assembled += assembled < 0x1f00 ? 0x8140 : 0xc140;
          sj.push(assembled >> 8, assembled & 0xff);
        }
        out += decodeBytes(new Uint8Array(sj), 'shift_jis');
      } else {
        break;
      }
    }
    flush();
    return out;
  }

  function decodeBytes(arr, charset) {
    if (typeof TextDecoder !== 'undefined') {
      try { return new TextDecoder(charset, { fatal: true }).decode(arr); } catch (e) { /* not that charset after all */ }
      try { return new TextDecoder('iso-8859-1').decode(arr); } catch (e) { /* fall through */ }
    }
    var s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return s;
  }

  /* ------------------------------------------------------- reading */

  /**
   * The width of a finder, in pixels, along the line towards another one: from its centre out through the dark core,
   * the light ring and the dark ring, both ways. A finder is 7 modules across, so this is the module size in that
   * direction, which a tilted photo makes different from the size across it (ZXing measures it the same way).
   */
  function finderWidthToward(m, from, to) {
    var len = Math.sqrt((to.x - from.x) * (to.x - from.x) + (to.y - from.y) * (to.y - from.y));
    if (!len) return NaN;
    var dx = (to.x - from.x) / len;
    var dy = (to.y - from.y) / len;
    var half = function (sx, sy) {
      // Dark core, light ring, dark ring: stop at the light after it.
      var state = 0;
      for (var i = 0; i < len; i++) {
        var x = Math.floor(from.x + sx * i);
        var y = Math.floor(from.y + sy * i);
        if (x < 0 || y < 0 || x >= m.width || y >= m.height) return state === 2 ? i : NaN;
        var dark = m.bits[y * m.width + x] === 1;
        if ((state === 0 || state === 2) && !dark) state++;
        else if (state === 1 && dark) state++;
        if (state === 3) return i;
      }
      return NaN;
    };
    return (half(dx, dy) + half(-dx, -dy)) / 7;
  }

  function tryTriple(m, t) {
    var dist = function (a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)); };
    var ms = (t.tl.ms + t.tr.ms + t.bl.ms) / 3;
    var along = function (a, b) {
      var w = (finderWidthToward(m, a, b) + finderWidthToward(m, b, a)) / 2;
      return isNaN(w) || w <= 0 ? ms : w;
    };
    var est = (dist(t.tl, t.tr) / along(t.tl, t.tr) + dist(t.tl, t.bl) / along(t.tl, t.bl)) / 2 + 7;
    // A size is 4n + 17: the four nearest the estimate, nearest first.
    var sizes = [];
    for (var c = 21; c <= 177; c += 4) sizes.push(c);
    sizes = sizes.sort(function (a, b) { return Math.abs(a - est) - Math.abs(b - est); }).slice(0, 4);
    for (var s = 0; s < sizes.length; s++) {
      var size = sizes[s];
      var brX = t.tr.x - t.tl.x + t.bl.x;
      var brY = t.tr.y - t.tl.y + t.bl.y;
      var corners = [[[3.5, 3.5], [t.tl.x, t.tl.y]], [[size - 3.5, 3.5], [t.tr.x, t.tr.y]], [[3.5, size - 3.5], [t.bl.x, t.bl.y]]];
      // The fourth point: the alignment pattern when there is one and it is found (it follows a tilted photo), and
      // the corner a flat picture would have either way, as a second try.
      var fourths = [];
      if (size > 21) {
        var corr = 1 - 3 / (size - 7);
        var ex = t.tl.x + corr * (brX - t.tl.x);
        var ey = t.tl.y + corr * (brY - t.tl.y);
        var u = [(t.tr.x - t.tl.x) / (size - 7), (t.tr.y - t.tl.y) / (size - 7)];
        var v = [(t.bl.x - t.tl.x) / (size - 7), (t.bl.y - t.tl.y) / (size - 7)];
        var near = findAlignment(m, ex, ey, u, v, ms * 4);
        var als = near.length ? near : findAlignment(m, ex, ey, u, v, ms * 9);
        for (var ai = 0; ai < als.length; ai++) fourths.push([[size - 6.5, size - 6.5], [als[ai].x, als[ai].y]]);
      }
      fourths.push([[size - 3.5, size - 3.5], [brX, brY]]);
      for (var fi = 0; fi < fourths.length; fi++) {
        var text = readWith(m, corners.concat([fourths[fi]]), size);
        if (text != null) return text;
      }
    }
    return null;
  }

  function readWith(m, pts, size) {
    var tf = homography(pts.map(function (p) { return p[0]; }), pts.map(function (p) { return p[1]; }));
    if (!tf) return null;
    var grid = sampleGrid(m, tf, size);
    if (!grid) return null;
    var text = decodeGrid(grid, size);
    if (text == null) {
      // A mirrored code (a selfie camera, a picture flipped): the same grid read across instead of down.
      var mirrored = new Uint8Array(size * size);
      for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) mirrored[x * size + y] = grid[y * size + x];
      text = decodeGrid(mirrored, size);
    }
    return text;
  }

  function decode(img) {
    if (!img || !img.data || !img.width || !img.height) return null;
    for (var pass = 0; pass < 2; pass++) {
      var m = binarize(img, pass === 1);
      var triples = finderTriples(findFinders(m));
      for (var i = 0; i < triples.length; i++) {
        var text = tryTriple(m, triples[i]);
        if (text != null) return text;
      }
    }
    return null;
  }

  var api = {
    decode: decode,
    // For the tests: the same tables and arithmetic, to make codes with.
    _internal: { ECC_PER_BLOCK: ECC_PER_BLOCK, NUM_BLOCKS: NUM_BLOCKS, LEVEL_OF_BITS: LEVEL_OF_BITS, alignmentPositions: alignmentPositions, rawDataModules: rawDataModules,
      formatWord: formatWord, formatPositions: formatPositions, maskBit: maskBit, functionModules: functionModules, rsEncode: rsEncode, rsCorrect: rsCorrect, decodeGrid: decodeGrid, binarize: binarize, findFinders: findFinders, finderTriples: finderTriples, tryTriple: tryTriple, findAlignment: findAlignment }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SentinelQR = api;
})(typeof window !== 'undefined' ? window : this);
