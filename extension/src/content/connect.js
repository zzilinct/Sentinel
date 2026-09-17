/**
 * Runs only on Sentinel's own /connect page. Receives the companion token the
 * signed-in page creates and passes it to the service worker.
 */
(() => {
  'use strict';
  document.documentElement.dataset.sentinelCompanion = '1';

  addEventListener('message', (ev) => {
    if (ev.source !== window || ev.origin !== location.origin) return;
    const data = ev.data;
    if (!data || data.type !== 'sentinel:companion-token' || typeof data.token !== 'string' || data.token.length > 200) return;
    chrome.runtime.sendMessage({ type: 'set-token', token: data.token }, (res) => {
      void chrome.runtime.lastError;
      window.postMessage({
        type: 'sentinel:companion-connected',
        ok: Boolean(res && res.ok && res.account && res.account.signedIn),
        plan: res && res.account && res.account.plan ? res.account.plan.name : null
      }, location.origin);
    });
  });
})();
