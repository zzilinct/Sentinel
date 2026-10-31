/*
 * The block page. The browser sends a confirmed bad site here before it loads (the door in background.js), and the
 * worker sends a page here when the scanner flags it after it opened (?seen=1). The address after the # could have
 * been written by anyone, so this page believes nothing: it asks the worker, and shows only what the worker answers.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  // Inside a frame a hostile page could dress this up and aim a click at Continue anyway. It shows nothing there.
  if (window.top !== window) { document.documentElement.hidden = true; return; }

  const url = location.hash.slice(1);
  const seen = new URLSearchParams(location.search).get('seen') === '1';
  const $ = (id) => document.getElementById(id);
  const send = (msg) => Promise.resolve(ext.runtime.sendMessage(msg)).catch(() => ({ ok: false }));
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  const web = /^https?:\/\//i.test(url) && Boolean(hostOf(url));

  let verdict = null;

  function draw() {
    const said = globalThis.SentinelSay.page(verdict, seen ? { closed: true } : { stopped: true });
    document.body.dataset.tone = said.tone;
    document.title = `Sentinel: ${said.title}`;
    $('mask').src = `masks/${said.mask}.webp`;
    $('title').textContent = said.title;
    $('line').textContent = said.line;
    $('reason').textContent = said.reason;
    $('reason').hidden = !said.reason;
    const go = $('go');
    go.textContent = said.action.text;
    go.dataset.kind = said.action.kind;
    $('act').hidden = false;
    const rest = (verdict.reasons || []).slice(1, 4).map((r) => String(r.text));
    $('reasons').replaceChildren(...rest.map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
    $('reasons').hidden = !rest.length;
    $('more').hidden = false;
    if (said.action.kind === 'real' && !$('back')) {
      const back = document.createElement('button');
      back.className = 'btn';
      back.id = 'back';
      back.type = 'button';
      back.textContent = 'Take me back to safety';
      back.onclick = leave;
      $('act').append(back);
    }
  }

  /** The page before this one; a tab that has none (a link opened in a new tab) closes. */
  async function leave() {
    if (history.length > 1) { history.back(); return; }
    const tab = await ext.tabs.getCurrent();
    await ext.tabs.remove(tab.id);
  }

  async function act(ev) {
    const b = ev.currentTarget;
    if (b.dataset.kind === 'real') {
      b.disabled = true;
      const res = await send({ type: 'real-site', url });
      if (!res.opened) b.disabled = false;
    } else await leave();
  }

  function wire(recover) {
    $('go').onclick = act;
    const threat = globalThis.SentinelSay.page(verdict).threat;
    const guide = threat === 'scam' ? recover : `${recover}?happened=file`;
    if (recover) {
      $('guide').href = guide;
      $('helpLink').href = guide;
      $('help').hidden = !seen;
    } else $('guide').hidden = true;
    $('report').onclick = async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      b.textContent = 'Reporting...';
      const res = await send({ type: 'report', url, category: threat === 'scam' ? 'phishing' : 'malware' });
      b.textContent = res.ok ? 'Reported. Thank you.' : 'Could not report';
      if (!res.ok) b.disabled = false;
    };
    $('pass').onclick = async () => {
      await send({ type: 'block-pass', url });
      location.replace(url);
    };
  }

  async function main() {
    if (!web) { $('title').textContent = 'There is nothing to show here'; return; }
    $('host').textContent = hostOf(url);
    const res = await send({ type: 'block-info', url, seen });
    if (res.pass) { location.replace(url); return; }
    // The worker could not be reached: the page stays stopped, and says what it knows, which is that it was sent here.
    verdict = res.verdict || { url, threats: {}, reasons: [], overall: { badge: 'red', level: 'earlier' } };
    draw();
    wire(res.recover || '');
    $('go').focus();
    if (verdict.offline) {
      const real = await send({ type: 'block-real', url });
      if (real.realSite && real.realSite.host) { verdict = { ...verdict, realSite: real.realSite }; draw(); $('go').focus(); }
    }
  }

  main();
})();
