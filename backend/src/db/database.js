const Database = require("better-sqlite3");
const path = require("path");
const crypto = require("crypto");

const DB_PATH = process.env.SMT_DB_PATH || path.join(__dirname, "..", "..", "data", "smt.db");
const ENCRYPTION_KEY =
  process.env.SMT_ENCRYPTION_KEY ||
  (process.env.NODE_ENV === "production" ? "" : "default-dev-key-change-in-prod!!");

if (process.env.NODE_ENV === "production" && !ENCRYPTION_KEY) {
  throw new Error("Missing SMT_ENCRYPTION_KEY in production.");
}

// ---------------------------------------------------------------------------
// Encryption helpers – AES-256-GCM for storing SMT passwords at rest
// ---------------------------------------------------------------------------
function deriveKey(secret) {
  return crypto.scryptSync(secret, "smt-salt", 32);
}

function encrypt(plainText) {
  const key = deriveKey(ENCRYPTION_KEY);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
}

function decrypt(encryptedText) {
  const key = deriveKey(ENCRYPTION_KEY);
  const [ivHex, tagHex, cipherText] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(cipherText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ---------------------------------------------------------------------------
// Database initialization
// ---------------------------------------------------------------------------
let _db = null;

function getDb() {
  if (_db) return _db;

  // Ensure data directory exists
  const fs = require("fs");
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");

  runMigrations(_db);
  return _db;
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      smt_username          TEXT    NOT NULL,
      smt_password_enc      TEXT    NOT NULL,
      esiid                 TEXT,
      meter_number          TEXT,
      created_at            TEXT    DEFAULT (datetime('now')),
      updated_at            TEXT    DEFAULT (datetime('now')),
      UNIQUE(smt_username, esiid)
    );

    CREATE TABLE IF NOT EXISTS daily_usage (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      esiid       TEXT    NOT NULL,
      date        TEXT    NOT NULL,            -- YYYY-MM-DD
      kwh         REAL    NOT NULL DEFAULT 0,
      source      TEXT    DEFAULT 'smt_sync',  -- smt_sync | manual
      created_at  TEXT    DEFAULT (datetime('now')),
      UNIQUE(user_id, esiid, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meter_reads (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL,
      esiid         TEXT    NOT NULL,
      meter_number  TEXT,
      reading_kwh   REAL,
      read_at       TEXT,
      source        TEXT    DEFAULT 'odr',     -- odr | scheduled | sync
      created_at    TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS odr_attempts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      esiid       TEXT    NOT NULL,
      attempted_at TEXT   NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_daily_usage_user_date
      ON daily_usage(user_id, esiid, date);

    CREATE INDEX IF NOT EXISTS idx_meter_reads_user
      ON meter_reads(user_id, esiid, read_at);

    CREATE INDEX IF NOT EXISTS idx_odr_attempts_esiid
      ON odr_attempts(esiid, attempted_at);

    CREATE TABLE IF NOT EXISTS providers (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      name                 TEXT    NOT NULL UNIQUE,
      energy_rate_cents    REAL    NOT NULL,      -- e.g., 8.0 means $0.08/kWh
      avg_all_in_cents     REAL,                  -- e.g., 11.2 means 11.2¢/kWh at 1000 kWh
      plan_type            TEXT,
      term_months          INTEGER,
      cancellation_fee     TEXT,
      created_at           TEXT    DEFAULT (datetime('now')),
      updated_at           TEXT    DEFAULT (datetime('now'))
    );
  `);

  // ── Migration: make users.esiid nullable (for login-before-onboarding flow) ──
  // SQLite doesn't support ALTER COLUMN, so we recreate the table if esiid is
  // still NOT NULL.  We detect this via table_info pragma.
  const cols = db.pragma("table_info(users)");
  const esiidCol = cols.find((c) => c.name === "esiid");
  if (esiidCol && esiidCol.notnull === 1) {
    db.exec(`
      PRAGMA foreign_keys = OFF;

      CREATE TABLE users_new (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        smt_username          TEXT    NOT NULL,
        smt_password_enc      TEXT    NOT NULL,
        esiid                 TEXT,
        meter_number          TEXT,
        created_at            TEXT    DEFAULT (datetime('now')),
        updated_at            TEXT    DEFAULT (datetime('now')),
        UNIQUE(smt_username, esiid)
      );

      INSERT INTO users_new SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;

      PRAGMA foreign_keys = ON;
    `);
    console.log("[db] Migration: users.esiid is now nullable.");
  }

  // ── Migration: add users.provider_name (nullable) ──
  const userCols = db.pragma("table_info(users)");
  const providerNameCol = userCols.find((c) => c.name === "provider_name");
  if (!providerNameCol) {
    db.exec(`
      ALTER TABLE users ADD COLUMN provider_name TEXT;
    `);
    console.log("[db] Migration: users.provider_name added.");
  }

  // ── Seed default providers if table empty ──
  const hasProviders = db.prepare("SELECT COUNT(1) AS c FROM providers").get().c;
  if (!hasProviders) {
    const stmt = db.prepare(`
      INSERT INTO providers
        (name, energy_rate_cents, avg_all_in_cents, plan_type, term_months, cancellation_fee)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const rows = [
      ["Gexa Energy", 8.0, 11.2, "Bill Credit", 12, "$150"],
      ["Cirro Energy", 8.1, 11.5, "Tiered", 12, "$150"],
      ["TXU Energy", 11.5, 15.1, "Fixed / Free Nights", 12, "$150"],
      ["Reliant Energy", 11.9, 14.8, "Fixed / Free Weekends", 12, "$150"],
      ["Direct Energy", 14.9, 16.5, "Simple Fixed", 12, "$135"],
      ["Green Mountain", 12.3, 15.9, "100% Renewable", 12, "$150"],
    ];
    const tx = db.transaction(() => {
      rows.forEach((r) => stmt.run(...r));
    });
    tx();
    console.log("[db] Seeded default providers.");
  }
}

module.exports = { getDb, encrypt, decrypt };
