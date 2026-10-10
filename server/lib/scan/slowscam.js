'use strict';
/**
 * A whole conversation (WhatsApp, a dating app, Instagram, texts), pasted or read from a screenshot on the Text scan.
 * Slow scams ("pig butchering", romance and investment scams) are not one bad message: they move through the same
 * steps over days or weeks. A wrong-number opener, a move to another app, a new friend far away who cannot video call,
 * talk of an investment platform or crypto profits, then a sudden emergency or a fee that needs money.
 *
 * This finds which of those steps a conversation has and says where it is and what usually comes next. One step alone
 * is ordinary (people do get wrong numbers, and friends do talk about crypto): it takes two. Local rules only; the
 * conversation is read in memory and nothing of it is kept or logged.
 */
const { WRONG_NUMBER } = require('./texts');

const APPS = String.raw`(whats ?app|telegram|signal|wechat|line|kik|viber|snapchat|hangouts|google chat)`;

// In order: the steps these scams follow. `next`: what usually happens after this step, in calm words.
const STAGES = [
  {
    id: 'opener', label: 'A wrong number',
    seen: 'a message meant for someone else',
    next: 'Next they usually stay friendly for a few days, then ask to move the chat to WhatsApp, Telegram or another app.',
    re: /\b(sorry,? (i think )?(wrong number|i (must have |have )?(got|texted|messaged|added) the wrong)|wrong (number|person),? sorry|(got|found) your (number|contact|profile) (from|in|on)|your number (was|is) (in|saved in|on) my (phone|contacts)|is this (still )?\w+'?s number)/i
  },
  {
    id: 'move', label: 'A move to another app',
    seen: 'a move to another app',
    next: 'Next they usually become a close friend or more, often saying they live or work far away.',
    re: new RegExp(String.raw`\b((add|message|text|find|contact|reach) me on ${APPS}|(move|switch|continue|talk|chat|go)( this| our chat| the (chat|conversation))?( over)? (to|on) ${APPS}|(my|here'?s my) ${APPS}( number| id)?\b|i (don'?t|do not|rarely) (use|check|come on) this (app|site|platform)( much| often)?|this (app|site) is (not convenient|inconvenient))`, 'i')
  },
  {
    id: 'bond', label: 'A friend far away',
    seen: 'a new friend far away who cannot video call',
    next: 'Next they usually mention an investment, often crypto or gold, that made them money, and offer to show you how.',
    re: /\b(oil rig|offshore (platform|rig)|deployed (in|to|overseas)|on (a )?(deployment|peacekeeping mission)|un (peacekeeping|doctor)|working (abroad|overseas|in (dubai|syria|yemen|the middle east))|stationed (in|at|overseas)|(cargo|container) ship|(can'?t|cannot|can not|unable to|not allowed to|not able to) (video|facetime|video call|video chat|turn on (my|the) camera)|camera (is )?(broken|not working)|(my )?camera does(n'?t| not) work|video calls? (are|is) not allowed)\b/i
  },
  {
    id: 'invest', label: 'An investment',
    seen: 'talk of an investment platform or crypto profits',
    next: 'Next they usually let you make a small profit you can see, then push you to put in more. When you try to take money out, there is a fee or a tax to pay first, and the money does not come back.',
    re: /\b(trading (platform|app|account)|investment (platform|app|opportunity)|crypto (platform|exchange|investment|trading)|(bitcoin|btc|usdt|eth|crypto|forex|gold|futures) (trading|investment|investing|mining|contracts?|platform)|liquidity mining|my (uncle|aunt|aunty|mentor|teacher|cousin)\b[^.!?]{0,40}\b(analyst|insider|expert|taught|teaches|trades|signals)|(made|earned|profit(ed)?|returns? of) [$£€]?\d[\d,.]*k?\s*(%|percent|dollars|usd|usdt|profit|in (a|one|two|\d+) (day|week|month)s?)|guaranteed (profit|returns?)|(i can|let me|i will|i'll) (teach|show|guide) you (how )?(to )?(invest|trade|make (money|profit)))/i
  },
  {
    id: 'money', label: 'A sudden need for money',
    seen: 'a sudden emergency or a fee that needs your money',
    next: 'Next they usually ask again, for another fee, ticket or fine, each time with a new reason. Paying once leads to more requests.',
    re: /\b(hospital bills?|medical bills?|surgery|stuck (at|in) (the )?(airport|customs|border)|customs (fee|charge|clearance)|(account|card) (is |got |has been |was )?(frozen|blocked)|(send|lend|wire|transfer) (me )?(some )?(money|cash|funds|crypto|usdt|bitcoin)|(send|lend|wire|transfer) (me )?[$£€]\s?\d|gift ?cards?|plane ticket|flight ticket|visa fee|(withdraw(al)?|release|unlock)\b[^.!?]{0,30}\b(fee|tax|deposit)|pay (the |a )?(tax|fee) (first|before)|(i|we)( will|'ll) pay you back)\b/i
  }
];

const ADVICE = {
  danger: 'Do not send money, crypto or gift cards, and do not put money on any app or website they suggest. Stop replying. If you already sent money, call your bank now and report it.',
  warn: 'Do not send money or join any investment they suggest. A real friend can video call you. If you are unsure, stop replying and talk it over with someone you trust.'
};

// "[10/6/26, 10:31] Anna: Hi" and "10/6/26, 10:31 - Anna: Hi" (WhatsApp), "Anna: Hi": the words without the label.
const LABEL = /^\s*(\[[^\]]{4,30}\]|\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}[:.]\d{2}(\s?[ap]m)?\s*-)?\s*([^:\n]{1,30}:\s)?/i;

/**
 * Where a conversation is on the path of a slow scam, or null when it is not on one.
 * @param {string} text the conversation, one message per line
 * @returns {null | { level: 'warn'|'danger', family: 'scam', words: true, title: string, detail: string, advice: string,
 *   stages: { id: string, label: string, seen: boolean }[], at: string, next: string }}
 */
function judgeConversation(text) {
  const lines = String(text || '').slice(0, 8000).split(/\r?\n/).map((l) => l.replace(LABEL, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!lines.length) return null;
  const all = lines.join('\n');
  const seen = new Set(STAGES.filter((s) => s.re.test(all)).map((s) => s.id));
  if (lines.some((l) => WRONG_NUMBER.test(l))) seen.add('opener');
  if (seen.size < 2) return null;
  const found = STAGES.filter((s) => seen.has(s.id));
  const at = found[found.length - 1];
  const level = seen.has('invest') || seen.has('money') ? 'danger' : 'warn';
  return {
    level, family: 'scam', words: true,
    title: level === 'danger' ? 'This conversation follows a slow scam' : 'This conversation may be the start of a slow scam',
    detail: `It has ${['', 'one', 'two', 'three', 'four', 'all'][found.length]} of the five steps slow scams follow: ${found.slice(0, -1).map((s) => s.seen).join(', ')} and ${at.seen}.`,
    advice: ADVICE[level],
    stages: STAGES.map((s) => ({ id: s.id, label: s.label, seen: seen.has(s.id) })),
    at: at.id,
    next: at.next
  };
}

module.exports = { judgeConversation, STAGES };
