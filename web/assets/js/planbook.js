/**
 * The plans, said once. The site's pricing section, the home page's and the signed-in Plan page are all this one
 * comparison, built from server/lib/plans.js publicPlans(): on the server and in the static build it is written into
 * the page (no request, nothing to wait for, works without scripts); in the app, from the plans the app already has.
 * No allowance is typed here. billingMode says whether a plan can be taken today: 'demo' is the Windows app's own
 * server, where switching is free; anything else sells nothing.
 */
(function (root) {
  'use strict';

  const amount = (n) => (n === null ? 'Unlimited' : n === 0 ? 'No' : n.toLocaleString('en-US'));
  const time = (min) => (min === null ? 'Unlimited' : min === 0 ? 'No' : min < 60 ? `${min} minutes` : `${min / 60} hours`);
  const yes = (on) => (on ? 'Yes' : 'No');

  /** Pro on the newest models keeps at least this share of each allowance. */
  const newestShare = (p) => Math.round(100 * Math.min(...Object.keys(p.newestModelLimits)
    .filter((k) => p.limits[k]).map((k) => p.newestModelLimits[k] / p.limits[k])));

  function modelCell(p) {
    if (p.modelRule && p.modelRule.olderThan) return `Older than the newest ${p.modelRule.olderThan}`;
    if (p.newestModelLimits) return `${newestShare(p)}% on the newest ${p.modelRule.limitedOn}`;
    return 'All, in full';
  }

  const MASKS = ['scam', 'virus', 'malware'];
  const maskUse = (name) => `<svg aria-hidden="true" focusable="false"><use href="#ledger-${name}"/></svg>`;
  function masksCell(p) {
    return p.features.virusMalwareOnLinks
      ? `<span class="ledger__masks">${MASKS.map(maskUse).join('')}</span><span class="sr-only">Scam, virus and malware</span>`
      : `<span class="ledger__masks">${maskUse('scam')}</span><span class="sr-only">Scam only</span>`;
  }

  // The two things a first-time visitor asks, and everything that answers them, once each.
  const GROUPS = [
    { ask: 'How much can I check?', hint: 'Each week, whenever you are unsure.', rows: [
      ['Fast link scans', 'Threat lists, the full checklist, known scams', (p) => amount(p.limits.linkScans)],
      ['Delicate link scans', 'The site is researched as well', (p) => amount(p.limits.deepScans)],
      ['Virus and malware scans', 'Links and files', (p) => amount(p.limits.fileScans)],
      ['Whole emails pasted in', '', (p) => yes(p.features.emailManual)]
    ] },
    { ask: 'Does it watch while I browse?', hint: 'Yes, on every plan, for the time shown each week.', rows: [
      ['Fast live scanning', 'Results in about a second', (p) => time(p.limits.fastMinutes)],
      ['Delicate live scanning', 'Every result researched, about five seconds', (p) => time(p.limits.liveMinutes)],
      ['Masks on links', '', masksCell],
      ['Marks in Gmail and Outlook', 'Windows app, or the browser add-on', (p) => yes(p.features.emailLive)],
      ['Download protection', 'In the Sentinel app', (p) => yes(p.features.liveScanning)]
    ] },
    { ask: 'Which models can it run?', hint: 'Each big release of Sentinel is a model. This only applies in the app.', rows: [
      ['Newest models', '', modelCell]
    ] }
  ];

  const cell = (p, inner) => `<td role="cell" data-col="${p.id}"${inner === 'No' ? ' class="is-no"' : inner === 'Yes' ? ' class="is-yes"' : ''}>${inner}</td>`;

  function takeCell(p, { billingMode, current }) {
    const demo = billingMode === 'demo';
    if (current) {
      if (p.id === current.id) return '<b class="ledger__mine">Your plan</b>';
      if (demo) return `<button class="btn btn--sm" type="button" data-plan="${p.id}">${p.price < current.price ? 'Switch' : 'Upgrade'}</button>`;
      return p.price ? 'Not on sale yet' : 'Always free';
    }
    if (!p.price) return '<a class="btn btn--gold btn--sm" href="/signup">Start free</a>';
    return demo ? `<a class="btn btn--sm" href="/signup?plan=${p.id}">Try ${p.name}</a>` : 'Not on sale yet';
  }

  function table(plans, opts) {
    const head = plans.map((p) => `<th role="columnheader" scope="col" data-col="${p.id}"><span class="ledger__name">${p.name}</span>
      <span class="ledger__price"><b>$${p.price}</b>${p.price ? ' a month' : ' no card'}</span></th>`).join('');
    const row = ([label, hint, value]) => `<tr role="row"><th role="rowheader" scope="row">${label}${hint ? `<small>${hint}</small>` : ''}</th>${plans.map((p) => cell(p, value(p))).join('')}</tr>`;
    return `<table class="ledger__table" role="table" aria-label="What each plan includes">
      <thead role="rowgroup"><tr role="row"><td role="cell"></td>${head}</tr></thead>
      <tbody role="rowgroup">
        <tr role="row" class="ledger__take"><th role="rowheader" scope="row">Can I have it today?</th>${plans.map((p) => cell(p, takeCell(p, opts))).join('')}</tr>
        ${GROUPS.map((g) => `<tr role="row" class="ledger__ask"><th role="columnheader" scope="colgroup" colspan="5">${g.ask}<small>${g.hint}</small></th></tr>
        ${g.rows.map(row).join('')}`).join('')}
      </tbody>
    </table>`;
  }

  /** The figures the plan finder reasons with, and what it may say about each plan. */
  function finderPlans(plans, billingMode) {
    return plans.map((p) => ({
      id: p.id,
      name: p.name,
      fast: p.limits.fastMinutes,
      email: p.features.emailManual,
      sale: billingMode === 'demo',
      says: p.price
        ? `${time(p.limits.fastMinutes)} of fast and ${time(p.limits.liveMinutes)} of delicate live scanning a week.`
        : `${amount(p.limits.linkScans)} link scans and ${amount(p.limits.fileScans)} virus and malware scans a week, and ${time(p.limits.fastMinutes)} of live scanning.`
    }));
  }

  const FINDER = (plans, billingMode) => `<div class="finder" data-finder data-plans="${JSON.stringify(finderPlans(plans, billingMode)).replace(/"/g, '&quot;')}">
    <div class="finder__q">
      <span class="finder__label">Should it watch while you browse?</span>
      <div class="seg-toggle" role="radiogroup" aria-label="Should it watch while you browse?">
        <button type="button" role="radio" aria-checked="true" data-f-live="no">Only when I ask</button>
        <button type="button" role="radio" aria-checked="false" data-f-live="yes">Yes, watch</button>
      </div>
    </div>
    <div class="finder__q" data-f-hours-row>
      <span class="finder__label">Time online each week <b class="mono" data-f-hours-out>20 h</b></span>
      <input class="range" type="range" min="1" max="168" value="20" step="1" data-f-hours aria-label="Hours online each week">
    </div>
    <div class="finder__q">
      <span class="finder__label">Paste whole emails in to check them?</span>
      <div class="seg-toggle" role="radiogroup" aria-label="Paste whole emails in to check them?">
        <button type="button" role="radio" aria-checked="true" data-f-email="no">No</button>
        <button type="button" role="radio" aria-checked="false" data-f-email="yes">Yes</button>
      </div>
    </div>
    <p class="finder__answer" data-f-answer aria-live="polite"></p>
  </div>`;

  const ALWAYS = 'Every plan has the known-threat lookup, the full checklist, comparison with known scams, text scans (a pasted text or phone screenshot, one fast link scan each), two-factor sign-in and device management.';
  const WEEK = 'Allowances reset every Monday at 00:00 UTC. Live time counts only minutes in which Sentinel actually checks something, and only while a browser is in front of you: not when it is minimised, in the background, or you have stepped away.';
  const NOT_SOLD = 'Paid plans are not on sale yet, and nobody is charged. While Sentinel is pre-launch, the <a href="/download">Windows app</a> lets you switch between plans for free. Before any plan is sold, its price, billing period, how to cancel and the refund terms will be shown before you pay. See the <a href="/refunds">Refund Policy</a>.';
  const FREE_HERE = 'Switching plans is free on this copy of Sentinel, and no payment is taken. See the <a href="/refunds">Refund Policy</a>.';

  /** The comparison. `current` is the signed-in person's plan; the public page has none, and has the finder instead. */
  function ledger(plans, { billingMode, current } = {}) {
    const M = root.SentinelMasks || (require('./masks.js'), root.SentinelMasks);
    const pick = current ? plans.findIndex((p) => p.id === current.id) : 0;
    return `<div class="ledger" data-pricing data-pick="${plans[pick].id}" style="--pick:${pick}">
      <svg class="ledger__defs" aria-hidden="true">${MASKS.map((m) => `<symbol id="ledger-${m}" viewBox="0 0 64 64">${M.GLYPHS[m]}</symbol>`).join('')}</svg>
      ${current ? '' : FINDER(plans, billingMode)}
      <div class="ledger__sheet">
        <span class="ledger__lens" aria-hidden="true"><svg class="ledger__crest"><use href="#ledger-scam"/></svg></span>
        ${table(plans, { billingMode, current })}
      </div>
      <div class="pricing__note"><p>${ALWAYS}</p><p>${WEEK}</p>${current ? '' : `<p>${billingMode === 'demo' ? FREE_HERE : NOT_SOLD}</p>`}</div>
    </div>`;
  }

  /** The sentence under the headings: what Free really gives, from the same figures. */
  function lead(plans) {
    const f = plans[0];
    return `Sentinel Free gives you ${amount(f.limits.linkScans)} link scans and ${amount(f.limits.fileScans)} virus and malware scans a week, and watches for ${time(f.limits.fastMinutes)} a week while you browse. No card.`;
  }

  /** `<!-- @include pricing -->` and `<!-- @include pricing-lead -->`, for the server and the static build. */
  function include(name, plans, billingMode) {
    if (name === 'pricing') return ledger(plans, { billingMode });
    if (name === 'pricing-lead') return lead(plans);
    return undefined;
  }

  const api = { ledger, lead, include, finderPlans };
  root.SentinelPlanbook = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
