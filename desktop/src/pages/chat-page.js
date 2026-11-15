(function () {
  'use strict';
  var M = window.SentinelMasks;
  var COLORS = { warn: '#f08a24', danger: '#e5484d' };
  var badge = document.getElementById('badge');
  var cards = document.getElementById('cards');
  var live = new Map();   // the cards showing, by what they say
  document.getElementById('badgeMask').innerHTML = M.svg('logo');
  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  window.sentinelChat.onState(function (s) {
    document.body.className = (s.app || '') + (s.inGame ? ' in-game' : '');
    badge.classList.toggle('is-on', Boolean(s.indicator));
    // Never claims to watch what it cannot read.
    document.getElementById('badgeText').textContent = s.app === 'phonelink'
      ? (s.reading === false ? 'Sentinel cannot read these texts yet' : 'Sentinel is checking these texts')
      : (s.reading === false ? 'Sentinel cannot read this chat yet' : 'Sentinel is watching this chat');
    var W = window.innerWidth, H = window.innerHeight;
    var taken = [];
    var next = new Map();
    (s.flags || []).forEach(function (f) {
      var r = f.rect || { x: 20, y: 20, w: 0, h: 0 };
      var w = s.app === 'roblox' && s.inGame ? 250 : 300;
      var x, y;
      if (s.app === 'roblox' && s.area) {
        // Beside the chat box, level with the message, never over the middle of the screen.
        x = Math.min(s.area.x + s.area.w + 10, W - w - 10);
        y = r.y;
      } else if (s.app === 'phonelink') {
        // Phone Link: just right of the text bubble, which sits on the left; on its left edge if there is no room.
        x = r.x + r.w + 12 + w <= W - 10 ? r.x + r.w + 12 : Math.max(10, W - w - 10);
        y = r.y;
      } else {
        // Discord: on the right of the message, where a message's own line is usually empty.
        x = Math.max(10, Math.min(r.x + r.w - w - 16, W - w - 10));
        y = r.y;
      }
      // A card already showing stays the same element and only moves: it opens once, not again at every read.
      var key = [f.level, f.family, f.title, f.detail].join('|');
      while (next.has(key)) key += '+';
      var el = live.get(key);
      if (!el) {
        el = document.createElement('div');
        el.className = 'card';
        el.innerHTML = '<i class="card__bg"></i><span class="card__tile">' + M.svg(f.family === 'scam' ? 'scam' : 'malware') + '</span><div class="card__body"><b>' + esc(f.title)
          + '</b><div class="what">' + esc(f.detail) + '</div><div class="do">' + esc(f.advice) + '</div></div>';
        cards.appendChild(el);
      }
      // Cards do not cover each other: each goes below any card it would overlap, by its real height (a long piece of
      // advice made a card taller than the 74 px once assumed, and the next card hid its words).
      var h = el.offsetHeight;
      taken.forEach(function (t) { if (y < t.y + t.h + 8 && y + h + 8 > t.y) y = t.y + t.h + 8; });
      y = Math.max(8, Math.min(y, H - h - 8));
      taken.push({ y: y, h: h });
      el.style.cssText = '--c:' + (COLORS[f.level] || COLORS.warn) + ';left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px';
      next.set(key, el);
    });
    live.forEach(function (el, key) { if (!next.has(key)) el.remove(); });
    live = next;
  });
})();
