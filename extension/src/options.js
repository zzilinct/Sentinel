/* Sentinel Companion settings. */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  const DEFAULTS = {
    apiBase: 'https://www.usesentinel.technology',
    enabled: true,
    emailProtection: true,
    badgeStyle: 'mask',
    warnOnNavigate: true,
    notifications: true,
    minimumBadge: 'yellow'
  };
  const Masks = window.SentinelMasks;
  const saved = document.getElementById('saved');

  document.getElementById('legend').innerHTML = ['scam', 'virus', 'malware']
    .map((t) => `<div style="color:${Masks.COLORS.red}">${Masks.svg(t)}<span style="color:var(--text)">${Masks.NAMES[t]}</span></div>`).join('');

  Promise.resolve(ext.storage.sync.get(DEFAULTS)).then((stored) => {
    stored = stored || {};
    for (const key of Object.keys(DEFAULTS)) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = Boolean(stored[key]);
      else el.value = stored[key];
      el.addEventListener('change', () => {
        let value = el.type === 'checkbox' ? el.checked : el.value.trim();
        if (key === 'apiBase') {
          try {
            const u = new URL(value);
            if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('https required');
            value = u.origin;
          } catch {
            saved.style.color = 'var(--red)';
            saved.textContent = 'Server must be an https:// address';
            el.value = stored.apiBase;
            return;
          }
        }
        Promise.resolve(ext.storage.sync.set({ [key]: value })).then(() => {
          stored[key] = value;
          saved.style.color = 'var(--green)';
          saved.textContent = 'Saved';
          setTimeout(() => { saved.textContent = ''; }, 1400);
          Promise.resolve(ext.runtime.sendMessage({ type: 'refresh' })).catch(() => {});
        });
      });
    }
  });

  Promise.resolve(ext.runtime.sendMessage({ type: 'state' })).catch(() => null).then((state) => {
    const acc = document.getElementById('account');
    const out = document.getElementById('signout');
    if (!state || !state.ok || !state.account || !state.account.signedIn) {
      acc.textContent = 'Not signed in';
      out.hidden = true;
      return;
    }
    acc.textContent = `${state.account.user.email} · ${state.account.plan.name} plan`;
    out.onclick = () => Promise.resolve(ext.runtime.sendMessage({ type: 'sign-out' })).finally(() => location.reload());
  });
})();
