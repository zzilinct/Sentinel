/* Hands a companion token to the Sentinel browser extension on this page only. */
(() => {
  'use strict';

  const { api, esc, $, $$ } = window.UI;
  const Masks = window.SentinelMasks;
  $$('[data-glyph]').forEach((el) => { el.innerHTML = Masks.svg(el.dataset.glyph); });

  const done = (title, body, ok) => {
    $('[data-title]').innerHTML = title;
    $('[data-body]').textContent = body;
    $('[data-actions]').hidden = !ok;
  };

  async function run() {
    try {
      await api('/auth/me');
    } catch (err) {
      if (err.status === 401) { location.replace('/login?next=/connect'); return; }
      done('Something went <span class="serif italic">wrong</span>', err.message, false);
      return;
    }

    // The companion's content script marks the page when it is installed.
    if (document.documentElement.dataset.sentinelCompanion !== '1') {
      done('Companion <span class="serif italic">not found</span>', 'Install the Sentinel browser companion from the Sentinel app, then open this page again.', false);
      $('[data-note]').innerHTML = '<div class="banner" style="margin-top:22px"><div><a href="/download" style="color:var(--gold-300)">Get the Sentinel app</a></div></div>';
      return;
    }

    let token;
    try {
      ({ token } = await api('/auth/client-token', { method: 'POST', body: { client: 'extension' } }));
    } catch (err) {
      done('Couldn’t <span class="serif italic">connect</span>', err.message, false);
      return;
    }

    const timer = setTimeout(() => done('Couldn’t <span class="serif italic">connect</span>', 'The companion didn’t respond. Reload this page to try again.', false), 5000);
    addEventListener('message', function onReply(ev) {
      if (ev.source !== window || ev.origin !== location.origin || !ev.data || ev.data.type !== 'sentinel:companion-connected') return;
      removeEventListener('message', onReply);
      clearTimeout(timer);
      if (ev.data.ok) done('You’re <span class="serif italic gold-text">protected</span>', `Sentinel is now live in this browser${ev.data.plan ? ` on your ${esc(ev.data.plan)} plan` : ''}.`, true);
      else done('Couldn’t <span class="serif italic">connect</span>', 'The companion rejected the sign-in. Reload this page to try again.', false);
    });
    window.postMessage({ type: 'sentinel:companion-token', token }, location.origin);
  }

  // Give the content script (document_idle) a moment to mark the page.
  setTimeout(run, 300);
})();
