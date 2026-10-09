/**
 * Full-page interstitial for likely/confirmed threats, drawn by alarm.js in a
 * closed shadow root so the hostile page underneath cannot restyle or remove it.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;

  const COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };
  const TITLES = {
    scam: ['This site looks like a scam', 'This is a confirmed scam site'],
    virus: ['This download may contain a virus', 'This download contains a virus'],
    malware: ['This site may try to infect your device', 'This site spreads malware']
  };
  let mounted = false;

  function worst(v) {
    const rank = { yellow: 1, orange: 2, red: 3 };
    return ['malware', 'virus', 'scam']
      .filter((t) => v.threats[t] && v.threats[t].badge)
      .sort((a, b) => rank[v.threats[b].badge] - rank[v.threats[a].badge])[0] || 'scam';
  }

  function mount(v, recover) {
    if (mounted) return;
    mounted = true;
    const threat = worst(v);
    const th = v.threats[threat];
    const accent = COLORS[th.badge] || COLORS.red;
    const title = TITLES[threat][th.badge === 'red' ? 1 : 0];

    const Masks = globalThis.SentinelMasks || window.SentinelMasks;
    globalThis.SentinelAlarm.show({
      accent,
      icon: Masks ? Masks.svg(threat) : '',
      title,
      chip: v.host,
      steps: (v.reasons || []).slice(0, 4).map((r) => r.text),
      buttons: [
        { text: 'Take me back to safety', kind: 'go', on: globalThis.SentinelAlarm.leave },
        { text: 'Report', on: (ev) => {
          ev.target.textContent = 'Reporting...';
          Promise.resolve(ext.runtime.sendMessage({ type: 'report', url: v.url, category: threat === 'scam' ? 'phishing' : 'malware' }))
            .then((res) => { ev.target.textContent = res && res.ok ? 'Reported. Thank you.' : 'Could not report'; }, () => { ev.target.textContent = 'Could not report'; });
        } },
        { text: 'Continue anyway', kind: 'quiet', on: (ev, ctl) => ctl.close() }
      ],
      link: recover ? { href: threat === 'scam' ? recover : `${recover}?happened=file`, text: 'Already paid or let someone in? Open the recovery guide' } : null,
      foot: 'Never enter passwords, card numbers or wallet phrases here.'
    });
  }

  // Before you pay: a shop's checkout whose address is young or unknown. A quiet note in the corner, never a block.
  let paid = false;
  function payNote(text) {
    if (paid || mounted) return;
    paid = true;
    globalThis.SentinelAlarm.show({
      small: true,
      accent: '#d6b25a',
      title: 'Before you pay',
      lead: text,
      buttons: [{ text: 'OK', kind: 'quiet', on: (ev, c) => c.close() }]
    });
  }

  ext.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id === ext.runtime.id && msg && msg.type === 'sentinel:pay' && typeof msg.text === 'string') {
      const show = () => payNote(msg.text.slice(0, 300));
      if (document.body) show();
      else document.addEventListener('DOMContentLoaded', show, { once: true });
      return;
    }
    if (sender.id !== ext.runtime.id || !msg || msg.type !== 'sentinel:warn' || !msg.verdict) return;
    const show = () => mount(msg.verdict, typeof msg.recover === 'string' ? msg.recover : '');
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  });
})();
