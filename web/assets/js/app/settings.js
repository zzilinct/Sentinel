/* Sentinel web app: Live protection (/app/protection) and Settings (/app/settings), with the Overview's offers. The first-run choices and the frame every row is drawn in are app/first.js, loaded before this file. app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { api, esc, $, $$, h, ago, until, bytes, toast, stateBlock, busy, status } = window.UI;
  const {
    Masks, desktop, still, glide, state, ICON, plan, usage, left, uncapped, hours, paintAccount, signOut,
    desktopError, failed, LATE, skel, keep, simpleView, title, lockedCard, localNote, updateText
  } = window.SentinelApp;
  const { appWhy, liveOf, onWindows, levelRow, seg, ROW, rowHTML, paintRow } = window.SentinelApp.first;

  /* ===================================================== live protection */

  async function protectionView(el) {
    const f = plan().features;
    const us = usage();
    const planLocked = !f.liveScanning && !f.liveFast;

    const feature = (icon, name, body, status) => `<div class="feature">
      <div class="feature__top"><span class="feature__icon">${icon}</span>${status}</div>
      <h3>${name}</h3><p>${body}</p></div>`;
    const st = (on, lockedText) => (on ? '<span class="status is-on">On</span>' : `<span class="status is-locked">${lockedText}</span>`);

    const needsApp = !desktop;
    const lock = planLocked ? 'Pro & up' : needsApp ? 'Needs app' : null;
    // "On" only for what is running now: page warnings and search marks are live scanning's.
    const liveOn = Boolean(state.desktopInfo && state.desktopInfo.live && state.desktopInfo.live.enabled);

    el.innerHTML = `
      ${title('Live protection', 'Sentinel watching in real time: on search results, in your inbox and on every download.')}
      ${localNote()}
      ${planLocked ? lockedCard({ tag: 'Not in this plan', heading: 'Turn on live protection', body: 'Live scanning is not part of this plan.', actions: '<a class="btn btn--gold" href="/app/plan">See plans</a>' })
        : needsApp ? lockedCard({ tag: 'Unlocked by the Sentinel app', heading: 'Download Sentinel to switch these on', body: 'Your plan includes live protection. It runs through the Sentinel app on your computer, so it can watch downloads and draw its masks over your browser.', actions: `<a class="btn btn--gold" href="/download">${ICON.download}Download Sentinel</a>` })
        : ''}

      <div class="feature-grid">
        ${feature(Masks.svg('scam'), 'Page warnings', 'While a browser is in front, Sentinel checks the address of the page it shows and warns you before a dangerous one gets your details. No add-on.', st(!lock && liveOn, lock || 'Off'))}
        ${feature(ICON.search, 'Search result masks', `A line of light crosses the page when you search, then a mask appears beside every result. Google, Bing, DuckDuckGo, Brave, Yahoo, Ecosia and more.${f.liveResearch ? ' Every result is researched.' : ''}`, st(!lock && liveOn, lock || 'Off'))}
        ${feature(ICON.mail, 'Email masks', 'Gmail and Outlook on the web: the messages in your inbox list get a green mask or a warning mask before you open them. Sentinel reads only what the list shows (sender, subject, first line) and never opens a message.', f.emailLive && !planLocked ? '<span class="status">Optional add-on</span>' : st(false, 'Pro & up'))}
        ${feature(ICON.download, 'Download protection', 'Every new file in your Downloads folder is inspected on your computer.', st(!lock && desktop && state.desktopInfo && state.desktopInfo.downloads.active, lock || 'Off'))}
      </div>

      ${!planLocked ? `<div class="panel u-mt">
        <div class="panel__head"><div><h2>Live scanning this week</h2><p>Minutes only count when Sentinel actually checks something. Resets ${until(state.me.week.resetsAt)}.</p></div></div>
        <div class="meters">
          ${liveMeter('Fast', 'Answers in about a second. Threat lists, the checklist and comparison with known scams.', us.fastMinutes)}
          ${liveMeter('Delicate', 'Answers in about five seconds. Everything fast does, plus research on every result.', us.liveMinutes)}
        </div>
      </div>` : ''}

      <div data-desktop>${desktop && !planLocked ? `<div class="skeleton desktop-skeleton">${LATE}</div>` : ''}</div>
      <div class="panel u-mt" data-intel>
        <div class="panel__head"><div><h2>Threat intelligence</h2><p>The public feeds every scan is checked against, refreshed automatically.</p></div></div>
        <div class="skeleton u-h-sm">${LATE}</div>
      </div>
      <p class="set-away u-mt"><a href="/app/settings#protection">Change what Sentinel watches in Settings</a></p>`;

    if (desktop && !planLocked) renderDesktopControls($('[data-desktop]', el));
    renderIntel($('[data-intel]', el));
  }

  /** One weekly allowance: used of limit, or "no weekly limit", or "not in this plan". */
  function liveMeter(name, what, m) {
    const none = !m || m.limit === 0;
    const free = m && uncapped(m.limit);
    const limit = none ? '' : free ? 'no weekly limit' : m.limit >= 60 ? `${m.limit / 60} h` : `${m.limit} min`;
    const used = none ? '' : m.limit !== null && m.limit < 60 ? `${m.used} min` : `${hours(m.used)} h`;
    return `<div class="meters__item${none ? ' is-off' : ''}">
      <div class="meters__head"><b>${name}</b><span class="mono tabular">${none ? 'Pro and up' : `${used} <span class="muted">/ ${limit}</span>`}</span></div>
      <div class="meter${free ? ' is-uncapped' : ''}"><i style="width:${none ? 0 : free ? 100 : Math.min(100, (m.used / m.limit) * 100)}%"></i></div>
      <p>${what}</p></div>`;
  }

  async function renderIntel(slot) {
    try {
      const s = await api('/threat-stats');
      const names = { openphish: 'OpenPhish', urlhaus: 'URLhaus', phishing_database: 'Phishing.Database' };
      $('.skeleton', slot).outerHTML = `<div class="intel">
        <div class="intel__total"><b class="tabular">${s.trackedThreats.toLocaleString()}</b><span>known threats tracked &middot; ${s.checks} checks per scan</span></div>
        <ul class="list">${s.feeds.map((f) => `<li>
          <span class="status ${f.ok ? 'is-on' : ''}"></span>
          <span class="list__main"><b>${esc(names[f.source] || f.source)}</b><span>${f.entries.toLocaleString()} entries &middot; ${f.fetchedAt ? `updated ${ago(f.fetchedAt)}` : 'not fetched yet'}</span></span>
        </li>`).join('')}</ul>
      </div>`;
    } catch (err) {
      const wait = $('.skeleton', slot);
      const box = document.createElement('div');
      wait.replaceWith(box);
      failed(box, err, () => { box.outerHTML = `<div class="skeleton u-h-sm">${LATE}</div>`; renderIntel(slot); }, { small: true, what: 'The status of the threat lists' });
    }
  }

  /**
   * Parent lock: a PIN before protection can be switched off or Sentinel quit. The PIN is checked by the app on this
   * computer (desktop/src/parentlock.js); only a salted hash of it is kept. Drawn into its own slot, since it changes
   * on its own (it locks again five minutes after the PIN opens it).
   */
  async function renderParentLock(slot) {
    if (!slot || !desktop || !desktop.lockStatus) return;
    let s;
    try { s = await desktop.lockStatus(); } catch { slot.innerHTML = '<p class="set-why">The Sentinel app did not answer. Open this page again.</p>'; return; }
    if (!slot.isConnected) return;
    if (!s.supported) { slot.innerHTML = '<p class="set-why">Needs Windows.</p>'; return; }
    clearTimeout(slot._relock);
    const pinInput = (name, label, auto) => `<div class="field"><label for="pl-${name}">${label}</label><input class="input code-input" id="pl-${name}" name="${name}" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="${auto}" required></div>`;
    // Sentinel is installed for one Windows account, and that account can uninstall it, administrator or not.
    const adminNote = `<p class="field__hint">The lock stops protection being switched off inside Sentinel. Whoever uses this Windows account can still uninstall Sentinel from Windows Settings${s.admin ? ', and this account is an administrator, so it can change anything on the computer' : ''}. If Sentinel stops without the PIN, the record says when.</p>`;
    const newPin = (button) => `<form data-pl-set class="u-mt-sm">${pinInput('pin', 'New PIN, 4 to 8 digits', 'new-password')}${pinInput('again', 'The same PIN again', 'new-password')}<button class="btn btn--gold u-mt-sm" type="submit">${button}</button></form>`;
    const when = (at) => new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', month: 'short', day: 'numeric' });
    const record = s.record || [];
    const recordList = `<h3 class="u-mt">Record</h3>
        <p class="field__hint">Times and switches only. Nothing about a chat or a page is ever written here.</p>
        ${record.length ? `<ul class="list">${record.slice(0, 10).map((r) => `<li><span class="list__icon">${ICON.shield}</span><span class="list__main"><b>${esc(r.text)}${r.times > 1 ? ` (${r.times} times)` : ''}</b><span>${esc(when(r.at))}</span></span></li>`).join('')}</ul>` : stateBlock('waiting', 'Nothing yet.', { small: true })}`;
    const minutes = (n) => (n >= 60 ? `${Math.ceil(n / 60)} minute${Math.ceil(n / 60) === 1 ? '' : 's'}` : `${n} second${n === 1 ? '' : 's'}`);
    let body;
    if (!s.set) {
      // With no PIN the record stays readable: a PIN removed with an administrator's approval is written there.
      body = `<p class="muted u-mt-sm">Off.</p>${newPin('Lock with this PIN')}${adminNote}${record.length ? recordList : ''}`;
    } else if (s.locked) {
      const wait = s.waitSeconds > 0;
      body = `<p class="muted u-mt-sm">On. Switching protection off, or quitting Sentinel, needs the PIN.${wait ? ` Too many wrong PINs: try again in <span data-pl-wait>${minutes(s.waitSeconds)}</span>.` : ''}</p>
        <form data-pl-unlock class="u-mt-sm">${pinInput('pin', 'PIN', 'current-password')}<button class="btn u-mt-sm" type="submit" ${wait ? 'disabled' : ''}>Unlock for 5 minutes</button></form>
        <p class="field__hint">Forgot the PIN? <button class="btn btn--ghost btn--sm" type="button" data-pl-reset>Remove it with a Windows administrator</button></p>${adminNote}`;
      // The wait counts down, and the button comes back by itself when it ends.
      if (wait) {
        const ends = Date.now() + s.waitSeconds * 1000;
        const tick = () => {
          if (!slot.isConnected) return;
          const left = Math.ceil((ends - Date.now()) / 1000);
          if (left <= 0) { renderParentLock(slot); return; }
          const el = $('[data-pl-wait]', slot);
          if (el) el.textContent = minutes(left);
          slot._relock = setTimeout(tick, 1000);
        };
        slot._relock = setTimeout(tick, 1000);
      }
    } else {
      body = `<p class="muted u-mt-sm">Open until ${esc(new Date(s.unlockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}, then it locks again by itself. Change what you need now, in this page or in the tray menu.</p>
        <div class="actions__btns u-mt-sm"><button class="btn btn--gold btn--sm" type="button" data-pl-relock>Lock now</button><button class="btn btn--sm" type="button" data-pl-remove>Turn off parent lock</button></div>
        ${newPin('Change the PIN')}
        ${recordList}`;
      slot._relock = setTimeout(() => { if (slot.isConnected) renderParentLock(slot); }, Math.max(1000, s.unlockedUntil - Date.now() + 1000));
    }
    slot.innerHTML = body;

    const act = (el, fn, done) => el && el.addEventListener(el.tagName === 'FORM' ? 'submit' : 'click', async (ev) => {
      ev.preventDefault();
      const btn = el.tagName === 'FORM' ? $('button[type=submit]', el) : el;
      btn.disabled = true;
      try { await fn(); if (done) toast(done, 'success'); } catch (err) { toast(desktopError(err), 'error'); }
      renderParentLock(slot);
    });
    act($('[data-pl-set]', slot), async () => {
      const f = $('[data-pl-set]', slot);
      if (f.pin.value !== f.again.value) throw new Error('The two PINs are not the same.');
      await desktop.lockSet(f.pin.value);
    }, s.set ? 'The PIN is changed.' : 'Parent lock is on. Keep the PIN somewhere a child will not find it.');
    act($('[data-pl-unlock]', slot), () => desktop.lockUnlock($('[data-pl-unlock]', slot).pin.value), 'Unlocked for 5 minutes.');
    act($('[data-pl-relock]', slot), () => desktop.lockRelock(), 'Locked.');
    act($('[data-pl-remove]', slot), () => desktop.lockRemove(), 'Parent lock is off.');
    act($('[data-pl-reset]', slot), () => desktop.lockReset(), 'The PIN was removed. Set a new one to lock again.');
    // Opened from a refused tray click: straight to the PIN (Settings scrolls the row into view).
    if (location.hash === '#parent-lock' && !slot._scrolled) { slot._scrolled = true; const pin = $('input', slot); if (pin) pin.focus({ preventScroll: true }); }
  }
  // The switch says on either way: when the reader is not running, that is the first thing said.
  function readerDown(status, what) {
    if (status.reader === 'restarting') return `Paused for a moment and starting again. For now ${what} not being watched.`;
    if (status.reader === 'stopped') return `Sentinel cannot read chat on this computer right now, so ${what} not being watched. It keeps trying by itself.`;
    return '';
  }
  // What chat safety is doing right now, in numbers only: proof that it works, without a word of anyone's chat.
  function chatSeenText(cs) {
    if (!cs.enabled) return 'Off. Turn it on, then open Roblox or the Discord app.';
    const down = readerDown(cs, 'Roblox and Discord are');
    if (down) return down;
    const s = cs.seen || {};
    const name = { discord: 'Discord', roblox: 'Roblox' }[s.app];
    const now = s.blind ? `${name} is in front, but Windows shows Sentinel only a black picture of it, so Sentinel cannot see its chat. Playing in a window may help.` : name ? (s.reading ? `Watching ${name} now.` : `${name} is in front, but its chat cannot be read yet.`) : 'On. It starts watching when Roblox or the Discord app is in front.';
    const d = (s.discord && s.discord.checked) || 0, r = (s.roblox && s.roblox.checked) || 0;
    const f = ((s.discord && s.discord.flagged) || 0) + ((s.roblox && s.roblox.flagged) || 0);
    if (!d && !r) return now;
    return `${now} Since Sentinel started: ${d} message${d === 1 ? '' : 's'} checked in Discord, ${r} in Roblox, ${f} flagged.`;
  }
  // What Check my texts is doing right now, in numbers only.
  function textSeenText(ts) {
    if (!ts.enabled) return 'Off. Turn it on, then open a conversation in Phone Link.';
    const down = readerDown(ts, 'texts in Phone Link are');
    if (down) return down;
    const s = ts.seen || {};
    const now = s.blind ? 'Phone Link is in front, but Windows shows Sentinel only a black picture of it, so Sentinel cannot see its texts.' : s.app === 'phonelink' ? (s.reading ? 'Checking Phone Link now.' : s.otherTab ? 'Phone Link is in front. Texts are checked on its Messages tab.' : 'Phone Link is in front, but its texts cannot be read yet.') : 'On. It starts checking when Phone Link is in front.';
    const n = s.checked || 0, f = s.flagged || 0;
    const u = s.unchecked || 0;
    const missed = u ? ` ${u} link${u === 1 ? '' : 's'} in texts could not be checked against the threat lists: ${String(s.why || "Sentinel's scanner could not be reached").replace(/\.$/, '')}. The words were still checked.` : '';
    if (!n) return now + missed;
    return `${now} Since Sentinel started: ${n} text${n === 1 ? '' : 's'} checked, ${f} flagged.${missed}`;
  }
  const CHAT_ON = 'Chat safety is on. Open Roblox or Discord and Sentinel watches their chat.';
  const EXPOSURE_ON = 'Exposure alerts are on. Sentinel will tell you if a site you visit is listed later.';

  /*
   * "New in Sentinel" cards: asked once, in the Windows app, before a feature ever reads anything. What it does, then
   * Turn on or Not now. The answer (or switching the feature in Settings) is kept in local storage as
   * sentinel:asked:<name>, never sent anywhere. Before 1.12.1 the keys were sentinel.chatAsked and
   * sentinel.exposureAsked; they are moved over once.
   */
  const ASKED = { chat: ['sentinel:asked:chat', 'sentinel.chatAsked'], exposure: ['sentinel:asked:exposure', 'sentinel.exposureAsked'] };
  function asked(name) {
    const [key, old] = ASKED[name];
    try {
      if (localStorage.getItem(old)) { localStorage.setItem(key, '1'); localStorage.removeItem(old); }
      return Boolean(localStorage.getItem(key));
    } catch { return true; }   // storage cannot be used: never ask, rather than ask every time
  }
  function markAsked(name) { try { localStorage.setItem(ASKED[name][0], '1'); } catch { /* not stored */ } }
  function askOnce(slot, { name, title: heading, body, yes, onYes, howHref }) {
    slot.innerHTML = `<div class="locked u-mt">
      <div><span class="locked__tag">${ICON.shield}New in Sentinel</span><h3>${heading}</h3><p>${body}</p></div>
      <div class="locked__actions"><button class="btn btn--gold" data-ask-yes>${yes}</button><button class="btn" data-ask-no>Not now</button><a class="btn btn--ghost" href="${howHref}">How it works</a></div>
    </div>`;
    const done = () => { markAsked(name); slot.innerHTML = ''; };
    $('[data-ask-no]', slot).addEventListener('click', done);
    $('[data-ask-yes]', slot).addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try { await onYes(); done(); }
      catch (err) { ev.target.disabled = false; toast(desktopError(err), 'error'); }
    });
  }

  async function askChatSafety(slot, again) {
    if (!slot || !desktop || !desktop.setChatSafety || asked('chat')) return;
    let info = state.desktopInfo;
    try { if (!info) info = state.desktopInfo = await desktop.info(); } catch (err) {
      failed(slot, { message: desktopError(err) }, again || (() => askChatSafety(slot)), { small: true, quiet: true, what: 'The Sentinel app did not answer, so its suggestions are not shown.' });
      return;
    }
    if (!info.chatSafety || !info.chatSafety.supported || info.chatSafety.enabled || !slot.isConnected) return;
    askOnce(slot, {
      name: 'chat', title: 'Chat safety for Roblox and Discord', yes: 'Turn on chat safety', howHref: '/app/settings#chat-safety',
      body: 'Sentinel can point out scams and people who may not be safe to talk to, right beside the message, while Roblox or the Discord app is in front. It reads chat on this computer only and keeps nothing; a badge shows while it watches, and in a Roblox game only when you press Esc. Turn it on for yourself, or for a child who uses this computer.',
      onYes: async () => { await desktop.setChatSafety(true); toast(CHAT_ON, 'success'); }
    });
  }
  /* Exposure alerts: sites visited in the last 14 days that a threat list named afterwards (server/lib/scan/exposure.js). */
  const EXPOSURE_WHAT = { phishing: 'Fake sign-in page', crypto: 'Crypto scam', scam: 'Scam site', malware: 'Spreads malware' };
  // The password and scan steps are the shared ones (steps.js), the same words as the recovery guide's.
  function exposureSteps(e) {
    const S = window.SentinelSteps.text;
    if (e.kind === 'phishing') return `Signed in or typed a password there? ${esc(S.password)}${e.realSite ? ` The real site is <b>${esc(e.realSite)}</b>.` : ''} Then look for sign-ins or changes you do not recognise.`;
    if (e.kind === 'crypto') return 'If you connected a wallet or signed anything there, remove that site\'s permissions in your wallet and move what is left to a new wallet. Never type a recovery phrase into any site.';
    if (e.kind === 'malware') return `If you downloaded or opened anything from it, check that day's downloads now. Ran a program from it? ${esc(S.scan)}`;
    return 'If you paid or gave card details there, call your bank or card company on the number printed on your card and ask about a refund. Watch your statements for charges you did not make.';
  }
  // What to tick in the recovery guide for each kind of listing.
  const EXPOSURE_HAPPENED = { phishing: 'password', crypto: 'crypto', malware: 'file', scam: 'card' };
  function exposureItem(e) {
    // The day is the visit's own calendar day, where the person was, kept as midnight UTC (exposure.js remember).
    const day = new Date(e.visitedAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const malware = e.kind === 'malware';
    return `<li class="exposure">
      <span class="list__icon" ${status(malware ? 'red' : 'orange')}>${Masks.svg(malware ? 'malware' : 'scam')}</span>
      <span class="list__main"><b>${esc(e.host)}</b><span>${esc(EXPOSURE_WHAT[e.kind] || 'Listed')} &middot; you visited it on ${esc(day)}, and ${e.page ? 'a page on this site was listed' : 'a threat list named it'} ${esc(ago(e.listedAt))}.</span>
        <span>${exposureSteps(e)}</span>
        <span>Already paid or let someone in? <a href="/app/recover?happened=${EXPOSURE_HAPPENED[e.kind] || 'card'}">Open the recovery guide</a></span>
        <span class="exposure__actions">
          ${malware && desktop.checkDownloadsFrom ? `<button class="btn btn--sm btn--gold" data-exposure-downloads="${esc(String(e.visitedAt))}">Check that day&rsquo;s downloads</button>` : ''}
          ${e.realSite ? `<a class="btn btn--sm btn--gold" href="https://${esc(e.realSite)}/" target="_blank" rel="noopener noreferrer">Go to ${esc(e.realSite)}</a>` : ''}
          <button class="btn btn--sm" data-exposure-done="${esc(e.host)}">Done</button>
        </span></span>
    </li>`;
  }
  function exposurePanel(info, items) {
    if (!desktop || !desktop.setExposureAlerts) return '';
    const on = Boolean(info && info.exposureAlerts);
    const supported = Boolean(info && info.live && info.live.supported);
    // Sites are remembered only while live scanning runs: with it off, "nothing so far" would be no news at all.
    const empty = !supported ? 'Available on Windows, with live scanning.'
      : !on ? 'Off. Nothing about the sites you visit is remembered. <a href="/app/settings#exposure-alerts">Turn on exposure alerts in Settings</a>.'
        : !(info.live && info.live.enabled) ? 'On, but live scanning is off, so no sites are being remembered. Start scanning to use exposure alerts.'
          : 'Nothing so far. None of the sites you visited in the last 14 days has been put on a threat list since.';
    return `<div class="panel u-mt" id="exposures">
      <div class="panel__head"><div><h2>Exposure alerts</h2>
        <p>Sites you visited that a threat list named afterwards, with what to do.</p></div></div>
      ${items.length ? `<ul class="list">${items.map(exposureItem).join('')}</ul>`
        : `<p class="muted u-mt-sm">${empty}</p>`}
    </div>`;
  }
  function bindExposures(slot) {
    $$('[data-exposure-done]', slot).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await desktop.dismissExposure(b.dataset.exposureDone); renderDesktopControls(slot); }
      catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
    }));
    $$('[data-exposure-downloads]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Checking', async () => {
      try {
        const r = await desktop.checkDownloadsFrom(Number(b.dataset.exposureDownloads));
        const files = (n) => `${n} file${n === 1 ? '' : 's'}`;
        toast(!r.checked ? 'Nothing arrived in Downloads around that day.'
          : r.flagged ? `${r.flagged} of ${files(r.checked)} from that day ${r.flagged === 1 ? 'was' : 'were'} flagged. See the Defense log.`
            : `${files(r.checked)} from that day checked. None was flagged.`, r.flagged ? 'error' : 'success');
      } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    })));
    if (desktop.onExposures) slot._off.push(desktop.onExposures(() => { if (slot.isConnected) renderDesktopControls(slot); }));
  }
  // Asked once, in the Windows app, once live scanning is in use: what exposure alerts do, then Turn on or Not now.
  async function askExposureAlerts(slot) {
    if (!slot || !desktop || !desktop.setExposureAlerts || asked('exposure')) return;
    let info = state.desktopInfo;
    try { if (!info) info = state.desktopInfo = await desktop.info(); } catch { return; }
    // The card promises "on this computer only", which holds only with the app's own server.
    if (info.exposureAlerts || !info.embeddedServer || !info.live || !info.live.supported || !info.live.enabled || !slot.isConnected) return;
    askOnce(slot, {
      name: 'exposure', title: 'Hear about it if a site you visited turns out to be a scam', yes: 'Turn on exposure alerts', howHref: '/app/settings#exposure-alerts',
      body: 'Scam pages often reach the threat lists a day or two after they go up. Sentinel can remember the sites live scanning found safe for 14 days, on this computer only and as scrambled codes, and tell you if a list names one of them later, with what to change.',
      onYes: async () => { await desktop.setExposureAlerts(true); toast(EXPOSURE_ON, 'success'); }
    });
  }

  // Most in need of the person first: flagged, then the files Sentinel could not stand behind.
  const downloadRank = (d) => (d.badge && !d.quarantined ? 3 : d.looked === 'none' ? 2 : d.looked === 'part' ? 1 : 0);

  function downloadRow(d) {
    const said = d.badge ? `${esc(d.label)}${d.reason ? ` &middot; ${esc(d.reason)}` : ''}` : esc(d.looked === 'all' ? d.label : d.reason);
    const end = d.quarantined ? '<span class="status">Quarantined</span>'
      : d.badge ? `<button class="btn btn--sm" data-quarantine="${esc(d.id)}">Quarantine</button>`
        : d.looked === 'all' ? '<span class="status is-on">Checked</span>'
          : d.looked === 'part' ? '<span class="status is-locked">Partly checked</span>' : '<span class="status">Not checked</span>';
    // The file as Sentinel read it, lit where it read, a sliver at least. Beside the words, never instead of them.
    const lit = d.looked === 'none' ? 0 : Math.max(4, d.read * 50);
    return `<li>
          <span class="list__icon">${ICON.file}</span>
          <span class="list__main"><b>${esc(d.name)}</b><span>${bytes(d.size)} &middot; ${ago(d.scannedAt)} &middot; ${said}</span></span>
          <span class="dl-end"><span class="read-strip read-strip--${d.badge ? 'flag' : esc(d.looked)}" style="--end:${lit.toFixed(1)}%" aria-hidden="true"></span>${end}</span>
        </li>`;
  }

  async function renderDesktopControls(slot) {
    let info;
    try { info = await desktop.info(); } catch { return; }
    state.desktopInfo = info;
    let recent = [];
    try { recent = await desktop.recentDownloads(); } catch { /* none */ }

    const live = info.live || { supported: false, active: false, enabled: false, reason: 'Not available' };
    let ledger = [];
    try { ledger = (await desktop.defense()).ledger || []; } catch { /* none */ }
    let exposures = [];
    try { if (desktop.exposures) exposures = await desktop.exposures(); } catch { /* none */ }
    // Left the page while waiting: subscribing now would leave listeners behind that nothing ever removes.
    if (!slot.isConnected) return;
    const browsers = (info.browsers && info.browsers.installed) || [];
    const running = new Set((info.browsers && info.browsers.running) || []);

    (slot._off || []).forEach((off) => off());
    slot._off = [];
    const active = slot.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? ['liveToggle', 'scanWith', 'restore', 'quarantine'].find((k) => k in active.dataset) : null;
    const focusValue = focusKey ? active.dataset[focusKey] : null;
    const fellBack = live.fellBack === 'delicate_hours_used' ? ' Delicate hours for this week are used up, so results are coming from fast scanning.' : '';
    const liveText = !live.supported ? 'Live scanning is available on Windows.'
      : live.active ? (live.window ? `Watching the browser in front. Look for the island in its bottom right corner.${live.lastResults ? ` Last search: ${live.lastResults.count} results marked.` : ''}${fellBack}` : 'Ready. It starts by itself whenever a browser is in front, and rests when none is.')
        : live.enabled ? (live.reason || 'Starting') : 'Off. One click, and every browser you use is covered.';
    slot.innerHTML = `
      <div class="panel live u-mt">
        <div class="live__main">
          <span class="live__mask${live.active ? ' is-on' : ''}" aria-hidden="true">${Masks.svg('scam')}</span>
          <div class="live__text"><h2>Live scanning</h2><p data-live-text>${esc(liveText)}</p>${live.counts && live.counts.checked ? `<p class="live__counts" data-live-counts>${live.counts.checked.toLocaleString()} checked since Sentinel started, ${live.counts.flagged.toLocaleString()} flagged. Private windows are not counted.</p>` : '<p class="live__counts" data-live-counts hidden></p>'}</div>
          <button class="btn ${live.enabled ? '' : 'btn--gold'} live__button" data-live-toggle ${live.supported ? '' : 'disabled'}>${live.enabled ? 'Stop scanning' : 'Start scanning'}</button>
        </div>
        <ul class="live__facts">
          <li><b>Fast</b> marks results about a second after you search. <b>Delicate</b> also looks up how old each site is and whether it resolves, and takes about five seconds. Neither opens a suspicious page from this computer.</li>
          <li>Only the browser in front, and only while you are using it. Minimised, in the background or closed: nothing is read and no live time is spent.</li>
          <li>Private windows are protected the same way, and nothing about them is kept: no history, no log, no entry below.</li>
          <li>Sentinel reads addresses, never what a page says or what you type.</li>
        </ul>
      </div>

        <div class="panel u-mt">
          <div class="panel__head"><div><h2>Your browsers</h2><p>Pick one. Sentinel opens it if it is closed, brings it to the front, and starts scanning.</p></div></div>
          ${browsers.length ? `<ul class="list">${browsers.map((b) => `<li>
            <span class="list__icon">${ICON.globe}</span>
            <span class="list__main"><b>${esc(b.name)}</b><span data-browser-state="${esc(b.id)}">${running.has(b.id) ? 'Open now' : 'Installed'}</span></span>
            <button class="btn btn--sm btn--gold" data-scan-with="${esc(b.id)}" ${live.supported ? '' : 'disabled'}>Scan with ${esc(b.name.replace(/^(Google|Microsoft|Mozilla) /, ''))}</button>
          </li>`).join('')}</ul>` : stateBlock('unavailable', 'No supported browser found on this computer.')}
        </div>

      ${exposurePanel(info, exposures)}

      <div class="grid2 u-mt">
        <div class="panel">
          <div class="panel__head"><div><h2>Live, right now</h2><p>${live.active ? 'Pages show up here as they are checked. Private windows never do.' : 'Start scanning to see pages as they are checked.'}</p></div><span class="live-dot${live.active ? ' is-on' : ''}" aria-hidden="true"></span></div>
          <ul class="list feed" data-feed>${live.current && live.current.url ? `<li class="feed__item"><span class="list__icon">${ICON.globe}</span><span class="list__main"><b>${esc(live.current.url)}</b><span>In front now</span></span></li>` : '<li class="feed__empty muted">Nothing checked yet. Open a page in your browser.</li>'}</ul>
        </div>
        <div class="panel" id="defense">
          <div class="panel__head"><div><h2>Defense log</h2><p>What arrived, what was scanned, what was stopped.</p></div></div>
          ${ledger.length ? `<ul class="list">${ledger.slice(0, 8).map((e) => `<li>
            <span class="list__icon" style="${e.kind === 'threat' ? 'color:var(--red)' : e.kind === 'suspect' ? 'color:var(--orange)' : e.kind === 'restored' ? 'color:var(--gold-300)' : ''}">${ICON.file}</span>
            <span class="list__main"><b>${esc(e.name || e.path || '')}</b><span>${ago(e.at)} &middot; ${esc(e.kind === 'threat' ? `${e.label}: ${(e.actions || []).map((a) => a.did).join(', ')}` : e.kind === 'suspect' ? `${e.label}: runs at startup; nothing was changed. Quarantine it if you do not recognise it.` : e.kind === 'restored' ? 'Put back' : e.kind === 'noted' ? `${e.label}: ${e.signedBy ? `signed by ${e.signedBy}, ` : ''}noted, nothing touched` : `Clean (${e.how || 'scanned'})`)}</span></span>
            ${e.kind === 'threat' && !e.restored && (e.quarantined || (e.actions || []).some((a) => a.undo)) ? `<button class="btn btn--sm" data-restore="${esc(e.id)}">Put back</button>` : ''}
            ${e.kind === 'suspect' ? `<button class="btn btn--sm" data-suspect="${esc(e.id)}">Quarantine</button>` : ''}
          </li>`).join('')}</ul>` : stateBlock('waiting', 'Nothing yet. Each file Sentinel scans, and anything it stops, is listed here.')}
        </div>
      </div>

      <div class="panel u-mt" id="downloads">
        <h2 class="u-mb">Recent downloads</h2>
        ${recent.length ? `<ul class="list">${[...recent].sort((a, b) => downloadRank(b) - downloadRank(a)).slice(0, 8).map(downloadRow).join('')}</ul>` : stateBlock('waiting', 'New downloads will appear here once they are scanned.')}
      </div>`;

    if (focusKey) {
      const again = $$(`[data-${focusKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`, slot).find((el2) => el2.dataset[focusKey] === focusValue);
      if (again) again.focus({ preventScroll: true });
    }
    // Opened from a notification (a dangerous download, an exposure, a swapped wallet address): straight to its part, once.
    for (const id of ['downloads', 'exposures', 'defense']) {
      if (location.hash !== `#${id}` || state[`scrolledTo${id}`]) continue;
      state[`scrolledTo${id}`] = true;
      const part = $(`#${id}`, slot);
      if (part) part.scrollIntoView({ block: 'start' });
    }
    bindExposures(slot);
    $$('[data-suspect]', slot).forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await desktop.quarantineSuspect(b.dataset.suspect); toast('Quarantined. You can put it back from here.', 'success'); renderDesktopControls(slot); }
      catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
    }));
    $$('[data-restore]', slot).forEach((b) => b.addEventListener('click', async () => {
      try { await desktop.restoreQuarantined(b.dataset.restore); toast('Put back as it was.', 'success'); renderDesktopControls(slot); }
      catch (err) { toast(desktopError(err), 'error'); }
    }));
    // The live feed fills in as the desktop checks pages.
    const feed = $('[data-feed]', slot);
    if (feed && desktop.onPageChecked) {
      slot._off.push(desktop.onPageChecked((item) => {
        if (!feed.isConnected) return;
        feed.querySelector('.feed__empty')?.remove();
        const li = h(`<li class="feed__item is-new"><span class="list__icon" ${status(item.badge)}>${item.badge ? Masks.svg('scam') : ICON.check}</span><span class="list__main"><b>${esc(item.host)}</b><span>${esc(item.label)} &middot; ${esc(item.browser)}</span></span></li>`);
        feed.prepend(li);
        requestAnimationFrame(() => li.classList.remove('is-new'));
        while (feed.children.length > 8) feed.lastElementChild.remove();
      }));
    }
    const toggle = $('[data-live-toggle]', slot);
    if (toggle && !toggle.disabled) toggle.addEventListener('click', () => busy(toggle, live.enabled ? 'Stopping' : 'Starting', async () => {
      try {
        const s2 = live.enabled ? await desktop.liveStop() : await desktop.liveStart();
        if (!live.enabled && !s2.active) toast(s2.reason || 'Live scanning could not start.', 'error');
      } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    }));
    $$('[data-scan-with]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Opening', async () => {
      try {
        const r = await desktop.scanWith(b.dataset.scanWith);
        if (!r.ok) toast(r.reason || 'Live scanning could not start.', 'error');
        else toast(`${r.name} is ${r.launched ? 'opening' : 'in front'}. Sentinel is scanning it.`, 'success');
      } catch (err) { toast(desktopError(err), 'error'); }
      renderDesktopControls(slot);
    })));
    if (desktop.onLive) {
      slot._off.push(desktop.onLive((s2) => {
        if (!slot.isConnected) return;
        if (state.desktopInfo) state.desktopInfo.live = s2;
        // Only the words and the mask change while it runs; a full redraw would steal focus from the buttons.
        const text = $('[data-live-text]', slot);
        const mask = $('.live__mask', slot);
        if (mask) mask.classList.toggle('is-on', Boolean(s2.active));
        const counts = $('[data-live-counts]', slot);
        if (counts && s2.counts && s2.counts.checked) { counts.hidden = false; counts.textContent = `${s2.counts.checked.toLocaleString()} checked since Sentinel started, ${s2.counts.flagged.toLocaleString()} flagged. Private windows are not counted.`; }
        if (text && s2.active) text.textContent = s2.window ? 'Watching the browser in front. Look for the island in its bottom right corner.' : 'Ready. It starts by itself whenever a browser is in front, and rests when none is.';
        else if (text && s2.reason) text.textContent = s2.reason;
      }));
    }
    if (desktop.onBrowsers) {
      slot._off.push(desktop.onBrowsers((b2) => {
        if (!slot.isConnected) return;
        const open = new Set(b2.running || []);
        $$('[data-browser-state]', slot).forEach((el2) => { el2.textContent = open.has(el2.dataset.browserState) ? 'Open now' : 'Installed'; });
      }));
    }
    // The defense row, the update row and the downloads list redraw when the desktop says something changed.
    for (const name of ['onDefense', 'onUpdate', 'onDownloadThreat', 'onSettings']) {
      if (desktop[name]) slot._off.push(desktop[name](() => { if (slot.isConnected) renderDesktopControls(slot); }));
    }
    $$('[data-quarantine]', slot).forEach((b) => b.addEventListener('click', async () => {
      try {
        await desktop.quarantine(b.dataset.quarantine);
        toast('File moved to quarantine.', 'success');
        renderDesktopControls(slot);
      } catch (err) { toast(desktopError(err), 'error'); }
    }));
  }

  /* ============================================================ settings */

  /*
   * Settings: one home for every choice Sentinel offers. Each row is one object, and the same list draws the page,
   * filters it as you type and feeds the search palette, so a setting is found by its words wherever it is asked for.
   * A row that cannot work here says why in place of working: its control disabled, never hidden, never shown as on.
   * A change is saved when it is pressed; a failed save puts the control back and says why.
   * The groups are fixed. The accent and look picker adds its rows to 'look', motion and the scan effect to 'moving'.
   */
  const SETTING_GROUPS = [
    ['look', 'Appearance'], ['moving', 'Motion'], ['protection', 'Live protection'], ['guards', 'Everyday guards'],
    ['chat', 'Chat and texts'], ['alerts', 'Alerts'], ['lock', 'Parent lock'], ['account', 'Account and security'], ['data', 'Your data'], ['plan', 'Plan and app'], ['help', 'Help']
  ];
  /** A switch saved through the app: `on` reads it, `off` says why it cannot work (past needing the app), `said` is the toast. */
  const appSwitch = (o) => ({ ...o, kind: 'switch', app: true, why: (info) => appWhy(info, o.method) || (o.off ? o.off(info) : '') });
  const facts = (summary, items) => `<details class="set-facts"><summary>${summary}</summary><ul>${items.map(([b, t]) => `<li><b>${b}</b> ${t}</li>`).join('')}</ul></details>`;
  const linkControl = (href) => `<a class="btn btn--sm" href="${href}">Open</a>`;

  const SETTINGS = [
    ROW.theme, ROW.accent,
    { id: 'simple-view', group: 'look', kind: 'switch', label: 'Simple view', hint: 'Fewer pages and fewer words. A check shows its answer and what to do, in bigger type, with the details one press away. On this device.',
      words: ['simple', 'easy', 'less', 'basic', 'bigger', 'large', 'older', 'beginner', 'clutter', 'plain'],
      on: () => simpleView(), save: (input) => window.SentinelSimple.set(input.checked),
      said: (on) => (on ? 'Simple view is on. Pages you may not need are tucked away; search still finds every one.' : 'Simple view is off. Every page and detail is back.') },
    ROW['text-size'],
    { id: 'density', group: 'look', kind: 'custom', label: 'Spacing', hint: 'Compact fits more on one screen. Buttons stay easy to press.',
      words: ['compact', 'dense', 'density', 'comfortable', 'padding', 'space', 'tight'],
      control: () => seg('set-density-l', [['comfortable', 'Comfortable'], ['compact', 'Compact']], window.SentinelType ? window.SentinelType.get().density : 'comfortable'),
      bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', () => { if (window.SentinelLook && SentinelLook.set) SentinelLook.set({ density: b.dataset.seg }); ctx.draw(); })) },

    ROW.motion,

    { id: 'live-mode', group: 'protection', kind: 'custom', app: true, label: 'Scanning mode', hint: 'Fast marks search results about a second after you search. Delicate also looks up how old each site is and whether it resolves, and takes about five seconds.',
      words: ['fast', 'delicate', 'live', 'speed', 'research', 'search results'],
      why: (i) => appWhy(i, 'setLiveMode') || onWindows(liveOf(i).supported) || (plan().features.liveScanning || plan().features.liveFast ? '' : 'Live scanning is not in your plan. See Plan and usage below.'),
      state: () => (plan().features.liveScanning ? '' : 'Delicate comes with Pro, Max and Ultimate.'),
      control: (i) => { const can = Boolean(plan().features.liveScanning); return seg('set-live-mode-l', [['fast', 'Fast'], ['delicate', 'Delicate', !can]], i.liveMode === 'delicate' && can ? 'delicate' : 'fast'); },
      bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', async () => {
        if (b.getAttribute('aria-pressed') === 'true') return;
        $$('[data-seg]', row).forEach((x) => { x.disabled = true; });
        try { await desktop.setLiveMode(b.dataset.seg); toast(b.dataset.seg === 'delicate' ? 'Live scanning is delicate now.' : 'Live scanning is fast now.', 'success'); } catch (err) { toast(desktopError(err), 'error'); }
        ctx.refresh();
      })) },
    levelRow({ id: 'marks-beside-links', group: 'protection', label: 'Marks beside links', method: 'setMarksLevel', key: 'marksLevel',
      hint: 'Sentinel checks every link either way. This only changes which ones get a mark. A warning or danger mark always shows.',
      words: ['marks', 'ticks', 'tick', 'safe', 'busy', 'clutter', 'quiet', 'search results', 'less', 'density'],
      options: [['all', 'Every link'], ['risky', 'Risky links'], ['danger', 'Serious only']],
      said: { all: 'Every link gets a mark. Safe ones get a small tick.', risky: 'Risky links get a mark. Safe ones get none.', danger: 'Only warning and danger links get a mark.' },
      state: { all: 'Safe links get a small tick, so every result shows its answer.', risky: 'Caution, warning and danger links get a mark. Safe links get none.', danger: 'Only warning and danger links get a mark. The corner island still counts every link.' } }),
    appSwitch({ id: 'auto-scan', group: 'protection', label: 'Auto scanning', hint: 'Starts fast scanning by itself whenever you open a browser, and stops when every browser is closed.',
      words: ['automatic', 'browser', 'start', 'live'], method: 'setAutoScan', hook: 'auto-scan', on: (i) => i.autoScan, off: (i) => onWindows(liveOf(i).supported),
      said: (on) => (on ? 'Auto scanning is on. Open a browser and Sentinel starts scanning it.' : 'Auto scanning is off.') }),
    appSwitch({ id: 'download-protection', group: 'protection', label: 'Download protection', hint: 'Every new file in your Downloads folder is inspected on your computer.',
      words: ['downloads', 'files', 'folder', 'virus', 'malware'], method: 'setDownloadProtection', hook: 'dl', on: (i) => i.downloads && i.downloads.active,
      state: (i) => (i.downloads && i.downloads.active ? `Watching ${i.downloads.folder || 'Downloads'}.` : (i.downloads && i.downloads.reason) || ''),
      said: (on, r) => (on ? 'Download protection is on.' : (r && r.reason) || 'Download protection is off.') }),
    appSwitch({ id: 'defense-watch', group: 'protection', label: 'Defense', hint: 'Watches new programs and startup entries. A dangerous program is stopped, quarantined and its startup entries removed.',
      words: ['startup', 'quarantine', 'malware', 'program', 'virus', 'stop'], method: 'setDefense', hook: 'defense', on: (i) => i.defense && i.defense.active, off: (i) => onWindows(i.defense && i.defense.supported),
      state: (i) => (i.defense.active ? `Watching ${(i.defense.watched || []).join(', ')} and startup entries.` : i.defense.reason || ''),
      said: (on, r) => (on ? 'Defense is on.' : (r && r.reason) || 'Defense is off.') }),
    appSwitch({ id: 'my-sites', group: 'protection', label: 'Your sites', hint: 'Sentinel knows the big brands. Here it learns yours: your bank or credit union, your school portal, your work sign-in. A link or page made to look like one of them gets a warning.',
      words: ['bank', 'look-alike', 'lookalike', 'credit union', 'school', 'fake', 'sites', 'impersonation'], method: 'setMySites', hook: 'my-sites', on: (i) => i.mySites !== false,
      off: (i) => (i.embeddedServer ? '' : 'Available when the app uses its own scanner on this computer.'),
      said: (on, r) => (on ? 'Your sites: on. Sentinel will learn the sites you use.' : r && r.erased === false ? 'Your sites: off. The sites could not be erased just now, so Sentinel will try again each time it starts.' : 'Your sites: off. Every site is forgotten.'),
      body: (i, data) => `${i.mySites !== false ? `<form class="set-sub set-add" data-my-sites-add>
          <input class="input mono" name="host" placeholder="mycu.org" aria-label="A site you use" autocomplete="off" spellcheck="false" maxlength="300" required>
          <button class="btn btn--gold btn--sm" type="submit">Add site</button></form>
        ${data.mine.length ? `<ul class="list">${data.mine.map((s) => `<li><span class="list__main"><b class="mono">${esc(s.host)}</b><span>${s.source === 'you' ? 'Added by you' : 'Learned: you use it often'}</span></span><button class="btn btn--sm" type="button" data-my-site-remove="${esc(s.host)}">Remove</button></li>`).join('')}</ul>
          <div class="set-sub"><span class="muted">${data.mine.length} site${data.mine.length === 1 ? '' : 's'}</span><button class="btn btn--sm" type="button" data-my-sites-forget>Forget all</button></div>`
          : '<p class="set-row__state">None yet. A site you visit on three different days is added by itself, or add one now.</p>'}` : ''}
        ${facts('How they are kept', [['On this computer only,', 'as plain site names you can read here. A site you passed through is never written down: until it has been seen on three days, only a scrambled code of it is kept.'], ['Learned only from safe pages,', 'never from a private window. Turning this off forgets every site.']])}`,
      bind: (row, info, ctx) => {
        const form = $('[data-my-sites-add]', row);
        if (form) form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try { await desktop.addMySite(form.elements.host.value); toast('Added. Look-alikes of it now get a warning.', 'success'); ctx.refresh(); }
          catch (err) { form.elements.host.setAttribute('aria-invalid', 'true'); toast(desktopError(err), 'error'); }
        });
        $$('[data-my-site-remove]', row).forEach((b) => b.addEventListener('click', async () => {
          b.disabled = true;
          try { await desktop.removeMySite(b.dataset.mySiteRemove); ctx.refresh(); } catch (err) { b.disabled = false; toast(desktopError(err), 'error'); }
        }));
        const forget = $('[data-my-sites-forget]', row);
        if (forget) forget.addEventListener('click', async () => {
          try { await desktop.forgetMySites(); toast('Every site is forgotten.', 'success'); ctx.refresh(); } catch (err) { toast(desktopError(err), 'error'); }
        });
      } }),
    appSwitch({ id: 'scan-menu', group: 'protection', label: 'Scan with Sentinel in the right-click menu', hint: 'Right-click any file, choose Show more options, then Scan with Sentinel. The file is checked on this computer and the answer opens here.',
      words: ['context menu', 'explorer', 'file', 'right click'], method: 'setScanMenu', hook: 'scan-menu', on: (i) => i.scanMenu && i.scanMenu.enabled, off: (i) => onWindows(i.scanMenu && i.scanMenu.supported),
      said: (on) => (on ? 'Scan with Sentinel is in the right-click menu.' : 'Scan with Sentinel is no longer in the right-click menu.') }),
    appSwitch({ id: 'start-with-computer', group: 'protection', label: 'Start with my computer', hint: 'Keeps protection running from the moment you sign in to Windows.',
      words: ['startup', 'boot', 'login', 'sign in', 'launch'], method: 'setOpenAtLogin', hook: 'login', on: (i) => i.openAtLogin,
      said: (on) => (on ? 'Sentinel starts with your computer.' : 'Sentinel no longer starts with your computer.') }),

    appSwitch({ id: 'copied-links', group: 'guards', label: 'Check links I copy', hint: 'Copy a link from a text message, a chat or a PDF and Sentinel checks it, and warns you only if it is dangerous. Only copied web links are read; nothing else on your clipboard is sent or kept.',
      words: ['clipboard', 'copy', 'paste', 'link'], method: 'setClipboardCheck', hook: 'clip', on: (i) => i.clipboardCheck,
      said: (on) => (on ? 'Check links I copy is on. Copy a link and Sentinel checks it.' : 'Check links I copy is off.') }),
    appSwitch({ id: 'pasted-commands', group: 'guards', label: 'Stop pasted commands', hint: 'Fake "I am not a robot" pages copy a command and ask you to paste it into Windows. Copied in a browser, Sentinel takes it off your clipboard and tells you, with a way to put it back; copied in another program, it only tells you. Checked on this computer, never sent or kept.',
      words: ['clickfix', 'captcha', 'robot', 'powershell', 'command', 'clipboard', 'run'], method: 'setCommandShield', hook: 'shield', on: (i) => i.commandShield, off: (i) => onWindows(i.platform === 'win32'),
      said: (on) => (on ? 'Stop pasted commands is on.' : 'Stop pasted commands is off.'),
      // For the two minutes Sentinel holds a stopped command, the way to put it back (the notification has it too).
      body: (i) => {
        const held = i.commandHeld;
        if (!held || held.until <= Date.now() || !desktop.commandPutBack) return '';
        const at = new Date(held.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return `<div class="set-sub"><p>Taken off your clipboard at ${esc(at)}${held.host ? `, copied from ${esc(held.host)}` : ''}. ${esc(held.reason)}. If you trust it, you can put it back for two minutes.</p><button class="btn btn--sm" type="button" data-put-back>Put it back</button></div>`;
      },
      bind: (row, info, ctx) => {
        const b = $('[data-put-back]', row);
        if (!b) return;
        const t = setTimeout(ctx.draw, Math.max(0, info.commandHeld.until - Date.now()) + 50);
        ctx.offs.push(() => clearTimeout(t));
        b.addEventListener('click', async () => {
          try { const r = await desktop.commandPutBack(); toast(r.ok ? `The command is back on your clipboard. ${r.message}` : r.message, r.ok ? 'success' : 'info'); } catch (err) { toast(desktopError(err), 'error'); }
        });
      } }),
    appSwitch({ id: 'wallet-guard', group: 'guards', label: 'Wallet guard', hint: 'Some malware waits for you to copy a crypto wallet address or an IBAN and swaps in its own. If the address you copied changes by itself a moment later, Sentinel puts yours back and tells you. Compared in memory, never sent, saved or logged.',
      words: ['crypto', 'bitcoin', 'iban', 'bank', 'address', 'clipboard', 'swap'], method: 'setWalletGuard', hook: 'wallet-guard', on: (i) => i.walletGuard, off: (i) => onWindows(i.platform === 'win32'),
      said: (on) => (on ? 'Wallet guard is on.' : 'Wallet guard is off.') }),
    appSwitch({ id: 'remote-guard', group: 'guards', label: 'Tech-support scam shield', hint: 'When a page flagged as a scam takes the whole screen, Sentinel offers to close it. When a remote-control program such as AnyDesk or TeamViewer starts soon after a flagged page, or soon after it was downloaded, Sentinel asks whether someone on the phone told you to install it. Nothing is stopped unless you say so.',
      words: ['anydesk', 'teamviewer', 'remote', 'support', 'phone', 'full screen', 'popup'], method: 'setRemoteGuard', hook: 'remote-guard', on: (i) => i.remoteGuard && i.remoteGuard.enabled, off: (i) => onWindows(i.remoteGuard && i.remoteGuard.supported),
      state: (i) => (i.remoteGuard.enabled && !liveOf(i).enabled ? 'Needs live scanning: the way out of a full-screen page and the bank warning work while live scanning is on.' : ''),
      said: (on) => (on ? 'The tech-support scam shield is on.' : 'The tech-support scam shield is off.'),
      body: (i) => { const t = i.remoteGuard.trusted || []; return t.length ? `<div class="set-sub"><p>You use ${esc(t.join(', '))} yourself, so Sentinel does not ask about ${t.length === 1 ? 'it' : 'them'}.</p><button class="btn btn--sm" type="button" data-forget-remote>Ask again</button></div>` : ''; },
      bind: (row, info, ctx) => {
        const b = $('[data-forget-remote]', row);
        if (b) b.addEventListener('click', async () => {
          try { await desktop.forgetTrustedRemote(); toast('Sentinel will ask about remote-control programs again.', 'success'); ctx.refresh(); } catch (err) { toast(desktopError(err), 'error'); }
        });
      } }),
    appSwitch({ id: 'snip', group: 'guards', label: 'Check something on screen', hint: 'Press the shortcut, or choose Check something on screen in the tray menu, then draw a box around a pop-up, an ad, a message, a QR code or a phone number. Sentinel reads it on this computer and tells you whether it looks like a scam. Only the links it finds are checked; the picture and the words are never sent or kept.',
      words: ['screenshot', 'snip', 'shortcut', 'keyboard', 'qr', 'popup', 'screen'], method: 'setSnip', hook: 'snip', on: (i) => i.snip.enabled, off: (i) => onWindows(i.snip && i.snip.supported),
      state: (i) => (i.snip.enabled && !i.snip.registered ? 'Another program already uses this shortcut. Choose another one.' : ''),
      save: (input, row) => desktop.setSnip(input.checked, $('[data-snip-key]', row).value),
      said: (on, r) => (r && r.enabled && !r.registered ? 'Another program already uses this shortcut. Choose another one.' : on ? 'Check something on screen is on.' : 'Check something on screen is off.'),
      body: (i) => `<label class="set-sub"><span>Shortcut</span><select class="input" data-snip-key ${i.snip.enabled ? '' : 'disabled'}>${i.snip.keys.map((k) => `<option value="${esc(k.id)}" ${k.id === i.snip.key ? 'selected' : ''}>${esc(k.label)}</option>`).join('')}</select></label>`,
      bind: (row, info, ctx) => {
        const key = $('[data-snip-key]', row);
        key.addEventListener('change', async () => {
          try {
            const s = await desktop.setSnip($('.switch', row).checked, key.value);
            toast(s.enabled && !s.registered ? 'Another program already uses this shortcut. Choose another one.' : 'Shortcut changed.', s.enabled && !s.registered ? 'error' : 'success');
          } catch (err) { toast(desktopError(err), 'error'); }
          ctx.refresh();
        });
      } }),

    appSwitch({ id: 'chat-safety', group: 'chat', label: 'Chat safety: Roblox and Discord', hint: 'Points out scams and people who may not be safe to talk to (someone asking a child to keep secrets, to send pictures, to move to another app, or to meet), right beside the message, while Roblox or the Discord app is in front.',
      words: ['roblox', 'discord', 'child', 'children', 'kids', 'games', 'grooming', 'messages', 'family'], method: 'setChatSafety', hook: 'chat-safety', on: (i) => i.chatSafety && i.chatSafety.enabled, off: (i) => onWindows(i.chatSafety && i.chatSafety.supported),
      seen: 'chat-seen', state: (i) => chatSeenText(i.chatSafety), down: (i) => Boolean(i.chatSafety.enabled && readerDown(i.chatSafety, '')),
      said: (on) => (on ? CHAT_ON : 'Chat safety is off.'), saved: () => markAsked('chat'),
      body: () => facts('What it reads, and what it never does', [
        ['Read on this computer only.', 'Messages are read from the screen as they appear, judged here and forgotten. No message, name or game is sent to Sentinel or anyone else, saved, or logged.'],
        ['Always plain to see.', 'A Sentinel badge shows while chat is watched. In a Roblox game it shows only when you open the Esc menu, so it never covers the game; warnings sit small, beside the chat box.'],
        ['Never in the way.', 'Nothing is read while a game\'s chat is closed. Sentinel never changes Roblox or Discord, never types or clicks in them, and only speaks up when a message is suspicious.']]) }),
    appSwitch({ id: 'text-safety', group: 'chat', label: 'Check my texts', hint: 'If your phone\'s texts show on this computer through Phone Link, Sentinel points out English scam texts (unpaid tolls, parcel fees, "Hi Mum, this is my new number", "your account is locked") right beside the message, while Phone Link is in front.',
      words: ['sms', 'phone link', 'text messages', 'phone', 'toll', 'parcel'], method: 'setTextSafety', hook: 'text-safety', on: (i) => i.textSafety && i.textSafety.enabled, off: (i) => onWindows(i.textSafety && i.textSafety.supported),
      seen: 'text-seen', state: (i) => textSeenText(i.textSafety), down: (i) => Boolean(i.textSafety.enabled && readerDown(i.textSafety, '')),
      said: (on) => (on ? 'Check my texts is on. Open a conversation in Phone Link and Sentinel checks it.' : 'Check my texts is off.'),
      body: () => facts('What it reads, and what it never does', [
        ['Read on this computer only.', 'The conversation on screen is read as it appears, judged here and forgotten. No text, name or number is sent to Sentinel or anyone else, saved, or logged.'],
        ['Links checked, never opened.', 'A link in a text is checked by its address, the way a copied link is. It is not added to your history.'],
        ['Never in the way.', 'Only texts you received are checked. Sentinel never types, clicks or replies in Phone Link.'],
        ['English texts for now.', 'Sentinel knows the wording of scam texts in English only, and Phone Link needs to show a left-to-right language.']]) }),

    ROW['warn-level'],
    appSwitch({ id: 'exposure-alerts', group: 'alerts', label: 'Exposure alerts', hint: 'A scam page often reaches the threat lists hours or days after it goes up. With this on, Sentinel remembers the sites live scanning found safe for 14 days, and tells you if a list names one of them afterwards, with what to do.',
      words: ['listed', 'later', 'visited', 'history', 'warning', 'notification'], method: 'setExposureAlerts', hook: 'exposure-alerts', on: (i) => i.exposureAlerts, off: (i) => (liveOf(i).supported ? '' : 'Needs Windows, with live scanning.'),
      state: (i) => (i.exposureAlerts && !liveOf(i).enabled ? 'On, but live scanning is off, so no sites are being remembered.' : ''),
      said: (on, r) => (on ? EXPOSURE_ON : r && r.erased === false ? 'Exposure alerts are off. The remembered sites could not be erased just now, so Sentinel will try again each time it starts.' : 'Exposure alerts are off. Every remembered site is erased.'),
      saved: () => markAsked('exposure'),
      body: (i) => {
        // The marks live with whichever Sentinel server the app uses: its own, on this computer, or one set up for it.
        let where = 'on this computer';
        if (!i.embeddedServer) { try { where = `on the Sentinel server this app uses (${new URL(i.origin).host})`; } catch { where = 'on the Sentinel server this app uses'; } }
        return facts('How sites are remembered', [
          [`Kept ${esc(where)}`, 'as a scrambled code of each site&rsquo;s name and the day, never the address or the time, and erased after 14 days. Turning this off erases every one, and every alert found so far. The copies Sentinel keeps to repair its accounts file can hold them for up to 7 more days.'],
          ['Private windows are never remembered.', 'Pages on shared sites (a Google Sites page, a Netlify site) are left out, since one bad page there says nothing about the one you saw.']]);
      } }),
    appSwitch({ id: 'week-note', group: 'alerts', label: 'A note about your week', hint: 'Once a week, a Windows notification with last week in one line. Never while a game or video is full screen.',
      words: ['weekly', 'notification', 'summary', 'recap'], method: 'setWeekRecap', hook: 'week-recap', on: (i) => i.weekRecap,
      said: (on) => (on ? 'Done. Your first note comes after this week is over.' : 'No more weekly notes.') }),

    { id: 'parent-lock', group: 'lock', kind: 'block', app: true, label: 'Parent lock', hint: 'With a PIN set, switching off any of Sentinel\'s protection, here or in the tray, or quitting Sentinel, needs the PIN. So do putting a quarantined file back, telling the tech-support scam shield that you use a remote-control program yourself, and switching accounts. Turning protection on never does. It does not cover the browser companion or Windows administrator accounts.',
      words: ['pin', 'child', 'children', 'kids', 'family', 'lock', 'code'], why: (i) => appWhy(i, 'lockStatus'), mount: (body) => renderParentLock(body) },

    { id: 'profile', group: 'account', kind: 'block', label: 'Profile', hint: 'Your name as Sentinel shows it. Your email is how you sign in.', words: ['name', 'email', 'first name'], mount: profileBlock },
    { id: 'two-factor', group: 'account', kind: 'block', label: 'Two-factor sign-in', hint: 'A code from an authenticator app at every sign-in, as well as your password.', words: ['2fa', 'authenticator', 'code', 'otp', 'two step', 'security'],
      mount: (body) => { body.setAttribute('data-2fa', ''); render2fa(body); } },
    { id: 'password', group: 'account', kind: 'block', label: 'Change password', hint: 'You will be signed out everywhere else.', words: ['password', 'security'],
      why: () => (state.me.user.hasPassword ? '' : 'You sign in with Google, so there is no Sentinel password to change.'), mount: passwordBlock },
    { id: 'devices', group: 'account', kind: 'block', label: 'Signed-in devices', hint: 'Every browser, Sentinel app and companion signed in to your account.', words: ['sessions', 'sign out', 'logout', 'devices', 'computers'],
      mount: (body) => { body.setAttribute('data-sessions', ''); loadSessions(body); } },

    // Your data: what the Privacy Policy says an account holds, how to take it and how to remove it.
    { id: 'download-data', group: 'data', kind: 'block', label: 'Download my data', hint: 'One file with everything your account holds, item by item as the Privacy Policy lists it. Your password, sign-in links, two-factor secret and AI keys are never in it.',
      words: ['export', 'copy', 'gdpr', 'ccpa', 'privacy', 'download', 'json'], mount: downloadBlock },
    { id: 'history-data', group: 'data', kind: 'custom', label: 'Scan history', hint: 'Kept for 90 days. Delete one entry or all of it on the History page.', words: ['history', 'erase', 'clear', 'scans'],
      control: () => linkControl('/app/history') },
    { id: 'live-memory', group: 'data', kind: 'block', label: 'What live scanning remembers', hint: 'Exposure alerts keep a scrambled code for each safe site you visited, for 14 days. Your sites keeps the sites you added and the ones it learned. Either can be erased here at once.',
      words: ['exposure', 'my sites', 'your sites', 'forget', 'erase', 'remembered'], mount: forgetBlock },
    { id: 'delete-account', group: 'data', kind: 'block', label: 'Delete account', hint: 'Permanently removes your account, history, reports and trusted sites.', words: ['remove', 'erase', 'close account', 'data'], mount: deleteBlock },

    { id: 'plan-usage', group: 'plan', kind: 'custom', label: 'Plan and usage', hint: 'What is left this week, and the plans to choose from.', words: ['billing', 'pro', 'max', 'ultimate', 'upgrade', 'subscription', 'limits'],
      state: () => `You are on ${plan().name}.`, control: () => linkControl('/app/plan') },
    { id: 'assistants', group: 'plan', kind: 'custom', label: 'AI assistants', hint: 'Optional. Ask ChatGPT, Claude, Gemini or DeepSeek about anything. Sentinel\'s scans never depend on them.', words: ['chatgpt', 'claude', 'gemini', 'deepseek', 'ai', 'connect'],
      control: () => linkControl('/app/assistants') },
    { id: 'updates', group: 'plan', kind: 'custom', app: true, label: 'Updates', hint: 'The Sentinel app installs its own updates. The website is always the newest version.', words: ['version', 'update', 'upgrade', 'new'],
      why: (i) => (desktop ? appWhy(i, 'checkUpdates') : ''),
      state: (i) => (i ? `Sentinel ${i.version}. ${updateText(i.update || { status: 'idle' })}` : 'This website is always the newest Sentinel.'),
      control: (i) => { const up = (i && i.update) || {}; return up.status === 'ready' ? '<button class="btn btn--sm btn--gold" type="button" data-install-update>Restart now</button>' : up.supported ? '<button class="btn btn--sm" type="button" data-check-update>Check now</button>' : ''; },
      bind: (row, info, ctx) => {
        const check = $('[data-check-update]', row);
        if (check) check.addEventListener('click', () => busy(check, 'Checking', async () => {
          let s;
          try { s = await desktop.checkUpdates(); } catch (err) { toast(desktopError(err), 'error'); return; }
          toast(s.status === 'current' ? 'Sentinel is up to date.' : s.status === 'error' ? 'Could not check for updates. Try again later.' : 'Checking for a newer version.', s.status === 'error' ? 'error' : 'info');
          ctx.refresh();
        }));
        const install = $('[data-install-update]', row);
        if (install) install.addEventListener('click', () => desktop.installUpdate());
      } },

    { id: 'whats-new', group: 'help', kind: 'block', label: 'What changed', hint: 'The notes for the newest version of Sentinel.', words: ['changelog', 'release notes', 'new', 'version', 'about'], mount: whatsNewBlock },
    { id: 'false-alarm', group: 'help', kind: 'block', label: 'Report a false alarm', hint: 'Sentinel warned you about a site you know is safe. Tell us which one.', words: ['wrong', 'mistake', 'safe', 'false positive', 'report', 'feedback'], mount: falseAlarmBlock },
    { id: 'support', group: 'help', kind: 'custom', label: 'Write to us', hint: 'A question, a problem, or a scam Sentinel missed.', words: ['help', 'contact', 'support', 'email', 'privacy', 'terms'],
      body: () => '<p class="set-sub">How Sentinel treats your data, and the rules for using it: <a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms</a></p>',
      control: () => (state.config.supportEmail ? `<a class="btn btn--sm" href="mailto:${esc(state.config.supportEmail)}">Email support</a>` : '') }
  ];
  const settingWords = (r) => `${r.label} ${r.hint} ${(r.words || []).join(' ')} ${SETTING_GROUPS.find(([g]) => g === r.group)[1]}`.toLowerCase();
  const settingMatches = (r, q) => q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => settingWords(r).includes(w));

  function profileBlock(body) {
    const u = state.me.user;
    body.innerHTML = `<form data-name-form data-draft="profile">
        <div class="row2">
          <div class="field"><label for="p-first">First name</label><input class="input" id="p-first" name="firstName" value="${esc(u.firstName)}" required maxlength="60"></div>
          <div class="field"><label for="p-last">Last name <span class="opt">(optional)</span></label><input class="input" id="p-last" name="lastName" value="${esc(u.lastName || '')}" maxlength="60"></div>
        </div>
        <div class="field"><label for="p-email">Email ${u.emailVerified ? '<span class="status is-on u-ml">Confirmed</span>' : '<span class="status is-locked u-ml">Not confirmed</span>'}</label><input class="input" id="p-email" value="${esc(u.email)}" disabled></div>
        <button class="btn u-mt" type="submit">Save profile</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Saving', async () => {
        try {
          const data = await api('/account/name', { method: 'POST', body: { firstName: f.firstName.value, lastName: f.lastName.value } });
          state.me.user = data.user;
          paintAccount();
          toast('Profile saved.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function passwordBlock(body) {
    body.innerHTML = `<form data-pw-form>
        <div class="row2">
          <div class="field"><label for="pw-cur">Current password</label><input class="input" id="pw-cur" type="password" name="currentPassword" autocomplete="current-password" required></div>
          <div class="field"><label for="pw-new">New password</label><input class="input" id="pw-new" type="password" name="newPassword" autocomplete="new-password" required minlength="15"><span class="field__hint">At least 15 characters.</span></div>
        </div>
        <button class="btn u-mt" type="submit">Update password</button>
      </form>`;
    const pw = $('form', body);
    pw.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', pw), 'Updating', async () => {
        try {
          await api('/account/password', { method: 'POST', body: { currentPassword: pw.currentPassword.value, newPassword: pw.newPassword.value } });
          pw.reset();
          toast('Password updated. Other sessions were signed out.', 'success');
          const devices = $('[data-sessions]');
          if (devices) loadSessions(devices);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  // The file comes from the server, which lists each thing the Privacy Policy says an account holds (a test keeps
  // the two in step). It asks for the password again: a borrowed session must not be able to take it.
  function downloadBlock(body) {
    const u = state.me.user;
    body.innerHTML = `<form data-export>
        ${u.hasPassword ? '<div class="row2"><div class="field"><label for="ex-pw">Password</label><input class="input" id="ex-pw" type="password" name="password" autocomplete="current-password" required></div></div>' : ''}
        <button class="btn${u.hasPassword ? ' u-mt' : ''}" type="submit">Download my data</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Preparing', async () => {
        try {
          const data = await api('/account/export', { method: 'POST', body: { password: f.password ? f.password.value : '' } });
          const name = `sentinel-data-${data.exportedAt.slice(0, 10)}.json`;
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
          const a = Object.assign(document.createElement('a'), { href: url, download: name });
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          f.reset();
          toast(`Your data is ready as ${name}.`, 'success');
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  // Erasing what live scanning keeps. A second press within a few seconds erases, so one stray click never does.
  function forgetBlock(body, ctx) {
    const WHAT = {
      exposures: ['Forget visited sites', '/live/exposures/forget', (n) => (n ? `Forgot ${n} visited site${n === 1 ? '' : 's'}, and every alert found for them.` : 'Nothing was remembered. Every alert is cleared.')],
      'my-sites': ['Forget Your sites', '/my-sites/forget', (n) => (n ? `Forgot ${n} of Your sites.` : 'Your sites held nothing to forget.')]
    };
    body.innerHTML = `<div class="set-sub set-sub--start">${Object.entries(WHAT).map(([k, [label]]) => `<button class="btn btn--sm" type="button" data-forget="${k}">${label}</button>`).join('')}</div>`;
    $$('[data-forget]', body).forEach((b) => {
      const [label, path, said] = WHAT[b.dataset.forget];
      let armed = 0;
      b.addEventListener('click', () => {
        if (!armed) {
          b.textContent = 'Press again to erase';
          armed = setTimeout(() => { armed = 0; b.textContent = label; }, 4000);
          return;
        }
        clearTimeout(armed);
        armed = 0;
        busy(b, 'Erasing', async () => {
          try {
            const r = await api(path, { method: 'POST', body: {} });
            toast(said(r.forgotten), 'success');
            ctx.refresh();
          } catch (err) { toast(err.message, 'error'); }
        }).then(() => { b.textContent = label; });
      });
    });
  }

  // The newest version's notes, from web/assets/release-note.json, which npm run build:note writes from
  // changelog/<version>.md beside the download page's note.
  async function whatsNewBlock(body) {
    body.innerHTML = '<div class="skeleton u-h-md"></div>';
    try {
      const res = await fetch('/assets/release-note.json', { credentials: 'same-origin' });
      const note = res.ok ? await res.json() : null;
      if (!note || !note.version || !Array.isArray(note.groups)) throw new Error('no note');
      body.innerHTML = `<div class="set-note"><p><b>New in Sentinel ${esc(note.version)} ${esc(note.model || '')}.</b> ${esc(note.summary)}.</p>
        <details class="set-facts"><summary>Every change in this version</summary>${note.groups.map((g) => `<h3>${esc(g.title)}</h3><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}</details></div>`;
    } catch {
      body.innerHTML = '<p class="set-sub">The notes could not be loaded just now. They are also on the <a href="/download">download page</a>.</p>';
    }
  }

  // A false alarm is kept with the site for Sentinel to learn from. It never counts against the site, and on its own
  // it changes nobody's result: trusting the site is what stops the warning, for this account.
  function falseAlarmBlock(body) {
    body.innerHTML = `<form data-false-alarm data-draft="false-alarm">
        <div class="row2">
          <div class="field"><label for="fa-site">The site</label><input class="input" id="fa-site" name="url" required maxlength="2048" placeholder="mybakery.com" autocomplete="off" spellcheck="false"></div>
          <div class="field"><label for="fa-note">What it is <span class="opt">(optional)</span></label><input class="input" id="fa-note" name="note" maxlength="500" placeholder="My local bakery"></div>
        </div>
        <label class="consent__row u-mt"><input type="checkbox" name="trust"><span>Also trust this site for me, so its warning stops now</span></label>
        <button class="btn u-mt" type="submit">Send</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button[type=submit]', f), 'Sending', async () => {
        try {
          const r = await api('/report', { method: 'POST', body: { url: f.url.value, category: 'false_alarm', note: f.note.value } });
          if (f.trust.checked) await api('/sites/override', { method: 'POST', body: { url: f.url.value, action: 'allow' } });
          toast(f.trust.checked ? `Sent, and ${r.host} is trusted for you now.` : 'Sent, thank you. On its own a report changes no one’s result.', 'success');
          f.reset();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function deleteBlock(body) {
    const u = state.me.user;
    body.innerHTML = `<form data-delete>
        <div class="row2">
          ${u.hasPassword ? '<div class="field"><label for="del-pw">Password</label><input class="input" id="del-pw" type="password" name="password" autocomplete="current-password"></div>' : ''}
          <div class="field"><label for="del-confirm">Type DELETE to confirm</label><input class="input" id="del-confirm" name="confirm" autocomplete="off"></div>
        </div>
        <button class="btn btn--danger u-mt" type="submit">Delete my account</button>
      </form>`;
    $('form', body).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      await busy($('button', f), 'Deleting', async () => {
        try {
          await api('/account/delete', { method: 'POST', body: { password: f.password ? f.password.value : '', confirm: f.confirm.value } });
          location.href = '/';
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function sessionsHTML(sessions) {
    return `<div class="set-sub"><span class="muted">${sessions.length} active session${sessions.length === 1 ? '' : 's'}</span>${sessions.length > 1 ? '<button class="btn btn--sm" type="button" data-revoke>Sign out other devices</button>' : ''}</div>
        <ul class="list">${sessions.map((s) => `<li>
          <span class="list__icon">${s.kind === 'web' ? ICON.link : s.kind === 'desktop' ? ICON.download : ICON.shield}</span>
          <span class="list__main"><b>${esc(s.device)}${s.current ? ' <span class="status is-on u-ml">This device</span>' : ''}</b><span>${esc(s.kind === 'web' ? 'Browser' : s.kind === 'desktop' ? 'Sentinel app' : 'Browser companion')} &middot; ${s.ip ? esc(s.ip) + ' &middot; ' : ''}active ${ago(s.lastSeenAt || s.createdAt)} &middot; ${s.kind === 'web' ? (s.staySignedIn ? 'stays signed in, ends after 30 days unused' : 'ends when the browser closes') : 'ends after 90 days unused'}</span></span>
          ${s.current ? '<button class="btn btn--sm" type="button" data-signout-here>Sign out</button>' : `<button class="btn btn--sm" type="button" data-revoke-one="${esc(s.id)}">Sign out</button>`}
        </li>`).join('')}</ul>`;
  }

  async function loadSessions(slot) {
    // The first wait is this browser alone, as a new account sees it (the address and device name are stand-ins).
    if (!slot.innerHTML) slot.innerHTML = skel('devices', sessionsHTML([{ id: '', kind: 'web', device: 'Chrome on Windows', current: true, ip: '127.0.0.1', createdAt: Date.now() }]));
    try {
      const { sessions } = await api('/account/sessions');
      slot.innerHTML = sessionsHTML(sessions);
      $$('[data-revoke-one]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Signing out', async () => {
        try {
          await api('/account/sessions/revoke', { method: 'POST', body: { id: b.dataset.revokeOne } });
          toast('That device was signed out. The others were not touched.', 'success');
        } catch (err) { toast(err.message, 'error'); }
        loadSessions(slot);
      })));
      keep(slot, 'devices');
      // This device: the same as the account button, here too because a phone has no side bar.
      const here = $('[data-signout-here]', slot);
      if (here) here.addEventListener('click', () => busy(here, 'Signing out', () => signOut()));
      const revoke = $('[data-revoke]', slot);
      if (revoke) revoke.addEventListener('click', () => busy(revoke, 'Signing out', async () => {
        try {
          await api('/account/sessions/revoke-others', { method: 'POST', body: {} });
          toast('Other devices were signed out.', 'success');
          loadSessions(slot);
        } catch (err) { toast(err.message, 'error'); }
      }));
    } catch (err) { failed(slot, err, () => { slot.innerHTML = ''; loadSessions(slot); }, { small: true, what: 'Your signed-in devices' }); }
  }

  function settingsView(el) {
    el.innerHTML = `${title('Settings', 'Every choice Sentinel offers, in one place. A change is saved the moment you make it.')}
      <div class="set" data-desktop>
        <nav class="set-rail" aria-label="Settings groups">${SETTING_GROUPS.map(([g, name], i) => `<a href="#${g}" data-set-go="${g}"${i ? '' : ' aria-current="true"'}>${name}</a>`).join('')}</nav>
        <div class="set-main">
          <div class="set-find">${ICON.search}<input class="input" type="search" placeholder="Find a setting" aria-label="Find a setting" aria-describedby="set-count" autocomplete="off" spellcheck="false" data-set-find></div>
          <p class="sr-only" id="set-count" role="status" data-set-count></p>
          ${desktop ? '' : `<div class="set-app"><p><b>Most of these work through the Sentinel app for Windows.</b> Here they say so instead of switching. Your account, plan and look work everywhere.</p><a class="btn btn--gold btn--sm" href="/download">${ICON.download}Download Sentinel</a></div>`}
          ${SETTING_GROUPS.map(([g, name]) => `<section class="set-group" id="${g}" data-set-group="${g}" aria-labelledby="set-g-${g}"><div class="set-fold">
            <h2 class="set-group__title" id="set-g-${g}">${name}</h2>${SETTINGS.filter((r) => r.group === g).map(rowHTML).join('')}</div></section>`).join('')}
          <div class="set-none" data-set-none hidden><p>Nothing matches.</p><button class="btn btn--sm" type="button" data-set-clear>Clear search</button></div>
        </div>
      </div>`;
    const box = $('[data-desktop]', el);
    box._off = [];
    const ctx = { info: null, ready: !desktop, data: { mine: [] }, offs: box._off, draw, refresh };
    const rowOf = (id) => $(`[data-set-row="${id}"]`, el);

    function draw() {
      if (!el.isConnected) return;
      for (const r of SETTINGS) if (!r.app || ctx.ready) paintRow(r, rowOf(r.id), ctx);
    }
    async function refresh() {
      if (!desktop) return draw();
      let info = null;
      try { info = await desktop.info(); state.desktopInfo = info; } catch { /* each row says the app did not answer */ }
      try { if (info && desktop.mySites) ctx.data.mine = await desktop.mySites(); } catch { /* none */ }
      ctx.info = info;
      ctx.ready = true;
      draw();
    }

    /* Search: rows that do not match fold away (a height spring, no fade) and leave the tab order. */
    const find = $('[data-set-find]', el);
    const none = $('[data-set-none]', el);
    const count = $('[data-set-count]', el);
    function filter() {
      const q = find.value.trim();
      let shown = 0;
      for (const r of SETTINGS) {
        const ok = !q || settingMatches(r, q);
        const row = rowOf(r.id);
        row.classList.toggle('is-out', !ok);
        row.inert = !ok;
        if (ok) shown += 1;
      }
      for (const [g] of SETTING_GROUPS) {
        const any = SETTINGS.some((r) => r.group === g && (!q || settingMatches(r, q)));
        const group = $(`[data-set-group="${g}"]`, el);
        group.classList.toggle('is-out', !any);
        group.inert = !any;
      }
      none.hidden = shown > 0;
      count.textContent = !q ? '' : shown ? `${shown} setting${shown === 1 ? '' : 's'} shown` : 'Nothing matches.';
    }
    function goTo(id, found) {
      const target = id && (SETTINGS.some((r) => r.id === id) || SETTING_GROUPS.some(([g]) => g === id)) ? $(`#${id}`, el) : null;
      if (!target) return;   // an unknown or old address: the page as it is
      target.scrollIntoView({ block: 'start', behavior: glide() });
      if (!found || !target.matches('.set-row')) return;
      target.classList.remove('is-found');
      void target.offsetWidth;
      target.classList.add('is-found');
      clearTimeout(target._found);
      target._found = setTimeout(() => target.classList.remove('is-found'), 2600);
    }
    find.addEventListener('input', filter);
    find.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && find.value) { ev.preventDefault(); find.value = ''; filter(); }
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const first = SETTINGS.find((r) => settingMatches(r, find.value.trim()));
      if (first) goTo(first.id, true);
    });
    $('[data-set-clear]', el).addEventListener('click', () => { find.value = ''; filter(); find.focus(); });

    /* The group list: a link per group, the one in view marked. Jumping does not add a history entry per click. */
    const rail = $('.set-rail', el);
    rail.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-set-go]');
      if (!a) return;
      ev.preventDefault();
      history.replaceState(history.state, '', `#${a.dataset.setGo}`);
      goTo(a.dataset.setGo);
    });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) $$('[data-set-go]', rail).forEach((a) => (a.dataset.setGo === e.target.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
      }, { rootMargin: '-15% 0px -75% 0px' });
      $$('[data-set-group]', el).forEach((g) => io.observe(g));
      box._off.push(() => io.disconnect());
    }

    /* The app says when something changed (the tray menu, another window, a parent lock): the rows follow. */
    if (desktop) {
      for (const [name, key] of [['onChatSafety', 'chatSafety'], ['onTextSafety', 'textSafety'], ['onLive', 'live'], ['onCommand', 'commandHeld']]) {
        if (!desktop[name]) continue;
        const off = desktop[name]((v) => { if (ctx.info && v !== undefined) { ctx.info[key] = v; draw(); } });
        if (typeof off === 'function') box._off.push(off);
      }
      for (const name of ['onSettings', 'onUpdate', 'onDefense']) {
        if (!desktop[name]) continue;
        const off = desktop[name](() => refresh());
        if (typeof off === 'function') box._off.push(off);
      }
    }
    draw();
    // After the rows have their real size, so the row asked for lands where it should.
    const arrived = location.hash.slice(1);
    const settle = () => requestAnimationFrame(() => goTo(arrived, true));
    if (desktop) refresh().then(settle); else settle();
  }


  function render2fa(slot) {
    const on = state.me.user.twoFactorEnabled;
    slot.innerHTML = `<p class="panel-lede">${on ? 'On. Signing in needs a code from your authenticator app.' : 'Add a second step to sign-in with Google Authenticator, 1Password, Authy or any authenticator app.'}</p>
      <div data-2fa-body>${on
        ? '<form data-disable><div class="field"><label for="tfa-off">Enter a current code to turn it off</label><input class="input code-input" id="tfa-off" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>' + (state.me.user.hasPassword ? '<div class="field"><label for="tfa-off-pw">Your password</label><input class="input" id="tfa-off-pw" type="password" name="password" autocomplete="current-password" required></div>' : '') + '<button class="btn u-mt-sm" type="submit">Turn off two-factor</button></form>'
        : '<button class="btn btn--gold" data-setup>Set up two-factor</button>'}</div>`;

    const setup = $('[data-setup]', slot);
    if (setup) setup.addEventListener('click', () => busy(setup, 'Preparing', async () => {
      try {
        const { secret, uri } = await api('/account/2fa/setup', { method: 'POST', body: {} });
        $('[data-2fa-body]', slot).innerHTML = `
          <ol class="steps-list">
            <li>Open your authenticator app and add an account with this key${/Mobi/.test(navigator.userAgent) ? `, or <a href="${esc(uri)}" class="u-gold">tap here</a>` : ''}:</li>
          </ol>
          <div class="secret"><span>${esc(secret.match(/.{1,4}/g).join(' '))}</span><button class="btn btn--sm" type="button" data-copy>Copy</button></div>
          <form data-enable class="u-mt-sm"><div class="field"><label for="tfa-on">Then enter the 6-digit code it shows</label><input class="input code-input" id="tfa-on" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>
          ${state.me.user.hasPassword ? '<div class="field"><label for="tfa-pw">Your password</label><input class="input" id="tfa-pw" type="password" name="password" autocomplete="current-password" required><span class="field__hint">Turning this on signs out your other devices, so Sentinel checks that it is you.</span></div>' : ''}
          <button class="btn btn--gold u-mt-sm" type="submit">Turn on</button></form>`;
        $('[data-copy]', slot).addEventListener('click', async () => { await navigator.clipboard.writeText(secret); toast('Key copied.', 'success'); });
        $('[data-enable]', slot).addEventListener('submit', async (ev) => {
          ev.preventDefault();
          await busy($('button[type=submit]', ev.target), 'Checking', async () => {
            try {
              const data = await api('/account/2fa/enable', { method: 'POST', body: { code: ev.target.code.value, password: ev.target.password ? ev.target.password.value : '' } });
              state.me.user = data.user;
              toast('Two-factor authentication is on.', 'success');
              render2fa(slot);
            } catch (err) { toast(err.message, 'error'); }
          });
        });
      } catch (err) { toast(err.message, 'error'); }
    }));

    const disable = $('[data-disable]', slot);
    if (disable) disable.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy($('button', disable), 'Turning off', async () => {
        try {
          const data = await api('/account/2fa/disable', { method: 'POST', body: { code: disable.code.value, password: disable.password ? disable.password.value : '' } });
          state.me.user = data.user;
          toast('Two-factor authentication is off.', 'info');
          render2fa(slot);
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  Object.assign(window.SentinelApp.pages, { protectionView, settingsView, askChatSafety, askExposureAlerts, SETTINGS, settingMatches });
})();
