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
    minimumBadge: 'yellow',
    markSafe: true,
    scanOverlay: true
  };
  const Masks = window.SentinelMasks;
  const saved = document.getElementById('saved');

  document.getElementById('legend').innerHTML = ['scam', 'virus', 'malware']
    .map((t) => `<div><span style="color:var(--red)">${Masks.svg(t)}</span>${Masks.NAMES[t]}</div>`).join('');

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

  /* Password alarm: the worker keeps the hashes; this page only ever sees names and switches. */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pwSend = (msg) => Promise.resolve(ext.runtime.sendMessage(msg)).catch(() => null);
  const status = (a) => (!a || !a.on ? 'Off' : a.learned ? 'Protected' : 'Sign in once on its own site to finish');
  function allowedRow(a) {
    if (!a || !a.allowed.length) return '';
    return `<div class="pw-allowed">${a.allowed.map((h) => `<button class="btn" type="button" data-unallow="${esc(a.id)}" data-host="${esc(h)}" title="Protect this site again">Allowed on ${esc(h)} &times;</button>`).join('')}</div>`;
  }
  function paintPw(data) {
    if (!data || !data.ok) return;
    const byId = new Map(data.accounts.map((a) => [a.id, a]));
    document.getElementById('pwPresets').innerHTML = data.presets.map((p) => {
      const a = byId.get(p.id);
      return `<label class="opt"><span><b>${esc(p.name)}</b><small>${esc(status(a))}</small>${allowedRow(a)}</span><input type="checkbox" data-pw="${esc(p.id)}" ${a && a.on ? 'checked' : ''}></label>`;
    }).join('');
    document.getElementById('pwBanks').innerHTML = data.accounts.filter((a) => a.bank).map((a) => `
      <div class="opt"><span><b>${esc(a.name)}</b><small>${esc(status(a))}</small>${allowedRow(a)}</span><span class="pw-actions"><button class="btn" type="button" data-forget="${esc(a.id)}">Remove</button></span></div>`).join('');
  }
  const pwSaved = (res) => {
    if (res && res.ok) { saved.style.color = 'var(--green)'; saved.textContent = 'Saved'; paintPw(res); }
    else { saved.style.color = 'var(--red)'; saved.textContent = (res && res.error) || 'Could not save'; }
    setTimeout(() => { saved.textContent = ''; }, 2400);
  };
  const pw = document.getElementById('pw');
  pw.addEventListener('change', (ev) => {
    const id = ev.target.dataset && ev.target.dataset.pw;
    // Switching an account off forgets its password's hash too: nothing is kept for an account that is not protected.
    if (id) pwSend(ev.target.checked ? { type: 'pw-set', id, on: true } : { type: 'pw-forget', id }).then(pwSaved);
  });
  pw.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.forget) pwSend({ type: 'pw-forget', id: b.dataset.forget }).then(pwSaved);
    if (b.dataset.unallow) { ev.preventDefault(); pwSend({ type: 'pw-unallow', id: b.dataset.unallow, host: b.dataset.host }).then(pwSaved); }
  });
  document.getElementById('pwBankForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const input = document.getElementById('pwBank');
    pwSend({ type: 'pw-bank', domain: input.value }).then((res) => { if (res && res.ok) input.value = ''; pwSaved(res); });
  });
  pwSend({ type: 'pw-list' }).then(paintPw);

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
