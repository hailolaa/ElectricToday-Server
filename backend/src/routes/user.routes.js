const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const { jwtAuth } = require("../middleware/jwtAuth.middleware");

// All user routes require JWT auth
router.use(jwtAuth);

router.get("/usage/history", userController.getUsageHistory);
router.get("/energy-trends", userController.getEnergyTrends);
router.get("/energy/snapshot", userController.getEnergySnapshot);
router.get("/meter-reads", userController.getMeterReads);
router.get("/odr-rate-limit", userController.getOdrRateLimit);
router.put("/esiid", userController.updateEsiid);
router.put("/provider", userController.updateProvider);

module.exports = router;
