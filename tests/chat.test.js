'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { conversation, placeKinds } = require('../server/lib/scan/chat');

// Ordinary chat, in the places it happens: none of it may be flagged.
const ORDINARY = [
  [{ game: 'Brookhaven 🏡RP', description: 'Hang out, role play, own a house in town' }, [
    'where do you live', 'i live in the big blue house', 'can i come to your house', 'my mom said dinner is ready lol', 'brb',
    'how old are you in the rp', 'im the dad', 'lets go to the school', 'whats your house number', 'ok bye guys']],
  [{ game: 'Adopt Me!', description: 'Raise and trade pets' }, [
    'trade?', 'what do you want for your neon unicorn', 'w/f/l', 'add more pls', 'deal', 'accept the trade', 'u got any legendaries',
    'trading frost dragon', 'that is a fair trade']],
  [{ game: 'Arsenal', description: 'Fast-paced shooter' }, [
    'ez', 'i will kill you next round', 'get rekt', 'camper', 'gg', 'nice shot', 'you are dead', 'reload!!']],
  [{ game: 'Doors', description: 'Survive the horror hotel' }, [
    'hide in the closet', 'where are you', 'are you alone in that room', 'wait for me', 'its behind you', 'how old r u', 'lol 11']],
  [{ server: 'Minecraft builders', channel: 'general' }, [
    'anyone wanna play tonight', 'add me on discord my tag is in my bio', 'gg', 'check out my build', 'what school do you go to?? jk',
    'my parents said i can stay up late', 'send pic of your build', 'can someone send a picture of the map']],
  [{ server: 'Homework help', channel: 'math' }, [
    'can someone help with question 4', 'the answer is 12', 'thanks!!', 'my teacher said we have a test friday', 'free period tomorrow']]
];

// Conversations that are not ordinary: each must be flagged, at the level shown, by the message marked.
const DANGER = [
  ['secrets', { game: 'Brookhaven' }, [['Stranger123', 'hey'], ['Stranger123', 'u seem really cool'], ['Stranger123', "don't tell your parents we talk ok", 'danger']]],
  ['photos', { game: 'Adopt Me!' }, [['xx_pro', 'send me a selfie', 'danger']]],
  ['robux for pictures', { game: 'Pet Simulator 99' }, [['buyer_77', 'i will give you 1000 robux if you send a pic', 'danger']]],
  ['adds up', { server: 'Gaming lounge', channel: 'dms', dm: true }, [['nice_guy', 'how old are you'], ['nice_guy', 'what school do you go to'], ['nice_guy', 'add me on snap', 'warn'], ['nice_guy', 'are your parents home right now', 'danger']]],
  ['meeting', { game: 'Bloxburg' }, [['bob', 'we should meet up irl', 'danger']]],
  ['alone', { game: 'Murder Mystery 2' }, [['guy', 'are you home alone', 'warn']]],
  ['sextortion', { server: 'DMs', dm: true }, [['acc', 'pay me $200 or everyone you know will see the pictures', 'danger']]],
  ['free robux', { game: 'Blox Fruits' }, [['giveaway_bot', 'FREE ROBUX at robux-claim . com', 'warn']]],
  ['password', { server: 'Trading hub', channel: 'trades' }, [['mod_staff', 'dm me your password so i can verify you', 'danger']]],
  ['you go first', { server: 'Fortnite fans', channel: 'trading' }, [['trader', 'you go first then i send mine', 'warn']]],
  ['you go first in a trading game', { game: 'Adopt Me!' }, [['trader', 'trust trade, you go first', 'warn']]],
  ['reported by mistake', { server: 'Chill', dm: true }, [['friend?', 'hey i accidentally reported your account, talk to this admin to fix it', 'warn']]],
  ['home in real life', { game: 'Brookhaven' }, [['x', 'where do you live irl', 'warn'], ['x', 'whats your real name', 'warn'], ['x', 'what school do you go to irl', 'warn']]],
  ['flattery', { server: 'Art club', dm: true }, [['older_friend', "you're so mature for your age", 'warn']]],
  ['phone', { game: 'Tower of Hell' }, [['user9', 'whats your phone number', 'warn']]]
];

test('place kinds come from the game or server: role play, trading, combat', () => {
  assert.deepEqual(placeKinds({ game: 'Brookhaven 🏡RP' }), { roleplay: true });
  assert.ok(placeKinds({ game: 'Adopt Me!' }).trading);
  assert.ok(placeKinds({ game: 'Arsenal', description: 'shooter' }).combat);
});

test('ordinary chat in games and servers is never flagged', () => {
  for (const [context, lines] of ORDINARY) {
    const c = conversation(context);
    lines.forEach((text, i) => {
      const r = c.add({ who: `player${i}`, text, at: 1000 + i });
      assert.equal(r, null, `"${text}" in ${context.game || context.server} was flagged: ${r && r.detail}`);
    });
  }
});

test('grooming, sextortion and scams are flagged, by the message that shows them, at the right level', () => {
  for (const [name, context, lines] of DANGER) {
    const c = conversation(context);
    let flagged = 0;
    lines.forEach(([who, text, want], i) => {
      const r = c.add({ who, text, at: 1000 + i * 1000 });
      if (want) {
        assert.ok(r, `${name}: "${text}" was not flagged`);
        assert.equal(r.level, want, `${name}: "${text}" flagged as ${r.level}`);
        assert.ok(r.title && r.advice && r.detail.includes(who), `${name}: the warning says who and what to do`);
        flagged++;
      } else {
        assert.equal(r, null, `${name}: "${text}" was flagged too early`);
      }
    });
    assert.ok(flagged, name);
  }
});

test('signs add up per person, not across a whole lobby, and fade after half an hour', () => {
  const c = conversation({ game: 'Tower of Hell' });
  assert.equal(c.add({ who: 'a', text: 'how old are you', at: 0 }), null);
  assert.equal(c.add({ who: 'b', text: 'add me on discord', at: 1 }), null, 'a different person');
  assert.equal(c.add({ who: 'a', text: 'add me on snap', at: 2 }), null, 'two weak signs are not enough');
  assert.ok(c.add({ who: 'a', text: 'what school do you go to', at: 3 }), 'a third sign from the same person is');
  const later = conversation({ game: 'Tower of Hell' });
  later.add({ who: 'a', text: 'how old are you', at: 0 });
  later.add({ who: 'a', text: 'add me on snap', at: 1 });
  assert.equal(later.add({ who: 'a', text: 'what school do you go to', at: 40 * 60 * 1000 }), null, 'old signs have faded');
});

test('system lines and the game\'s own messages are never judged', () => {
  const c = conversation({ game: 'Brookhaven' });
  for (const text of ['[System]: Welcome to Brookhaven!', 'Player123 has joined the game', 'secret_agent joined the server']) assert.equal(c.add({ who: 'system', text }), null);
});

test('a phone number said in chat is flagged; one from a scam area code is a scam; game numbers are not', () => {
  const r = (text) => conversation({ game: 'Blox Fruits' }).add({ who: 'stranger', text, at: 1000 });
  for (const t of ['call me 876-555-0123', 'text me at (473) 555 0199', '+1 809 555 0100', 'my number is 8765550123']) {
    assert.equal(r(t) && r(t).level, 'danger', t);
    assert.equal(r(t).family, 'scam', t);
  }
  for (const t of ['my number is 212-555-0147', 'hmu +447700900123']) assert.equal(r(t) && r(t).level, 'warn', t);
  for (const t of ['place 1818 id 4924922222', 'i have 1500 robux and 20 pets', 'score 99-100', 'join code 4821']) assert.equal(r(t), null, t);
});

test('a phone number gets advice about the number, not about Robux or trades', () => {
  const r = conversation({ server: 'Gaming' }).add({ who: 'x', text: 'call me 876-555-0123', at: 1 });
  assert.match(r.advice, /Do not call or text this number/);
  assert.doesNotMatch(r.advice, /Robux|V-Bucks/);
});
