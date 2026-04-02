const userModel = require("../models/user.model");
const dailyUsageModel = require("../models/dailyUsage.model");
const meterReadModel = require("../models/meterRead.model");
const { getSmtProvider, getProviderName } = require("../providers/smt");
const { createSmtSessionStore } = require("./smtSessionStore.service");
const { scheduleDataChangePush } = require("../realtime/realtimeEmitter");
const { fmtCentralDate } = require("../utils/dateUtils");

const SESSION_TTL_SECONDS = Number(process.env.SMT_SESSION_TTL_SECONDS || 7200);
const SYNC_INTERVAL_MS = Number(process.env.SMT_SYNC_INTERVAL_MS || 30 * 60 * 1000); // 30 min default

const sessionStore = createSmtSessionStore({ ttlSeconds: SESSION_TTL_SECONDS });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtSmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function fmtDbDate(d) {
  return fmtCentralDate(d);
}

function parseSmtTimestamp(ts) {
  if (!ts) return null;
  // Handles both ISO and MM/DD/YYYY formats
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Core: fetch daily usage from SMT using a token and store in DB.
// Accepts an existing accessToken + session so callers (e.g. login) don't
// need to re-authenticate.
// ---------------------------------------------------------------------------
async function fetchAndStoreDailyUsage({
  userId,
  esiid,
  meterNumber,
  accessToken,
  session,
}) {
  const provider = getSmtProvider();

  if (typeof provider.getUsageHistory !== "function") {
    return { success: false, reason: "unsupported_provider" };
  }

  // Fetch last 30 days of daily usage
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const historyResult = await provider.getUsageHistory({
    accessToken,
    payload: {
      ESIID: esiid,
      startDate: fmtSmtDate(thirtyDaysAgo),
      endDate: fmtSmtDate(now),
    },
    mode: "daily",
    defaultEsiid: esiid,
    session: session || undefined,
  });

  const points = historyResult?.result?.points || [];

  // Convert to DB format and upsert
  const dbPoints = [];
  for (const pt of points) {
    const d = parseSmtTimestamp(pt.timestamp);
    if (!d) continue;
    const kwh = Number(pt.usage);
    if (Number.isNaN(kwh)) continue;
    dbPoints.push({ date: fmtDbDate(d), kwh });
  }

  if (dbPoints.length > 0) {
    dailyUsageModel.upsertMany({
      userId,
      esiid,
      points: dbPoints,
      source: "smt_sync",
    });
    scheduleDataChangePush(userId, "daily_usage_synced");
  }

  // Also fetch latest meter read and store it
  const updatedSession = historyResult?.session || session || null;
  try {
    if (typeof provider.getUsage === "function") {
      const usageResult = await provider.getUsage({
        accessToken,
        payload: { ESIID: esiid },
        defaultEsiid: esiid,
        session: updatedSession || undefined,
      });

      const result = usageResult?.result;
      if (result && result.usage != null) {
        const readingKwh = Number(result.usage);
        if (!readingKwh || readingKwh <= 0) {
          console.log(`[sync] User ${userId}: ignored transient zero meter read`);
        } else {
          const readAt = result.readAt || new Date().toISOString();
          meterReadModel.insert({
            userId,
            esiid,
            meterNumber: meterNumber || null,
            readingKwh,
            readAt,
            source: "sync",
          });

          // Also store into daily_usage so it feeds into summaries/charts.
          // Uses "keep higher" logic to avoid overwriting a more complete value.
          try {
            const readDate = new Date(readAt);
            if (!Number.isNaN(readDate.getTime())) {
              dailyUsageModel.upsertDayIfHigher({
                userId,
                esiid,
                date: fmtCentralDate(readDate),
                kwh: readingKwh,
                source: "sync_read",
              });
            }
          } catch (_) { /* best-effort */ }

          scheduleDataChangePush(userId, "meter_read_synced");
        }
      }
    }
  } catch (meterErr) {
    console.warn(`[sync] Meter read for user ${userId} failed:`, meterErr.message);
  }

  console.log(`[sync] User ${userId}: synced ${dbPoints.length} daily points`);
  return { success: true, pointsSynced: dbPoints.length };
}

// ---------------------------------------------------------------------------
// Sync one user's daily usage from SMT → DB (full cycle: login + fetch)
// Used by the background job.
// ---------------------------------------------------------------------------
async function syncUserDailyUsage(user) {
  // Skip users whose sync has been auto-disabled after repeated failures
  if (userModel.isSyncDisabled(user.id)) {
    return { success: false, reason: "sync_disabled" };
  }

  const providerName = getProviderName();
  const provider = getSmtProvider();

  if (typeof provider.login !== "function" || typeof provider.getUsageHistory !== "function") {
    console.warn(`[sync] Provider "${providerName}" doesn't support required methods.`);
    return { success: false, reason: "unsupported_provider" };
  }

  const creds = userModel.getSmtCredentials(user.id);
  if (!creds) {
    console.warn(`[sync] No credentials for user ${user.id}`);
    return { success: false, reason: "no_credentials" };
  }

  if (!creds.esiid) {
    // User hasn't completed onboarding yet – skip until ESIID is set.
    return { success: false, reason: "no_esiid" };
  }

  try {
    // Login to SMT
    const sessionClient =
      providerName === "unofficial" && typeof provider.createSessionClient === "function"
        ? provider.createSessionClient()
        : null;

    const loginResult = await provider.login({
      username: creds.username,
      password: creds.password,
      ESIID: creds.esiid,
      rememberMe: "true",
      client: sessionClient,
    });

    const accessToken =
      loginResult?.accessToken || loginResult?.data?.token;
    if (!accessToken) {
      console.warn(`[sync] No access token for user ${user.id}`);
      userModel.incrementSyncFailures(user.id);
      return { success: false, reason: "no_token" };
    }

    const result = await fetchAndStoreDailyUsage({
      userId: user.id,
      esiid: creds.esiid,
      meterNumber: creds.meterNumber,
      accessToken,
      session: loginResult?.session || null,
    });

    // Success – reset failure counter so future transient errors get a fresh budget
    if (result.success) {
      userModel.resetSyncFailures(user.id);
    }

    return result;
  } catch (error) {
    userModel.incrementSyncFailures(user.id);
    console.error(`[sync] User ${user.id} sync failed (failures: ${user.sync_fail_count + 1}):`, error.message);
    return { success: false, reason: error.message };
  }
}

// ---------------------------------------------------------------------------
// Sync all users
// ---------------------------------------------------------------------------
async function syncAllUsers() {
  const users = userModel.getSyncableUsers();
  console.log(`[sync] Starting sync for ${users.length} syncable user(s)...`);

  const results = [];
  for (const user of users) {
    const result = await syncUserDailyUsage(user);
    results.push({ userId: user.id, ...result });

    // Small delay between users to avoid rate limits
    if (users.length > 1) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("[sync] Sync complete.", JSON.stringify(results));
  return results;
}

// ---------------------------------------------------------------------------
// Background interval
// ---------------------------------------------------------------------------
let syncTimer = null;

function startBackgroundSync() {
  if (syncTimer) return;

  console.log(
    `[sync] Background sync enabled. Interval: ${SYNC_INTERVAL_MS / 1000}s`
  );

  // Run first sync after a short delay (let server finish starting)
  setTimeout(() => {
    syncAllUsers().catch((e) =>
      console.error("[sync] Initial sync error:", e.message)
    );
  }, 5000);

  syncTimer = setInterval(() => {
    syncAllUsers().catch((e) =>
      console.error("[sync] Periodic sync error:", e.message)
    );
  }, SYNC_INTERVAL_MS);
}

function stopBackgroundSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

module.exports = {
  fetchAndStoreDailyUsage,
  syncUserDailyUsage,
  syncAllUsers,
  startBackgroundSync,
  stopBackgroundSync,
};
