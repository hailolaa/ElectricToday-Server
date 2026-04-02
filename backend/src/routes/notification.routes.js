const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");
const { jwtAuth } = require("../middleware/jwtAuth.middleware");
const {
  requirePermission,
} = require("../middleware/requirePermission.middleware");

// All notification routes require JWT auth
router.use(jwtAuth);

// Core CRUD
router.get(
  "/",
  requirePermission("notifications:read"),
  notificationController.getNotifications
);
router.get(
  "/unread-count",
  requirePermission("notifications:read"),
  notificationController.getUnreadCount
);
router.put(
  "/read-all",
  requirePermission("notifications:write"),
  notificationController.markAllRead
);
router.put(
  "/:id/read",
  requirePermission("notifications:write"),
  notificationController.markRead
);
router.delete(
  "/:id",
  requirePermission("notifications:write"),
  notificationController.dismiss
);
router.delete(
  "/",
  requirePermission("notifications:write"),
  notificationController.dismissAll
);

// Preferences
router.get(
  "/preferences",
  requirePermission("notifications:read"),
  notificationController.getPreferences
);
router.put(
  "/preferences",
  requirePermission("notifications:write"),
  notificationController.updatePreferences
);

module.exports = router;
