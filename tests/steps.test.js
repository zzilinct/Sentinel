'use strict';
/**
 * What to do after a scam is written once (web/assets/js/steps.js) and every place that gives the advice uses it:
 * the results, exposure alerts, the recovery guide, the tech-support scam shield and the password alarm.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { text } = require('../web/assets/js/steps.js');

test('the steps are plain, with no em dashes, and never say a restart ends a connection', () => {
  for (const [id, s] of Object.entries(text)) {
    assert.ok(!s.includes('—'), `${id}: no em dash`);
    assert.ok(!/[‘’“”]/.test(s), `${id}: plain quotes`);
    assert.ok(!/restart/i.test(s), `${id}: an installed AnyDesk or TeamViewer starts again with Windows`);
    assert.match(s, /\.$/, `${id} is a sentence`);
  }
});

test('the companion carries the same copy, and the Windows app gets one', () => {
  assert.equal(read('extension/src/content/steps.js'), read('web/assets/js/steps.js'), 'scripts/build-extension.js copies it; commit the copy');
  assert.match(read('scripts/build-extension.js'), /'steps\.js'\), path\.join\(SRC, 'src', 'content', 'steps\.js'\)/);
  assert.match(read('desktop/scripts/sync-shared.js'), /'steps\.js'\), path\.join\(SHARED, 'steps\.js'\)/);
  const manifest = JSON.parse(read('extension/manifest.json'));
  const entry = manifest.content_scripts.find((c) => c.js.includes('src/content/pwalarm.js'));
  assert.deepEqual(entry.js, ['src/content/steps.js', 'src/content/pwalarm.js'], 'the steps load first');
});

test('every place that gives the advice picks it from the shared steps', () => {
  assert.match(read('web/assets/js/ui.js'), /window\.SentinelSteps/);
  assert.match(read('web/assets/js/app.js'), /window\.SentinelSteps\.text/);
  assert.match(read('extension/src/content/pwalarm.js'), /globalThis\.SentinelSteps\.text\.password/);
  const guard = read('desktop/src/pages/guard.html');
  assert.match(guard, /<script src="\.\.\/\.\.\/shared\/steps\.js"><\/script>/);
  assert.match(guard, /script-src 'unsafe-inline' file:/);
  assert.match(guard, /\['no-call', 'no-connect', 'let-in', 'bank-call'\]\.map\(\(id\) => window\.SentinelSteps\.text\[id\]\)/);
  for (const page of ['web/app.html', 'web/guest.html', 'web/recover.html']) {
    const html = read(page);
    const at = html.indexOf('/assets/js/steps.js');
    assert.ok(at > 0, `${page} loads steps.js`);
    assert.ok(at < html.indexOf(page.endsWith('recover.html') ? '/assets/js/recover.js' : '/assets/js/ui.js'), `${page}: before the script that uses it`);
  }
  // The recovery guide's shared steps are the same words, not copies.
  const { STEPS } = require('../web/assets/js/recover.js');
  for (const id of ['offline', 'remote-off', 'password', 'twostep', 'other-device']) assert.equal(STEPS.find((s) => s.id === id).text, text[id], id);
});
