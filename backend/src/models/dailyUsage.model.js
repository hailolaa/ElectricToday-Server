const { getDb } = require("../db/database");

/**
 * Insert or update a single day's usage.
 * Uses INSERT OR REPLACE on the unique (user_id, esiid, date) constraint.
 */
function upsertDay({ userId, esiid, date, kwh, source }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO daily_usage (user_id, esiid, date, kwh, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, esiid, date) DO UPDATE
       SET kwh = excluded.kwh,
           source = excluded.source`
  ).run(userId, esiid, date, kwh, source || "smt_sync");
}

/**
 * Bulk-upsert an array of { date, kwh } points for a user+esiid.
 */
function upsertMany({ userId, esiid, points, source }) {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO daily_usage (user_id, esiid, date, kwh, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, esiid, date) DO UPDATE
       SET kwh = excluded.kwh,
           source = excluded.source`
  );

  const tx = db.transaction((rows) => {
    for (const row of rows) {
      stmt.run(userId, esiid, row.date, row.kwh, source || "smt_sync");
    }
  });
  tx(points);
}

/**
 * Get usage for a date range (inclusive). Dates should be YYYY-MM-DD.
 */
function getRange({ userId, esiid, startDate, endDate }) {
  return getDb()
    .prepare(
      `SELECT date, kwh FROM daily_usage
       WHERE user_id = ? AND esiid = ? AND date >= ? AND date <= ?
       ORDER BY date ASC`
    )
    .all(userId, esiid, startDate, endDate);
}

/**
 * Sum kWh for a date range.
 */
function sumRange({ userId, esiid, startDate, endDate }) {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(kwh), 0) AS total_kwh, COUNT(*) AS days
       FROM daily_usage
       WHERE user_id = ? AND esiid = ? AND date >= ? AND date <= ?`
    )
    .get(userId, esiid, startDate, endDate);
  return { totalKwh: row.total_kwh, days: row.days };
}

/**
 * Get the latest date we have data for.
 */
function getLatestDate({ userId, esiid }) {
  const row = getDb()
    .prepare(
      `SELECT MAX(date) AS latest_date FROM daily_usage
       WHERE user_id = ? AND esiid = ?`
    )
    .get(userId, esiid);
  return row?.latest_date || null;
}

/**
 * Upsert a single day's usage, but only if the new value is higher than
 * the existing one. This is safe for ODR partial-day readings:
 *   - If no row exists → insert the ODR value.
 *   - If existing kwh < new value → update (more recent intra-day read).
 *   - If existing kwh >= new value → keep it (sync full-day total is better).
 */
function upsertDayIfHigher({ userId, esiid, date, kwh, source }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO daily_usage (user_id, esiid, date, kwh, source)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, esiid, date) DO UPDATE
       SET kwh    = CASE WHEN excluded.kwh > daily_usage.kwh THEN excluded.kwh ELSE daily_usage.kwh END,
           source = CASE WHEN excluded.kwh > daily_usage.kwh THEN excluded.source ELSE daily_usage.source END`
  ).run(userId, esiid, date, kwh, source || "odr");
}

module.exports = {
  upsertDay,
  upsertDayIfHigher,
  upsertMany,
  getRange,
  sumRange,
  getLatestDate,
};
