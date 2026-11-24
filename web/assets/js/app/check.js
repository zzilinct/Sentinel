/* Sentinel web app: Check (/app/check) and what was shared from a phone (/app/share). app.js fetches this file the first time the page opens. */
(() => {
  'use strict';

  const { api, esc, $, $$, h, until, bytes, toast, stateBlock, busy, verdict, resultGlyph, wireVerdict, status } = window.UI;
  const {
    desktop, still, glide, state, Share, iphone, IPHONE_NOTE, ICON, applyUsage, plan, usage, uncapped, render,
    restoreDrafts, desktopError, title, linkSteps, EMAIL_STEPS, TEXT_STEPS, FILE_STEPS, watchScan, localNote,
    friendlyError
  } = window.SentinelApp;

  /** Render a verdict with its checklist tools and follow-up actions. */
  function showVerdict(out, v, opts = {}) {
    out.innerHTML = verdict(v, opts) + actionsFor(v);
    wireVerdict(out, v);
    wireActions(out, v);
    restoreDrafts();
    riseMask(out);
    if (opts.focus) toAnswer(out);
  }

  // The answer is somewhere new on the page: keyboard and screen reader users are taken to its heading, and everyone
  // sees the heading with its first sentence. Focus alone scrolls only the heading in, which left that sentence under
  // a phone's bottom bar; the head brought in by 'nearest' stops above the bar (html's scroll-padding-bottom, app.css).
  function toAnswer(out) {
    const heading = $('h2', out);
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    (heading.closest('header') || heading).scrollIntoView({ block: 'nearest' });
  }

  // The verdict's real 3D mask, over its still picture, which stays where there is no WebGL and with reduced motion
  // (cosmos.js fetches the models). data-rise says when the verdict landed: a mask ready soon enough rises into place.
  function riseMask(out) {
    const mask = $('[data-verdict-mask]', out);
    if (!mask || !window.SentinelLoadMask3D || still()) return;
    mask.dataset.rise = String(performance.now());
    mask.dataset.mask3d = mask.dataset.verdictMask;
    window.SentinelLoadMask3D();
  }


  /* =============================================================== check */

  // One page for whatever a person is unsure of: a link, a message, a whole email, a file, or a picture of a QR code or
  // of a text. route.js says what it is, and so which scan runs and which of the week's scans it uses; the page says
  // that in words before anything is spent, and one press changes it. The old pages' addresses (/app/scan,
  // /app/threats, /app/email, /app/text) open it, so links from the Windows app, the history and old bookmarks still work.
  const Route = window.SentinelRoute;
  // The key the old Fast and Delicate switch kept, so a choice made there carries over to Look deeper.
  const deeperKey = 'sentinel.scanMode';
  // The most of a pasted conversation sent for a check (server/routes/scan.routes.js reads the same).
  const TEXT_MAX = 40000;
  const KIND_NAME = { link: 'Link', download: 'Download', message: 'Message', email: 'Email' };
  const SCAN_NAME = { linkScans: 'fast scan', deepScans: 'delicate scan', fileScans: 'virus scan' };
  // What the empty page offers to show: a made-up example of each kind, none of them real addresses.
  const CHECK_EXAMPLES = {
    link: 'paypa1-secure-login.com/account',
    message: 'USPS: Your parcel is on hold at our depot due to an unpaid $1.99 redelivery fee. Pay within 24 hours or it will be returned: https://usps-redeliver.top/track',
    email: ['From: PayPal Service <service@paypa1-help.top>', 'Subject: Your account is limited', '',
      'We noticed unusual activity. Confirm your details within 24 hours at https://paypa1-secure-login.com/verify or your account will be closed.'].join('\n')
  };

  /** What a check costs, from the account's own numbers: "Uses 1 fast scan: 9 of 10 left this week." */
  function spends(meter) {
    const m = usage()[meter];
    const name = SCAN_NAME[meter];
    if (!m || !name) return '';
    if (uncapped(m.limit)) return `Uses 1 ${name}. There is no weekly limit.`;
    const n = Math.max(0, m.limit - m.used);
    if (!n) return `No ${name}s are left this week. They come back ${until(state.me.week.resetsAt)}.`;
    return `Uses 1 ${name}: ${n} of ${m.limit} left this week.`;
  }

  /** What Sentinel saw and what it will do with it, as [the kind, the check and its cost]. */
  function says(r, file) {
    const deep = r.mode === 'delicate' ? ', and researches the site' : '';
    switch (r.kind) {
      case 'link': return ['A link.', `Sentinel checks it against the threat lists, the checklist and known scams${deep}. ${spends(r.meter)}`];
      case 'download': return ['A download link.', r.path === '/scan/threat'
        ? `Sentinel checks it for viruses and malware. ${spends(r.meter)}`
        : `Sentinel checks it for scams, viruses and malware${deep}. ${spends(r.meter)}`];
      case 'message': return ['A message.', `Sentinel reads its words for known scams and checks its links by their address, without opening them. ${spends(r.meter)}`];
      case 'email': return ['An email.', r.limited
        ? `Sentinel checks its words and links as a message. Checking who really sent it is part of Max. ${spends(r.meter)}`
        : `Sentinel checks the sender, the words, every link and attachment name, and with its headers, who really sent it. ${spends(r.meter)}`];
      case 'number': return ['A phone number.', 'Sentinel cannot look a number up. Calling you now? Use the call check below. Sent you a message? Paste the whole message.'];
      case 'file': return [`${file.name}, ${bytes(file.size)}.`, file.size > 25 * 1024 * 1024
        ? 'Files up to 25 MB can be checked here.'
        : `Sentinel checks it for viruses, malware and files in disguise. ${spends(r.meter)}`];
      default: return ['', ''];
    }
  }

  function checkView(el, params) {
    const f = plan().features;
    const preset = params.get('url');
    // An old page's address: the Check page, under its own.
    if (location.pathname.replace(/\/$/, '') !== '/app/check') history.replaceState(history.state, '', `/app/check${preset ? `?url=${encodeURIComponent(preset)}` : ''}`);
    const camera = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    el.innerHTML = `
      ${title('Check something', 'Paste a link, a message or a whole email, or add a file or a picture of one. Sentinel works out which it is and runs the right check.')}
      <form class="ask" data-form data-draft="check" novalidate>
        <div class="ask__box" data-drop>
          <textarea class="ask__text" name="text" rows="3" spellcheck="false" autocomplete="off" placeholder="Paste it here" aria-label="What to check" aria-describedby="check-says" data-check-text></textarea>
          <div class="ask__file" data-file-chip hidden></div>
          <div class="ask__bar">
            <button class="ask__add" type="button" data-add>${ICON.upload}<span>Add a file or picture</span></button>
            <input type="file" data-file hidden aria-label="Choose a file or a picture to check">
            ${camera ? `<button class="ask__add" type="button" data-qr-cam aria-expanded="false">${ICON.qr}<span>QR code</span></button>` : ''}
            <button class="btn btn--gold ask__go" type="submit">Check</button>
          </div>
        </div>
        <div class="ask__said" id="check-says">
          <p class="ask__says" data-says aria-live="polite"></p>
          <p class="ask__try" data-try>Not sure what goes here? See how Sentinel reads
            <button type="button" data-example="link">a link</button>, <button type="button" data-example="message">a text message</button>,
            <button type="button" data-example="email">an email</button> or <button type="button" data-example="file">a file</button>.
            Nothing is checked until you press Check.</p>
          <div class="ask__as" data-as role="group" aria-label="Check it as" hidden></div>
          <button type="button" class="ask__deeper" data-deeper aria-pressed="false" hidden><i aria-hidden="true"></i>Look deeper: research the site</button>
          <div class="ask__help" data-header-help hidden>
            <p>To see who really sent it, paste the email with its headers.</p>
            <p><b>Gmail:</b> open the email, click the three dots, choose Show original, then Copy to clipboard.</p>
            <p><b>Outlook:</b> open the email, click the three dots, choose View, then View message source, and copy it all.</p>
          </div>
        </div>
        <div class="field ask__from" data-from hidden><label for="check-from">Who sent it <span class="opt">(optional)</span></label><input class="input" id="check-from" name="from" dir="auto" placeholder="The number or name the message shows" autocomplete="off" maxlength="80"></div>
        <figure class="shot" data-shot-preview hidden><img alt="The picture being read"><figcaption data-shot-status></figcaption></figure>
        <div class="qr-cam" data-qr-camview hidden><video muted playsinline aria-label="Camera view"></video><p class="muted">Hold the QR code up to the camera. It is read here, and the camera turns off as soon as a code is found.</p></div>
      </form>
      ${iphone ? `<p class="field__hint" data-iphone-note>${esc(IPHONE_NOTE)}</p>` : ''}
      <p class="ask__call">On the phone with someone right now? <a href="/call">Is this call a scam?</a></p>
      ${localNote()}
      <div data-qr-out aria-live="polite"></div>
      <div data-out aria-live="polite"></div>`;

    const form = $('[data-form]', el);
    const box = $('[data-check-text]', el);
    const drop = $('[data-drop]', el);
    const chip = $('[data-file-chip]', el);
    const fileInput = $('[data-file]', el);
    const saysEl = $('[data-says]', el);
    const asEl = $('[data-as]', el);
    const deeperBtn = $('[data-deeper]', el);
    const fromBox = $('[data-from]', el);
    const tryEl = $('[data-try]', el);
    const go = $('.ask__go', el);
    const preview = $('[data-shot-preview]', el);
    const shotStatus = $('[data-shot-status]', el);
    const qrOut = $('[data-qr-out]', el);
    const out = $('[data-out]', el);

    let file = null;
    let choice = null;
    let deeper = f.research;
    try { deeper = f.research && localStorage.getItem(deeperKey) !== 'fast'; } catch { /* the plan's best */ }
    const deepLeft = () => { const m = usage().deepScans; return Boolean(m) && (uncapped(m.limit) || m.limit - m.used > 0); };
    const pick = () => Route.pick({ text: box.value, file }, { features: f, choice, deeper: deeper && deepLeft() });

    let kindsShown = '';
    function refresh() {
      const r = pick();
      const [lead, rest] = says(r, file);
      // Only when it changes: a screen reader hears the sentence once, not at every key pressed.
      const said = `${lead ? `<b>${esc(lead)}</b> ` : ''}${esc(rest)}`;
      if (saysEl.innerHTML !== said) saysEl.innerHTML = said;
      const kinds = Route.choices({ text: box.value, file });
      // Drawn again only when the kinds on offer change, so the one just pressed keeps the focus.
      if (kinds.join() !== kindsShown) {
        kindsShown = kinds.join();
        asEl.innerHTML = kinds.length > 1 ? `<span class="ask__as-k">Check it as</span>${kinds.map((k) => `<button type="button" class="ask__kind" data-kind="${k}" aria-pressed="false">${KIND_NAME[k]}</button>`).join('')}` : '';
        asEl.hidden = kinds.length < 2;
      }
      $$('[data-kind]', asEl).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === r.kind)));
      deeperBtn.hidden = !(f.research && r.path === '/scan/link' && deepLeft());
      deeperBtn.setAttribute('aria-pressed', String(r.mode === 'delicate'));
      fromBox.hidden = r.kind !== 'message';
      tryEl.hidden = r.kind !== 'empty';
      // An email checked for who really sent it, pasted without the headers that say so: how to copy them.
      $('[data-header-help]', el).hidden = !(r.path === '/scan/email' && !pictured && !/^(Authentication-Results|Received-SPF|DKIM-Signature|Received)[ \t]*:/im.test(box.value));
      form.dataset.kind = r.kind;
      return r;
    }

    function showFile() {
      box.hidden = Boolean(file);
      chip.hidden = !file;
      chip.innerHTML = file ? `<span class="ask__file-icon">${ICON.file}</span><span class="ask__file-name">${esc(file.name)}</span><span class="ask__file-size">${bytes(file.size)}</span>
        <button class="btn btn--sm btn--ghost" type="button" data-unfile aria-label="Remove ${esc(file.name)}">Remove</button>` : '';
    }

    /** A file chosen, dropped or handed over: a picture is read here, an .eml becomes its text, anything else waits for Check. */
    async function take(picked) {
      if (!picked) return false;
      const kind = Route.guess({ file: picked });
      if (kind === 'picture') { readPicture(picked); return false; }
      if (kind === 'eml') {
        if (picked.size > 10 * 1024 * 1024) { toast('That email is too large to read here.', 'error'); return false; }
        file = null;
        showFile();
        box.value = await picked.text();
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      file = picked;
      choice = null;
      showFile();
      refresh();
      go.focus();
      return true;
    }

    let running = false;
    // The same thing checked a moment ago: a double press, or a second click after a quick answer, is not a second scan.
    let last = { key: '', at: 0 };
    async function run(r, { fromQr = false } = {}) {
      if (running) return;
      const key = [r.kind, r.path, r.url || '', r.mode || '', file ? `${file.name}:${file.size}` : box.value].join('|');
      if (r.path && key === last.key && performance.now() - last.at < 1500) return;
      if (r.kind === 'empty') { toast('Paste a link, a message or an email first, or add a file.', 'info'); box.focus(); return; }
      if (r.kind === 'number') { $('.ask__call a', el).focus(); return; }
      if (r.kind === 'file' && file.size > 25 * 1024 * 1024) { toast('Files up to 25 MB can be checked.', 'error'); return; }
      running = true;
      if (!fromQr) qrOut.innerHTML = '';
      // What the picture's reader said is done with: the answer is below.
      if (!preview.hidden && !fromQr) { preview.hidden = true; shotStatus.textContent = ''; }
      try {
        if (r.url) await runLink(r, fromQr);
        else if (r.path === '/scan/text') await runText(r);
        else if (r.path === '/scan/email') await runEmail();
        else if (r.path === '/scan/file') await runFile();
      } finally {
        running = false;
        last = { key, at: performance.now() };
        refresh();
      }
    }

    async function runLink(r, fromQr) {
      // Remembered in the history entry, so Back and reload show the address without spending another scan.
      history.replaceState({ scanned: r.url }, '', `/app/check?url=${encodeURIComponent(r.url)}`);
      const deep = r.mode === 'delicate';
      // A delicate scan digs: quiet binary behind the wait while the site is researched (binary.js).
      const watch = watchScan(out, linkSteps(deep), { dig: deep });
      try {
        const data = await busy(go, fromQr ? 'Checking the link in the code' : 'Checking', () => api(r.path, { method: 'POST', body: r.path === '/scan/link' ? { url: r.url, mode: r.mode } : { url: r.url }, onStage: watch.onStage }));
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { lockedLabel: 'Pro & up', focus: !fromQr });
        watch.done();
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
    }

    async function runText(r) {
      history.replaceState(null, '', '/app/check');
      // An email checked as a message: its subject and words, from its sender.
      const mail = r.kind === 'email' ? parseEmail(box.value) : null;
      const from = mail ? mail.from.slice(0, 80) : $('[name=from]', form).value.trim();
      // An email's QR code goes in with its words, so a link in the code is checked with the email's own links.
      const all = mail ? [mail.subject, mail.body, ...pictureQr.map((q) => `QR code in the email: ${q}`)].filter(Boolean).join('\n\n') : box.value;
      // A long conversation is read up to TEXT_MAX letters: its start (how it began) and its most recent part (where it is now).
      const cut = all.length > TEXT_MAX;
      const text = cut ? `${all.slice(0, 10000)}\n${all.slice(-(TEXT_MAX - 10001))}` : all;
      const watch = watchScan(out, TEXT_STEPS, { note: 'Read in memory only: never kept, and not in your history.' });
      try {
        const data = await busy(go, 'Checking', () => api('/scan/text', { method: 'POST', body: { from, text }, onStage: watch.onStage }));
        applyUsage(data.usage);
        out.innerHTML = textResult(data.text, from)
          + (cut ? `<p class="field__hint u-mt-sm">This conversation is very long, so Sentinel read its first part and its most recent ${(TEXT_MAX - 10000).toLocaleString('en')} letters.</p>` : '');
        riseMask(out);
        watch.done();
        wireWarn(out, () => window.SentinelWarnCard.fromText(data.text, from, $('[data-text-result]', out).dataset.textResult));
        const heading = $('h2', out);
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
        out.scrollIntoView({ behavior: glide(), block: 'start' });
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
    }

    async function runEmail() {
      history.replaceState(null, '', '/app/check');
      const m = parseEmail(box.value);
      // What Sentinel reads of an email (server/routes/scan.routes.js cleanMail): a 5 MB paste is cut here, so it is
      // checked instead of being refused as too large to send.
      const body = m.body.slice(0, 20000);
      // Typed or read from a screenshot, an address may have no scheme: "www.example.com/login" is a link too.
      const found = [...(body.match(/https?:\/\/[^\s<>"')]+/g) || []), ...(body.match(/(?<![\w./@-])www\.[a-z0-9.-]+\.[a-z]{2,}[^\s<>"')]*/gi) || []).map((u) => `https://${u}`)];
      const payload = {
        from: m.from, replyTo: m.replyTo, subject: m.subject, body, links: [...new Set(found)].map((href) => ({ href, text: '' })),
        attachments: m.attachments, qr: pictureQr, headers: m.headers.slice(0, 16000)
      };
      const watch = watchScan(out, EMAIL_STEPS);
      try {
        const data = await busy(go, 'Checking', () => api('/scan/email', { method: 'POST', body: payload, onStage: watch.onStage }));
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { focus: true });
        watch.done();
        showProof(out, data.verdict.sender);
        showMarks(out, payload, data.verdict.checklist.items);
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
    }

    async function runFile() {
      history.replaceState(null, '', '/app/check');
      const watch = watchScan(out, FILE_STEPS, { note: `${file.name} · ${bytes(file.size)}` });
      drop.setAttribute('aria-busy', 'true');
      try {
        const data = await busy(go, 'Checking', () => api('/scan/file', { method: 'POST', raw: file, headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' }, onStage: watch.onStage }));
        applyUsage(data.usage);
        showVerdict(out, data.verdict, { focus: true });
        watch.done();
      } catch (err) { watch.fail(); out.innerHTML = friendlyError(err); }
      drop.removeAttribute('aria-busy');
    }

    /** A QR code's text: what it does, and a link in it checked with a fast scan, so test pictures never use up delicate ones. */
    async function fromCode(code) {
      const info = await explainQr(qrOut, code, { focus: true });
      if (!info || !info.url) return;
      file = null;
      showFile();
      box.value = info.url;
      choice = null;
      await run(Route.pick({ text: info.url }, { features: f }), { fromQr: true });
    }

    /**
     * A picture: a QR code in it is read on this device and checked; otherwise its words are read by the Windows app
     * (never uploaded) and put in the box to look over before Check is pressed.
     */
    let reading = false;
    // A QR code read from a screenshot of an email, sent with that email. Typing or pasting another one forgets it.
    let pictureQr = [];
    // Words read from a picture: a screenshot has no headers to paste, so the how-to for them is not shown.
    let pictured = false;
    async function readPicture(pic) {
      if (reading) return;
      if (pic.size > 20 * 1024 * 1024) { toast('That picture is too large.', 'error'); return; }
      reading = true;
      qrOut.innerHTML = '';
      const url = URL.createObjectURL(pic);
      $('img', preview).src = url;
      preview.hidden = false;
      preview.classList.add('is-reading');
      shotStatus.textContent = 'Looking for a QR code in the picture…';
      pictureQr = [];
      try {
        let code = null;
        try { code = await qrFromFile(pic); } catch { /* no reader, or not a picture this browser opens: said below */ }
        // The words are read too where the Windows app can, so a code inside a screenshot of an email is judged with
        // that email, as one answer, and not on a card of its own.
        const canRead = Boolean(desktop && desktop.readScreenshot) && /^image\/(png|jpeg)$/.test(pic.type);
        let raw = '';
        if (code != null && canRead) {
          shotStatus.textContent = 'Reading the words in the picture…';
          try { raw = joinSlices(await desktop.readScreenshot(await sliceImage(pic))); } catch { raw = ''; }
        }
        const mailed = raw.trim() && (withSender(raw) !== raw || /^(from|sender)\s*:/im.test(raw));
        if (code != null && !mailed) {
          shotStatus.textContent = 'The QR code in this picture was read and checked below.';
          await fromCode(code);
          return;
        }
        if (code != null) {
          // Only the code's text goes with the email, and never a secret in it (SentinelQR.redact).
          pictureQr = [window.SentinelQR.redact(code)];
          box.value = withSender(raw);
          choice = 'email';
          file = null;
          showFile();
          pictured = true;
        box.dispatchEvent(new Event('input', { bubbles: true }));
          shotStatus.textContent = 'Read on this computer, with the QR code in it. Look over the words, then press Check: the code is checked with the email.';
          box.focus();
          return;
        }
        if (!/^image\/(png|jpeg)$/.test(pic.type)) {
          // Said where the answer would be, and kept there: a HEIC photo shared from a phone otherwise left an empty page.
          qrOut.innerHTML = stateBlock('unavailable', 'Take a screenshot of it and share or choose that instead, or copy the message and paste it here.', { title: 'This picture is not a PNG or JPEG, so Sentinel cannot read it', small: true }).replace('<div ', '<div role="alert" data-shot-wrong ');
          shotStatus.textContent = 'No QR code was found in this picture.';
          return;
        }
        if (!desktop || !desktop.readScreenshot) {
          shotStatus.textContent = 'No QR code was found. The words in a picture are read by the Sentinel app for Windows, so they cannot be read here. Copy the message itself and paste it here.';
          return;
        }
        shotStatus.textContent = 'Reading the words in the picture…';
        raw = joinSlices(await desktop.readScreenshot(await sliceImage(pic)));
        if (!raw.trim()) { shotStatus.textContent = 'No words were found in this picture.'; return; }
        // An address near the top is an email's sender; otherwise it is a phone's messages (textshot.js).
        const mail = withSender(raw);
        if (mail !== raw || /^(from|sender)\s*:/im.test(raw)) {
          box.value = mail;
          choice = 'email';
        } else {
          const m = window.SentinelTextShot.read(raw);
          box.value = m.text || raw;
          $('[name=from]', form).value = m.from || '';
          choice = null;
        }
        file = null;
        showFile();
        pictured = true;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        shotStatus.textContent = 'Read on this computer. Look over the words, then press Check.';
        box.focus();
      } catch (err) {
        shotStatus.textContent = desktopError(err);
      } finally {
        reading = false;
        preview.classList.remove('is-reading');
        URL.revokeObjectURL(url);
      }
    }

    box.addEventListener('input', (ev) => {
      // Emptied, or something else pasted in: a new thing to check, without the last picture's code. A word corrected
      // in what was read keeps it.
      if (!box.value.trim()) { choice = null; pictureQr = []; pictured = false; }
      if (ev.inputType === 'insertFromPaste' || ev.inputType === 'insertFromDrop') { pictureQr = []; pictured = false; }
      refresh();
    });
    // Enter sends a link pasted on its own; in a message it starts a new line, and Ctrl+Enter sends.
    box.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing) return;
      if (ev.ctrlKey || ev.metaKey || Route.isLink(box.value.trim())) { ev.preventDefault(); form.requestSubmit(); }
    });
    // An example of each thing the box takes, put in the box (or, for a file, a small harmless one made here) so the
    // sentence under it shows how Sentinel reads it. Nothing is sent until Check is pressed.
    tryEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-example]');
      if (!b || running) return;
      const kind = b.dataset.example;
      if (kind === 'file') { take(new File(['An example file made by Sentinel. It holds only these words.\n'], 'Invoice_2026.pdf.exe', { type: 'application/octet-stream' })); return; }
      box.value = CHECK_EXAMPLES[kind];
      choice = null;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.focus();
    });
    asEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-kind]'); if (b) { choice = b.dataset.kind; refresh(); } });
    deeperBtn.addEventListener('click', () => {
      deeper = !deeper;
      try { localStorage.setItem(deeperKey, deeper ? 'delicate' : 'fast'); } catch { /* not kept */ }
      refresh();
    });
    chip.addEventListener('click', (ev) => {
      if (!ev.target.closest('[data-unfile]') || running) return;
      file = null;
      showFile();
      refresh();
      box.focus();
    });
    $('[data-add]', el).addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => { take(fileInput.files[0]); fileInput.value = ''; });
    ['dragenter', 'dragover'].forEach((t) => el.addEventListener(t, (ev) => {
      if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); drop.classList.add('is-over'); }
    }));
    el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget)) drop.classList.remove('is-over'); });
    el.addEventListener('drop', (ev) => {
      drop.classList.remove('is-over');
      const dropped = ev.dataTransfer && ev.dataTransfer.files[0];
      if (!dropped) return;
      ev.preventDefault();
      if (running) { toast('One check at a time. This one is still running.', 'info'); return; }
      take(dropped);
    });
    // Ctrl+V with a picture on the clipboard (a Snipping Tool capture, say). Pasted text is left to the box: a copy
    // from Excel or Word carries a picture of itself too, and pasted into a text box it is the text that is meant.
    const onPaste = (ev) => {
      if (!el.isConnected) { document.removeEventListener('paste', onPaste); return; }
      const items = [...(ev.clipboardData ? ev.clipboardData.items : [])];
      const typing = ev.target && ev.target.closest && ev.target.closest('input, textarea, [contenteditable]');
      if (typing && items.some((i) => i.kind === 'string' && i.type === 'text/plain')) return;
      const item = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (item) { ev.preventDefault(); readPicture(item.getAsFile()); }
    };
    document.addEventListener('paste', onPaste);
    form.addEventListener('submit', (ev) => { ev.preventDefault(); run(refresh()); });

    // The camera: on only while its view is open, looked at a few times a second, off the moment a code is found.
    const camBtn = $('[data-qr-cam]', el);
    if (camBtn) {
      const camView = $('[data-qr-camview]', el);
      const video = $('video', camView);
      let stream = null;
      let timer = null;
      const stop = () => {
        clearInterval(timer);
        timer = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        video.srcObject = null;
        camView.hidden = true;
        camBtn.setAttribute('aria-expanded', 'false');
      };
      camBtn.addEventListener('click', async () => {
        if (stream) { stop(); return; }
        try { await qrEngine(); } catch (err) { toast(err.message, 'error'); return; }
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        } catch {
          stream = null;
          toast('The camera could not be started. Check that one is connected and that apps are allowed to use it.', 'error', 6000);
          return;
        }
        camView.hidden = false;
        camBtn.setAttribute('aria-expanded', 'true');
        video.srcObject = stream;
        try { await video.play(); } catch { /* it plays when it can */ }
        timer = setInterval(async () => {
          // Away from the page (another tab, the window hidden): the camera is let go, its light goes out, nothing decodes.
          if (!el.isConnected || document.hidden) { stop(); return; }
          if (reading || !video.videoWidth) return;
          const text = qrFrom(video, video.videoWidth, video.videoHeight, [Math.min(640, Math.max(video.videoWidth, video.videoHeight))]);
          if (text == null) return;
          stop();
          reading = true;
          try { await fromCode(text); } finally { reading = false; }
        }, 350);
      });
    }

    // A file chosen with "Scan with Sentinel" in the Windows right-click menu, handed over once by the app: checked at once.
    if (desktop && desktop.takeMenuFile) desktop.takeMenuFile().then(async (m) => {
      if (!m || !el.isConnected) return;
      if (await take(new File([m.data], m.name))) run(refresh());
    }, () => toast('That file could not be opened. Drop it here instead.', 'error'));

    // After the drafts are put back (render), so an old draft never takes the place of what was handed over: a link in
    // the address (Back and reload show it without spending another scan), or what the Overview box, the palette or the
    // phone's Share menu sent here.
    const handed = state.shared;
    state.shared = null;
    Promise.resolve().then(() => {
      if (preset) {
        box.value = preset;
        choice = null;
        refresh();
        if (!history.state || history.state.scanned !== preset) form.requestSubmit();
      } else if (handed && handed.text) {
        box.value = handed.text;
        $('[name=from]', form).value = '';
        choice = null;
        box.dispatchEvent(new Event('input', { bubbles: true }));
        form.requestSubmit();
      } else if (handed && handed.image) {
        refresh();
        readPicture(handed.image);
        preview.scrollIntoView({ block: 'center', behavior: glide() });
      } else refresh();
    });
  }

  /* ------------------------------------------------------------ QR codes */

  // A picture of a QR code is read in this page (qr.js), never uploaded. Only the text it holds goes to the server,
  // which says what the code does: a link, or something that is not a link at all (a sign-in code, a wallet
  // connection, a crypto payment) and would never show up in a link scan.

  /**
   * The text of a QR code in an image or a video frame, or null. A picture is tried at two sizes, large first, then
   * smaller; a camera frame once, at most 640 wide, since it is looked at a few times a second on the page's own thread.
   */
  function qrFrom(src, w, h, sides) {
    if (!window.SentinelQR || !w || !h) return null;
    const big = Math.max(w, h);
    for (const side of sides || [Math.min(1600, Math.max(big, 480)), 800]) {
      const s = side / big;
      const cw = Math.max(1, Math.round(w * s));
      const ch = Math.max(1, Math.round(h * s));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const g = canvas.getContext('2d', { willReadFrequently: true });
      // A small, sharp code is enlarged square by square, not blurred.
      g.imageSmoothingEnabled = s < 1;
      g.drawImage(src, 0, 0, cw, ch);
      const text = window.SentinelQR.decode(g.getImageData(0, 0, cw, ch));
      if (text != null) return text;
    }
    return null;
  }

  async function qrFromFile(file) {
    await qrEngine();
    const bmp = await createImageBitmap(file);
    try { return qrFrom(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
  }

  // The reader (qr.js) loads the first time a picture or the camera is read, not with every page of the app.
  let qrLoad = null;
  function qrEngine() {
    if (window.SentinelQR) return Promise.resolve(window.SentinelQR);
    return qrLoad || (qrLoad = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/assets/js/qr.js';
      s.onload = () => (window.SentinelQR ? resolve(window.SentinelQR) : s.onerror());
      s.onerror = () => { qrLoad = null; s.remove(); reject(new Error('The QR code reader could not load. Try again in a moment.')); };
      document.head.appendChild(s);
    }));
  }

  /** What a QR code does, as a card in the shape of a verdict, with what to do when it is more than a link. */
  function qrCard(info) {
    const tone = info.tone || 'clear';
    const steps = info.steps || [];
    return `<article class="result result--${tone} qr-card">
        <header class="result__head">
          <div class="result__glyph" ${status(info.tone)}>${ICON.qr}</div>
          <div class="result__title">
            <h2>${esc(info.title)}</h2>
            <p><span class="mono">From a QR code</span></p>
            <p class="result__sub">${esc(info.detail)}</p>
          </div>
        </header>
        ${steps.length ? `<div class="next-steps next-steps--${tone === 'clear' ? 'yellow' : tone}"><h3>${tone === 'red' || tone === 'orange' ? 'What to do now' : 'Before you use it'}</h3><ol>${steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
      </article>`;
  }

  // Only the code's text is sent, and never a secret in it (a sign-in token, a Wi-Fi password): see SentinelQR.redact.
  async function explainQr(out, text, { focus = false } = {}) {
    try {
      const { qr } = await api('/scan/qr', { method: 'POST', body: { text: window.SentinelQR.redact(text) } });
      out.innerHTML = qrCard(qr) + (canWarn(qr.tone) ? warnRow() : '');
      wireWarn(out, () => window.SentinelWarnCard.fromQr(qr));
      // Read from a picture, the result is somewhere new on the page: keyboard and screen reader users are taken to it.
      if (focus) toAnswer(out);
      return qr;
    } catch (err) {
      out.innerHTML = friendlyError(err);
      return null;
    }
  }

  const REPORT_CATEGORIES = [
    ['phishing', 'Phishing / fake login'], ['fake_store', 'Fake shop'], ['crypto_scam', 'Crypto scam'], ['tech_support_scam', 'Tech support scam'],
    ['investment_scam', 'Investment scam'], ['romance_scam', 'Romance scam'], ['impersonation', 'Impersonates a brand or person'], ['malware', 'Spreads malware'], ['other', 'Something else']
  ];

  function actionsFor(v) {
    const copy = `<button class="btn btn--sm" data-copy-report>Copy report</button>${v.kind !== 'file' && canWarn(window.UI.headline(v).tone) ? WARN_BTN : ''}`;
    if (v.kind !== 'url') return `<div class="panel actions"><span class="muted">Share what Sentinel found.</span><span class="actions__btns">${copy}</span></div>`;
    const trusted = v.override === 'allow';
    const blocked = v.override === 'block';
    return `<div class="panel actions">
      <span class="muted">${trusted ? 'You trust this site, so its masks are hidden for you.' : blocked ? 'You blocked this site, so it always shows a red mask for you.' : 'Think Sentinel got this wrong, or want to warn others?'}</span>
      <span class="actions__btns">
        ${copy}
        <button class="btn btn--sm" data-act="report" aria-expanded="false">Report this site</button>
        <button class="btn btn--sm" data-act="${trusted ? 'clear' : 'allow'}">${trusted ? 'Stop trusting' : 'Trust this site'}</button>
        <button class="btn btn--sm" data-act="${blocked ? 'clear' : 'block'}">${blocked ? 'Unblock' : 'Block this site'}</button>
      </span>
      <form class="report" data-report-form data-draft="report:${esc(v.url)}" hidden>
        <div class="row2">
          <div class="field"><label for="rp-cat">What kind of site is it?</label><select class="input" id="rp-cat" name="category">${(canWarn(window.UI.headline(v).tone) ? [['false_alarm', 'It is safe: Sentinel got this wrong']] : []).concat(REPORT_CATEGORIES).map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></div>
          <div class="field"><label for="rp-note">Anything else? <span class="opt">(optional)</span></label><input class="input" id="rp-note" name="note" maxlength="500" placeholder="How did you come across it?"></div>
        </div>
        <div class="report__foot"><span class="muted">Three reports from different accounts confirm a site for everyone.</span><button class="btn btn--gold btn--sm" type="submit">Send report</button></div>
      </form>
    </div>`;
  }

  function wireActions(root, v) {
    wireWarn(root, () => window.SentinelWarnCard.fromVerdict(v, window.UI.headline(v)));
    const report = $('[data-act="report"]', root);
    const form = $('[data-report-form]', root);
    if (report) report.addEventListener('click', () => {
      const open = form.hidden;
      form.hidden = !open;
      report.setAttribute('aria-expanded', String(open));
      if (open) $('select', form).focus();
    });
    if (form) form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      busy($('button[type=submit]', form), 'Sending', async () => {
        try {
          const r = await api('/report', { method: 'POST', body: { url: v.url, category: form.category.value, note: form.note.value } });
          toast(form.category.value === 'false_alarm' ? 'Sent, thank you. On its own a report changes no one’s result. Trust this site to stop its warning for you.'
            : r.promoted ? 'Reported. This site is now confirmed for everyone.' : `Thanks. ${r.reports} report${r.reports === 1 ? '' : 's'} so far.`, 'success');
          form.hidden = true;
          report.disabled = true;
          report.textContent = 'Reported';
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    $$('[data-act="allow"], [data-act="block"], [data-act="clear"]', root).forEach((b) => b.addEventListener('click', () => busy(b, 'Saving', async () => {
      try {
        const action = b.dataset.act;
        await api('/sites/override', { method: 'POST', body: { url: v.url, action } });
        toast(action === 'allow' ? `${v.domain} is trusted. Its masks are hidden for you.` : action === 'block' ? `${v.domain} is blocked. It will always show a red mask for you.` : `Rule removed for ${v.domain}.`, 'success');
        v.override = action === 'clear' ? null : action;
        // Redraw the row so the buttons reflect the new rule.
        b.closest('.actions').outerHTML = actionsFor(v);
        wireActions(root, v);
        window.UI.wireCopy(root, v);
      } catch (err) { toast(err.message, 'error'); }
    })));
  }

  /* ======================================================= warn a friend */

  // A picture of a scam that was found, for someone who may get the same one: drawn on this device (warncard.js),
  // with the link written so it cannot be tapped, and never uploaded. Only for a likely or confirmed scam.
  const WARN_BTN = '<button class="btn btn--sm" type="button" data-warn aria-expanded="false">Warn a friend</button>';
  const warnRow = () => `<div class="panel actions"><span class="muted">Someone you know might get this one too.</span><span class="actions__btns">${WARN_BTN}</span></div>`;
  const canWarn = (tone) => tone === 'red' || tone === 'orange';

  function wireWarn(root, make) {
    const btn = $('[data-warn]', root);
    const W = window.SentinelWarnCard;
    if (!btn || !W) return;
    btn.addEventListener('click', async () => {
      const row = btn.closest('.actions');
      const open = $('[data-warn-card]', row);
      if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      // A second press while the picture is still being drawn would add a second card.
      if (btn.dataset.drawing) return;
      btn.dataset.drawing = '1';
      const card = make();
      const canvas = document.createElement('canvas');
      let blob = null;
      try {
        await W.draw(canvas, card);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      } catch { /* told below */ } finally { delete btn.dataset.drawing; }
      if (!blob) { toast('The picture could not be made in this browser.', 'error'); return; }
      const file = new File([blob], 'sentinel-scam-warning.png', { type: 'image/png' });
      const share = Boolean(navigator.canShare && navigator.canShare({ files: [file] }));
      const copy = Boolean(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
      const panel = h(`<div class="warn-card" data-warn-card>
        <div class="warn-card__pic"></div>
        <div class="warn-card__side">
          <p>Send this picture to anyone who might get the same scam. The link on it is written so it cannot be tapped. The picture was made on this device and is not uploaded.</p>
          <span class="actions__btns">
            ${share ? '<button class="btn btn--gold btn--sm" type="button" data-warn-share>Share</button>' : ''}
            ${copy ? '<button class="btn btn--sm" type="button" data-warn-copy>Copy picture</button>' : ''}
            <a class="btn btn--sm" data-warn-save download="sentinel-scam-warning.png" href="${canvas.toDataURL('image/png')}">Save picture</a>
          </span>
        </div>
      </div>`);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', W.text(card));
      $('.warn-card__pic', panel).appendChild(canvas);
      const shareBtn = $('[data-warn-share]', panel);
      if (shareBtn) shareBtn.addEventListener('click', () => navigator.share({ files: [file], text: W.text(card) }).catch((err) => {
        if (err.name !== 'AbortError') toast('That could not be shared. Save the picture and send it instead.', 'error');
      }));
      const copyBtn = $('[data-warn-copy]', panel);
      if (copyBtn) copyBtn.addEventListener('click', () => navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        .then(() => toast('Picture copied. Paste it into a message.', 'success'), () => toast('Couldn’t access the clipboard. Save the picture instead.', 'error')));
      row.appendChild(panel);
      btn.setAttribute('aria-expanded', 'true');
      $('a, button', panel).focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: glide(), block: 'nearest' });
    });
  }

  // What each finding is called on its mark, and why it matters, in plain words. Keyed by the check (server/lib/scan/email.js).
  const EMAIL_MARKS = {
    E01: ['Name is not the address', 'The name says one company, but the address it came from belongs to someone else. Anyone can type any name.'],
    E02: ['Look-alike address', 'The address is made to look like a real company\'s, with a small change that is easy to miss.'],
    E03: ['Replies go elsewhere', 'If you press Reply, your answer goes to a different address than the one this came from.'],
    E04: ['Company on a free mailbox', 'A company or office writing from a free mailbox anyone can open. Real ones write from their own address.'],
    E05: ['Rushes you', 'Words meant to hurry you, so you act before you stop to check.'],
    E06: ['Asks for your details', 'Asks you to confirm a password, an account or card details. Real companies do not ask for these by email.'],
    E07: ['Asks for gift cards or crypto', 'Asks to be paid in a way that cannot be undone, like gift cards, crypto or a wire transfer. This is how scammers get paid.'],
    E08: ['Does not use your name', 'A greeting that does not use your name. Companies you deal with usually do.'],
    E09: ['A threat', 'Threatens to close your account or take action against you, to scare you into acting.'],
    E10: ['Link goes somewhere else', 'The words show one address, but the link opens a different one.'],
    E11: ['Hidden link address', 'A shortened link hides where it really goes.'],
    E12: ['QR code lure', 'Asks you to scan a code with your phone, where it is harder to see where it leads.'],
    E13: ['A program', 'This attachment is a program. Opening it would run it on your computer.'],
    E14: ['Hides its real type', 'The name ends like a document, but the file is something else.'],
    E15: ['Macro document', 'A document that can run code when you open it.'],
    E16: ['Archive with its password', 'An archive sent with its password: a way to get past virus scanners.'],
    E17: ['Invoice lure', 'An invoice or receipt sent with a risky attachment.'],
    E18: ['Made-up address', 'The sender\'s address is several words stitched together, often a new address made for a scam.'],
    E19: ['Untraceable payment', 'Presents as a company or office and asks for gift cards, crypto or a wire transfer. No real one does.'],
    E20: ['Parcel fee', 'Asks for a fee to release a parcel. Check on the courier\'s own site instead.'],
    E21: ['Call this number', 'Asks you to phone a number about a charge or a problem. The person who answers is the scammer.'],
    E22: ['Asks for private details', 'Asks you to send an ID, bank details or a password by reply.'],
    E23: ['Urgent favour', 'An urgent, private favour with gift cards or a wire transfer. Check with the person another way first.'],
    E24: ['Money for a stranger', 'Asks for money for travel, or offers a fortune you have to pay to claim.'],
    E25: ['Toll or fine', 'Demands an unpaid toll or fine from an address that is not the agency\'s own.'],
    E27: ['Web page attached', 'A web page sent as a file, often a sign-in page made to catch your password.'],
    E28: ['Paid tasks offer', 'Promises daily pay for simple tasks. It ends with you paying to get "earnings" out.'],
    E29: ['Voicemail lure', 'A voicemail you can only hear through a link, which leads to a sign-in page.'],
    E31: ['Not really from here', 'The email\'s own headers show it was not sent by the address in From. Anyone can write any address there.'],
    'EL-scam': ['Scam link', 'Sentinel checked where this link goes, and it looks like a scam.'],
    'EL-malware': ['Malware link', 'Sentinel checked where this link goes, and it leads to malware.'],
    'EL-virus': ['Virus download', 'Sentinel checked where this link goes, and it downloads a virus.']
  };

  /**
   * The email as it was scanned, inside the result, with each finding marked where it is (the server says where, by
   * offsets into each field) and labelled. Tapping a mark says why. Shown only when something was found.
   */
  // Who really sent it, when the email was pasted with its headers (server/lib/scan/sender.js): one line, in words.
  function showProof(out, sender) {
    const more = $('.result__more', out);
    if (!sender || !sender.proof || !more) return;
    more.before(h(`<section class="sender-proof" data-sender-proof data-proof="${esc(sender.proof.status)}"><span class="sender-proof__k">Who sent it</span><b>${esc(sender.proof.text)}</b></section>`));
    // Said once: the same words under Why would repeat the line just added.
    $$('.reasons li', out).filter((li) => li.textContent === sender.proof.text).forEach((li) => li.remove());
    const why = $('.reasons', out);
    if (why && !why.querySelector('li')) why.remove();
  }

  function showMarks(out, mail, items) {
    const found = items.filter((c) => (c.status === 'fail' || c.status === 'warn') && c.marks && c.marks.length);
    const more = $('.result__more', out);
    if (!found.length || !more) return;
    const whys = [];
    const fields = [['from', 'From', mail.from], ['replyTo', 'Reply-to', mail.replyTo], ['subject', 'Subject', mail.subject], ['attachments', 'Attachments', mail.attachments.join(', ')], ['body', 'Message', mail.body]];
    const rows = fields.filter(([, , text]) => text).map(([key, label, text]) => {
      // Findings in the same words become one mark that carries each of them.
      const spans = found.flatMap((c) => c.marks.filter((m) => m.field === key && m.start >= 0 && m.end <= text.length && m.end > m.start).map((m) => ({ start: m.start, end: m.end, checks: [c] })))
        .sort((a, b) => a.start - b.start);
      const merged = [];
      for (const s of spans) {
        const last = merged[merged.length - 1];
        if (last && s.start < last.end) {
          last.end = Math.max(last.end, s.end);
          if (!last.checks.includes(s.checks[0])) last.checks.push(s.checks[0]);
        } else merged.push(s);
      }
      let html = '';
      let at = 0;
      for (const s of merged) {
        const fail = s.checks.some((c) => c.status === 'fail');
        whys.push({ fail, checks: s.checks });
        // The label stays on the line of its last word (up to 12 letters of it, so a long link can still wrap): on a
        // phone it used to drop to a line of its own, away from what it marks.
        const words = text.slice(s.start, s.end);
        const tail = words.length - words.match(/\S{0,12}$/)[0].length;
        html += `${esc(text.slice(at, s.start))}<mark class="emark${fail ? ' is-fail' : ''}" tabindex="0" role="button" aria-expanded="false" data-emark="${whys.length - 1}">${esc(words.slice(0, tail))}<span class="emark__end">${esc(words.slice(tail))}<span class="emark__tag">${esc(s.checks.map((c) => (EMAIL_MARKS[c.id] || [c.title])[0]).join(', '))}</span></span></mark>`;
        at = s.end;
      }
      return `<div class="email-marks__row" data-efield="${key}"><span class="email-marks__k">${label}</span><div dir="auto" class="email-marks__v${key === 'body' ? ' email-marks__body' : ''}">${html}${esc(text.slice(at))}</div></div>`;
    });
    const section = h(`<section class="email-marks" data-email-marks><h3>The email, marked</h3><p class="email-marks__hint">Each warning sign is marked where it is. Tap a mark to see why.</p>${rows.join('')}</section>`);
    more.before(section);
    const why = h('<div class="email-marks__why" role="status" data-emark-why></div>');
    const toggle = (mark) => {
      const open = mark.getAttribute('aria-expanded') !== 'true';
      $$('[data-emark]', section).forEach((m) => m.setAttribute('aria-expanded', 'false'));
      if (!open) { why.remove(); return; }
      const w = whys[Number(mark.dataset.emark)];
      mark.setAttribute('aria-expanded', 'true');
      why.classList.toggle('is-fail', w.fail);
      why.innerHTML = w.checks.map((c) => { const [label, text] = EMAIL_MARKS[c.id] || [c.title, '']; return `<b>${esc(label)}</b>${text ? `<p>${esc(text)}</p>` : ''}<small>${esc(c.detail)}</small>`; }).join('');
      mark.closest('[data-efield]').after(why);
    };
    section.addEventListener('click', (ev) => { const m = ev.target.closest('[data-emark]'); if (m) toggle(m); });
    section.addEventListener('keydown', (ev) => {
      const m = ev.target.closest('[data-emark]');
      if (m && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); toggle(m); }
    });
  }

  /* ======================================================= shared from a phone */

  // The phone's Share menu opens /app/share (manifest.webmanifest share_target): a link, words or a picture go to the
  // Check page, which checks them at once (share.js decides which). The share
  // box is emptied as it is read, so nothing shared stays on the device after this.
  function shareView(el, params) {
    el.innerHTML = `${title('Shared with Sentinel', 'Opening the right check for what you shared.')}<div data-out aria-live="polite"></div>`;
    const fromQuery = state.shared && state.shared.query;
    state.shared = null;
    const mine = state.shareBox;
    state.shareBox = 0;
    Share.take(mine).catch(() => null).then((got) => {
      if (!el.isConnected) return;
      // A second share arrived while this one's page was opening: its own page opens it, and this one says nothing.
      if (got && got.newer) return;
      const q = fromQuery;
      const share = got || (q ? { title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '', image: null } : null);
      const r = share ? Share.route({ ...share, image: Boolean(share.image) }) : { kind: 'empty' };
      const go = (href) => { history.replaceState({}, '', href); render(); };
      if (r.kind === 'link') return go(`/app/check?url=${encodeURIComponent(r.url)}`);
      if (r.kind === 'text') { state.shared = { text: r.text }; return go('/app/check'); }
      if (r.kind === 'image') { state.shared = { image: share.image }; return go('/app/check'); }
      const sub = $('.page-title p', el);
      if (sub) sub.textContent = 'Check a message or a link straight from another app.';
      $('[data-out]', el).innerHTML = `<div class="panel" data-share-empty>
        <p>${params.get('missed') ? 'What you shared did not reach Sentinel. Please share it once more.' : 'Nothing is waiting to be checked.'}
          In Messages, WhatsApp, Gmail or your browser, press Share and choose Sentinel: the link, message or picture opens in Check.</p>
        <p class="field__hint u-mt-sm" data-iphone-note>${esc(IPHONE_NOTE)}</p>
        <p class="u-mt-sm"><a class="btn btn--sm" href="/app/check">Check something</a></p>
      </div>`;
    });
  }

  /* ============================================================ a text's result */

  /** The verdict card for a text: what it is, why, what to do, and each link's own result. */
  function textResult(r, from) {
    const f = r.flag;
    const red = r.links.some((l) => l.badge === 'red');
    const tone = !f ? 'clear' : red ? 'red' : f.level === 'danger' ? 'orange' : 'yellow';
    const who = !from ? 'No sender given' : `From ${from}${r.sender === 'number' ? ', a phone number' : r.sender === 'shortcode' ? ', a business short code' : r.sender === 'email' ? ', an email address' : ''}`;
    const linkLine = (l) => `${l.host || l.url}: ${l.badge ? `${l.label}${l.reason ? `. ${l.reason}` : ''}` : l.label === 'Not checked' ? 'could not be checked just now' : 'no threat found'}`;
    const reasons = [...(f ? [[f.detail, tone]] : []), ...r.links.map((l) => [linkLine(l), l.badge])];
    // Family on a "new number" and slow scams want money sent; the rest want a card number or a sign-in.
    const happened = f && (/family/i.test(f.title) || r.conversation) ? 'bank' : 'card,password';
    const scam = f && (f.level === 'danger' || red);
    const steps = f ? [f.advice] : [`Nothing in this text matches the scams Sentinel knows${r.links.length ? ', and its links are on no threat list' : ''}.`, 'Still unsure? Contact the company or person through their own app, website or a number you already have, not the one in the text.'];
    return `<article class="result result--${tone}" data-result data-text-result="${tone}">
      <header class="result__head">
        ${resultGlyph('scam', tone)}
        <div class="result__title">
          <h2>${esc(f ? f.title : 'No signs of a scam in this text')}</h2>
          <p class="result__sub">${esc(who)}</p>
        </div>
      </header>
      <div class="next-steps next-steps--${tone}"><h3>${f ? 'What to do now' : 'Good to know'}</h3><ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${scam ? `<p class="next-steps__more">${r.links.length ? 'Already tapped the link, paid or replied?' : 'Already paid or replied?'} <a href="/app/recover?happened=${happened}">Open the recovery guide</a> for every step, in order.</p>` : ''}</div>
      ${r.conversation ? slowSteps(r.conversation) : ''}
      ${reasons.length ? `<div class="reasons"><h3>Why</h3><ul>${reasons.map(([t, badge]) => `<li><span class="dot" ${status(badge)}></span>${esc(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="notes"><p>${r.links.length ? 'Links were checked by their address only and were not opened. ' : ''}The text was checked in memory and not kept, and it is not in your history.</p></div>
    </article>${scam && canWarn(tone) ? warnRow() : ''}`;
  }

  /** Where a conversation is on the path of a slow scam (server/lib/scan/slowscam.js), and what usually comes next. */
  function slowSteps(c) {
    return `<div class="slow slow--${c.level === 'danger' ? 'orange' : 'yellow'}" data-slow="${esc(c.at)}">
      <h3>Where this conversation is</h3>
      <ol class="slow__steps">${c.stages.map((s, i) => `<li class="slow__step${s.seen ? ' is-seen' : ''}${s.id === c.at ? ' is-at' : ''}" style="--i:${i}"${s.id === c.at ? ' aria-current="step"' : ''}>
        <span class="slow__dot" aria-hidden="true"></span><span>${esc(s.label)}</span><span class="slow__sr">${s.seen ? ' (seen in this conversation)' : ''}</span></li>`).join('')}</ol>
      <p class="slow__next"><b>What usually comes next.</b> ${esc(c.next)}</p>
    </div>`;
  }

  /** PNG slices of an image, at most 2000 wide and 1600 tall, overlapping by 60 so no line is cut in half. */
  async function sliceImage(file) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / bmp.width);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const out = [];
    for (let y = 0; y < h && out.length < 12; y += 1540) {
      const sh = Math.min(1600, h - y);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = sh;
      canvas.getContext('2d').drawImage(bmp, 0, y / scale, bmp.width, sh / scale, 0, 0, w, sh);
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      out.push(new Uint8Array(await blob.arrayBuffer()));
      if (y + sh >= h) break;
    }
    bmp.close();
    return out;
  }

  /** The slices' text as one, with a line that both slices saw (the overlap) kept once. */
  function joinSlices(texts) {
    const lines = [];
    for (const t of texts) {
      const next = String(t || '').split('\n');
      while (next.length && lines.length && lines.slice(-3).includes(next[0])) next.shift();
      lines.push(...next);
    }
    return lines.join('\n').trim();
  }

  /** A screenshot has no "From:" header, but it shows the sender's address near the top: use the first one seen. */
  function withSender(text) {
    if (/^(from|sender)\s*:/im.test(text)) return text;
    const head = text.split('\n').slice(0, 12).join('\n');
    const m = head.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
    return m ? `From: ${m[0]}\n\n${text}` : text;
  }

  /** Pull the useful parts out of a pasted email: headers first, then the body. */
  function parseEmail(raw) {
    let text = raw.replace(/\r\n?/g, '\n');
    const out = { from: '', replyTo: '', subject: '', body: text, attachments: [], headers: '' };
    // Gmail's Show original page, copied whole, starts with a summary: the message itself is the block with the
    // headers a mail service writes.
    const delivered = text.search(/^(Received|Authentication-Results|Received-SPF|DKIM-Signature|Return-Path|Delivered-To)[ \t]*:/im);
    if (delivered > 0 && /\n\s*\n/.test(text.slice(0, delivered))) text = text.slice(text.lastIndexOf('\n', delivered - 1) + 1);
    const headerEnd = text.search(/\n\s*\n/);
    // Headers on their own (Outlook's Internet headers box) have no blank line and no body: every line is a header,
    // and the From line comes after a long route, far past the first 1200 letters.
    const onlyHeaders = headerEnd < 0 && text.trim().split('\n').every((l) => /^([ \t]|[\w-]+[ \t]*:)/.test(l));
    const headBlock = headerEnd > 0 ? text.slice(0, headerEnd) : onlyHeaders ? text.slice(0, 64 * 1024) : text.slice(0, 1200);
    const header = (name, block = headBlock) => {
      const m = block.match(new RegExp(`^${name}\\s*:\\s*(.+(?:\\n[ \\t]+.+)*)`, 'im'));
      return m ? words(m[1].replace(/\n[ \t]+/g, ' ').trim()) : '';
    };
    out.from = header('From') || header('Sender');
    out.replyTo = header('Reply-To');
    out.subject = header('Subject');
    // Only the headers that say who really sent it go with the scan: not the route it took, with its addresses.
    out.headers = (headBlock.match(/^(Authentication-Results|Received-SPF|DKIM-Signature|Return-Path)[ \t]*:.*(\n[ \t]+.*)*/gim) || []).join('\n');
    if (out.from || out.subject) out.body = headerEnd > 0 ? (readable(headBlock, text.slice(headerEnd).replace(/^\s*\n/, '')) ?? text.slice(headerEnd)).trim() : onlyHeaders ? '' : text;
    // Gmail / Outlook "printed" emails put attachments at the end as bare file names.
    const files = text.match(/\b[\w][\w .()-]{0,80}\.(pdf|exe|zip|rar|7z|docm?|xlsm?|xlsx|pptx?|js|vbs|scr|iso|img|html?|lnk|msi|bat|cmd|apk|dmg)\b/gi) || [];
    out.attachments = [...new Set(files.map((f) => f.trim()))].filter((f) => !/^https?:/i.test(f)).slice(0, 10);
    return out;
  }

  /** Bytes as text in the part's character set (UTF-8 when it names none this browser knows). */
  function decodeBytes(bytes, charset) {
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch { return new TextDecoder().decode(bytes); }
  }
  /** A header's encoded words ("=?UTF-8?B?UGF5UGFs?=") as the words they are. */
  function words(s) {
    return s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (all, charset, how, data) => {
      try { return decodeBytes(how.toUpperCase() === 'B' ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : qp(data.replace(/_/g, ' ')), charset); } catch { return all; }
    });
  }
  function qp(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; } else bytes.push(s.charCodeAt(i) & 255);
    }
    return Uint8Array.from(bytes);
  }
  /**
   * The readable text of a raw message (an .eml file, or Show original): its plain text part, else its web page part
   * as text with each link written "words <address>", decoded. Null when the message is not in parts or encoded.
   * The page part is only parsed, never shown or loaded.
   */
  function readable(head, body, depth = 0) {
    const field = (name) => { const m = head.match(new RegExp(`^${name}\\s*:\\s*(.+(?:\\n[ \\t]+.+)*)`, 'im')); return m ? m[1].replace(/\n[ \t]+/g, ' ') : ''; };
    const type = field('Content-Type');
    const enc = field('Content-Transfer-Encoding').trim().toLowerCase();
    const boundary = /boundary\s*=\s*"?([^";]+)"?/i.exec(type);
    if (/^\s*multipart\//i.test(type) && boundary && depth < 5) {
      const parts = body.split(`--${boundary[1].trim()}`).slice(1).filter((p) => !p.startsWith('--')).map((p) => {
        const s = p.replace(/^[ \t]*\n/, '');
        const end = s.search(/\n\s*\n/);
        return end < 0 ? null : { head: s.slice(0, end), body: s.slice(end).replace(/^\s*\n/, '') };
      }).filter(Boolean);
      const pick = parts.find((p) => /^content-type\s*:\s*text\/plain/im.test(p.head)) || parts.find((p) => /^content-type\s*:\s*(text\/html|multipart\/)/im.test(p.head));
      return pick ? readable(pick.head, pick.body, depth + 1) : null;
    }
    if (!type && !enc) return null;
    const charset = (/charset\s*=\s*"?([^";\s]+)/i.exec(type) || [])[1];
    let textOut = body;
    try {
      if (enc === 'base64') textOut = decodeBytes(Uint8Array.from(atob(body.replace(/[^A-Za-z0-9+/=]/g, '')), (c) => c.charCodeAt(0)), charset);
      else if (enc === 'quoted-printable') textOut = decodeBytes(qp(body.replace(/=\n/g, '')), charset);
    } catch { return null; }
    if (!/^\s*text\/html/i.test(type)) return textOut;
    const doc = new DOMParser().parseFromString(textOut, 'text/html');
    doc.querySelectorAll('script, style').forEach((n) => n.remove());
    doc.querySelectorAll('a[href]').forEach((a) => a.replaceWith(`${a.textContent.trim()} <${a.getAttribute('href')}> `));
    doc.querySelectorAll('br, p, div, tr, li, h1, h2, h3').forEach((n) => n.append('\n'));
    return doc.body ? doc.body.textContent.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*/g, '\n\n').trim() : null;
  }

  Object.assign(window.SentinelApp.pages, { checkView, shareView });
})();
