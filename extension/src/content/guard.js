/**
 * Full-page interstitial for likely/confirmed threats. Rendered in a closed
 * shadow root so the hostile page underneath cannot restyle or remove it.
 */
(() => {
  'use strict';

  const COLORS = { yellow: '#f5c542', orange: '#f08a24', red: '#e5484d' };
  const TITLES = {
    scam: ['This site looks like a scam', 'This is a confirmed scam site'],
    virus: ['This download may contain a virus', 'This download contains a virus'],
    malware: ['This site may try to infect your device', 'This site spreads malware']
  };
  let mounted = false;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function worst(v) {
    const rank = { yellow: 1, orange: 2, red: 3 };
    return ['malware', 'virus', 'scam']
      .filter((t) => v.threats[t] && v.threats[t].badge)
      .sort((a, b) => rank[v.threats[b].badge] - rank[v.threats[a].badge])[0] || 'scam';
  }

  function mount(v) {
    if (mounted) return;
    mounted = true;
    const threat = worst(v);
    const th = v.threats[threat];
    const accent = COLORS[th.badge] || COLORS.red;
    const title = TITLES[threat][th.badge === 'red' ? 1 : 0];

    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host{all:initial}
        .wrap{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:radial-gradient(1200px 600px at 50% -10%,${accent}22,transparent 60%),rgba(9,10,12,.96);
          font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#ecebe7;animation:f .25s ease}
        @keyframes f{from{opacity:0}to{opacity:1}}
        .panel{width:min(560px,100%);background:#131519;border:1px solid #2a2d33;border-radius:22px;padding:36px 36px 28px;box-shadow:0 40px 100px rgba(0,0,0,.6);animation:r .35s cubic-bezier(.2,.8,.2,1)}
        @keyframes r{from{transform:translateY(14px) scale(.98);opacity:0}to{transform:none;opacity:1}}
        .ring{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;background:${accent}1f;box-shadow:inset 0 0 0 1px ${accent}66;color:${accent};margin-bottom:20px}
        .ring svg{width:38px;height:38px}
        h1{font-size:26px;line-height:1.2;letter-spacing:-.02em;margin:0 0 10px;font-weight:700}
        .host{display:inline-block;font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#b3b8bf;background:#1b1e23;border:1px solid #2a2d33;padding:6px 10px;border-radius:9px;margin-bottom:18px;word-break:break-all}
        ul{margin:0 0 24px;padding:0;list-style:none;display:grid;gap:8px}
        li{display:flex;gap:10px;color:#c7cad0}li:before{content:"";flex:none;width:6px;height:6px;margin-top:9px;border-radius:50%;background:${accent}}
        .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
        button{all:unset;cursor:pointer;font-weight:650;font-size:14px;padding:12px 18px;border-radius:12px;background:#1f2227;color:#ecebe7}
        button:hover{background:#272a30}
        .go{background:linear-gradient(180deg,#e2c275,#c49b3c);color:#131519}.go:hover{filter:brightness(1.05);background:linear-gradient(180deg,#e2c275,#c49b3c)}
        .on{background:none;color:#80868f;text-decoration:underline;padding:12px 6px}.on:hover{background:none;color:#c7cad0}
        .foot{margin-top:24px;padding-top:16px;border-top:1px solid #23262b;display:flex;justify-content:space-between;gap:12px;color:#6e747c;font-size:12px}
        .foot b{color:#c9a64e;letter-spacing:.22em;font-size:11px}
      </style>
      <div class="wrap" role="alertdialog" aria-modal="true" aria-labelledby="t">
        <div class="panel">
          <div class="ring">${window.SentinelMasks ? window.SentinelMasks.svg(threat) : ''}</div>
          <h1 id="t">${esc(title)}</h1>
          <div class="host">${esc(v.host)}</div>
          <ul>${(v.reasons || []).slice(0, 4).map((r) => `<li>${esc(r.text)}</li>`).join('')}</ul>
          <div class="row">
            <button class="go">Take me back to safety</button>
            <button class="rep">Report</button>
            <button class="on">Continue anyway</button>
          </div>
          <div class="foot"><span><b>SENTINEL</b></span><span>Never enter passwords, card numbers or wallet phrases here.</span></div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    root.querySelector('.go').onclick = () => { if (history.length > 1) history.back(); else location.replace('about:blank'); };
    root.querySelector('.on').onclick = () => host.remove();
    root.querySelector('.rep').onclick = (ev) => {
      ev.target.textContent = 'Reporting...';
      chrome.runtime.sendMessage({ type: 'report', url: v.url, category: threat === 'scam' ? 'phishing' : 'malware' }, (res) => {
        void chrome.runtime.lastError;
        ev.target.textContent = res && res.ok ? 'Reported - thank you' : 'Could not report';
      });
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== 'sentinel:warn' || !msg.verdict) return;
    const show = () => mount(msg.verdict);
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  });
})();
