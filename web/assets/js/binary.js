/*
 * Binary: delicate scanning, made quiet. While Sentinel digs into something, a thin field of faint gold digits settles
 * behind the wait, and a soft band moves down it as the real stages finish. Over each link the digits take the link's
 * colour once its verdict is in. Nothing flickers: a digit turns over every two seconds or so, the field fades in and
 * out as one layer, and no frame can differ from the last by more than a faint digit (scripts/verify-web/47-calm-dig.js
 * measures that on real frames). A scan that ends within the grace period draws nothing at all.
 *
 *   SentinelBinary.dig(host, { links, around, grace })   dig into `host` (an element, or null for the links alone);
 *                                          links() returns [{ x, y, w, h, color }] in the host's own pixels; around:
 *                                          keeps the middle clear for words. Returns { progress(0..1), finish(), stop() }
 *   SentinelBinary.burst(host, ms, opts)   the same, ending by itself
 *   SentinelBinary.decode(el)              a heading arrives out of binary, left to right
 *   SentinelBinary.lens(selector)          hovering a card shows binary around the pointer
 *
 * Shared by the website, the web app and the Windows app's live scanning overlay (copied there by sync-shared.js).
 * With reduced motion it draws nothing, and every call still resolves.
 */
(function () {
  'use strict';

  var motion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');
  var isReduced = function () { return Boolean(motion && motion.matches); };
  // Severity colours made for black: the yellow is lemon, nothing like the gold.
  var COLORS = { gold: '#d6b25a', yellow: '#fff23a', orange: '#ff7a1a', red: '#ff3b3b', green: '#34e07a' };
  var CW = 9;
  var CH = 14;

  // The field: a digit in about a third of the places on a wide grid, faint, brighter only near the moving band.
  var GRACE_MS = 400;      // under this a scan shows nothing
  var FADE_IN_MS = 320;
  var FADE_OUT_MS = 260;
  var TICK_MS = 120;       // digits turn over in turn, each every sixteen of these
  var GAP_X = 16;
  var GAP_Y = 22;
  var FILL = 0.32;
  var FIELD_ALPHA = 0.1;
  var BAND_ALPHA = 0.26;
  var BAND_H = 90;
  var LINK_ALPHA = 0.34;

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

  // The same place always gets the same digit and the same moment to turn over: no frame draws anything by chance.
  function hash(a, b, c) { return (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) >>> 0; }
  function digit(h, tick) { return (h + ((tick + (h >>> 8) % 16) >> 4)) & 1; }

  function surface(host, around) {
    var c = document.createElement('canvas');
    c.className = 'binary-veil';
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = (host
      ? 'position:absolute;left:0;top:0;pointer-events:none;z-index:6;'
      : 'position:fixed;left:0;top:0;pointer-events:none;z-index:380;')
      + 'opacity:0;transition:opacity ' + FADE_IN_MS + 'ms ease-out;';
    if (around) c.style.webkitMaskImage = c.style.maskImage = 'radial-gradient(ellipse 52% 72% at 50% 50%, transparent 58%, #000 100%)';
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    (host || document.body).appendChild(c);
    return c;
  }

  function dig(host, opts) {
    opts = opts || {};
    if (isReduced()) return { progress: function () {}, finish: function () { return Promise.resolve(); }, stop: function () {} };
    var A = glyphs();
    var canvas = null, ctx = null;
    var W = 0, H = 0;
    var cells = [];
    var done = false;
    var raf = 0;
    var lastDraw = 0;
    var want = null;          // how far down the band should be, 0 to 1; null while the scan has not said
    var reach = 0;            // where it is, in pixels
    var lastTick = -1;

    var size = function () {
      var r = host ? host.getBoundingClientRect() : { width: innerWidth, height: innerHeight };
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * A.dpr); canvas.height = Math.round(H * A.dpr);
      // In pixels, not 100%: the host grows when the result lands, and the last of the digits must not stretch with it.
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      cells = [];
      if (!host) return;      // the whole window is never filled: only its links are dug into
      for (var y = 0; y < H; y += GAP_Y) {
        for (var x = 0; x < W; x += GAP_X) {
          var h = hash(x, y, 1);
          if (h % 1000 < FILL * 1000) cells.push({ x: x, y: y, h: h, a: 0.6 + (h % 41) / 100 });
        }
      }
      lastTick = -1;
    };

    function alphaAt(c) {
      var base = FIELD_ALPHA * c.a;
      if (want === null) return base;
      var d = c.y - reach;
      if (d > BAND_H) return base * 0.5;
      var near = Math.max(0, 1 - Math.abs(d) / BAND_H);
      return base + (BAND_ALPHA - FIELD_ALPHA) * near * near;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min(100, now - lastDraw);
      if (dt < 33) return;    // thirty frames a second is plenty for something this slow
      lastDraw = now;
      var tick = Math.floor(now / TICK_MS);
      var goal = want === null ? 0 : want * H;
      var moving = Math.abs(goal - reach) > 0.5;
      if (!moving && tick === lastTick) return;
      lastTick = tick;
      if (moving) reach += (goal - reach) * (1 - Math.exp(-dt / 420));
      ctx.setTransform(A.dpr, 0, 0, A.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var gold = A.row.gold * A.h;
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        ctx.globalAlpha = alphaAt(c);
        ctx.drawImage(A.canvas, digit(c.h, tick) * A.w, gold, A.w, A.h, c.x, c.y, CW, CH);
      }
      var links = (opts.links ? opts.links() : []) || [];
      ctx.globalAlpha = LINK_ALPHA;
      for (var k = 0; k < links.length; k++) {
        var l = links[k], row = A.row[l.color] != null ? A.row[l.color] : A.row.gold;
        for (var ly = 0; ly < l.h; ly += CH + 2) {
          for (var lx = 0; lx < l.w; lx += CW + 3) {
            var lh = hash(lx, ly, k + 2);
            if (lh % 10 < 6) ctx.drawImage(A.canvas, digit(lh, tick) * A.w, row * A.h, A.w, A.h, l.x + lx, l.y + ly, CW, CH);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    function begin() {
      begin.timer = 0;
      canvas = surface(host || null, opts.around);
      ctx = canvas.getContext('2d');
      size();
      window.addEventListener('resize', size);
      raf = requestAnimationFrame(frame);
      canvas.getBoundingClientRect();
      canvas.style.opacity = '1';
    }

    function stop() {
      done = true;
      clearTimeout(begin.timer);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      if (canvas) canvas.remove();
    }

    begin.timer = setTimeout(begin, opts.grace == null ? GRACE_MS : opts.grace);
    return {
      // How far the scan has really got, from 0 to 1: only ever what it reported.
      progress: function (p) { want = Math.max(0, Math.min(1, p)); },
      // The answer is in: the digits fade by themselves, over whatever is there by now. Nothing waits for this.
      finish: function () {
        if (done) return Promise.resolve();
        if (!canvas) { stop(); return Promise.resolve(); }
        done = true;
        if (raf) cancelAnimationFrame(raf);
        window.removeEventListener('resize', size);
        if (!canvas.isConnected) (host || document.body).appendChild(canvas);
        canvas.style.transition = 'opacity ' + FADE_OUT_MS + 'ms ease-out';
        canvas.style.opacity = '0';
        return new Promise(function (resolve) { setTimeout(function () { canvas.remove(); resolve(); }, FADE_OUT_MS); });
      },
      stop: stop
    };
  }

  function burst(host, ms, opts) {
    // A passing moment (a chapter arriving on the website).
    opts = opts || {};
    var d = dig(host, { links: opts.links, grace: 0 });
    return new Promise(function (resolve) { setTimeout(function () { d.finish().then(resolve); }, ms || 900); });
  }

  /* -------------------------------------------- a heading out of binary */

  function decode(el, ms) {
    if (isReduced() || !el || el.dataset.decoding) return;
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
    if (isReduced() || !(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches)) return;
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
