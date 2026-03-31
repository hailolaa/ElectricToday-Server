const path = require("path");

function applyTestEnv() {
  process.env.NODE_ENV = "test";
  process.env.SMT_DB_PATH = process.env.SMT_DB_PATH || path.join(__dirname, "..", "..", "data", "test.db");
  process.env.SMT_BACKEND_API_KEY = process.env.SMT_BACKEND_API_KEY || "test-api-key";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  process.env.SMT_ENCRYPTION_KEY = process.env.SMT_ENCRYPTION_KEY || "test-encryption-key";
}

module.exports = { applyTestEnv };
