const dailyUsageModel = require("../models/dailyUsage.model");
const meterReadModel = require("../models/meterRead.model");
const userModel = require("../models/user.model");
const { fmtCentralDate, addDays } = require("../utils/dateUtils");

const DEFAULT_RATE_PER_KWH = Number(process.env.DEFAULT_RATE_PER_KWH || 0.15);
const DEFAULT_DAILY_BUDGET = Number(process.env.DEFAULT_DAILY_BUDGET || 8.0);

function fmtDate(d) {
  return fmtCentralDate(d);
}

function _computeTrendData(user) {
  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });

  if (!latestDate) {
    return {
      kwhTrend: 0,
      costTrend: 0,
      percentVsYesterday: 0,
    };
  }

  const anchor = new Date(`${latestDate}T00:00:00Z`);
  const priorDay = addDays(anchor, -1);

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

  const yesterdayKwh = Number(latestDayUsage.totalKwh || 0);
  const priorDayKwh = Number(priorDayUsage.totalKwh || 0);

  let kwhTrend = 0;
  if (priorDayKwh > 0) {
    kwhTrend = (yesterdayKwh - priorDayKwh) / priorDayKwh;
  }

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

  const todaySpend = yesterdayKwh * DEFAULT_RATE_PER_KWH;
  const prevSpend = priorDayKwh * DEFAULT_RATE_PER_KWH;
  let percentVsYesterday = 0;
  if (prevSpend > 0) {
    percentVsYesterday = (todaySpend - prevSpend) / prevSpend;
  }

  return {
    kwhTrend: Number(kwhTrend.toFixed(4)),
    costTrend: Number(costTrend.toFixed(4)),
    percentVsYesterday: Number(percentVsYesterday.toFixed(4)),
  };
}

function buildEnergySnapshotForUser(userId) {
  const user = userModel.findById(userId);
  if (!user) return null;

  // ---------------------------------------------------------------------------
  // Primary source: daily_usage table.
  // ODR and sync now both write into daily_usage, so it is the single source
  // of truth for "today's kWh so far".  We still fall back to meter_reads for
  // the read timestamp.
  // ---------------------------------------------------------------------------
  const latestDate = dailyUsageModel.getLatestDate({
    userId: user.id,
    esiid: user.esiid,
  });

  let kwhToday = 0;
  if (latestDate) {
    const dayUsage = dailyUsageModel.sumRange({
      userId: user.id,
      esiid: user.esiid,
      startDate: latestDate,
      endDate: latestDate,
    });
    kwhToday = Number(dayUsage.totalKwh || 0);
  }

  // Get the latest meter read for its timestamp (readAt).
  const latestRead = meterReadModel.getLatest({
    userId: user.id,
    esiid: user.esiid,
  });

  // If daily_usage is still 0 but we have a positive meter read, use it.
  // (Edge case: meter read was inserted but daily_usage upsert failed.)
  if (kwhToday <= 0 && latestRead) {
    let stableRead = latestRead;
    if (Number(latestRead.reading_kwh || 0) <= 0) {
      const recent = meterReadModel.getRecent({
        userId: user.id,
        esiid: user.esiid,
        limit: 20,
      });
      const fallback = recent.find((row) => Number(row?.reading_kwh || 0) > 0);
      if (fallback) stableRead = fallback;
    }
    kwhToday = Number(stableRead?.reading_kwh || 0);
  }

  const readAt = latestRead?.read_at || null;
  const ratePerKwh = DEFAULT_RATE_PER_KWH;
  const totalBudget = DEFAULT_DAILY_BUDGET;
  const currentSpend = kwhToday * ratePerKwh;
  const remainingAmount = Math.max(0, totalBudget - currentSpend);
  const trends = _computeTrendData(user);

  return {
    currentSpend: Number(currentSpend.toFixed(2)),
    totalBudget: Number(totalBudget.toFixed(2)),
    usedPercentage: totalBudget > 0 ? currentSpend / totalBudget : 0,
    percentVsYesterday: trends.percentVsYesterday,
    remainingAmount: Number(remainingAmount.toFixed(2)),
    airConditionerCost: Number((currentSpend * 0.45).toFixed(2)),
    kwhToday: Number(kwhToday.toFixed(2)),
    kwhTrend: trends.kwhTrend,
    centsPerKwh: Number((ratePerKwh * 100).toFixed(2)),
    centsTrend: trends.costTrend,
    hasOdrData: kwhToday > 0 || Boolean(readAt),
    providerMessage: null,
    readAt,
  };
}

module.exports = {
  buildEnergySnapshotForUser,
};
