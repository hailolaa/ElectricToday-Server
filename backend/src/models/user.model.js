const { getDb, encrypt, decrypt } = require("../db/database");

/**
 * Create or update a user.
 * Lookup order:
 *   1. Exact match on smt_username + esiid (if esiid provided)
 *   2. Match on smt_username alone (covers the case where the user logged in
 *      without ESIID initially and later provided one during onboarding)
 * If found, update password + optionally ESIID/meter. Otherwise insert.
 */
function upsertUser({ smtUsername, smtPassword, esiid, meterNumber, providerName }) {
  const db = getDb();
  const enc = encrypt(smtPassword);

  // Try exact match first
  let existing = esiid
    ? db.prepare("SELECT id FROM users WHERE smt_username = ? AND esiid = ?").get(smtUsername, esiid)
    : null;

  // Fall back to username-only match (handles null/missing ESIID at login)
  if (!existing) {
    existing = db.prepare("SELECT id FROM users WHERE smt_username = ?").get(smtUsername);
  }

  if (existing) {
    db.prepare(
      `UPDATE users
          SET smt_password_enc = ?,
              esiid = COALESCE(?, esiid),
              meter_number = COALESCE(?, meter_number),
              provider_name = COALESCE(?, provider_name),
              updated_at = datetime('now')
        WHERE id = ?`
    ).run(enc, esiid || null, meterNumber || null, providerName || null, existing.id);
    return { id: existing.id, created: false };
  }

  const info = db
    .prepare(
      `INSERT INTO users (smt_username, smt_password_enc, esiid, meter_number, provider_name)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(smtUsername, enc, esiid || null, meterNumber || null, providerName || null);

  return { id: info.lastInsertRowid, created: true };
}

function findById(id) {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function findByUsernameAndEsiid(smtUsername, esiid) {
  return getDb()
    .prepare("SELECT * FROM users WHERE smt_username = ? AND esiid = ?")
    .get(smtUsername, esiid);
}

function getAllUsers() {
  return getDb().prepare("SELECT * FROM users").all();
}

/**
 * Return decrypted SMT credentials for background sync.
 */
function getSmtCredentials(userId) {
  const user = findById(userId);
  if (!user) return null;
  return {
    username: user.smt_username,
    password: decrypt(user.smt_password_enc),
    esiid: user.esiid,
    meterNumber: user.meter_number,
    providerName: user.provider_name,
  };
}

function updateMeterNumber(userId, meterNumber) {
  getDb()
    .prepare(
      `UPDATE users SET meter_number = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(meterNumber, userId);
}

function updateEsiid(userId, esiid) {
  getDb()
    .prepare(
      `UPDATE users SET esiid = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(esiid, userId);
}

function updateProviderName(userId, providerName) {
  getDb()
    .prepare(`UPDATE users SET provider_name = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(providerName, userId);
}

// ── Sync failure tracking ──

const MAX_SYNC_FAILURES = 5;

function incrementSyncFailures(userId) {
  const db = getDb();
  db.prepare(
    `UPDATE users
        SET sync_fail_count = sync_fail_count + 1,
            updated_at = datetime('now')
      WHERE id = ?`
  ).run(userId);

  // Auto-disable sync after MAX_SYNC_FAILURES consecutive failures
  const user = db.prepare("SELECT sync_fail_count FROM users WHERE id = ?").get(userId);
  if (user && user.sync_fail_count >= MAX_SYNC_FAILURES) {
    db.prepare(
      `UPDATE users
          SET sync_disabled_at = datetime('now'),
              updated_at = datetime('now')
        WHERE id = ? AND sync_disabled_at IS NULL`
    ).run(userId);
    console.log(`[sync] User ${userId}: disabled after ${user.sync_fail_count} consecutive failures.`);
  }
}

function resetSyncFailures(userId) {
  getDb().prepare(
    `UPDATE users
        SET sync_fail_count = 0,
            sync_disabled_at = NULL,
            updated_at = datetime('now')
      WHERE id = ?`
  ).run(userId);
}

function isSyncDisabled(userId) {
  const user = getDb().prepare("SELECT sync_disabled_at FROM users WHERE id = ?").get(userId);
  return !!(user && user.sync_disabled_at);
}

function getSyncableUsers() {
  return getDb()
    .prepare("SELECT * FROM users WHERE sync_disabled_at IS NULL")
    .all();
}

module.exports = {
  upsertUser,
  findById,
  findByUsernameAndEsiid,
  getAllUsers,
  getSmtCredentials,
  updateMeterNumber,
  updateEsiid,
  updateProviderName,
  incrementSyncFailures,
  resetSyncFailures,
  isSyncDisabled,
  getSyncableUsers,
};
