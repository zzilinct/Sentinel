'use strict';
// Settings (/app/settings) is the one home for every choice: each switch the Windows app offers is one row there,
// exactly once, and nothing that moved is left behind on the page it came from. Old addresses still land on their row.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const web = path.join(__dirname, '..', 'web');
const app = require('./fixtures').appScript().replace(/\r\n/g, '\n');
const html = fs.readFileSync(path.join(web, 'app.html'), 'utf8');

const between = (start, end) => {
  const a = app.indexOf(start);
  assert.ok(a >= 0, `app.js has ${start}`);
  const b = app.indexOf(end, a + start.length);
  assert.ok(b > a, `app.js has ${end} after ${start}`);
  return app.slice(a, b);
};
// Settings' rows, the first-run ones (app/first.js ROW) among them, each in its place in SETTINGS.
const firstRows = between('const ROW = Object.fromEntries([', '\n  ].map(');
const rows = between('const SETTINGS = [', '\n  ];') + firstRows;
for (const [, id] of firstRows.matchAll(/\{ id: '([\w-]+)'/g)) assert.match(rows, new RegExp(`ROW(\\.${id}|\\['${id}'\\]),`), `${id} is in SETTINGS`);
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
  for (const slot of ['look', 'moving']) assert.ok(groups.includes(slot), `the ${slot} group is there for the look and motion settings`);
});

test('settings: every switch of the Windows app is a row, exactly once', () => {
  for (const setter of SETTERS) {
    const inRows = rows.split(`'${setter}'`).length - 1 + rows.split(`desktop.${setter}(`).length - 1;
    assert.ok(inRows >= 1, `${setter} is saved from a Settings row`);
    const named = rows.split(`method: '${setter}'`).length - 1;
    assert.ok(named <= 1, `${setter} is the method of one row only (${named})`);
    // Outside the rows, only the card that asks once may call it.
    const outside = app.replace(rows.slice(0, rows.length - firstRows.length), '').replace(firstRows, '');
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
  assert.ok(/'\/app\/settings': \['settings', page\('settings', 'settingsView'\)\]/.test(app));
  assert.ok(!/'\/app\/security':/.test(app), 'no Security page of its own');
});

test('settings: the side bar has one Settings link in place of the Account group', () => {
  assert.ok(/href="\/app\/settings" data-route="settings"/.test(html));
  for (const old of ['data-route="plan"', 'data-route="security"', 'data-route="assistants"', 'href="/app/security"', '>Account</div>']) {
    assert.ok(!html.includes(old), `side bar has no ${old}`);
  }
  // Its styles come with its own file (app.js FILES), not with every page of the app.
  assert.ok(!/settings\.css/.test(html) && /settings: \['\/assets\/js\/app\/first\.js', '\/assets\/css\/settings\.css'\]/.test(app), 'settings.css comes with Settings');
  assert.ok(/\['Settings', '\/app\/settings', 'settings'\]/.test(app), 'the palette lists Settings');
  assert.ok(/for \(const r of SETTINGS\) if \(settingMatches\(r, q\)\)/.test(fn('openPalette')), 'the palette finds single settings');
});

test('home and Live protection call on only what is running: no "Protection is on", no switched-off feature marked On', () => {
  const teaser = fn('protectionTeaser');
  assert.doesNotMatch(teaser, /Protection is on/);
  assert.match(teaser, /downloads\.active/);
  assert.match(teaser, /defense\.active/);
  const page = fn('protectionView');
  assert.doesNotMatch(page, /st\(!lock && desktop,/, 'page warnings and search marks are On only while live scanning is');
  assert.match(page, /st\(!lock && liveOn, lock \|\| 'Off'\)/);
});

// Settings shows one section at a time (settingsView): five sections, each holding some groups, so a row is on exactly one page.
const sections = [...between('const SETTING_SECTIONS = [', '\n  ];').matchAll(/\['([\w-]+)', '[^']+', '[^']+', \[([^\]]*)\]\]/g)].map((m) => [m[1], [...m[2].matchAll(/'([\w-]+)'/g)].map((g) => g[1])]);
const rowGroup = Object.fromEntries([...rows.matchAll(/(?:\{|appSwitch\(\{) id: '([\w-]+)',(?: kind: '\w+',)? group: '([\w-]+)'/g)].map((m) => [m[1], m[2]]));

test('settings: every group is on exactly one section page, so every row is reachable from one place', () => {
  assert.strictEqual(sections.length, 5);
  const held = sections.flatMap(([, gs]) => gs);
  assert.deepStrictEqual([...held].sort(), [...groups].sort(), 'each group is in a section, once');
  for (const [id] of sections) assert.ok(groups.includes(id), `section ${id} is also a group, so an old #${id} address still lands`);
  // The first-run rows carry their group in first.js's ROW; every row's group must be one a section holds.
  for (const id of ids) {
    const g = rowGroup[id] || [...rows.matchAll(new RegExp(`id: '${id}'[^]*?group: '([\w-]+)'`, 'g'))].map((m) => m[1])[0];
    assert.ok(held.includes(g), `row ${id} (group ${g}) is on a section page`);
  }
});

test('settings: every address that points into Settings lands on a row or a group', () => {
  const found = new Set();
  const look = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (!/node_modules|bundle|dist|fonts|img/.test(f.name)) look(p); continue; }
    if (!/\.(js|html)$/.test(f.name)) continue;
    for (const [, id] of fs.readFileSync(p, 'utf8').matchAll(/app\/settings#([\w-]+)/g)) found.add(id);
  } };
  look(web); look(path.join(__dirname, '..', 'desktop', 'src'));
  assert.ok(found.size >= 8, `addresses found: ${[...found].join()}`);
  for (const id of found) assert.ok(ids.includes(id) || groups.includes(id), `/app/settings#${id} names a row or a group`);
  // The router sends the older Live protection addresses to the same rows.
  for (const id of between('const MOVED_TO_SETTINGS = [', '];').match(/'([\w-]+)'/g).map((s) => s.slice(1, -1))) assert.ok(ids.includes(id), `#${id} is a row`);
});

test('settings: a phone opens on the list of sections, a wide screen on Appearance, and the search shows matches from every section', () => {
  const view = fn('settingsView');
  assert.match(view, /sectionOf\(location\.hash\.slice\(1\)\) \|\| \(wide\.matches \? 'look' : ''\)/, 'no address: Appearance on a wide screen, the list on a phone');
  assert.match(view, /x\.hidden = !finding && x\.dataset\.setSec !== s/, 'searching shows every section');
  assert.match(view, /href="\/app\/settings#\$\{s\}"/, 'the phone list links are real addresses, so Back works');
  assert.doesNotMatch(view, /IntersectionObserver/, 'no scroll watcher: the section list is marked by the section open');
});
