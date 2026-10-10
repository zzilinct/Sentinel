'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ui.js in a bare window: emailSteps reads only the verdict, and the shared steps from steps.js.
const win = { SentinelSteps: require('../web/assets/js/steps.js') };
win.window = win;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'assets', 'js', 'ui.js'), 'utf8'), win);
const steps = (...found) => win.UI.emailSteps({ kind: 'email', checklist: { items: [...found.map((id) => ({ id, status: 'fail' })), { id: 'E13', status: 'pass' }, { id: 'E21', status: 'skip' }] } });
const has = (list, re) => list.some((s) => re.test(s));

test('an email is never told about "this page", and always ends with how to check with the company', () => {
  for (const list of [steps(), steps('E31'), steps('E03', 'E10', 'E13', 'E21', 'E07')]) {
    assert.ok(!has(list, /page/), list.join(' | '));
    assert.match(list[0], /^Do not reply/);
    assert.match(list[list.length - 1], /^Not sure\? Contact the company the way you normally do/);
    assert.ok(list.every((s) => !s.includes('—')), 'no em dashes');
  }
});

test('only what was found: nothing found means just do not reply and check', () => {
  assert.equal(steps().length, 2);
  assert.equal(steps('E05', 'E08').length, 2, 'wording alone adds no step about links or files');
});

test('each finding brings its own step', () => {
  assert.match(steps('E03')[0], /would go to the people who sent it/, 'a reply-to elsewhere says why not to reply');
  assert.doesNotMatch(steps()[0], /would go/);
  for (const id of ['E10', 'E11', 'E12', 'E29', 'EL-scam']) {
    const list = steps(id);
    assert.ok(has(list, /^Do not open its links/), id);
    assert.ok(has(list, /^Already entered a password\?/), id);
  }
  for (const id of ['E13', 'E14', 'E15', 'E16', 'E17', 'E27']) {
    const list = steps(id);
    assert.ok(has(list, /^Do not open the attachment/), id);
    assert.ok(has(list, /^Already opened it\?/), id);
  }
  assert.ok(has(steps('E21'), /^Do not call the number in the email/));
  for (const id of ['E07', 'E19', 'E20', 'E23', 'E24', 'E25']) assert.ok(has(steps(id), /gift cards/), id);
});

test('a check that passed or was skipped adds nothing', () => {
  const list = steps();
  assert.ok(!has(list, /attachment|call the number|links/));
});

test('a warning counts as found, in the order a person meets them', () => {
  const list = win.UI.emailSteps({ kind: 'email', checklist: { items: [{ id: 'E21', status: 'warn' }, { id: 'E14', status: 'fail' }, { id: 'E10', status: 'warn' }] } });
  const at = (re) => list.findIndex((s) => re.test(s));
  assert.ok(at(/^Do not reply/) < at(/links/) && at(/links/) < at(/attachment/) && at(/attachment/) < at(/call the number/), list.join(' | '));
});
