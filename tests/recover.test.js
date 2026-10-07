'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { SITUATIONS, STEPS, REPORT, plan, countryFor, happenedFrom } = require('../web/assets/js/recover.js');

test('recovery guide: nothing ticked, no steps', () => {
  assert.deepEqual(plan([]), []);
  assert.deepEqual(plan(), []);
});

test('recovery guide: steps are for what happened, most urgent first, each once', () => {
  const ids = plan(['card']).map((s) => s.id);
  assert.equal(ids[0], 'stop');
  assert.ok(ids.includes('card'));
  assert.ok(!ids.includes('remote-off'), 'nothing about remote access when nobody connected');
  assert.ok(ids.includes('report') && ids.includes('talk'), 'everyone gets the reporting and support steps');

  const both = plan(['password', 'code']);
  assert.equal(both.filter((s) => s.id === 'password').length, 1, 'a step shared by two situations shows once');

  for (const picked of [['remote'], ['crypto', 'identity'], SITUATIONS.map((s) => s.id)]) {
    const whens = plan(picked).map((s) => s.when);
    assert.deepEqual(whens, [...whens].sort((a, b) => a - b), `${picked} is not in order of urgency`);
  }
  // Someone connected to the computer: get it offline before anything else on it.
  const remote = plan(['remote']).map((s) => s.id);
  assert.ok(remote.indexOf('offline') < remote.indexOf('scan'));
});

test('recovery guide: every situation leads to a step of its own, and every step is reachable', () => {
  const known = new Set(SITUATIONS.map((s) => s.id));
  for (const s of SITUATIONS) assert.ok(STEPS.some((st) => st.for && st.for.includes(s.id)), `${s.id} has no step`);
  for (const st of STEPS) for (const id of st.for || []) assert.ok(known.has(id), `${st.id} names unknown ${id}`);
});

test('recovery guide: country from the browser language', () => {
  assert.equal(countryFor('en-GB'), 'uk');
  assert.equal(countryFor('en-US'), 'us');
  assert.equal(countryFor('fr-CA'), 'ca');
  assert.equal(countryFor('en-AU'), 'au');
  assert.equal(countryFor('de-DE'), 'other');
  assert.equal(countryFor('en'), 'us');
  assert.equal(countryFor('ja'), 'other');
  assert.equal(countryFor(''), 'other');
});

test('recovery guide: plain words, official https places, no em dashes', () => {
  const text = [...SITUATIONS.map((s) => s.label), ...STEPS.map((s) => s.text), ...Object.values(REPORT).flatMap((c) => c.places.map(([l]) => l))].join('\n');
  assert.ok(!text.includes('—'), 'no em dashes');
  for (const c of Object.values(REPORT)) for (const [, url] of c.places) if (url) assert.match(url, /^https:\/\/[a-z0-9.-]+\//);
  const page = fs.readFileSync(path.join(__dirname, '..', 'web', 'recover.html'), 'utf8');
  assert.ok(!page.includes('—') && !page.includes('&mdash;'), 'no em dashes on the page');
  assert.match(page, /<script src="\/assets\/js\/recover\.js"><\/script>/);
});

test('recovery guide: a link from a warning ticks what it was about, and nothing the page does not know', () => {
  assert.deepEqual(happenedFrom('?happened=password'), ['password']);
  assert.deepEqual(happenedFrom('?happened=remote,card,remote'), ['remote', 'card']);
  assert.deepEqual(happenedFrom('?happened=<script>,bank'), ['bank']);
  assert.deepEqual(happenedFrom(''), []);
  assert.deepEqual(happenedFrom('?other=1'), []);
  // Every place that links here asks only for situations the guide has.
  const ids = new Set(SITUATIONS.map((s) => s.id));
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const file of ['web/assets/js/ui.js', 'web/assets/js/app.js']) {
    const map = /HAPPENED = \{([^}]*)\}/.exec(read(file));
    assert.ok(map, `${file} has its HAPPENED map`);
    for (const m of map[1].matchAll(/: '([a-z]+)'/g)) assert.ok(ids.has(m[1]), `${file}: ${m[1]}`);
  }
});
