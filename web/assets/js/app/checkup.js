/* Sentinel web app: Browser checkup (/app/checkup) and the recovery guide (/app/recover). app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { esc, $, $$, ago, toast, stateBlock, busy, status } = window.UI;
  const {
    Masks, desktop, state, ICON, desktopError, title, lockedCard
  } = window.SentinelApp;

  /* ====================================================== browser checkup */

  /* ====================================================== recovery guide */

  // The same guide as the website's /recover page (recover.js), inside the app, so the sidebar stays. What is ticked is
  // kept in this browser only, shared with that page.
  function recoverView(el) {
    el.innerHTML = `
      ${title('I think I&rsquo;ve been scammed', 'Take a breath. Tick what happened, and Sentinel puts what to do in order, most urgent first. Nothing you tick leaves this computer.')}
      <div class="recover" data-recover>
        <fieldset class="recover__what">
          <legend><h2>What happened?</h2><span>Tick everything that fits.</span></legend>
          <div class="recover__picks" data-recover-picks></div>
        </fieldset>
        <div class="recover__bar">
          <label class="recover__country"><span>Where you live</span><select data-recover-country></select></label>
          <div class="recover__actions">
            <button type="button" class="btn btn--gold btn--sm" data-recover-print>Print</button>
            <button type="button" class="btn btn--ghost btn--sm" data-recover-reset>Start over</button>
          </div>
        </div>
        <div class="recover__plan" data-recover-plan></div>
      </div>`;
    window.SentinelRecover.mount($('[data-recover]', el), location.search);
  }

  function checkupView(el) {
    const can = Boolean(desktop && desktop.browserCheckup);
    el.innerHTML = `${title('Browser checkup', 'The add-ons, notification permissions, search engine and startup pages of every browser on this computer, looked over for the ones scammers and unwanted software plant.')}
      ${can ? `<div class="panel">
        <div class="panel__head"><div><h2>What the checkup reads</h2><p>Sentinel reads each browser's settings on this computer and changes nothing. History, passwords and cookies are never opened, and sites are checked by their address without being opened.</p></div>
          <button class="btn btn--gold" data-run-checkup>Run checkup</button></div>
      </div>
      <div data-checkup-out aria-live="polite"></div>`
    : lockedCard({ tag: 'Unlocked by the Sentinel app', heading: 'Download Sentinel to check your browsers', body: 'The checkup reads your browsers\' settings on your computer, so it runs in the Sentinel app for Windows.', actions: `<a class="btn btn--gold" href="/download">${ICON.download}Download Sentinel</a>` })}`;
    if (!can) return;
    const out = $('[data-checkup-out]', el);
    const run = $('[data-run-checkup]', el);
    if (state.checkup) paintCheckup(out, state.checkup);
    run.addEventListener('click', () => busy(run, 'Checking', async () => {
      try {
        state.checkup = await desktop.browserCheckup();
        if (out.isConnected) paintCheckup(out, state.checkup);
      } catch (err) { toast(desktopError(err), 'error'); }
    }));
  }

  /** The checkup's findings, worst first in every list. Everything shown came from files any program can write, so all of it is escaped. */
  function paintCheckup(out, r) {
    const rank = { red: 3, orange: 2, yellow: 1 };
    const worse = (a, b) => ((rank[a] || 0) >= (rank[b] || 0) ? a : b);
    const siteBadge = (s) => (s && s.verdict ? s.verdict.badge : null);
    const copy = (addr) => `<button class="btn btn--sm" type="button" data-copy-text="${esc(addr)}">Copy ${esc(addr)}</button>`;
    const row = (icon, badge, name, detail, help = '') => `<li>
      <span class="list__icon" ${badge ? status(badge) : ''}>${icon}</span>
      <span class="list__main"><b>${esc(name)}</b><span>${esc(detail)}</span>${help ? `<span class="muted">${help}</span>` : ''}</span>
    </li>`;
    const siteRow = (where, s, plain) => row(siteBadge(s) ? Masks.svg('scam') : ICON.globe, siteBadge(s), where,
      !s.verdict ? (r.sitesChecked ? plain : `${plain}. Not checked: ${r.sitesWhy || 'Sentinel could not reach its scanner just now.'}`)
        : s.verdict.badge ? `${s.verdict.label}${s.verdict.reason ? `: ${s.verdict.reason}` : ''}` : `${plain}. No issues found.`);

    // How a flagged add-on is removed depends on how it got there: the Remove button alone does not undo a policy, a
    // shortcut that loads it, or a program that adds it back.
    const removal = (b, a, short) => {
      if (a.source === 'policy') {
        return `A policy on this computer installed it, so ${esc(short)} will not let you remove it. ${b.policies ? 'The policy is listed under "Policies on this computer" above.' : `${esc(short)} lists its policies at ${copy(b.places.policies)}`} Only this computer's administrator can remove a policy. If nobody set one up on purpose, ask someone you trust to help.`;
      }
      if (a.source === 'commandline') {
        return `The shortcut you open ${esc(short)} with loads it, so removing it in the browser does not last. Right-click that shortcut (on the taskbar, right-click the icon, then right-click ${esc(short)}), choose Properties, and in Target delete the part that begins with --load-extension. Do the same for each shortcut, then close ${esc(short)} and open it again.`;
      }
      if (a.source === 'unpacked') {
        return /^about:/.test(b.places.addons) ? `It is gone the next time ${esc(short)} starts.`
          : `Open ${copy(b.places.addons)} and turn on Developer mode. A Remove button then shows on it.`;
      }
      const at = `If you did not add it yourself, remove it at ${copy(b.places.addons)}`;
      return a.source === 'external' ? `${at} If it comes back, uninstall the program that added it, in Settings &gt; Apps.` : at;
    };

    let flagged = 0;
    const panels = r.browsers.map((b) => {
      const short = b.name.replace(/^(Google|Microsoft|Mozilla) /, '');
      const settings = /^about:/.test(b.places.search) ? null : b.places.search;
      const pol = b.policies;
      if (pol && pol.badge) flagged++;
      const profiles = b.profiles.map((p) => {
        const addons = [...p.addons].sort((x, y) => (rank[y.badge] || 0) - (rank[x.badge] || 0));
        // Flagged add-ons are listed; the clean ones fold away behind one line.
        const bad = addons.filter((a) => a.badge);
        const clean = addons.filter((a) => !a.badge);
        const addonRow = (a) => row(a.badge ? Masks.svg('malware') : ICON.check, a.badge, `${a.name}${a.enabled ? '' : ' (turned off)'}`,
          a.reasons.length ? a.reasons.map((x) => x.text).join(' ') : (a.notes[0] || (a.fromStore ? 'From the browser\'s add-on store.' : 'Nothing about it needs your attention.')),
          a.badge ? removal(b, a, short) : '');
        const sites = (p.notifications || []).slice().sort((x, y) => (rank[siteBadge(y)] || 0) - (rank[siteBadge(x)] || 0));
        const searchBadge = p.search ? worse(p.search.badge, siteBadge(p.search)) : null;
        flagged += bad.length + sites.filter(siteBadge).length + (searchBadge ? 1 : 0) + p.startup.filter(siteBadge).length;
        return `${b.profiles.length > 1 ? `<h3 class="u-mt">${esc(p.name)}</h3>` : ''}
          <h4 class="u-mt">Add-ons</h4>
          ${addons.length ? `${bad.length ? `<ul class="list">${bad.map(addonRow).join('')}</ul>` : ''}
            ${clean.length ? `<details class="group" data-clean-addons><summary><span>${clean.length}${bad.length ? ' more' : ''} add-on${clean.length === 1 ? '' : 's'}, nothing to look at</span><i></i></summary>
              <ul class="list">${clean.map(addonRow).join('')}</ul></details>` : ''}`
            : stateBlock('clear', 'No add-ons.', { small: true })}
          <h4 class="u-mt">Sites allowed to send notifications</h4>
          ${p.notifications === null ? stateBlock('unavailable', 'These could not be read.', { small: true })
            : sites.length ? `<ul class="list">${sites.map((s) => siteRow(s.origin.replace(/^https?:\/\//, ''), s, 'Can send you notifications')).join('')}</ul>
              <p class="muted u-mt-xs">Fake virus alerts and prize pop-ups arrive this way. To stop a site, remove it at ${copy(b.places.notifications)}</p>`
              : stateBlock('clear', 'No site may send notifications.', { small: true })}
          ${p.search ? `<h4 class="u-mt">Search engine</h4><ul class="list">${row(searchBadge ? Masks.svg('scam') : ICON.search, searchBadge, p.search.name || p.search.host || 'Custom',
            p.search.host && !p.search.known ? `${p.search.host} is not a search engine people know. Unwanted software changes your search to earn from what you look for.${p.search.verdict && p.search.verdict.badge ? ` ${p.search.verdict.label}.` : ''}` : `${p.search.engine || p.search.name || p.search.host || 'A search engine'} runs your searches.`,
            searchBadge ? `To choose your own, ${settings ? `open ${copy(settings)} and search its settings for "search engine"` : `go to ${copy(b.places.search)}`}` : '')}</ul>` : ''}
          ${p.startup.length ? `<h4 class="u-mt">Pages it opens on start</h4><ul class="list">${p.startup.map((s) => siteRow(s.url, s, 'Opens when the browser starts')).join('')}</ul>
            ${p.startup.some(siteBadge) ? `<p class="muted u-mt-xs">To change them, ${settings ? `open ${copy(settings)} and search its settings for "on startup"` : `go to ${copy(b.places.startup)}`}</p>` : ''}` : ''}`;
      }).join('');
      return `<div class="panel u-mt">
        <div class="panel__head"><div><h2>${esc(b.name)}</h2><p>${b.profiles.length} profile${b.profiles.length === 1 ? '' : 's'}</p></div>
          <button class="btn btn--sm" type="button" data-open-browser="${esc(b.open || b.id)}">Open ${esc(short)}</button></div>
        ${pol ? `<ul class="list">${row(pol.badge ? ICON.lock : ICON.shield, pol.badge, 'Policies on this computer', `${pol.text} Set: ${pol.names.slice(0, 8).join(', ')}${pol.names.length > 8 ? ', and more' : ''}.`,
          pol.badge ? `${short} lists them at ${copy(b.places.policies)} Removing them needs this computer's administrator; if nobody set them on purpose, ask someone you trust to help.` : '')}</ul>` : ''}
        ${profiles}
      </div>`;
    }).join('');

    const list = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0] || 'browser');
    const notChecked = (r.unchecked || []).length ? `<p class="muted">Not checked: ${esc(r.unchecked.join(', '))}. Sentinel cannot read ${r.unchecked.length === 1 ? 'its' : 'their'} settings yet.</p>` : '';
    out.innerHTML = r.browsers.length ? `<div class="panel u-mt">
        <h2>${flagged ? `${flagged} thing${flagged === 1 ? '' : 's'} to look at` : 'Nothing here needs your attention'}</h2>
        <p class="muted">Checked ${esc(ago(r.at))}. Sentinel changed nothing. Removing anything is your choice, in the browser, and you can add it back.${r.sitesChecked ? '' : ` Site addresses were not checked, so only add-ons, search engines and policies were judged. ${esc(r.sitesWhy || 'Sentinel could not reach its scanner just now.')}`}</p>
        ${notChecked}
      </div>${panels}`
      : `<div class="panel u-mt">${stateBlock('unavailable', `No ${esc(list(r.looked || []))} settings were found on this computer.`, { action: notChecked })}</div>`;

    $$('[data-copy-text]', out).forEach((btn) => btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(btn.dataset.copyText); toast('Copied. Paste it into the browser\'s address bar.', 'success'); }
      catch { toast('Could not copy. Type it into the browser\'s address bar instead.', 'error'); }
    }));
    $$('[data-open-browser]', out).forEach((btn) => btn.addEventListener('click', () => busy(btn, 'Opening', async () => {
      try { await desktop.openBrowser(btn.dataset.openBrowser); } catch (err) { toast(desktopError(err), 'error'); }
    })));
  }

  Object.assign(window.SentinelApp.pages, { checkupView, recoverView });
})();
