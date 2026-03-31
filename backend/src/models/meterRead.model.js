const { getDb } = require("../db/database");

/**
 * Store a meter read result.
 */
function insert({ userId, esiid, meterNumber, readingKwh, readAt, source }) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO meter_reads (user_id, esiid, meter_number, reading_kwh, read_at, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, esiid, meterNumber || null, readingKwh, readAt || null, source || "odr");

  return { id: info.lastInsertRowid };
}

/**
 * Get the most recent meter read for a user + esiid.
 */
function getLatest({ userId, esiid }) {
  return getDb()
    .prepare(
      `SELECT * FROM meter_reads
       WHERE user_id = ? AND esiid = ?
       ORDER BY read_at DESC, created_at DESC
       LIMIT 1`
    )
    .get(userId, esiid);
}

/**
 * Get recent meter reads for a user.
 */
function getRecent({ userId, esiid, limit }) {
  return getDb()
    .prepare(
      `SELECT * FROM meter_reads
       WHERE user_id = ? AND esiid = ?
       ORDER BY read_at DESC, created_at DESC
       LIMIT ?`
    )
    .all(userId, esiid, limit || 20);
}

module.exports = {
  insert,
  getLatest,
  getRecent,
};
