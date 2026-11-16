/* Sentinel web app: Site rules (/app/sites). app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { api, esc, $, $$, ago, toast, stateBlock, busy } = window.UI;
  const {
    ICON, failed, skel, keep, title
  } = window.SentinelApp;

  /* ========================================================== site rules */

  // One of the two lists, Trusted or Blocked; empty, it is also the first wait's shape (skel).
  const RULE_LISTS = { allow: ['Trusted', 'No trusted sites yet. Use "Trust this site" on any scan result, or add one above.'], block: ['Blocked', 'No blocked sites. Block a site to give it a red mask everywhere, for you.'] };
  function rulesHTML(overrides, action) {
    const [heading, empty] = RULE_LISTS[action];
    const rows = overrides.filter((o) => o.action === action);
    return `<div class="panel__head"><div><h2>${heading}</h2><p>${rows.length} site${rows.length === 1 ? '' : 's'}</p></div></div>
      ${rows.length ? `<ul class="list">${rows.map((o) => `<li>
        <span class="list__icon">${action === 'allow' ? ICON.check : ICON.lock}</span>
        <span class="list__main"><b class="mono">${esc(o.host)}</b><span>Added ${ago(o.created_at)}</span></span>
        <button class="btn btn--sm" data-remove="${esc(o.host)}">Remove</button>
      </li>`).join('')}</ul>` : stateBlock('waiting', empty, { small: true })}`;
  }

  async function sitesView(el) {
    el.innerHTML = `${title('Site rules', 'Sites you trust never show a mask for you. Sites you block always show a red one, in scans, search results and email.')}
      <form class="panel" data-add data-draft="site-rule">
        <div class="row2">
          <div class="field"><label for="site-host">Website</label><input class="input mono" id="site-host" name="host" placeholder="example.com" autocomplete="off" spellcheck="false" required></div>
          <div class="field"><label>Rule</label><div class="segmented" role="radiogroup" aria-label="Rule"><button type="button" role="radio" aria-checked="true" data-rule="allow">Trust</button><button type="button" role="radio" aria-checked="false" data-rule="block">Block</button></div></div>
        </div>
        <div class="report__foot"><span class="muted">Rules apply to the whole site, including its subdomains. Only your account is affected.</span><button class="btn btn--gold" type="submit">Add rule</button></div>
      </form>
      <div class="grid2 u-mt">
        <div class="panel" data-allow>${skel('allow', rulesHTML([], 'allow'))}</div>
        <div class="panel" data-block>${skel('block', rulesHTML([], 'block'))}</div>
      </div>`;

    let rule = 'allow';
    $$('[data-rule]', el).forEach((b) => b.addEventListener('click', () => {
      rule = b.dataset.rule;
      $$('[data-rule]', el).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));

    const load = async () => {
      let overrides = [];
      try { ({ overrides } = await api('/sites/overrides')); }
      catch (err) {
        // One answer for both lists, in the first: they come from the same place.
        $('[data-block]', el).hidden = true;
        failed($('[data-allow]', el), err, () => { $('[data-allow]', el).innerHTML = skel('allow', rulesHTML([], 'allow')); load(); }, { what: 'Your site rules' });
        return;
      }
      $('[data-block]', el).hidden = false;
      $('[data-allow]', el).innerHTML = rulesHTML(overrides, 'allow');
      $('[data-block]', el).innerHTML = rulesHTML(overrides, 'block');
      keep($('[data-allow]', el), 'allow');
      keep($('[data-block]', el), 'block');
      $$('[data-remove]', el).forEach((b) => b.addEventListener('click', () => busy(b, 'Removing', async () => {
        try {
          await api('/sites/override', { method: 'POST', body: { host: b.dataset.remove, action: 'clear' } });
          toast(`Rule removed for ${b.dataset.remove}.`, 'success');
          load();
        } catch (err) { toast(err.message, 'error'); }
      })));
    };

    $('[data-add]', el).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target;
      busy($('button[type=submit]', form), 'Adding', async () => {
        try {
          const r = await api('/sites/override', { method: 'POST', body: { host: form.host.value.trim(), action: rule } });
          toast(`${r.host} is now ${rule === 'allow' ? 'trusted' : 'blocked'}.`, 'success');
          form.reset();
          load();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    load();
  }

  Object.assign(window.SentinelApp.pages, { sitesView });
})();
