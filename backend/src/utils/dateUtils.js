/**
 * All SMT data is for Texas customers. Dates should always be in Central Time
 * (America/Chicago) to avoid off-by-one errors at day boundaries.
 *
 * JavaScript's toISOString() returns UTC, which can shift dates when the
 * server runs in UTC but the user is in CDT/CST (UTC-5/6).
 */

/**
 * Format a Date as YYYY-MM-DD in Central Time.
 * @param {Date} d
 * @returns {string} e.g. "2025-03-31"
 */
function fmtCentralDate(d) {
  // Intl with en-CA locale gives YYYY-MM-DD natively.
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

/**
 * Get today's date string in Central Time.
 * @returns {string} e.g. "2025-03-31"
 */
function todayCentral() {
  return fmtCentralDate(new Date());
}

/**
 * Add (or subtract) days from a base date, returning a new Date.
 * @param {Date} base
 * @param {number} delta – positive for future, negative for past
 * @returns {Date}
 */
function addDays(base, delta) {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

module.exports = {
  fmtCentralDate,
  todayCentral,
  addDays,
};
