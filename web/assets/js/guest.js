/* Guest scan page: the full result view, no account, clearly limited. */
(() => {
  'use strict';
  const { api, esc, $, $$, busy, verdict, wireVerdict } = window.UI;
  const Masks = window.SentinelMasks;

  $$('[data-glyph]').forEach((el) => { el.innerHTML = Masks.svg(el.dataset.glyph); });

  const form = $('[data-form]');
  const out = $('[data-out]');
  const left = $('[data-left]');
  let used = 0;

  $$('[data-example]').forEach((b) => b.addEventListener('click', () => { form.url.value = b.dataset.example; form.requestSubmit(); }));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const url = form.url.value.trim();
    if (!url) return;
    out.innerHTML = '<div class="panel scanning"><div class="scanning__rings">' + Masks.svg('scam') + '</div><h3>Scanning</h3><p class="muted" style="margin-top:6px">Known threats, the checklist and the comparison with known scams.</p></div>';
    try {
      const data = await busy($('button[type=submit]', form), 'Scanning', () => api('/guest/scan', { method: 'POST', body: { url } }));
      used += 1;
      left.textContent = `${Math.max(0, data.guest.limitPerDay - used)} of ${data.guest.limitPerDay} guest scans left today`;
      out.innerHTML = verdict(data.verdict, { lockedLabel: 'Account' })
        + '<div class="panel actions"><span class="muted">Want history and live scanning? A free account adds them. Research comes with Pro.</span><span class="actions__btns"><a class="btn btn--gold btn--sm" href="/signup">Create a free account</a></span></div>';
      wireVerdict(out, data.verdict);
    } catch (err) {
      out.innerHTML = `<div class="banner banner--error"><div><b>${err.status === 429 ? 'Guest limit reached.' : 'Scan failed.'}</b> ${esc(err.message)} ${err.status === 429 ? '<a href="/signup" style="color:var(--gold-300)">Create a free account</a>' : ''}</div></div>`;
      if (err.status === 429) left.textContent = 'No guest scans left today';
    }
  });
})();
