/**
 * Stops a page from putting a "paste this into Windows" command on the clipboard (the ClickFix trick: a fake
 * "I am not a robot" check that copies a command and asks for Windows key + R, Ctrl + V, Enter).
 *
 * Runs in the page's own world, before the page's scripts, so the page only ever sees the wrapped clipboard calls.
 * Commands are recognised by clickfix.js (loaded just before this, the same rules the Windows app uses), here in the
 * browser: nothing is sent anywhere. A command only a trick would write is not copied, and the page gets a warning
 * it cannot style.
 */
(() => {
  'use strict';
  const rules = globalThis.SentinelClickFix;
  if (!rules || globalThis.__sentinelClipGuard) return;
  globalThis.__sentinelClipGuard = true;
  // ponytail: a page can still reach unwrapped clipboard calls through a frame this script does not run in;
  // the Windows app's own clipboard check is the backstop for that.

  let shown = null;
  function warn(found) {
    if (shown) shown.remove();
    const host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const accent = '#e5484d';
    root.innerHTML = `
      <style>
        .wrap{position:fixed;inset:0;display:grid;place-items:center;padding:24px;background:rgba(9,10,12,.92);
          font:15px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#ecebe7}
        .panel{width:min(520px,100%);background:#131519;border:1px solid #2a2d33;border-top:3px solid ${accent};border-radius:22px;padding:32px 32px 24px;box-shadow:0 40px 100px rgba(0,0,0,.6)}
        h1{font-size:24px;line-height:1.25;margin:0 0 10px;font-weight:700}
        p{margin:0 0 12px;color:#c7cad0}
        .why{font:600 13px ui-monospace,Menlo,Consolas,monospace;color:#b3b8bf;background:#1b1e23;border:1px solid #2a2d33;padding:8px 10px;border-radius:9px;margin-bottom:18px}
        .row{display:flex;gap:10px;flex-wrap:wrap}
        button{all:unset;cursor:pointer;font-weight:650;font-size:14px;padding:12px 18px;border-radius:12px;background:#1f2227;color:#ecebe7}
        button:hover{background:#272a30}
        .go{background:#d6b25a;color:#131519}.go:hover{background:#e2c47f}
        .foot{margin-top:20px;padding-top:14px;border-top:1px solid #23262b;color:#6e747c;font-size:12px}
        .foot b{color:#c9a64e;letter-spacing:.22em;font-size:11px}
      </style>
      <div class="wrap" role="alertdialog" aria-modal="true" aria-labelledby="t">
        <div class="panel">
          <h1 id="t">Sentinel stopped this page from copying a command</h1>
          <div class="why"></div>
          <p>No real check, CAPTCHA or fix ever asks you to paste a command into Windows (Windows key + R), PowerShell or a terminal. Nothing was copied.</p>
          <div class="row"><button class="go">Take me back to safety</button><button class="on">Close</button></div>
          <div class="foot"><b>SENTINEL</b></div>
        </div>
      </div>`;
    root.querySelector('.why').textContent = found.reason;
    root.querySelector('.go').onclick = () => { if (history.length > 1) history.back(); else location.replace('about:blank'); };
    root.querySelector('.on').onclick = () => host.remove();
    (document.documentElement || document).appendChild(host);
    shown = host;
  }

  /** True when the text is a command only a trick would copy: it is not copied, and the page gets the warning. */
  function check(text) {
    const found = rules.classify(text);
    // The page's own verdict is not known here, so with no badge decide() stops only a strong command. One that
    // downloads and runs something is left to the Windows app, which knows the page: real installers do that too.
    if (rules.decide(found, undefined) !== 'stop') return false;
    warn(found);
    return true;
  }

  const clip = globalThis.navigator && globalThis.navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    const writeText = clip.writeText;
    clip.writeText = function (text) {
      // Stopped: the promise resolves as if it worked, so the page has nothing to retry.
      if (check(String(text))) return Promise.resolve();
      return writeText.apply(this, arguments);
    };
  }

  if (globalThis.DataTransfer) {
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (format, data) {
      if (/^text(\/plain)?$/i.test(String(format)) && check(String(data))) return undefined;
      return setData.apply(this, arguments);
    };
  }

  // A plain copy of selected text (document.execCommand('copy') on a hidden box, or the person's own Ctrl+C).
  globalThis.addEventListener('copy', (ev) => {
    const sel = String((globalThis.getSelection && globalThis.getSelection()) || '');
    if (sel && check(sel)) ev.preventDefault();
  }, true);
})();
