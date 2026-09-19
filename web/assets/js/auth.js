/* Sign-in and sign-up. */
(() => {
  'use strict';

  const { api, esc, $, $$, busy } = window.UI;
  const Masks = window.SentinelMasks;
  const params = new URLSearchParams(location.search);
  const isSignup = location.pathname.startsWith('/signup');

  $$('[data-glyph]').forEach((el) => { el.innerHTML = Masks.svg(el.dataset.glyph); });
  $$('[data-keep-query]').forEach((a) => { a.href += location.search; });

  const next = () => {
    const n = params.get('next') || '';
    if (n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\')) return n;
    return params.get('plan') ? '/app/plan' : '/app';
  };

  const note = (slot, html, kind = 'error') => {
    $(slot).innerHTML = html ? `<div class="banner${kind === 'error' ? ' banner--error' : ''}" style="margin:22px 0 0"><div>${html}</div></div>` : '';
  };

  function clearErrors(form) {
    $$('[data-error]', form).forEach((e) => { e.textContent = ''; });
    $$('.input', form).forEach((i) => i.removeAttribute('aria-invalid'));
  }

  function showErrors(form, errors) {
    let first = null;
    for (const [field, message] of Object.entries(errors || {})) {
      const slot = $(`[data-error="${field}"]`, form);
      const input = form.elements[field];
      if (slot) slot.textContent = message;
      if (input) { input.setAttribute('aria-invalid', 'true'); first = first || input; }
    }
    if (first) first.focus();
    return Boolean(first);
  }

  // Already signed in? Go straight to the app.
  api('/auth/me').then(() => location.replace(next())).catch(() => {});

  /* ---------------------------------------------------------- google */

  const google = $('[data-google]');
  api('/auth/config').then((cfg) => {
    if (cfg.googleEnabled) {
      google.addEventListener('click', () => {
        const stay = !isSignup && form.elements.staySignedIn && form.elements.staySignedIn.checked;
        location.href = `/api/v1/auth/google/start?next=${encodeURIComponent(next())}${stay ? '&stay=1' : ''}`;
      });
    } else {
      google.disabled = true;
      google.title = 'Google sign-in is not configured on this server';
      google.insertAdjacentHTML('afterend', '<p class="field__hint" style="text-align:center;margin-top:8px">Google sign-in is not set up on this server yet. Use your email below.</p>');
    }
  }).catch(() => {});

  if (params.get('error')) note('[data-note]', `Google sign-in didn’t complete (${esc(params.get('error'))}). Try again or use your email.`);

  /* --------------------------------------------------------- password */

  const form = $('[data-form]');
  const pw = form.elements.password;

  if (!isSignup) {
    // Arriving from sign-up: the account exists, this is where it is used.
    if (!params.get('created') && params.get('email') && form.elements.email) form.elements.email.value = params.get('email');
    if (params.get('created')) {
      note('[data-note]', '<b>Account created.</b> Sign in to start using it.', 'ok');
      const email = params.get('email');
      if (email && form.elements.email) { form.elements.email.value = email; pw.focus(); }
    }
    // On your own computer the box starts ticked; in a browser it is a choice you make.
    const stay = form.elements.staySignedIn;
    try {
      const remembered = localStorage.getItem('sentinel:stay');
      stay.checked = remembered === null ? Boolean(window.sentinelDesktop) : remembered === '1';
    } catch { stay.checked = Boolean(window.sentinelDesktop); }
  }

  if (isSignup) {
    const meter = $('[data-strength]');
    pw.addEventListener('input', () => {
      const v = pw.value;
      let score = 0;
      if (v.length >= 10) score++;
      if (/[a-z]/i.test(v) && /\d/.test(v)) score++;
      if (/[^a-z0-9]/i.test(v) || /[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
      if (v.length >= 14) score++;
      meter.dataset.score = v ? Math.max(1, score) : 0;
    });
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    clearErrors(form);
    note('[data-note]', '');
    const data = Object.fromEntries(new FormData(form).entries());
    if (!isSignup) {
      data.next = next();
      // The server wants an explicit boolean, never "on".
      data.staySignedIn = form.elements.staySignedIn.checked;
      try { localStorage.setItem('sentinel:stay', data.staySignedIn ? '1' : '0'); } catch { /* private window */ }
    }
    if (isSignup) {
      // Unchecked boxes are absent from FormData; the server wants an explicit true or false.
      data.ageConfirmed = form.elements.ageConfirmed.checked;
      data.termsAccepted = form.elements.termsAccepted.checked;
    }

    await busy($('button[type=submit]', form), isSignup ? 'Creating account' : 'Signing in', async () => {
      try {
        const res = await api(isSignup ? '/auth/signup' : '/auth/login', { method: 'POST', body: data });
        if (res.twoFactorRequired) return showCodeStep(res.challenge);
        if (isSignup) {
          // The account is saved. Signing in is a separate, deliberate step.
          const q = new URLSearchParams({ created: '1', email: data.email || '' });
          const n = params.get('next');
          if (n) q.set('next', n);
          if (params.get('plan')) q.set('plan', params.get('plan'));
          location.replace(`/login?${q}`);
          return;
        }
        location.replace(next());
      } catch (err) {
        if (err.code === 'email_taken') {
          const q = new URLSearchParams({ email: data.email || '' });
          note('[data-note]', `That email is already registered. <a href="/login?${esc(q.toString())}" style="color:var(--gold-300)">Sign in instead</a>, or use <a href="/forgot" style="color:var(--gold-300)">Forgot password</a> if you cannot get in.`);
        } else if (!showErrors(form, err.errors)) note('[data-note]', esc(err.message));
      }
    });
  });

  /* ------------------------------------------------------------- 2FA */

  function showCodeStep(challenge) {
    $('[data-step="password"]').hidden = true;
    const step = $('[data-step="code"]');
    step.hidden = false;
    const codeForm = $('[data-code-form]');
    codeForm.elements.code.focus();
    codeForm.elements.code.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
      if (e.target.value.length === 6) codeForm.requestSubmit();
    });
    codeForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      note('[data-note-code]', '');
      await busy($('button', codeForm), 'Verifying', async () => {
        try {
          const res = await api('/auth/login/2fa', { method: 'POST', body: { challenge, code: codeForm.elements.code.value } });
          location.replace(res.next || next());
        } catch (err) {
          note('[data-note-code]', esc(err.message));
          codeForm.elements.code.select();
          if (err.code === 'challenge_expired') setTimeout(() => location.reload(), 1800);
        }
      });
    });
  }

  if (!isSignup && params.get('mfa')) showCodeStep(params.get('mfa'));
})();
