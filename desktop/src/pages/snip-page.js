(function () {
  'use strict';
  var M = window.SentinelMasks;
  var COLORS = { danger: '#e5484d', warn: '#f08a24', safe: '#4cb782', empty: 'var(--live)', info: '#8a857b', pending: 'var(--live)' };
  var $ = function (id) { return document.getElementById(id); };
  var box = $('box'), card = $('card');
  var start = null, rect = null;
  $('hintMask').innerHTML = M.svg('logo');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function close() { window.sentinelSnip.close(); }

  function draw(r) { box.style.cssText = 'left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px'; }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  $('done').addEventListener('click', close);
  $('sheet').addEventListener('pointerdown', function (e) {
    if (rect) { close(); return; }   // a click beside the verdict puts it away
    start = { x: e.clientX, y: e.clientY };
    document.body.classList.add('drawing');
    draw({ x: start.x, y: start.y, w: 0, h: 0 });
    $('sheet').setPointerCapture(e.pointerId);
  });
  $('sheet').addEventListener('pointermove', function (e) {
    if (!start || rect) return;
    draw({ x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) });
  });
  $('sheet').addEventListener('pointerup', function (e) {
    if (!start || rect) return;
    var r = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y) };
    start = null;
    if (r.w < 6 || r.h < 6) { document.body.classList.remove('drawing'); return; }   // a click, not a box
    rect = r;
    draw(r);
    document.body.classList.remove('drawing');
    document.body.classList.add('picked');
    show({ phase: 'reading' });
    window.sentinelSnip.pick(r);
  });

  // Beside the box: on its right if there is room, else on its left, else over its lower part.
  function place() {
    var W = window.innerWidth, H = window.innerHeight, w = card.offsetWidth, h = card.offsetHeight;
    var x = rect.x + rect.w + 14 + w <= W - 12 ? rect.x + rect.w + 14 : rect.x - w - 14 >= 12 ? rect.x - w - 14 : Math.max(12, Math.min(rect.x + rect.w - w, W - w - 12));
    var y = Math.max(12, Math.min(rect.y, H - h - 12));
    card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
  }

  function show(s) {
    if (!rect) return;
    var r = s.result;
    var level = s.error ? 'empty' : s.phase === 'reading' ? 'pending' : r.level;
    var opening = !card.classList.contains('is-on') || card.dataset.level !== level;
    card.style.setProperty('--c', COLORS[level] || COLORS.info);
    card.classList.toggle('reading', s.phase === 'reading');
    $('cardMask').innerHTML = M.svg(level === 'danger' || level === 'warn' ? 'scam' : 'logo');
    $('title').textContent = s.error ? 'This could not be read' : s.phase === 'reading' ? 'Reading...' : r.title;
    $('what').textContent = s.error ? s.error : s.phase === 'reading' ? 'Sentinel is reading it on this computer.' : r.detail;
    $('list').innerHTML = r ? r.findings.map(function (f) {
      return '<li style="--d:' + (COLORS[f.level] || COLORS.info) + '" data-level="' + esc(f.level) + '" data-kind="' + esc(f.kind) + '"><b>' + esc(f.title) + '</b><span>' + esc(f.detail) + '</span></li>';
    }).join('') : '';
    $('advice').textContent = (r && r.advice) || '';
    card.dataset.level = level;
    card.dataset.pending = r && r.pending ? '1' : '';
    // A new level opens the card again; more found at the same level only changes the words.
    if (opening) { card.classList.remove('is-on'); void card.offsetWidth; }
    card.classList.add('is-on');
    place();
    if (s.phase === 'done') $('done').focus();
  }
  window.sentinelSnip.onState(show);
})();
