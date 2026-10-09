'use strict';
/**
 * "Your week with Sentinel": what Sentinel did for one person, week by week.
 *
 * Built only from what Sentinel already keeps (the weekly scan allowances, the scan history, exposure alerts) and a
 * few counters added for it. A counter is a number per week and nothing else (usage_counters, swept after 35 days
 * like the allowances): never an address, a file name, a message or a wallet. Nothing is estimated: a week with
 * nothing in it says so.
 */
const { db, now } = require('./db');
const { weekStart } = require('./plans');

const WEEK = 7 * 24 * 60 * 60 * 1000;
const WEEKS = 4;
// Seen by the server as they happen.
const SERVER = ['live_links', 'live_flagged', 'lookalikes'];
// Seen by the Windows app on the person's computer, and handed to its own server as numbers (POST /api/v1/week/count).
const DESKTOP = ['files_checked', 'files_quarantined', 'commands_stopped', 'wallet_swaps', 'chat_checked', 'chat_flagged'];
// The weekly allowances: every manual scan that ran (a refunded one is taken back off).
const SCANS = ['link_scans', 'deep_scans', 'file_scans'];
const FLAGGED = "('suspicious','likely','confirmed')";

const q = {
  bump: db.prepare(`INSERT INTO usage_counters (user_id, week, metric, used) VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, week, metric) DO UPDATE SET used = used + excluded.used`),
  counters: db.prepare('SELECT week, metric, used FROM usage_counters WHERE user_id = ? AND week >= ?'),
  flagged: db.prepare(`SELECT COUNT(*) AS n FROM scan_history WHERE user_id = ? AND mode = 'manual' AND created_at >= ? AND created_at < ?
                       AND (scam IN ${FLAGGED} OR virus IN ${FLAGGED} OR malware IN ${FLAGGED})`),
  exposures: db.prepare('SELECT COUNT(*) AS n FROM exposures WHERE user_id = ? AND listed_at >= ? AND listed_at < ?')
};

/** Add `n` to this week's count of `metric`. Never throws: a count is not worth failing a scan over. */
function bump(userId, metric, n = 1, t = now()) {
  const k = Math.floor(Number(n));
  if (!userId || !(k > 0) || (!SERVER.includes(metric) && !DESKTOP.includes(metric))) return;
  try { q.bump.run(userId, weekStart(t), metric, k); } catch { /* best effort */ }
}

const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

/**
 * The one thing most worth hearing about, in plain words. Most serious first: something on the PC acting against
 * the person, then a fake of their own site, then a site turning bad after a visit, then pages and messages.
 */
function biggest(c) {
  if (c.wallet_swaps) return `Something on this PC swapped ${plural(c.wallet_swaps, 'a wallet address', 'wallet addresses')} you copied, and Sentinel caught it.`;
  if (c.files_quarantined) return `Sentinel moved ${plural(c.files_quarantined, 'a dangerous file', 'dangerous files')} into quarantine before ${c.files_quarantined === 1 ? 'it' : 'they'} could do harm.`;
  if (c.commands_stopped) return `Sentinel stopped ${plural(c.commands_stopped, 'a risky command', 'risky commands')} you copied before ${c.commands_stopped === 1 ? 'it' : 'they'} could be pasted into Windows.`;
  if (c.lookalikes) return `Sentinel spotted ${plural(c.lookalikes, 'a fake copy', 'fake copies')} of a site you use.`;
  if (c.exposures) return `${c.exposures === 1 ? 'A site you visited was' : `${c.exposures} sites you visited were`} put on a threat list afterwards, and Sentinel told you.`;
  if (c.live_flagged) return `Sentinel warned you about ${plural(c.live_flagged, 'a dangerous page', 'dangerous pages and results')} while you browsed.`;
  if (c.manual_flagged) return `${c.manual_flagged === 1 ? 'One thing' : `${c.manual_flagged} things`} you asked Sentinel to check turned out to be risky.`;
  if (c.chat_flagged) return `Sentinel pointed out ${plural(c.chat_flagged, 'a chat message', 'chat messages')} that did not look safe.`;
  return null;
}

function headline(w, when) {
  if (w.caught) return `Sentinel caught ${plural(w.caught, '1 thing', 'things')} ${when}`;
  if (w.checked) return `Nothing dangerous ${when}`;
  return when === 'this week' ? 'Nothing to report yet this week' : `Nothing to report ${when}`;
}

/** One week's counts, starting at `start` (a weekStart). */
function weekOf(userId, start, rows) {
  const c = Object.fromEntries([...SERVER, ...DESKTOP].map((m) => [m, 0]));
  let manual = 0;
  for (const r of rows) {
    if (r.week !== start) continue;
    if (SCANS.includes(r.metric)) manual += r.used;
    else if (r.metric in c) c[r.metric] += r.used;
  }
  c.manual_scans = manual;
  c.manual_flagged = q.flagged.get(userId, start, start + WEEK).n;
  c.exposures = q.exposures.get(userId, start, start + WEEK).n;
  // A look-alike is also a flagged page or result, so it is not counted twice.
  const caught = c.live_flagged + c.manual_flagged + c.files_quarantined + c.commands_stopped + c.wallet_swaps + c.chat_flagged + c.exposures;
  const checked = c.live_links + c.manual_scans + c.files_checked + c.chat_checked;
  return { startsAt: start, counts: c, caught, checked };
}

/** The last four weeks, oldest first; the last one is this week so far. */
function summary(userId, t = now()) {
  const current = weekStart(t);
  const starts = Array.from({ length: WEEKS }, (_, i) => current - (WEEKS - 1 - i) * WEEK);
  const rows = q.counters.all(userId, starts[0]);
  const weeks = starts.map((s) => weekOf(userId, s, rows));
  weeks.forEach((w, i) => {
    const when = i === WEEKS - 1 ? 'this week' : i === WEEKS - 2 ? 'last week' : 'that week';
    w.headline = headline(w, when);
    w.biggest = biggest(w.counts);
  });
  return { weeks, resetsAt: current + WEEK };
}

module.exports = { bump, summary, biggest, SERVER, DESKTOP };
