/* Download page: show real installer details, or fall back gracefully if none is published. */
(() => {
  'use strict';
  fetch('/downloads/latest.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((info) => {
      const button = document.querySelector('[data-installer]');
      const meta = document.querySelector('[data-installer-meta]');
      if (!button || !meta) return;
      if (info && info.desktop) {
        button.href = info.desktop.download;
        meta.innerHTML = `<span>Version ${info.desktop.version}</span><span>${(info.desktop.size / 1048576).toFixed(0)} MB</span><span>Windows 10 &amp; 11, 64-bit</span>`;
      } else if (window.SENTINEL_STATIC) {
        // No server to send people to yet: say so rather than link nowhere.
        button.removeAttribute('href');
        button.removeAttribute('download');
        button.classList.add('is-soon');
        button.lastChild.textContent = ' Windows app coming at launch';
      } else {
        button.href = '/app';
        button.removeAttribute('download');
        button.lastChild.textContent = ' Windows app coming soon — open the web app';
      }
    })
    .catch(() => {});
})();
