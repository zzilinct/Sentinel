'use strict';
/**
 * companion The companion's password alarm stops a protected password on another site, and its clipboard guard
 *           stops a ClickFix-shaped command but not an ordinary one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');
const { ROOT, sleep, result, launch, evalIn, openPage, goto, pageText, shot, typeText, pressEnter } = require('./_shared');

/* ------------------------------------------------------------ 3. companion */

const HOME = 'accounts.google.com';
const PHISH = 'accounts-google.verify-session.top';
const CLIP = 'robot-check.verify-session.top';
const PASSWORD = 'Test-only-pw-7731';
const OTHER = 'Another-pw-0000-x';   // the same length, so it is hashed and compared, and must not match
const BAD = `powershell -w hidden -enc ${Buffer.from('Write-Output hi', 'utf16le').toString('base64')}`;   // harmless, shaped like ClickFix
const FINE = 'npm i x';

function openssl() {
  for (const exe of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    if (spawnSync(exe, ['version']).status === 0) return exe;
  }
  throw new Error('openssl was not found (Git for Windows ships one)');
}

function signInPage(host) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Sign in</title></head><body>
    <h1>Sign in</h1><p>${host}</p>
    <form method="post" action="/signin"><input name="email" value="test@example.com"><input type="password" name="password" autocomplete="current-password"><button>Sign in</button></form>
  </body></html>`;
}

async function checkCompanion() {
  const ext = path.join(ROOT, 'extension');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-tls-'));
  const r = spawnSync(openssl(), ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-days', '1', '-subj', '/CN=sentinel-verify', '-addext', `subjectAltName=DNS:${HOME},DNS:${PHISH},DNS:${CLIP}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`openssl could not make a certificate: ${r.stderr}`);

  const posts = [];
  const server = https.createServer({ key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) }, (req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => { posts.push({ host, body }); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Signed in</title><p>Signed in</p>'); });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(host === CLIP ? `<!doctype html><title>Verify you are human</title><p>Press the button to verify.</p>` : signInPage(host));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const rules = [HOME, PHISH, CLIP].map((h) => `MAP ${h} 127.0.0.1:${port}`).join(',');
  const { browser, version, close } = await launch([`--host-resolver-rules=${rules}`, '--ignore-certificate-errors']);
  try {
    const loaded = await browser.send('Extensions.loadUnpacked', { path: ext });
    let sw;
    for (let i = 0; i < 40 && !sw; i++) {
      const { targetInfos } = await browser.send('Target.getTargets');
      sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${loaded.id}/`));
      if (!sw) await sleep(250);
    }
    if (!sw) throw new Error('the companion loaded but its service worker never started');

    // Protect the Google account from the companion's own settings page, as a person would.
    const opt = await openPage(browser);
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");
    const worker = (msg) => evalIn(browser, opt.sessionId, `chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
    const set = await worker({ type: 'pw-set', id: 'google', on: true });
    if (!set || !set.ok) throw new Error(`could not protect the Google account: ${JSON.stringify(set)}`);

    /* (a) password alarm */
    const tab = await openPage(browser);
    const s = tab.sessionId;
    const signIn = async (host, password) => {
      await goto(browser, s, `https://${host}/`, "document.querySelector('input[type=password]')");
      await sleep(1000);   // the content script asks the worker for its settings at start
      await evalIn(browser, s, "document.querySelector('input[type=password]').focus()");
      await typeText(browser, s, password);
      await pressEnter(browser, s);
    };

    await signIn(HOME, PASSWORD);
    let learned = false;
    for (let i = 0; i < 40 && !learned; i++) {
      await sleep(250);
      const list = await worker({ type: 'pw-list' });
      learned = Boolean(list && list.accounts && list.accounts.some((a) => a.id === 'google' && a.learned));
    }
    const homePosted = posts.some((p) => p.host === HOME);
    result(`companion: signing in on ${HOME} teaches the password alarm (and the sign-in goes through)`, learned && homePosted, { learned, homePosted, browser: version });

    // Said once, quietly, in a corner of the sign-in page or the page it moved on to, and not again.
    let told = '';
    for (let i = 0; i < 40 && !/Your Google password is now protected/.test(told); i++) { await sleep(250); told = await pageText(browser, s); }
    await shot(browser, s, 'companion-password-protected');
    await sleep(3500);   // on screen long enough to count as said
    await goto(browser, s, `https://${HOME}/`, "document.querySelector('input[type=password]')");
    await sleep(1500);
    const again = /now protected/.test(await pageText(browser, s));
    result('companion: after the first sign-in, a quiet note says "Your Google password is now protected", once', /Your Google password is now protected/.test(told) && !again, { again, onScreen: told.slice(0, 200) });
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/popup.html`, "!document.getElementById('pwLine').hidden");
    const line = await evalIn(browser, opt.sessionId, "document.getElementById('pwLine').textContent + '|' + (document.getElementById('pwLink') || {}).textContent");
    result('companion: the popup says what the password alarm protects, with a link to its settings', /Password alarm protects your Google password\..*\|Password alarm settings$/.test(line), { line });
    await goto(browser, opt.sessionId, `chrome-extension://${loaded.id}/src/options.html`, "typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id");

    const before = posts.length;
    await signIn(PHISH, PASSWORD);
    let text = '';
    for (let i = 0; i < 40 && !/This is your Google password/.test(text); i++) {
      await sleep(250);
      text = await pageText(browser, s);
    }
    await sleep(3000);   // long enough for a form that was going to be sent to be sent
    await shot(browser, s, 'companion-password-alarm');
    const box = await evalIn(browser, s, "(document.querySelector('input[type=password]') || {}).value");
    const sent = posts.slice(before).filter((p) => p.host === PHISH);
    const alarm = /This is your Google password, and this is not a Google site/.test(text);
    result(`companion: the same password typed on ${PHISH} sounds the alarm and is not sent`, alarm && !sent.length && box === '',
      { alarm, formSent: sent.length > 0, boxValue: box, onScreen: text.slice(0, 300) });

    // An ordinary password of the same length on the same page: checked, no alarm, and the press goes through.
    const before2 = posts.length;
    await signIn(PHISH, OTHER);
    let through = false;
    for (let i = 0; i < 40 && !through; i++) { await sleep(250); through = posts.slice(before2).some((p) => p.host === PHISH && p.body.includes(encodeURIComponent(OTHER))); }
    const text2 = await pageText(browser, s);
    result('companion: a different password on that page is let through, with no alarm', through && !/This is your Google password/.test(text2), { through });

    /* (b) pasted-command guard */
    await browser.send('Browser.grantPermissions', { origin: `https://${CLIP}`, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
    await goto(browser, s, `https://${CLIP}/`);
    // Each write answers "<how the page's call ended>|<what is on the clipboard after it>".
    const settle = "then(() => 'ok', (e) => e.name).then((r) => navigator.clipboard.readText().then((c) => r + '|' + c))";
    const write = (t) => evalIn(browser, s, `navigator.clipboard.writeText(${JSON.stringify(t)}).${settle}`, { userGesture: true }).catch((err) => `error: ${err.message}`);
    const writeItem = (t) => evalIn(browser, s, `navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([${JSON.stringify(t)}], { type: 'text/plain' }) })]).${settle}`, { userGesture: true }).catch((err) => `error: ${err.message}`);
    const wrapped = await evalIn(browser, s, "!/\\[native code\\]/.test(Function.prototype.toString.call(navigator.clipboard.writeText))");
    // What the worker registered, and what reached the page: printed with the first result, to tell why if it fails.
    const registered = await evalIn(browser, opt.sessionId, 'chrome.scripting.getRegisteredContentScripts().then((r) => JSON.stringify(r))').catch((err) => `error: ${err.message}`);
    const inPage = await evalIn(browser, s, "JSON.stringify({ rules: typeof SentinelClickFix, alarm: typeof SentinelAlarm, guard: Boolean(window.__sentinelClipGuard) })");
    const afterFine = await write(FINE);
    const warnedFine = /stopped this page from copying a command/.test(await pageText(browser, s));
    result(`companion: an ordinary command (${FINE}) is copied, with no warning, and the guard is in the page`, wrapped && afterFine === `ok|${FINE}` && !warnedFine, { wrapped, registered, inPage, clipboard: afterFine, warned: warnedFine });
    const afterBad = await write(BAD);
    let clipText = '';
    for (let i = 0; i < 20 && !/stopped a copied command/.test(clipText); i++) { await sleep(150); clipText = await pageText(browser, s); }
    await shot(browser, s, 'companion-clipguard');
    const warnedBad = /Sentinel stopped this page from copying a command/.test(clipText) && /hidden window/.test(clipText);
    result('companion: a ClickFix-shaped command is not copied, the page is told so, and the warning shows', afterBad === `NotAllowedError|${FINE}` && warnedBad, { clipboard: afterBad, warned: warnedBad, onScreen: clipText.slice(0, 300) });

    // The warning has the keyboard: Escape closes it.
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, s);
    await sleep(300);
    const closed = !/stopped this page from copying a command/.test(await pageText(browser, s));
    result('companion: Escape closes the pasted-command warning', closed, { closed });

    const afterItem = await writeItem(BAD);
    result('companion: navigator.clipboard.write() with the same command is stopped too', afterItem === `NotAllowedError|${FINE}`, { clipboard: afterItem });
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, s);
    await sleep(300);

    // The person's own Ctrl+C on text they selected: held back with a small notice that can copy it anyway.
    await evalIn(browser, s, `(() => { const pre = document.createElement('pre'); pre.id = 'cmd'; pre.textContent = ${JSON.stringify(BAD)}; document.body.appendChild(pre);
      const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); return true; })()`);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, commands: ['copy'] }, s);
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 }, s);
    let ownText = '';
    for (let i = 0; i < 20 && !/Sentinel did not copy this/.test(ownText); i++) { await sleep(150); ownText = await pageText(browser, s); }
    await shot(browser, s, 'companion-clipguard-own-copy');
    const ownClip = await evalIn(browser, s, 'navigator.clipboard.readText()', { userGesture: true }).catch((err) => `error: ${err.message}`);
    result('companion: the person\'s own copy of a command gets the small notice with "Copy it anyway", not the full-screen block',
      /Sentinel did not copy this/.test(ownText) && /Copy it anyway/.test(ownText) && !/stopped this page from copying/.test(ownText) && ownClip === FINE,
      { clipboard: ownClip, onScreen: ownText.slice(0, 300) });
  } finally {
    await close();
    server.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

module.exports = checkCompanion;
