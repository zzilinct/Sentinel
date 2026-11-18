/* Sentinel web app: History (/app/history). app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { api, esc, $, $$, toast, stateBlock, busy, status } = window.UI;
  const {
    Masks, navigate, failed, skel, keep, title, historyList
  } = window.SentinelApp;

  /* ============================================================ history */

  // The three counts above History, and the list's frame: drawn for real and, empty, as the first wait (skel).
  const statsHTML = (s) => [['scam', s.scams, 'Scams caught', 'red'], ['virus', s.viruses, 'Viruses caught', 'orange'], ['malware', s.malware, 'Malware caught', 'yellow']]
    .map(([glyph, n, label, badge]) => `<button type="button" class="usage-row" data-stat="${glyph}" aria-pressed="false"><span class="usage-row__icon" ${status(badge)}>${Masks.svg(glyph)}</span><span class="usage-row__l">${label}</span><b class="usage-row__n tabular">${n}</b></button>`).join('');
  const HISTORY_FILTERS = [['all', 'All'], ['flagged', 'Flagged'], ['clear', 'Clear'], ['scam', 'Scam'], ['virus', 'Virus'], ['malware', 'Malware'], ['live', 'Live'], ['manual', 'Manual']];
  const NO_SCANS = () => stateBlock('waiting', 'No scans yet. What you check shows here for 30 days, so you can look again.', { action: '<a class="btn btn--sm btn--gold" href="/app/check">Check something</a>' });
  const historyFrame = (s, any, filter, rows = '') => `<div class="panel__head"><div><h2 data-total>${s.total} scan${s.total === 1 ? '' : 's'}</h2><p>${s.flagged} flagged</p></div>
        <span class="tools__end"><button type="button" class="btn btn--sm btn--ghost" data-history-clear ${any ? '' : 'hidden'}>Clear history</button>
        <label class="tools__search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search history" aria-label="Search history" data-q></label></span></div>
      <div class="tools" data-filters data-full>${HISTORY_FILTERS.map(([id, label]) => `<button type="button" class="fchip" data-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join('')}<span class="mono muted" data-count>${rows ? '0 of 0' : ''}</span></div>
      <div data-rows>${rows}</div>`;

  async function historyView(el, params) {
    const zero = { total: 0, flagged: 0, scams: 0, viruses: 0, malware: 0 };
    el.innerHTML = `${title('History', 'Everything Sentinel checked for you in the last 30 days. Click a link to scan it again.')}
      <div class="usage-list" data-stats>${skel('stats', `<div class="usage-list">${statsHTML(zero)}</div>`)}</div>
      <div class="panel u-mt" data-list>${skel('history', historyFrame(zero, false, params.get('filter') || 'all', NO_SCANS()))}</div>`;
    let data;
    try { data = await api('/account/history'); }
    catch (err) { $('[data-stats]', el).innerHTML = ''; failed($('[data-list]', el), err, () => historyView(el, params), { what: 'Your history' }); return; }

    const s = data.stats;
    $('[data-stats]', el).innerHTML = statsHTML(s);

    const flaggedLevel = (lvl) => ['suspicious', 'likely', 'confirmed'].includes(lvl);
    const hs = { filter: params.get('filter') || 'all', q: '' };
    const list = $('[data-list]', el);
    list.innerHTML = historyFrame(s, data.items.length > 0, hs.filter);

    const paint = () => {
      const q = hs.q.toLowerCase();
      const items = data.items.filter((it) => {
        const flagged = flaggedLevel(it.scam) || flaggedLevel(it.virus) || flaggedLevel(it.malware);
        const f = hs.filter;
        const okFilter = f === 'all' || (f === 'flagged' && flagged) || (f === 'clear' && !flagged) || (['scam', 'virus', 'malware'].includes(f) && flaggedLevel(it[f])) || (f === 'live' && it.mode === 'live') || (f === 'manual' && it.mode !== 'live');
        return okFilter && (!q || it.target.toLowerCase().includes(q));
      });
      $('[data-count]', list).textContent = `${items.length} of ${data.items.length}`;
      $('[data-rows]', list).innerHTML = items.length ? historyList(items, { clickable: true })
        : data.items.length
          ? stateBlock('nomatch', hs.q ? `Nothing in your history matches &ldquo;${esc(hs.q)}&rdquo;${hs.filter === 'all' ? '' : ' with that filter'}.` : 'Nothing in your history matches that filter.', { action: '<button type="button" class="btn btn--sm" data-show-all>Show every scan</button>' })
          : NO_SCANS();
      $$('[data-filter]', list).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === hs.filter)));
      $$('[data-stat]', el).forEach((b) => {
        b.classList.toggle('is-active', b.dataset.stat === hs.filter);
        b.setAttribute('aria-pressed', String(b.dataset.stat === hs.filter));
      });
    };
    $$('[data-filter]', list).forEach((b) => b.addEventListener('click', () => { hs.filter = b.dataset.filter; paint(); }));
    $$('[data-stat]', el).forEach((b) => b.addEventListener('click', () => { hs.filter = hs.filter === b.dataset.stat ? 'all' : b.dataset.stat; paint(); }));
    $('[data-q]', list).addEventListener('input', (ev) => { hs.q = ev.target.value.trim(); paint(); });
    const forget = (body) => api('/account/history/delete', { method: 'POST', body });
    // After a delete the numbers are counted again from what is left.
    const recount = () => {
      const n = (f) => data.items.filter(f).length;
      const counts = { scam: n((it) => flaggedLevel(it.scam)), virus: n((it) => flaggedLevel(it.virus)), malware: n((it) => flaggedLevel(it.malware)) };
      $$('[data-stat]', el).forEach((b) => { $('.usage-row__n', b).textContent = counts[b.dataset.stat]; });
      $('[data-total]', list).textContent = `${data.items.length} scan${data.items.length === 1 ? '' : 's'}`;
      $('[data-total] + p', list).textContent = `${n((it) => flaggedLevel(it.scam) || flaggedLevel(it.virus) || flaggedLevel(it.malware))} flagged`;
      $('[data-history-clear]', list).hidden = !data.items.length;
    };
    list.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-show-all]')) {
        hs.filter = 'all'; hs.q = '';
        $('[data-q]', list).value = '';
        paint();
        $('[data-q]', list).focus();
        return;
      }
      const del = ev.target.closest('[data-forget]');
      if (del) {
        busy(del, '', async () => {
          try {
            const id = Number(del.dataset.forget);
            const gone = data.items.find((it) => it.id === id);
            await forget({ id });
            data.items = data.items.filter((it) => it.id !== id);
            recount();
            // The focus goes on to the next entry's Delete (or the search box), not back to the top of the page.
            const next = del.closest('li').nextElementSibling || del.closest('li').previousElementSibling;
            const nextId = next && $('[data-forget]', next) ? next.querySelector('[data-forget]').dataset.forget : null;
            paint();
            const to = nextId && $(`[data-forget="${nextId}"]`, list);
            (to || $('[data-q]', list)).focus();
            toast(`Deleted ${gone ? gone.target : 'that entry'} from your history.`, 'success');
          } catch (err) { toast(err.message, 'error'); }
        });
        return;
      }
      // The address is a link of its own (the app's link handler opens it); the rest of the row does the same.
      if (ev.target.closest('a')) return;
      const row = ev.target.closest('[data-rescan]');
      if (row) navigate(`/app/check?url=${encodeURIComponent(row.dataset.rescan)}`);
    });
    // Clearing everything asks first: one press says what a second press does.
    let clearArmed = 0;
    const clear = $('[data-history-clear]', list);
    clear.addEventListener('click', () => {
      if (Date.now() - clearArmed > 4000) {
        clearArmed = Date.now();
        clear.textContent = 'Press again to delete all';
        setTimeout(() => { if (Date.now() - clearArmed >= 3900) clear.textContent = 'Clear history'; }, 4000);
        return;
      }
      busy(clear, 'Clearing', async () => {
        try {
          await forget({ all: true });
          data.items = [];
          recount();
          paint();
          $('[data-q]', list).focus();
          toast('Your history is cleared.', 'success');
        } catch (err) { toast(err.message, 'error'); }
      }).then(() => { clear.textContent = 'Clear history'; });
    });
    paint();
    keep($('[data-stats]', el), 'stats');
    keep(list, 'history');
  }

  Object.assign(window.SentinelApp.pages, { historyView });
})();
