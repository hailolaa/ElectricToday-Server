const express = require("express");
const router = express.Router();

const smtController = require("../controllers/smt.controller");
const {
  validateLoginBody,
  validateUsagePayloadBody,
  validateOnDemandBody,
  validateMeterReadStatusBody,
  validateUsageHistoryBody,
} = require("../middleware/smtValidation.middleware");
const { smtAutoRelogin } = require("../middleware/smtAutoRelogin.middleware");

// Auto-re-login when SMT session is gone but JWT is valid
router.use(smtAutoRelogin);

// active provider
router.get("/provider", smtController.getProvider);

// login
router.post("/login", validateLoginBody, smtController.login);
router.get("/session", smtController.getSessionStatus);
router.post("/logout", smtController.logout);

// get usage
router.get("/usage", smtController.getUsage);
router.post("/usage", validateUsagePayloadBody, smtController.getUsageWithPayload);
router.post("/meter-read/request", validateOnDemandBody, smtController.requestOnDemandRead);
router.post("/meter-read/status", validateMeterReadStatusBody, smtController.getMeterReadStatus);
router.post("/usage/history", validateUsageHistoryBody, smtController.getUsageHistory);
router.post("/usage/daily", validateUsageHistoryBody, smtController.getDailyUsageHistory);
router.post("/usage/monthly", validateUsageHistoryBody, smtController.getMonthlyUsageHistory);

module.exports = router;