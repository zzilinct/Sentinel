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
        var l = links[(Math.random() * links.length) | 0];
        blocks.push({ x: l.x - 4, y: l.y - 2, w: l.w + 8, h: l.h + 4, until: now + 90 + Math.random() * 160, link: l });
        return;
      }
      var bw = 40 + Math.random() * Math.min(340, W * 0.4);
      var bh = CH * (1 + ((Math.random() * 6) | 0));
      blocks.push({ x: Math.random() * (W - bw), y: Math.random() * (H - bh), w: bw, h: bh, until: now + 60 + Math.random() * 170 });
    }

    function colorAt(x, y, links, now) {
      for (var i = 0; i < links.length; i++) {
        var l = links[i];
        if (x >= l.x - 4 && x <= l.x + l.w + 4 && y >= l.y - 2 && y <= l.y + l.h + 2) {
          // Until a link's verdict is in, its digits cycle through the colours.
          return l.color || LINK_CYCLE[(((now / 130) | 0) + i) % LINK_CYCLE.length];
        }
      }
      return 'gold';
    }

    function frame(now) {
      raf = 0;
      if (done) return;
      var links = (opts.links ? opts.links() : []) || [];
      if (fading) intensity = Math.max(0, 1 - (now - fading) / 420);
      else intensity = Math.min(1, (now - start) / 140);
      // About a fifth of the area at full strength, in quick, short-lived blocks.
      var want = Math.round((W * H) / 24000 * intensity * (opts.density || 1)) + (fading ? 0 : 1);
      blocks = blocks.filter(function (b) { return b.until > now; });
      while (blocks.length < want) spawn(now, links);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
      for (var i = 0; i < blocks.length; i++) {
        var b = blocks[i];
        ctx.globalAlpha = 0.8 * intensity;
        ctx.fillStyle = '#050403';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        var c0 = Math.floor(b.x / CW), c1 = Math.ceil((b.x + b.w) / CW);
        var r0 = Math.floor(b.y / CH), r1 = Math.ceil((b.y + b.h) / CH);
        for (var r = r0; r < r1; r++) {
          for (var c = c0; c < c1; c++) {
            if (Math.random() < 0.18) continue;      // gaps, like a broken signal
            var x = c * CW, y = r * CH;
            var col = colorAt(x + CW / 2, y + CH / 2, links, now);
            ctx.globalAlpha = (col === 'gold' ? 0.55 + Math.random() * 0.45 : 0.85 + Math.random() * 0.15) * intensity;
            ctx.drawImage(A.canvas, (Math.random() < 0.5 ? 0 : 1) * A.w, A.row[col] * A.h, A.w, A.h, x, y, CW, CH);
          }
        }
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
    var d = dig(host, opts);
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
