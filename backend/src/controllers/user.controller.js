const dailyUsageModel = require("../models/dailyUsage.model");
const meterReadModel = require("../models/meterRead.model");
const userModel = require("../models/user.model");
const { createSmtOdrRateLimiter } = require("../services/smtOdrRateLimiter.service");
const { buildEnergySnapshotForUser } = require("../services/energySnapshot.service");
const { fmtCentralDate, addDays } = require("../utils/dateUtils");

const MAX_METER_READS_PER_HOUR = Number(process.env.SMT_ODR_MAX_PER_HOUR || 2);
const MAX_METER_READS_PER_DAY = Number(process.env.SMT_ODR_MAX_PER_DAY || 24);
const odrRateLimiter = createSmtOdrRateLimiter();
const USAGE_HISTORY_CACHE_TTL_MS = Number(
  process.env.USAGE_HISTORY_CACHE_TTL_MS || 30_000
);
const USAGE_HISTORY_CACHE_MAX_KEYS = Number(
  process.env.USAGE_HISTORY_CACHE_MAX_KEYS || 1000
);
const usageHistoryCache = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d) {
  return fmtCentralDate(d);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function usageHistoryCacheKey({ userId, esiid, days }) {
  return `${userId}:${esiid || "no_esiid"}:${days}`;
}

function getCachedUsageHistory(key) {
  const hit = usageHistoryCache.get(key);
  if (!hit) return null;
  if (Date.now() >= hit.expiresAt) {
    usageHistoryCache.delete(key);
    return null;
  }
  return hit.payload;
}

function setCachedUsageHistory(key, payload) {
  if (usageHistoryCache.size >= USAGE_HISTORY_CACHE_MAX_KEYS) {
    const oldestKey = usageHistoryCache.keys().next().value;
    if (oldestKey) usageHistoryCache.delete(oldestKey);
  }
  usageHistoryCache.set(key, {
    payload,
    expiresAt: Date.now() + USAGE_HISTORY_CACHE_TTL_MS,
  });
}

// ---------------------------------------------------------------------------
// GET /api/user/usage/history
//
// Returns daily usage summary from the database.
// Query params: ?days=30 (default 30)
// ---------------------------------------------------------------------------
exports.getUsageHistory = async (req, res) => {
  try {
    const user = req.user;
    const days = Math.min(Number(req.query.days) || 30, 365);
    const cacheKey = usageHistoryCacheKey({
      userId: user.id,
      esiid: user.esiid,
      days,
    });
    const cachedPayload = getCachedUsageHistory(cacheKey);
    if (cachedPayload) {
      res.setHeader("x-cache", "HIT");
      return res.json(cachedPayload);
    }

    const latestDate = dailyUsageModel.getLatestDate({
      userId: user.id,
      esiid: user.esiid,
    });

    // SMT can lag by 24-48h. Anchor windows to latest available DB day,
    // not the device/server "today", to avoid showing false zeros.
    const anchorDate = latestDate ? new Date(`${latestDate}T00:00:00Z`) : daysAgo(1);
    const yesterdayStr = fmtDate(anchorDate);
    const weekStart = fmtDate(addDays(anchorDate, -6));
    const monthStart = fmtDate(addDays(anchorDate, -29));
    const rangeStart = fmtDate(addDays(anchorDate, -(days - 1)));
    const anchorStr = fmtDate(anchorDate);

    const yesterdayUsage = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: yesterdayStr,
      endDate: yesterdayStr,
    });

    const last7 = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: weekStart,
      endDate: anchorStr,
    });

    const last30 = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: monthStart,
      endDate: anchorStr,
    });

    const dailyPoints = dailyUsageModel.getRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: rangeStart,
      endDate: anchorStr,
    });

    const latestMeterRead = meterReadModel.getLatest({
      userId: user.id,
      esiid: user.esiid,
    });

    // Cost estimate (fallback rate, user-configurable later)
    const RATE = 0.15;

    const payload = {
      success: true,
      data: {
        esiid: user.esiid,
        yesterday: {
          kwh: Number(yesterdayUsage.totalKwh.toFixed(2)),
          cost: Number((yesterdayUsage.totalKwh * RATE).toFixed(2)),
          days: yesterdayUsage.days,
        },
        last7Days: {
          kwh: Number(last7.totalKwh.toFixed(2)),
          cost: Number((last7.totalKwh * RATE).toFixed(2)),
          days: last7.days,
        },
        last30Days: {
          kwh: Number(last30.totalKwh.toFixed(2)),
          cost: Number((last30.totalKwh * RATE).toFixed(2)),
          days: last30.days,
        },
        dailyPoints,
        latestDate,
        latestMeterRead: latestMeterRead
          ? {
              readingKwh: latestMeterRead.reading_kwh,
              readAt: latestMeterRead.read_at,
              source: latestMeterRead.source,
            }
          : null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
    setCachedUsageHistory(cacheKey, payload);
    res.setHeader("x-cache", "MISS");
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "USAGE_HISTORY_ERROR",
        message: error.message || "Failed to load usage history.",
      },
    });
  }
};

/**
 * GET /api/user/odr-rate-limit
 * Returns the current ODR rate-limit state so the Flutter app can sync on startup.
 */
exports.getOdrRateLimit = async (req, res) => {
  try {
    const user = req.user;
    const state = await odrRateLimiter.getState({
      esiid: user.esiid,
      maxPerHour: MAX_METER_READS_PER_HOUR,
      maxPerDay: MAX_METER_READS_PER_DAY,
    });

    // Compute lockedUntil for the client
    let lockedUntil = null;
    if (state.remainingThisHour <= 0) {
      lockedUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    } else if (state.remainingToday <= 0) {
      lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    }

    res.json({
      success: true,
      data: {
        perHour: {
          max: MAX_METER_READS_PER_HOUR,
          used: state.inLastHour,
          remaining: state.remainingThisHour,
        },
        perDay: {
          max: MAX_METER_READS_PER_DAY,
          used: state.inLastDay,
          remaining: state.remainingToday,
        },
        lockedUntil,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "RATE_LIMIT_ERROR",
        message: error.message || "Failed to check rate limit.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// GET /api/user/energy-trends
//
// Returns real trend calculations from stored daily usage data for the
// energy dashboard cards.
//
// Metrics:
//   kwhTrend          – latest day vs prior day (% change)
//   costTrend         – this-week avg daily cost vs last-week avg (% change)
//   percentVsYesterday – current spend vs yesterday's spend (% change)
//   yesterdayKwh       – raw kWh for the latest stored day
//   priorDayKwh        – raw kWh for the day before latest
//   thisWeekAvgDailyKwh / lastWeekAvgDailyKwh – for cost-trend computation
// ---------------------------------------------------------------------------
exports.getEnergyTrends = async (req, res) => {
  try {
    const user = req.user;

    const latestDate = dailyUsageModel.getLatestDate({
      userId: user.id,
      esiid: user.esiid,
    });

    if (!latestDate) {
      // No usage data in DB yet — return neutral trends
      return res.json({
        success: true,
        data: {
          kwhTrend: 0,
          costTrend: 0,
          percentVsYesterday: 0,
          yesterdayKwh: 0,
          priorDayKwh: 0,
          thisWeekAvgDailyKwh: 0,
          lastWeekAvgDailyKwh: 0,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    }

    const anchor = new Date(`${latestDate}T00:00:00Z`);
    const priorDay = addDays(anchor, -1);

    // 1. Day-over-day: latest day vs prior day
    const latestDayUsage = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: fmtDate(anchor),
      endDate: fmtDate(anchor),
    });
    const priorDayUsage = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: fmtDate(priorDay),
      endDate: fmtDate(priorDay),
    });

    const yesterdayKwh = latestDayUsage.totalKwh;
    const priorDayKwh = priorDayUsage.totalKwh;

    // kwhTrend: (yesterday - dayBefore) / dayBefore, with edge-case handling
    let kwhTrend = 0;
    if (priorDayKwh > 0) {
      kwhTrend = (yesterdayKwh - priorDayKwh) / priorDayKwh;
    } else if (priorDayKwh === 0 && yesterdayKwh > 0) {
      // From zero to some usage = +100%
      kwhTrend = 1.0;
    } else if (priorDayKwh > 0 && yesterdayKwh === 0) {
      // From some usage to zero = -100%
      kwhTrend = -1.0;
    }

    // 2. Week-over-week: this-week avg daily vs last-week avg daily
    //    "This week" = last 7 days ending at anchor
    //    "Last week" = 7 days before that
    const thisWeekStart = addDays(anchor, -6);
    const lastWeekEnd = addDays(anchor, -7);
    const lastWeekStart = addDays(anchor, -13);

    const thisWeek = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: fmtDate(thisWeekStart),
      endDate: fmtDate(anchor),
    });
    const lastWeek = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: fmtDate(lastWeekStart),
      endDate: fmtDate(lastWeekEnd),
    });

    const thisWeekAvgDaily = thisWeek.days > 0 ? thisWeek.totalKwh / thisWeek.days : 0;
    const lastWeekAvgDaily = lastWeek.days > 0 ? lastWeek.totalKwh / lastWeek.days : 0;

    let costTrend = 0;
    if (lastWeekAvgDaily > 0) {
      costTrend = (thisWeekAvgDaily - lastWeekAvgDaily) / lastWeekAvgDaily;
    }

    // 3. percentVsYesterday: use kWh-based percent to avoid rate skew;
    //    identical to kwhTrend with the same edge-case handling.
    let percentVsYesterday = 0;
    if (priorDayKwh > 0) {
      percentVsYesterday = (yesterdayKwh - priorDayKwh) / priorDayKwh;
    } else if (priorDayKwh === 0 && yesterdayKwh > 0) {
      percentVsYesterday = 1.0;
    } else if (priorDayKwh > 0 && yesterdayKwh === 0) {
      percentVsYesterday = -1.0;
    }

    res.json({
      success: true,
      data: {
        kwhTrend: Number(kwhTrend.toFixed(4)),
        costTrend: Number(costTrend.toFixed(4)),
        percentVsYesterday: Number(percentVsYesterday.toFixed(4)),
        yesterdayKwh: Number(yesterdayKwh.toFixed(2)),
        priorDayKwh: Number(priorDayKwh.toFixed(2)),
        thisWeekAvgDailyKwh: Number(thisWeekAvgDaily.toFixed(2)),
        lastWeekAvgDailyKwh: Number(lastWeekAvgDaily.toFixed(2)),
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "ENERGY_TRENDS_ERROR",
        message: error.message || "Failed to compute energy trends.",
      },
    });
  }
};

/**
 * GET /api/user/meter-reads
 * Returns recent meter reads from the database.
 */
exports.getMeterReads = async (req, res) => {
  try {
    const user = req.user;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const reads = meterReadModel.getRecent({
      userId: user.id,
      esiid: user.esiid,
      limit,
    });

    res.json({
      success: true,
      data: { reads },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "METER_READS_ERROR",
        message: error.message || "Failed to load meter reads.",
      },
    });
  }
};

/**
 * GET /api/user/energy/snapshot
 * Returns a normalized energy snapshot payload used by WebSocket bootstrap/fallback.
 */
/**
 * PUT /api/user/esiid
 * Updates the user's ESIID (collected during onboarding).
 */
exports.updateEsiid = async (req, res) => {
  try {
    const user = req.user;
    const { esiid } = req.body;
    if (!esiid || typeof esiid !== "string" || esiid.trim().length < 17) {
      return res.status(400).json({
        success: false,
        error: {
          code: "ESIID_VALIDATION_ERROR",
          message: "A valid 17+ digit ESIID is required.",
        },
      });
    }
    userModel.updateEsiid(user.id, esiid.trim());
    return res.json({
      success: true,
      data: { esiid: esiid.trim() },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "ESIID_UPDATE_ERROR",
        message: error.message || "Failed to update ESIID.",
      },
    });
  }
};

/**
 * PUT /api/user/provider
 * Updates the user's selected retail provider.
 */
exports.updateProvider = async (req, res) => {
  try {
    const user = req.user;
    const { providerName } = req.body;
    if (!providerName || typeof providerName !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "PROVIDER_VALIDATION_ERROR", message: "providerName is required." },
      });
    }
    userModel.updateProviderName(user.id, providerName.trim());
    return res.json({
      success: true,
      data: { providerName: providerName.trim() },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "PROVIDER_UPDATE_ERROR",
        message: error.message || "Failed to update provider.",
      },
    });
  }
};
exports.getEnergySnapshot = async (req, res) => {
  try {
    const user = req.user;
    const snapshot = buildEnergySnapshotForUser(user.id);
    if (!snapshot) {
      return res.status(404).json({
        success: false,
        error: {
          code: "ENERGY_SNAPSHOT_NOT_FOUND",
          message: "User energy snapshot not found.",
        },
      });
    }

    return res.json({
      success: true,
      data: snapshot,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        code: "ENERGY_SNAPSHOT_ERROR",
        message: error.message || "Failed to build energy snapshot.",
      },
    });
  }
};
