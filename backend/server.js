require("dotenv").config();
const http = require("http");
const app = require("./src/app");
const { getDb } = require("./src/db/database");
const { startBackgroundSync } = require("./src/services/sync.service");
const { initWsGateway } = require("./src/realtime/wsGateway");
const { startWeeklySummaryScheduler } = require("./src/services/notification.service");

const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === "production" && !process.env.SMT_BACKEND_API_KEY) {
  throw new Error("Missing SMT_BACKEND_API_KEY in production.");
}

// Initialize database on startup
getDb();
console.log("Database initialized.");

const httpServer = http.createServer(app);

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
initWsGateway(httpServer, { allowedOrigins });

httpServer.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);

  // Start background SMT data sync
  if (process.env.SMT_SYNC_ENABLED !== "false") {
    startBackgroundSync();
  }

  // Start notification schedulers (weekly summaries, purge)
  startWeeklySummaryScheduler();
});