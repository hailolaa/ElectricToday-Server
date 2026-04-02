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

    CREATE TABLE IF NOT EXISTS notifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      type            TEXT    NOT NULL,           -- high_usage | budget_exceeded | weekly_summary | usage_spike | better_provider | sync_failed | bill_estimate | daily_summary
      title           TEXT    NOT NULL,
      body            TEXT    NOT NULL,
      priority        TEXT    NOT NULL DEFAULT 'normal',  -- low | normal | high | critical
      read            INTEGER NOT NULL DEFAULT 0,
      dismissed       INTEGER NOT NULL DEFAULT 0,
      metadata        TEXT,                       -- JSON blob for extra data
      created_at      TEXT    DEFAULT (datetime('now')),
      expires_at      TEXT,                       -- optional TTL
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON notifications(user_id, read, dismissed);

    CREATE TABLE IF NOT EXISTS notification_preferences (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL UNIQUE,
      high_usage      INTEGER NOT NULL DEFAULT 1,
      budget_alert    INTEGER NOT NULL DEFAULT 1,
      weekly_summary  INTEGER NOT NULL DEFAULT 1,
      usage_spike     INTEGER NOT NULL DEFAULT 1,
      better_provider INTEGER NOT NULL DEFAULT 1,
      daily_summary   INTEGER NOT NULL DEFAULT 0,
      bill_estimate   INTEGER NOT NULL DEFAULT 1,
      daily_budget    REAL    NOT NULL DEFAULT 8.0,   -- $ daily budget threshold
      spike_threshold REAL    NOT NULL DEFAULT 2.0,   -- multiplier vs 7-day avg
      updated_at      TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

  // ── Migration: add sync failure tracking columns ──
  const userCols2 = db.pragma("table_info(users)");
  if (!userCols2.find((c) => c.name === "sync_fail_count")) {
    db.exec(`
      ALTER TABLE users ADD COLUMN sync_fail_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN sync_disabled_at TEXT;
    `);
    console.log("[db] Migration: added sync_fail_count & sync_disabled_at to users.");
  }

  // ── Seed / backfill default providers (insert missing, update existing) ──
  const defaultProviders = [
    ["Gexa Energy", 8.0, 11.2, "Bill Credit", 12, "$150"],
    ["Cirro Energy", 8.1, 11.5, "Tiered", 12, "$150"],
    ["4Change Energy", 8.3, 10.9, "Value Fixed", 12, "$135"],
    ["Rhythm Energy", 8.4, 11.0, "100% Renewable", 12, "$0"],
    ["Champion Energy", 8.6, 11.3, "Fixed", 12, "$150"],
    ["Discount Power", 8.7, 11.4, "Fixed", 12, "$150"],
    ["Amigo Energy", 8.8, 11.6, "Fixed", 12, "$150"],
    ["Payless Power", 8.9, 12.2, "Prepaid", 1, "$0"],
    ["First Choice Power", 9.0, 11.8, "Fixed", 12, "$150"],
    ["Just Energy", 9.2, 12.1, "Fixed Green", 12, "$175"],
    ["TriEagle Energy", 9.3, 11.7, "Fixed", 24, "$200"],
    ["Spark Energy", 9.4, 12.0, "Fixed", 12, "$150"],
    ["Reliant Energy", 11.9, 14.8, "Fixed / Free Weekends", 12, "$150"],
    ["TXU Energy", 11.5, 15.1, "Fixed / Free Nights", 12, "$150"],
    ["Green Mountain", 12.3, 15.9, "100% Renewable", 12, "$150"],
    ["Direct Energy", 14.9, 16.5, "Simple Fixed", 12, "$135"],
  ];
  {
    const upsertStmt = db.prepare(`
      INSERT INTO providers
        (name, energy_rate_cents, avg_all_in_cents, plan_type, term_months, cancellation_fee)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        avg_all_in_cents  = COALESCE(excluded.avg_all_in_cents,  avg_all_in_cents),
        plan_type         = COALESCE(excluded.plan_type,         plan_type),
        term_months       = COALESCE(excluded.term_months,       term_months),
        cancellation_fee  = COALESCE(excluded.cancellation_fee,  cancellation_fee),
        updated_at        = datetime('now')
    `);
    const tx = db.transaction(() => {
      let inserted = 0;
      for (const r of defaultProviders) {
        const changes = upsertStmt.run(...r).changes;
        if (changes > 0) inserted++;
      }
      if (inserted > 0) {
        console.log(`[db] Upserted ${inserted} default provider(s).`);
      }
    });
    tx();
  }
}

module.exports = { getDb, encrypt, decrypt };
