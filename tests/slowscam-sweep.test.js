'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { judgeConversation } = require('../server/lib/scan/slowscam');

// Ordinary, honest conversations written for this test (no real people's messages). Each touches the words the
// slow-scam steps look for: tickets, money between friends, another app, someone abroad, crypto said once. None of
// them may be called a slow scam. The scam examples stay in slowscam.test.js.
const HONEST = [
  ['friends planning a trip', [
    'Jo: ok flights to Lisbon are 180 each',
    'Me: book them! I will pay you back for my plane ticket on Friday',
    'Jo: deal. lets move this to the WhatsApp group so Ben sees it',
    'Me: added you all on WhatsApp'
  ]],
  ['a trip and a bad signal', [
    'Ben: sorry my signal is terrible on the train',
    'Ben: did you get the flight tickets?',
    'Me: yes, sent you the confirmation, you can send me the money whenever'
  ]],
  ['splitting the cabin', [
    'Kat: cabin is 640 for the weekend, 160 each',
    'Me: can you transfer me your share by Sunday?',
    'Kat: done! also my camera is broken so someone else take photos lol'
  ]],
  ['a family group and a hospital', [
    'Mum: Grandpa had his knee surgery this morning, all went well',
    'Dad: The hospital bills are covered by insurance thank goodness',
    'Me: Great news, tell him I will call tonight'
  ]],
  ['a family group and a new phone', [
    'Aunt Rose: Is this Sarah\'s number? It is Rose, I got a new phone',
    'Sarah: Yes it is! Saving it now',
    'Aunt Rose: Lovely, can you add me on WhatsApp to the family group?'
  ]],
  ['a family group and pocket money', [
    'Leo: Mum can you send me some money for the bus, my card got blocked at the shop',
    'Mum: Sent 20. Call the bank about the card',
    'Leo: thanks, I will pay you back'
  ]],
  ['a cousin who teaches', [
    'Me: how was the wedding?',
    'Nina: amazing, my cousin taught me to dance salsa at the party',
    'Nina: also Uncle Raj got surgery on his shoulder last week, he is fine'
  ]],
  ['a colleague and a deadline', [
    'Priya: can we move this chat to Teams? I rarely check this app',
    'Me: sure, ping me on Google Chat too',
    'Priya: the client report is due Friday'
  ]],
  ['a colleague travelling', [
    'Tom: I am stationed in the Frankfurt office for two weeks',
    'Tom: cannot video call from the hotel, the wifi is awful, can we do audio?',
    'Me: no problem, audio is fine'
  ]],
  ['a colleague and expenses', [
    'Ana: I paid for the team lunch, 84 total',
    'Me: I will transfer you my part tonight',
    'Ana: no rush. my uncle is a financial analyst btw, he says the pension changes are fine'
  ]],
  ['a gift card for a birthday', [
    'Me: what should we get Lucy for her birthday?',
    'Sam: a gift card for the bookshop? she loves reading',
    'Me: perfect, I will buy it, you can pay me back half'
  ]],
  ['a gift card thank you', [
    'Gran: Thank you for the gift card darling, I bought new gardening gloves',
    'Me: So glad you liked it Gran!'
  ]],
  ['a friend who moved abroad', [
    'Elena: settled in! I am working abroad in Dubai for two years now',
    'Me: so proud of you. add me on Signal, it is easier for calls',
    'Elena: done, call you Sunday'
  ]],
  ['a friend abroad who sends a gift', [
    'Marco: I am working overseas until June',
    'Marco: sent your kids gift cards for their birthdays, hope they like them'
  ]],
  ['a friend on a ship', [
    'Lina: I start my job on a cargo ship next week, 3 months at sea',
    'Me: wow! will you have internet?',
    'Lina: a little. cannot video call but I can text'
  ]],
  ['a friend in the army', [
    'Josh: got deployed to Germany, back in spring',
    'Me: stay safe, send me your address for a care package'
  ]],
  ['someone who mentions crypto once', [
    'Dev: I put 50 into bitcoin years ago and forgot about it lol',
    'Me: haha check it',
    'Dev: anyway, are we still on for football Thursday?'
  ]],
  ['a friend who lost money on crypto', [
    'Ali: the crypto exchange I used shut down, lost like 30 bucks',
    'Me: ouch, at least it was small',
    'Ali: lesson learned. coffee tomorrow?'
  ]],
  ['a friend who made money selling', [
    'Zoe: I made 300 dollars selling cookies at the fair!',
    'Me: amazing! your mum must be proud',
    'Zoe: she wants me to teach her how to make money from baking haha'
  ]],
  ['a friend who babysits', [
    'Ella: earned 60 dollars babysitting tonight',
    'Me: rich! pizza on you'
  ]],
  ['a friend and a stock app', [
    'Rob: I downloaded a trading app to buy index funds for my pension',
    'Me: which one?',
    'Rob: the one my bank offers, nothing fancy'
  ]],
  ['a marketplace sale moving to WhatsApp', [
    'Buyer: Hi, is the bike still available?',
    'Me: Yes it is',
    'Buyer: Great, can I message you on WhatsApp? I rarely use this app',
    'Me: Sure, my WhatsApp number is in my profile',
    'Buyer: I will pay cash when I pick it up Saturday'
  ]],
  ['a marketplace sale with a transfer', [
    'Me: is the sofa still for sale?',
    'Seller: yes, 120. I can hold it if you transfer me 20 now',
    'Me: I would rather pay all in cash on pickup',
    'Seller: fine, see you at 5'
  ]],
  ['a lost phone', [
    'Unknown: Hi, I found your number in the phone I found at the park, is this yours?',
    'Me: Yes! Thank you so much, where can I pick it up?'
  ]],
  ['a school group', [
    'Teacher: Reminder, the trip fee is 15, please send money with your child by Friday',
    'Parent: Will do. Could we continue this on WhatsApp? The school app is so slow'
  ]],
  ['a neighbour', [
    'Neighbour: Hi, are you Dan from number 12?',
    'Me: Yes, hi!',
    'Neighbour: A parcel came for you, I can drop it over'
  ]],
  ['a new number from an old friend', [
    'Chris: Hi is this Megan\'s number? It is Chris from uni, new phone',
    'Megan: Chris! Yes, how are you?',
    'Chris: good! moving to Canada next month for work, working abroad finally'
  ]],
  ['a plumber', [
    'Plumber: I can come Tuesday. The part is 40, you can pay me on the day',
    'Me: Great. My card was blocked last week, is cash ok?',
    'Plumber: cash is fine'
  ]],
  ['a sibling and the airport', [
    'Ray: landed! stuck at the airport waiting for bags',
    'Me: no rush, I am parked outside',
    'Ray: can you lend me a tenner for the coffee lol'
  ]],
  ['a sports club', [
    'Coach: training moves to Telegram from next week, join the channel',
    'Me: ok, joining now',
    'Coach: the season fee is 50, transfer to the club account'
  ]],
  ['a book club and gold', [
    'Pat: next book is about the history of gold investment in the 1970s',
    'Me: sounds dry but ok',
    'Pat: we meet on Line now, the group moved there'
  ]],
  ['a nephew who wants a gift card', [
    'Nephew: Uncle can you get me a Steam gift card for my birthday?',
    'Me: Ask your mum first',
    'Nephew: she said yes!'
  ]],
  ['a friend and a phone camera', [
    'Mo: my camera does not work since I dropped the phone',
    'Mo: so I cannot facetime tonight, text instead?',
    'Me: sure'
  ]],
  ['an old friend reconnecting', [
    'Sophie: Hey! I got your number from Anna, hope that is ok',
    'Me: Of course! So good to hear from you',
    'Sophie: we should get dinner when I am back from working abroad'
  ]],
  ['parents and the visa', [
    'Dad: The visa fee for the trip is 120, I paid it already',
    'Me: Thanks Dad, I will pay you back when I get paid'
  ]],
  ['a friend saving up', [
    'Ivy: my investment app says my savings made 4% this year',
    'Me: nice, better than my bank'
  ]],
  ['a flatmate and bills', [
    'Flatmate: electricity bill is 90, can you send me 45?',
    'Me: sent! also my bank card was frozen yesterday, they fixed it'
  ]],
  ['a grandparent learning the phone', [
    'Grandad: Is this Lily?',
    'Lily: Yes Grandad, it is me!',
    'Grandad: Good, your mother put the number in my phone'
  ]],
  ['a dating chat that stays honest', [
    'Alex: had a great time tonight',
    'Me: me too! add me on Instagram',
    'Alex: done. I work on an offshore platform two weeks on two off, back on the 20th'
  ]],
  ['a friend and an exchange student', [
    'Hana: I am working in the Middle East this summer, an internship',
    'Me: so cool! do they let you video call?',
    'Hana: yes every evening'
  ]],
  ['a money question between sisters', [
    'Ruth: can you lend me 50 until payday?',
    'Me: sure, sending now',
    'Ruth: I will pay you back Friday, promise'
  ]],
  ['crypto news between colleagues', [
    'Sid: did you read about the bitcoin mining farm in Texas?',
    'Me: yes, the power use is wild',
    'Sid: anyway, the meeting moved to 3'
  ]]
];

for (const [name, lines] of HONEST) {
  test(`an honest conversation is left alone: ${name}`, () => {
    assert.equal(judgeConversation(lines.join('\n')), null);
  });
}

test('the sweep is at least 40 conversations', () => assert.ok(HONEST.length >= 40, String(HONEST.length)));

// The narrowed words still find the scams they were written for.
const STILL_SCAMS = [
  ['a "new number" that was a wrong one', ['Hi, is this Linda\'s number?', 'No, wrong number', 'Oh sorry! You seem nice. I do not use this app much, add me on Telegram'], ['opener', 'move']],
  ['a doctor far away who needs gift cards', ['I found your profile on a dating site, I hope you do not mind', 'I am a UN doctor in Yemen, I cannot video call here',
    'Please buy 4 Apple gift cards and send me the codes'], ['opener', 'bond', 'money']],
  ['an oil rig and a surgery', ['I work on an oil rig, my camera is broken', 'My daughter needs money for surgery, can you help me pay the hospital?'], ['bond', 'money']],
  ['a mentor and profits in a week', ['Add me on WhatsApp, this app is inconvenient', 'My mentor trades crypto for a fund', 'I made 30% in a week, I can teach you'], ['move', 'invest']]
];

test('the scams these words were written for are still found', () => {
  for (const [name, lines, steps] of STILL_SCAMS) {
    const r = judgeConversation(lines.join('\n'));
    assert.ok(r, name);
    assert.deepEqual(r.stages.filter((s) => s.seen).map((s) => s.id), steps, name);
  }
});
