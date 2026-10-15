/*
 * The galaxy: every scam wears a mask. Small scam scenes ride six spiral arms out of Sentinel's mark, born small and
 * soft at the centre, sharpening and widening from rounded squares to 16:9 as they travel out, while the whole
 * system turns slowly clockwise. After ArtCraft's hero galaxy (its parameters, mostly as they are).
 *
 *   Motion      the system turns 50 degrees a minute and the cards travel 0.57 journeys a minute; the page's scroll
 *               moves them along too (0.2 journeys per 1000 px, both ways). Cards float with a small wobble.
 *   Arrival     the first time the chapter is seen, a wave runs out from the mark and uncovers the cards, with a
 *               ring of colour behind it, and the field arrives moving fast and settles.
 *   Pointer     cards within 320 px lean and tug toward it. The card under it brakes to a stop and shows Sentinel's
 *               verdict (its mask colour and a short reason); the rest of the spiral follows more slowly. A click
 *               sends a ripple through the field and enlarges the card with its caption.
 *   Keyboard    the list of scenes under the canvas is the same cards: tabbing to one holds it, Enter enlarges it.
 *   Phones      three arms and 26 small cards; elsewhere the count follows the stage's area (up to two of each scene).
 *   Governor    under 30 frames a second, it sheds cards until smooth, and slowly takes them back.
 *   Rest        it draws nothing off screen or in a hidden tab, and under reduced motion it is one still spiral.
 *
 * Canvas 2D: the cards are pictures, and the blur is a tiny copy of each, scaled up. The pure parts (the spiral, the
 * sizing, the governor) are exported for tests/galaxy.test.js.
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------ parameters */

  var TAU = Math.PI * 2;
  var P = {
    arms: 6, turns: 1.05, rMaxFrac: 0.7, birthFrac: 0.08, cardN: 96, tunedMpx: 1.1, cardHFrac: 0.12, cardWFrac: 0.15, armJitter: 0.76,
    ticksPerArm: 16, circFrac: 0.56,
    idle: 0.57 / 60, scrub: 0.2 / 1000, spin: (50 / 60) * Math.PI / 180, wobble: 6, wobbleHz: 0.25,
    introDur: 3.2, burstX: 3, burstDur: 2.5, waveBand: 220, flareLag: 0.4, perfFloor: 30,
    field: 320, tug: 8, lean: 4 * Math.PI / 180, holdTau: 0.15, restTau: 1, rippleSpeed: 900, rippleWidth: 140, rippleLife: 1.8, rippleWarp: 22,
    boost: 3, boostTau: 0.18, density: 0.82, corner: 8, innerCap: 0.22, aspectEnd: 0.3, blurEnd: 0.18, fadeBand: 0.15,
    frameAlpha: 0.22, lineAlpha: 0.32, minCards: 10
  };
  // The phone keeps three straighter arms, with more and much smaller cards than ArtCraft's 14, so the arms show.
  var MOBILE = { mpx: 0.6, arms: 3, turns: 0.7, cardN: 26, rMaxFrac: 0.8, cardHFrac: 0.085, cardWFrac: 0.27, birthFrac: 0.08, density: 0.82 * 1.15 };
  var WIDE = 16 / 9;

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var frac = function (v) { return v - Math.floor(v); };
  var smooth = function (a, b, v) { var t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  var ease = function (dt, tau) { return 1 - Math.exp(-dt / tau); };

  /** The stage's profile: arms, windings, radii and how many cards, for a stage W x H (CSS px). */
  function profile(W, H, items) {
    var mpx = (W * H) / 1e6;
    var mob = mpx < MOBILE.mpx;
    var half = Math.hypot(W, H) / 2;
    var rMax = (mob ? MOBILE.rMaxFrac : P.rMaxFrac) * half;
    var capH = (mob ? MOBILE.cardHFrac : P.cardHFrac) * H;
    var want = mob ? MOBILE.cardN : Math.max(P.minCards + 4, Math.round(P.cardN * mpx / P.tunedMpx));
    return {
      mobile: mob, W: W, H: H, arms: mob ? MOBILE.arms : P.arms, turns: mob ? MOBILE.turns : P.turns,
      rMax: rMax, rBirth: (mob ? MOBILE.birthFrac : P.birthFrac) * rMax, rEnd: half + capH * WIDE * 0.6,
      capH: capH, capW: (mob ? MOBILE.cardWFrac : P.cardWFrac) * W, density: mob ? MOBILE.density : P.density,
      // Up to two of each scene: a scene's second card rides an arm half the spiral away (see build).
      n: Math.min(items * 2, want)
    };
  }

  /** Where card k of n starts its journey (0 to 1): dealt round the arms, each arm's conveyor a little out of step. */
  function slot(k, n, arms) {
    var perArm = Math.ceil(n / arms);
    var a = k % arms;
    return { arm: a, u: frac((Math.floor(k / arms) + frac(a * P.armJitter)) / perArm) };
  }

  /** A point on arm `arm` at journey u, with the system turned by `spin` (radians, clockwise on screen). */
  function spiral(pr, arm, u, spin) {
    var r = pr.rBirth + (pr.rEnd - pr.rBirth) * u;
    var th = spin + arm * TAU / pr.arms + pr.turns * TAU * r / pr.rMax;
    return { r: r, th: th, x: Math.cos(th) * r, y: Math.sin(th) * r };
  }

  /**
   * Each card's largest height that keeps it clear of its neighbours (as they are now): two boxes do not overlap
   * when they are apart along x by half their widths, or along y by half their heights. cards: [{ x, y, asp, s }].
   */
  function room(cards, i) {
    var c = cards[i];
    var best = Infinity;
    for (var j = 0; j < cards.length; j++) {
      if (j === i || cards[j].skip) continue;
      var o = cards[j];
      var byX = (2 * Math.abs(o.x - c.x) - o.s * o.asp) / c.asp;
      var byY = 2 * Math.abs(o.y - c.y) - o.s;
      var lim = Math.max(byX, byY);
      if (lim < best) best = lim;
    }
    return Math.max(0, best);
  }

  /** The frame-rate governor: sheds cards below the floor, takes one back after a long smooth spell. */
  function Governor(max, floor) {
    this.max = max; this.n = max; this.floor = floor || P.perfFloor;
    this.acc = 0; this.frames = 0; this.slow = 0; this.good = 0;
  }
  Governor.prototype.tick = function (dt) {
    if (!this.floor || dt <= 0 || dt > 0.5) return this.n;   // a pause (a hidden tab, a stall) says nothing of the rate
    this.acc += dt; this.frames++;
    if (this.acc < 1) return this.n;
    var fps = this.frames / this.acc;
    this.acc = 0; this.frames = 0;
    if (fps < this.floor) { this.good = 0; if (++this.slow >= 2) { this.slow = 0; this.n = Math.max(P.minCards, Math.floor(this.n * 0.85)); } }
    else { this.slow = 0; if (fps > 50 && ++this.good >= 6 && this.n < this.max) { this.good = 0; this.n++; } }
    return this.n;
  };

  var api = { P: P, MOBILE: MOBILE, profile: profile, slot: slot, spiral: spiral, room: room, Governor: Governor };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  /* ------------------------------------------------------------------- page */

  var host = document.querySelector('[data-galaxy]');
  if (!host) return;
  var canvas = host.querySelector('.galaxy__canvas');
  var ctx = canvas.getContext('2d');
  var tagEl = host.querySelector('.galaxy__tag');
  var capEl = host.querySelector('.galaxy__caption');
  var listEl = host.querySelector('.galaxy__list');
  var rootEl = document.documentElement;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var script = document.currentScript;
  var imgBase = script ? new URL('../img/', script.src).href : '/assets/img/';
  var M = root.SentinelMasks;
  var TINTS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };

  var items = Array.prototype.map.call(listEl.querySelectorAll('button'), function (b, i) {
    b.dataset.i = i;
    return { i: i, b: b, src: imgBase + b.dataset.img, mask: /^masks\//.test(b.dataset.img), kind: b.dataset.kind, tint: b.dataset.tint,
      tag: b.dataset.tag, caption: b.dataset.caption, img: null, soft: null, ready: false };
  });

  var pr = null;
  var cards = [];
  var gov = null;
  var dpr = 1;
  var ink = { line: '210 172 99', card: '#1b1712', dark: true };
  var seen = false;            // on screen (or near enough to draw)
  var started = 0;             // when the arrival began (0: not yet)
  var raf = 0;
  var last = 0;
  var frames = 0;
  var drawn = 0;
  var clock = 0;               // the conveyor, in journeys
  var spin = 0;                // the system's turn, in radians
  var flow = 1;                // how much the spiral moves (0 while a card is held)
  var pointer = null;          // { x, y } in the stage, while it is over the stage
  var held = null;             // the card held still (under the pointer, tapped, or focused)
  var boosted = null;          // the card enlarged
  var ripples = [];
  var W = 0, H = 0;

  /* ------------------------------------------------------------- the cards */

  var near = false;            // the chapter is near: the pictures may be fetched
  function load(item) {
    if (item.img || !near) return;
    var img = item.img = new Image();
    img.decoding = 'async';
    img.onload = function () {
      // The soft copy: a few pixels across, scaled up, is the blur at birth.
      var s = document.createElement('canvas');
      var k = 18 / Math.max(img.naturalWidth, img.naturalHeight);
      s.width = Math.max(2, Math.round(img.naturalWidth * k * (item.mask ? 1 : 1.6)));
      s.height = Math.max(2, Math.round(img.naturalHeight * k * (item.mask ? 1 : 1.6)));
      s.getContext('2d').drawImage(img, 0, 0, s.width, s.height);
      item.soft = s;
      item.ready = true;
      if (reduced) still();
    };
    img.src = item.src;
  }

  function build() {
    var r = host.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    var was = pr && pr.n;
    pr = profile(W, H, items.length);
    if (was === pr.n && cards.length) return;
    // Cards keep their scene where they can, so a resize does not reshuffle what was on screen.
    var old = cards;
    cards = [];
    for (var k = 0; k < pr.n; k++) {
      var sl = slot(k, pr.n, pr.arms);
      var o = old[k];
      cards.push({ k: k, item: o ? o.item : items[k % items.length], arm: sl.arm, u0: sl.u, t: clock, spin: spin, own: 1, s: 0, asp: 1, x: 0, y: 0,
        wob: [Math.random() * TAU, Math.random() * TAU], flare: 0, wa: 1, boost: 1, focus: false, gone: 0, alpha: 0, lean: 0, rect: null });
    }
    // The order cards are shed in, spread over the arms and the journey (golden-ratio steps), so the few that stay
    // still fill the spiral.
    cards.map(function (c) { return c; }).sort(function (a, b) { return frac(a.k * 0.618034) - frac(b.k * 0.618034); })
      .forEach(function (c, r) { c.rank = r; });
    gov = new Governor(pr.n);
    held = boosted = null;
    cards.forEach(function (c) { load(c.item); });
  }

  function readInk() {
    var cs = getComputedStyle(host);
    ink.line = cs.getPropertyValue('--galaxy-line').trim() || '210 172 99';
    ink.card = cs.getPropertyValue('--galaxy-card').trim() || '#1b1712';
    ink.dark = cs.getPropertyValue('--galaxy-dark').trim() !== '0';
  }

  /* ----------------------------------------------------------------- frame */

  function step(dt, now) {
    var t = started ? (now - started) / 1000 : 0;
    var burst = reduced ? 1 : 1 + (P.burstX - 1) * (1 - smooth(0, 1, t / P.burstDur));
    var scroll = reduced ? 0 : (window.scrollY || 0) * P.scrub;
    // The spiral eases to a stop behind a held card, and back to its drift when let go.
    flow += ((held ? 0 : 1) - flow) * ease(dt, held ? P.restTau : 0.6);
    clock += dt * P.idle * burst * flow;
    spin += dt * P.spin * flow;
    var n = reduced ? pr.n : gov.n;
    var cx = W / 2, cy = H / 2;
    var wave = reduced ? Infinity : (t / P.introDur) * (pr.rEnd + P.waveBand);
    var ring = reduced ? -1 : ((t - P.flareLag) / P.introDur) * (pr.rEnd + P.waveBand);
    ripples = ripples.filter(function (rp) { return now - rp.t0 < P.rippleLife * 1000; });

    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var isHeld = c === held;
      // Each card keeps its own place on the conveyor: the held one brakes fast, the rest follow the spiral's flow,
      // and once let go a card catches up with the others.
      c.own += ((isHeld ? 0 : flow) - c.own) * ease(dt, isHeld ? P.holdTau : 0.3);
      c.t += dt * P.idle * burst * c.own;
      c.spin += dt * P.spin * c.own;
      if (!isHeld) { var k = ease(dt, 1.5); c.t += (clock - c.t) * k; c.spin += (spin - c.spin) * k; }
      c.gone += ((c.rank < n ? 0 : 1) - c.gone) * ease(dt, 0.4);
      var u = frac(c.u0 + c.t + scroll);
      var p = spiral(pr, c.arm, u, c.spin);
      var x = cx + p.x, y = cy + p.y;
      // Wobble, eased away on the held card (the rest strain a little against the stop).
      c.wa += ((isHeld ? 0 : held ? 1.2 : 1) - c.wa) * ease(dt, P.holdTau);
      var wb = reduced ? 0 : P.wobble * c.wa;
      x += wb * Math.sin(TAU * P.wobbleHz * now / 1000 + c.wob[0]);
      y += wb * Math.cos(TAU * P.wobbleHz * 0.83 * now / 1000 + c.wob[1]);
      // The pointer's pull and lean.
      var lean = 0;
      if (pointer && !reduced) {
        var dx = pointer.x - x, dy = pointer.y - y, d = Math.hypot(dx, dy);
        if (d < P.field && d > 1) {
          var f = (1 - d / P.field) * (1 - d / P.field);
          x += dx / d * P.tug * f; y += dy / d * P.tug * f;
          if (!isHeld) lean = clamp(dx / P.field, -1, 1) * P.lean * (1 - d / P.field);
        }
      }
      c.lean += (lean - c.lean) * ease(dt, 0.25);
      // Ripples push the cards they cross outward, with a flash of colour.
      var flare = 0;
      for (var q = 0; q < ripples.length; q++) {
        var rp = ripples[q];
        var age = (now - rp.t0) / 1000;
        var rdx = x - rp.x, rdy = y - rp.y, rd = Math.hypot(rdx, rdy) || 1;
        var band = Math.exp(-Math.pow((rd - age * P.rippleSpeed) / (P.rippleWidth / 2), 2)) * (1 - age / P.rippleLife);
        x += rdx / rd * P.rippleWarp * band; y += rdy / rd * P.rippleWarp * band;
        flare += band;
      }
      // The arrival: uncovered by the wave, flashed by the ring behind it.
      var shown = reduced ? 1 : clamp((wave - p.r) / P.waveBand, 0, 1);
      flare += reduced ? 0 : Math.exp(-Math.pow((p.r - ring) / (P.waveBand * 0.45), 2)) * 0.9;
      c.flare = Math.min(1, flare);
      c.x = x; c.y = y; c.u = u; c.r = p.r; c.th = p.th;
      c.asp = 1 + (WIDE - 1) * smooth(0, P.aspectEnd, u);
      c.blur = Math.max(1 - smooth(0, P.blurEnd, u), 1 - shown);
      c.alpha = smooth(0, P.fadeBand, u) * smooth(0, 0.5, shown) * (1 - c.gone) * (c.item.ready ? 1 : 0.35);
      c.skip = c.alpha < 0.02;
    }
    // Sizes: as much room as the neighbours leave, smaller near the centre, eased so a passing card never jumps.
    for (var m = 0; m < cards.length; m++) {
      var cc = cards[m];
      if (cc.skip) { cc.s = 0; continue; }   // reborn at the centre at its new size, not grown down from its old one
      // Born small in the pocket round the mark: never wider than the card is far from the centre.
      var cap = Math.min(pr.capH * (P.innerCap + (1 - P.innerCap) * smooth(0, 0.6, cc.u)), cc.r * 0.5, pr.capW / cc.asp);
      var want = Math.max(6, Math.min(cap, pr.density * room(cards, m)));
      cc.s += (want - cc.s) * (cc.s && !reduced ? ease(dt, 0.2) : 1);
      cc.boost += (((cc === boosted) ? P.boost : 1) - cc.boost) * (reduced ? 1 : ease(dt, P.boostTau));
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  // A picture into a box: cropped to fill it, or a mask stood whole on the card.
  function picture(src, item, x, y, w, h) {
    var iw = src.width || src.naturalWidth, ih = src.height || src.naturalHeight;
    if (item.mask) {
      var k = Math.min(w / iw, h / ih) * 0.94;
      ctx.drawImage(src, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
      return;
    }
    var a = w / h, ia = iw / ih;
    var sw = a < ia ? ih * a : iw, sh = a < ia ? ih : iw / a;
    ctx.drawImage(src, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
  }

  function underlay(now) {
    var cx = W / 2, cy = H / 2;
    var col = 'rgb(' + ink.line + ' / ';
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = col + P.lineAlpha + ')';
    for (var a = 0; a < pr.arms; a++) {
      ctx.beginPath();
      for (var s = 0; s <= 72; s++) {
        var p = spiral(pr, a, s / 72, spin);
        if (s) ctx.lineTo(cx + p.x, cy + p.y); else ctx.moveTo(cx + p.x, cy + p.y);
      }
      ctx.stroke();
      // Ticks across the arm's outer half.
      ctx.beginPath();
      for (var k = 0; k < P.ticksPerArm; k++) {
        var r = pr.rMax * (0.5 + 0.5 * k / P.ticksPerArm);
        var u = (r - pr.rBirth) / (pr.rEnd - pr.rBirth);
        var p1 = spiral(pr, a, u, spin), p2 = spiral(pr, a, u + 0.004, spin);
        var tx = p2.x - p1.x, ty = p2.y - p1.y, tl = Math.hypot(tx, ty) || 1;
        var len = k % 4 === 0 ? 7 : 4;
        ctx.moveTo(cx + p1.x - ty / tl * len, cy + p1.y + tx / tl * len);
        ctx.lineTo(cx + p1.x + ty / tl * len, cy + p1.y - tx / tl * len);
      }
      ctx.stroke();
    }
    // The dashed construction circle, turning with the system.
    ctx.setLineDash([2, 7]);
    ctx.lineDashOffset = -spin * pr.rMax * P.circFrac;
    ctx.beginPath();
    ctx.arc(cx, cy, pr.rMax * P.circFrac, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    if (reduced) return;
    // Comets: a small light running out along each arm now and then.
    for (var c = 0; c < pr.arms; c++) {
      var head = frac(now / 1000 / 5 + c * 0.37);
      if (head > 0.8) continue;
      for (var tail = 0; tail < 18; tail++) {
        var uu = head - tail * 0.004;
        if (uu < 0) break;
        var q = spiral(pr, c, uu, spin);
        ctx.fillStyle = col + ((1 - tail / 18) * 0.95 * (1 - head / 0.8)) + ')';
        ctx.beginPath();
        ctx.arc(cx + q.x, cy + q.y, 2.2 - tail * 0.1, 0, TAU);
        ctx.fill();
      }
    }
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    underlay(now);
    // Small ones first, the held and enlarged ones last, so they lie on top.
    var order = cards.slice().sort(function (a, b) { return (a === boosted) - (b === boosted) || (a === held) - (b === held) || a.s * a.boost - b.s * b.boost; });
    for (var i = 0; i < order.length; i++) {
      var c = order[i];
      c.rect = null;
      if (c.skip) continue;
      // Enlarged to be read: 40% of the stage wide (most of a phone's width), and at most 60% of it tall.
      var bmax = Math.max(1, Math.min(W * (pr.mobile ? 0.82 : 0.4) / (c.s * c.asp), H * 0.6 / c.s));
      var h = c.s * (1 + (c.boost - 1) / (P.boost - 1) * (bmax - 1)), w = h * c.asp;
      var x = c.x, y = c.y;
      if (c.boost > 1.01) {
        // An enlarged card keeps inside the stage.
        var bx = clamp(x, w / 2 + 12, W - w / 2 - 12), by = clamp(y, h / 2 + 12, H - h / 2 - 40);
        var bk = clamp((c.boost - 1) / (P.boost - 1), 0, 1);
        x += (bx - x) * bk; y += (by - y) * bk;
      }
      c.rect = { x: x - w / 2, y: y - h / 2, w: w, h: h, cx: x, cy: y };
      var rad = Math.min(P.corner, h * 0.18);
      ctx.save();
      ctx.globalAlpha = c.alpha;
      ctx.translate(x, y);
      if (c.lean) ctx.rotate(c.lean);
      roundRect(-w / 2, -h / 2, w, h, rad);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = ink.card;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      if (c.item.mask) {
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.7);
        g.addColorStop(0, TINTS[c.item.tint] + '55');
        g.addColorStop(1, TINTS[c.item.tint] + '00');
        ctx.fillStyle = g;
        ctx.fillRect(-w / 2, -h / 2, w, h);
      }
      if (c.item.ready) {
        if (c.blur > 0.01) picture(c.item.soft, c.item, -w / 2, -h / 2, w, h);
        if (c.blur < 0.99) { ctx.globalAlpha = c.alpha * (1 - c.blur); picture(c.item.img, c.item, -w / 2, -h / 2, w, h); }
      }
      ctx.restore();
      // The hairline frame, and a flash of split colour where a wave or ripple crosses.
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgb(' + ink.line + ' / ' + (c === held ? 0.9 : P.frameAlpha) + ')';
      ctx.stroke();
      if (c.flare > 0.03) {
        var off = 2.5 * c.flare;
        ctx.globalAlpha = c.alpha * c.flare * 0.8;
        if (ink.dark) ctx.globalCompositeOperation = 'lighter';
        ctx.lineWidth = 1.5;
        roundRect(-w / 2 + off, -h / 2, w, h, rad); ctx.strokeStyle = '#ff3d6e'; ctx.stroke();
        roundRect(-w / 2 - off, -h / 2, w, h, rad); ctx.strokeStyle = '#3dd8ff'; ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (c === held && c.focus) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgb(' + ink.line + ')';
        roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, rad + 3);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawn++;
    label();
  }

  // The verdict tag over the held card, and the caption under the enlarged one.
  var tagFor = null;
  var tagSize = [0, 0];
  var capFor = null;
  var capSize = [0, 0];
  function label() {
    var c = held && held.rect && !held.skip ? held : null;
    if (c !== tagFor) {
      tagFor = c;
      if (c) {
        var m = tagEl.querySelector('.m');
        m.className = 'm is-on m--' + c.item.tint;
        m.innerHTML = M ? M.svg(c.item.kind) : '';
        tagEl.querySelector('b').textContent = c.item.tag;
        host.style.setProperty('--core', TINTS[c.item.tint]);
      } else host.style.removeProperty('--core');
      tagEl.classList.toggle('is-on', Boolean(c));
      tagSize = [tagEl.offsetWidth, tagEl.offsetHeight];
    }
    if (c) {
      var tw = tagSize[0], th = tagSize[1];
      var tx = clamp(c.rect.x, 8, W - tw - 8), ty = clamp(c.rect.y - th - 8, 8, H - th - 8);
      tagEl.style.transform = 'translate3d(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px,0)';
    }
    var b = boosted && boosted.rect ? boosted : null;
    if (b) {
      if (capFor !== b.item) { capFor = b.item; capEl.textContent = b.item.caption; capSize = [capEl.offsetWidth, capEl.offsetHeight]; }
      var cw = capSize[0], ch = capSize[1];
      var cxp = clamp(b.rect.cx - cw / 2, 8, W - cw - 8), cyp = clamp(b.rect.y + b.rect.h + 10, 8, H - ch - 8);
      capEl.style.transform = 'translate3d(' + Math.round(cxp) + 'px,' + Math.round(cyp) + 'px,0)';
    }
    capEl.classList.toggle('is-on', Boolean(b) && b.boost > 1.5);
    if (!b && capFor) { capFor = null; capEl.textContent = ''; }
  }

  /* ------------------------------------------------------------- the loop */

  function running() { return seen && !document.hidden && !reduced; }

  function frame(now) {
    raf = 0;
    if (!running()) { last = 0; return; }
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    var gdt = last ? (now - last) / 1000 : 0;
    last = now;
    if (!started) started = now;
    if (now - started > 2500) gov.tick(gdt);
    if (pointer) hover();
    step(dt, now);
    draw(now);
    frames++;
    raf = requestAnimationFrame(frame);
  }
  function wake() { if (!raf && running()) raf = requestAnimationFrame(frame); }

  // Reduced motion: one still, arranged spiral, drawn again only when something changes.
  var stillQueued = false;
  function still() {
    if (!reduced || !seen || stillQueued) return;
    stillQueued = true;
    requestAnimationFrame(function () {
      stillQueued = false;
      if (!started) { started = performance.now(); clock = 0.37; spin = 0.6; cards.forEach(function (c) { c.t = clock; c.spin = spin; }); }
      // The sizes settle over a few passes (each card makes room for its neighbours as they are).
      for (var i = 0; i < 30; i++) step(0, started);
      draw(started);
    });
  }

  /* ---------------------------------------------------------- interaction */

  function at(x, y) {
    var order = cards.filter(function (c) { return c.rect && !c.skip && c.alpha > 0.3; })
      .sort(function (a, b) { return (b === boosted) - (a === boosted) || (b === held) - (a === held) || b.s * b.boost - a.s * a.boost; });
    for (var i = 0; i < order.length; i++) {
      var r = order[i].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return order[i];
    }
    return null;
  }
  function hold(c, focus) {
    if (held && held !== c) held.focus = false;
    if (boosted && boosted !== c) boosted = null;
    held = c;
    if (c) c.focus = Boolean(focus);
  }
  var touchHold = false;
  function hover() {
    if (touchHold || (held && held.focus)) return;
    var c = at(pointer.x, pointer.y);
    if (c !== held) hold(c, false);
  }

  // The pointer is followed over the whole window and measured against the stage, so whatever floats over the
  // stage (the chapter rail, the back-to-top button) does not hide it, and a scroll under a still pointer counts.
  var client = null;
  function locate() {
    var was = pointer;
    pointer = null;
    if (client) {
      var r = host.getBoundingClientRect();
      var x = client.x - r.left, y = client.y - r.top;
      if (x >= 0 && y >= 0 && x <= r.width && y <= r.height) pointer = { x: x, y: y };
    }
    if (was && !pointer && held && !held.focus && !touchHold) hold(null);
    if (reduced) { if (pointer) hover(); still(); }
  }
  addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    client = { x: e.clientX, y: e.clientY };
    touchHold = false;
    locate();
  }, { passive: true });
  addEventListener('scroll', function () { if (client) locate(); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', function () { client = null; locate(); });
  host.addEventListener('click', function (e) {
    var r = host.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.target.closest('.galaxy__list')) return;
    if (!reduced) ripples.push({ x: x, y: y, t0: performance.now() });
    var c = at(x, y);
    if (!c) { boosted = null; if (touchHold) { touchHold = false; hold(null); } still(); return; }
    // A tap holds the card until the next tap; a mouse holds it while over it.
    touchHold = !pointer;
    hold(c, false);
    boosted = boosted === c ? null : c;
    if (!boosted && touchHold) { touchHold = false; hold(null); }
    still();
  });

  // The list: tabbing to a scene holds its card (bringing it on screen if it is not), Enter enlarges it.
  function cardFor(item) {
    var n = reduced ? pr.n : gov.n;
    var c = cards.find(function (k) { return k.item === item && k.rank < n; });
    if (c) return c;
    // Not riding the arms now (a phone, or shed): it takes the place of the card most in view.
    c = cards.filter(function (k) { return k.rank < n; }).sort(function (a, b) { return Math.abs(a.u - 0.42) - Math.abs(b.u - 0.42); })[0];
    if (c) { c.item = item; load(item); }
    return c;
  }
  listEl.addEventListener('focusin', function (e) {
    var b = e.target.closest('button');
    if (!b || !pr) return;
    var c = cardFor(items[Number(b.dataset.i)]);
    if (c) hold(c, true);
    still();
  });
  listEl.addEventListener('focusout', function () {
    if (held && held.focus) { hold(null); boosted = null; }
    still();
  });
  listEl.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !held) return;
    boosted = boosted === held ? null : held;
    still();
  });
  host.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && boosted) { boosted = null; still(); }
  });

  /* ------------------------------------------------------------ lifecycle */

  build();
  readInk();
  if (window.ResizeObserver) new ResizeObserver(function () { build(); still(); }).observe(host);
  new MutationObserver(function () { readInk(); still(); }).observe(rootEl, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { readInk(); still(); });
  // The pictures are fetched once the chapter is near; drawing starts when it is on screen.
  var nearby = new IntersectionObserver(function (es) {
    if (!es.some(function (e) { return e.isIntersecting; })) return;
    nearby.disconnect();
    near = true;
    cards.forEach(function (c) { load(c.item); });
  }, { rootMargin: '600px 0px' });
  nearby.observe(host);
  new IntersectionObserver(function (es) {
    seen = es[es.length - 1].isIntersecting;
    rootEl.classList.toggle('galaxy-in-view', seen);
    if (reduced) still(); else wake();
  }, { threshold: 0 }).observe(host);
  document.addEventListener('visibilitychange', wake);

  // For the website checks (scripts/verify-web/19-galaxy.js): what the galaxy is doing, in the stage's pixels.
  // How far a point is from the nearest arm's curve as it is drawn now (for the checks: does the spiral read).
  function armDist(x, y) {
    var best = Infinity;
    for (var a = 0; a < pr.arms; a++) {
      for (var i = 0; i <= 400; i++) {
        var p = spiral(pr, a, i / 400, spin);
        var d = Math.hypot(W / 2 + p.x - x, H / 2 + p.y - y);
        if (d < best) best = d;
      }
    }
    return best;
  }
  root.SentinelGalaxy = {
    state: function () {
      var r = host.getBoundingClientRect();
      return {
        running: Boolean(raf) || running(), seen: seen, reduced: reduced, frames: frames, drawn: drawn, mobile: pr.mobile, arms: pr.arms, n: pr.n,
        active: reduced ? pr.n : gov.n, loaded: items.filter(function (i) { return i.ready; }).length, stage: { left: r.left, top: r.top, width: W, height: H },
        held: held ? held.k : null, boosted: boosted ? boosted.k : null, tag: tagEl.classList.contains('is-on') ? tagEl.textContent : '',
        caption: capEl.classList.contains('is-on') ? capEl.textContent : '',
        cards: cards.map(function (c) { return { k: c.k, scene: c.item.i, x: c.rect ? c.rect.cx : c.x, y: c.rect ? c.rect.cy : c.y, w: c.rect ? c.rect.w : 0, h: c.rect ? c.rect.h : 0, alpha: c.alpha, r: c.r, angle: Math.atan2(c.y - H / 2, c.x - W / 2), tag: c.item.tag,
          armDist: c.rect && c.alpha > 0.5 ? Math.round(armDist(c.rect.cx, c.rect.cy) * 10) / 10 : null }; })
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
