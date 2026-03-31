const express = require("express");
const router = express.Router();
const { jwtAuth } = require("../middleware/jwtAuth.middleware");
const { requireAdmin } = require("../middleware/requireAdmin.middleware");

router.use(jwtAuth);
router.use(requireAdmin);

// Minimal admin-guarded endpoint used by clients to verify role access.
router.get("/status", (req, res) => {
  return res.json({
    success: true,
    data: {
      role: req.user.role,
      access: "granted",
    },
    meta: { timestamp: new Date().toISOString() },
  });
});

module.exports = router;
