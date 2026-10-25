'use strict';
/**
 * accounts  Sign up, confirm the email, sign in, sign out, forgot and reset password, and two-step sign-in, typed and
 *           clicked as a person does on the real server: wrong passwords, the sign-in and reset limits, used and
 *           expired links, what a screen reader hears, and how long each page takes to load.
 */
const crypto = require('crypto');
const { sleep, result, launch, evalIn, openPage, goto, shot, typeText, pressEnter, startServer, watchErrors, clickSel, pressKey, until } = require('./_shared');

const PASSWORD = 'Lantern-Quiet-4821';
const NEW_PASSWORD = 'Harbour-Moss-7305';

/** The six-digit code an authenticator app shows for this base32 key now. */
function totp(secret) {
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function checkAccounts() {
  const server = await startServer('accounts');
  const { base } = server;
  const { browser, close } = await launch();
  try {
    const { sessionId: s } = await openPage(browser);
    const errors = await watchErrors(browser, s);
    await browser.send('Network.enable', {}, s);
    const loads = [];
    const open = async (url, ready = 'true') => {
      const t = Date.now();
      await goto(browser, s, base + url, ready);
      loads.push(`${url.split('?')[0]} ${Date.now() - t} ms`);
      await sleep(300);
    };
    const fill = async (selector, value) => {
      await evalIn(browser, s, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.scrollIntoView({ block: 'center' }); e.focus(); e.select && e.select(); })()`);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, s);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }, s);
      if (value) await typeText(browser, s, value);
    };
    const text = (selector) => evalIn(browser, s, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); return e ? e.innerText.trim() : ''; })()`);
    const ready = "document.querySelector('[data-form] button[type=submit]') && !document.querySelector('[data-form] button[type=submit]').disabled";
    // What a screen reader is told when the note appears: the note (or a box around it) must be a live region.
    const announced = (selector) => evalIn(browser, s, `(() => { const e = document.querySelector(${JSON.stringify(selector)});
      for (let x = e; x; x = x.parentElement) { if (x.getAttribute('aria-live') || /^(alert|status)$/.test(x.getAttribute('role') || '')) return true; }
      return Boolean(e && e.querySelector('[role=alert],[role=status],[aria-live]')); })()`);
    const mails = (subject, to) => {
      const out = [];
      const re = /\[mail\] To: (\S+)\r?\n\[mail\] Subject: ([^\r\n]+)\r?\n([\s\S]*?)(?=\n\[mail\]|$)/g;
      for (let m; (m = re.exec(server.log()));) if (m[1] === to && m[2].includes(subject)) out.push((/(https?:\/\/\S+)/.exec(m[3]) || [])[1]);
      return out;
    };
    const db = () => { const { DatabaseSync } = require('node:sqlite'); return new DatabaseSync(server.dbPath); };
    const email = `robin-${Date.now()}@example.com`;

    /* -------------------------------------------------------------- sign up */

    await open('/signup', ready);
    await clickSel(browser, s, '[data-form] button[type=submit]');
    await sleep(1200);
    const blank = await evalIn(browser, s, `({ errors: Object.fromEntries([...document.querySelectorAll('[data-error]')].map((e) => [e.dataset.error, e.textContent.trim()]).filter(([, t]) => t)),
      note: (document.querySelector('[data-note]') || {}).innerText || '', focused: document.activeElement && document.activeElement.name,
      described: [...document.querySelectorAll('[aria-invalid=true]')].map((i) => [i.name, (i.getAttribute('aria-describedby') || '').split(' ').map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim()]) })`);
    await shot(browser, s, 'accounts-signup-blank');
    result('accounts: Create account with nothing filled in says what each empty field needs, beside it, and puts the cursor in the first one',
      Object.keys(blank.errors).length >= 3 && blank.focused === 'firstName', blank);
    result('accounts: a screen reader hears each field\'s error with its field (aria-describedby)', blank.described.length > 0 && blank.described.every(([, t]) => t), blank.described);

    await fill('#firstName', 'Robin');
    await fill('#email', email);
    await fill('#password', 'short1');
    await clickSel(browser, s, 'input[name=ageConfirmed]');
    await clickSel(browser, s, 'input[name=termsAccepted]');
    await clickSel(browser, s, '[data-form] button[type=submit]');
    await sleep(1200);
    const weak = await evalIn(browser, s, "({ error: document.querySelector('[data-error=password]').textContent.trim(), focused: document.activeElement && document.activeElement.name, at: location.pathname })");
    result('accounts: a password that is too short is refused, said beside the password, which gets the cursor', weak.at === '/signup' && /10 characters/.test(weak.error) && weak.focused === 'password', weak);

    await fill('#password', PASSWORD);
    const t0 = Date.now();
    await clickSel(browser, s, '[data-form] button[type=submit]');
    const landed = await until(browser, s, "location.pathname === '/login' && document.querySelector('[data-note]').innerText.trim() && { email: document.querySelector('#email').value, note: document.querySelector('[data-note]').innerText.trim(), url: location.href, focused: document.activeElement && document.activeElement.name }", 15000);
    await shot(browser, s, 'accounts-created');
    result('accounts: a new account lands on sign-in with the email filled in, the cursor in the password and "Account created" said',
      landed && landed.email === email && /Account created/.test(landed.note) && landed.focused === 'password' && !landed.url.includes('@'), { ...landed, took: `${Date.now() - t0} ms` });

    await open('/signup', ready);
    await fill('#firstName', 'Robin');
    await fill('#email', email);
    await fill('#password', PASSWORD);
    await clickSel(browser, s, 'input[name=ageConfirmed]');
    await clickSel(browser, s, 'input[name=termsAccepted]');
    await clickSel(browser, s, '[data-form] button[type=submit]');
    const taken = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    result('accounts: signing up again with the same email says it is registered and offers sign-in and Forgot password', /already registered/.test(taken || '') && /Sign in instead/.test(taken) && /Forgot password/.test(taken), taken);

    /* -------------------------------------------------------------- sign in */

    await open('/login', ready);
    await fill('#email', email);
    await fill('#password', 'Not-The-Password-1');
    await pressEnter(browser, s);
    const wrong = await until(browser, s, "(document.querySelector('[data-note]').innerText.trim() || [...document.querySelectorAll('[data-error]')].map((e) => e.textContent).join(' ').trim())", 10000);
    const wrongLive = await announced('[data-note]');
    await shot(browser, s, 'accounts-wrong-password');
    result('accounts: a wrong password says so plainly, on the sign-in page', Boolean(wrong) && /password/i.test(wrong) && await evalIn(browser, s, "location.pathname === '/login'"), wrong);
    result('accounts: the sign-in error is announced to a screen reader (a live region)', wrongLive);

    // The limit: twelve tries for one address in 15 minutes, then the page says to wait.
    await evalIn(browser, s, `(async () => { for (let i = 0; i < 12; i++) await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(`limit-${email}`)}, password: 'Wrong-Guess-' + i }) }); })()`);
    await fill('#email', `limit-${email}`);
    await fill('#password', 'Wrong-Guess-99');
    await pressEnter(browser, s);
    await sleep(1500);
    const limited = await text('[data-note]');
    result('accounts: after twelve wrong tries the page says to wait a few minutes, not a raw error', /wait a few minutes/i.test(limited), limited);

    await open('/app/history');   // signed out: sent to sign in, and back here after
    const asked = await until(browser, s, "location.pathname === '/login' && location.search", 10000);
    await until(browser, s, ready);
    await fill('#email', email);
    await fill('#password', PASSWORD);
    await pressEnter(browser, s);
    const back = await until(browser, s, "location.pathname.startsWith('/app') && document.querySelector('#view .page-title') && location.pathname", 15000);
    result('accounts: opening an app page signed out asks to sign in, then goes back to that page', /next=%2Fapp%2Fhistory/.test(asked || '') && back === '/app/history', { asked, back });
    const cookie = (await browser.send('Network.getCookies', { urls: [base] }, s)).cookies.find((c) => /sess|sentinel/i.test(c.name)) || {};
    result('accounts: with Stay signed in unticked the session ends when the browser closes (a session cookie)', cookie.session === true || cookie.expires === -1, { name: cookie.name, expires: cookie.expires, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite });

    /* ------------------------------------------------------- confirm the email */

    const bar = await text('.verify-bar');
    result('accounts: a new account is asked to confirm its email, and what the bar says is true', /Confirm your email address/.test(bar) && !/can.t recover this account/.test(bar), bar);
    const [link] = mails('Confirm your Sentinel email address', email);
    if (!link) throw new Error('no confirmation email in the server log');
    const used = link;
    await open(new URL(link).pathname + new URL(link).search, "document.querySelector('[data-status]').textContent !== 'One moment.'");
    const confirmed = await evalIn(browser, s, "({ status: document.querySelector('[data-status]').textContent, url: location.href, after: !document.querySelector('[data-after]').hidden })");
    result('accounts: the email\'s link confirms the address, takes the token out of the address bar and offers to open Sentinel', /confirmed/.test(confirmed.status) && !/token/.test(confirmed.url) && confirmed.after, confirmed);
    await open('/app', "document.querySelector('#view .page-title')");
    result('accounts: once confirmed, the app stops asking', !(await evalIn(browser, s, "Boolean(document.querySelector('.verify-bar'))")));
    await open(new URL(used).pathname + new URL(used).search, "document.querySelector('[data-status]').textContent !== 'One moment.'");
    const again = await evalIn(browser, s, "({ status: document.querySelector('[data-status]').textContent, note: document.querySelector('[data-note]').innerText })");
    result('accounts: a confirmation link used twice says it did not work and how to get a new one', /didn.t work/.test(again.status) && /Security settings/.test(again.note), again);

    /* ------------------------------------------------------------- 2-step */

    await open('/app/security', "document.querySelector('[data-setup]')");
    await clickSel(browser, s, '[data-setup]');
    const secret = (await until(browser, s, "(document.querySelector('.secret span') || {}).textContent", 10000) || '').replace(/\s/g, '');
    await fill('#tfa-on', totp(secret));
    await fill('#tfa-pw', PASSWORD);
    await clickSel(browser, s, '[data-enable] button[type=submit]');
    const on = await until(browser, s, "document.querySelector('[data-disable]') && document.querySelector('[data-2fa] .panel-lede').textContent", 10000);
    result('accounts: two-step sign-in turns on with the code an authenticator app shows', /On\./.test(on || ''), on);

    /* ------------------------------------------------------------- sign out */

    await evalIn(browser, s, "document.documentElement.scrollTop = 0");
    await clickSel(browser, s, '[data-signout]');
    await sleep(400);
    const armed = await evalIn(browser, s, "({ at: location.pathname, label: document.querySelector('[data-signout]').getAttribute('aria-label'), text: document.querySelector('[data-signout] [data-plan]').textContent })");
    await clickSel(browser, s, '[data-signout]');
    const out = await until(browser, s, "location.pathname === '/' && document.readyState === 'complete' && location.pathname", 15000);
    const me = await evalIn(browser, s, "fetch('/api/v1/auth/me').then((r) => r.status)");
    result('accounts: Sign out asks for a second press, then signs out and goes home', armed.at === '/app/security' && /Press again/.test(armed.text) && out === '/' && me === 401, { armed, out, me });

    /* ------------------------------------------------------ 2-step sign in */

    await open('/login', ready);
    await fill('#email', email);
    await fill('#password', PASSWORD);
    await pressEnter(browser, s);
    const step = await until(browser, s, "!document.querySelector('[data-step=code]').hidden && document.activeElement && document.activeElement.id", 10000);
    await typeText(browser, s, '000000');
    const bad = await until(browser, s, "document.querySelector('[data-note-code]').innerText.trim()", 10000);
    const badLive = await announced('[data-note-code]');
    await sleep(31000 - (Date.now() % 30000));   // the code that turned it on is refused a second time: wait for the next
    await fill('#code', totp(secret));
    const in2 = await until(browser, s, "location.pathname.startsWith('/app') && location.pathname", 15000);
    result('accounts: with two-step on, sign-in asks for the code (cursor in its box), refuses a wrong one plainly and lets the right one in',
      step === 'code' && /not correct|incorrect|wrong|expired/i.test(bad || '') && Boolean(in2), { step, bad, in2 });
    result('accounts: a wrong code is announced to a screen reader (a live region)', badLive);
    // Off again, so the reset below is a plain one.
    await open('/app/security', "document.querySelector('[data-disable]')");
    await sleep(31000 - (Date.now() % 30000));   // a fresh code: the one just used is refused a second time
    await fill('#tfa-off', totp(secret));
    await fill('#tfa-off-pw', PASSWORD);
    await clickSel(browser, s, '[data-disable] button[type=submit]');
    const off = await until(browser, s, "document.querySelector('[data-setup]') && 'off'", 10000);
    result('accounts: two-step sign-in turns off with a code and the password', off === 'off');
    await evalIn(browser, s, "fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status)");

    /* ------------------------------------------------------ forgot and reset */

    await open('/forgot', ready);
    await fill('#email', `nobody-${email}`);
    await pressEnter(browser, s);
    const nobody = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    await open('/forgot', ready);
    await fill('#email', email);
    await pressEnter(browser, s);
    const sent = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    const sentLive = await announced('[data-note]');
    await shot(browser, s, 'accounts-forgot-sent');
    result('accounts: Forgot password says the same for an address with no account as for one with an account', Boolean(sent) && sent === nobody, { nobody, sent });
    result('accounts: "Check your inbox" is announced to a screen reader (a live region)', sentLive);

    // An expired link (made old in the accounts file) says so, with a way to get a new one.
    await open('/forgot', ready);
    await fill('#email', email);
    await pressEnter(browser, s);
    await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    const resets = mails('Reset your Sentinel password', email);
    if (resets.length < 2) throw new Error(`expected two reset emails in the server log, found ${resets.length}`);
    const tokenHash = (u) => crypto.createHash('sha256').update(new URL(u).searchParams.get('token')).digest('hex');
    { const d = db(); d.prepare('UPDATE password_resets SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 60000, tokenHash(resets[0])); d.close(); }
    await open(new URL(resets[0]).pathname + new URL(resets[0]).search, ready);
    await fill('#password', NEW_PASSWORD);
    await pressEnter(browser, s);
    const expired = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    const expiredLink = await evalIn(browser, s, "(document.querySelector('[data-note] a[href=\"/forgot\"]') || {}).textContent || ''");
    result('accounts: an expired reset link says it expired, with a link to ask for a new one', /expired/.test(expired || '') && /new link/i.test(expiredLink), { expired, expiredLink });

    // The fresh link: a weak password first, then a good one.
    await open(new URL(resets[1]).pathname + new URL(resets[1]).search, ready);
    const clean = await evalIn(browser, s, 'location.href');
    await fill('#password', 'password1');
    await pressEnter(browser, s);
    const weakReset = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    await fill('#password', NEW_PASSWORD);
    await pressEnter(browser, s);
    const saved = await until(browser, s, "location.pathname === '/login' && 'login'", 15000);
    result('accounts: the reset page hides its token, refuses a weak password plainly, then saves the new one and goes to sign-in',
      !/token/.test(clean) && Boolean(weakReset) && !/expired/.test(weakReset) && saved === 'login', { clean, weakReset, saved });
    await open(new URL(resets[1]).pathname + new URL(resets[1]).search, ready);
    await fill('#password', 'Another-Pass-9921');
    await pressEnter(browser, s);
    const reused = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    result('accounts: a reset link works once', /expired or was already used/.test(reused || ''), reused);

    await open('/login', ready);
    const tryLogin = async (pw) => {
      await fill('#email', email);
      await fill('#password', pw);
      await pressEnter(browser, s);
      return until(browser, s, "(location.pathname.startsWith('/app') && 'in') || document.querySelector('[data-note]').innerText.trim()", 15000);
    };
    const oldPw = await tryLogin(PASSWORD);
    const newPw = await tryLogin(NEW_PASSWORD);
    result('accounts: after the reset the old password is refused and the new one signs in', oldPw !== 'in' && newPw === 'in', { oldPw, newPw });

    // Reset requests are limited too: the fourth for one address in an hour says to try later.
    await evalIn(browser, s, "fetch('/api/v1/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })");
    await evalIn(browser, s, `fetch('/api/v1/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: ${JSON.stringify(email)} }) }).then((r) => r.status)`);
    await open('/forgot', ready);
    await fill('#email', email);
    await pressEnter(browser, s);
    const fourth = await until(browser, s, "document.querySelector('[data-note]').innerText.trim()", 10000);
    result('accounts: a fourth reset request in an hour says to try later, in words', /Too many reset requests/.test(fourth || ''), fourth);

    // Keyboard only: from the top of the sign-in page, Tab reaches the email, the password and Sign in, in that order.
    await open('/login', ready);
    const order = [];
    for (let i = 0; i < 14; i++) {
      await pressKey(browser, s, 'Tab');
      order.push(await evalIn(browser, s, "(() => { const e = document.activeElement; return e.name || e.id || (e.textContent || '').trim().slice(0, 24) || e.tagName; })()"));
    }
    const ei = order.indexOf('email'); const pi = order.indexOf('password'); const si = order.indexOf('Sign in');
    result('accounts: by keyboard alone the sign-in page reaches email, password and Sign in, in that order', ei >= 0 && pi > ei && si > pi, order);

    // Each page by its best load here: the runner's first, cold load of a page once took 7.8 s and 0.3 s the next time.
    // A page that is slow every time it is opened still fails.
    const best = {};
    for (const l of loads) { const [page, ms] = [l.split(' ')[0], Number(l.split(' ').slice(-2)[0])]; best[page] = Math.min(best[page] ?? Infinity, ms); }
    result('accounts: pages load quickly (under 3 s each, measured here)', Object.values(best).every((ms) => ms < 3000), { best, loads });
    const real = errors.filter((e) => !/status of 401/.test(e));
    result('accounts: no console errors (the signed-out check of who is signed in, a 401, aside)', !real.length, real.length ? real : `${errors.length} 401s from the signed-out check`);
  } finally {
    await close();
    await server.stop();
  }
}

module.exports = checkAccounts;
