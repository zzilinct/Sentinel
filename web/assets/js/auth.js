/* Sign-in and sign-up. */
(() => {
  'use strict';

  const { api, esc, $, $$, busy, formReady } = window.UI;
  const params = new URLSearchParams(location.search);
  const isSignup = location.pathname.startsWith('/signup');

  $$('[data-keep-query]').forEach((a) => { a.href += location.search; });

  const next = () => {
    const n = params.get('next') || '';
    // Same rule as the server's safeNext: a path on this site, with no tab, newline or backslash tricks.
    if (n.startsWith('/') && !/[\u0000-\u001f\u007f\\]/.test(n)) {
      try {
        const u = new URL(n, location.origin);
        if (u.origin === location.origin) return u.pathname + u.search + u.hash;
      } catch { /* not a path */ }
    }
    return params.get('plan') ? '/app/plan' : '/app';
  };

  // A note is read out as it appears: an error at once (alert), good news politely (status).
  const note = (slot, html, kind = 'error') => {
    $(slot).innerHTML = html ? `<div class="banner${kind === 'error' ? ' banner--error' : ''}" role="${kind === 'error' ? 'alert' : 'status'}"><div>${html}</div></div>` : '';
  };

  function clearErrors(form) {
    $$('[data-error]', form).forEach((e) => { e.textContent = ''; });
    $$('.input', form).forEach((i) => i.removeAttribute('aria-invalid'));
  }

  // Each field's error is tied to it, so a screen reader says it with the field.
  $$('[data-error]').forEach((slot) => {
    const input = slot.closest('form') && slot.closest('form').elements[slot.dataset.error];
    if (!input || !input.setAttribute) return;
    slot.id = `${slot.dataset.error}-error`;
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), slot.id].filter(Boolean).join(' '));
  });

  function showErrors(form, errors) {
    let first = null;
    for (const [field, message] of Object.entries(errors || {})) {
      const slot = $(`[data-error="${field}"]`, form);
      const input = form.elements[field];
      // An empty password on sign-up keeps only its hint (the length): the error line is for a password that was tried.
      if (slot) slot.textContent = isSignup && field === 'password' && input && !input.value ? '' : message;
      if (input) { input.setAttribute('aria-invalid', 'true'); first = first || input; }
    }
    // The cursor goes to the first field with a problem as the form reads, top to bottom.
    first = [...form.elements].find((e) => e.getAttribute && e.getAttribute('aria-invalid') === 'true') || first;
    if (first) first.focus();
    return Boolean(first);
  }

  /* ---------------------------------------------------------- google */

  // The server sends this button only when it has Google sign-in (server/lib/http.js).
  const google = $('[data-google]');
  if (google) {
    google.addEventListener('click', () => {
      const stay = !isSignup && form.elements.staySignedIn && form.elements.staySignedIn.checked;
      location.href = `/api/v1/auth/google/start?next=${encodeURIComponent(next())}${stay ? '&stay=1' : ''}`;
    });
  }

  // Shared from the phone's Share menu while signed out (app.js keeps it on this device): it is checked after this.
  if (next() === '/app/share' && !params.get('error')) note('[data-note]', `${isSignup ? 'Create your account' : 'Sign in'} and Sentinel checks what you shared. It waits on this device until then.`, 'ok');
  if (params.get('error')) note('[data-note]', `Google sign-in didn’t complete (${esc(params.get('error'))}). Try again or use your email.`);

  /* --------------------------------------------------------- password */

  const form = $('[data-form]');
  const pw = form.elements.password;

  if (!isSignup) {
    // Arriving from sign-up: the account exists, this is where it is used.
    // The address comes over in this tab's session storage, never in the web address, where it would end up in
    // history and server logs. Older links that still carry ?email= are read once and cleaned from the address bar.
    let email = '';
    try { email = sessionStorage.getItem('sentinel:email') || ''; sessionStorage.removeItem('sentinel:email'); } catch { /* private window */ }
    if (!email && params.get('email')) email = params.get('email');
    if (params.has('email')) { params.delete('email'); history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : '') + location.hash); }
    if (email && form.elements.email) form.elements.email.value = email;
    if (params.get('created')) {
      note('[data-note]', '<b>Account created.</b> Sign in to start using it.', 'ok');
      if (email) pw.focus();
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
      // Length is what makes a password hard to guess (the server asks for 15 characters, nothing else).
      meter.dataset.score = !v ? 0 : v.length < 15 ? 1 : v.length < 20 ? 2 : v.length < 25 ? 3 : 4;
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
          try { sessionStorage.setItem('sentinel:email', data.email || ''); } catch { /* private window */ }
          const q = new URLSearchParams({ created: '1' });
          const n = params.get('next');
          if (n) q.set('next', n);
          if (params.get('plan')) q.set('plan', params.get('plan'));
          location.replace(`/login?${q}`);
          return;
        }
        location.replace(next());
      } catch (err) {
        if (err.code === 'email_taken') {
          try { sessionStorage.setItem('sentinel:email', data.email || ''); } catch { /* private window */ }
          note('[data-note]', `That email is already registered. <a href="/login">Sign in instead</a>, or use <a href="/forgot">Forgot password</a> if you cannot get in.`);
        } else if (!showErrors(form, err.errors)) note('[data-note]', esc(err.message));
      }
    });
  });
  formReady(form);

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
