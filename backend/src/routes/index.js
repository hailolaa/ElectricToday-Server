const express = require("express");
const router = express.Router();

const smtRoutes = require("./smt.routes");
const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const adminRoutes = require("./admin.routes");
const providerRoutes = require("./provider.routes");

router.use("/smt", smtRoutes);
router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/admin", adminRoutes);
router.use("/providers", providerRoutes);

module.exports = router;