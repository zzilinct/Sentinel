'use strict';
/**
 * Chat safety: reads messages in Roblox and Discord the way a careful older sibling would, and speaks up only when a
 * message is suspicious. It runs inside the Windows app, on the computer the chat is on (desktop/src/chatwatch.js
 * loads this file directly): no message is sent anywhere, stored, or logged.
 *
 * Three families of danger, each from what research on online harm to children says to look for:
 *   grooming    an adult working toward a child: questions about age, home and school; checking whether parents are
 *               around; secrets; moving the talk to another app; gifts (Robux, gift cards) in return for something;
 *               asking for photos or a camera; meeting. (O'Connell's grooming stages; NCMEC on online enticement;
 *               Thorn: 65% of minors were asked by an online-only contact to move to a private platform.)
 *   sextortion  threats to share pictures unless paid or obeyed (FBI and allied agencies' warnings).
 *   scams       free Robux, V-Bucks or Nitro; "verify your account"; asking for a password, code or cookie;
 *               "you go first" trades; fake "I reported you by mistake" stories; QR codes to scan.
 *
 * One ordinary question ("how old are you?", common between children) is never enough: signs add up per person over
 * the conversation, and only a clear sign, or several together, is flagged. The game or server it happens in changes
 * what is ordinary: "where do you live" in a role-play town is about a house in the game, "you go first" in a trading
 * game is still the oldest trick there is.
 */

// Each sign: id, family, how strong (1 weak .. 5 decisive), and the words that show it.
const SIGNS = [
  // Grooming: getting to know a child.
  { id: 'age', family: 'grooming', w: 1, re: /\b(how old (are|r) (you|u)|what('?s| is) (your|ur) age|what grade (are|r) (you|u) in|(are|r) (you|u) (a )?(kid|minor|under ?(13|18)))\b/i },
  { id: 'home', family: 'grooming', w: 2, re: /\b(where (do|d) (you|u) live|what('?s| is) (your|ur) (address|school|town)|what (school|city|state) (do|d) (you|u) (go to|live in|live)|which school)\b/i },
  { id: 'irl', family: 'grooming', w: 1, re: /\b(irl|in real life|real life|your real name|ur real name)\b/i },
  // Checking that nobody is watching.
  { id: 'alone', family: 'grooming', w: 4, re: /\b((are|r) (you|u) home alone|(are|r) (you|u) alone (at home|in (your|ur) (room|house|bedroom)|right now|rn|irl)|(are|r) (your|ur) (parents|mom|dad|mum) (home|around|watching|there|awake)|is any(one|body) (watching (you|u)|home with (you|u))|where (are|r) (your|ur) parents)\b/i },
  // Secrets: the clearest single sign there is.
  { id: 'secret', family: 'grooming', w: 5, re: /\b(do ?n[o']?t tell (your|ur|any|ne)(one|body|1| parents| mom| dad| mum| family| friends)?|(our|a) (little )?secret|keep (this|it) (between us|secret|a secret)|delete (this|these|our|the) (chat|messages|convo|conversation|dms?)|nobody (has|needs) to know)\b/i },
  // Moving somewhere private. Between children "add me on Discord" is ordinary, so on its own it is never flagged:
  // it counts when it comes with other signs. A phone number is asked for less innocently.
  { id: 'move', family: 'grooming', w: 2, re: /\b((add|dm|text|message|msg|find|talk to) me on |(do|d) (you|u) (have|got) (a |an )?|what('?s| is) (your|ur) |(give|send) me (your|ur) )(snap(chat)?|discord|telegram|whats ?app|insta(gram)?|kik|signal|tik ?tok)\b/i },
  { id: 'phone', family: 'grooming', w: 3, re: /\b((what('?s| is)|give me|send me|can i (have|get)) (your|ur) (phone )?(number|cell|phone)|(text|call) me (at|on) \+?\d)/i },
  // Flattery that makes a child feel singled out, and trust being asked for.
  { id: 'special', family: 'grooming', w: 3, re: /\b((you'?re|ur|you are) (so )?(mature|grown up|special|beautiful|pretty|hot|sexy) for (your|ur) age|you'?re not like (other|the other) (kids|girls|boys)|only i (understand|get) (you|u)|you can trust me|i('?m| am) (the only one|your only friend))\b/i },
  // Gifts in return for something.
  { id: 'gift', family: 'grooming', w: 3, re: /\b(i('?ll| will) (give|send|buy|get) (you|u) (\d+ )?(robux|r\$|v-?bucks|nitro|money|cash|a gift ?card|gift ?cards|skins?|game ?pass(es)?)\b.{0,40}\b(if|for|when) (you|u)|(robux|v-?bucks|nitro|money|gift ?cards?) (for|if) (a |your |ur )?(pic|pics|picture|photo|selfie|video|cam))/i },
  // Pictures, a camera, a call.
  { id: 'photo', family: 'grooming', w: 5, re: /\b((send|show|post) (me )?(a |some |ur |your |more )?(pic|pics|picture|pictures|photo|photos|selfie|selfies|vid|video|face pic|body)(?! of (the|your|ur|my|this|that|ya) (build|map|base|world|screen|inventory|items?|pets?|avatar|character|skin|score|stats|setup|game|code|homework|drawing|art|house|plot|server|garden|farm))|turn on (your|ur|the) (cam|camera|webcam)|(let'?s|can we|wanna|want to) (facetime|video ?call|vc|cam)|show me (your|ur) (face|body|room))\b/i },
  // Meeting.
  { id: 'meet', family: 'grooming', w: 5, re: /\b(meet (up|me|irl|in person|in real life)|(let'?s|can we|wanna|want to) meet|i (can|could|will) (pick (you|u) up|come (to|over to) (your|ur))|where can we meet)\b/i },
  // Sexual talk aimed at someone.
  { id: 'sexual', family: 'grooming', w: 5, re: /\b(nudes?|naked|send nudes|no clothes|without (your|ur) clothes|sext(ing)?|sexy pics?|lewd|(take|took) off (your|ur) (shirt|clothes))\b/i },

  // Sextortion: pictures as a threat.
  { id: 'extort', family: 'sextortion', w: 5, re: /\b((i('?ll| will)|i'?m gonna|i am going to|or i('?ll| will)?) (send|post|share|leak|show) (your|ur|the|these|those) (pics|pictures|photos|nudes|videos?|vids?)|(pay|send) (me )?(\$?\d+|money|robux|gift ?cards?|bitcoin|crypto).{0,40}\bor (i|everyone|your|ur)\b|everyone (you know|in your contacts) will see)\b/i },
  // Threats aimed at a real person (not a game's fighting talk).
  { id: 'threat', family: 'grooming', w: 5, re: /\b(i know where (you|u) live|i('?ll| will) (find|come for) (you|u) (irl|in real life)|i('?ll| will) dox (you|u)|i have (your|ur) (address|ip))\b/i },

  // Scams.
  { id: 'freebie', family: 'scam', w: 4, re: /\b(free|claim|get|generator|gen)\b.{0,25}\b(robux|r\$|v-?bucks|nitro|premium|limiteds?|headless|korblox)\b|\b(robux|v-?bucks|nitro)\b.{0,25}\b(free|generator|giveaway|claim)\b/i },
  { id: 'creds', family: 'scam', w: 5, re: /\b((give|send|tell|dm|type) (me )?(your|ur) (password|pass|pw|login|2fa|code|verification code|security code|pin|cookie|\.?roblosecurity|token)|what('?s| is) (your|ur) (password|pass|pw|2fa code|pin))\b/i },
  { id: 'verify', family: 'scam', w: 4, re: /\b(verify (your|ur) (account|age|identity) (here|at|on|with|by)|(your|ur) account (will be|is going to be|gets) (banned|deleted|terminated|suspended)|(i|someone) (accidentally|mistakenly|by mistake) reported (you|u|your account))\b/i },
  { id: 'trade', family: 'scam', w: 3, re: /\b((you|u) (go|give) first|(trust|trust me) trade|send (it|them|the items?) first and i('?ll| will)|i('?ll| will) (give|send) (it )?back (later|after)|middle ?man)\b/i },
  { id: 'qr', family: 'scam', w: 4, re: /\b(scan (this|the|my) (qr|code)|qr code to (claim|get|verify|log ?in))\b/i },
  // A phone number said in chat. Roblox and Discord are no place to hand one out, so any number is worth a warning.
  // Numbers in the area codes consumer agencies name for "one ring" and callback scams (the BBB: 268 Antigua and
  // Barbuda, 284 British Virgin Islands, 473 Grenada, 809 Dominican Republic, 876 Jamaica; the FCC: 649 Turks and
  // Caicos; 829 and 849 are the Dominican Republic's other codes) and 900 pay-per-call numbers: calling back costs
  // money per minute, so those are flagged as a scam outright.
  { id: 'scamnum', family: 'scam', w: 5, re: /(?:\+?\b1[\s.-]?)?(?:\((?:268|284|473|649|809|829|849|876|900)\)|\b(?:268|284|473|649|809|829|849|876|900))[\s.-]?\d{3}[\s.-]?\d{4}\b/ },
  { id: 'number', family: 'grooming', w: 3, re: /(?:\+\s?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\b[2-9]\d{2})[\s.-]?\d{3}[\s.-]?\d{4}\b|\+\d{8,15}\b/ },
  { id: 'download', family: 'scam', w: 3, re: /\b((download|install|run) (this|my|the) (exe|file|mod|script|executor|injector|hack|cheat|program)|(try|test) (my|this) (game|app|program) (and|&) (tell|lmk)|it'?s not a virus)\b/i }
];

// What a game or a server is about, from its name, description and genre: what is ordinary talk there.
const GAME_KINDS = [
  { kind: 'roleplay', re: /\b(role ?play|rp|brookhaven|bloxburg|berry ?avenue|livetopia|town|city|life|house|family|school|hospital|adopt me)\b/i },
  { kind: 'trading', re: /\b(trad(e|ing)|pet sim(ulator)?|adopt me|blox fruits|murder mystery|mm2|grow a garden|limiteds?)\b/i },
  { kind: 'combat', re: /\b(fight|fighting|battle|war|pvp|shooter|gun|sword|murder|kill|zombie|horror|survive|survival|arsenal|bedwars|da hood)\b/i }
];

/** What sort of place the conversation is in: { roleplay, trading, combat } from its title, description and genre. */
function placeKinds(context = {}) {
  const text = [context.game, context.description, context.genre, context.server, context.channel].filter(Boolean).join(' ').slice(0, 2000);
  const kinds = {};
  for (const g of GAME_KINDS) if (g.re.test(text)) kinds[g.kind] = true;
  return kinds;
}

// Lines that are the platform talking, not a person: never judged.
const SYSTEM = /^\s*(\[(system|server|team|whisper)\]|system:|.*\b(joined|left) the (game|server|experience)\b|.*\bhas (joined|left)\b|welcome to\b)/i;

/** The signs one message shows, after the place's context. */
function signsIn(text, kinds) {
  const t = String(text || '').slice(0, 600);
  if (!t.trim() || SYSTEM.test(t)) return [];
  const found = [];
  for (const s of SIGNS) {
    if (!s.re.test(t)) continue;
    let w = s.w;
    // In a role-play town, "where do you live" is about a house in the game, unless real life is brought into it.
    // Stepping out of the game to ask about real life is the sign: asked "irl", it counts for more anywhere.
    const real = /\b(irl|real life|in real life|real address|real school)\b/i.test(t);
    if (s.id === 'home' && kinds.roleplay && !real) w = 0;
    if (s.id === 'home' && real) w = 3;
    // In a trading game, trading words are ordinary: only "you go first" and a middleman stay suspicious.
    // Ten digits run together are as often a game's place or player number: a phone number only with phone words.
    if ((s.id === 'number' || s.id === 'scamnum') && /^\d+$/.test(s.re.exec(t)[0]) && !/\b(call|text|txt|number|num|phone|cell|whats ?app|dial|hmu|ring)\b/i.test(t)) w = 0;
    if (s.id === 'trade' && kinds.trading && !/\b(you|u) (go|give) first|send (it|them|the items?) first|i('?ll| will) (give|send) (it )?back\b/i.test(t)) w = 0;
    if (w > 0) found.push({ id: s.id, family: s.family, w });
  }
  return found;
}

const ADVICE = {
  grooming: 'Someone asking you to keep secrets, share where you live, send pictures, or move to another app is a warning sign, even if they seem friendly. Do not share personal details or photos. Tell a parent or another adult you trust, and use the app\'s Block and Report buttons.',
  sextortion: 'This is a threat, and it is never your fault. Do not pay or send anything. Keep the messages, block the person, and tell a parent or another adult you trust straight away. You can also report it at report.cybertip.org (in the US) or to CEOP (in the UK).',
  scam: 'This looks like a scam. Nobody gives away free Robux, V-Bucks or Nitro, real staff never ask for your password or a code, and in a trade the person who asks you to go first is the one who keeps both. Do not click, scan or send anything.'
};
// When this message is about a phone number, the general advice (free Robux, trades) does not fit: say what to do about a number.
const PHONE_ADVICE = {
  scam: 'Do not call or text this number. Numbers like this can charge you by the minute or lead to a scammer. Block the person, and tell a parent or another adult you trust.',
  grooming: 'Someone you met in a game or chat sharing a phone number wants to reach you outside it. Do not call or text it, and never send yours. Tell a parent or another adult you trust, and use Block and Report.'
};
const TITLE = {
  grooming: 'This person may not be safe to talk to',
  sextortion: 'Someone is threatening you',
  scam: 'This looks like a scam'
};
const WHAT = {
  age: 'asked how old you are', home: 'asked where you live or go to school', irl: 'asked about your real life',
  alone: 'asked whether you are alone or your parents are around', secret: 'asked you to keep a secret',
  move: 'asked to talk on another app', phone: 'asked for your phone number', special: 'is flattering you and asking for your trust',
  gift: 'offered gifts in return for something', photo: 'asked for pictures, a video or your camera',
  meet: 'asked to meet in person', sexual: 'said something sexual to you', extort: 'threatened to share pictures',
  threat: 'threatened you in real life', freebie: 'offered free Robux, V-Bucks or Nitro', creds: 'asked for your password or a code',
  verify: 'said your account is in trouble', trade: 'asked you to trade first', qr: 'asked you to scan a code',
  download: 'asked you to download or run something',
  scamnum: 'posted a phone number from an area code known for phone scams (calling back can cost money)', number: 'shared a phone number'
};

/**
 * A conversation: feed it messages as they appear; it says which ones to flag. One per chat (a game, a server
 * channel, a direct message). Nothing is kept beyond each sender's signs for the last 30 minutes.
 */
function conversation(context = {}) {
  const kinds = placeKinds(context);
  const people = new Map();   // sender -> { signs: [{ id, family, w, at }] }
  const WINDOW = 30 * 60 * 1000;
  return {
    kinds,
    /**
     * @param {{ who?: string, text: string, at?: number }} m
     * @returns {null | { level: 'warn'|'danger', family: string, title: string, detail: string, advice: string, signs: string[] }}
     */
    add(m) {
      const at = typeof m.at === 'number' ? m.at : Date.now();
      const found = signsIn(m.text, kinds);
      if (!found.length) return null;
      const who = String(m.who || '?').slice(0, 64).toLowerCase();
      const p = people.get(who) || { signs: [] };
      p.signs = p.signs.filter((s) => at - s.at < WINDOW);
      for (const s of found) p.signs.push({ ...s, at });
      people.set(who, p);

      // This message's own weight, and what this person has shown so far (each kind of sign counted once).
      const here = Math.max(...found.map((s) => s.w));
      const kindsSeen = new Map();
      for (const s of p.signs) kindsSeen.set(s.id, Math.max(kindsSeen.get(s.id) || 0, s.w));
      const total = [...kindsSeen.values()].reduce((a, b) => a + b, 0);
      const distinct = kindsSeen.size;

      // The stronger of what this message shows by itself and what this person has shown together.
      const alone = here >= 5 ? 2 : here >= 3 ? 1 : 0;
      const together = distinct >= 2 ? (total >= 6 ? 2 : total >= 4 ? 1 : 0) : 0;
      const level = [null, 'warn', 'danger'][Math.max(alone, together)];
      if (!level) return null;

      // The family the strongest evidence points to; what this person has done, in plain words.
      const family = found.some((s) => s.family === 'sextortion') ? 'sextortion'
        : [...p.signs].sort((a, b) => b.w - a.w)[0].family;
      const done = [...kindsSeen.keys()].filter((id) => SIGNS.find((s) => s.id === id).family === family || family === 'grooming').map((id) => WHAT[id]);
      return {
        level,
        family,
        title: TITLE[family],
        detail: `${m.who ? `${String(m.who).slice(0, 40)} ` : 'Someone '}${done.slice(0, 3).join(', ')}.`,
        advice: found.every((s) => s.id === 'number' || s.id === 'scamnum') && PHONE_ADVICE[family] ? PHONE_ADVICE[family] : ADVICE[family],
        signs: [...kindsSeen.keys()]
      };
    }
  };
}

module.exports = { conversation, placeKinds, signsIn, SIGNS };
