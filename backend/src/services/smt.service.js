const { getProviderName, getSmtProvider } = require("../providers/smt");
const { createSmtSuccess } = require("../utils/smtResponse");
const crypto = require("crypto");
const { createSmtSessionStore } = require("./smtSessionStore.service");
const { aggregateUsagePoints } = require("../utils/usageAggregation");
const { createSmtOdrRateLimiter } = require("./smtOdrRateLimiter.service");
const dailyUsageModel = require("../models/dailyUsage.model");
const meterReadModel = require("../models/meterRead.model");
const userModel = require("../models/user.model");
const { scheduleDataChangePush, scheduleEventPush } = require("../realtime/realtimeEmitter");
const { fmtCentralDate } = require("../utils/dateUtils");

const SESSION_TTL_SECONDS = Number(process.env.SMT_SESSION_TTL_SECONDS || 7200);
const sessionStore = createSmtSessionStore({
  ttlSeconds: SESSION_TTL_SECONDS,
});
const odrRateLimiter = createSmtOdrRateLimiter();

const MAX_METER_READS_PER_HOUR = Number(process.env.SMT_ODR_MAX_PER_HOUR || 2);
const MAX_METER_READS_PER_DAY = Number(process.env.SMT_ODR_MAX_PER_DAY || 24);

function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function createSession(providerName, loginResult, options = {}) {
  const accessToken =
    providerName === "official"
      ? loginResult?.accessToken
      : loginResult?.accessToken || loginResult?.data?.token;
  const fallbackDefaultEsiid = options.defaultEsiid || null;

  if (!accessToken) {
    throw createHttpError("Provider login did not return an access token.", 500);
  }

  const sessionId = crypto.randomUUID();
  await sessionStore.set(sessionId, {
    providerName,
    accessToken,
    defaultEsiid:
      loginResult?.data?.defaultEsiid ||
      loginResult?.session?.defaultEsiid ||
      fallbackDefaultEsiid,
    providerSession: loginResult?.session || null,
    lastMeterReadRequest: null,
  });

  return sessionId;
}

async function getSession(sessionId, providerName) {
  if (!sessionId) {
    throw createHttpError(
      "Invalid or expired SMT session. Please login again.",
      401
    );
  }

  const session = await sessionStore.get(sessionId);
  if (!session) {
    throw createHttpError("Invalid or expired SMT session. Please login again.", 401);
  }

  if (session.providerName !== providerName) {
    throw createHttpError(
      "Invalid or expired SMT session. Please login again.",
      401
    );
  }

  return session;
}

function sanitizeLoginResult(loginResult = {}) {
  const { client: _client, ...safeSerializableResult } = loginResult;
  const safeResult = JSON.parse(JSON.stringify(safeSerializableResult));

  if (safeResult.accessToken) {
    delete safeResult.accessToken;
  }

  if (safeResult?.data?.token) {
    delete safeResult.data.token;
  }

  if (safeResult.client) {
    delete safeResult.client;
  }

  if (safeResult.session) {
    delete safeResult.session;
  }

  return safeResult;
}

function sanitizeUsageResult(usageResult = {}) {
  const safeResult = JSON.parse(JSON.stringify(usageResult));
  if (safeResult.session) {
    delete safeResult.session;
  }
  return safeResult;
}

function resolveEsiidFromUsageOptions(options = {}, session = {}) {
  return (
    options?.payload?.ESIID ||
    options?.ESIID ||
    session?.defaultEsiid ||
    null
  );
}

async function enforceMeterReadRateLimit(esiid) {
  const state = await odrRateLimiter.getState({
    esiid,
    maxPerHour: MAX_METER_READS_PER_HOUR,
    maxPerDay: MAX_METER_READS_PER_DAY,
  });
  if (state.inLastHour >= MAX_METER_READS_PER_HOUR) {
    const error = createHttpError(
      `Meter-read rate limit reached for ESIID ${esiid}. Maximum ${MAX_METER_READS_PER_HOUR} requests per hour.`,
      429
    );
    error.rateLimit = {
      window: "hour",
      max: MAX_METER_READS_PER_HOUR,
      remaining: 0,
      retryAfterSeconds: 60 * 60,
      retryAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    throw error;
  }

  if (state.inLastDay >= MAX_METER_READS_PER_DAY) {
    const error = createHttpError(
      `Meter-read rate limit reached for ESIID ${esiid}. Maximum ${MAX_METER_READS_PER_DAY} requests per day.`,
      429
    );
    error.rateLimit = {
      window: "day",
      max: MAX_METER_READS_PER_DAY,
      remaining: 0,
      retryAfterSeconds: 24 * 60 * 60,
      retryAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    throw error;
  }
}

async function registerMeterReadAttempt(esiid) {
  return odrRateLimiter.registerAttempt({
    esiid,
    maxPerHour: MAX_METER_READS_PER_HOUR,
    maxPerDay: MAX_METER_READS_PER_DAY,
  });
}

exports.getActiveProvider = () => {
  const provider = getProviderName();
  return createSmtSuccess({
    provider,
    operation: "provider_status",
    data: {
      activeProvider: provider,
    },
  });
};

exports.login = async (credentials = {}) => {
  const providerName = getProviderName();
  const provider = getSmtProvider();
  const sessionClient =
    providerName === "unofficial" && typeof provider.createSessionClient === "function"
      ? provider.createSessionClient()
      : null;
  const rawResult = await provider.login({
    ...credentials,
    client: sessionClient,
  });
  const loginDefaultEsiid = resolveEsiidFromUsageOptions(
    {
      payload: credentials,
      ESIID: credentials?.ESIID,
    },
    {}
  );
  const sessionId = await createSession(providerName, rawResult, {
    defaultEsiid: loginDefaultEsiid,
  });

  return createSmtSuccess({
    provider: providerName,
    operation: "login",
    data: sanitizeLoginResult(rawResult),
    meta: {
      sessionId,
      sessionTtlSeconds: SESSION_TTL_SECONDS,
    },
  });
};

exports.getUsage = async (options = {}) => {
  const provider = getSmtProvider();
  const providerName = getProviderName();
  const sessionId = options.sessionId;
  const session = await getSession(sessionId, providerName);
  const payload =
    options.payload && typeof options.payload === "object" ? { ...options.payload } : undefined;
  if (payload?.sessionId) {
    delete payload.sessionId;
  }
  const esiid = resolveEsiidFromUsageOptions(
    {
      payload,
      ESIID: options.ESIID,
    },
    session
  );
  if (!esiid) {
    throw createHttpError(
      "Missing ESIID for usage request. Provide payload.ESIID (or query ESIID) or set default ESIID.",
      400
    );
  }

  const rawResult = await provider.getUsage({
    accessToken: session.accessToken,
    payload: { ...(payload || {}), ESIID: esiid },
    defaultEsiid: session.defaultEsiid,
    session: session.providerSession || undefined,
  });

  const updatedSession = {
    ...session,
    providerSession: rawResult?.session || session.providerSession || null,
    defaultEsiid:
      rawResult?.session?.defaultEsiid || session.defaultEsiid || rawResult?.result?.ESIID || esiid,
    accessToken: rawResult?.accessToken || session.accessToken,
  };
  await sessionStore.set(sessionId, updatedSession);

  // Persist meter read to DB
  try {
    persistMeterRead(session, esiid, rawResult?.result);
  } catch (_) { /* best-effort */ }

  return createSmtSuccess({
    provider: providerName,
    operation: "usage",
    data: sanitizeUsageResult(rawResult),
  });
};

exports.requestOnDemandRead = async (options = {}) => {
  const provider = getSmtProvider();
  const providerName = getProviderName();
  const sessionId = options.sessionId;
  const session = await getSession(sessionId, providerName);
  const payload =
    options.payload && typeof options.payload === "object" ? { ...options.payload } : undefined;
  if (payload?.sessionId) {
    delete payload.sessionId;
  }

  const esiid = resolveEsiidFromUsageOptions({ payload }, session);
  if (!esiid) {
    throw createHttpError(
      "Missing ESIID for on-demand meter-read request. Provide payload.ESIID or set default ESIID.",
      400
    );
  }

  await enforceMeterReadRateLimit(esiid);

  if (typeof provider.requestOnDemandRead !== "function") {
    throw createHttpError(
      `Provider "${providerName}" does not support on-demand meter-read requests.`,
      501
    );
  }

  const rawResult = await provider.requestOnDemandRead({
    accessToken: session.accessToken,
    payload: { ...(payload || {}), ESIID: esiid },
    defaultEsiid: session.defaultEsiid,
    session: session.providerSession || undefined,
  });

  const updatedSession = {
    ...session,
    providerSession: rawResult?.session || session.providerSession || null,
    defaultEsiid:
      rawResult?.session?.defaultEsiid || session.defaultEsiid || rawResult?.result?.ESIID || esiid,
    accessToken: rawResult?.accessToken || session.accessToken,
    lastMeterReadRequest: {
      ESIID: rawResult?.result?.ESIID || esiid,
      transId: rawResult?.result?.transId || null,
      correlationId: rawResult?.result?.correlationId || null,
      requestedAt: new Date().toISOString(),
    },
  };
  await sessionStore.set(sessionId, updatedSession);
  const rateState = await registerMeterReadAttempt(esiid);
  const user = resolveUserForSession(session, esiid);
  if (user?.id) {
    scheduleEventPush(user.id, "alerts_changed", "odr_requested");
  }

  // Persist user meter number (first-time setup) when provided by client.
  try {
    const meterFromPayload = payload?.MeterNumber || payload?.meterNumber || null;
    persistMeterNumberForUser(session, esiid, meterFromPayload);
  } catch (_) {
    // Best-effort
  }

  return createSmtSuccess({
    provider: providerName,
    operation: "meter_read_request",
    data: sanitizeUsageResult(rawResult),
    meta: {
      rateLimit: {
        perHour: {
          max: MAX_METER_READS_PER_HOUR,
          remaining: rateState.remainingThisHour,
        },
        perDay: {
          max: MAX_METER_READS_PER_DAY,
          remaining: rateState.remainingToday,
        },
      },
    },
  });
};

exports.getMeterReadStatus = async (options = {}) => {
  const provider = getSmtProvider();
  const providerName = getProviderName();
  const sessionId = options.sessionId;
  const session = await getSession(sessionId, providerName);
  const payload =
    options.payload && typeof options.payload === "object" ? { ...options.payload } : {};
  if (payload.sessionId) {
    delete payload.sessionId;
  }

  if (typeof provider.getMeterReadStatus !== "function") {
    throw createHttpError(
      `Provider "${providerName}" does not support meter-read status checks.`,
      501
    );
  }

  const esiid = resolveEsiidFromUsageOptions({ payload }, session);
  if (!esiid) {
    throw createHttpError(
      "Missing ESIID for meter-read status request. Provide payload.ESIID or set default ESIID.",
      400
    );
  }

  if (!payload.trans_id && !payload.transId && session?.lastMeterReadRequest?.transId) {
    payload.transId = session.lastMeterReadRequest.transId;
  }
  if (!payload.correlationId && session?.lastMeterReadRequest?.correlationId) {
    payload.correlationId = session.lastMeterReadRequest.correlationId;
  }

  const rawResult = await provider.getMeterReadStatus({
    accessToken: session.accessToken,
    payload: { ...payload, ESIID: esiid },
    defaultEsiid: session.defaultEsiid,
    session: session.providerSession || undefined,
  });

  const updatedSession = {
    ...session,
    providerSession: rawResult?.session || session.providerSession || null,
    defaultEsiid:
      rawResult?.session?.defaultEsiid || session.defaultEsiid || rawResult?.result?.ESIID || esiid,
    accessToken: rawResult?.accessToken || session.accessToken,
    lastMeterReadRequest:
      session?.lastMeterReadRequest ||
      (rawResult?.result?.transId || rawResult?.result?.correlationId
        ? {
            ESIID: rawResult?.result?.ESIID || esiid,
            transId: rawResult?.result?.transId || null,
            correlationId: rawResult?.result?.correlationId || null,
            requestedAt: new Date().toISOString(),
          }
        : null),
  };
  await sessionStore.set(sessionId, updatedSession);

  return createSmtSuccess({
    provider: providerName,
    operation: "meter_read_status",
    data: sanitizeUsageResult(rawResult),
  });
};

exports.getUsageHistory = async (options = {}) => {
  const provider = getSmtProvider();
  const providerName = getProviderName();
  const sessionId = options.sessionId;
  const session = await getSession(sessionId, providerName);
  const payload =
    options.payload && typeof options.payload === "object" ? { ...options.payload } : {};
  if (payload.sessionId) {
    delete payload.sessionId;
  }

  const granularityInput = String(payload.granularity || "15m").toLowerCase();
  const granularityMap = {
    "15m": "15m",
    "1h": "1h",
    "1d": "1d",
    "1mo": "1mo",
    daily: "1d",
    hourly: "1h",
    monthly: "1mo",
  };
  const granularity = granularityMap[granularityInput] || "15m";
  delete payload.granularity;

  if (typeof provider.getUsageHistory !== "function") {
    throw createHttpError(`Provider "${providerName}" does not support usage history.`, 501);
  }

  const rawResult = await provider.getUsageHistory({
    accessToken: session.accessToken,
    payload,
    mode: granularity === "1d" ? "daily" : granularity === "1mo" ? "monthly" : "interval",
    defaultEsiid: session.defaultEsiid,
    session: session.providerSession || undefined,
  });

  const updatedSession = {
    ...session,
    providerSession: rawResult?.session || session.providerSession || null,
    defaultEsiid:
      rawResult?.session?.defaultEsiid || session.defaultEsiid || rawResult?.result?.ESIID || null,
    accessToken: rawResult?.accessToken || session.accessToken,
  };
  await sessionStore.set(sessionId, updatedSession);

  const points = rawResult?.result?.points || [];
  const aggregated = aggregateUsagePoints(points, granularity);

  // Persist daily points to DB if we can resolve the user
  if (granularity === "1d" && aggregated.length > 0) {
    try {
      const esiid = resolveEsiidFromUsageOptions({ payload }, session);
      persistDailyPoints(session, esiid, aggregated);
    } catch (_) {
      // Best-effort; don't break the response
    }
  }

  return createSmtSuccess({
    provider: providerName,
    operation: "usage_history",
    data: {
      ...sanitizeUsageResult(rawResult),
      result: {
        ...rawResult?.result,
        points: aggregated,
      },
    },
    meta: {
      granularity,
      sourcePoints: points.length,
      aggregatedPoints: aggregated.length,
    },
  });
};

exports.getSessionStatus = async (options = {}) => {
  const providerName = getProviderName();
  const sessionId = options.sessionId;
  const session = await getSession(sessionId, providerName);
  const now = Date.now();
  const expiresAt = new Date(now + SESSION_TTL_SECONDS * 1000).toISOString();

  return createSmtSuccess({
    provider: providerName,
    operation: "session_status",
    data: {
      active: true,
      sessionId,
      providerName: session.providerName,
      defaultEsiid: session.defaultEsiid || null,
      sessionTtlSeconds: SESSION_TTL_SECONDS,
      ttlPolicy: "sliding",
      checkedAt: new Date(now).toISOString(),
      expiresAt,
    },
  });
};

// ---------------------------------------------------------------------------
// DB persistence helpers (best-effort, called from normal API flow)
// ---------------------------------------------------------------------------
function resolveUserForSession(session, esiid) {
  if (!session?.providerName || !esiid) return null;
  // Try to find user by the SMT username stored in session
  // (session doesn't store username, so we look up by esiid)
  const { getDb } = require("../db/database");
  const db = getDb();
  const user = db
    .prepare("SELECT id FROM users WHERE esiid = ? LIMIT 1")
    .get(esiid);
  return user || null;
}

function persistDailyPoints(session, esiid, aggregatedPoints) {
  const user = resolveUserForSession(session, esiid);
  if (!user) return;

  const dbPoints = [];
  for (const pt of aggregatedPoints) {
    const d = new Date(pt.timestamp);
    if (Number.isNaN(d.getTime())) continue;
    const kwh = Number(pt.usage);
    if (Number.isNaN(kwh)) continue;
    dbPoints.push({ date: fmtCentralDate(d), kwh });
  }

  if (dbPoints.length > 0) {
    dailyUsageModel.upsertMany({
      userId: user.id,
      esiid,
      points: dbPoints,
      source: "api_fetch",
    });
    scheduleDataChangePush(user.id, "daily_usage_updated");
  }
}

function persistMeterRead(session, esiid, result) {
  const user = resolveUserForSession(session, esiid);
  if (!user || result?.usage == null) return;

  const readingKwh = Number(result.usage);
  // After a new ODR, SMT resets odrusage to 0. Don't overwrite the
  // previous good DB entry with a zero reading.
  if (!readingKwh || readingKwh <= 0) return;

  const readAt = result.readAt || new Date().toISOString();

  meterReadModel.insert({
    userId: user.id,
    esiid,
    meterNumber: result.MeterNumber || result.meterNumber || null,
    readingKwh,
    readAt,
    source: "odr",
  });

  // Also store the ODR reading as a daily_usage entry so it feeds into
  // usage history summaries, trend calculations, and charts immediately.
  // Uses "keep higher" logic: never overwrites a more complete sync value.
  try {
    const readDate = new Date(readAt);
    if (!Number.isNaN(readDate.getTime())) {
      dailyUsageModel.upsertDayIfHigher({
        userId: user.id,
        esiid,
        date: fmtCentralDate(readDate),
        kwh: readingKwh,
        source: "odr",
      });
    }
  } catch (_) {
    // Best-effort; meter_read was already saved.
  }

  scheduleDataChangePush(user.id, "meter_read_updated");
}

function persistMeterNumberForUser(session, esiid, meterNumber) {
  const normalized = String(meterNumber || "").trim();
  if (!normalized) return;
  const user = resolveUserForSession(session, esiid);
  if (!user) return;
  try {
    userModel.updateMeterNumber(user.id, normalized);
  } catch (_) {
    // Best-effort persistence; don't break request flow.
  }
}

// ---------------------------------------------------------------------------
// Expose session internals so other modules (auth controller) can reuse
// the access-token without logging in a second time.
// ---------------------------------------------------------------------------
exports.getSessionData = async (sessionId) => {
  if (!sessionId) return null;
  return sessionStore.get(sessionId); // returns the full session object or null
};

exports.logout = async (options = {}) => {
  const provider = getProviderName();
  const sessionId = options.sessionId;
  let sessionExisted = false;
  if (sessionId) {
    const session = await sessionStore.get(sessionId);
    sessionExisted = Boolean(session);
    if (sessionExisted) {
      await sessionStore.delete(sessionId);
    }
  }

  return createSmtSuccess({
    provider,
    operation: "logout",
    data: {
      loggedOut: true,
      sessionExisted,
    },
  });
};