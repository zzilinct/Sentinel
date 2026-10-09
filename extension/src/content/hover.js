/**
 * Sentinel Companion - hover a link, anywhere.
 *
 * Rest the pointer on a link for about half a second and a small mask appears
 * beside it with what Sentinel knows about where it leads, before you click.
 * The address is read from the link itself, through the redirect wrappers
 * sites put around links (Google's /url?q=, Facebook's l.php, Outlook's safe
 * links). The worker answers from its cache and Sentinel's threat list first,
 * and asks the fast check only when live scanning is available, as it does for
 * search results. Nothing is added to the page: the mask is drawn in a closed
 * shadow root and never takes a click.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  if (window.__sentinelHover) return;
  window.__sentinelHover = true;

  const Masks = (globalThis.SentinelMasks || window.SentinelMasks);
  const DWELL_MS = 500;
  const RANK = { yellow: 1, orange: 2, red: 3 };
  const THREATS = ['scam', 'virus', 'malware'];
  const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v6c0 4.4 3 8 7 9 4-1 7-4.6 7-9V6Z"/><path d="m9 12 2.2 2.2L15 10.5"/></svg>';

  /* ------------------------------------------------------------- urls */

  // Where a link really leads: the address inside a site's redirect wrapper, or the link itself.
  function realUrl(href, base) {
    let u;
    try { u = new URL(href, base); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname;
    let inner = null;
    if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname === '/url') inner = u.searchParams.get('q') || u.searchParams.get('url');
    else if (/(^|\.)facebook\.com$/.test(host) && u.pathname === '/l.php') inner = u.searchParams.get('u');
    else if (/(^|\.)safelinks\.protection\.outlook\.com$/.test(host)) inner = u.searchParams.get('url');
    else if (/(^|\.)duckduckgo\.com$/.test(host) && u.pathname.startsWith('/l/')) inner = u.searchParams.get('uddg');
    if (inner) {
      try { const t = new URL(inner); if (/^https?:$/.test(t.protocol)) return t.href; } catch { /* keep the wrapper */ }
    }
    return u.href;
  }

  /* -------------------------------------------------------------- tip */

  let tip = null;
  function ensureTip() {
    if (tip) return tip;
    const host = document.createElement('div');
    host.setAttribute('data-sentinel-hover', '');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      :host{all:initial}
      .tip{position:fixed;display:flex;align-items:center;gap:8px;max-width:320px;padding:7px 11px 7px 8px;border-radius:10px;pointer-events:none;
        background:rgba(18,19,22,.94);color:#ecebe7;font:500 12.5px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
        box-shadow:0 10px 30px rgba(0,0,0,.35), inset 0 0 0 1px color-mix(in srgb, var(--c) 55%, transparent);
        opacity:0;transform:translateY(4px) scale(.96);transition:opacity .16s ease, transform .2s cubic-bezier(.2,1.4,.4,1)}
      .tip.on{opacity:1;transform:none}
      .tip svg{width:18px;height:18px;flex:none;color:var(--c)}
      .tip b{font-weight:650;color:var(--c)}
      .tip span{color:#9aa0a8;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      @media (prefers-reduced-motion: reduce){.tip{transition:none;transform:none}}
    </style><div class="tip" role="status" aria-live="polite"></div>`;
    document.documentElement.appendChild(host);
    tip = { host, el: root.querySelector('.tip') };
    return tip;
  }

  // Faded out, then emptied, so nothing of it is left in the page's text.
  function hide() {
    if (!tip) return;
    const { el } = tip;
    el.classList.remove('on');
    clearTimeout(tip.clear);
    tip.clear = setTimeout(() => { if (!el.classList.contains('on')) { el.textContent = ''; delete el.dataset.verdict; } }, 200);
  }

  function show(anchor, verdict) {
    if (!anchor.isConnected || anchor !== current) return;
    const shown = THREATS.filter((t) => verdict.threats[t] && verdict.threats[t].badge && RANK[verdict.threats[t].badge] >= RANK[settings.minimumBadge]);
    if (!shown.length && !settings.markSafe) return;
    const worst = shown.sort((a, b) => RANK[verdict.threats[b].badge] - RANK[verdict.threats[a].badge])[0];
    const badge = worst ? verdict.threats[worst].badge : null;
    const { el } = ensureTip();
    clearTimeout(tip.clear);
    el.style.setProperty('--c', badge ? Masks.COLORS[badge] : Masks.COLORS.clear);
    el.dataset.verdict = badge ? `${worst}:${badge}` : 'clear';
    const label = badge ? verdict.threats[worst].label : (verdict.knowledge && verdict.knowledge.trusted ? 'A verified site' : 'No warning signs found');
    el.innerHTML = `${badge ? Masks.svg(worst) : CHECK}<b></b><span></span>`;
    el.querySelector('b').textContent = label;
    el.querySelector('span').textContent = verdict.host || '';
    el.setAttribute('aria-label', `Sentinel: ${label}`);
    // Beside the end of the link's last line; above it when there is no room to the right or below.
    const rects = anchor.getClientRects();
    const r = rects.length ? rects[rects.length - 1] : anchor.getBoundingClientRect();
    el.style.left = '0px';
    el.style.top = '0px';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = r.right + 8 + w <= innerWidth ? r.right + 8 : Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.right + 8 + w <= innerWidth ? r.top + (r.height - h) / 2 : (r.bottom + 6 + h <= innerHeight ? r.bottom + 6 : r.top - h - 6);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(4, top))}px`;
    requestAnimationFrame(() => el.classList.add('on'));
  }

  /* ------------------------------------------------------------ hover */

  const DEFAULTS = { enabled: true, markSafe: true, minimumBadge: 'yellow' };
  let settings = DEFAULTS;
  const verdicts = new Map();     // url -> verdict, for this page
  let current = null;
  let timer = null;

  const inUse = () => document.visibilityState === 'visible' && document.hasFocus();

  function send(message) {
    return new Promise((resolve) => {
      try {
        Promise.resolve(ext.runtime.sendMessage(message)).then((res) => resolve(res || { ok: false }), () => resolve({ ok: false }));
      } catch { resolve({ ok: false }); }
    });
  }

  async function look(anchor) {
    // Search results already wear their marks (serp.js).
    if (window.__sentinelSerp || !inUse()) return;
    const url = realUrl(anchor.getAttribute('href'), location.href);
    if (!url) return;
    // A link within the site you are on: the page itself was checked when it opened.
    if (new URL(url).hostname === location.hostname) return;
    let verdict = verdicts.get(url);
    if (!verdict) {
      const res = await send({ type: 'hover-check', url });
      verdict = res && res.ok && res.verdict && res.verdict.ok ? res.verdict : null;
      if (!verdict) return;
      if (verdicts.size > 500) verdicts.clear();
      verdicts.set(url, verdict);
    }
    show(anchor, verdict);
  }

  function onOver(ev) {
    const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    if (a === current) return;
    clearTimeout(timer);
    hide();
    current = a;
    if (a) timer = setTimeout(() => look(a), DWELL_MS);
  }
  function onOut(ev) {
    if (!current || (ev.relatedTarget && current.contains(ev.relatedTarget))) return;
    clearTimeout(timer);
    hide();
    current = null;
  }
  function reset() { clearTimeout(timer); hide(); current = null; }
  const onKey = (ev) => { if (ev.key === 'Escape') reset(); };

  let on = false;
  function toggle(want) {
    if (want === on) return;
    on = want;
    const method = want ? 'addEventListener' : 'removeEventListener';
    document[method]('pointerover', onOver, true);
    document[method]('pointerout', onOut, true);
    document[method]('keydown', onKey, true);
    window[method]('scroll', reset, { capture: true, passive: true });
    if (!want) reset();
  }

  // Nothing at all is listened to on a page while the companion is off.
  Promise.resolve(ext.storage.sync.get(DEFAULTS)).then((stored) => {
    settings = { ...DEFAULTS, ...(stored || {}) };
    toggle(Boolean(settings.enabled));
  });
  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue;
    if (changes.enabled) toggle(Boolean(settings.enabled));
  });
})();
