/* Download page: real release details from GitHub, or an honest "not published yet"; the practice copy of the Windows
   warning; and the check that a downloaded file is the published one. */
(() => {
  'use strict';
  const button = document.querySelector('[data-installer]');
  const meta = document.querySelector('[data-installer-meta]');
  if (!button || !meta) return;

  /* ------------------------------------------------- the practice warning */

  const ss = document.querySelector('[data-ss]');
  const more = ss.querySelector('[data-ss-more]');
  const run = ss.querySelector('[data-ss-run]');
  const again = ss.querySelector('[data-ss-again]');
  const ring = ss.querySelector('.ss__ring');
  const say = document.querySelector('[data-ss-say]');
  const WORDS = {
    first: say.textContent,
    more: 'Now Run anyway appears. Windows calls the publisher unknown because the file is not signed. Press Run anyway.',
    done: 'That is the whole warning. The real one ends the same way.'
  };
  const AT = { first: more, more: run };
  const aim = () => {
    const to = AT[ss.dataset.state];
    if (!to) return;
    const box = ss.getBoundingClientRect();
    const at = to.getBoundingClientRect();
    const out = 5;
    ring.style.setProperty('--x', `${at.left - box.left - out}px`);
    ring.style.setProperty('--y', `${at.top - box.top - out}px`);
    ring.style.setProperty('--w', `${at.width + out * 2}px`);
    ring.style.setProperty('--h', `${at.height + out * 2}px`);
  };
  const go = (state, focus) => {
    ss.classList.add('is-live');
    ss.dataset.state = state;
    say.textContent = WORDS[state];
    aim();
    focus.focus({ preventScroll: true });
  };
  more.addEventListener('click', () => go('more', run));
  run.addEventListener('click', () => go('done', again));
  again.addEventListener('click', () => go('first', more));
  aim();
  new ResizeObserver(aim).observe(ss);

  /* ------------------------------------------- what this computer can run */

  if (!(/Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent))) {
    const web = document.querySelector('[data-webapp]');
    document.querySelector('[data-not-windows]').hidden = false;
    // The gold button is the next step. A file this device cannot run is not, while the web app is there to go to.
    if (!web.hasAttribute('aria-disabled')) { button.classList.remove('btn--gold'); web.classList.add('btn--gold'); }
  }

  /* --------------------------------------------- the check of a downloaded file */

  const check = document.querySelector('[data-check]');
  const file = check.querySelector('[data-check-file]');
  const pick = check.querySelector('[data-check-pick]');
  const verdict = check.querySelector('[data-check-result]');
  const print = check.querySelector('[data-check-print]');
  const printName = check.querySelector('[data-check-name]');
  const printHash = check.querySelector('[data-check-hash]');
  let published = null; // { version, size, sha256 } once GitHub has answered.

  const showHash = (name, hash) => { printName.textContent = name; printHash.textContent = hash; print.hidden = false; };
  const answer = (words, tone) => { verdict.textContent = words; verdict.className = `check__result${tone ? ` ${tone}` : ''}`; };
  const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const wrong = () => answer(`This is not the ${published.version} installer. It may be an older download, or a different file. Download it again with the button above. If it still does not match, do not run it.`, 'is-wrong');

  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    // A different size cannot match, so a wrong pick (a film, say) is never read into memory.
    if (published && chosen.size !== published.size) { wrong(); return; }
    pick.disabled = true;
    answer('Reading the file...');
    try {
      const hash = hex(await crypto.subtle.digest('SHA-256', await chosen.arrayBuffer()));
      if (!published) {
        showHash('This file:', hash);
        answer('GitHub could not be reached just now, so there is nothing to compare with here. Compare this fingerprint with SHA256SUMS.txt.');
      } else if (hash === published.sha256) {
        answer(`It matches. This is the exact file GitHub published for version ${published.version}.`, 'is-match');
      } else wrong();
    } catch {
      answer('That file could not be read here. Try again, or compare it with SHA256SUMS.txt.');
    }
    pick.disabled = false;
  });

  /* ---------------------------------------------------------- the release */

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

  fetch(`https://api.github.com/repos/${button.dataset.releases}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    // Only GitHub saying there is no release (404) means none; refused (403, rate-limited) or failing, the link stays.
    .then((r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(`GitHub answered ${r.status}`))))
    .then((release) => {
      const asset = release && (release.assets || []).find((a) => a.name === 'Sentinel-Setup.exe');
      if (asset) {
        const version = String(release.tag_name).replace(/^v/, '');
        meta.innerHTML = `<span>Version ${esc(version)}</span><span>${mb(asset.size)}</span><span>Windows 10 &amp; 11, 64-bit</span>`;
        const sha256 = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '');
        if (sha256) {
          published = { version, size: asset.size, sha256: sha256[1] };
          showHash(`Sentinel-Setup.exe ${version}:`, sha256[1]);
        }
        // The notes come with the site and the version with GitHub: between a tag and a publish they can differ.
        const note = document.querySelector('[data-release-note]');
        if (note && note.dataset.releaseNote !== version) {
          const newer = note.querySelector('[data-release-newer]');
          const link = document.createElement('a');
          link.href = `https://github.com/${button.dataset.releases}/blob/main/changelog/${encodeURIComponent(version)}.md`;
          link.textContent = `Read the notes for ${version}`;
          newer.append(`The download above is version ${version}. `, link, '.');
          newer.hidden = false;
        }
        return;
      }
      // No release yet: say so rather than hand out a link that 404s.
      button.removeAttribute('href');
      button.classList.add('is-soon');
      button.setAttribute('aria-disabled', 'true');
      button.lastChild.textContent = ' Windows build not published yet';
      meta.innerHTML = '<span>The first release is being prepared</span>';
      check.hidden = true;
    })
    .catch(() => { /* offline or rate-limited: the link still reaches the latest release */ });
})();
