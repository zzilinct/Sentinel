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
    limits: { linkScans: 10, fileScans: 5, liveMinutes: 0 },
    features: {
      research: false,          // manual scans: knowledge + checklist + compare only
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
    limits: { linkScans: 40, fileScans: 40, liveMinutes: 24 * 60 },
    features: {
      research: true,
      liveScanning: true,
      liveResearch: false,      // live results: knowledge + checklist + compare, no research
      virusMalwareOnLinks: true,
      emailLive: true,
      emailManual: false
    }
  },
  max: {
    id: 'max',
    name: 'Max',
    price: 40,
    limits: { linkScans: 100, fileScans: 100, liveMinutes: 96 * 60 },
    features: {
      research: true,
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
    // liveMinutes null = uncapped: round-the-clock scanning with no weekly ceiling.
    limits: { linkScans: 500, fileScans: 500, liveMinutes: null },
    features: {
      research: true,
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
  return PLANS[user && user.plan] || PLANS.free;
}

const q = {
  get: db.prepare('SELECT used FROM usage_counters WHERE user_id = ? AND week = ? AND metric = ?'),
  bump: db.prepare(`INSERT INTO usage_counters (user_id, week, metric, used) VALUES (?, ?, ?, ?)
                    ON CONFLICT(user_id, week, metric) DO UPDATE SET used = used + excluded.used`),
  refund: db.prepare('UPDATE usage_counters SET used = MAX(0, used - 1) WHERE user_id = ? AND week = ? AND metric = ?'),
  minute: db.prepare('INSERT OR IGNORE INTO live_minutes (user_id, minute) VALUES (?, ?)'),
  minutes: db.prepare('SELECT COUNT(*) AS n FROM live_minutes WHERE user_id = ? AND minute >= ?'),
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
function trackLive(user) {
  const plan = planFor(user);
  if (!plan.features.liveScanning) {
    throw new HttpError(403, 'plan_required', 'Live scanning is included with Sentinel Pro, Max and Ultimate.', { plan: plan.id, needs: 'pro' });
  }
  const minute = Math.floor(now() / 60000);
  const usedMinutes = liveMinutesUsed(user.id);
  if (!uncapped(plan.limits.liveMinutes) && usedMinutes >= plan.limits.liveMinutes && minuteCache.get(user.id) !== minute) {
    throw new HttpError(429, 'live_hours_exhausted',
      `You have used all ${plan.limits.liveMinutes / 60} hours of live scanning this week.`,
      { limitMinutes: plan.limits.liveMinutes, usedMinutes, resetsAt: weekResetsAt(), plan: plan.id });
  }
  if (minuteCache.get(user.id) !== minute) {
    q.minute.run(user.id, minute);
    minuteCache.set(user.id, minute);
    if (minuteCache.size > 50000) minuteCache.clear();
  }
  return plan;
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
      liveMinutes: { used: liveMinutesUsed(user.id), limit: plan.limits.liveMinutes }
    }
  };
}

function setPlan(userId, planId) {
  if (!PLANS[planId]) throw new HttpError(400, 'bad_plan', 'Unknown plan');
  q.setPlan.run(planId, userId);
}

function publicPlans() {
  return Object.values(PLANS).map(({ id, name, price, limits, features }) => ({ id, name, price, limits, features }));
}

module.exports = { planFor, consume, trackLive, usageSummary, setPlan, publicPlans, weekStart, weekResetsAt, liveMinutesUsed };
