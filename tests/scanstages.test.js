'use strict';
// Real scan stages: a client that asks gets one line per stage as it starts, in the order the scan really runs, and
// every other client gets the plain answer it always got. Also that nothing in the scan flow holds an answer back.
process.env.NODE_ENV = 'test';
process.env.RESEARCH_ALLOW_PRIVATE = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startFixtureServer, applyFacts, client, startApp } = require('./fixtures');

let app;
let fixture;
test.before(async () => {
  fixture = await startFixtureServer();
  process.env.RESEARCH_TEST_PORT = String(fixture.address().port);
  app = await startApp();
  applyFacts();
});
test.after(() => { app.server.close(); fixture.close(); });

let n = 0;
async function newUser(plan) {
  const c = client(app.base);
  const email = `stages${++n}_${Date.now()}@example.com`;
  assert.equal((await c.post('/api/v1/auth/signup', { email, password: 'Correct-Horse-42', firstName: 'Test', lastName: '', ageConfirmed: true, termsAccepted: true })).status, 201);
  const login = await fetch(`${app.base}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.base }, body: JSON.stringify({ email, password: 'Correct-Horse-42' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((s) => s.split(';')[0]).join('; ');
  if (plan) assert.equal((await fetch(`${app.base}/api/v1/billing/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: app.base, Cookie: cookie }, body: JSON.stringify({ plan }) })).status, 200);
  return (route, body, headers = {}) => fetch(`${app.base}/api/v1${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Origin: app.base, Cookie: cookie, ...headers },
    body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  });
}

const lines = async (res) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
const ids = (all) => [...new Set(all.filter((l) => l.stage).map((l) => l.stage))];

test('a delicate link scan reports its stages in the order they run, then the verdict', async () => {
  const scan = await newUser('pro');
  const res = await scan('/scan/link', { url: `http://127.0.0.1:${fixture.address().port}/stages-${Date.now()}`, mode: 'delicate' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /ndjson/);
  const all = await lines(res);
  assert.deepEqual(ids(all), ['knowledge', 'compare', 'research', 'checklist']);
  const research = all.filter((l) => l.stage === 'research');
  assert.deepEqual(research.map((l) => l.done), [0, 1, 2, 3], 'each lookup is reported as it comes back');
  assert.ok(research.every((l) => l.total === 3));
  const last = all[all.length - 1];
  assert.equal(last.result.verdict.kind, 'url');
  assert.equal(last.result.scanMode, 'delicate');
  assert.ok(last.result.usage.deepScans.used >= 1);
});

test('a fast scan does not pretend to research', async () => {
  const scan = await newUser();
  const all = await lines(await scan('/scan/link', { url: `https://stages-fast-${Date.now()}.example/`, mode: 'fast' }));
  assert.deepEqual(ids(all), ['knowledge', 'compare', 'checklist']);
});

test('a scan answered from the cache has no stages to report, and is plain JSON', async () => {
  const scan = await newUser();
  const url = `https://stages-cached-${Date.now()}.example/`;
  await (await scan('/scan/link', { url, mode: 'fast' })).text();
  const again = await scan('/scan/link', { url, mode: 'fast' });
  assert.match(again.headers.get('content-type'), /application\/json/);
  assert.equal((await again.json()).verdict.kind, 'url');
});

test('a client that does not ask gets plain JSON, stages or not', async () => {
  const scan = await newUser();
  const res = await scan('/scan/link', { url: `https://stages-plain-${Date.now()}.example/`, mode: 'fast' }, { Accept: 'application/json' });
  assert.match(res.headers.get('content-type'), /application\/json/);
  assert.equal((await res.json()).verdict.kind, 'url');
});

test('a refused scan keeps its status: nothing is written before the scan is under way', async () => {
  const scan = await newUser();
  const res = await scan('/scan/link', { url: 'not a link at all' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'bad_url');
});

test('an email reports each link as it is checked', async () => {
  const scan = await newUser('max');
  const all = await lines(await scan('/scan/email', { from: 'Bank <help@stages-mail.example>', subject: 'Hello', body: 'Look at https://stages-one.example/a and https://stages-two.example/b', links: [{ href: 'https://stages-one.example/a', text: '' }, { href: 'https://stages-two.example/b', text: '' }] }));
  assert.deepEqual(ids(all), ['message', 'links']);
  const links = all.filter((l) => l.stage === 'links');
  assert.deepEqual(links.map((l) => l.done), Array.from({ length: links[0].total + 1 }, (_, i) => i));
  assert.equal(all[all.length - 1].result.verdict.kind, 'email');
});

test('a text reports reading it, its links, and the conversation', async () => {
  const scan = await newUser();
  const all = await lines(await scan('/scan/text', { from: '', text: 'Your order is ready, details at https://stages-text.example/x' }));
  assert.deepEqual(ids(all), ['message', 'links', 'conversation']);
  assert.ok(all[all.length - 1].result.text);
  const plain = await lines(await scan('/scan/text', { from: '', text: 'see you at 5' }));
  assert.deepEqual(ids(plain), ['message', 'conversation'], 'no links, no links stage');
});

test('a file reports being inspected once it has arrived', async () => {
  const scan = await newUser();
  const res = await scan('/scan/file', Buffer.from('hello there'), { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'note.txt' });
  const all = await lines(res);
  assert.deepEqual(ids(all), ['inspect']);
  assert.equal(all[all.length - 1].result.verdict.kind, 'file');
});

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('nothing waits for the animation: the result is drawn first, and no scan has a minimum length', () => {
  const app_ = read('web/assets/js/app.js');
  assert.doesNotMatch(app_, /await\s+\w*\.finish\(/);
  assert.doesNotMatch(app_, /setInterval\(step/, 'no stage is advanced by a timer');
  assert.doesNotMatch(read('web/assets/js/home.js'), /await\s+dig\.finish\(/);
  assert.doesNotMatch(read('desktop/src/pages/overlay.html'), /DIG_MIN_MS/);
});

test('the dig draws nothing by chance: its frames have no random numbers, and no colour cycling', () => {
  const src = read('web/assets/js/binary.js');
  const dig = src.slice(src.indexOf('function dig('), src.indexOf('a heading out of binary'));
  assert.doesNotMatch(dig, /Math\.random/);
  assert.doesNotMatch(src, /LINK_CYCLE/);
});
