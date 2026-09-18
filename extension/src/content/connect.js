/**
 * Runs only on Sentinel's own /connect page. Receives the companion token the
 * signed-in page creates and passes it to the service worker.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  document.documentElement.dataset.sentinelCompanion = '1';

  addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const data = ev.data;
    if (!data || data.type !== 'sentinel:companion-token' || typeof data.token !== 'string' || data.token.length > 200) return;
    const reply = (res) => window.postMessage({
      type: 'sentinel:companion-connected',
      ok: Boolean(res && res.ok && res.account && res.account.signedIn),
      plan: res && res.account && res.account.plan ? res.account.plan.name : null
    }, location.origin);
    Promise.resolve(ext.runtime.sendMessage({ type: 'set-token', token: data.token })).then(reply, () => reply(null));
  });
})();
