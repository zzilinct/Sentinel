/* Sentinel web app: Plan & usage (/app/plan). app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { api, esc, $, $$, until, toast, busy } = window.UI;
  const {
    state, ICON, plan, usage, left, paintAccount, render, title, liveCard, scanCards, usageCard, modelSlot,
    guardiansHTML, mountModels, fetchOnce
  } = window.SentinelApp;

  /* ================================================================ plan */

  /** The plan comparison is only on this page, so only this page loads it. */
  const planbook = () => fetchOnce('/assets/js/planbook.js');

  async function planView(el) {
    const us = usage();
    const { billingMode } = state.config;
    const demo = billingMode === 'demo';
    el.innerHTML = `
      ${title('Plan &amp; usage', `You are on <b>${esc(plan().name)}</b>. Weekly allowances reset ${until(state.me.week.resetsAt)}.`)}
      ${demo ? '<div class="banner"><div><b>Demo billing.</b> Plan changes are instant and free on this server. No payment is taken.</div></div>' : ''}
      <div class="usage-list">
        ${scanCards(us)}
        ${usageCard(ICON.shield, left('fileScans'), `/ ${us.fileScans.limit}`, 'Virus & malware scans left', us.fileScans.used, us.fileScans.limit)}
        ${liveCard(us, plan().features)}
      </div>
      <div class="u-mt-lg">${modelSlot(false)}</div>
      <div class="panel u-mt"><h2>The models</h2><p class="muted u-mt-xs">Every major version of Sentinel is a model, named for a guardian from myth. Turn one over to read about it.</p><div class="u-mt">${guardiansHTML()}</div></div>
      <div class="u-mt-lg" data-ledger></div>`;

    mountModels(el);
    const slot = $('[data-ledger]', el);
    try {
      await planbook();
    } catch {
      slot.innerHTML = '<p class="muted">The plans could not load just now. <a href="/pricing">See them on the website</a>.</p>';
      return;
    }
    slot.innerHTML = window.SentinelPlanbook.ledger(state.plans, { billingMode, current: plan() });
    $$('button[data-plan]', slot).forEach((b) => b.addEventListener('click', () => busy(b, 'Updating', async () => {
      try {
        const data = await api('/billing/plan', { method: 'POST', body: { plan: b.dataset.plan } });
        state.me = { ...state.me, user: data.user, plan: data.plan, usage: data.usage, week: data.week };
        paintAccount();
        toast(`You are now on ${data.plan.name}.`, 'success');
        render();
      } catch (err) { toast(err.message, 'info', 6000); }
    })));
  }

  Object.assign(window.SentinelApp.pages, { planView });
})();
