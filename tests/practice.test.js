'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const P = require('../web/assets/js/practice.js');
const { POOL, TELLS, DRAW, ADVICE, isScam, isQuiet, parse, plain, preview, draw, judge, words, secondLook, summary } = P;

/** A repeatable random source, so a failure can be replayed. */
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const hasDeadline = (m) => /\b(by (\d|Friday|5pm|6pm)|within \d+|due (on|by|back)|expires)\b/i.test(plain(m));

test('practice: the false lesson cannot be learned, real messages have links and deadlines and scams can have neither', () => {
  const real = POOL.filter((m) => !isScam(m));
  assert.ok(real.filter((m) => m.link).length >= 6, 'real messages with a link');
  assert.ok(real.filter((m) => m.due).length >= 6, 'real messages with a real deadline');
  assert.ok(real.filter((m) => m.link && m.due).length >= 3, 'real messages with both');
  assert.ok(POOL.filter(isQuiet).length >= 5, 'scams with no link and no deadline');
  assert.ok(POOL.some((m) => isScam(m) && !m.sender.bad && !(m.link && m.link.bad)), 'a scam whose sender and link are both fine: the ask is all that gives it away');
  assert.ok(POOL.some((m) => isScam(m) && !m.ask.bad), 'a scam whose ask is ordinary');
});

test('practice: the deadline flag says what the message says', () => {
  for (const m of POOL) assert.equal(Boolean(m.due), hasDeadline(m), `${m.id}: "${plain(m)}"`);
});

test('practice: the three questions hold on every example, a scam always fails one and a real message none', () => {
  for (const m of POOL) {
    const bad = TELLS.filter((k) => m[k] && m[k].bad);
    assert.equal(isScam(m), bad.length > 0, m.id);
    assert.ok(m.id.endsWith('-real') ? !bad.length : bad.length, `${m.id}: named against its verdict`);
  }
  // The third question says stop at these. No real message may ask for them.
  for (const m of POOL.filter((x) => !isScam(x))) {
    const ask = parse(m.body).filter((p) => p.ask).map((p) => p.text).join(' ');
    assert.doesNotMatch(ask, /gift card|read (it )?out|new (bank|account)|security code|password\?/i, `${m.id}: ${ask}`);
    assert.ok(!m.link || !m.link.to.includes('.top') && !m.link.to.includes('.ru'), m.id);
  }
});

test('practice: each message is complete, with one reason for each thing it can be judged on', () => {
  assert.equal(new Set(POOL.map((m) => m.id)).size, POOL.length, 'unique ids');
  assert.ok(POOL.length >= 28, 'a pool far larger than one deal');
  for (const m of POOL) {
    const pieces = parse(m.body);
    assert.ok(m.addr && m.from && m.sender.why && m.ask.why, m.id);
    assert.equal(pieces.filter((p) => p.ask).length, 1, `${m.id}: one ask`);
    assert.equal(pieces.filter((p) => p.link).length, m.link ? 1 : 0, `${m.id}: link in body and data disagree`);
    if (m.link) assert.ok(m.link.to.includes(m.link.root) && m.link.why, m.id);
    if (m.root) assert.ok(m.addr.includes(m.root), m.id);
    if (m.kind === 'email') assert.ok(m.subject, `${m.id}: an email has a subject`);
  }
});

test('practice: twins read the same in the list, so the list alone gives nothing away', () => {
  const pairs = new Map();
  for (const m of POOL) pairs.set(m.pair, [...(pairs.get(m.pair) || []), m]);
  const twins = [...pairs.values()].filter((p) => p.length === 2);
  assert.ok(twins.length >= 12, 'most messages have a twin');
  for (const [a, b] of twins) {
    assert.equal(a.from, b.from, a.pair);
    assert.equal(a.subject, b.subject, a.pair);
    assert.equal(preview(a), preview(b), a.pair);
    assert.notEqual(isScam(a), isScam(b), `${a.pair}: one real and one scam`);
  }
});

test('practice: every deal is fair and differs, and the next deal shares nothing with the last', () => {
  const orders = new Set();
  for (let s = 1; s <= 3000; s++) {
    const rng = seeded(s);
    const one = draw(rng);
    const two = draw(rng, new Set(one.map((m) => m.id)));
    for (const deck of [one, two]) {
      assert.equal(deck.length, DRAW);
      assert.equal(new Set(deck.map((m) => m.pair)).size, DRAW, 'never both twins in one deal');
      const scams = deck.filter(isScam).length;
      assert.ok(scams >= 4 && scams <= 6, `${scams} scams`);
      assert.ok(deck.filter((m) => !isScam(m) && (m.link || m.due)).length >= 3, 'real ones with a link or a deadline');
      assert.ok(deck.filter(isQuiet).length >= 2, 'quiet scams');
    }
    assert.ok(!two.some((m) => one.includes(m)), 'a message came back on the second go');
    orders.add(one.map((m) => m.id).join());
  }
  assert.ok(orders.size > 2990, `only ${orders.size} different deals in 3000`);
});

test('practice: the same scenario on a second go is as likely to be the other twin, so memory does not help', () => {
  let flips = 0;
  let returned = 0;
  for (let s = 1; s <= 1000; s++) {
    const rng = seeded(s);
    const one = draw(rng);
    const two = draw(rng, new Set(one.map((m) => m.id)));
    for (const m of two) {
      const was = one.find((x) => x.pair === m.pair);
      if (was) { returned++; if (isScam(was) !== isScam(m)) flips++; }
    }
  }
  assert.ok(returned > 1000, `${returned} returned`);
  assert.equal(flips, returned, 'a scenario that came back is always the other twin');
});

test('practice: reporting everything is not a good score, it grades the sign named as well as the button', () => {
  const m = POOL.find((x) => x.id === 'supplier-scam');
  assert.deepEqual(judge(m, 'ask'), { scam: true, reported: true, right: true, named: true, main: 'ask' });
  assert.equal(judge(m, 'sender').named, false, 'the address is right, so naming it earns nothing');
  assert.equal(judge(m, 'sender').right, true, 'but reporting it was right');
  assert.equal(judge(m, 'unsure').named, false);
  assert.equal(judge(m, 'fine').right, false);
  const real = POOL.find((x) => x.id === 'parcel-real');
  assert.equal(judge(real, 'link').right, false);
  assert.equal(judge(real, 'fine').right, true);

  const log = POOL.slice(0, 10).map((x) => ({ m: x, choice: 'unsure', looked: { sender: false, link: false } }));
  const s = summary(log);
  assert.equal(s.caught, s.scams);
  assert.equal(s.kept, 0);
  assert.notEqual(s.work, 'none');
});

test('practice: the end result names what was missed and counts only what happened', () => {
  const pick = (id, choice, looked = { sender: true, link: true }) => ({ m: POOL.find((x) => x.id === id), choice, looked });
  const a = summary([pick('supplier-scam', 'fine', { sender: false, link: false }), pick('bank-scam', 'unsure'), pick('library-scam', 'sender'), pick('order-real', 'fine')]);
  assert.equal(a.scams, 3);
  assert.equal(a.caught, 2);
  assert.equal(a.by.ask.total, 2);
  assert.equal(a.by.ask.spotted, 0);
  assert.equal(a.by.sender.spotted, 1);
  assert.equal(a.work, 'ask');
  assert.equal(a.advice, ADVICE.ask);
  assert.deepEqual(a.looked.sender, { done: 3, total: 4 });
  assert.deepEqual(a.looked.link, { done: 2, total: 2 });

  assert.equal(summary([pick('parcel-real', 'link'), pick('bank-scam', 'ask')]).work, 'alarm');
  assert.equal(summary([pick('parcel-real', 'fine'), pick('bank-scam', 'ask')]).work, 'none');
  const second = summary([pick('bank-real', 'fine'), { ...pick('desk-scam', 'sender'), second: true }]);
  assert.equal(second.scams, 0, 'a second look is not in the first count');
  assert.deepEqual(second.again, { right: 1, total: 1 });
});

test('practice: a miss comes back as a new message of the same kind, never the same one, and the list cannot give the answer', () => {
  for (let s = 1; s <= 500; s++) {
    const rng = seeded(s);
    const deck = draw(rng);
    const log = deck.map((m) => ({ m, choice: 'fine', looked: { sender: false, link: false } }));   // every scam missed
    const more = secondLook(log, rng);
    assert.ok(more.length >= 2 && more.length <= 4, `${more.length} came back`);
    for (const m of more) assert.ok(!deck.some((d) => d.pair === m.pair), `${m.id} came from this deal`);
    assert.ok(more.some(isScam) && more.some((m) => !isScam(m)), 'all one sort would give the answer away');
  }
  // One scam let through, whatever it was and whatever else this deal used up, always brings a second look.
  for (let s = 1; s <= 300; s++) {
    const rng = seeded(s);
    const deck = draw(rng);
    for (const miss of deck.filter(isScam)) {
      const log = deck.map((m) => ({ m, choice: m === miss ? 'fine' : isScam(m) ? 'unsure' : 'fine', looked: {} }));
      const more = secondLook(log, rng);
      const sign = judge(miss, 'fine').main;
      assert.ok(more.some((m) => m[sign] && m[sign].bad), `${s} ${miss.id}: no new message with a bad ${sign}`);
      assert.ok(more.some((m) => !isScam(m)), `${s} ${miss.id}: only scams came back`);
    }
  }
  assert.deepEqual(secondLook(POOL.slice(0, 4).map((m) => ({ m, choice: isScam(m) ? 'ask' : 'fine', looked: {} }))), [], 'nothing missed, nothing back');
});

test('practice: the words never scold, and one that names a sign is true of that message', () => {
  for (const m of POOL) {
    for (const choice of ['fine', 'unsure', ...TELLS.filter((k) => m[k])]) {
      for (const looked of [{ sender: false, link: false }, { sender: true, link: true }]) {
        const w = words(m, choice, looked);
        assert.ok(w.h && w.p, m.id);
        assert.doesNotMatch(`${w.h} ${w.p}`, /\b(fail|failed|wrong|bad|poor|stupid)\b/i, `${m.id}: ${w.h} ${w.p}`);
      }
    }
  }
});

test('practice: made up, inert and plain, no addresses a page could turn into links, no em dashes', () => {
  const text = POOL.flatMap((m) => [m.from, m.addr, m.subject, m.body, m.context, m.sender.why, m.ask.why, m.link && m.link.to, m.link && m.link.why]).filter(Boolean).join('\n');
  assert.ok(!text.includes('—'), 'no em dashes');
  assert.doesNotMatch(text, /https?:\/\/|www\./i);
  assert.doesNotMatch(text, /<[a-z]/i, 'no markup in the messages');
  // Phone numbers only from the ranges kept for drama, so none rings a real person.
  for (const n of text.match(/\+\d[\d ()]{8,}/g) || []) assert.match(n.trim(), /^\+44 7700 900\d{3}$|^\+1 \(555\) 01\d\d$/, n);
  const web = path.join(__dirname, '..', 'web');
  const page = fs.readFileSync(path.join(web, 'practice.html'), 'utf8');
  const code = fs.readFileSync(path.join(web, 'assets', 'js', 'practice.js'), 'utf8');
  assert.ok(!page.includes('—') && !page.includes('&mdash;') && !code.includes('—'), 'no em dashes on the page');
  assert.match(page, /<script src="\/assets\/js\/practice\.js"><\/script>/);
  assert.equal((page.match(/<h1[\s>]/g) || []).length, 1);
  assert.ok(!/<a\b[^>]*class="plink|href="\$\{.*link/.test(code), 'a message link is never a real link');
});
