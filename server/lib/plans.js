'use strict';
/**
 * Plans, weekly allowances and what each tier is allowed to do.
 * Enforced server-side only - clients just render what this returns.
 */
const { db, now } = require('./db');
const { HttpError } = require('./http');

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    // fastMinutes: fast live scanning (lists, checklist, comparison). liveMinutes: delicate live scanning (the same plus research).
    limits: { linkScans: 10, fileScans: 5, liveMinutes: 0, fastMinutes: 15 },
    features: {
      research: false,          // manual scans: knowledge + checklist + compare only
      liveFast: true,
      liveScanning: false,
      liveResearch: false,
      virusMalwareOnLinks: false,
      emailLive: false,
      emailManual: false
    }
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 15,
    limits: { linkScans: 40, fileScans: 40, liveMinutes: 4 * 60, fastMinutes: 24 * 60 },
    features: {
      research: true,
      liveFast: true,
      liveScanning: true,
      liveResearch: true,       // delicate live scanning researches every result, inside a time budget
      virusMalwareOnLinks: true,
      emailLive: true,
      emailManual: false
    }
  },
  max: {
    id: 'max',
    name: 'Max',
    price: 40,
    limits: { linkScans: 100, fileScans: 100, liveMinutes: 24 * 60, fastMinutes: null },
    features: {
      research: true,
      liveFast: true,
      liveScanning: true,
      liveResearch: true,       // every live result is researched
      virusMalwareOnLinks: true,
      emailLive: true,
      emailManual: true
    }
  },
  ultimate: {
    id: 'ultimate',
    name: 'Ultimate',
    price: 100,
    // null = uncapped. Fast scanning has no weekly ceiling here; delicate has 96 hours.
    limits: { linkScans: 500, fileScans: 500, liveMinutes: 96 * 60, fastMinutes: null },
    features: {
      research: true,
      liveFast: true,
      liveScanning: true,
      liveResearch: true,
      virusMalwareOnLinks: true,
      emailLive: true,
      emailManual: true
    }
  }
};

/** Uncapped allowances are stored as null so the UI can say so plainly. */
const uncapped = (limit) => limit === null;

const METRICS = {
  linkScans: 'link_scans',
  fileScans: 'file_scans'
};

/** Monday 00:00 UTC of the current week, as a millisecond timestamp. */
function weekStart(t = now()) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

function weekResetsAt(t = now()) {
  return weekStart(t) + 7 * 24 * 60 * 60 * 1000;
}

function planFor(user) {
  return user && typeof user.plan === 'string' && Object.hasOwn(PLANS, user.plan) ? PLANS[user.plan] : PLANS.free;
}

const q = {
  get: db.prepare('SELECT used FROM usage_counters WHERE user_id = ? AND week = ? AND metric = ?'),
  bump: db.prepare(`INSERT INTO usage_counters (user_id, week, metric, used) VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, week, metric) DO UPDATE SET used = used + excluded.used`),
  refund: db.prepare('UPDATE usage_counters SET used = MAX(0, used - 1) WHERE user_id = ? AND week = ? AND metric = ?'),
  minute: db.prepare('INSERT OR IGNORE INTO live_minutes (user_id, minute) VALUES (?, ?)'),
  minutePaid: db.prepare('SELECT 1 FROM live_minutes WHERE user_id = ? AND minute = ?'),
  minutes: db.prepare('SELECT COUNT(*) AS n FROM live_minutes WHERE user_id = ? AND minute >= ?'),
  fastMinute: db.prepare('INSERT OR IGNORE INTO fast_minutes (user_id, minute) VALUES (?, ?)'),
  fastMinutePaid: db.prepare('SELECT 1 FROM fast_minutes WHERE user_id = ? AND minute = ?'),
  fastMinutes: db.prepare('SELECT COUNT(*) AS n FROM fast_minutes WHERE user_id = ? AND minute >= ?'),
  setPlan: db.prepare('UPDATE users SET plan = ? WHERE id = ?')
};

function used(userId, key) {
  const row = q.get.get(userId, weekStart(), METRICS[key]);
  return row ? row.used : 0;
}

/**
 * Atomically take one use of a weekly allowance. node:sqlite is synchronous,
 * so the read and the write below cannot interleave with another request.
 * Returns a refund function for scans that fail on our side.
 */
function consume(user, key) {
  const plan = planFor(user);
  const limit = plan.limits[key];
  const week = weekStart();
  const current = used(user.id, key);
  if (current >= limit) {
    throw new HttpError(429, 'weekly_limit_reached',
      `You have used all ${limit} ${key === 'fileScans' ? 'virus & malware scans' : 'link scans'} on the ${plan.name} plan this week.`,
      { limit, used: current, resetsAt: weekResetsAt(), plan: plan.id });
  }
  q.bump.run(user.id, week, METRICS[key], 1);
  let refunded = false;
  return () => {
    if (refunded) return;
    refunded = true;
    q.refund.run(user.id, week, METRICS[key]);
  };
}

const minuteCache = new Map(); // `${userId}` -> last minute bucket recorded

/** Record live-scanning activity and enforce the weekly live-hours allowance. */
const MODES = {
  fast: { limit: 'fastMinutes', feature: 'liveFast', name: 'fast scanning', used: (id) => fastMinutesUsed(id), put: (id, m) => q.fastMinute.run(id, m), paid: (id, m) => q.fastMinutePaid.get(id, m), cache: new Map() },
  delicate: { limit: 'liveMinutes', feature: 'liveScanning', name: 'delicate scanning', used: (id) => liveMinutesUsed(id), put: (id, m) => q.minute.run(id, m), paid: (id, m) => q.minutePaid.get(id, m), cache: minuteCache }
};

/** Does this plan have time left in this mode right now? (A minute already paid for is still usable.) */
function hasTime(user, plan, mode) {
  const m = MODES[mode];
  if (!plan.features[m.feature]) return false;
  const limit = plan.limits[m.limit];
  if (uncapped(limit)) return true;
  const minute = Math.floor(now() / 60000);
  return m.used(user.id) < limit || m.cache.get(user.id) === minute || Boolean(m.paid(user.id, minute));
}

/**
 * Count this minute of live scanning, in the mode asked for.
 * Delicate that is not in the plan, or is used up for the week, falls back to fast while fast has time left:
 * someone who runs out keeps their protection and is told why it changed. Returns the plan and the mode used.
 */
function trackLive(user, wanted) {
  const plan = planFor(user);
  // Clients from before there were two modes ask for nothing: give them the best their plan has.
  let mode = wanted === 'fast' || wanted === 'delicate' ? wanted : (plan.features.liveScanning ? 'delicate' : 'fast');
  let fellBack = null;
  if (mode === 'delicate' && !hasTime(user, plan, 'delicate') && hasTime(user, plan, 'fast')) {
    fellBack = plan.features.liveScanning ? 'delicate_hours_used' : 'delicate_needs_pro';
    mode = 'fast';
  }
  const m = MODES[mode];
  if (!plan.features[m.feature]) {
    throw new HttpError(403, 'plan_required', 'Delicate live scanning is included with Sentinel Pro, Max and Ultimate.', { plan: plan.id, needs: 'pro' });
  }
  if (!hasTime(user, plan, mode)) {
    const limit = plan.limits[m.limit];
    throw new HttpError(429, 'live_hours_exhausted',
      `You have used all ${limit >= 60 ? `${limit / 60} hours` : `${limit} minutes`} of ${m.name} this week.`,
      { mode, limitMinutes: limit, usedMinutes: m.used(user.id), resetsAt: weekResetsAt(), plan: plan.id });
  }
  const minute = Math.floor(now() / 60000);
  if (m.cache.get(user.id) !== minute) {
    m.put(user.id, minute);
    m.cache.set(user.id, minute);
    if (m.cache.size > 50000) m.cache.clear();
  }
  return { plan, mode, fellBack };
}

function fastMinutesUsed(userId) {
  return q.fastMinutes.get(userId, Math.floor(weekStart() / 60000)).n;
}

function liveMinutesUsed(userId) {
  return q.minutes.get(userId, Math.floor(weekStart() / 60000)).n;
}

function usageSummary(user) {
  const plan = planFor(user);
  return {
    plan: { id: plan.id, name: plan.name, price: plan.price, features: plan.features, limits: plan.limits },
    week: { startsAt: weekStart(), resetsAt: weekResetsAt() },
    usage: {
      linkScans: { used: used(user.id, 'linkScans'), limit: plan.limits.linkScans },
      fileScans: { used: used(user.id, 'fileScans'), limit: plan.limits.fileScans },
      liveMinutes: { used: liveMinutesUsed(user.id), limit: plan.limits.liveMinutes },
      fastMinutes: { used: fastMinutesUsed(user.id), limit: plan.limits.fastMinutes }
    }
  };
}

function setPlan(userId, planId) {
  if (typeof planId !== 'string' || !Object.hasOwn(PLANS, planId)) throw new HttpError(400, 'bad_plan', 'Unknown plan');
  q.setPlan.run(planId, userId);
}

function publicPlans() {
  return Object.values(PLANS).map(({ id, name, price, limits, features }) => ({ id, name, price, limits, features }));
}

module.exports = { planFor, consume, trackLive, usageSummary, setPlan, publicPlans, weekStart, weekResetsAt, liveMinutesUsed, fastMinutesUsed };
