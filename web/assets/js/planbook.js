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
    if (p.modelRule && p.modelRule.olderThan) return `Not the newest ${p.modelRule.olderThan}`;
    if (p.newestModelLimits) return `${newestShare(p)}% of these limits on the newest ${p.modelRule.limitedOn}`;
    return 'All, in full';
  }

  const MASKS = ['scam', 'virus', 'malware'];
  const maskUse = (name) => `<svg aria-hidden="true" focusable="false"><use href="#ledger-${name}"/></svg>`;
  function masksCell(p) {
    return p.features.virusMalwareOnLinks
      ? `<span class="ledger__masks" role="img" aria-label="Scam, virus and malware">${MASKS.map(maskUse).join('')}</span>`
      : `<span class="ledger__masks" role="img" aria-label="Scam only">${maskUse('scam')}</span>`;
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
    { ask: 'Which version can it run?', hint: 'Only in the Windows app, where you choose the version of Sentinel.', rows: [
      ['Newest versions', '', modelCell]
    ] }
  ];

  const cell = (p, inner) => `<td role="cell" data-col="${p.id}"${inner === 'No' ? ' class="is-no"' : inner === 'Yes' ? ' class="is-yes"' : ''}>${inner}</td>`;

  function takeCell(p, { billingMode, current, start }) {
    const demo = billingMode === 'demo';
    if (current) {
      if (p.id === current.id) return '<b class="ledger__mine">Your plan</b>';
      if (demo) return `<button class="btn btn--sm" type="button" data-plan="${p.id}">${p.price < current.price ? 'Switch' : 'Upgrade'}</button>`;
      return p.price ? 'Not on sale yet' : 'Always free';
    }
    if (!p.price) return `<a class="btn btn--gold btn--sm" href="${start ? start.href : '/signup'}">${start ? start.words : 'Start free'}</a>`;
    return demo ? `<a class="btn btn--sm" href="/signup?plan=${p.id}">Try ${p.name}</a>` : 'Not on sale yet';
  }

  // Engraving, as on a banknote: the same few lines of lathe work behind the prices, and a rosette for the seal. Drawn
  // once here and never redrawn: they are still, and cost less than a picture.
  const LATHE = (() => {
    const W = 200;
    const wave = (a) => `M0 80q${W / 4} ${a} ${W / 2} 0t${W / 2} 0`;
    let d = '';
    for (let i = 1; i < 9; i++) d += wave(i * 9) + wave(-i * 9);
    return `<svg class="ledger__lathe" aria-hidden="true"><defs><pattern id="ledger-lathe" width="${W}" height="160" patternUnits="userSpaceOnUse"><path d="${d}"/></pattern></defs><rect width="100%" height="100%" fill="url(#ledger-lathe)"/></svg>`;
  })();
  const SEAL = `<svg class="ledger__seal" viewBox="-60 -60 120 120" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<ellipse rx="57" ry="19" transform="rotate(${i * 10})"/>`).join('')}<circle r="31"/><use href="#ledger-scam" x="-22" y="-22" width="44" height="44"/></svg>`;

  /** What the seal beside the prices says: the one thing that is true of this reader today. */
  function plate({ billingMode, current }) {
    if (current) return `You are on ${current.name}.`;
    return billingMode === 'demo' ? 'Switching plans is free here.' : 'Nobody can be charged today.';
  }

  function table(plans, opts) {
    const head = plans.map((p) => `<th role="columnheader" scope="col" data-col="${p.id}"><span class="ledger__name">${p.name}</span>
      <span class="ledger__price"><b><sup>$</sup>${p.price}</b>${p.price ? ' a month' : ' no card'}</span></th>`).join('');
    const row = ([label, hint, value]) => `<tr role="row"><th role="rowheader" scope="row">${label}${hint ? `<small>${hint}</small>` : ''}</th>${plans.map((p) => cell(p, value(p))).join('')}</tr>`;
    return `<table class="ledger__table" role="table" aria-label="What each plan includes">
      <thead role="rowgroup"><tr role="row"><td role="cell" class="ledger__plate">${SEAL}<p>${plate(opts)}</p></td>${head}</tr></thead>
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
  function ledger(plans, { billingMode, current, start } = {}) {
    const M = root.SentinelMasks || (require('./masks.js'), root.SentinelMasks);
    const pick = current ? plans.findIndex((p) => p.id === current.id) : 0;
    return `<div class="ledger" data-pricing data-pick="${plans[pick].id}" style="--pick:${pick}">
      <svg class="ledger__defs" aria-hidden="true">${MASKS.map((m) => `<symbol id="ledger-${m}" viewBox="0 0 64 64">${M.GLYPHS[m]}</symbol>`).join('')}</svg>
      ${current ? '' : FINDER(plans, billingMode)}
      <div class="ledger__sheet">
        ${LATHE}
        <span class="ledger__lens" aria-hidden="true"><svg class="ledger__crest"><use href="#ledger-scam"/></svg></span>
        ${table(plans, { billingMode, current, start })}
      </div>
      <div class="pricing__note"><p>${ALWAYS}</p><p>${WEEK}</p>${current ? '' : `<p>${billingMode === 'demo' ? FREE_HERE : NOT_SOLD}</p>`}</div>
    </div>`;
  }

  /** Under the headings, what Free really gives: the two things a visitor asks, as figures. */
  function lead(plans) {
    const f = plans[0];
    const [watch, unit] = time(f.limits.fastMinutes).split(' ');
    const item = (figure, words) => `<li><b>${figure}</b>${words}</li>`;
    return `<ul class="figures">${item(`$${f.price}`, 'and no card')}${item(amount(f.limits.linkScans), 'link scans a week')}${item(amount(f.limits.fileScans), 'virus and malware scans a week')}${item(watch, `${unit} a week watching while you browse`)}</ul>`;
  }

  /** How long each plan watches, in one line, for the home page's live scanning tile. */
  function liveLine(plans) {
    const [free, pro, max] = plans;
    return `${time(free.limits.fastMinutes)} a week free, ${time(pro.limits.fastMinutes)} on Pro, ${time(max.limits.fastMinutes).toLowerCase()} on ${max.name}`;
  }

  /** `<!-- @include pricing -->` and its siblings, for the server and the static build. */
  function include(name, plans, billingMode, start) {
    if (name === 'pricing') return ledger(plans, { billingMode, start });
    if (name === 'pricing-lead') return lead(plans);
    if (name === 'pricing-live') return liveLine(plans);
    if (name === 'pricing-free-live') return time(plans[0].limits.fastMinutes);
    return undefined;
  }

  const api = { ledger, lead, liveLine, include, finderPlans };
  root.SentinelPlanbook = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
