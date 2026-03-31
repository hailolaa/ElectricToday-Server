function apiRateLimit() {
  const maxRequests = Number(process.env.API_RATE_LIMIT_MAX || 300);
  const windowMs = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60_000);
  const usageHistoryMax = Number(
    process.env.API_RATE_LIMIT_USAGE_HISTORY_MAX || Math.max(maxRequests, 600)
  );
  const bucket = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const clientKey =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const isUsageHistoryEndpoint =
      req.method === "GET" && req.path === "/api/user/usage/history";
    const endpointBucket = isUsageHistoryEndpoint ? "usage_history" : "global";
    const key = `${clientKey}:${endpointBucket}`;
    const effectiveMax = isUsageHistoryEndpoint ? usageHistoryMax : maxRequests;
    const record = bucket.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }
    record.count += 1;
    bucket.set(key, record);

    res.setHeader("x-rate-limit-limit", String(effectiveMax));
    res.setHeader(
      "x-rate-limit-remaining",
      String(Math.max(0, effectiveMax - record.count))
    );
    res.setHeader("x-rate-limit-reset", String(record.resetAt));

    if (record.count > effectiveMax) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader("retry-after", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        provider: "backend",
        operation: "api_rate_limit",
        error: {
          code: "SMT_RATE_LIMIT",
          message: "Too many requests. Please try again shortly.",
          details: null,
        },
        meta: { timestamp: new Date().toISOString() },
      });
    }
    return next();
  };
}

module.exports = { apiRateLimit };
