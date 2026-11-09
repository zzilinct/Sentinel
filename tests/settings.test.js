'use strict';
// Settings (/app/settings) is the one home for every choice: each switch the Windows app offers is one row there,
// exactly once, and nothing that moved is left behind on the page it came from. Old addresses still land on their row.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const web = path.join(__dirname, '..', 'web');
const app = fs.readFileSync(path.join(web, 'assets', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(web, 'app.html'), 'utf8');

const between = (start, end) => {
  const a = app.indexOf(start);
  assert.ok(a >= 0, `app.js has ${start}`);
  const b = app.indexOf(end, a + start.length);
  assert.ok(b > a, `app.js has ${end} after ${start}`);
  return app.slice(a, b);
};
const rows = between('const SETTINGS = [', '\n  ];');
const ids = [...rows.matchAll(/\{ id: '([\w-]+)'|appSwitch\(\{ id: '([\w-]+)'/g)].map((m) => m[1] || m[2]);
const groups = [...between('const SETTING_GROUPS = [', '];').matchAll(/\['([\w-]+)', '[^']+'\]/g)].map((m) => m[1]);
const fn = (name) => between(`function ${name}(`, '\n  }\n');

// Every choice the Windows app takes. Each one is saved from Settings and nowhere else.
const SETTERS = ['setLiveMode', 'setAutoScan', 'setDownloadProtection', 'setDefense', 'setMySites', 'setScanMenu', 'setOpenAtLogin',
  'setClipboardCheck', 'setCommandShield', 'setWalletGuard', 'setRemoteGuard', 'setSnip', 'setChatSafety', 'setTextSafety',
  'setExposureAlerts', 'setWeekRecap'];
// The "New in Sentinel" cards may turn one on (never off), as the person answers them.
const ASKED = { setChatSafety: 'askChatSafety', setExposureAlerts: 'askExposureAlerts' };

test('settings: every row has its own address, and none is taken by a group', () => {
  assert.ok(ids.length >= 25, `rows: ${ids.length}`);
  assert.deepStrictEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'no row twice');
  assert.deepStrictEqual(ids.filter((id) => groups.includes(id)), [], 'a row id is not a group id');
  for (const g of groups) assert.ok(new RegExp(`group: '${g}'`).test(rows), `group ${g} has a row`);
  for (const slot of ['look', 'motion']) assert.ok(groups.includes(slot), `the ${slot} group is there for the look and motion settings`);
});

test('settings: every switch of the Windows app is a row, exactly once', () => {
  for (const setter of SETTERS) {
    const inRows = rows.split(`'${setter}'`).length - 1 + rows.split(`desktop.${setter}(`).length - 1;
    assert.ok(inRows >= 1, `${setter} is saved from a Settings row`);
    const named = rows.split(`method: '${setter}'`).length - 1;
    assert.ok(named <= 1, `${setter} is the method of one row only (${named})`);
    // Outside the rows, only the card that asks once may call it.
    const outside = app.replace(rows, '');
    const calls = outside.split(`desktop.${setter}(`).length - 1;
    const allowed = ASKED[setter] ? fn(ASKED[setter]).split(`desktop.${setter}(`).length - 1 : 0;
    assert.strictEqual(calls, allowed, `${setter} is not switched anywhere else in the app`);
  }
  assert.ok(/'lockStatus'/.test(rows) && /renderParentLock\(body\)/.test(rows), 'the parent lock is a row');
});

test('settings: Live protection and Your week keep status, not switches', () => {
  for (const name of ['protectionView', 'renderDesktopControls', 'weekView']) {
    const body = fn(name);
    assert.ok(!/class="switch"/.test(body), `${name} draws no switch`);
    assert.ok(!/data-parent-lock|renderParentLock/.test(body), `${name} has no parent lock`);
  }
  assert.ok(/href="\/app\/settings#protection"/.test(fn('protectionView')), 'Live protection says where its choices are');
  for (const gone of ['function securityView', 'function chatSafetyPanel', 'function textSafetyPanel', 'function mySitesPanel', 'data-week-recap']) {
    assert.ok(!app.includes(gone), `${gone} is gone`);
  }
});

test('settings: old addresses open Settings at their row', () => {
  const moved = between('const MOVED_TO_SETTINGS = [', '];').match(/'([\w-]+)'/g).map((s) => s.slice(1, -1));
  assert.ok(moved.length >= 4);
  for (const id of moved) assert.ok(ids.includes(id), `#${id} is a row`);
  assert.ok(groups.includes('account'), '/app/security opens the account group');
  assert.ok(/path === '\/app\/security'/.test(fn('render')), 'render sends /app/security to Settings');
  assert.ok(/'\/app\/settings': \['settings', settingsView\]/.test(app));
  assert.ok(!/'\/app\/security':/.test(app), 'no Security page of its own');
});

test('settings: the side bar has one Settings link in place of the Account group', () => {
  assert.ok(/href="\/app\/settings" data-route="settings"/.test(html));
  for (const old of ['data-route="plan"', 'data-route="security"', 'data-route="assistants"', 'href="/app/security"', '>Account</div>']) {
    assert.ok(!html.includes(old), `side bar has no ${old}`);
  }
  assert.ok(/href="\/assets\/css\/settings\.css"/.test(html));
  assert.ok(/\['Settings', '\/app\/settings', 'settings'\]/.test(app), 'the palette lists Settings');
  assert.ok(/for \(const r of SETTINGS\) if \(settingMatches\(r, q\)\)/.test(fn('openPalette')), 'the palette finds single settings');
});
