const express = require("express");
const cors = require("cors");
const { apiKeyAuth } = require("./middleware/apiKeyAuth.middleware");
const { apiRateLimit } = require("./middleware/rateLimit.middleware");
const { getDb } = require("./db/database");

const app = express();
app.disable("x-powered-by");
if (process.env.NODE_ENV === "production") {
  // Needed when running behind reverse proxies / load balancers.
  app.set("trust proxy", 1);
}

// middleware
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser tools and local dev when no explicit allowlist exists.
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // Allow localhost / 127.0.0.1 on any port (Flutter web dev uses random ports)
      try {
        const parsed = new URL(origin);
        if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
          return callback(null, true);
        }
      } catch { /* invalid origin, fall through to block */ }
      return callback(new Error("CORS origin blocked"));
    },
  })
);

// Lightweight hardening headers without extra dependencies.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains; preload"
    );
  }
  next();
});

app.use(express.json({ limit: "300kb" }));
app.use(apiRateLimit());
app.use("/api", apiKeyAuth);

// routes
const apiRoutes = require("./routes");
app.use("/api", apiRoutes);

// Operational probes for deployments.
app.get("/healthz", (req, res) => {
  res.json({
    success: true,
    data: {
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      env: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
    },
  });
});

app.get("/readyz", (req, res) => {
  try {
    // Verify DB connectivity/readiness.
    getDb().prepare("SELECT 1 as ok").get();
    return res.json({
      success: true,
      data: { status: "ready", timestamp: new Date().toISOString() },
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      error: {
        code: "NOT_READY",
        message: "Service dependencies are not ready.",
      },
    });
  }
});

// test route
app.get("/", (req, res) => {
  res.send("Structured backend running 🚀");
});

module.exports = app;