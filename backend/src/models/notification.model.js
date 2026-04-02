const { getDb } = require("../db/database");

// ---------------------------------------------------------------------------
// Notifications CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a new notification for a user.
 * @returns {{ id: number }}
 */
function create({ userId, type, title, body, priority, metadata, expiresAt }) {
  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, type, title, body, priority, metadata, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      type,
      title,
      body,
      priority || "normal",
      metadata ? JSON.stringify(metadata) : null,
      expiresAt || null
    );
  return { id: info.lastInsertRowid };
}

/**
 * Get all active (non-dismissed, non-expired) notifications for a user.
 * Ordered by newest first. Supports pagination via limit/offset.
 */
function getActive({ userId, limit = 50, offset = 0 }) {
  return getDb()
    .prepare(
      `SELECT * FROM notifications
       WHERE user_id = ?
         AND dismissed = 0
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset)
    .map(_hydrate);
}

/**
 * Get ALL notifications for a user (including dismissed), for history view.
 */
function getAll({ userId, limit = 100, offset = 0 }) {
  return getDb()
    .prepare(
      `SELECT * FROM notifications
       WHERE user_id = ?
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset)
    .map(_hydrate);
}

/**
 * Count unread notifications for a user.
 */
function countUnread(userId) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE user_id = ?
         AND read = 0
         AND dismissed = 0
         AND (expires_at IS NULL OR expires_at > datetime('now'))`
    )
    .get(userId);
  return row?.count || 0;
}

/**
 * Mark a single notification as read.
 */
function markRead(notificationId, userId) {
  return getDb()
    .prepare(
      `UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?`
    )
    .run(notificationId, userId);
}

/**
 * Mark ALL unread notifications as read for a user.
 */
function markAllRead(userId) {
  return getDb()
    .prepare(
      `UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0`
    )
    .run(userId);
}

/**
 * Dismiss (soft-delete) a single notification.
 */
function dismiss(notificationId, userId) {
  return getDb()
    .prepare(
      `UPDATE notifications SET dismissed = 1 WHERE id = ? AND user_id = ?`
    )
    .run(notificationId, userId);
}

/**
 * Dismiss all notifications for a user.
 */
function dismissAll(userId) {
  return getDb()
    .prepare(
      `UPDATE notifications SET dismissed = 1 WHERE user_id = ? AND dismissed = 0`
    )
    .run(userId);
}

/**
 * Check if a notification of a given type was already created today for a user.
 * Prevents duplicate notifications within a 24-hour window.
 */
function existsTodayForType(userId, type) {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE user_id = ?
         AND type = ?
         AND created_at >= datetime('now', '-1 day')`
    )
    .get(userId, type);
  return (row?.count || 0) > 0;
}

/**
 * Hard-delete notifications older than a given number of days.
 * Called periodically to keep the table lean.
 */
function purgeOlderThan(days = 90) {
  return getDb()
    .prepare(
      `DELETE FROM notifications WHERE created_at < datetime('now', ? || ' days')`
    )
    .run(`-${days}`);
}

// ---------------------------------------------------------------------------
// Notification Preferences
// ---------------------------------------------------------------------------

function getPreferences(userId) {
  const db = getDb();
  let row = db
    .prepare(`SELECT * FROM notification_preferences WHERE user_id = ?`)
    .get(userId);

  if (!row) {
    // Create default preferences
    db.prepare(
      `INSERT INTO notification_preferences (user_id) VALUES (?)`
    ).run(userId);
    row = db
      .prepare(`SELECT * FROM notification_preferences WHERE user_id = ?`)
      .get(userId);
  }

  return {
    highUsage: !!row.high_usage,
    budgetAlert: !!row.budget_alert,
    weeklySummary: !!row.weekly_summary,
    usageSpike: !!row.usage_spike,
    betterProvider: !!row.better_provider,
    dailySummary: !!row.daily_summary,
    billEstimate: !!row.bill_estimate,
    dailyBudget: row.daily_budget,
    spikeThreshold: row.spike_threshold,
  };
}

function updatePreferences(userId, prefs) {
  const db = getDb();

  // Ensure row exists
  getPreferences(userId);

  const fields = [];
  const values = [];

  const mapping = {
    highUsage: "high_usage",
    budgetAlert: "budget_alert",
    weeklySummary: "weekly_summary",
    usageSpike: "usage_spike",
    betterProvider: "better_provider",
    dailySummary: "daily_summary",
    billEstimate: "bill_estimate",
    dailyBudget: "daily_budget",
    spikeThreshold: "spike_threshold",
  };

  for (const [key, col] of Object.entries(mapping)) {
    if (prefs[key] !== undefined) {
      fields.push(`${col} = ?`);
      // Boolean fields → 0/1, numeric fields → number
      if (col === "daily_budget" || col === "spike_threshold") {
        values.push(Number(prefs[key]));
      } else {
        values.push(prefs[key] ? 1 : 0);
      }
    }
  }

  if (fields.length === 0) return;

  fields.push(`updated_at = datetime('now')`);
  values.push(userId);

  db.prepare(
    `UPDATE notification_preferences SET ${fields.join(", ")} WHERE user_id = ?`
  ).run(...values);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function _hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    read: !!row.read,
    dismissed: !!row.dismissed,
  };
}

module.exports = {
  create,
  getActive,
  getAll,
  countUnread,
  markRead,
  markAllRead,
  dismiss,
  dismissAll,
  existsTodayForType,
  purgeOlderThan,
  getPreferences,
  updatePreferences,
};
