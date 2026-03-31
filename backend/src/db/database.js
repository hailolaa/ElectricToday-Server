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
      esiid                 TEXT    NOT NULL,
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
  `);
}

module.exports = { getDb, encrypt, decrypt };
