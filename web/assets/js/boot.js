/* Runs before first paint: opt in to reveal animations only when JS is available. */
document.documentElement.classList.add('js');

/*
 * Light or dark. "Auto" (nothing stored) follows the system; a choice is remembered on this device. Applied here,
 * before the page is painted, so it never flashes the other theme. Any [data-theme-toggle] button cycles
 * Auto, Light, Dark and says which is on.
 */
(function () {
  const KEY = 'sentinel:theme';
  const order = ['auto', 'light', 'dark'];
  const read = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; } };
  const apply = (mode) => {
    if (mode === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = mode;
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      const label = `Theme: ${mode === 'auto' ? 'automatic' : mode}`;
      b.setAttribute('aria-label', `${label}. Change theme`);
      b.title = label;
      b.dataset.mode = mode;
      const text = b.querySelector('[data-theme-label]');
      if (text) text.textContent = mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark';
    }
  };
  apply(read());
  document.addEventListener('DOMContentLoaded', () => apply(read()));
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-theme-toggle]');
    if (!b) return;
    const next = order[(order.indexOf(read()) + 1) % order.length];
    try { if (next === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch { /* this page only */ }
    apply(next);
  });
})();
if (!('IntersectionObserver' in window)) document.documentElement.classList.add('no-io');

// Installable web app. Service workers need HTTPS (or localhost in development).
const secureContext = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
// A static export ships no service worker, and may live under a subpath.
if ('serviceWorker' in navigator && secureContext && !window.SENTINEL_STATIC) {
  addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
