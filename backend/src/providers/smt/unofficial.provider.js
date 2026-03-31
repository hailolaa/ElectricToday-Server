const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const tough = require("tough-cookie");

const BASE_URL = process.env.SMT_UNOFFICIAL_BASE_URL || "https://www.smartmetertexas.com";
const AUTH_PATH = process.env.SMT_UNOFFICIAL_AUTH_PATH || "/commonapi/user/authenticate";
const LATEST_ODR_PATH =
  process.env.SMT_UNOFFICIAL_USAGE_PATH || "/api/usage/latestodrread";
const ONDEMAND_READ_PATH =
  process.env.SMT_UNOFFICIAL_ONDEMAND_PATH || "/api/ondemandread";
const ODR_STATUS_PATH =
  process.env.SMT_UNOFFICIAL_ODR_STATUS_PATH || "/api/usage/latestodrread";
const USAGE_HISTORY_PATH =
  process.env.SMT_UNOFFICIAL_USAGE_HISTORY_PATH || "/api/usage/history";
const INTERVAL_USAGE_PATH =
  process.env.SMT_UNOFFICIAL_INTERVAL_USAGE_PATH || "/api/usage/interval";
const DAILY_USAGE_PATH =
  process.env.SMT_UNOFFICIAL_DAILY_USAGE_PATH || "/api/usage/daily";
const MONTHLY_USAGE_PATH =
  process.env.SMT_UNOFFICIAL_MONTHLY_USAGE_PATH || "/api/usage/monthly";
const USER_PROFILE_PATH =
  process.env.SMT_UNOFFICIAL_PROFILE_PATH || "/commonapi/user/getuser";
const ALLOW_ENV_FALLBACK = String(process.env.SMT_UNOFFICIAL_ALLOW_ENV_FALLBACK || "false")
  .toLowerCase()
  .trim() === "true";

function deserializeCookieJar(serializedJar) {
  if (!serializedJar) {
    return new tough.CookieJar();
  }

  const parsedJar = typeof serializedJar === "string" ? JSON.parse(serializedJar) : serializedJar;

  if (typeof tough.CookieJar.deserializeSync === "function") {
    return tough.CookieJar.deserializeSync(parsedJar);
  }

  if (typeof tough.CookieJar.fromJSON === "function") {
    return tough.CookieJar.fromJSON(parsedJar);
  }

  return new tough.CookieJar();
}

function serializeCookieJar(jar) {
  if (!jar) {
    return null;
  }

  if (typeof jar.serializeSync === "function") {
    return jar.serializeSync();
  }

  if (typeof jar.toJSON === "function") {
    return jar.toJSON();
  }

  return null;
}

function getClientJar(client) {
  return client?.defaults?.jar || null;
}

function createSessionClient(serializedJar = null) {
  const jar = deserializeCookieJar(serializedJar);
  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    })
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeEsiid(value) {
  return isNonEmptyString(value) && /^[0-9]{17}$/.test(value.trim());
}

function findFirstEsiidDeep(input) {
  if (input == null) {
    return null;
  }

  if (typeof input === "string") {
    return looksLikeEsiid(input) ? input.trim() : null;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = findFirstEsiidDeep(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      // Prefer explicit ESIID-like fields first.
      if (/esiid/i.test(key) && isNonEmptyString(value)) {
        if (looksLikeEsiid(value)) {
          return value.trim();
        }
      }
    }

    for (const value of Object.values(input)) {
      const found = findFirstEsiidDeep(value);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function tryLoadDefaultEsiid(client, accessToken) {
  if (!accessToken) {
    return null;
  }

  try {
    const response = await client.get(`${BASE_URL}${USER_PROFILE_PATH}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return findFirstEsiidDeep(response.data);
  } catch (error) {
    return null;
  }
}

function buildUsagePayload(options = {}) {
  const inputPayload = options.payload || {};
  const defaultEsiid = options.defaultEsiid;
  const esiid = inputPayload.ESIID || inputPayload.esiid || defaultEsiid;

  if (esiid) {
    return { ESIID: esiid };
  }

  if (ALLOW_ENV_FALLBACK) {
    const envEsiid = process.env.SMT_ESIID || process.env.SMT_UNOFFICIAL_ESIID || null;
    if (envEsiid) {
      return { ESIID: envEsiid };
    }
  }

  throw new Error(
    "Unofficial provider usage requires ESIID. Provide payload.ESIID or ensure session has defaultEsiid."
  );
}

function fmtSmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function buildIntervalPayload(options = {}) {
  const usagePayload = buildUsagePayload(options);
  const inputPayload = options.payload || {};

  const now = new Date();
  const startDate = inputPayload.startDate || fmtSmtDate(now);
  const endDate = inputPayload.endDate || fmtSmtDate(now);

  return {
    esiid: usagePayload.ESIID,
    startDate,
    endDate,
  };
}

function normalizeLatestOdrResponse(apiResponse, esiid) {
  const data = apiResponse?.data || {};

  return {
    ESIID: esiid,
    status: data.odrstatus || null,
    read: data.odrread ?? null,
    usage: data.odrusage ?? null,
    readAt: data.odrdate || null,
    responseMessage: data.responseMessage || null,
    raw: apiResponse,
  };
}

function normalizeOnDemandReadResponse(apiResponse, esiid) {
  const data = apiResponse?.data || {};
  return {
    ESIID: esiid,
    transId: data.trans_id || null,
    correlationId: data.correlationId || null,
    statusCode: data.statusCode || null,
    statusReason: data.statusReason || null,
    status: data.status || data.odrstatus || data.statusReason || "REQUESTED",
    message: data.responseMessage || data.message || data.statusReason || null,
    raw: apiResponse,
  };
}

function normalizeMeterReadStatusResponse(apiResponse, payload = {}) {
  const data = apiResponse?.data || {};
  return {
    ESIID: payload.ESIID || null,
    transId: payload.trans_id || payload.transId || data.trans_id || null,
    correlationId: payload.correlationId || data.correlationId || null,
    statusCode: data.statusCode || null,
    statusReason: data.statusReason || data.responseMessage || null,
    odrStatus: data.odrstatus || null,
    read: data.odrread ?? null,
    usage: data.odrusage ?? null,
    readAt: data.odrdate || null,
    raw: apiResponse,
  };
}

function buildOnDemandPayload(options = {}) {
  const usagePayload = buildUsagePayload(options);
  const inputPayload = options.payload || {};
  const meterNumber = inputPayload.MeterNumber || inputPayload.meterNumber || "";

  if (meterNumber) {
    return {
      ESIID: usagePayload.ESIID,
      MeterNumber: meterNumber,
    };
  }

  if (ALLOW_ENV_FALLBACK && process.env.SMT_UNOFFICIAL_METER_NUMBER) {
    return {
      ESIID: usagePayload.ESIID,
      MeterNumber: process.env.SMT_UNOFFICIAL_METER_NUMBER,
    };
  }

  throw new Error(
    "Unofficial provider on-demand meter-read requires MeterNumber. Provide payload.MeterNumber."
  );
}

function pickTimestamp(item = {}) {
  return (
    item.timestamp ||
    item.timeStamp ||
    item.intervalStart ||
    item.startAt ||
    item.startTime ||
    item.readAt ||
    item.odrdate ||
    item.dateTime ||
    item.datetime ||
    item.date ||
    null
  );
}

function pickUsage(item = {}) {
  const value =
    item.usage ??
    item.kwh ??
    item.kWh ??
    item.value ??
    item.consumption ??
    item.odrusage ??
    null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function normalizeHistoryPoints(apiResponse) {
  const candidates = [
    apiResponse?.data?.intervals,
    apiResponse?.data?.history,
    apiResponse?.data?.data,
    apiResponse?.intervals,
    apiResponse?.history,
    Array.isArray(apiResponse?.data) ? apiResponse?.data : null,
    Array.isArray(apiResponse) ? apiResponse : null,
  ];

  const source = candidates.find((x) => Array.isArray(x)) || [];
  return source
    .map((item) => ({
      timestamp: pickTimestamp(item),
      usage: pickUsage(item),
      raw: item,
    }))
    .filter((x) => x.timestamp && x.usage !== null);
}

function parseIntervalTimestamp(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const clean = String(timeStr).trim().toLowerCase();
  const m = clean.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (!m) return null;

  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const period = m[3];
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (period === "am" && hours === 12) hours = 0;
  if (period === "pm" && hours !== 12) hours += 12;

  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function normalizeIntervalUsagePoints(apiResponse) {
  const source = Array.isArray(apiResponse?.intervaldata) ? apiResponse.intervaldata : [];
  return source
    .map((item) => ({
      timestamp: parseIntervalTimestamp(item?.date, item?.starttime),
      usage: Number(item?.consumption),
      raw: item,
    }))
    .filter((x) => x.timestamp && !Number.isNaN(x.usage));
}

function normalizeDailyHistoryPoints(apiResponse) {
  const source = Array.isArray(apiResponse?.dailyData) ? apiResponse.dailyData : [];

  // SMT daily data items may contain:
  //   - `energyDataKwh` or `actualKwh` or `kwhUsage` → true daily consumption
  //   - `reading` → could be cumulative meter reading
  // We prefer explicit consumption fields; fall back to computing diffs
  // between consecutive readings when only `reading` is available.

  const hasConsumptionField = source.some(
    (item) =>
      item?.energyDataKwh != null ||
      item?.actualKwh != null ||
      item?.kwhUsage != null
  );

  if (hasConsumptionField) {
    return source
      .map((item) => ({
        timestamp: item?.date || null,
        usage: Number(
          item?.energyDataKwh ?? item?.actualKwh ?? item?.kwhUsage ?? 0
        ),
        raw: item,
      }))
      .filter((x) => x.timestamp && !Number.isNaN(x.usage));
  }

  // Fallback: treat `reading` as cumulative and compute day-over-day diffs
  const sorted = source
    .map((item) => ({
      timestamp: item?.date || null,
      reading: Number(item?.reading),
      raw: item,
    }))
    .filter((x) => x.timestamp && !Number.isNaN(x.reading))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Heuristic: treat as cumulative when readings are mostly monotonic
  // non-decreasing across the series.
  let nonDecreasingSteps = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].reading >= sorted[i - 1].reading) {
      nonDecreasingSteps += 1;
    }
  }
  const transitions = Math.max(0, sorted.length - 1);
  const monotonicRatio = transitions > 0 ? nonDecreasingSteps / transitions : 0;
  const isCumulative = sorted.length >= 2 && monotonicRatio >= 0.8;

  if (isCumulative) {
    const result = [];
    for (let i = 1; i < sorted.length; i++) {
      const diff = sorted[i].reading - sorted[i - 1].reading;
      if (diff >= 0) {
        result.push({
          timestamp: sorted[i].timestamp,
          usage: Number(diff.toFixed(5)),
          raw: sorted[i].raw,
        });
      }
    }
    return result;
  }

  // Otherwise, `reading` already represents daily consumption
  return sorted.map((x) => ({
    timestamp: x.timestamp,
    usage: x.reading,
    raw: x.raw,
  }));
}

function normalizeMonthlyHistoryPoints(apiResponse) {
  const source = Array.isArray(apiResponse?.monthlyData) ? apiResponse.monthlyData : [];
  return source
    .map((item) => ({
      timestamp: item?.enddate || item?.startdate || null,
      usage: Number(item?.actl_kwh_usg),
      raw: item,
    }))
    .filter((x) => x.timestamp && !Number.isNaN(x.usage));
}

function buildDateRangePayload(options = {}) {
  const usagePayload = buildUsagePayload(options);
  const inputPayload = options.payload || {};
  const startDate = inputPayload.startDate;
  const endDate = inputPayload.endDate;

  if (!startDate || !endDate) {
    throw new Error(
      "Usage history for daily/monthly requires startDate and endDate (MM/DD/YYYY)."
    );
  }

  return {
    esiid: usagePayload.ESIID,
    startDate,
    endDate,
  };
}

function pickLoginId(credentials = {}) {
  const runtimeValue = credentials.username || credentials.userId || credentials.userid || "";
  if (runtimeValue) {
    return runtimeValue;
  }

  if (ALLOW_ENV_FALLBACK) {
    return process.env.SMT_UNOFFICIAL_USERNAME || process.env.SMT_SERVICE_USERNAME || "";
  }

  return "";
}

function pickPassword(credentials = {}) {
  if (credentials.password) {
    return credentials.password;
  }

  if (ALLOW_ENV_FALLBACK) {
    return process.env.SMT_UNOFFICIAL_PASSWORD || process.env.SMT_SERVICE_PASSWORD || "";
  }

  return "";
}

function buildAuthPayload(credentials = {}) {
  const loginId = pickLoginId(credentials);
  const password = pickPassword(credentials);
  const rememberMe =
    credentials.rememberMe !== undefined
      ? String(credentials.rememberMe)
      : process.env.SMT_UNOFFICIAL_REMEMBER_ME || "true";

  return {
    ...credentials,
    username: credentials.username || loginId,
    userId: credentials.userId || credentials.userid || loginId,
    userid: credentials.userid || credentials.userId || loginId,
    password,
    rememberMe,
  };
}

exports.login = async (credentials = {}) => {
  const client =
    credentials.client || createSessionClient(credentials?.session?.cookieJar || null);
  const authCredentials = { ...credentials };
  delete authCredentials.client;
  delete authCredentials.session;

  const loginId = pickLoginId(authCredentials);
  const password = pickPassword(authCredentials);

  if (!loginId || !password) {
    throw new Error(
      "Unofficial provider requires runtime login id and password. Send username/userId + password in request body."
    );
  }

  await client.get(BASE_URL);

  const response = await client.post(`${BASE_URL}${AUTH_PATH}`, buildAuthPayload(authCredentials), {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      "x-amzn-trace-id": `Service=Authenticate,Request-ID=${loginId}`,
    },
  });

  const accessToken = response.data?.token || null;
  if (!accessToken) {
    throw new Error("SMT unofficial auth succeeded but no token was returned.");
  }

  // Optional best-effort enrichment: discover default ESIID for subsequent GET /usage calls.
  const defaultEsiid = await tryLoadDefaultEsiid(client, accessToken);

  return {
    provider: "unofficial",
    message: "Logged in to SMT",
    data: {
      ...response.data,
      defaultEsiid,
    },
    accessToken,
    session: {
      cookieJar: serializeCookieJar(getClientJar(client)),
      defaultEsiid,
    },
  };
};

exports.getUsage = async (options = {}) => {
  const accessToken = options.accessToken;
  if (!accessToken) {
    throw new Error("Unofficial provider getUsage requires accessToken.");
  }

  const client = options.client || createSessionClient(options?.session?.cookieJar || null);
  const payload = buildUsagePayload(options);

  const response = await client.post(`${BASE_URL}${LATEST_ODR_PATH}`, payload, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    provider: "unofficial",
    result: normalizeLatestOdrResponse(response.data, payload.ESIID),
    session: {
      cookieJar: serializeCookieJar(getClientJar(client)),
      defaultEsiid: options.defaultEsiid || payload.ESIID || null,
    },
  };
};

exports.requestOnDemandRead = async (options = {}) => {
  const accessToken = options.accessToken;
  if (!accessToken) {
    throw new Error("Unofficial provider requestOnDemandRead requires accessToken.");
  }

  const client = options.client || createSessionClient(options?.session?.cookieJar || null);
  const payload = buildOnDemandPayload(options);

  const response = await client.post(`${BASE_URL}${ONDEMAND_READ_PATH}`, payload, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    provider: "unofficial",
    result: normalizeOnDemandReadResponse(response.data, payload.ESIID),
    session: {
      cookieJar: serializeCookieJar(getClientJar(client)),
      defaultEsiid: options.defaultEsiid || payload.ESIID || null,
    },
  };
};

exports.getMeterReadStatus = async (options = {}) => {
  const accessToken = options.accessToken;
  if (!accessToken) {
    throw new Error("Unofficial provider getMeterReadStatus requires accessToken.");
  }

  const client = options.client || createSessionClient(options?.session?.cookieJar || null);
  const basePayload = buildUsagePayload(options);
  const inputPayload = options.payload || {};
  const payload = {
    ESIID: basePayload.ESIID,
  };

  if (inputPayload.trans_id || inputPayload.transId) {
    payload.trans_id = inputPayload.trans_id || inputPayload.transId;
  }
  if (inputPayload.correlationId) {
    payload.correlationId = inputPayload.correlationId;
  }

  const response = await client.post(`${BASE_URL}${ODR_STATUS_PATH}`, payload, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return {
    provider: "unofficial",
    result: normalizeMeterReadStatusResponse(response.data, payload),
    session: {
      cookieJar: serializeCookieJar(getClientJar(client)),
      defaultEsiid: options.defaultEsiid || payload.ESIID || null,
    },
  };
};

exports.getUsageHistory = async (options = {}) => {
  const accessToken = options.accessToken;
  if (!accessToken) {
    throw new Error("Unofficial provider getUsageHistory requires accessToken.");
  }

  const client = options.client || createSessionClient(options?.session?.cookieJar || null);
  const historyMode = String(options.mode || "interval").toLowerCase();
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: BASE_URL,
    Referer: `${BASE_URL}/`,
    Authorization: `Bearer ${accessToken}`,
  };

  let response;
  let normalizedPoints = [];
  let resolvedEsiid = null;
  let source = "interval";

  if (historyMode === "daily") {
    const payload = buildDateRangePayload(options);
    resolvedEsiid = payload.esiid;
    response = await client.post(`${BASE_URL}${DAILY_USAGE_PATH}`, payload, { headers });
    normalizedPoints = normalizeDailyHistoryPoints(response.data);
    source = "daily";
  } else if (historyMode === "monthly") {
    const payload = buildDateRangePayload(options);
    resolvedEsiid = payload.esiid;
    response = await client.post(`${BASE_URL}${MONTHLY_USAGE_PATH}`, payload, { headers });
    normalizedPoints = normalizeMonthlyHistoryPoints(response.data);
    source = "monthly";
  } else {
    const intervalPayload = buildIntervalPayload(options);
    resolvedEsiid = intervalPayload.esiid;
    response = await client.post(`${BASE_URL}${INTERVAL_USAGE_PATH}`, intervalPayload, { headers });
    normalizedPoints = normalizeIntervalUsagePoints(response.data);
    source = "interval";
  }

  return {
    provider: "unofficial",
    result: {
      ESIID: resolvedEsiid,
      points: normalizedPoints,
      source,
      raw: response.data,
    },
    session: {
      cookieJar: serializeCookieJar(getClientJar(client)),
      defaultEsiid: options.defaultEsiid || resolvedEsiid || null,
    },
  };
};

exports.createSessionClient = createSessionClient;
