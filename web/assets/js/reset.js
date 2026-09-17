/* Forgot-password and reset-password pages. */
(() => {
  'use strict';

  const { api, esc, $, $$, busy } = window.UI;
  const Masks = window.SentinelMasks;
  const page = document.body.dataset.page;
  const form = $('[data-form]');

  $$('[data-glyph]').forEach((el) => { el.innerHTML = Masks.svg(el.dataset.glyph); });

  const note = (html, ok) => {
    $('[data-note]').innerHTML = `<div class="banner${ok ? '' : ' banner--error'}" style="margin:22px 0 0"><div>${html}</div></div>`;
  };

  if (page === 'forgot') {
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', form), 'Sending', async () => {
        try {
          const res = await api('/auth/forgot', { method: 'POST', body: { email: form.email.value.trim() } });
          note(`<b>Check your inbox.</b> ${esc(res.message)}`, true);
          form.hidden = true;
        } catch (err) { note(esc(err.message)); }
      });
    });
    return;
  }

  // Keep the one-time token out of history, logs and referrers once it's read.
  const token = new URLSearchParams(location.search).get('token') || '';
  history.replaceState({}, '', '/reset');
  if (!token) {
    note('This page needs the link from your reset email. <a href="/forgot" style="color:var(--gold-300)">Request a new link</a>.');
    form.hidden = true;
    return;
  }

  const meter = $('[data-strength]');
  form.password.addEventListener('input', () => {
    const v = form.password.value;
    let s = 0;
    if (v.length >= 10) s++;
    if (/[a-z]/i.test(v) && /\d/.test(v)) s++;
    if (/[^a-z0-9]/i.test(v) || (/[A-Z]/.test(v) && /[a-z]/.test(v))) s++;
    if (v.length >= 14) s++;
    meter.dataset.score = v ? Math.max(1, s) : 0;
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await busy($('button', form), 'Saving', async () => {
      try {
        await api('/auth/reset', { method: 'POST', body: { token, password: form.password.value } });
        note('<b>Password updated.</b> Taking you to sign in…', true);
        form.hidden = true;
        setTimeout(() => location.replace('/login'), 1400);
      } catch (err) {
        note(`${esc(err.message)}${err.code === 'reset_invalid' ? ' <a href="/forgot" style="color:var(--gold-300)">Request a new link</a>.' : ''}`);
      }
    });
  });
})();
