const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const { jwtAuth } = require("../middleware/jwtAuth.middleware");

router.post("/login", authController.login);
router.get("/me", jwtAuth, authController.me);

module.exports = router;
