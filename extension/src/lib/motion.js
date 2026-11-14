/*
 * Motion in the companion's own pages (the popup, the settings, the blocked-page screen): the setting Full, Calm or
 * Off (`motion`, lib/store.js), set as <html data-motion> for their styles. The system asking for less motion is Off.
 * A change made on the settings page reaches every open page at once.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const root = document.documentElement;
  const sys = matchMedia('(prefers-reduced-motion: reduce)');
  let chosen = 'full';
  const apply = () => { root.dataset.motion = sys.matches ? 'off' : chosen === 'calm' || chosen === 'off' ? chosen : 'full'; };
  apply();
  sys.addEventListener('change', apply);
  const want = { motion: 'full' };
  SentinelStore.get(want).then((s) => { chosen = (s && s.motion) || 'full'; apply(); }, () => {});
  ext.storage.onChanged.addListener((changes, area) => { const got = SentinelStore.changed(changes, area, want); if (got) { chosen = got.motion; apply(); } });
})();
