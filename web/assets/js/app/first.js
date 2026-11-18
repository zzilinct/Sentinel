/* Sentinel web app: the Overview's first-run choices, and the frame every Settings row is drawn in. A file of its own
   so a first visit's Overview waits for these few rows only, not for all of Settings; app/settings.js is loaded after
   it and draws the same rows (ROW) with the same frame (rowHTML, paintRow), so a choice made here is that choice there. */
(() => {
  'use strict';

  const { $, $$, esc, toast } = window.UI;
  const { desktop, state, still, desktopError, FIRST_KEY } = window.SentinelApp;

  const NEEDS_APP = 'Needs the Sentinel app for Windows.';
  /** Why a row that needs the Windows app cannot work here, or '' when it can. */
  function appWhy(info, method) {
    if (!desktop) return NEEDS_APP;
    if (!desktop[method]) return 'Needs a newer Sentinel app. It updates by itself.';
    if (!info) return 'The Sentinel app did not answer. Open this page again.';
    return '';
  }
  const liveOf = (info) => (info && info.live) || { supported: false, enabled: false };
  const onWindows = (ok) => (ok ? '' : 'Needs Windows.');
  /** One of three words saved through the app (Marks beside links, Pop-up warnings): `key` reads it, `said` and `state` per word. */
  const levelRow = (o) => ({ ...o, kind: 'custom', app: true,
    why: (i) => appWhy(i, o.method) || onWindows(liveOf(i).supported),
    state: (i) => o.state[i[o.key]] || '',
    control: (i) => seg(`set-${o.id}-l`, o.options, i[o.key]),
    bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', async () => {
      if (b.getAttribute('aria-pressed') === 'true') return;
      $$('[data-seg]', row).forEach((x) => { x.disabled = true; });
      try { toast(o.said[await desktop[o.method](b.dataset.seg)], 'success'); } catch (err) { toast(desktopError(err), 'error'); }
      ctx.refresh();
    })) });
  const seg = (labelId, options, current) => `<div class="seg" role="group" aria-labelledby="${labelId}">${options.map(([v, name, off]) => `<button type="button" class="seg__btn${v === current ? ' is-on' : ''}" data-seg="${v}" aria-pressed="${v === current}" ${off ? 'disabled' : ''}>${name}</button>`).join('')}</div>`;

  const ROW = Object.fromEntries([
    // The look (look.js): its picker draws both rows, Theme as its radio well and Colour as its coins.
    { id: 'theme', group: 'look', kind: 'block', label: 'Theme', hint: 'Auto follows your computer. Light or Dark stays as you choose it.',
      words: ['dark', 'light', 'mode', 'night', 'appearance'],
      mount: (body) => { if (window.SentinelLook && SentinelLook.picker) body.appendChild(SentinelLook.picker({ only: 'mode' })); } },
    { id: 'accent', group: 'look', kind: 'block', label: 'Colour',
      hint: desktop ? 'One colour for this app, live scanning, its warnings, the mask in the corner, the tray icon and the companion in your browser.' : 'One colour for the whole app. In the Sentinel app for Windows it also colours live scanning and its warnings.',
      words: ['colour', 'color', 'accent', 'gold', 'rose', 'amethyst', 'sapphire', 'teal', 'platinum', 'appearance'],
      mount: (body) => { if (window.SentinelLook && SentinelLook.picker) body.appendChild(SentinelLook.picker({ only: 'accent' })); } },
    { id: 'text-size', group: 'look', kind: 'custom', label: 'Text size', hint: 'Larger words in the app, on the website, in Sentinel\'s warnings and in the browser companion. Signed in, your other devices follow. Headings stay as they are.',
      words: ['font', 'bigger', 'larger', 'read', 'reading', 'eyes', 'zoom', 'small', 'accessibility'],
      control: () => seg('set-text-size-l', [['standard', 'Standard'], ['large', 'Large'], ['larger', 'Larger']], window.SentinelType ? window.SentinelType.get().text : 'standard'),
      bind: (row, info, ctx) => $$('[data-seg]', row).forEach((b) => b.addEventListener('click', () => { if (window.SentinelLook && SentinelLook.set) SentinelLook.set({ text: b.dataset.seg }); ctx.draw(); })) },

    // Motion (boot.js SentinelMotionLevel): its own control, Animation (Full, Calm, Off) and the Scan effect switch. The
    // row's heading names the choices, for a screen reader too.
    { id: 'motion', group: 'moving', kind: 'block', label: 'Animation', hint: `How much Sentinel moves on this ${desktop ? 'computer, here and over your browser' : 'device'}. Off whenever your computer asks for less motion.`,
      words: ['animation', 'animations', 'motion', 'reduce', 'still', 'calm', 'effects', 'moving', 'scan effect', 'digits', 'glitch', 'binary'],
      mount: (body) => { if (window.SentinelMotionLevel) body.append(window.SentinelMotionLevel.control({ labelledBy: 'set-motion-l' })); } },

    levelRow({ id: 'warn-level', group: 'alerts', label: 'Pop-up warnings', method: 'setWarningsLevel', key: 'warningsLevel',
      hint: 'When a page you open looks like a warning or a danger, Sentinel tells you with a notification and a small card in the corner. Whatever you choose, the page is still marked in the corner, and Sentinel still asks before you pay with gift cards or crypto, or after you typed a password on it.',
      words: ['notifications', 'notification', 'alerts', 'loud', 'quiet', 'popup', 'pop up', 'card', 'interrupt', 'warn'],
      options: [['all', 'Always'], ['danger', 'Danger only'], ['quiet', 'Never']],
      said: { all: 'Sentinel warns you about warning and danger pages.', danger: 'Sentinel warns you only about danger pages.', quiet: 'No more pop-up warnings. Flagged pages are still marked in the corner.' },
      state: { all: 'A notification and a card for every warning or danger page.', danger: 'A warning page is marked in the corner, without a notification or a card.', quiet: 'Nothing pops up. A flagged page is marked in the corner only, so look there before you sign in or pay.' } }),
  ].map((r) => [r.id, r]));

  /*
   * The first-run step: once on this device, the first time home opens, a few of Settings' own rows in one calm panel,
   * so the main choices are made in the first minute. It is a view of Settings, not a copy: each row is drawn and saved
   * by its Settings row (ROW), so a choice made here works at once and is the same choice there. Each slot below takes the
   * first of its ids that has a row; a row that cannot work here (its why) is left out. Hooks for rows built elsewhere:
   *   'accent'      the accent colours (work/e2e-c-design); 'theme' (light or dark) stands in until it lands
   *   'motion'      Full, Calm or Off (work/e2e-c-motion)
   *   'warn-level'  how loud Sentinel is (work/e2e-c-quiet)
   * Done, or Escape, keeps what is chosen, and the step never comes back. Storage that cannot be used: never shown.
   */
  const FIRST_CHOICES = [['accent', 'theme'], ['motion'], ['warn-level'], ['text-size']];
  function firstChoices(slot) {
    try { if (localStorage.getItem(FIRST_KEY)) return false; } catch { return false; }
    const rows = FIRST_CHOICES.map((ids) => ids.map((id) => ROW[id]).find(Boolean)).filter(Boolean);
    if (!rows.length) return false;
    slot.innerHTML = `<section class="first" aria-labelledby="first-h"><div class="first__fold"><div class="first__in">
      <h2 id="first-h">Make Sentinel yours</h2>
      <p class="first__lead">Each choice works the moment you make it, and every one of them is in Settings too.</p>
      <div class="first__rows">${rows.map(rowHTML).join('')}</div>
      <div class="first__end">${desktop ? '<p>Closing this window leaves Sentinel running in the tray. Right-click the mask there to quit.</p>' : ''}
        <a class="btn btn--ghost" href="/app/settings#look">All settings</a><button class="btn btn--gold" type="button" data-first-done>Done</button></div>
    </div></div></section>`;
    const box = $('.first', slot);
    const ctx = { info: state.desktopInfo, ready: !desktop || Boolean(state.desktopInfo), data: { mine: [] }, offs: [], draw, refresh };
    function draw() {
      if (!box.isConnected) return;
      for (const r of rows) {
        const row = $(`[data-set-row="${r.id}"]`, box);
        if (r.app && !ctx.ready) continue;
        row.hidden = Boolean(r.why && r.why(ctx.info));
        if (!row.hidden) paintRow(r, row, ctx);
      }
    }
    async function refresh() {
      if (desktop) { try { ctx.info = state.desktopInfo = await desktop.info(); } catch { /* an app row says the app did not answer */ } ctx.ready = true; }
      draw();
    }
    if (rows.some((r) => r.app) && !ctx.ready) refresh(); else draw();

    // Done folds the panel away (a height spring, as a Settings row leaves a search); with motion off it simply goes.
    const done = () => {
      try { localStorage.setItem(FIRST_KEY, '1'); } catch { /* asked again next time: nothing lost */ }
      const back = box.contains(document.activeElement);
      const gone = () => { slot.innerHTML = ''; if (back) { const q = $('[data-quick] input'); if (q) q.focus({ preventScroll: true }); } };
      if (still()) { gone(); return; }
      box.addEventListener('transitionend', (ev) => { if (ev.target === box) gone(); });
      setTimeout(gone, 800);   // a transition that never ends (a hidden tab) still leaves
      box.classList.add('is-out');
      box.inert = true;
    };
    $('[data-first-done]', box).addEventListener('click', done);
    box.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); done(); } });
    return true;
  }

  /** Saves one switch row. The app's answer (active or enabled) is believed over the switch; a failure puts it back. */
  async function saveSwitch(r, row, input, ctx) {
    const wanted = input.checked;
    input.disabled = true;
    try {
      const res = await (r.save ? r.save(input, row) : desktop[r.method](wanted));
      const now = res && typeof res.active === 'boolean' ? res.active : res && typeof res.enabled === 'boolean' ? res.enabled : wanted;
      input.checked = now;
      if (r.saved) r.saved(now, res);
      toast(r.said(now, res), now === wanted ? 'success' : 'info');
    } catch (err) { input.checked = !wanted; toast(desktopError(err), 'error'); }
    input.disabled = false;
    ctx.refresh();
  }

  /** One row's frame: its name, hint, state line, control and body. Settings draws every row; the first-run step a few. */
  function rowHTML(r) {
    const label = r.kind === 'switch' ? `<label class="set-row__label" id="set-${r.id}-l" for="set-${r.id}-c">${esc(r.label)}</label>` : `<h3 class="set-row__label" id="set-${r.id}-l">${esc(r.label)}</h3>`;
    return `<div class="set-row" id="${r.id}" data-set-row="${r.id}"><div class="set-fold">
      <div class="set-row__head"><div class="set-row__text">${label}<p class="set-row__hint" id="set-${r.id}-hint">${esc(r.hint)}</p><p class="set-row__state" data-set-state${r.seen ? ` data-${r.seen} role="status"` : ""}></p></div>
        <div class="set-row__control" data-set-control>${r.app && desktop ? '<span class="skeleton set-skel" aria-hidden="true"></span>' : ''}</div></div>
      <div class="set-row__body" data-set-body></div></div></div>`;
  }

  /* A row's control, state line and body, redrawn only when what they say changes, so focus stays put. */
  function paintRow(r, row, ctx) {
    const info = ctx.info;
    const why = r.why ? r.why(info) : '';
    const stateHTML = why ? `<span class="set-why">${esc(why)}</span>` : r.state ? esc(r.state(info) || '') : '';
    if (r.kind === 'block') {
      $('[data-set-state]', row).innerHTML = stateHTML;
      $('[data-set-control]', row).innerHTML = '';
      if (!why && !row._mounted) { row._mounted = true; r.mount($('[data-set-body]', row), ctx); }
      return;
    }
    const control = r.kind === 'switch'
      ? `<input class="switch" type="checkbox" id="set-${r.id}-c"${r.hook ? ` data-${r.hook}` : ""} aria-describedby="set-${r.id}-hint" ${!why && r.on(info) ? 'checked' : ''} ${why ? 'disabled' : ''}>`
      : why ? '' : r.control(info);
    const body = why || !r.body ? '' : r.body(info, ctx.data);
    const key = `${control}|${stateHTML}|${body}`;
    if (row._key === key) return;
    row._key = key;
    const focused = row.contains(document.activeElement) ? document.activeElement : null;
    const again = focused && (focused.id ? `#${focused.id}` : focused.dataset.seg ? `[data-seg="${focused.dataset.seg}"]` : null);
    const was = $('.seg__btn.is-on', row);
    const from = was && was.getBoundingClientRect();
    $('[data-set-control]', row).innerHTML = control;
    if (from && window.SentinelMotionLevel) window.SentinelMotionLevel.glide($('.seg', row), from);
    const line = $('[data-set-state]', row);
    line.innerHTML = stateHTML;
    line.classList.toggle('is-down', Boolean(!why && r.down && r.down(info)));
    $('[data-set-body]', row).innerHTML = body;
    if (!why) {
      const input = r.kind === 'switch' ? $('.switch', row) : null;
      if (input) input.addEventListener('change', () => saveSwitch(r, row, input, ctx));
      if (r.bind) r.bind(row, info, ctx);
    }
    if (focused) { const back = (again && $(again, row)) || $('button, input, select, a', row); if (back) back.focus({ preventScroll: true }); }
  }

  window.SentinelApp.first = { appWhy, liveOf, onWindows, levelRow, seg, ROW, rowHTML, paintRow };
  Object.assign(window.SentinelApp.pages, { firstChoices });
})();
