const notificationModel = require("../models/notification.model");

// ---------------------------------------------------------------------------
// GET /api/notifications
// Returns active (non-dismissed) notifications for the authenticated user.
// Query: ?limit=50&offset=0&all=false
// ---------------------------------------------------------------------------
exports.getNotifications = async (req, res) => {
  try {
    const user = req.user;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const showAll = req.query.all === "true";

    const notifications = showAll
      ? notificationModel.getAll({ userId: user.id, limit, offset })
      : notificationModel.getActive({ userId: user.id, limit, offset });

    const unreadCount = notificationModel.countUnread(user.id);

    res.json({
      success: true,
      data: {
        notifications,
        unreadCount,
        total: notifications.length,
      },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATIONS_ERROR",
        message: error.message || "Failed to fetch notifications.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// GET /api/notifications/unread-count
// Returns just the unread count (lightweight poll endpoint).
// ---------------------------------------------------------------------------
exports.getUnreadCount = async (req, res) => {
  try {
    const count = notificationModel.countUnread(req.user.id);
    res.json({
      success: true,
      data: { unreadCount: count },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATIONS_ERROR",
        message: error.message || "Failed to get unread count.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/notifications/:id/read
// Mark a single notification as read.
// ---------------------------------------------------------------------------
exports.markRead = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Valid notification id is required." },
      });
    }
    notificationModel.markRead(id, req.user.id);
    const unreadCount = notificationModel.countUnread(req.user.id);
    res.json({
      success: true,
      data: { unreadCount },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATIONS_ERROR",
        message: error.message || "Failed to mark notification as read.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/notifications/read-all
// Mark all notifications as read for the user.
// ---------------------------------------------------------------------------
exports.markAllRead = async (req, res) => {
  try {
    notificationModel.markAllRead(req.user.id);
    res.json({
      success: true,
      data: { unreadCount: 0 },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATIONS_ERROR",
        message: error.message || "Failed to mark all as read.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/notifications/:id
// Dismiss (soft-delete) a single notification.
// ---------------------------------------------------------------------------
exports.dismiss = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Valid notification id is required." },
      });
    }
    notificationModel.dismiss(id, req.user.id);
    const unreadCount = notificationModel.countUnread(req.user.id);
    res.json({
      success: true,
      data: { unreadCount },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATIONS_ERROR",
        message: error.message || "Failed to dismiss notification.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/notifications
// Dismiss all notifications for the user.
// ---------------------------------------------------------------------------
exports.dismissAll = async (req, res) => {
  try {
    notificationModel.dismissAll(req.user.id);
    res.json({
      success: true,
      data: { unreadCount: 0 },
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "NOTIFICATIONS_ERROR",
        message: error.message || "Failed to dismiss all notifications.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// GET /api/notifications/preferences
// Get the user's notification preferences.
// ---------------------------------------------------------------------------
exports.getPreferences = async (req, res) => {
  try {
    const prefs = notificationModel.getPreferences(req.user.id);
    res.json({
      success: true,
      data: prefs,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "PREFERENCES_ERROR",
        message: error.message || "Failed to fetch notification preferences.",
      },
    });
  }
};

// ---------------------------------------------------------------------------
// PUT /api/notifications/preferences
// Update notification preferences.
// Body: { highUsage: bool, budgetAlert: bool, weeklySummary: bool, ... }
// ---------------------------------------------------------------------------
exports.updatePreferences = async (req, res) => {
  try {
    const allowed = [
      "highUsage", "budgetAlert", "weeklySummary", "usageSpike",
      "betterProvider", "dailySummary", "billEstimate",
      "dailyBudget", "spikeThreshold",
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "No valid preference fields provided." },
      });
    }

    // Validate numeric fields
    if (updates.dailyBudget !== undefined && (Number(updates.dailyBudget) <= 0 || Number(updates.dailyBudget) > 1000)) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "dailyBudget must be between $0.01 and $1000." },
      });
    }
    if (updates.spikeThreshold !== undefined && (Number(updates.spikeThreshold) < 1.1 || Number(updates.spikeThreshold) > 10)) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "spikeThreshold must be between 1.1 and 10." },
      });
    }

    notificationModel.updatePreferences(req.user.id, updates);
    const prefs = notificationModel.getPreferences(req.user.id);

    res.json({
      success: true,
      data: prefs,
      meta: { timestamp: new Date().toISOString() },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: "PREFERENCES_ERROR",
        message: error.message || "Failed to update notification preferences.",
      },
    });
  }
};
