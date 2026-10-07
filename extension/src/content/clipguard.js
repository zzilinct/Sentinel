/**
 * Stops a page from putting a "paste this into Windows" command on the clipboard (the ClickFix trick: a fake
 * "I am not a robot" check that copies a command and asks for Windows key + R, Ctrl + V, Enter).
 *
 * Runs in the page's own world, before the page's scripts, so the page only ever sees the wrapped clipboard calls.
 * Commands are recognised by clickfix.js (loaded just before this, the same rules the Windows app uses), here in the
 * browser: nothing is sent anywhere. A command only a trick would write is not copied, and the page gets a warning
 * it cannot style (alarm.js, loaded just before this too).
 *
 * The person's own copy (Ctrl+C on text they selected) is not a page's trick: it is held back with a small notice
 * that can copy it anyway. The service worker registers this script only while "Stop pasted commands" is on in the
 * companion's settings.
 */
(() => {
  'use strict';
  const rules = globalThis.SentinelClickFix;
  const Alarm = globalThis.SentinelAlarm;
  if (!rules || !Alarm || globalThis.__sentinelClipGuard) return;
  globalThis.__sentinelClipGuard = true;
  // ponytail: a page can still reach unwrapped clipboard calls through a frame this script does not run in;
  // the Windows app's own clipboard check is the backstop for that.

  const clip = globalThis.navigator && globalThis.navigator.clipboard;
  const writeText = clip && typeof clip.writeText === 'function' ? clip.writeText : null;
  const write = clip && typeof clip.write === 'function' ? clip.write : null;
  const execCommand = Document.prototype.execCommand;
  const blocked = () => new DOMException('Sentinel stopped this page from copying a command.', 'NotAllowedError');

  function stopped(found) {
    Alarm.show({
      title: 'Sentinel stopped this page from copying a command',
      chip: found.reason,
      lead: 'No real check, CAPTCHA or fix ever asks you to paste a command into Windows (Windows key + R), PowerShell or a terminal. Nothing was copied.',
      buttons: [
        { text: 'Take me back to safety', kind: 'go', on: Alarm.leave },
        { text: 'Close', on: (ev, ctl) => ctl.close() }
      ],
      escape: (ctl) => ctl.close()
    });
  }

  /** The person's own copy: held back, with a way to copy it after all. */
  function held(found, text) {
    Alarm.show({
      small: true,
      title: 'Sentinel did not copy this',
      chip: found.reason,
      lead: 'It is a command only a trick would ask you to paste into Windows. If you copied it on purpose, copy it anyway.',
      buttons: [
        { text: 'Copy it anyway', kind: 'go', on: (ev, ctl) => { copyAnyway(text); ctl.close(); } },
        { text: 'Close', kind: 'quiet', on: (ev, ctl) => ctl.close() }
      ]
    });
  }

  let letThrough = false;
  /** Called from the person's own click, so the browser allows the write. */
  function copyAnyway(text) {
    const fallback = () => {
      const box = document.createElement('textarea');
      box.value = text;
      box.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.documentElement.appendChild(box);
      box.select();
      letThrough = true;
      try { execCommand.call(document, 'copy'); } finally { letThrough = false; box.remove(); }
    };
    if (writeText) writeText.call(clip, text).catch(fallback);
    else fallback();
  }

  /** The command only a trick would write, or null. */
  function trick(text) {
    const found = rules.classify(text);
    // The page's own verdict is not known here, so with no badge decide() stops only a strong command. One that
    // downloads and runs something is left to the Windows app, which knows the page: real installers do that too.
    return rules.decide(found, undefined) === 'stop' ? found : null;
  }
  function check(text) {
    const found = trick(text);
    if (found) stopped(found);
    return Boolean(found);
  }

  if (writeText) {
    clip.writeText = function (text) {
      // Stopped: the page is told the write was not allowed, as the browser itself would say.
      if (check(String(text))) return Promise.reject(blocked());
      return writeText.apply(this, arguments);
    };
  }

  if (write) {
    clip.write = function (items) {
      const self = this;
      const args = arguments;
      return Promise.all([...(items || [])].map((item) => (item && item.types && item.types.includes('text/plain')
        ? item.getType('text/plain').then((blob) => blob.text(), () => '') : ''))).then((texts) => {
        if (texts.some((t) => t && check(t))) throw blocked();
        return write.apply(self, args);
      });
    };
  }

  if (globalThis.DataTransfer) {
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (format, data) {
      if (/^text(\/plain)?$/i.test(String(format)) && check(String(data))) return undefined;
      return setData.apply(this, arguments);
    };
  }

  // A copy a script starts (document.execCommand('copy') on a hidden box) is the page's, even though the browser
  // marks the copy event as trusted.
  let scripted = 0;
  Document.prototype.execCommand = function (command) {
    if (letThrough || !/^(copy|cut)$/i.test(String(command))) return execCommand.apply(this, arguments);
    scripted++;
    try { return execCommand.apply(this, arguments); } finally { scripted--; }
  };

  // A plain copy of selected text: a script's, or the person's own Ctrl+C.
  globalThis.addEventListener('copy', (ev) => {
    if (letThrough) return;
    const el = document.activeElement;
    // A selection inside a text box is not part of the page's selection.
    const text = el && /^(TEXTAREA|INPUT)$/.test(el.tagName) && typeof el.selectionStart === 'number'
      ? String(el.value).slice(el.selectionStart, el.selectionEnd)
      : String((globalThis.getSelection && globalThis.getSelection()) || '');
    const found = text && trick(text);
    if (!found) return;
    ev.preventDefault();
    if (ev.isTrusted && !scripted) held(found, text); else stopped(found);
  }, true);
})();
