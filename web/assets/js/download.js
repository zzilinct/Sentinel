/* Download page: real release details from GitHub, or an honest "not published yet". */
(() => {
  'use strict';
  const button = document.querySelector('[data-installer]');
  const meta = document.querySelector('[data-installer-meta]');
  if (!button || !meta) return;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

  fetch(`https://api.github.com/repos/${button.dataset.releases}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((release) => {
      const asset = release && (release.assets || []).find((a) => a.name === 'Sentinel-Setup.exe');
      if (asset) {
        meta.innerHTML = `<span>Version ${esc(String(release.tag_name).replace(/^v/, ''))}</span><span>${mb(asset.size)}</span><span>Windows 10 &amp; 11, 64-bit</span>`;
        return;
      }
      // No release yet: say so rather than hand out a link that 404s.
      button.removeAttribute('href');
      button.classList.add('is-soon');
      button.setAttribute('aria-disabled', 'true');
      button.lastChild.textContent = ' Windows build not published yet';
      meta.innerHTML = '<span>The first release is being prepared</span>';
    })
    .catch(() => { /* offline or rate-limited: the link still reaches the latest release */ });
})();
