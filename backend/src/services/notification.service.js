const notificationModel = require("../models/notification.model");
const dailyUsageModel = require("../models/dailyUsage.model");
const userModel = require("../models/user.model");
const providerModel = require("../models/provider.model");
const { fmtCentralDate, addDays } = require("../utils/dateUtils");
const { pushUserEvent } = require("../realtime/wsGateway");

const DEFAULT_RATE_PER_KWH = Number(process.env.DEFAULT_RATE_PER_KWH || 0.15);
const DEFAULT_DAILY_BUDGET = Number(process.env.DEFAULT_DAILY_BUDGET || 8.0);
const DAYS_IN_BILLING_CYCLE = 30;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate ALL notification rules for a single user after a sync.
 * Called from sync.service.js after data is stored.
 * Each rule is independent and idempotent (checked for duplicates via
 * existsTodayForType).
 */
async function evaluateAfterSync(userId) {
  const user = userModel.findById(userId);
  if (!user || !user.esiid) return [];

  const prefs = notificationModel.getPreferences(userId);
  const created = [];

  try {
    // 1. High Usage Alert
    if (prefs.highUsage) {
      const n = _evaluateHighUsage(user, prefs);
      if (n) created.push(n);
    }

    // 2. Budget Exceeded
    if (prefs.budgetAlert) {
      const n = _evaluateBudgetAlert(user, prefs);
      if (n) created.push(n);
    }

    // 3. Usage Spike Detection
    if (prefs.usageSpike) {
      const n = _evaluateUsageSpike(user, prefs);
      if (n) created.push(n);
    }

    // 4. Better Provider Available
    if (prefs.betterProvider) {
      const n = _evaluateBetterProvider(user);
      if (n) created.push(n);
    }

    // 5. Bill Estimate Alert (mid-cycle projection)
    if (prefs.billEstimate) {
      const n = _evaluateBillEstimate(user, prefs);
      if (n) created.push(n);
    }

    // 6. Daily Summary (opt-in)
    if (prefs.dailySummary) {
      const n = _evaluateDailySummary(user);
      if (n) created.push(n);
    }

    // Push real-time notification count update to connected clients
    if (created.length > 0) {
      const unreadCount = notificationModel.countUnread(userId);
      pushUserEvent(userId, "notifications_changed", {
        reason: "new_notifications",
        data: {
          newCount: created.length,
          unreadCount,
          latest: created[0],
        },
      });
    }
  } catch (err) {
    console.warn(`[notifications] Error evaluating for user ${userId}:`, err.message);
  }

  return created;
}

/**
 * Generate the weekly summary for a user.
 * Called from a weekly cron/timer.
 */
function generateWeeklySummary(userId) {
  const user = userModel.findById(userId);
  if (!user || !user.esiid) return null;

  const prefs = notificationModel.getPreferences(userId);
  if (!prefs.weeklySummary) return null;

  if (notificationModel.existsTodayForType(userId, "weekly_summary")) return null;

  const now = new Date();
  const weekEnd = addDays(now, -1);
  const weekStart = addDays(now, -7);

  const thisWeek = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: fmtCentralDate(weekStart),
    endDate: fmtCentralDate(weekEnd),
  });

  const priorWeekEnd = addDays(now, -8);
  const priorWeekStart = addDays(now, -14);
  const lastWeek = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: fmtCentralDate(priorWeekStart),
    endDate: fmtCentralDate(priorWeekEnd),
  });

  const rate = _resolveRate(user);
  const thisWeekCost = thisWeek.totalKwh * rate;
  const lastWeekCost = lastWeek.totalKwh * rate;
  const diff = lastWeek.totalKwh > 0
    ? ((thisWeek.totalKwh - lastWeek.totalKwh) / lastWeek.totalKwh * 100)
    : 0;

  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const emoji = direction === "up" ? "📈" : direction === "down" ? "📉" : "➡️";

  const n = notificationModel.create({
    userId: user.id,
    type: "weekly_summary",
    title: `${emoji} Weekly Energy Report`,
    body: `You used ${thisWeek.totalKwh.toFixed(1)} kWh this week (~$${thisWeekCost.toFixed(2)}). ` +
      `That's ${Math.abs(diff).toFixed(1)}% ${direction} from last week's ${lastWeek.totalKwh.toFixed(1)} kWh.`,
    priority: "normal",
    metadata: {
      thisWeekKwh: thisWeek.totalKwh,
      lastWeekKwh: lastWeek.totalKwh,
      thisWeekCost: Number(thisWeekCost.toFixed(2)),
      lastWeekCost: Number(lastWeekCost.toFixed(2)),
      changePercent: Number(diff.toFixed(1)),
      direction,
    },
  });

  _pushNotification(user.id, n.id);
  return n;
}

/**
 * Notify a user that their sync has been disabled after repeated failures.
 */
function notifySyncDisabled(userId) {
  if (notificationModel.existsTodayForType(userId, "sync_failed")) return null;

  const n = notificationModel.create({
    userId,
    type: "sync_failed",
    title: "⚠️ Data Sync Paused",
    body: "Your energy data sync has been paused due to repeated connection issues. " +
      "Please log in again to resume automatic updates.",
    priority: "high",
    metadata: { action: "relogin_required" },
  });

  _pushNotification(userId, n.id);
  return n;
}

/**
 * Notify a user when sync is re-enabled (after login).
 */
function notifySyncResumed(userId) {
  if (notificationModel.existsTodayForType(userId, "sync_resumed")) return null;

  const n = notificationModel.create({
    userId,
    type: "sync_resumed",
    title: "✅ Data Sync Resumed",
    body: "Your energy data sync has been reactivated. You'll start receiving updated usage data shortly.",
    priority: "normal",
    metadata: {},
  });

  _pushNotification(userId, n.id);
  return n;
}

/**
 * Purge old notifications (housekeeping).
 */
function purgeExpired(days = 90) {
  return notificationModel.purgeOlderThan(days);
}

// ---------------------------------------------------------------------------
// Weekly summary scheduler
// ---------------------------------------------------------------------------
let weeklyTimer = null;

function startWeeklySummaryScheduler() {
  if (weeklyTimer) return;

  // Check once per hour whether it's Sunday morning (weekly summary day)
  weeklyTimer = setInterval(() => {
    const now = new Date();
    // Send weekly summaries on Sunday between 8-9 AM CT
    const centralHour = Number(
      now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false })
    );
    if (now.getDay() === 0 && centralHour === 8) {
      _generateAllWeeklySummaries();
    }

    // Daily purge of very old notifications
    if (centralHour === 3) {
      purgeExpired(90);
    }
  }, 60 * 60 * 1000); // every hour

  console.log("[notifications] Weekly summary scheduler started.");
}

function stopWeeklySummaryScheduler() {
  if (weeklyTimer) {
    clearInterval(weeklyTimer);
    weeklyTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Internal evaluation rules
// ---------------------------------------------------------------------------

function _evaluateHighUsage(user, prefs) {
  if (notificationModel.existsTodayForType(user.id, "high_usage")) return null;

  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });
  if (!latestDate) return null;

  const dayUsage = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: latestDate,
    endDate: latestDate,
  });

  // Compare against 7-day average
  const anchor = new Date(`${latestDate}T00:00:00Z`);
  const weekStart = addDays(anchor, -7);
  const weekData = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: fmtCentralDate(weekStart),
    endDate: fmtCentralDate(addDays(anchor, -1)),
  });

  if (weekData.days === 0) return null;
  const avgDaily = weekData.totalKwh / weekData.days;
  if (avgDaily <= 0) return null;

  const ratio = dayUsage.totalKwh / avgDaily;
  const threshold = prefs.spikeThreshold || 2.0;

  if (ratio < 1.5) return null; // minimum 50% above average to notify

  const rate = _resolveRate(user);
  const cost = dayUsage.totalKwh * rate;

  const n = notificationModel.create({
    userId: user.id,
    type: "high_usage",
    title: "⚡ High Energy Usage Today",
    body: `You've used ${dayUsage.totalKwh.toFixed(1)} kWh today — ` +
      `${(ratio * 100 - 100).toFixed(0)}% above your 7-day average of ${avgDaily.toFixed(1)} kWh. ` +
      `Estimated cost: $${cost.toFixed(2)}.`,
    priority: ratio >= threshold ? "high" : "normal",
    metadata: {
      todayKwh: Number(dayUsage.totalKwh.toFixed(2)),
      avgDailyKwh: Number(avgDaily.toFixed(2)),
      ratio: Number(ratio.toFixed(2)),
      estimatedCost: Number(cost.toFixed(2)),
      date: latestDate,
    },
  });

  return n;
}

function _evaluateBudgetAlert(user, prefs) {
  if (notificationModel.existsTodayForType(user.id, "budget_exceeded")) return null;

  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });
  if (!latestDate) return null;

  const dayUsage = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: latestDate,
    endDate: latestDate,
  });

  const rate = _resolveRate(user);
  const todayCost = dayUsage.totalKwh * rate;
  const budget = prefs.dailyBudget || DEFAULT_DAILY_BUDGET;

  if (todayCost < budget) return null;

  const overBy = todayCost - budget;
  const pctOver = ((overBy / budget) * 100).toFixed(0);

  const n = notificationModel.create({
    userId: user.id,
    type: "budget_exceeded",
    title: "💰 Daily Budget Exceeded",
    body: `Today's energy cost is $${todayCost.toFixed(2)}, which is $${overBy.toFixed(2)} ` +
      `(${pctOver}%) over your $${budget.toFixed(2)} daily budget.`,
    priority: "high",
    metadata: {
      todayCost: Number(todayCost.toFixed(2)),
      budget: Number(budget.toFixed(2)),
      overBy: Number(overBy.toFixed(2)),
      date: latestDate,
    },
  });

  return n;
}

function _evaluateUsageSpike(user, prefs) {
  if (notificationModel.existsTodayForType(user.id, "usage_spike")) return null;

  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });
  if (!latestDate) return null;

  // Compare latest day to 14-day rolling average for spike detection
  const anchor = new Date(`${latestDate}T00:00:00Z`);
  const twoWeeksStart = addDays(anchor, -14);

  const rollingData = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: fmtCentralDate(twoWeeksStart),
    endDate: fmtCentralDate(addDays(anchor, -1)),
  });

  if (rollingData.days < 3) return null; // need at least 3 days of history

  const avgDaily = rollingData.totalKwh / rollingData.days;
  if (avgDaily <= 0) return null;

  const dayUsage = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: latestDate,
    endDate: latestDate,
  });

  const spike = dayUsage.totalKwh / avgDaily;
  const threshold = prefs.spikeThreshold || 2.0;

  if (spike < threshold) return null;

  const n = notificationModel.create({
    userId: user.id,
    type: "usage_spike",
    title: "🔺 Unusual Usage Spike Detected",
    body: `Your usage today (${dayUsage.totalKwh.toFixed(1)} kWh) is ${spike.toFixed(1)}× ` +
      `your 2-week average of ${avgDaily.toFixed(1)} kWh/day. Check for appliances left running or HVAC issues.`,
    priority: "high",
    metadata: {
      todayKwh: Number(dayUsage.totalKwh.toFixed(2)),
      avgDailyKwh: Number(avgDaily.toFixed(2)),
      spikeMultiplier: Number(spike.toFixed(2)),
      date: latestDate,
    },
  });

  return n;
}

function _evaluateBetterProvider(user) {
  if (notificationModel.existsTodayForType(user.id, "better_provider")) return null;
  if (!user.provider_name) return null; // can't compare without a current provider

  // Only check once per week (not every sync)
  const recent = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE user_id = ? AND type = 'better_provider'
         AND created_at >= datetime('now', '-7 days')`
    )
    .get(user.id);
  if ((recent?.count || 0) > 0) return null;

  const currentProvider = providerModel.findByName(user.provider_name);
  if (!currentProvider) return null;

  const currentRate = currentProvider.avg_all_in_cents || currentProvider.energy_rate_cents;

  // Get the cheapest alternative
  const allProviders = providerModel.getAll();
  let cheapest = null;
  let cheapestRate = currentRate;

  for (const p of allProviders) {
    if (p.name === user.provider_name) continue;
    const rate = p.avg_all_in_cents || p.energy_rate_cents;
    if (rate < cheapestRate) {
      cheapestRate = rate;
      cheapest = p;
    }
  }

  if (!cheapest) return null;

  const savingsCents = currentRate - cheapestRate;
  if (savingsCents < 0.5) return null; // minimum 0.5¢ savings to notify

  // Estimate monthly savings at 1000 kWh
  const monthlySavings = (savingsCents / 100) * 1000;

  const n = notificationModel.create({
    userId: user.id,
    type: "better_provider",
    title: "💡 Cheaper Plan Available",
    body: `${cheapest.name} offers ${cheapestRate.toFixed(1)}¢/kWh avg — ` +
      `${savingsCents.toFixed(1)}¢ less than your current ${user.provider_name} plan. ` +
      `You could save ~$${monthlySavings.toFixed(0)}/mo at 1,000 kWh.`,
    priority: "normal",
    metadata: {
      currentProvider: user.provider_name,
      currentRateCents: currentRate,
      suggestedProvider: cheapest.name,
      suggestedRateCents: cheapestRate,
      estMonthlySavings: Number(monthlySavings.toFixed(2)),
      planType: cheapest.plan_type,
    },
  });

  return n;
}

function _evaluateBillEstimate(user, prefs) {
  if (notificationModel.existsTodayForType(user.id, "bill_estimate")) return null;

  // Only generate mid-cycle (around day 15 of the month)
  const now = new Date();
  const dayOfMonth = Number(
    now.toLocaleString("en-US", { timeZone: "America/Chicago", day: "numeric" })
  );
  if (dayOfMonth < 14 || dayOfMonth > 16) return null;

  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });
  if (!latestDate) return null;

  // Get this month's usage so far
  const anchor = new Date(`${latestDate}T00:00:00Z`);
  const monthStart = new Date(anchor);
  monthStart.setDate(1);

  const monthData = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: fmtCentralDate(monthStart),
    endDate: latestDate,
  });

  if (monthData.days < 5) return null; // need at least 5 days

  const avgDailyKwh = monthData.totalKwh / monthData.days;
  const projectedMonthlyKwh = avgDailyKwh * DAYS_IN_BILLING_CYCLE;
  const rate = _resolveRate(user);
  const projectedCost = projectedMonthlyKwh * rate;
  const monthlyBudget = (prefs.dailyBudget || DEFAULT_DAILY_BUDGET) * DAYS_IN_BILLING_CYCLE;

  const overBudget = projectedCost > monthlyBudget;

  const n = notificationModel.create({
    userId: user.id,
    type: "bill_estimate",
    title: overBudget ? "📊 Bill Projection — Over Budget" : "📊 Mid-Month Bill Estimate",
    body: `Based on your current pace (${avgDailyKwh.toFixed(1)} kWh/day), ` +
      `your projected monthly bill is ~$${projectedCost.toFixed(2)} ` +
      `(${projectedMonthlyKwh.toFixed(0)} kWh).` +
      (overBudget
        ? ` That's $${(projectedCost - monthlyBudget).toFixed(2)} over your monthly budget.`
        : ""),
    priority: overBudget ? "high" : "normal",
    metadata: {
      avgDailyKwh: Number(avgDailyKwh.toFixed(2)),
      projectedMonthlyKwh: Number(projectedMonthlyKwh.toFixed(0)),
      projectedCost: Number(projectedCost.toFixed(2)),
      monthlyBudget: Number(monthlyBudget.toFixed(2)),
      daysTracked: monthData.days,
      overBudget,
    },
  });

  return n;
}

function _evaluateDailySummary(user) {
  if (notificationModel.existsTodayForType(user.id, "daily_summary")) return null;

  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });
  if (!latestDate) return null;

  const dayUsage = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: latestDate,
    endDate: latestDate,
  });

  const rate = _resolveRate(user);
  const cost = dayUsage.totalKwh * rate;

  // Compare to yesterday
  const anchor = new Date(`${latestDate}T00:00:00Z`);
  const yesterday = addDays(anchor, -1);
  const yesterdayData = dailyUsageModel.sumRange({
    userId: user.id,
    esiid: user.esiid,
    startDate: fmtCentralDate(yesterday),
    endDate: fmtCentralDate(yesterday),
  });

  let comparison = "";
  if (yesterdayData.totalKwh > 0) {
    const diff = ((dayUsage.totalKwh - yesterdayData.totalKwh) / yesterdayData.totalKwh * 100);
    if (diff > 0) comparison = ` (${diff.toFixed(0)}% more than yesterday)`;
    else if (diff < 0) comparison = ` (${Math.abs(diff).toFixed(0)}% less than yesterday)`;
    else comparison = " (same as yesterday)";
  }

  const n = notificationModel.create({
    userId: user.id,
    type: "daily_summary",
    title: "📋 Daily Energy Summary",
    body: `You used ${dayUsage.totalKwh.toFixed(1)} kWh${comparison}, costing ~$${cost.toFixed(2)}.`,
    priority: "low",
    metadata: {
      kwh: Number(dayUsage.totalKwh.toFixed(2)),
      cost: Number(cost.toFixed(2)),
      date: latestDate,
    },
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // expires in 48h
  });

  return n;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _resolveRate(user) {
  try {
    if (user?.provider_name) {
      const p = providerModel.findByName(user.provider_name);
      if (p && typeof p.energy_rate_cents === "number") {
        return Number((p.energy_rate_cents / 100.0).toFixed(4));
      }
    }
  } catch (_) { /* best-effort */ }
  return DEFAULT_RATE_PER_KWH;
}

function _pushNotification(userId, notificationId) {
  try {
    const unreadCount = notificationModel.countUnread(userId);
    pushUserEvent(userId, "notifications_changed", {
      reason: "new_notification",
      data: { notificationId, unreadCount },
    });
  } catch (_) { /* best-effort */ }
}

function _generateAllWeeklySummaries() {
  const users = userModel.getSyncableUsers();
  let generated = 0;
  for (const user of users) {
    try {
      const n = generateWeeklySummary(user.id);
      if (n) generated++;
    } catch (err) {
      console.warn(`[notifications] Weekly summary for user ${user.id} failed:`, err.message);
    }
  }
  console.log(`[notifications] Generated ${generated} weekly summaries.`);
}

function getDb() {
  return require("../db/database").getDb();
}

module.exports = {
  evaluateAfterSync,
  generateWeeklySummary,
  notifySyncDisabled,
  notifySyncResumed,
  purgeExpired,
  startWeeklySummaryScheduler,
  stopWeeklySummaryScheduler,
};
