const express = require("express");
const router = express.Router();

const smtRoutes = require("./smt.routes");
const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const adminRoutes = require("./admin.routes");

router.use("/smt", smtRoutes);
router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/admin", adminRoutes);

module.exports = router;