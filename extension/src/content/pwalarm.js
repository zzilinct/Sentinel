/**
 * Password alarm (see lib/pwalarm.js). Runs in every page and frame, and does nothing until the person has chosen
 * accounts to protect.
 *
 * On a protected account's own sign-in site it hands the password to the worker once, when the person signs in, so
 * the worker can keep its hash. Anywhere else it waits until a password box holds as many characters as a protected
 * password, asks the worker whether it is that password, and on a match empties the box and shows the alarm. While
 * the worker is answering, a sign-in press is held back and replayed if the password was not a protected one.
 *
 * The alarm is drawn by alarm.js in a closed shadow root, like guard.js, so the page cannot restyle, remove or press it.
 */
(() => {
  'use strict';
  const ext = globalThis.browser && globalThis.browser.runtime ? globalThis.browser : globalThis.chrome;
  const send = (msg) => Promise.resolve(ext.runtime.sendMessage(msg)).catch(() => null);

  let config = null;          // { learn, lengths } from the worker
  let pending = 0;            // checks the worker has not answered yet
  let held = null;            // the sign-in press held back while a check runs: { form, submitter, click }
  const checked = new WeakMap();   // password box -> the value last checked, so a box is not hashed twice for one value

  // A box stays a password box after "Show password" turns it into plain text, and a text box drawn with dots
  // (-webkit-text-security) is one too.
  const seen = new WeakSet();
  function isPassword(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const type = String(el.type).toLowerCase();
    if (type === 'password') { seen.add(el); return true; }
    if (type !== 'text') return false;
    if (seen.has(el)) return true;
    try {
      const style = getComputedStyle(el);
      return Boolean(style.webkitTextSecurity && style.webkitTextSecurity !== 'none');
    } catch { return false; }
  }
  const passwordBox = (ev) => {
    const el = ev.composedPath ? ev.composedPath()[0] : ev.target;
    return isPassword(el) ? el : null;
  };
  const boxes = () => [...document.querySelectorAll('input')].filter((el) => el.value && isPassword(el));

  /** Asks the worker only when an account is protected: with the alarm off, a page never messages it. */
  function load() {
    return new Promise((resolve) => resolve(ext.storage.local.get('pwalarmOn'))).catch(() => ({})).then((got) => {
      if (got && got.pwalarmOn === 0) return { ok: true, learn: false, lengths: [] };
      return send({ type: 'pw-config' });
    }).then((res) => {
      config = res && res.ok ? { learn: res.learn, lengths: res.lengths || [] } : { learn: false, lengths: [] };
    });
  }

  /* -------------------------------------------------------- learning at home */

  let lastLearned = '';
  function learn() {
    const box = boxes()[0];
    if (!box || box.value === lastLearned) return;
    lastLearned = box.value;
    send({ type: 'pw-learn', password: box.value });
  }

  /* --------------------------------------------------------- checking away */

  function check(box) {
    const value = box.value;
    if (!config.lengths.includes(value.length) || checked.get(box) === value) return;
    checked.set(box, value);
    pending++;
    send({ type: 'pw-check', password: value }).then((res) => {
      pending--;
      if (res && res.ok && res.match) {
        held = null;
        // Empty the box the way typing would, so the page's own code sees it empty too.
        box.value = '';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        checked.delete(box);
        return;
      }
      if (!pending && held) replay();
    });
  }

  function replay() {
    const h = held;
    held = null;
    try {
      if (h.form && h.form.isConnected) h.form.requestSubmit(h.submitter && h.submitter.form === h.form ? h.submitter : undefined);
      else if (h.click && h.click.isConnected) h.click.click();
    } catch { /* the page changed under it */ }
  }

  /** A press that would send the form while a check is running is held, then replayed if nothing matched. */
  function hold(ev, form, submitter, click) {
    if (!pending) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    held = { form, submitter, click };
  }

  /* ---------------------------------------------------------------- wiring */

  const active = () => Boolean(config && (config.learn || config.lengths.length));

  window.addEventListener('input', (ev) => {
    if (!active() || config.learn) return;
    const box = passwordBox(ev);
    if (box) check(box);
  }, true);

  window.addEventListener('focusin', (ev) => { if (active()) passwordBox(ev); }, true);

  window.addEventListener('change', (ev) => {
    if (config && config.learn && passwordBox(ev)) learn();
  }, true);

  window.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || !config) return;
    const box = passwordBox(ev);
    if (config.learn) { if (box) learn(); return; }
    // Without a form, Enter is the page's own key handler, which cannot be replayed: the check still empties the box.
    if (box && box.form) hold(ev, box.form, null, null);
  }, true);

  window.addEventListener('submit', (ev) => {
    if (!config) return;
    if (config.learn) { learn(); return; }
    hold(ev, ev.target, ev.submitter, null);
  }, true);

  window.addEventListener('click', (ev) => {
    if (!config || config.learn || !pending) return;
    const el = ev.composedPath ? ev.composedPath()[0] : ev.target;
    const button = el && el.closest ? el.closest('button, input[type=submit], input[type=button], [role=button]') : null;
    if (button) hold(ev, null, null, button);
  }, true);

  load();
  // A protected account added or learned while this page is open counts from then on.
  ext.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.pwalarmOn) load(); });

  /* ----------------------------------------------------------------- alarm */

  // The password steps are the shared ones (steps.js, loaded just before this), the same words the site and the
  // Windows app use.
  const LOGIN_STEPS = (name) => [
    'Sentinel emptied the password box. Do not type it here again.',
    `This page may have read some of your ${name} password as you typed. ${globalThis.SentinelSteps.text.password}`,
    globalThis.SentinelSteps.text.twostep
  ];

  function alarm(msg) {
    const Alarm = globalThis.SentinelAlarm;
    const Masks = globalThis.SentinelMasks || window.SentinelMasks;
    const verdict = msg.verdict && msg.verdict.overall && msg.verdict.overall.badge ? msg.verdict.overall.label : '';
    const real = msg.bank ? msg.name : `${/^[aeiou]/i.test(msg.name) ? 'an' : 'a'} ${msg.name} site`;
    const name = Alarm.esc(msg.name);
    return Alarm.show({
      icon: Masks ? Masks.svg('scam') : '',
      title: `This is your ${msg.name} password, and this is not ${real}`,
      chip: msg.host,
      verdict,
      steps: LOGIN_STEPS(msg.name),
      ordered: true,
      buttons: [
        { text: 'Take me back to safety', kind: 'go', on: Alarm.leave },
        { text: 'Report this site', on: (ev) => {
          ev.target.textContent = 'Reporting...';
          send({ type: 'report', url: location.href, category: 'phishing' })
            .then((res) => { ev.target.textContent = res && res.ok ? 'Reported. Thank you.' : 'Could not report'; });
        } },
        { text: 'I use this password here on purpose', kind: 'quiet', on: (ev, ctl) => { ctl.$('.sure').hidden = false; ctl.$('.allow').focus(); } }
      ],
      // Wired below: the buttons in this box are not in the list above.
      extra: `<div class="sure" hidden>
          <p>Only if you are sure this site is yours or your company's. From now on Sentinel will not stop your ${name} password on <b>${Alarm.esc(msg.host)}</b>. You can undo this in the companion's settings.</p>
          <div class="row"><button type="button" class="allow">Yes, I use it here</button><button type="button" class="quiet keep">Keep protecting me</button></div>
        </div>`,
      link: msg.recover ? { href: msg.recover, text: 'Typed it on a site like this before? Open the recovery guide' } : null,
      foot: 'Your password never leaves this computer. Sentinel keeps only a scrambled form of it.'
    });
  }

  // The "are you sure" box's own buttons: only the person's presses count, as in alarm.js.
  function wireSure(ctl) {
    ctl.$('.keep').addEventListener('click', (ev) => { if (ev.isTrusted) ctl.$('.sure').hidden = true; });
    ctl.$('.allow').addEventListener('click', (ev) => {
      if (!ev.isTrusted) return;
      send({ type: 'pw-allow' }).then((res) => {
        if (res && res.ok && res.allowed) ctl.close(); else ctl.$('.sure p').textContent = 'Sentinel could not save that. Reload the page and try again.';
      });
    });
  }

  ext.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== ext.runtime.id || !msg || msg.type !== 'sentinel:pw-alarm' || window !== window.top) return;
    const show = () => wireSure(alarm(msg));
    if (document.documentElement) show();
    else document.addEventListener('DOMContentLoaded', show, { once: true });
  });
})();
