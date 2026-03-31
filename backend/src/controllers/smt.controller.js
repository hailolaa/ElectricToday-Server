const smtService = require("../services/smt.service");
const { getProviderName } = require("../providers/smt");
const { createSmtError } = require("../utils/smtResponse");
const { SmtErrorCodes } = require("../constants/smtErrorCodes");

function resolveSessionId(req) {
  const headerSessionId = req.headers["x-smt-session-id"];
  if (typeof headerSessionId === "string" && headerSessionId.trim()) {
    return headerSessionId.trim();
  }

  const querySessionId = req.query?.sessionId;
  if (typeof querySessionId === "string" && querySessionId.trim()) {
    return querySessionId.trim();
  }

  const bodySessionId = req.body?.sessionId;
  if (typeof bodySessionId === "string" && bodySessionId.trim()) {
    return bodySessionId.trim();
  }

  return null;
}

function sendNormalizedError(res, operation, error) {
  function mapStatusToCode(status) {
    if (status === 400) return SmtErrorCodes.VALIDATION;
    if (status === 401) return SmtErrorCodes.SESSION_EXPIRED;
    if (status === 403) return SmtErrorCodes.UNAUTHORIZED;
    if (status === 429) return SmtErrorCodes.RATE_LIMIT;
    if (status >= 500) return SmtErrorCodes.INTERNAL;
    return SmtErrorCodes.REQUEST_ERROR;
  }

  const upstreamStatus = error?.response?.status;
  const status = Number.isInteger(error?.statusCode)
    ? error.statusCode
    : Number.isInteger(upstreamStatus)
      ? upstreamStatus
      : 500;
  const upstreamMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.statusReason ||
    null;
  const rawMessage = String(upstreamMessage || error?.message || "");
  const lowerMessage = rawMessage.toLowerCase();
  const looksLikeRequestValidation =
    lowerMessage.includes("required") ||
    lowerMessage.includes("missing") ||
    lowerMessage.includes("invalid request body") ||
    lowerMessage.includes("esiid");
  const loginCredentialFailure =
    operation === "login" && status === 400 && !looksLikeRequestValidation;
  const finalStatus = loginCredentialFailure ? 401 : status;
  const code = mapStatusToCode(finalStatus);
  const payload = createSmtError({
    provider: getProviderName(),
    operation,
    message: loginCredentialFailure
      ? "Invalid username or password."
      : upstreamMessage || error?.message || "Internal server error",
    code,
    details: error?.rateLimit || error?.response?.data?.error?.details || null,
  });
  return res.status(finalStatus).json(payload);
}

 

exports.getProvider = async (req, res) => {
  try {
    const data = smtService.getActiveProvider();
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "provider_status", error);
  }
};

exports.login = async (req, res) => {
  try {
    const data = await smtService.login(req.body);
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "login", error);
  }
};

exports.getSessionStatus = async (req, res) => {
  try {
    const data = await smtService.getSessionStatus({
      sessionId: resolveSessionId(req),
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "session_status", error);
  }
};

exports.getUsage = async (req, res) => {
  try {
    const queryEsiid = typeof req.query?.ESIID === "string" ? req.query.ESIID : undefined;
    const data = await smtService.getUsage({
      sessionId: resolveSessionId(req),
      ESIID: queryEsiid,
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "usage", error);
  }
};

exports.getUsageWithPayload = async (req, res) => {
  try {
    const data = await smtService.getUsage({
      sessionId: resolveSessionId(req),
      payload: req.body,
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "usage", error);
  }
};

exports.logout = async (req, res) => {
  try {
    const data = await smtService.logout({
      sessionId: resolveSessionId(req),
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "logout", error);
  }
};

exports.requestOnDemandRead = async (req, res) => {
  try {
    const data = await smtService.requestOnDemandRead({
      sessionId: resolveSessionId(req),
      payload: req.body,
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "meter_read_request", error);
  }
};

exports.getMeterReadStatus = async (req, res) => {
  try {
    const data = await smtService.getMeterReadStatus({
      sessionId: resolveSessionId(req),
      payload: req.body,
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "meter_read_status", error);
  }
};

exports.getUsageHistory = async (req, res) => {
  try {
    const data = await smtService.getUsageHistory({
      sessionId: resolveSessionId(req),
      payload: req.body,
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "usage_history", error);
  }
};

exports.getDailyUsageHistory = async (req, res) => {
  try {
    const data = await smtService.getUsageHistory({
      sessionId: resolveSessionId(req),
      payload: {
        ...(req.body || {}),
        granularity: "daily",
      },
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "usage_history_daily", error);
  }
};

exports.getMonthlyUsageHistory = async (req, res) => {
  try {
    const data = await smtService.getUsageHistory({
      sessionId: resolveSessionId(req),
      payload: {
        ...(req.body || {}),
        granularity: "monthly",
      },
    });
    res.json(data);
  } catch (error) {
    sendNormalizedError(res, "usage_history_monthly", error);
  }
};