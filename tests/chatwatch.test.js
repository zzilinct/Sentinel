'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('../desktop/scripts/sync-shared.js');
const chatwatch = require('../desktop/src/chatwatch.js');
const { robloxMessages, readLog, discordContext, judge, SCRIPT } = chatwatch._test;

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
