'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../desktop/scripts/sync-shared.js');
const chatwatch = require('../desktop/src/chatwatch.js');
const { onMessage, robloxMessages, readLog, discordContext, judge, SCRIPT, LAUNCH, phonelinkMessages, judgeTexts, textOf, setOpts } = chatwatch._test;

test('Roblox\'s chat box: names and messages, wrapped lines joined, and whether the box is open at all', () => {
  const r = robloxMessages([
    { t: '[Stranger123]: hey do u wanna be friends', x: 10, y: 20, w: 300, h: 18 },
    { t: 'Pro_Gamer: gg everyone', x: 10, y: 42, w: 200, h: 18 },
    { t: '[nice_guy]: dont tell your parents we talk, i will', x: 10, y: 64, w: 400, h: 18 },
    { t: 'send you robux tomorrow', x: 10, y: 84, w: 220, h: 18 },
    { t: 'To chat click here or press "/" key', x: 10, y: 300, w: 300, h: 16 }
  ]);
  assert.equal(r.open, true);
  assert.deepEqual(r.messages.map((m) => m.who), ['Stranger123', 'Pro_Gamer', 'nice_guy']);
  assert.equal(r.messages[2].text, 'dont tell your parents we talk, i will send you robux tomorrow');
  // The game behind a closed chat box is not chat.
  assert.equal(robloxMessages([{ t: 'SCORE 1200', x: 0, y: 0, w: 90, h: 20 }, { t: 'Round 3', x: 0, y: 40, w: 60, h: 20 }]).open, false);
});

test('Roblox\'s own log says which game is being played, and when it is left', () => {
  let s = readLog('2026-10-04 [FLog::Output] ! Joining game \'1f2e\' place 4924922222 at 128.116.1.1\n');
  assert.deepEqual(s, { inGame: true, placeId: '4924922222' });
  s = readLog('2026-10-04 [FLog::SingleSurfaceApp] leaveUGCGameInternal\n', s);
  assert.deepEqual(s, { inGame: false, placeId: null });
});

test('Discord\'s title gives the server and channel, or a direct message', () => {
  assert.deepEqual(discordContext('#general | Minecraft builders - Discord'), { channel: 'general', server: 'Minecraft builders', dm: false });
  assert.equal(discordContext('@nice_guy - Discord').dm, true);
});

test('messages are judged in their place, each once, and a flag keeps its place beside the message', () => {
  const ctx = { game: 'Brookhaven 🏡RP', description: 'role play town' };
  const quiet = judge('roblox', 'roblox|1', ctx, [{ who: 'a', text: 'where do you live', x: 0, y: 0, w: 10, h: 10 }]);
  assert.equal(quiet.length, 0, 'a house in the game');
  const flags = judge('roblox', 'roblox|1', ctx, [{ who: 'b', text: "don't tell your parents we talk", x: 5, y: 60, w: 200, h: 18 }]);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].level, 'danger');
  assert.deepEqual(flags[0].rect, { x: 5, y: 60, w: 200, h: 18 });
  const again = judge('roblox', 'roblox|1', ctx, [{ who: 'b', text: "don't tell your parents we talk", x: 5, y: 40, w: 200, h: 18 }]);
  assert.equal(again.length, 1, 'still shown while on screen');
  assert.equal(again[0].rect.y, 40, 'where the message is now');
});

test('chat safety reads only, and keeps nothing: no keys or clicks sent, nothing written, no other program touched', () => {
  assert.doesNotMatch(SCRIPT, /SendInput|keybd_event|mouse_event|PostMessage|SendMessage|WriteProcessMemory|ReadProcessMemory|OpenProcess|CreateRemoteThread|SetWindowsHookEx/i, 'nothing sent to or taken from another program');
  assert.doesNotMatch(SCRIPT, /Out-File|Set-Content|Add-Content|Export-|\.Save\(|WriteAllBytes|WriteAllText/i, 'nothing written to disk');
  assert.equal((SCRIPT.match(/CopyFromScreen/g) || []).length, 1, 'one place copies the screen');
  assert.match(SCRIPT, /\$sb\.Dispose\(\); \$bytes = \$null/, 'and the copy is dropped once read');
  assert.match(SCRIPT, /GetForegroundWindow/, 'only the window in front');
  const src = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'chatwatch.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /appendFile|writeFile/, 'nothing about a chat goes to a file');
});

test('the chat reader\'s PowerShell parses', { skip: process.platform !== 'win32' }, () => {
  const file = path.join(os.tmpdir(), `sentinel-chat-parse-${process.pid}.ps1`);
  fs.writeFileSync(file, SCRIPT, 'utf8');
  try {
    const r = require('child_process').spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e) { $e | ForEach-Object { $_.Message + ' @ ' + $_.Extent.StartLineNumber } } else { 'parsed' }`], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.stdout.trim(), 'parsed', r.stdout + r.stderr);
  } finally { fs.rmSync(file, { force: true }); }
});

test('the chat reader starts, its output arrives while it runs, and waiting for a command does not stop its loop', { skip: process.platform !== 'win32' }, async () => {
  // As the reader does: a read of the next command is started, and the loop goes on while none has come.
  const script = "Write-Output 'up'; $p = $in.ReadLineAsync(); Write-Output ('got ' + $p.Result); $p = $in.ReadLineAsync(); Write-Output ('waiting ' + $p.Wait(1)); Start-Sleep 30";
  const ps = require('child_process').spawn('powershell.exe', LAUNCH, { windowsHide: true });
  let out = '';
  ps.stdout.on('data', (d) => { out += d; });
  ps.stdin.write(`${Buffer.from(script, 'utf8').toString('base64')}\napps discord\n`);
  try {
    for (let i = 0; i < 300 && !/waiting/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /up\s+got apps discord\s+waiting False/);
  } finally { ps.kill(); }
});

test('a warning by Roblox\'s chat box stays when the Esc menu opens or closes', () => {
  const states = [];
  setOpts({ log: () => {}, onState: (st) => states.push(st) });
  try {
    onMessage({ app: 'roblox', win: [0, 0, 1000, 700], area: [0, 0, 450, 350], lines: [{ t: '[Player1]: free robux at robux-gen.top', x: 24, y: 70, w: 380, h: 20 }] });
    assert.equal(states.at(-1).flags.length, 1);
    onMessage({ app: 'roblox', menu: false });
    assert.equal(states.at(-1).flags.length, 1, 'the menu message must not wipe the warning');
  } finally { setOpts(null); }
});

test('Phone Link read with the text recogniser: who it is with, received texts with their lines joined, sent ones and times left out', () => {
  const pane = [300, 0, 700, 800];
  const r = phonelinkMessages([
    { t: '+1 (415) 555-0199', x: 330, y: 20, w: 160, h: 20 },
    { t: 'USPS: Your package is on hold due to an', x: 330, y: 200, w: 300, h: 18 },
    { t: 'unpaid redelivery fee. Pay at usps-fee.top/p', x: 330, y: 221, w: 310, h: 18 },
    { t: '10:42 AM', x: 330, y: 245, w: 60, h: 14 },
    { t: 'who is this?', x: 860, y: 300, w: 100, h: 18 },
    { t: 'Send a message', x: 330, y: 760, w: 120, h: 18 }
  ], pane);
  assert.equal(r.who, '+1 (415) 555-0199');
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].text, 'USPS: Your package is on hold due to an unpaid redelivery fee. Pay at usps-fee.top/p');
  assert.equal(textOf('Is this Jessica? 10:42 AM'), 'Is this Jessica?');
});

test('texts are judged once, their links checked by address only and privately, and a dangerous link raises the warning', async () => {
  const calls = [];
  let answer;
  const answered = new Promise((resolve) => { answer = resolve; });
  setOpts({ log: () => {}, onState: () => {}, api: async (p, body) => { calls.push([p, body]); answer(); return { byUrl: { [body.urls[0]]: { host: 'shop-orders.top', overall: { badge: 'red', label: 'Confirmed scam' }, reasons: [{ text: 'Listed as phishing' }] } } }; } });
  const msg = { text: 'Your order is ready, details at https://shop-orders.top/a', x: 1, y: 2, w: 3, h: 4 };
  assert.equal(judgeTexts('+1 415 555 0199', [msg]).length, 0, 'the words alone are ordinary');
  await answered;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/api/v1/live/batch');
  assert.deepEqual(calls[0][1], { urls: ['https://shop-orders.top/a'], private: true, mode: 'fast', purpose: 'texts' });
  const flags = judgeTexts('+1 415 555 0199', [msg]);
  assert.equal(calls.length, 1, 'checked once');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].level, 'danger');
  assert.deepEqual(flags[0].rect, { x: 1, y: 2, w: 3, h: 4 });
  setOpts(null);
});

test('the reader reads only the apps switched on, Phone Link included', () => {
  assert.match(SCRIPT, /'PhoneExperienceHost'/);
  assert.match(SCRIPT, /if \(\$apps -notcontains \$app\) \{ \$app = '' \}/);
  assert.match(SCRIPT, /\$cmd -like 'apps \*'/);
});

test('Phone Link: sent or received by which side a bubble leans on, in a wide or a narrow window', () => {
  const r = phonelinkMessages([
    { t: 'Ann', x: 20, y: 10, w: 40, h: 20 },
    // A long received message that spans most of the conversation.
    { t: 'Your toll balance is overdue, pay today at ezpass-fee.top/p or a fee of $50 is added', x: 16, y: 200, w: 300, h: 18 },
    // A sent message on two lines: its short last line starts on the left of its bubble, not of the conversation.
    { t: 'Who is this? I do not owe any', x: 120, y: 260, w: 236, h: 18 },
    { t: 'toll', x: 120, y: 281, w: 30, h: 18 }
  ], [0, 0, 360, 700]);
  assert.deepEqual(r.messages.map((m) => m.text), ['Your toll balance is overdue, pay today at ezpass-fee.top/p or a fee of $50 is added']);
  assert.equal(chatwatch._test.receivedSide(16, 316, 0, 360), true);
  assert.equal(chatwatch._test.receivedSide(120, 356, 0, 360), false);
});

test('Phone Link: nothing is read off the Messages tab, and links that could not be checked are said so', async () => {
  const states = [];
  setOpts({ log: () => {}, onState: (s) => states.push(s), api: async () => { throw Object.assign(new Error('Too many links to check in a minute. Wait a moment, then try again.'), { status: 429 }); } });
  try {
    onMessage({ app: 'phonelink', win: [0, 0, 800, 600], items: [], noTab: true });
    assert.equal(states.at(-1).indicator, false);
    assert.equal(chatwatch.stats().phonelink.otherTab, true);
    judgeTexts('+1 415 555 0199', [{ text: 'Your order is ready at https://shop-orders.top/b', x: 1, y: 2, w: 3, h: 4 }]);
    await new Promise((resolve) => setImmediate(resolve));
    const s = chatwatch.stats().phonelink;
    assert.equal(s.unchecked, 1);
    assert.match(s.why, /Too many links/);
  } finally { setOpts(null); }
});
