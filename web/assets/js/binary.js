/*
 * Binary: delicate scanning, made visible. While Sentinel digs into a site, the screen corrupts into flickering
 * binary for a moment: gold digits on black, and over each link the digits take the link's colour (lemon yellow,
 * orange, red, or green when it is clear). It is fast and thin, so the page underneath stays readable, and it fades
 * once everything has been checked.
 *
 *   SentinelBinary.dig(host, { links })   corrupt `host` (an element, or null for the whole window) until .finish();
 *                                          links() returns [{ x, y, w, h, color }] in the host's own pixels
 *   SentinelBinary.burst(host, ms, opts)   the same, ending by itself
 *   SentinelBinary.decode(el)              a heading arrives out of binary, left to right
 *   SentinelBinary.lens(selector)          hovering a card shows binary around the pointer
 *
 * Shared by the website, the web app and the Windows app's live scanning overlay (copied there by sync-shared.js).
 * With reduced motion it draws nothing, and every call still resolves.
 */
(function () {
  'use strict';

  var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Severity colours made for black: the yellow is lemon, nothing like the gold.
  var COLORS = { gold: '#d6b25a', yellow: '#fff23a', orange: '#ff7a1a', red: '#ff3b3b', green: '#34e07a' };
  var LINK_CYCLE = ['yellow', 'red', 'green', 'orange'];
  var CW = 9;
  var CH = 14;

  // Each digit in each colour, drawn once: the frames only place them.
  var atlas = null;
  function glyphs() {
    if (atlas) return atlas;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var names = Object.keys(COLORS);
    var c = document.createElement('canvas');
    c.width = Math.ceil(CW * dpr) * 2;
    c.height = Math.ceil(CH * dpr) * names.length;
    var g = c.getContext('2d');
    g.font = 'bold ' + Math.round(12 * dpr) + 'px ui-monospace, "Cascadia Mono", Consolas, monospace';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    names.forEach(function (n, row) {
      g.fillStyle = COLORS[n];
      g.shadowColor = COLORS[n];
      g.shadowBlur = 4 * dpr;
      for (var d = 0; d < 2; d++) g.fillText(String(d), (d + 0.5) * Math.ceil(CW * dpr), (row + 0.5) * Math.ceil(CH * dpr));
    });
    atlas = { canvas: c, dpr: dpr, w: Math.ceil(CW * dpr), h: Math.ceil(CH * dpr), row: names.reduce(function (m, n, i) { m[n] = i; return m; }, {}) };
    return atlas;
  }

  // Whole sheets of digits in each colour, drawn once, with the gaps of a broken signal: a block of binary is then
  // one copy from a random place on a sheet instead of a hundred digits, so the screen can be full of it.
  var PCOLS = 48;
  var PROWS = 10;
  var sheets = null;
  function patches() {
    if (sheets) return sheets;
    var A = glyphs();
    sheets = {};
    Object.keys(COLORS).forEach(function (n) {
      sheets[n] = [0, 1, 2].map(function () {
        var c = document.createElement('canvas');
        c.width = A.w * PCOLS; c.height = A.h * PROWS;
        var g = c.getContext('2d');
        for (var r = 0; r < PROWS; r++) {
          for (var k = 0; k < PCOLS; k++) {
            if (Math.random() < 0.18) continue;
            g.globalAlpha = n === 'gold' ? 0.55 + Math.random() * 0.45 : 0.85 + Math.random() * 0.15;
            g.drawImage(A.canvas, (Math.random() < 0.5 ? 0 : 1) * A.w, A.row[n] * A.h, A.w, A.h, k * A.w, r * A.h, A.w, A.h);
          }
        }
        return c;
      });
    });
    return sheets;
  }

  function surface(host) {
    var c = document.createElement('canvas');
    c.className = 'binary-veil';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = host
      ? 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;'
      : 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:380;';
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    (host || document.body).appendChild(c);
    return c;
  }

  function dig(host, opts) {
    opts = opts || {};
    var done = false;
    var resolveFinish = null;
    if (reduced) return { finish: function () { return Promise.resolve(); }, stop: function () {} };
    var A = glyphs();
    var S = patches();
    var canvas = surface(host || null);
    var ctx = canvas.getContext('2d');
    var W = 0, H = 0;
    var size = function () {
      var r = host ? host.getBoundingClientRect() : { width: innerWidth, height: innerHeight };
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * A.dpr); canvas.height = Math.round(H * A.dpr);
    };
    size();
    var blocks = [];
    var intensity = 1;        // how much of the screen is corrupt at once (falls to 0 as it finishes)
    var fading = 0;           // when finishing started
    var start = performance.now();
    var raf = 0;

    function spawn(now, links) {
      // Most of the corruption lands on the links: that is what is being dug into.
      if (links.length && Math.random() < 0.5) {
        var li = (Math.random() * links.length) | 0, l = links[li];
        blocks.push({ x: l.x - 4, y: l.y - 2, w: l.w + 8, h: l.h + 4, until: now + 90 + Math.random() * 160, li: li });
        return;
      }
      var bw = CW * Math.round((40 + Math.random() * Math.min(380, W * 0.45)) / CW);
      var bh = CH * (1 + ((Math.random() * 8) | 0));
      blocks.push({ x: CW * Math.floor(Math.random() * (W - bw) / CW), y: CH * Math.floor(Math.random() * (H - bh) / CH), w: bw, h: bh, until: now + 60 + Math.random() * 190 });
    }

    // Until a link's verdict is in, its digits cycle through the colours.
    function linkColor(l, i, now) {
      return l.color || LINK_CYCLE[(((now / 130) | 0) + i) % LINK_CYCLE.length];
    }

    // A block of digits: copies from a random place on a sheet, every frame, so the digits never sit still.
    function paint(b, col) {
      var list = S[col] || S.gold;
      for (var y = 0; y < b.h; y += PROWS * CH) {
        for (var x = 0; x < b.w; x += PCOLS * CW) {
          var cols = Math.min(PCOLS, Math.ceil((b.w - x) / CW)), rows = Math.min(PROWS, Math.ceil((b.h - y) / CH));
          var sx = ((Math.random() * (PCOLS - cols + 1)) | 0) * A.w, sy = ((Math.random() * (PROWS - rows + 1)) | 0) * A.h;
          ctx.drawImage(list[(Math.random() * list.length) | 0], sx, sy, cols * A.w, rows * A.h, b.x + x, b.y + y, cols * CW, rows * CH);
        }
      }
    }

    function frame(now) {
      raf = 0;
      if (done) return;
      var links = (opts.links ? opts.links() : []) || [];
      if (fading) intensity = Math.max(0, 1 - (now - fading) / 420);
      else intensity = Math.min(1, (now - start) / 140);
      // Nearly half the area at full strength (density 1 is about a fifth), in quick, short-lived blocks.
      var want = Math.round((W * H) / 24000 * intensity * (opts.density || 2.6)) + (fading ? 0 : 1);
      blocks = blocks.filter(function (b) { return b.until > now; });
      while (blocks.length < want) spawn(now, links);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        ctx.globalAlpha = 0.72 * intensity;
        ctx.fillStyle = '#050403';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = intensity;
        paint(b, b.li != null && links[b.li] ? linkColor(links[b.li], b.li, now) : 'gold');
      }
      ctx.globalAlpha = 1;
      if (fading && intensity <= 0) { stop(); if (resolveFinish) resolveFinish(); return; }
      raf = requestAnimationFrame(frame);
    }
    function stop() {
      done = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }
    window.addEventListener('resize', size);
    raf = requestAnimationFrame(frame);
    return {
      // Everything has been checked: the corruption thins out and is gone in under half a second.
      finish: function () {
        if (done) return Promise.resolve();
        return new Promise(function (resolve) { resolveFinish = resolve; if (!fading) fading = performance.now(); });
      },
      stop: stop
    };
  }

  function burst(host, ms, opts) {
    // A passing moment (a chapter arriving on the website), lighter than a scan digging in.
    opts = opts || {};
    var d = dig(host, { links: opts.links, density: opts.density || 1 });
    return new Promise(function (resolve) { setTimeout(function () { d.finish().then(resolve); }, ms || 900); });
  }

  /* -------------------------------------------- a heading out of binary */

  function decode(el, ms) {
    if (reduced || !el || el.dataset.decoding) return;
    el.dataset.decoding = '1';
    var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push({ n: walker.currentNode, text: walker.currentNode.nodeValue });
    var total = nodes.reduce(function (s, x) { return s + x.text.length; }, 0);
    if (!total) return;
    var dur = ms || Math.min(1100, 380 + total * 14);
    var t0 = performance.now();
    function step(now) {
      var shown = Math.floor(Math.min(1, (now - t0) / dur) * total);
      var k = 0;
      nodes.forEach(function (x) {
        var out = '';
        for (var i = 0; i < x.text.length; i++, k++) {
          var ch = x.text[i];
          out += k < shown || ch === ' ' || ch === '\n' ? ch : (Math.random() < 0.5 ? '0' : '1');
        }
        x.n.nodeValue = out;
      });
      if (shown < total) requestAnimationFrame(step);
      else { nodes.forEach(function (x) { x.n.nodeValue = x.text; }); delete el.dataset.decoding; }
    }
    requestAnimationFrame(step);
  }

  /* ------------------------------------- a lens of binary under the pointer */

  function lens(selector) {
    if (reduced || !(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches)) return;
    var A = null, canvas = null, ctx = null, host = null, px = 0, py = 0, alpha = 0, raf = 0;
    function draw() {
      raf = 0;
      if (!host) { alpha = Math.max(0, alpha - 0.12); } else { alpha = Math.min(1, alpha + 0.15); }
      var r = canvas.__r;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (alpha <= 0) { canvas.remove(); canvas = null; return; }
      ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
      var R = 96;
      var c0 = Math.max(0, Math.floor((px - R) / CW)), c1 = Math.ceil((px + R) / CW);
      var r0 = Math.max(0, Math.floor((py - R) / CH)), r1 = Math.ceil((py + R) / CH);
      for (var row = r0; row < r1; row++) {
        for (var c = c0; c < c1; c++) {
          var x = c * CW, y = row * CH;
          if (x > r.width || y > r.height) continue;
          var d = Math.hypot(x + CW / 2 - px, y + CH / 2 - py) / R;
          if (d > 1 || Math.random() < 0.35) continue;
          ctx.globalAlpha = (1 - d) * (1 - d) * 0.5 * alpha;
          ctx.drawImage(A.canvas, (Math.random() < 0.5 ? 0 : 1) * A.w, A.row.gold * A.h, A.w, A.h, x, y, CW, CH);
        }
      }
      raf = requestAnimationFrame(draw);
    }
    document.addEventListener('pointerover', function (e) {
      var el = e.target.closest && e.target.closest(selector);
      if (!el || el === host) return;
      host = el;
      A = glyphs();
      if (canvas) canvas.remove();
      canvas = document.createElement('canvas');
      canvas.className = 'binary-lens';
      canvas.setAttribute('aria-hidden', 'true');
      // Behind the card's own text, over its background: the card becomes its own layer for it.
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:-1;border-radius:inherit;';
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      el.style.isolation = 'isolate';
      el.appendChild(canvas);
      ctx = canvas.getContext('2d');
      var rect = el.getBoundingClientRect();
      canvas.__r = rect;
      canvas.width = Math.round(rect.width * A.dpr);
      canvas.height = Math.round(rect.height * A.dpr);
      if (!raf) raf = requestAnimationFrame(draw);
    });
    document.addEventListener('pointermove', function (e) {
      if (!host) return;
      var r = host.getBoundingClientRect();
      px = e.clientX - r.left; py = e.clientY - r.top;
    }, { passive: true });
    document.addEventListener('pointerout', function (e) {
      if (host && !host.contains(e.relatedTarget)) { host = null; if (!raf && canvas) raf = requestAnimationFrame(draw); }
    });
  }

  window.SentinelBinary = { dig: dig, burst: burst, decode: decode, lens: lens, COLORS: COLORS };
})();
