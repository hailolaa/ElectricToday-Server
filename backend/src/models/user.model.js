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

module.exports = {
  upsertUser,
  findById,
  findByUsernameAndEsiid,
  getAllUsers,
  getSmtCredentials,
  updateMeterNumber,
  updateEsiid,
  updateProviderName,
};
