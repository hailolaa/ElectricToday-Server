function apiKeyAuth(req, res, next) {
  const requiredApiKey = process.env.SMT_BACKEND_API_KEY;
  const isNonProd = process.env.NODE_ENV !== "production";
  const isAuthRoute =
    req.path === "/auth/login" || req.path === "/auth/me";

  // Public read-only endpoints that don't need an API key.
  const isPublicRoute =
    (req.method === "GET" && req.path.startsWith("/providers")) ||
    (req.method === "GET" && req.path === "/healthz") ||
    (req.method === "GET" && req.path === "/readyz");

  if (process.env.NODE_ENV === "production" && !requiredApiKey) {
    return res.status(500).json({
      success: false,
      provider: "backend",
      operation: "api_key_auth",
      error: {
        code: "API_KEY_MISCONFIGURED",
        message: "Server API key is not configured.",
        details: null,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  }

  // Optional protection: only enforced when SMT_BACKEND_API_KEY is configured.
  if (!requiredApiKey) {
    return next();
  }

  // Allow public read-only endpoints without API key.
  if (isPublicRoute) {
    return next();
  }

  // Developer convenience: do not block auth bootstrap routes in non-prod.
  if (isNonProd && isAuthRoute) {
    return next();
  }

  const providedKey = req.headers["x-api-key"];
  if (typeof providedKey !== "string" || providedKey !== requiredApiKey) {
    return res.status(401).json({
      success: false,
      provider: "backend",
      operation: "api_key_auth",
      error: {
        code: "API_KEY_UNAUTHORIZED",
        message: "Missing or invalid x-api-key.",
        details: null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    });
  }

  return next();
}

module.exports = {
  apiKeyAuth,
};
