'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const G = require('../web/assets/js/galaxy.js');

test('a computer gets six arms and a card count that follows the stage area; a phone gets three arms and 14 cards', () => {
  const big = G.profile(1920, 940, 45);
  const laptop = G.profile(1366, 780, 45);
  const phone = G.profile(390, 700, 45);
  assert.equal(big.arms, 6);
  assert.equal(big.n, 45, 'a big screen shows every scene');
  assert.ok(laptop.n < big.n && laptop.n >= 30, `laptop ${laptop.n}`);
  assert.equal(phone.mobile, true);
  assert.equal(phone.arms, 3);
  assert.equal(phone.n, 14);
  assert.ok(phone.turns < big.turns, 'straighter arms on a phone');
});

test('the spiral turns clockwise on screen: angle grows with the journey and with the spin', () => {
  const pr = G.profile(1366, 780, 45);
  const a = G.spiral(pr, 0, 0.3, 0);
  const b = G.spiral(pr, 0, 0.31, 0);
  const c = G.spiral(pr, 0, 0.3, 0.05);
  assert.ok(b.th > a.th && b.r > a.r, 'outward along the arm turns clockwise');
  assert.ok(c.th > a.th, 'the spin turns clockwise');
  // In screen coordinates (y down) a growing angle is clockwise: from the right (+x), it heads down (+y).
  const right = G.spiral({ ...pr, turns: 0 }, 0, 0.5, 0);
  const later = G.spiral({ ...pr, turns: 0 }, 0, 0.5, 0.1);
  assert.ok(right.x > 0 && Math.abs(right.y) < 1e-9 && later.y > 0);
});

test('cards are dealt round the arms with every start inside one journey', () => {
  const seen = new Set();
  for (let k = 0; k < 45; k++) {
    const s = G.slot(k, 45, 6);
    assert.ok(s.u >= 0 && s.u < 1);
    assert.equal(s.arm, k % 6);
    seen.add(`${s.arm}:${s.u.toFixed(4)}`);
  }
  assert.equal(seen.size, 45, 'no two cards share a place');
});

test('sizing leaves neighbours clear of each other once settled', () => {
  const pr = G.profile(1366, 780, 45);
  const cards = Array.from({ length: pr.n }, (_, k) => {
    const s = G.slot(k, pr.n, pr.arms);
    const p = G.spiral(pr, s.arm, s.u, 0);
    return { x: p.x, y: p.y, asp: 1 + (16 / 9 - 1) * Math.min(1, s.u / 0.3), s: 0 };
  });
  for (let pass = 0; pass < 40; pass++) {
    const next = cards.map((c, i) => Math.min(pr.capH, pr.density * G.room(cards, i)));
    next.forEach((s, i) => { cards[i].s = s; });
  }
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i], b = cards[j];
      const apartX = Math.abs(a.x - b.x) >= (a.s * a.asp + b.s * b.asp) / 2 - 0.5;
      const apartY = Math.abs(a.y - b.y) >= (a.s + b.s) / 2 - 0.5;
      assert.ok(apartX || apartY, `cards ${i} and ${j} overlap`);
    }
  }
  assert.ok(Math.max(...cards.map((c) => c.s)) > 60, 'and the outer cards are a readable size');
});

test('the governor sheds cards under 30 frames a second and takes them back slowly when smooth', () => {
  const g = new G.Governor(45);
  for (let i = 0; i < 20 * 3; i++) g.tick(1 / 20);   // three seconds at 20 fps
  assert.ok(g.n < 45, `shed to ${g.n}`);
  const low = g.n;
  for (let i = 0; i < 60 * 7; i++) g.tick(1 / 60);   // seven smooth seconds
  assert.equal(g.n, low + 1);
  g.tick(5);                                          // a pause says nothing
  assert.equal(g.n, low + 1);
  const floor = new G.Governor(45);
  for (let i = 0; i < 5 * 60; i++) floor.tick(1 / 5);
  assert.equal(floor.n, G.P.minCards, 'never below the floor');
});

test('the page lists every scene for the keyboard, each with its picture, verdict and caption, all small', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  const list = html.slice(html.indexOf('<ol class="galaxy__list"'), html.indexOf('</ol>', html.indexOf('<ol class="galaxy__list"')));
  const buttons = [...list.matchAll(/<button type="button" data-img="([^"]+)" data-kind="(scam|virus|malware)" data-tint="(yellow|orange|red)" data-tag="([^"]+)" data-caption="([^"]+)">/g)];
  assert.ok(buttons.length >= 40, `${buttons.length} scenes`);
  const img = path.join(__dirname, '..', 'web', 'assets', 'img');
  let bytes = 0;
  for (const [, file, , , tag, caption] of buttons) {
    assert.ok(fs.existsSync(path.join(img, file)), file);
    bytes += fs.statSync(path.join(img, file)).size;
    assert.doesNotMatch(tag + caption, /—/, 'no em dashes');
  }
  assert.ok(bytes < 1.5 * 1024 * 1024, `${bytes} bytes of pictures`);
  assert.ok(buttons.filter(([, f]) => f.startsWith('galaxy/')).length >= 30, 'at least 30 scam scenes');
});
