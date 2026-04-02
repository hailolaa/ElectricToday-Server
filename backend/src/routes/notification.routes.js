const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notification.controller");
const { jwtAuth } = require("../middleware/jwtAuth.middleware");

// All notification routes require JWT auth
router.use(jwtAuth);

// Core CRUD
router.get("/", notificationController.getNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.put("/read-all", notificationController.markAllRead);
router.put("/:id/read", notificationController.markRead);
router.delete("/:id", notificationController.dismiss);
router.delete("/", notificationController.dismissAll);

// Preferences
router.get("/preferences", notificationController.getPreferences);
router.put("/preferences", notificationController.updatePreferences);

module.exports = router;
